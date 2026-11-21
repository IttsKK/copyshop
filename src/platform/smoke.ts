import { GrainEngine } from '../engine/GrainEngine'
import { DEFAULT_BLEND_PARAMS, DEFAULT_EFFECTS, STREAK_DEFAULTS, type BlendParams } from '../engine/types'
import { nativeFolder } from '../batch/fsAccess'
import { renderFile } from '../pipeline/render'
import { createProceduralSource } from '../sources/ProceduralSource'
import { exportToFolder, findArchivedOriginal } from '../storage/archive'
import { diskFolder, diskGet, diskGetAll, diskPut, diskRemove, probeDisk } from '../storage/disk'
import { DEFAULT_OUTPUT } from '../storage/presets'
import { readRecipe, sha256 } from '../storage/recipe'
import { joinPath, writeFile } from './native'

/**
 * A check of the desktop app's own parts, run when it is launched with
 * GRAIN_EMULATOR_SMOKE set to a folder holding a photo.jpg: storage on disk,
 * folders by path, a full render through WebGL in the app's WebKit, an export
 * into Originals/ and finding it again. Writes report.json there; the app then
 * quits. Never runs otherwise.
 */
export async function runSmoke(dir: string): Promise<void> {
  const results: { check: string; ok: boolean; detail?: string }[] = []
  const check = async (name: string, fn: () => Promise<string | boolean>) => {
    try {
      const out = await fn()
      results.push({ check: name, ok: out !== false, detail: typeof out === 'string' ? out : undefined })
    } catch (err) {
      results.push({ check: name, ok: false, detail: (err as Error).message })
    }
  }

  await check('storage folder', async () => (await probeDisk()) && `${diskFolder()}`)
  await check('storage round trip', async () => {
    const blob = new Blob([new Uint8Array([1, 2, 3, 250])], { type: 'application/octet-stream' })
    await diskPut('smoke', { id: 'rec', n: 7, blob })
    const back = await diskGet<{ n: number; blob: Blob }>('smoke', 'rec')
    const all = await diskGetAll<{ id: string }>('smoke')
    const bytes = back ? new Uint8Array(await back.blob.arrayBuffer()) : null
    await diskRemove('smoke', 'rec')
    const gone = (await diskGet('smoke', 'rec')) === undefined
    return back?.n === 7 && bytes?.[3] === 250 && all.length === 1 && gone
  })

  const folder = nativeFolder(dir)
  let photo: File | null = null
  await check('read a folder by path', async () => {
    const names = (await folder.files((n) => /\.jpe?g$/i.test(n))).map((f) => f.name)
    photo = await folder.file('photo.jpg')
    return !!photo && names.includes('photo.jpg') && `${names.length} jpeg(s), photo ${photo.size} bytes`
  })

  await check('WebGL in the app', async () => {
    const gl = document.createElement('canvas').getContext('webgl2')
    if (!gl) return false
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    return `${info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)}`
  })

  const blend: BlendParams = {
    ...DEFAULT_BLEND_PARAMS,
    amount: 0.6,
    effects: {
      ...DEFAULT_EFFECTS,
      halation: 0.3,
      vignette: 0.3,
      streaks: {
        enabled: true,
        amount: 1,
        shapes: [
          {
            ...STREAK_DEFAULTS,
            outline: [
              { x: -0.05, y: -0.05 },
              { x: 1.05, y: -0.05 },
              { x: 1.05, y: 0.6 },
              { x: -0.05, y: 0.6 },
            ],
            angle: -90,
            seed: 3,
            mode: 'fill',
            lengthMin: 0.4,
            band: 0.02,
          },
          {
            ...STREAK_DEFAULTS,
            outline: [
              { x: 0.45, y: 0.45 },
              { x: 0.55, y: 0.45 },
              { x: 0.55, y: 0.6 },
              { x: 0.45, y: 0.6 },
            ],
            seed: 1,
            mode: 'mask',
            feather: 0.01,
          },
        ],
      },
    },
  }

  let exported: Blob | null = null
  let hash = ''
  await check('full-resolution render with grain and streaks', async () => {
    if (!photo) return false
    const engine = new GrainEngine()
    try {
      const rendered = await renderFile(engine, photo, 'photo.jpg', createProceduralSource(), blend, DEFAULT_OUTPUT)
      exported = rendered.blob
      hash = rendered.originalHash
      await writeFile(joinPath(dir, 'render.jpg'), rendered.blob)
      return `${rendered.width}×${rendered.height}, ${rendered.blob.size} bytes`
    } finally {
      engine.dispose()
    }
  })

  await check('export carries its edit', async () => {
    const recipe = exported ? await readRecipe(exported) : null
    // The old streak that only held others back comes back as a mask (presets.ts).
    const fx = recipe?.doc.blend.effects
    return !!recipe && recipe.original.sha256 === hash && fx?.streaks.shapes.length === 1 && fx.masks.length === 1
  })

  await check('export to a folder, original into Originals/', async () => {
    if (!photo || !exported) return false
    const out = (await folder.folder('exports', true))!
    const result = await exportToFolder(out, photo, 'photo.jpg', hash, exported, 'jpg')
    const archived = await (await out.folder('Originals', false))?.file('photo.jpg')
    return !!archived && (await sha256(archived)) === hash && `${result.finalName}, original ${result.original}`
  })

  await check('find the original again from the export folder', async () => {
    const found = await findArchivedOriginal(nativeFolder(joinPath(dir, 'exports')), 'photo.jpg', hash)
    return !!found && (await sha256(found)) === hash
  })

  // The filmstrip's parts: the folder read, thumbnails by macOS (RAW too),
  // hashes on the app's side, each photo's edit on disk, and the strip itself.
  try {
  const { listPhotos, photoThumb, shaOf, saveLibrary } = await import('../storage/library')
  const { saveEdit, loadEdit } = await import('../storage/photoEdits')
  const { STARTING_LOOK } = await import('../ui/looks')
  let files: Awaited<ReturnType<typeof listPhotos>> = []
  await check('filmstrip: photos in a folder', async () => {
    files = await listPhotos(dir)
    return files.some((f) => f.name === 'photo.jpg') && files.map((f) => f.name).join(', ')
  })
  await check('filmstrip: thumbnails by macOS', async () => {
    const out: string[] = []
    for (const f of files) {
      const started = performance.now()
      const url = await photoThumb(f)
      const img = new Image()
      img.src = url
      await img.decode()
      out.push(`${f.name} ${img.naturalWidth}×${img.naturalHeight} in ${Math.round(performance.now() - started)} ms`)
    }
    return out.join('; ')
  })
  await check('filmstrip: hash on the app side matches the page', async () => {
    const f = files.find((x) => x.name === 'photo.jpg')
    if (!f || !photo) return false
    const started = performance.now()
    const a = await shaOf(f)
    return a === (await sha256(photo)) && `${Math.round(performance.now() - started)} ms`
  })
  await check('library: photos by path, the missing left out', async () => {
    const { photoStats } = await import('./native')
    const got = await photoStats([joinPath(dir, 'photo.jpg'), joinPath(dir, 'not-there.jpg')])
    return got.length === 1 && got[0].name === 'photo.jpg' && got[0].size > 0 && `${got[0].size} bytes`
  })
  await check('library: Recent keeps opened photos, newest first', async () => {
    const { RECENT, addRecent, loadRecent, removeRecent } = await import('../storage/library')
    await addRecent(joinPath(dir, 'not-there.jpg'), 'not-there.jpg')
    await addRecent(joinPath(dir, 'photo.jpg'), 'photo.jpg')
    const listed = await listPhotos(RECENT)
    const kept = await loadRecent()
    await removeRecent(joinPath(dir, 'not-there.jpg'))
    const after = await loadRecent()
    return (
      kept[0]?.name === 'photo.jpg' &&
      kept.length === 2 &&
      listed.length === 1 &&
      after.length === 1 &&
      `${listed.map((f) => f.name).join(', ')}`
    )
  })
  await check("a photo's edit kept on disk", async () => {
    if (!photo) return false
    const id = await sha256(photo)
    const doc = { ...STARTING_LOOK.doc, blend: { ...STARTING_LOOK.doc.blend, amount: 0.37 } }
    const tiny = document.createElement('canvas')
    tiny.width = 40
    tiny.height = 30
    const ctx = tiny.getContext('2d')!
    ctx.fillStyle = '#c84'
    ctx.fillRect(0, 0, 40, 30)
    await saveEdit({ id, name: 'photo.jpg', doc, lookId: null, presetId: '', thumb: tiny.toDataURL('image/jpeg'), updatedAt: Date.now() })
    const back = await loadEdit(id)
    return back?.doc.blend.amount === 0.37
  })
  await check('filmstrip shows the folder, the edited photo marked', async () => {
    await saveLibrary({ folders: [{ path: dir, name: 'smoke' }], current: dir })
    const { createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { Filmstrip } = await import('../ui/Filmstrip')
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;bottom:0;width:1200px;z-index:99'
    document.body.append(host)
    const root = createRoot(host)
    root.render(
      createElement(Filmstrip, {
        library: { folders: [{ path: dir, name: 'smoke' }], current: dir },
        onLibrary: () => undefined,
        onAddFolder: () => undefined,
        openPath: joinPath(dir, 'photo.jpg'),
        openSha: null,
        onOpen: () => undefined,
      }),
    )
    let imgs: HTMLImageElement[] = []
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 250))
      imgs = [...host.querySelectorAll<HTMLImageElement>('.filmstrip-thumb img')]
      if (imgs.length === files.length && host.querySelector('.filmstrip-dot')) break
    }
    await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)))
    // A contact sheet of what the strip shows, to look at.
    const sheet = document.createElement('canvas')
    sheet.width = Math.max(1, imgs.reduce((w, i) => w + Math.round((i.naturalWidth / i.naturalHeight) * 70) + 6, 6))
    sheet.height = 82
    const c = sheet.getContext('2d')!
    c.fillStyle = '#1c1d21'
    c.fillRect(0, 0, sheet.width, sheet.height)
    let x = 6
    for (const i of imgs) {
      const w = Math.round((i.naturalWidth / i.naturalHeight) * 70)
      c.drawImage(i, x, 6, w, 70)
      x += w + 6
    }
    await writeFile(joinPath(dir, 'strip.png'), await new Promise<Blob>((r) => sheet.toBlob((b) => r(b!), 'image/png')))
    const on = host.querySelector('.filmstrip-item.on')?.getAttribute('title')
    const dots = host.querySelectorAll('.filmstrip-dot').length
    const head = host.querySelector('.filmstrip-head')?.textContent
    root.unmount()
    host.remove()
    return imgs.length === files.length && dots === 1 && `${imgs.length} thumbnails, ${dots} marked edited, open: ${on}, head: ${head}`
  })

    await check('the window keeps drawing while a RAW is read and developed', async () => {
      const raw = files.find((f) => /\.orf$/i.test(f.name))
      if (!raw) return 'no RAW here to try'
      const { readPhoto } = await import('../storage/library')
      const { developRaw } = await import('../pipeline/raw')
      let worst = 0
      let last = performance.now()
      let on = true
      const tick = () => {
        const now = performance.now()
        worst = Math.max(worst, now - last)
        last = now
        if (on) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
      const started = performance.now()
      const blob = await readPhoto(raw)
      const read = performance.now() - started
      const dev = await developRaw(blob!, raw.name)
      const total = performance.now() - started
      on = false
      return worst < 250 && `read ${Math.round(read)} ms, developed in ${Math.round(total - read)} ms (${Math.round(dev.size / 1e6)} MB), longest frame ${Math.round(worst)} ms`
    })
  } catch (err) {
    results.push({ check: 'filmstrip checks', ok: false, detail: `${(err as Error).message} ${(err as Error).stack ?? ''}` })
  }

  await writeFile(joinPath(dir, 'report.json'), JSON.stringify({ userAgent: navigator.userAgent, results }, null, 2))
}
