/**
 * A streak's colour line (StreakShape.colourLine): a line drawn across the
 * streak that says where its bars read their colours. Each line of the
 * streak reads where it crosses this one; a line that doesn't cross it
 * reads at the edge, as it would without one.
 *
 * Points are fractions of the frame shapes are kept in, as a streak's
 * outline and path are. `coords` brings such a point into the streak's own
 * coordinates (s with the flow, t across it), as the engine places it.
 */
import { pathFlow, streakCoords, streakVanish } from './streaks'
import type { StreakShape } from './types'

type Pt = { x: number; y: number }
type Coords = (p: Pt) => { s: number; t: number }

/**
 * A streak's own coordinates for its points, as the engine places it
 * (GrainEngine: its direction, path or vanishing point), given how a point
 * (a fraction of the frame) goes into short-side units. The lens's bend is
 * left out: the line it gives is a starting place, moved by hand after.
 */
export function streakCoordsOf(shape: StreakShape, toShort: (p: Pt) => Pt): Coords {
  const a = (shape.angle * Math.PI) / 180
  const dir = { x: Math.cos(a), y: Math.sin(a) }
  const followed = shape.mode !== 'mask' && (shape.path?.length ?? 0) >= 2 ? pathFlow(shape.path!.map(toShort), shape.outline.map(toShort), shape.pathEase ?? 1) : null
  const vanish =
    shape.mode === 'mask' || followed
      ? null
      : streakVanish(shape.outline.map(toShort), dir, shape.converge ?? 0, shape.radial ? Math.max(shape.band, 1e-3) : 0, shape.radialCentre && toShort(shape.radialCentre))
  return (p) => streakCoords(toShort(p), dir, followed, vanish)
}

/** At least this many points make a colour line. */
export const COLOUR_LINE_MIN = 2
/** At most this many. */
export const COLOUR_LINE_MAX = 24

/** Whether a streak's colour line is one: enough points. */
export const hasColourLine = (line: Pt[] | null | undefined): line is Pt[] => !!line && line.length >= COLOUR_LINE_MIN

/**
 * Where line t (across) meets the colour line: the s along it and the point
 * there (in the points' own fractions), or null where the colour line
 * doesn't reach t. Where it crosses t more than once, its first crossing.
 */
export function colourLineAt(line: Pt[], st: { s: number; t: number }[], t: number): { s: number; p: Pt } | null {
  for (let k = 0; k + 1 < st.length; k++) {
    const a = st[k]
    const b = st[k + 1]
    const lo = Math.min(a.t, b.t)
    const hi = Math.max(a.t, b.t)
    if (t < lo || t > hi) continue
    const f = hi - lo < 1e-9 ? 0.5 : (t - a.t) / (b.t - a.t)
    return { s: a.s + (b.s - a.s) * f, p: { x: line[k].x + (line[k + 1].x - line[k].x) * f, y: line[k].y + (line[k + 1].y - line[k].y) * f } }
  }
  return null
}

/**
 * The colour line a streak reads along without one, to start from: across
 * it, where each line meets the outline, entering it (a fill) or leaving it
 * (a trail). Found finely, then cut to the fewest points that keep to it
 * (within `tolerance` along, short-side units), so the line starts where
 * the colours are read now and has few points to move. Fractions of the
 * outline's own frame.
 */
export function defaultColourLine(outline: Pt[], coords: Coords, trail: boolean, tolerance = 0.025): Pt[] {
  if (outline.length < 3) return []
  const st = outline.map(coords)
  const ts = st.map((c) => c.t)
  const t0 = Math.min(...ts)
  const t1 = Math.max(...ts)
  if (!(t1 > t0)) return []
  const SAMPLES = 96
  const found: { s: number; t: number; p: Pt }[] = []
  for (let k = 0; k < SAMPLES; k++) {
    // A hair in from the shape's sides, where its edge is a line and not a corner.
    const t = t0 + (t1 - t0) * (0.005 + (0.99 * k) / (SAMPLES - 1))
    let best: { s: number; t: number; p: Pt } | null = null
    for (let j = 0; j < outline.length; j++) {
      const a = st[j]
      const b = st[(j + 1) % st.length]
      const lo = Math.min(a.t, b.t)
      const hi = Math.max(a.t, b.t)
      if (t < lo || t > hi || hi - lo < 1e-9) continue
      const f = (t - a.t) / (b.t - a.t)
      const s = a.s + (b.s - a.s) * f
      if (best && (trail ? s <= best.s : s >= best.s)) continue
      const p = outline[j]
      const q = outline[(j + 1) % outline.length]
      best = { s, t, p: { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f } }
    }
    if (best) found.push(best)
  }
  if (found.length < COLOUR_LINE_MIN) return []
  // The fewest points that keep within the tolerance (Douglas-Peucker, on s across t).
  const keep = new Array<boolean>(found.length).fill(false)
  keep[0] = keep[found.length - 1] = true
  const split = (a: number, b: number) => {
    let far = -1
    let most = tolerance
    for (let k = a + 1; k < b; k++) {
      const f = (found[k].t - found[a].t) / Math.max(found[b].t - found[a].t, 1e-12)
      const d = Math.abs(found[k].s - (found[a].s + (found[b].s - found[a].s) * f))
      if (d > most) {
        most = d
        far = k
      }
    }
    if (far < 0) return
    keep[far] = true
    split(a, far)
    split(far, b)
  }
  split(0, found.length - 1)
  return found.filter((_, k) => keep[k]).slice(0, COLOUR_LINE_MAX).map((c) => c.p)
}

/**
 * The streak's line table row with a colour line (the shader's
 * lineTablePass, read by tableLine): for each of `count` lines from t0 in
 * steps of `step`, the share along [s0, s0 + span] where it reads (16 bits,
 * red and green), the brightness there (blue), and met (alpha 255) or not
 * (0: it reads at its edge). Never held back: a colour line reads exactly
 * where it is drawn.
 */
export function colourLineRow(line: Pt[], coords: Coords, t0: number, step: number, count: number, s0: number, span: number, lumAt: (p: Pt) => number): Uint8Array {
  const st = line.map(coords)
  const row = new Uint8Array(count * 4)
  for (let k = 0; k < count; k++) {
    const hit = colourLineAt(line, st, t0 + (k + 0.5) * step)
    if (!hit) continue
    const f = Math.round(Math.min(1, Math.max(0, (hit.s - s0) / Math.max(span, 1e-9))) * 65535)
    row[k * 4] = f >> 8
    row[k * 4 + 1] = f & 255
    row[k * 4 + 2] = Math.round(Math.min(1, Math.max(0, lumAt(hit.p))) * 255)
    row[k * 4 + 3] = 255
  }
  return row
}
