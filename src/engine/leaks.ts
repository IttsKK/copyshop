import type { LeakKind, LeakSpot } from './types'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Spots entering from the frame edges, the way light gets in round a camera
 * back: centred just outside an edge, stretched along it. Used by "Randomise"
 * and to migrate presets from before spots could be placed by hand.
 */
export function randomSpots(seed: number, count: number, kind: LeakKind = 'light'): LeakSpot[] {
  const rand = mulberry32(seed * 2654435761)
  const spots: LeakSpot[] = []
  for (let i = 0; i < count; i++) {
    const side = Math.floor(rand() * 4)
    const t = 0.1 + 0.8 * rand()
    const size = 0.3 + 0.35 * rand()
    const [x, y, angle] =
      side === 0 ? [-0.04, t, 90] : side === 1 ? [1.04, t, 90] : side === 2 ? [t, -0.04, 0] : [t, 1.04, 0]
    spots.push({ x, y, size, stretch: 1.9, angle, strength: 1, kind })
  }
  return spots
}

export interface Point {
  x: number
  y: number
}

/** Most control points one outline can have. */
export const MAX_OUTLINE_POINTS = 16
export const MIN_OUTLINE_POINTS = 3
/** The distances a leak shape's layer holds, either side of its outline (print short-side units). */
export const SDF_RANGE = 0.6

/** Samples shared by every outline in a frame: the shader's point array. */
export const PATH_SAMPLES = 64

/**
 * A closed centripetal Catmull-Rom curve through `points`, sampled `perSpan`
 * times per span, first sample not repeated at the end. Centripetal
 * parameterisation, unlike the uniform kind, never loops or overshoots between
 * closely spaced points, so the outline goes where it is drawn.
 *
 * Sampled on the CPU and shared by the renderer and the editor, so the outline
 * you drag is the one that is painted.
 */
export function sampleOutline(points: Point[], perSpan: number): Point[] {
  const n = points.length
  if (n < 3) return points.slice()
  const at = (i: number) => points[((i % n) + n) % n]
  const knot = (a: Point, b: Point) => Math.max(Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)), 1e-4)
  const out: Point[] = []
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    const t1 = knot(p0, p1)
    const t2 = t1 + knot(p1, p2)
    const t3 = t2 + knot(p2, p3)
    for (let k = 0; k < perSpan; k++) {
      const t = t1 + ((t2 - t1) * k) / perSpan
      const lerp = (a: Point, b: Point, ta: number, tb: number) => {
        const w = (t - ta) / (tb - ta)
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w }
      }
      const a1 = lerp(p0, p1, 0, t1)
      const a2 = lerp(p1, p2, t1, t2)
      const a3 = lerp(p2, p3, t2, t3)
      const b1 = lerp(a1, a2, 0, t2)
      const b2 = lerp(a2, a3, t1, t3)
      out.push(lerp(b1, b2, t1, t2))
    }
  }
  return out
}

/**
 * A shape from before outlines were straight-sided: its smooth curve, as
 * dense straight-sided points (fractions of the print), worked out in
 * short-side units as it always was drawn, so it looks the same.
 */
export function roundedOutline(points: Point[], print: { width: number; height: number }): Point[] {
  const short = Math.min(print.width, print.height)
  const inUnits = points.map((p) => ({ x: (p.x * print.width) / short, y: (p.y * print.height) / short }))
  return sampleOutline(inUnits, 6).map((p) => ({ x: (p.x * short) / print.width, y: (p.y * short) / print.height }))
}

/** Whether a leak shape is a smooth curve through its points (see LeakSpot.rounded). */
export const isRounded = (s: { polygon?: boolean; rounded?: boolean }) => !s.polygon || !!s.rounded

/** Samples per span, so every outline in the frame fits the shared budget. */
export function samplesPerSpan(pointCount: number, outlineCount: number, total = PATH_SAMPLES): number {
  const budget = Math.floor(total / Math.max(1, outlineCount))
  return Math.max(1, Math.min(10, Math.floor(budget / Math.max(1, pointCount))))
}

function insidePolygon(p: Point, poly: Point[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]
    const b = poly[j]
    if (a.y > p.y !== b.y > p.y && p.x < a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y)) inside = !inside
  }
  return inside
}

function distanceToPolygon(p: Point, poly: Point[]): number {
  let best = Infinity
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]
    const b = poly[i]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / (abx * abx + aby * aby || 1)))
    best = Math.min(best, Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t))
  }
  return best
}

/**
 * What the renderer needs to treat an area like a blotch: how deep it goes
 * (the largest distance from inside it to its edge, so the deepest point is
 * the leak's core however thin or fat the shape is) and its long direction
 * (principal axis, for the streaks). From a coarse grid, which is plenty for a
 * soft effect and cheap enough to redo on every drag.
 */
export function shapeMetrics(samples: Point[]): { depth: number; axis: [number, number] } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let mx = 0
  let my = 0
  for (const p of samples) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
    mx += p.x / samples.length
    my += p.y / samples.length
  }
  let depth = 0
  const steps = 20
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = { x: minX + ((maxX - minX) * i) / steps, y: minY + ((maxY - minY) * j) / steps }
      if (insidePolygon(p, samples)) depth = Math.max(depth, distanceToPolygon(p, samples))
    }
  }
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of samples) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  return { depth: Math.max(depth, 0.01), axis: [Math.cos(angle), Math.sin(angle)] }
}
