import { useSyncExternalStore } from 'react'
import { decodeRaster, encodeRaster, rasterBounds } from '../engine/maskRaster'
import type { MaskRaster, MaskShape, Rect } from '../engine/types'

/** Painting a subject mask in or out by hand, on the photo. */
export interface MaskBrush {
  mode: 'add' | 'remove'
  /** Its diameter, as a share of the photo's short side. */
  size: number
  /** The stroke so far, while painting, in fractions of the photo. */
  onPaint?: (points: { x: number; y: number }[]) => void
  /** A finished stroke, in fractions of the photo. */
  onStroke: (points: { x: number; y: number }[]) => void
}

/** The photo's colours under a mask's cells, and which of them are near the colour a stroke began on. */
export interface SimilarColours {
  near: (cell: number) => boolean
}

/**
 * The photo's colour (OKLab) in each cell of a mask's raster, for a brush
 * that paints only over similar colours. `rgba` is the photo drawn at the
 * raster's own size over the part of it the raster covers.
 */
export function cellColours(rgba: Uint8ClampedArray, cells: number): Float32Array {
  const out = new Float32Array(cells * 3)
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  for (let k = 0; k < cells; k++) {
    const r = lin(rgba[k * 4])
    const g = lin(rgba[k * 4 + 1])
    const b = lin(rgba[k * 4 + 2])
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
    out[k * 3] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
    out[k * 3 + 1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
    out[k * 3 + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  }
  return out
}

/**
 * Which cells are near the colour where a stroke began: the average under a
 * small spot there (so one stray pixel does not set it), within `range`.
 */
export function similarTo(lab: Float32Array, w: number, h: number, at: { x: number; y: number }, spot: number, range: number): SimilarColours {
  let n = 0
  const ref = [0, 0, 0]
  const rad = Math.max(1, spot)
  for (let y = Math.max(0, Math.floor(at.y - rad)); y <= Math.min(h - 1, Math.ceil(at.y + rad)); y++)
    for (let x = Math.max(0, Math.floor(at.x - rad)); x <= Math.min(w - 1, Math.ceil(at.x + rad)); x++) {
      if ((x + 0.5 - at.x) ** 2 + (y + 0.5 - at.y) ** 2 > rad * rad) continue
      const k = (y * w + x) * 3
      ref[0] += lab[k]
      ref[1] += lab[k + 1]
      ref[2] += lab[k + 2]
      n++
    }
  if (!n) return { near: () => true }
  ref[0] /= n
  ref[1] /= n
  ref[2] /= n
  const r2 = range * range
  return {
    near: (cell) => {
      const k = cell * 3
      // Lightness counts a little less than colour, so shading on one surface stays in.
      const dl = (lab[k] - ref[0]) * 0.8
      const da = lab[k + 1] - ref[1]
      const db = lab[k + 2] - ref[2]
      return dl * dl + da * da + db * db <= r2
    },
  }
}

/**
 * A mask with a stroke painted into its selection: in (add) or out (remove).
 * `photo` and `shapes` are the photo's frame and the frame masks are kept in,
 * in print pixels, so the stroke lands where it was painted.
 */
export function paintRaster(
  m: MaskShape,
  points: { x: number; y: number }[],
  mode: 'add' | 'remove',
  size: number,
  photo: Rect,
  shapes: Rect,
  /**
   * Only over colours like the one where the stroke began (an auto mask, as
   * Lightroom's brush has): the photo's colour in each cell, the colour
   * started on, and how far from it still counts, in OKLab.
   */
  similar?: { lab: Float32Array; range: number },
): MaskShape {
  const r: MaskRaster = m.raster!
  // Painting goes in its own layers, not into the selection: in as the
  // photo decides, simply in, and out. A cell is in one of them at most.
  const blank = () => new Uint8Array(r.w * r.h)
  const pin = r.paintIn ? decodeRaster({ w: r.w, h: r.h, runs: r.paintIn }) : blank()
  const psure = r.paintSure ? decodeRaster({ w: r.w, h: r.h, runs: r.paintSure }) : blank()
  const pout = r.paintOut ? decodeRaster({ w: r.w, h: r.h, runs: r.paintOut }) : blank()
  const on = mode === 'remove' ? pout : psure
  const others = [pin, psure, pout].filter((g) => g !== on)
  // Photo fractions to the raster's cells.
  const toCell = (p: { x: number; y: number }) => {
    const sx = (photo.x + p.x * photo.width - shapes.x) / shapes.width
    const sy = (photo.y + p.y * photo.height - shapes.y) / shapes.height
    return { x: ((sx - r.x) / r.width) * r.w, y: ((sy - r.y) / r.height) * r.h }
  }
  const cellsPerPhotoPx = r.w / ((r.width * shapes.width) || 1)
  const radius = Math.max(0.75, (size * Math.min(photo.width, photo.height) * cellsPerPhotoPx) / 2)
  const stamp = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - radius))
    const x1 = Math.min(r.w - 1, Math.ceil(cx + radius))
    const y0 = Math.max(0, Math.floor(cy - radius))
    const y1 = Math.min(r.h - 1, Math.ceil(cy + radius))
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= radius * radius) {
          const k = y * r.w + x
          if (near && !near.near(k)) continue
          on[k] = 1
          for (const g of others) g[k] = 0
        }
  }
  const cells = points.map(toCell)
  // Only over colours like the one the stroke began on: the photo under a spot a third of the brush there.
  const near = similar && cells.length ? similarTo(similar.lab, r.w, r.h, cells[0], radius / 3, similar.range) : null
  cells.forEach((c, i) => {
    const prev = cells[i - 1] ?? c
    const steps = Math.max(1, Math.ceil(Math.hypot(c.x - prev.x, c.y - prev.y) / Math.max(0.5, radius / 2)))
    for (let k = 1; k <= steps; k++) stamp(prev.x + ((c.x - prev.x) * k) / steps, prev.y + ((c.y - prev.y) * k) / steps)
  })
  const any = (g: Uint8Array) => g.some((v) => v === 1)
  const raster: MaskRaster = { ...r }
  delete raster.paintIn
  delete raster.paintSure
  delete raster.paintOut
  if (any(pin)) raster.paintIn = encodeRaster(pin, r.w, r.h)
  if (any(psure)) raster.paintSure = encodeRaster(psure, r.w, r.h)
  if (any(pout)) raster.paintOut = encodeRaster(pout, r.w, r.h)
  return { ...m, raster, outline: rasterOutline(raster) }
}

/** Where a selection covers, painting included: its cells and what was painted in, less what was painted out. */
export function rasterCover(r: MaskRaster): Uint8Array {
  const grid = decodeRaster(r)
  if (r.paintIn) decodeRaster({ w: r.w, h: r.h, runs: r.paintIn }).forEach((v, i) => v && (grid[i] = 1))
  if (r.paintSure) decodeRaster({ w: r.w, h: r.h, runs: r.paintSure }).forEach((v, i) => v && (grid[i] = 1))
  if (r.paintOut) decodeRaster({ w: r.w, h: r.h, runs: r.paintOut }).forEach((v, i) => v && (grid[i] = 0))
  return grid
}

/** A raster mask's outline: the bounds of what it covers, painting included (all of its frame when empty), in the frame masks are kept in. */
export function rasterOutline(r: MaskRaster, grid = rasterCover(r)) {
  const b = rasterBounds(grid, r.w, r.h) ?? { x: 0, y: 0, width: 1, height: 1 }
  const ax = r.x + b.x * r.width
  const ay = r.y + b.y * r.height
  const bx = r.x + (b.x + b.width) * r.width
  const by = r.y + (b.y + b.height) * r.height
  return [
    { x: ax, y: ay },
    { x: bx, y: ay },
    { x: bx, y: by },
    { x: ax, y: by },
  ]
}

/**
 * How far from the colour a stroke began on the brush still paints, with
 * Only similar colours on (OKLab distance): one setting for every mask's
 * brush, kept between sessions.
 */
const RANGE_KEY = 'ui.mask.brushRange'
let range = (() => {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY))
    return v > 0 ? v : 0.08
  } catch {
    return 0.08
  }
})()
const rangeListeners = new Set<() => void>()
export const brushRange = () => range
export function setBrushRange(v: number) {
  range = v
  try {
    localStorage.setItem(RANGE_KEY, String(v))
  } catch {
    /* not kept: still used this session */
  }
  rangeListeners.forEach((l) => l())
}
export function useBrushRange(): number {
  return useSyncExternalStore(
    (l) => {
      rangeListeners.add(l)
      return () => rangeListeners.delete(l)
    },
    () => range,
  )
}
