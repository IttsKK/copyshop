import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { capturePointer } from './pointer'
import { gapArea, gapsAt, imageSpan, pieceMaps, type PieceMaps } from '../engine/collage'
import { cellArea } from '../engine/arrange'
import { collageImageNow } from '../storage/collageImages'
import type { CollageParams, Rect, Size } from '../engine/types'

export interface CollageEditor {
  collage: CollageParams
  seed: number | undefined
  selected: number | null
  /** An image is waiting to be laid into the next gap clicked. */
  armed: boolean
  /** A click (not a drag) on the photo, in photo fractions. */
  onClick: (x: number, y: number, shift: boolean) => void
  /** The selected piece's image moved by this much, photo fractions; `done` on release. */
  onMove: (dx: number, dy: number, done: boolean) => void
  /** The selected piece's image scaled by `factor` about a point. */
  onZoom: (factor: number, x: number, y: number) => void
  /** Double-click: the selected piece's image taken out of the gap there. `selectedBefore`: the piece selected before its first click. */
  onReset: (x: number, y: number, selectedBefore: number | null) => void
  /** Bumped when a piece's area has been worked out anew. */
  version: number
  /** The selected piece's image is being moved, sized or turned: show the rest of it, faintly. */
  moving?: boolean
  /** Whether to show that at all. */
  ghost?: boolean
  /** The transform box's corners (size) and its knob (turn); `done` on release. */
  onTransform: (patch: { scale?: number; rotation?: number }, done: boolean) => void
  /** Filling gaps: the gaps chosen, one click in each, with their regions. */
  cells?: { x: number; y: number; group?: number }[]
  /** Filling gaps: the region chosen (its group). */
  region?: number | null
}

interface Props {
  editor: CollageEditor
  /** Where the photo sits in the print, print pixels. */
  frame: Rect
  /** The part of the print on screen, print pixels. */
  region: Rect
  css: Size
}

const tints = new WeakMap<PieceMaps, HTMLCanvasElement>()
const cellTints = new WeakMap<Uint8Array, HTMLCanvasElement>()

/** Each region's colour while filling gaps, by its place among them. */
const REGION_TINTS: [number, number, number][] = [
  [120, 210, 255],
  [255, 170, 90],
  [150, 230, 140],
  [235, 130, 220],
  [255, 225, 110],
  [160, 150, 255],
  [90, 220, 200],
  [255, 120, 120],
]
const regionTints = new WeakMap<Uint8Array, Map<string, HTMLCanvasElement>>()
/** A gap as a tint in a region's colour, made once per gap and colour. */
function regionTintOf(region: Uint8Array, w: number, h: number, rgb: [number, number, number]): HTMLCanvasElement {
  let byColour = regionTints.get(region)
  if (!byColour) regionTints.set(region, (byColour = new Map()))
  const key = rgb.join(',')
  const hit = byColour.get(key)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue
    img.data[i * 4] = rgb[0]
    img.data[i * 4 + 1] = rgb[1]
    img.data[i * 4 + 2] = rgb[2]
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  byColour.set(key, c)
  return c
}

/** A cell's gap as a tint, made once per gap. */
function cellTintOf(region: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const hit = cellTints.get(region)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue
    img.data[i * 4] = 120
    img.data[i * 4 + 1] = 210
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  cellTints.set(region, c)
  return c
}

const outlines = new WeakMap<Uint8Array, HTMLCanvasElement>()

/** A gap's edge, three working pixels wide, made once per gap. */
function outlineOf(region: Uint8Array, w: number, h: number): HTMLCanvasElement {
  const hit = outlines.get(region)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(w, h)
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && region[y * w + x] !== 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!region[y * w + x]) continue
      let edge = false
      for (let dy = -3; dy <= 3 && !edge; dy++) for (let dx = -3; dx <= 3 && !edge; dx++) if (dx * dx + dy * dy <= 9 && !inside(x + dx, y + dy)) edge = true
      if (!edge) continue
      const i = (y * w + x) * 4
      img.data[i] = 255
      img.data[i + 1] = 214
      img.data[i + 2] = 120
      img.data[i + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
  outlines.set(region, c)
  return c
}

/** A piece's area as a tint, made once per area. */
function tintOf(maps: PieceMaps): HTMLCanvasElement {
  const hit = tints.get(maps)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = maps.w
  c.height = maps.h
  const ctx = c.getContext('2d')!
  const img = ctx.createImageData(maps.w, maps.h)
  for (let i = 0; i < maps.region.length; i++) {
    if (!maps.region[i]) continue
    img.data[i * 4] = 230
    img.data[i * 4 + 1] = 170
    img.data[i * 4 + 2] = 90
    img.data[i * 4 + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
  tints.set(maps, c)
  return c
}

/**
 * The collage on the photo: each piece's area tinted, the selected one more
 * strongly. Only drawn here; the preview turns clicks, drags and the wheel
 * into placing, moving and sizing (see PreviewCanvas), so zooming and
 * panning the view still work while a collage is being made.
 */
export function CollageOverlay({ editor, frame, region, css }: Props) {
  const sx = css.width / region.width
  const sy = css.height / region.height
  const pieces = useMemo(
    () => editor.collage.pieces.map((p) => pieceMaps(editor.seed, p)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.collage.pieces, editor.seed, editor.version],
  )
  const cells = useMemo(
    () => (editor.cells ?? []).map((at) => cellArea(editor.seed, at)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor.cells, editor.seed, editor.version],
  )
  const place = (maps: PieceMaps) => {
    const left = (frame.x + maps.rect[0] * frame.width - region.x) * sx
    const top = (frame.y + maps.rect[1] * frame.height - region.y) * sy
    const width = (maps.rect[2] - maps.rect[0]) * frame.width * sx
    const height = (maps.rect[3] - maps.rect[1]) * frame.height * sy
    return { left, top, width, height }
  }
  // The selected piece's image, whole and faint, in a box with handles: drag
  // a corner to size it, the knob above to turn it (Shift: 15° steps).
  const sel = editor.selected !== null && !editor.armed ? editor.collage.pieces[editor.selected] : undefined
  const selImg = sel ? collageImageNow(sel.image) : null
  let box: { cx: number; cy: number; w: number; h: number; rot: number; flip: boolean } | null = null
  if (sel && selImg) {
    const [sw, shh] = imageSpan(sel, selImg.bitmap, { width: frame.width, height: frame.height })
    box = {
      cx: (frame.x + sel.x * frame.width - region.x) * sx,
      cy: (frame.y + sel.y * frame.height - region.y) * sy,
      w: sw * frame.width * sx,
      h: shh * frame.height * sy,
      rot: sel.rotation ?? 0,
      flip: sel.flip,
    }
  }
  const host = useRef<HTMLDivElement>(null)
  // The part of the overlay the preview shows (it clips at its own edge),
  // overlay px: measured once laid out, and again whenever it may have moved.
  const [view, setView] = useState<{ left: number; top: number; right: number; bottom: number } | null>(null)
  const measure = () => {
    const el = host.current
    const port = el?.closest('.preview')
    if (!el || !port) return
    const a = el.getBoundingClientRect()
    const b = port.getBoundingClientRect()
    const next = { left: b.left - a.left, top: b.top - a.top, right: b.right - a.left, bottom: b.bottom - a.top }
    setView((v) => (v && v.left === next.left && v.top === next.top && v.right === next.right && v.bottom === next.bottom ? v : next))
  }
  useLayoutEffect(measure)
  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const viewBounds = () => view
  const drag = useRef<{ kind: 'size' | 'turn'; d0: number; a0: number; scale0: number; rot0: number } | null>(null)
  const centreOnScreen = () => {
    const r = host.current!.getBoundingClientRect()
    return { x: r.left + box!.cx, y: r.top + box!.cy }
  }
  const startDrag = (kind: 'size' | 'turn') => (e: React.PointerEvent) => {
    if (!sel || !box) return
    e.stopPropagation()
    e.preventDefault()
    const c = centreOnScreen()
    drag.current = {
      kind,
      d0: Math.max(1, Math.hypot(e.clientX - c.x, e.clientY - c.y)),
      a0: Math.atan2(e.clientY - c.y, e.clientX - c.x),
      scale0: sel.scale,
      rot0: sel.rotation ?? 0,
    }
    capturePointer(e.currentTarget, e.pointerId)
  }
  const onDrag = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !box) return
    const c = centreOnScreen()
    if (d.kind === 'size') {
      editor.onTransform({ scale: d.scale0 * (Math.hypot(e.clientX - c.x, e.clientY - c.y) / d.d0) }, false)
    } else {
      let rot = d.rot0 + ((Math.atan2(e.clientY - c.y, e.clientX - c.x) - d.a0) * 180) / Math.PI
      rot = ((rot + 540) % 360) - 180
      if (e.shiftKey) rot = Math.round(rot / 15) * 15
      editor.onTransform({ rotation: rot }, false)
    }
  }
  const endDrag = () => {
    if (!drag.current) return
    drag.current = null
    editor.onTransform({}, true)
  }

  // The selected piece's gaps, each on its own (the gap each of its clicks
  // reaches), while it is not being moved: outlined, and the one pointed at
  // filled, the gap a double-click takes the image out of.
  const [hoverGap, setHoverGap] = useState<number | null>(null)
  const gaps = useMemo(
    () => (sel && !editor.moving ? sel.seeds.map((s) => gapArea(editor.seed, { ...sel, seeds: [s] })) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sel, editor.seed, editor.version, editor.moving],
  )
  const gapPlace = (g: NonNullable<(typeof gaps)[number]>) => {
    const [x0, y0, x1, y1] = g.box
    return {
      left: (frame.x + (x0 / g.grid.w) * frame.width - region.x) * sx,
      top: (frame.y + (y0 / g.grid.h) * frame.height - region.y) * sy,
      width: ((x1 - x0 + 1) / g.grid.w) * frame.width * sx,
      height: ((y1 - y0 + 1) / g.grid.h) * frame.height * sy,
    }
  }
  // Which of its gaps is pointed at: the overlay itself lets the pointer
  // through to the photo, so it is worked out from where the pointer is.
  useEffect(() => {
    // Its gaps may have changed (one taken out): none is pointed at till the pointer moves.
    setHoverGap(null)
    if (!sel || editor.moving || editor.armed) return
    const onMove = (e: PointerEvent) => {
      const el = host.current
      if (!el) return
      const b = el.getBoundingClientRect()
      const fx = ((e.clientX - b.left) / sx + region.x - frame.x) / frame.width
      const fy = ((e.clientY - b.top) / sy + region.y - frame.y) / frame.height
      const inside = e.clientX >= b.left && e.clientX <= b.right && e.clientY >= b.top && e.clientY <= b.bottom
      const k = inside ? gapsAt(editor.seed, sel, fx, fy)[0] : undefined
      setHoverGap(k ?? null)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel, editor.moving, editor.armed, editor.seed, frame.x, frame.y, frame.width, frame.height, region.x, region.y, sx, sy])
  // Laying an image in, or filling gaps: the gap a click there would fill,
  // shown under the pointer before the click. Worked out once the pointer
  // rests, and not again while it stays inside the gap found.
  const choosing = editor.armed || !!editor.cells
  const [aim, setAim] = useState<ReturnType<typeof cellArea>>(null)
  useEffect(() => {
    setAim(null)
    if (!choosing) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let last: ReturnType<typeof cellArea> = null
    const has = (g: NonNullable<typeof last>, x: number, y: number) => {
      const gx = Math.floor(x * g.grid.w)
      const gy = Math.floor(y * g.grid.h)
      const [x0, y0, x1, y1] = g.box
      return gx >= x0 && gy >= y0 && gx <= x1 && gy <= y1 && g.region[(gy - y0) * (x1 - x0 + 1) + gx - x0] !== 0
    }
    const onMove = (e: PointerEvent) => {
      const el = host.current
      if (!el) return
      const b = el.getBoundingClientRect()
      const fx = ((e.clientX - b.left) / sx + region.x - frame.x) / frame.width
      const fy = ((e.clientY - b.top) / sy + region.y - frame.y) / frame.height
      const over = (e.target as Element | null)?.closest?.('.preview-canvas') && fx >= 0 && fy >= 0 && fx < 1 && fy < 1
      if (!over || e.buttons) {
        clearTimeout(timer)
        last = null
        setAim(null)
        return
      }
      if (last && has(last, fx, fy)) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        // A gap already chosen for filling shows as it is.
        const g = cellArea(editor.seed, { x: fx, y: fy })
        last = g && !cells.some((c) => c && has(c, fx, fy)) ? g : null
        setAim(last)
      }, 40)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointermove', onMove)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [choosing, cells, editor.seed, editor.version, frame.x, frame.y, frame.width, frame.height, region.x, region.y, sx, sy])
  // The rest of the image, faint, only while it is moved, sized or turned,
  // and only outside its piece: inside, the real result shows untouched.
  const selMaps = editor.selected !== null ? pieces[editor.selected] : null
  const showGhost = !!(box && selImg && selMaps && editor.moving && editor.ghost !== false)
  return (
    <div className="collage-overlay" ref={host}>
      {showGhost && (
        <canvas
          className="collage-ghost"
          width={Math.max(1, Math.round(css.width))}
          height={Math.max(1, Math.round(css.height))}
          ref={(c) => {
            if (!c || !box || !selImg || !selMaps) return
            const ctx = c.getContext('2d')!
            ctx.clearRect(0, 0, c.width, c.height)
            ctx.save()
            ctx.translate(box.cx, box.cy)
            ctx.rotate((box.rot * Math.PI) / 180)
            if (box.flip) ctx.scale(-1, 1)
            ctx.drawImage(selImg.bitmap, -box.w / 2, -box.h / 2, box.w, box.h)
            ctx.restore()
            // Cut the piece out: there the photo shows what it really looks like.
            const at = place(selMaps)
            ctx.globalCompositeOperation = 'destination-out'
            ctx.drawImage(tintOf(selMaps), at.left, at.top, at.width, at.height)
            ctx.globalCompositeOperation = 'source-over'
          }}
        />
      )}
      {box && selImg && (
        // The image's outline turns with it; the handles are placed apart
        // from it, so one that would land off screen (an image bigger than
        // the photo, as a sky is) is kept at the edge of the view instead,
        // still working: sizing and turning go by the image's centre.
        <div
          className={`collage-box${editor.moving ? ' moving' : ''}`}
          style={{ left: box.cx - box.w / 2, top: box.cy - box.h / 2, width: box.w, height: box.h, transform: `rotate(${box.rot}deg)` }}
        />
      )}
      {box &&
        selImg &&
        (() => {
          const t = (box.rot * Math.PI) / 180
          const at = (lx: number, ly: number) => [box.cx + lx * Math.cos(t) - ly * Math.sin(t), box.cy + lx * Math.sin(t) + ly * Math.cos(t)]
          const view = viewBounds()
          const pin = ([x, y]: number[]) => {
            if (!view) return { x, y, pinned: false }
            const px = Math.min(view.right - 14, Math.max(view.left + 14, x))
            const py = Math.min(view.bottom - 14, Math.max(view.top + 14, y))
            return { x: px, y: py, pinned: px !== x || py !== y }
          }
          const handle = { onPointerMove: onDrag, onPointerUp: endDrag, onPointerCancel: endDrag }
          const corners = [
            ['nw', -1, -1],
            ['ne', 1, -1],
            ['sw', -1, 1],
            ['se', 1, 1],
          ] as const
          const knob = pin(at(0, -box.h / 2 - 24))
          return (
            <>
              {corners.map(([name, sx, sy]) => {
                const c = pin(at((sx * box.w) / 2, (sy * box.h) / 2))
                return (
                  <span
                    key={name}
                    className={`collage-corner ${name}${c.pinned ? ' pinned' : ''}`}
                    style={{ left: c.x, top: c.y }}
                    title={c.pinned ? 'Drag to size the image (its corner is off screen; this stands in for it)' : 'Drag to size the image'}
                    onPointerDown={startDrag('size')}
                    {...handle}
                  />
                )
              })}
              <span
                className={`collage-turn${knob.pinned ? ' pinned' : ''}`}
                style={{ left: knob.x, top: knob.y }}
                title="Drag to turn the image (Shift: 15° steps)"
                onPointerDown={startDrag('turn')}
                {...handle}
              />
            </>
          )
        })()}
      {cells.map((g, k) => {
        if (!g) return null
        const [x0, y0, x1, y1] = g.box
        const w = x1 - x0 + 1
        const h = y1 - y0 + 1
        // Each region in its own colour, the one chosen outlined too.
        const list = editor.cells ?? []
        const groupOf = (i: number) => list[i]?.group ?? -(i + 1)
        const order = [...new Set(list.map((_, i) => groupOf(i)))]
        const rgb = REGION_TINTS[order.indexOf(groupOf(k)) % REGION_TINTS.length]
        const chosen = editor.region != null && groupOf(k) === editor.region
        const place = {
          left: (frame.x + (x0 / g.grid.w) * frame.width - region.x) * sx,
          top: (frame.y + (y0 / g.grid.h) * frame.height - region.y) * sy,
          width: (w / g.grid.w) * frame.width * sx,
          height: (h / g.grid.h) * frame.height * sy,
        }
        const key = `${rgb.join(',')}:${chosen ? 1 : 0}`
        return (
          <span key={`cell${k}:${x0},${y0},${w},${h}`}>
            <canvas
              className={`collage-cell${chosen ? ' chosen' : ''}`}
              style={place}
              ref={(c) => {
                if (!c || c.dataset.key === key) return
                c.dataset.key = key
                c.width = w
                c.height = h
                c.getContext('2d')!.drawImage(regionTintOf(g.region, w, h, rgb), 0, 0)
              }}
            />
            {chosen && (
              <canvas
                className="collage-gap"
                style={place}
                ref={(c) => {
                  if (!c || c.dataset.done) return
                  c.dataset.done = '1'
                  c.width = w
                  c.height = h
                  c.getContext('2d')!.drawImage(outlineOf(g.region, w, h), 0, 0)
                }}
              />
            )}
          </span>
        )
      })}
      {sel &&
        gaps.map((g, k) => {
          if (!g) return null
          const [x0, y0, x1, y1] = g.box
          const w = x1 - x0 + 1
          const h = y1 - y0 + 1
          return (
            <canvas
              key={`gap${k}:${x0},${y0},${w},${h}`}
              className={`collage-gap${hoverGap === k ? ' hover' : ''}`}
              style={gapPlace(g)}
              ref={(c) => {
                if (!c || c.dataset.key === `${x0},${y0},${w},${h}`) return
                c.dataset.key = `${x0},${y0},${w},${h}`
                c.width = w
                c.height = h
                const ctx = c.getContext('2d')!
                ctx.clearRect(0, 0, w, h)
                ctx.drawImage(outlineOf(g.region, w, h), 0, 0)
              }}
            />
          )
        })}
      {sel &&
        hoverGap !== null &&
        gaps[hoverGap] &&
        (() => {
          const g = gaps[hoverGap]!
          const [x0, y0, x1, y1] = g.box
          const w = x1 - x0 + 1
          const h = y1 - y0 + 1
          return (
            <canvas
              key={`fill${hoverGap}`}
              className="collage-gap-fill"
              style={gapPlace(g)}
              ref={(c) => {
                if (!c) return
                c.width = w
                c.height = h
                c.getContext('2d')!.drawImage(cellTintOf(g.region, w, h), 0, 0)
              }}
            />
          )
        })()}
      {aim &&
        (() => {
          const [x0, y0, x1, y1] = aim.box
          const w = x1 - x0 + 1
          const h = y1 - y0 + 1
          const at = gapPlace(aim)
          return (
            <span key={`aim:${x0},${y0},${w},${h}`}>
              <canvas
                className="collage-aim"
                style={at}
                ref={(c) => {
                  if (!c || c.dataset.done) return
                  c.dataset.done = '1'
                  c.width = w
                  c.height = h
                  // Amber, the app's own colour: a blue tint was lost on the blue sky it mostly falls on.
                  c.getContext('2d')!.drawImage(regionTintOf(aim.region, w, h, [255, 184, 80]), 0, 0)
                }}
              />
              <canvas
                className="collage-gap"
                style={at}
                ref={(c) => {
                  if (!c || c.dataset.done) return
                  c.dataset.done = '1'
                  c.width = w
                  c.height = h
                  c.getContext('2d')!.drawImage(outlineOf(aim.region, w, h), 0, 0)
                }}
              />
            </span>
          )
        })()}
      {pieces.map((maps, i) =>
        maps ? (
          <canvas
            key={editor.collage.pieces[i].id + maps.key}
            className={i === editor.selected ? 'collage-tint on' : 'collage-tint'}
            style={place(maps)}
            ref={(c) => {
              if (!c || c.dataset.key === maps.key) return
              c.dataset.key = maps.key
              const t = tintOf(maps)
              c.width = t.width
              c.height = t.height
              c.getContext('2d')!.drawImage(t, 0, 0)
            }}
          />
        ) : null,
      )}
    </div>
  )
}
