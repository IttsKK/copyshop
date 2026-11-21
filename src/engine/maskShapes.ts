import type { GradientMask, MaskRaster, MaskShape, RadialMask, Size } from './types'
import { decodeRaster, encodeRaster } from './maskRaster'

/**
 * Masks made from a few numbers: a soft ellipse (radial) and a linear fade
 * (gradient). The engine works their coverage out exactly (maskCover in the
 * shader); each still keeps an outline — the area it can cover — so it has
 * a layer like a drawn mask, and everything that moves or lists masks by
 * their outline keeps working.
 */

type Point = { x: number; y: number }

export const maskKind = (m: MaskShape): 'outline' | 'radial' | 'gradient' | 'subject' =>
  m.kind === 'radial' && m.radial ? 'radial' : m.kind === 'gradient' && m.gradient ? 'gradient' : m.raster ? 'subject' : 'outline'

export const maskOn = (m: MaskShape): boolean => m.enabled !== false

/** The ellipse's edge as an outline, in fractions of a frame this size. */
export function radialOutline(r: RadialMask, frame: Size, points = 48): Point[] {
  const short = Math.min(frame.width, frame.height)
  const a = (r.angle * Math.PI) / 180
  const cx = r.x * frame.width
  const cy = r.y * frame.height
  return Array.from({ length: points }, (_, k) => {
    const t = (k / points) * Math.PI * 2
    const ex = Math.cos(t) * r.rx * short
    const ey = Math.sin(t) * r.ry * short
    return { x: (cx + ex * Math.cos(a) - ey * Math.sin(a)) / frame.width, y: (cy + ex * Math.sin(a) + ey * Math.cos(a)) / frame.height }
  })
}

/** A gradient can reach the whole frame: its outline is the frame, a little past it. */
export const gradientOutline = (): Point[] => [
  { x: -0.02, y: -0.02 },
  { x: 1.02, y: -0.02 },
  { x: 1.02, y: 1.02 },
  { x: -0.02, y: 1.02 },
]

/** The mask with its outline made again from its numbers (a drawn mask as it is). */
export function withOutline(m: MaskShape, frame: Size): MaskShape {
  const kind = maskKind(m)
  if (kind === 'radial') return { ...m, outline: radialOutline(m.radial!, frame) }
  if (kind === 'gradient') return { ...m, outline: gradientOutline() }
  return m
}

/** A new radial mask, from a centre and a point on its edge (frame fractions). */
export function radialFrom(centre: Point, edge: Point, frame: Size): RadialMask {
  const short = Math.min(frame.width, frame.height)
  const dx = (edge.x - centre.x) * frame.width
  const dy = (edge.y - centre.y) * frame.height
  const r = Math.max(0.03, Math.hypot(dx, dy) / short)
  return { x: centre.x, y: centre.y, rx: r, ry: r, angle: 0, soft: 0.5 }
}

/**
 * The same mask on a crop of its frame: `move` takes a point there, `scale`
 * a length (shares of the short side). On a turned crop (cropAngle), `turn`
 * says how far, and `back` takes a point of the crop back to the frame: an
 * ellipse turns with it and a selection's grid is drawn again, upright on
 * the crop.
 */
export function maskOnCrop(m: MaskShape, move: (p: Point) => Point, scale: number, turn?: { deg: number; back: (p: Point) => Point }): MaskShape {
  const out: MaskShape = { ...m, outline: m.outline.map(move) }
  if (m.radial) {
    const c = move({ x: m.radial.x, y: m.radial.y })
    out.radial = { ...m.radial, x: c.x, y: c.y, rx: m.radial.rx * scale, ry: m.radial.ry * scale, angle: m.radial.angle + (turn?.deg ?? 0) }
  }
  if (m.raster) {
    if (turn) out.raster = turnedRaster(m.raster, move, turn.back)
    else {
      const a = move({ x: m.raster.x, y: m.raster.y })
      const b = move({ x: m.raster.x + m.raster.width, y: m.raster.y + m.raster.height })
      out.raster = { ...m.raster, x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y }
    }
  }
  if (m.gradient) {
    const a = move({ x: m.gradient.x0, y: m.gradient.y0 })
    const b = move({ x: m.gradient.x1, y: m.gradient.y1 })
    out.gradient = { x0: a.x, y0: a.y, x1: b.x, y1: b.y }
  }
  return out
}

/** A selection's grid (and what was painted on it) drawn again over the box its turned corners make, each cell read back from where it was. */
function turnedRaster(r: MaskRaster, move: (p: Point) => Point, back: (p: Point) => Point): MaskRaster {
  const corners = [
    { x: r.x, y: r.y },
    { x: r.x + r.width, y: r.y },
    { x: r.x, y: r.y + r.height },
    { x: r.x + r.width, y: r.y + r.height },
  ].map(move)
  const x0 = Math.min(...corners.map((c) => c.x))
  const y0 = Math.min(...corners.map((c) => c.y))
  const x1 = Math.max(...corners.map((c) => c.x))
  const y1 = Math.max(...corners.map((c) => c.y))
  // A little finer, so a turned edge keeps its detail.
  const w = Math.max(1, Math.ceil(r.w * 1.25))
  const h = Math.max(1, Math.ceil(r.h * 1.25))
  const from = new Int32Array(w * h).fill(-1)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const q = back({ x: x0 + ((i + 0.5) / w) * (x1 - x0), y: y0 + ((j + 0.5) / h) * (y1 - y0) })
      const u = Math.floor(((q.x - r.x) / r.width) * r.w)
      const v = Math.floor(((q.y - r.y) / r.height) * r.h)
      if (u >= 0 && v >= 0 && u < r.w && v < r.h) from[j * w + i] = v * r.w + u
    }
  const again = (runs: string) => {
    const old = decodeRaster({ w: r.w, h: r.h, runs })
    const grid = new Uint8Array(w * h)
    for (let k = 0; k < grid.length; k++) if (from[k] >= 0) grid[k] = old[from[k]]
    return encodeRaster(grid, w, h)
  }
  return {
    ...r,
    w,
    h,
    runs: again(r.runs),
    x: x0,
    y: y0,
    width: x1 - x0,
    height: y1 - y0,
    ...(r.paintIn ? { paintIn: again(r.paintIn) } : {}),
    ...(r.paintSure ? { paintSure: again(r.paintSure) } : {}),
    ...(r.paintOut ? { paintOut: again(r.paintOut) } : {}),
  }
}

export const DEFAULT_GRADIENT: GradientMask = { x0: 0.5, y0: 0.15, x1: 0.5, y1: 0.6 }

/**
 * An outline as the lines to draw of it: a selection of several parts is
 * one outline whose rings are joined by thin bridges, out and back the same
 * way (ml/trace.ts), which fill nothing but would show as hairlines. The
 * edges gone over both ways are left out; each ring is its own run, closed
 * on its first point. An outline with none is one run, `closed` to draw
 * shut as before.
 */
export function outlineRuns(outline: Point[]): { runs: Point[][]; closed: boolean } {
  const n = outline.length
  if (n < 3) return { runs: [outline], closed: true }
  const key = (a: Point, b: Point) => `${a.x},${a.y}>${b.x},${b.y}`
  const edges = new Set<string>()
  for (let i = 0; i < n; i++) edges.add(key(outline[i], outline[(i + 1) % n]))
  const bridge = (i: number) => {
    const a = outline[i]
    const b = outline[(i + 1) % n]
    return (a.x === b.x && a.y === b.y) || edges.has(key(b, a))
  }
  let any = false
  for (let i = 0; i < n && !any; i++) any = bridge(i) && !(outline[i].x === outline[(i + 1) % n].x && outline[i].y === outline[(i + 1) % n].y)
  if (!any) return { runs: [outline], closed: true }
  const runs: Point[][] = []
  let run: Point[] = []
  for (let i = 0; i < n; i++) {
    if (bridge(i)) {
      if (run.length > 1) runs.push(run)
      run = []
      continue
    }
    if (!run.length) run.push(outline[i])
    run.push(outline[(i + 1) % n])
  }
  if (run.length > 1) runs.push(run)
  return { runs, closed: false }
}
