import { loadCollageImage } from '../storage/collageImages'
import { useEffect, useRef, useState } from 'react'
import { renderClient } from '../engine/renderClient'
import { printSizeOf, type BlendParams } from '../engine/types'
import { hydrateGrainSource } from '../sources/GrainSource'
import { cropActive, cropAngle, cropRect } from '../engine/crop'
import { shapesOnCrop } from '../pipeline/instagram'
import type { PresetDoc } from '../storage/presets'

const SIZE = 72
const THUMB = 150
const smallPhotos = new WeakMap<ImageBitmap, HTMLCanvasElement>()

/** The photo small, once, for rendering thumbnails quickly. */
export function smallOf(photo: ImageBitmap): HTMLCanvasElement {
  let c = smallPhotos.get(photo)
  if (c) return c
  const k = Math.min(1, (THUMB * 2) / Math.max(photo.width, photo.height))
  c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(photo.width * k))
  c.height = Math.max(1, Math.round(photo.height * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, 0, 0, c.width, c.height)
  smallPhotos.set(photo, c)
  return c
}

const midPhotos = new WeakMap<ImageBitmap, HTMLCanvasElement>()
/** The photo at about 640 px, once, for its edit's thumbnail in the Library. */
export function midOf(photo: ImageBitmap): HTMLCanvasElement {
  let c = midPhotos.get(photo)
  if (c) return c
  const k = Math.min(1, 640 / Math.max(photo.width, photo.height))
  c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(photo.width * k))
  c.height = Math.max(1, Math.round(photo.height * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, 0, 0, c.width, c.height)
  midPhotos.set(photo, c)
  return c
}

// One at a time, so a long list never stalls the page; each kept once made.
let queue: Promise<unknown> = Promise.resolve()
const made = new Map<string, Promise<string>>()

/**
 * A recipe's grain for its thumbnail: made once per kind of grain and kept,
 * and a generated one made small (a 1024 plate took 130 ms on the page for
 * each thumbnail; at this size no one can tell).
 */
const grains = new Map<string, ReturnType<typeof makeGrain>>()
function makeGrain(doc: PresetDoc, size: { width: number; height: number }) {
  const gs = doc.grainSource
  const small = gs.kind === 'procedural' ? { ...gs, params: { ...(gs.params as Record<string, unknown>), size: 256 } } : gs
  return hydrateGrainSource(small).then((src) => src.getTexture({ targetSize: size }))
}
function thumbGrain(doc: PresetDoc, size: { width: number; height: number }) {
  const key = JSON.stringify(doc.grainSource)
  let g = grains.get(key)
  if (!g) {
    g = makeGrain(doc, size)
    g.catch(() => grains.delete(key))
    grains.set(key, g)
  }
  return g
}

function thumbOf(key: string, photo: ImageBitmap, seed: number | undefined, doc: PresetDoc, params: BlendParams): Promise<string> {
  const id = `${key}@${seed ?? 0}`
  let url = made.get(id)
  if (url) return url
  url = queue.then(async () => {
    const small = smallOf(photo)
    const size = { width: small.width, height: small.height }
    const grain = await thumbGrain(doc, size)
    const printed = printSizeOf(size, params)
    const k = Math.min(1, (SIZE * 2) / Math.max(printed.width, printed.height))
    // In the render worker, on an engine of their own: a second engine here
    // on the page compiled the shaders again on its first thumbnail, and the
    // whole app stood still for a second and a half as a photo opened.
    const res = await renderClient.render('thumbs', 'thumbs', {
      base: small,
      baseSize: size,
      grain: grain.source,
      grainSize: grain.size,
      grainMean: grain.mean,
      grainSd: grain.sd,
      params,
      imageSeed: seed,
      outputSize: { width: Math.max(1, Math.round(printed.width * k)), height: Math.max(1, Math.round(printed.height * k)) },
    })
    if (!res) throw new Error('replaced')
    const c = document.createElement('canvas')
    c.width = res.bitmap.width
    c.height = res.bitmap.height
    c.getContext('2d')!.drawImage(res.bitmap, 0, 0)
    res.bitmap.close()
    return c.toDataURL('image/jpeg', 0.82)
  })
  url.catch(() => made.delete(id))
  queue = url.catch(() => '')
  made.set(id, url)
  return url
}

/**
 * A photo's edit small, for the filmstrip and Library: crop included, about `long`
 * pixels on its long side, as a JPEG data URL. `small` is the photo already
 * made small (smallOf), so the photo itself may be closed by the time this
 * runs, as it is when another photo opens.
 */
/** A photo at up to `side` on its long side, kept per photo: what an edit's thumbnail is drawn from. */
const bigPhotos = new WeakMap<ImageBitmap, HTMLCanvasElement>()
export function bigOf(photo: ImageBitmap, side = 1600): HTMLCanvasElement {
  let c = bigPhotos.get(photo)
  if (c) return c
  const k = Math.min(1, side / Math.max(photo.width, photo.height))
  c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(photo.width * k))
  c.height = Math.max(1, Math.round(photo.height * k))
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, 0, 0, c.width, c.height)
  bigPhotos.set(photo, c)
  return c
}

/**
 * An edit drawn small, as it looks: from the photo near its own size with its
 * own grain, rendered at a few times the size asked for and then shrunk
 * smoothly. Drawn straight at thumbnail size from a small copy, effects
 * measured in the photo's pixels (solarize lines, edge glow, dither) and the
 * grain came out quite unlike the photo in the editor.
 */
export function editThumb(
  small: HTMLCanvasElement,
  seed: number | undefined,
  doc: PresetDoc,
  params: BlendParams,
  long = 560,
  /** Shown now (the Library's large view): not queued behind the recipe thumbnails, on a lane of its own. */
  now?: { lane: string },
): Promise<string> {
  const work = async () => {
    let base: HTMLCanvasElement = small
    let p = params
    const c = params.effects.crop
    if (cropActive(c)) {
      const r = cropRect({ width: small.width, height: small.height }, c)
      const deg = cropAngle(c)
      base = document.createElement('canvas')
      base.width = r.width
      base.height = r.height
      const ctx = base.getContext('2d')!
      // A turned crop: the photo turned about its middle, then the crop taken (engine/crop.ts).
      ctx.translate(-r.x + small.width / 2, -r.y + small.height / 2)
      ctx.rotate((deg * Math.PI) / 180)
      ctx.drawImage(small, -small.width / 2, -small.height / 2)
      p = shapesOnCrop(params, { width: small.width, height: small.height }, r, deg)
    }
    const size = { width: base.width, height: base.height }
    // A collage's images loaded first: rendered before, its pieces were missing.
    const collage = p.effects.collage
    if (collage?.enabled && collage.pieces.length) await Promise.all(collage.pieces.map((piece) => loadCollageImage(piece.image)))
    const grain = await hydrateGrainSource(doc.grainSource)
      .then((src) => src.getTexture({ targetSize: size }))
      .catch(() => thumbGrain(doc, size))
    const printed = printSizeOf(size, p)
    // Rendered at up to three times the size asked for, then shrunk.
    const k = Math.min(1, (long * 3) / Math.max(printed.width, printed.height))
    const fin = Math.min(1, long / Math.max(printed.width, printed.height))
    const res = await renderClient.render(now?.lane ?? 'filmstrip', 'thumbs', {
      base,
      baseSize: size,
      grain: grain.source,
      grainSize: grain.size,
      grainMean: grain.mean,
      grainSd: grain.sd,
      params: p,
      imageSeed: seed,
      outputSize: { width: Math.max(1, Math.round(printed.width * k)), height: Math.max(1, Math.round(printed.height * k)) },
    })
    if (!res) throw new Error('replaced')
    const out = document.createElement('canvas')
    out.width = Math.max(1, Math.round(printed.width * fin))
    out.height = Math.max(1, Math.round(printed.height * fin))
    const octx = out.getContext('2d')!
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(res.bitmap, 0, 0, out.width, out.height)
    res.bitmap.close()
    return out.toDataURL('image/jpeg', 0.85)
  }
  if (now) return work()
  const run = queue.then(work)
  queue = run.catch(() => '')
  return run
}

interface Props {
  /** The same key the recipe is previewed under: a saved one's includes when it was saved. */
  id: string
  doc: PresetDoc
  photo: { bitmap: ImageBitmap; seed?: number } | null
  /** The recipe's settings on this photo, as applying it would give. */
  params: () => BlendParams
}

/** A recipe on this photo, small: made when its row first scrolls into view, then kept. */
export function RecipeThumb({ id, doc, photo, params }: Props) {
  const [url, setUrl] = useState('')
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    setUrl('')
    if (!photo || !box.current) return
    let cancelled = false
    const seen = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return
      seen.disconnect()
      thumbOf(id, photo.bitmap, photo.seed, doc, params())
        .then((u) => !cancelled && setUrl(u))
        .catch(() => {})
    })
    seen.observe(box.current)
    return () => {
      cancelled = true
      seen.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, photo?.bitmap])
  // No photo open: no empty grey box, the row is its name and line.
  return <span ref={box} className={`recipe-thumb${photo ? '' : ' none'}`}>{url && <img src={url} alt="" />}</span>
}

/** A short fingerprint of some settings, for keeping a thumbnail per settings. */
function fingerprint(value: unknown): string {
  const s = JSON.stringify(value)
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return `${s.length}:${(h >>> 0).toString(36)}`
}

interface ExampleProps {
  photo: { bitmap: ImageBitmap; seed?: number }
  grainSource: PresetDoc['grainSource']
  /** The edit without the module, and with it. */
  without: BlendParams
  with: BlendParams
}

/**
 * What a module does to this photo, small: the photo without it and with
 * it, side by side, for its help. Made when the help opens, then kept.
 */
export function ModuleExample({ photo, grainSource, without, with: withIt }: ExampleProps) {
  const [urls, setUrls] = useState<[string, string]>(['', ''])
  const doc = { grainSource } as PresetDoc
  const keys = [fingerprint(without), fingerprint(withIt)]
  useEffect(() => {
    let cancelled = false
    setUrls(['', ''])
    Promise.all([thumbOf(`example:${keys[0]}`, photo.bitmap, photo.seed, doc, without), thumbOf(`example:${keys[1]}`, photo.bitmap, photo.seed, doc, withIt)])
      .then((u) => !cancelled && setUrls(u as [string, string]))
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photo.bitmap, keys[0], keys[1]])
  return (
    <div className="help-example" aria-label="This photo without it and with it">
      {(['Without', 'With'] as const).map((label, i) => (
        <figure key={label}>
          <span className="help-example-img">{urls[i] && <img src={urls[i]} alt="" />}</span>
          <figcaption>{label}</figcaption>
        </figure>
      ))}
    </div>
  )
}
