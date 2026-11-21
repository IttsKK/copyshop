import type { Point } from './leaks'

/** Points a streak or mask outline can have. Drawn into a texture, so this is only a sanity cap. */
export const MAX_STREAK_POINTS = 600
/**
 * How far back along its line (short-side units) a fill bar whose colour
 * is under a mask looks for a clear one: past the subject it starts against.
 */
export const STREAK_MARCH = 0.2
/** Side of each shape's texture layer, in texels; it covers the shape's own bounds. */
export const STREAK_LAYER_SIZE = 2048
/** Samples along each streak's path (each of its versions; see pathFlow). */
export const STREAK_PATH_SAMPLES = 64

/**
 * A smooth open curve through the points (Catmull-Rom, passing through each),
 * resampled to `n` points evenly spaced along it, so the shader can find a
 * place on it from a distance alone.
 */
export function samplePath(points: Point[], n: number): Point[] {
  if (points.length < 2 || n < 2) return points.slice()
  const at = (i: number) => points[Math.max(0, Math.min(points.length - 1, i))]
  const dense: Point[] = []
  for (let i = 0; i < points.length - 1; i++) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)]
    for (let k = 0; k < 16; k++) {
      const t = k / 16
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3)
      dense.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  dense.push(points[points.length - 1])
  const along = [0]
  for (let i = 1; i < dense.length; i++)
    along.push(along[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y))
  const total = along[along.length - 1]
  const out: Point[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (j < dense.length - 2 && along[j + 1] < target) j++
    const span = along[j + 1] - along[j]
    const f = span > 0 ? Math.min(1, Math.max(0, (target - along[j]) / span)) : 0
    out.push({ x: dense[j].x + (dense[j + 1].x - dense[j].x) * f, y: dense[j].y + (dense[j + 1].y - dense[j].y) * f })
  }
  return out
}

/**
 * Signed distance to a shape's outline, in pixels, from its coverage (0..1,
 * antialiased): positive inside, negative outside. Exact Euclidean distance
 * between pixel centres (Felzenszwalb & Huttenlocher's two-pass transform),
 * with the pixels the outline runs through placed by their coverage, so a
 * ramp built from it stays smooth even a few pixels wide. A feather made
 * from it has the same width all round and leaves the inside whole, where a
 * blur thins a small shape out until none of it is at full strength.
 */
export function signedDistance(cover: Float32Array, w: number, h: number): Float32Array {
  const toOutside = squaredDistance(cover, w, h, true)
  const toInside = squaredDistance(cover, w, h, false)
  const out = new Float32Array(w * h)
  for (let k = 0; k < out.length; k++) {
    const c = cover[k]
    if (c > 0.02 && c < 0.98) out[k] = c - 0.5
    else out[k] = c >= 0.5 ? Math.sqrt(toOutside[k]) - 0.5 : 0.5 - Math.sqrt(toInside[k])
  }
  return out
}

const FAR = 1e20

/** Squared distance from each pixel to the nearest one on the other side: outside (`fromInside`) or inside. */
function squaredDistance(cover: Float32Array, w: number, h: number, fromInside: boolean): Float64Array {
  const grid = new Float64Array(w * h)
  for (let k = 0; k < grid.length; k++) grid[k] = cover[k] >= 0.5 === fromInside ? FAR : 0
  const n = Math.max(w, h)
  const f = new Float64Array(n)
  const d = new Float64Array(n)
  const v = new Int32Array(n)
  const z = new Float64Array(n + 1)
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) f[y] = grid[y * w + x]
    lowerEnvelope(f, h, d, v, z)
    for (let y = 0; y < h; y++) grid[y * w + x] = d[y]
  }
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) f[x] = grid[row + x]
    lowerEnvelope(f, w, d, v, z)
    for (let x = 0; x < w; x++) grid[row + x] = d[x]
  }
  return grid
}

/** One line of the distance transform: d[q] = min over p of (q - p)² + f[p]. */
function lowerEnvelope(f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array): void {
  let k = 0
  v[0] = 0
  z[0] = -Infinity
  z[1] = Infinity
  for (let q = 1; q < n; q++) {
    // z[0] is -Infinity, so this stops by the first parabola at the latest.
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = Infinity
  }
  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dq = q - v[k]
    d[q] = dq * dq + f[v[k]]
  }
}

/**
 * A streak in perspective: its vanishing point, its distance from the
 * shape's middle (where a bar is its Band size across) and whether the
 * flow runs toward it (-1) or away (1). See StreakShape.converge.
 */
export interface Vanish {
  x: number
  y: number
  r: number
  g: number
}

/** The most a streak converges: its vanishing point a fifth of the short side from its middle. */
/**
 * Where a mirrored streak's middle line runs through (StreakShape.mirrorAt),
 * fractions of the photo: as placed, or the middle of its outline.
 */
export function streakMirrorAt(shape: { outline: Point[]; mirrorAt?: Point | null }): Point {
  if (shape.mirrorAt) return shape.mirrorAt
  const o = shape.outline
  if (!o.length) return { x: 0.5, y: 0.5 }
  const xs = o.map((p) => p.x)
  const ys = o.map((p) => p.y)
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
}

export const MAX_CONVERGE = 5

/**
 * The vanishing point of a streak converging by `converge`, its outline (in
 * the units the result is in) and flow direction; null when parallel.
 */
export function streakVanish(outline: Point[], dir: Point, converge: number, radialBand = 0, centre?: Point | null): Vanish | null {
  if (!outline.length) return null
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const midX = (Math.min(...xs) + Math.max(...xs)) / 2
  const midY = (Math.min(...ys) + Math.max(...ys)) / 2
  if (radialBand > 0) {
    // Its own middle if placed, else the outline's.
    const cx = centre ? centre.x : midX
    const cy = centre ? centre.y : midY
    // Radial: the point in the middle, the lines spokes out from it. Across
    // them t is the angle times r, so a bar is band wide at r: r is the
    // shape's own reach from the middle, nudged so a whole, even number of
    // bars goes round and the ring closes on a bar's edge, seamless.
    const reach = outline.reduce((sum, p) => sum + Math.hypot(p.x - cx, p.y - cy), 0) / outline.length
    const bars = 2 * Math.max(4, Math.round((Math.PI * Math.max(reach, 1e-3)) / radialBand))
    return { x: cx, y: cy, r: (bars * radialBand) / (2 * Math.PI), g: 1 }
  }
  if (Math.abs(converge) < 1e-4) return null
  const cx = midX
  const cy = midY
  const k = Math.max(-MAX_CONVERGE, Math.min(MAX_CONVERGE, converge))
  const r = 1 / Math.abs(k)
  const g = k > 0 ? -1 : 1
  // Ahead along the flow when converging, behind when spreading.
  return { x: cx - g * dir.x * r, y: cy - g * dir.y * r, r, g }
}

/** How many versions of a path, each smoother than the last, a streak follows each side (see pathFlow). */
export const PATH_LEVELS = 8

/** A point on one of a path's versions, with its unit tangent. */
interface PathSample {
  x: number
  y: number
  tx: number
  ty: number
}

/**
 * A streak's path as its lines follow it. Each line is the path moved
 * sideways, so every bar keeps its width and its length the whole way
 * along, as a straight streak bent round. Where a bend is tighter than the
 * streak reaches on its inside, the lines there have nowhere to go and fold
 * back on themselves into sharp chevrons; so those bends are eased until
 * they are wider than that (see pathFlow) — the curve changes, the streak
 * does not. Measured along the eased path, so lengths along it are true.
 * (Lines further off once followed blurrier versions of the path instead:
 * no folds, but bars widened and narrowed across the streak, a distortion
 * rather than a curve.)
 */
export interface PathFlow {
  /**
   * For each side — rows[0] the lines with t >= 0, rows[1] those below —
   * PATH_LEVELS versions of STREAK_PATH_SAMPLES samples, the shader's layout;
   * all the same path today, eased (see pathFlow).
   */
  rows: PathSample[][][]
  /** How far off the path (|t|) each version takes over, rising from rows[0]'s 0. */
  reach: number[]
  /** Along-the-flow distance between samples. */
  ds: number
  /**
   * A path that keeps heading one way (never turning back more than a
   * right angle off from its start-to-end direction): its lines are copies
   * of it moved straight across that direction, not out along its normal.
   * Copies of such a path never cross, so nothing folds and nothing is
   * eased — every line is the very curve drawn, every bar as long along it.
   * The start-to-end direction, unit.
   */
  sweep: Point | null
}

const withTangents = (pts: Point[]): PathSample[] =>
  pts.map((p, k) => {
    const a = pts[Math.max(k - 1, 0)]
    const b = pts[Math.min(k + 1, pts.length - 1)]
    const l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return { x: p.x, y: p.y, tx: (b.x - a.x) / l, ty: (b.y - a.y) / l }
  })


/** The polyline resampled to n points evenly spaced along it. */
function resample(pts: Point[], n: number): Point[] {
  const along = [0]
  for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const total = along[along.length - 1]
  const out: Point[] = []
  let j = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (j < pts.length - 2 && along[j + 1] < target) j++
    const span = along[j + 1] - along[j]
    const f = span > 0 ? Math.min(1, Math.max(0, (target - along[j]) / span)) : 0
    out.push({ x: pts[j].x + (pts[j + 1].x - pts[j].x) * f, y: pts[j].y + (pts[j + 1].y - pts[j].y) * f })
  }
  return out
}

/**
 * For each sample, how much tighter than radius its bend is toward `side`
 * (1: toward t > 0, the left of the flow's normal; -1 the other way), 0
 * where it is not.
 */
function tooTight(pts: Point[], radius: number, side: number): number[] {
  const out = new Array<number>(pts.length).fill(0)
  for (let k = 1; k < pts.length - 1; k++) {
    const ax = pts[k].x - pts[k - 1].x
    const ay = pts[k].y - pts[k - 1].y
    const bx = pts[k + 1].x - pts[k].x
    const by = pts[k + 1].y - pts[k].y
    // Positive turns toward the normal (-ty, tx): the t > 0 side is inside.
    const turn = Math.atan2(ax * by - ay * bx, ax * bx + ay * by) * side
    if (turn <= 1e-6) continue
    const r = Math.hypot(bx, by) / turn
    if (r < radius) out[k] = 1 - r / radius
  }
  return out
}

/**
 * Eased, ends kept where they are, until no bend toward `side` is tighter
 * than radius: each round smooths round the bends that are, spread a few
 * samples either way so the eased stretch blends into the rest, and the
 * rest of the curve stays as drawn.
 */
function easeToward(pts: Point[], radius: number, side: number): Point[] {
  let p = pts
  for (let it = 0; it < 800; it++) {
    const tight = tooTight(p, radius, side)
    if (!tight.some((v) => v > 0)) break
    const w = tight.map((_, k) => {
      let m = 0
      for (let j = -4; j <= 4; j++) m = Math.max(m, (tight[k + j] ?? 0) > 0 ? 1 - Math.abs(j) / 5 : 0)
      return m
    })
    const q = p.map((v, k) =>
      k === 0 || k === p.length - 1
        ? v
        : { x: v.x + 0.5 * w[k] * ((p[k - 1].x + p[k + 1].x) / 2 - v.x), y: v.y + 0.5 * w[k] * ((p[k - 1].y + p[k + 1].y) / 2 - v.y) },
    )
    // Evenly spaced again, so a distance along the path is a true one.
    p = resample(q, pts.length)
  }
  return p
}

/** Which versions (a and the next, f of the way) a line |t| off the path follows. */
function levelAt(flow: PathFlow, d: number): { a: number; f: number } {
  for (let k = 1; k < PATH_LEVELS; k++)
    if (d <= flow.reach[k]) return { a: k - 1, f: Math.min(1, Math.max(0, (d - flow.reach[k - 1]) / Math.max(flow.reach[k] - flow.reach[k - 1], 1e-6))) }
  return { a: PATH_LEVELS - 1, f: 0 }
}

/** Sample k of the path on `side` (0: t >= 0, 1: below) between versions a and a + 1. */
function pathAt(flow: PathFlow, side: number, a: number, f: number, k: number): PathSample {
  const p = flow.rows[side][a][k]
  if (f <= 0) return p
  const q = flow.rows[side][Math.min(a + 1, PATH_LEVELS - 1)][k]
  const tx = p.tx + (q.tx - p.tx) * f
  const ty = p.ty + (q.ty - p.ty) * f
  const l = Math.hypot(tx, ty) || 1
  return { x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f, tx: tx / l, ty: ty / l }
}

/**
 * The (s, t) of the line through q, on the path between versions a and
 * a + 1, looking at its samples j0..j1: the exact reverse of pathPos. Within
 * a segment the line goes out from the path along a normal blended between
 * the segment's ends; q is on it where the vector from the path to q is
 * parallel to that normal, a quadratic in the position along the segment.
 */
function projectPath(
  flow: PathFlow,
  side: number,
  a: number,
  f: number,
  q: Point,
  j0: number,
  j1: number,
): { s: number; t: number; found: boolean; other: { s: number; t: number } | null } {
  const n = flow.rows[0][0].length
  // The best answer from another part of the path, too: between two arms
  // of a winding path a point is reached from either.
  let second: { s: number; t: number } | null = null
  const ds = flow.ds
  const cross = (u: Point, v: Point) => u.x * v.y - u.y * v.x
  let best = Infinity
  let out = { s: 0, t: 0 }
  if (j0 === 0) {
    const p = pathAt(flow, side, a, f, 0)
    const dx = q.x - p.x
    const dy = q.y - p.y
    if (dx * p.tx + dy * p.ty < 0) {
      out = { s: dx * p.tx + dy * p.ty, t: -dx * p.ty + dy * p.tx }
      best = Math.abs(out.t)
    }
  }
  if (j1 === n - 1) {
    const p = pathAt(flow, side, a, f, n - 1)
    const dx = q.x - p.x
    const dy = q.y - p.y
    const t = -dx * p.ty + dy * p.tx
    if (dx * p.tx + dy * p.ty > 0 && Math.abs(t) < best) {
      out = { s: (n - 1) * ds + dx * p.tx + dy * p.ty, t }
      best = Math.abs(t)
    }
  }
  let pa = pathAt(flow, side, a, f, j0)
  for (let j = j0; j < j1; j++) {
    const pb = pathAt(flow, side, a, f, j + 1)
    const ab = { x: pb.x - pa.x, y: pb.y - pa.y }
    const n0 = { x: -pa.ty, y: pa.tx }
    const dn = { x: -pb.ty - n0.x, y: pb.tx - n0.y }
    const d = { x: q.x - pa.x, y: q.y - pa.y }
    const c2 = -cross(ab, dn)
    const c1 = cross(d, dn) - cross(ab, n0)
    const c0 = cross(d, n0)
    const roots: number[] = []
    if (Math.abs(c2) < 1e-7) {
      if (Math.abs(c1) > 1e-9) roots.push(-c0 / c1)
    } else {
      const disc = c1 * c1 - 4 * c2 * c0
      if (disc >= 0) {
        const h = -0.5 * (c1 + (c1 < 0 ? -1 : 1) * Math.sqrt(disc))
        roots.push(h / c2)
        if (Math.abs(h) > 1e-12) roots.push(c0 / h)
      }
    }
    for (let g of roots) {
      if (g < -1e-4 || g > 1.0001) continue
      g = Math.min(1, Math.max(0, g))
      const nx = n0.x + dn.x * g
      const ny = n0.y + dn.y * g
      const nl = Math.hypot(nx, ny) || 1
      const t = ((d.x - ab.x * g) * nx + (d.y - ab.y * g) * ny) / nl
      const c = { s: (j + g) * ds, t }
      // The best two, the second from another arm: kept as they come, as
      // the shader keeps them.
      if (Math.abs(t) < best) {
        if (best < Infinity && Math.abs(out.s - c.s) > OTHER_ARM * ds) second = out
        else if (second && Math.abs(second.s - c.s) <= OTHER_ARM * ds) second = null
        best = Math.abs(t)
        out = c
      } else if (Math.abs(out.s - c.s) > OTHER_ARM * ds && (!second || Math.abs(t) < Math.abs(second.t))) second = c
    }
    pa = pb
  }
  return { ...out, found: best < Infinity, other: second }
}

/** How many samples apart along the path two answers must be to be from different arms of it. */
export const OTHER_ARM = 8

/** Newton steps from the drawn path's answer to a point's line on its versions. */
export const PATH_NEWTON = 6
/** The step for the Newton steps' slopes, short-side units. */
export const PATH_NEWTON_STEP = 5e-4

/**
 * The (s, t) whose line passes through q: found on the drawn path, then by
 * Newton's method on pathPos itself — the lines as drawn, on whichever
 * versions their distance picks — so it is the exact reverse of pathPos
 * wherever no line folds. (Re-finding the line on the version the last
 * guess's distance picked, over and over, did not settle where nearby
 * versions differed much, and the lines came out wavy and looped.)
 */
function pathCoords(flow: PathFlow, q: Point): { s: number; t: number } {
  if (flow.sweep) return sweepCoords(flow, flow.sweep, q)
  const n = flow.rows[0][0].length
  const first = projectPath(flow, 0, 0, 0, q, 0, n - 1)
  // From the nearest arm, and from the next nearest: of what each settles
  // on, the line nearer its path. (From one guess only, which arm a point
  // went to switched along a seam right across the flow.)
  const a = newton(flow, q, first.s, first.t)
  if (!first.other) return a
  const b = newton(flow, q, first.other.s, first.other.t)
  const fits = (r: { s: number; t: number }) => {
    const p = pathPos(flow, r.s, r.t)
    return Math.hypot(p.x - q.x, p.y - q.y) < 1e-4
  }
  if (fits(b) && (!fits(a) || Math.abs(b.t) < Math.abs(a.t))) return b
  return a
}

function newton(flow: PathFlow, q: Point, s: number, t: number): { s: number; t: number } {
  const h = PATH_NEWTON_STEP
  for (let it = 0; it < PATH_NEWTON; it++) {
    const p = pathPos(flow, s, t)
    const rx = p.x - q.x
    const ry = p.y - q.y
    if (rx * rx + ry * ry < 1e-14) break
    const ps = pathPos(flow, s + h, t)
    const pt = pathPos(flow, s, t + h)
    const a = (ps.x - p.x) / h
    const b = (pt.x - p.x) / h
    const c = (ps.y - p.y) / h
    const d = (pt.y - p.y) / h
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) break
    let du = -(d * rx - b * ry) / det
    let dv = -(-c * rx + a * ry) / det
    // A step no longer than the photo, so a poor guess cannot fly off.
    const len = Math.hypot(du, dv)
    if (len > 0.5) {
      du *= 0.5 / len
      dv *= 0.5 / len
    }
    s += du
    t += dv
  }
  return { s, t }
}

function pathPos(flow: PathFlow, s: number, t: number): Point {
  if (flow.sweep) return sweepPos(flow, flow.sweep, s, t)
  const n = flow.rows[0][0].length
  const { a, f } = levelAt(flow, Math.abs(t))
  const side = t >= 0 ? 0 : 1
  const x = s / flow.ds
  if (x <= 0) {
    const p = pathAt(flow, side, a, f, 0)
    return { x: p.x + p.tx * s - p.ty * t, y: p.y + p.ty * s + p.tx * t }
  }
  if (x >= n - 1) {
    const p = pathAt(flow, side, a, f, n - 1)
    const e = s - (n - 1) * flow.ds
    return { x: p.x + p.tx * e - p.ty * t, y: p.y + p.ty * e + p.tx * t }
  }
  const k = Math.floor(x)
  const g = x - k
  const p0 = pathAt(flow, side, a, f, k)
  const p1 = pathAt(flow, side, a, f, k + 1)
  let tx = p0.tx + (p1.tx - p0.tx) * g
  let ty = p0.ty + (p1.ty - p0.ty) * g
  const l = Math.hypot(tx, ty) || 1
  tx /= l
  ty /= l
  return { x: p0.x + (p1.x - p0.x) * g - ty * t, y: p0.y + (p1.y - p0.y) * g + tx * t }
}

/**
 * The way a swept path's copies are lined up along it: square to the colour
 * edge where the path starts (the outline's side nearest its first point),
 * so the copies are the path slid along that edge. Each line then starts at
 * the same place on the edge, and keeps its colour, however the curve is
 * reshaped; lined up by the start-to-end direction, as before, every edit
 * that moved the end slid them along another way and recoloured them all.
 * The start-to-end direction where there is no outline, or its nearest side
 * runs too nearly along the flow to slide along.
 */
export function sweepAxis(pts: Point[], outline: Point[] | undefined): Point | null {
  const n = pts.length
  const dx = pts[n - 1].x - pts[0].x
  const dy = pts[n - 1].y - pts[0].y
  const l = Math.hypot(dx, dy)
  if (l < 1e-6) return null
  const flow = { x: dx / l, y: dy / l }
  if (!outline || outline.length < 2) return flow
  const p = pts[0]
  let best = Infinity
  let edge: Point | null = null
  for (let k = 0; k < outline.length; k++) {
    const a = outline[k]
    const b = outline[(k + 1) % outline.length]
    const ex = b.x - a.x
    const ey = b.y - a.y
    const len2 = ex * ex + ey * ey
    if (len2 < 1e-12) continue
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / len2))
    const dist = Math.hypot(a.x + ex * u - p.x, a.y + ey * u - p.y)
    if (dist < best) {
      best = dist
      const el = Math.sqrt(len2)
      edge = { x: ex / el, y: ey / el }
    }
  }
  if (!edge || Math.abs(edge.x * flow.x + edge.y * flow.y) > Math.cos((60 * Math.PI) / 180)) return flow
  // Square to the edge, heading the way the path does.
  const d = { x: edge.y, y: -edge.x }
  return d.x * flow.x + d.y * flow.y >= 0 ? d : { x: -d.x, y: -d.y }
}

/**
 * The direction a path's copies are lined up along (see sweepAxis), if every
 * step along it heads that way (within SWEEP_TURN of it), so copies moved
 * across it never cross; else null.
 */
export function sweepOf(pts: Point[], outline?: Point[]): Point | null {
  const n = pts.length
  const d = sweepAxis(pts, outline)
  if (!d) return null
  for (let k = 1; k < n; k++) {
    const sx = pts[k].x - pts[k - 1].x
    const sy = pts[k].y - pts[k - 1].y
    if (sx * d.x + sy * d.y <= Math.cos(SWEEP_TURN) * Math.hypot(sx, sy)) return null
  }
  return d
}

/**
 * A true circle round an outline's middle (the middle of its bounds, as a
 * radial streak's point is), radius in the same units: a radial streak's
 * shape, so the edge its spokes read need not be traced exactly.
 */
export function radialCircle(outline: Point[], radius: number, centre?: Point | null, n = 96): Point[] {
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const cx = centre ? centre.x : (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = centre ? centre.y : (Math.min(...ys) + Math.max(...ys)) / 2
  return Array.from({ length: n }, (_, k) => {
    const a = (k / n) * Math.PI * 2
    return { x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) }
  })
}

/** The most a swept path may turn off its start-to-end direction: 75°. */
export const SWEEP_TURN = (75 * Math.PI) / 180

/**
 * A swept path's (s, t) for q: where along the start-to-end direction q is
 * picks the place on the path (they rise together), t is how far q is from
 * it straight across. Past either end the path carries on along its end.
 */
function sweepCoords(flow: PathFlow, d: Point, q: Point): { s: number; t: number } {
  const row = flow.rows[0][0]
  const n = row.length
  const p0 = row[0]
  const along = (p: Point) => (p.x - p0.x) * d.x + (p.y - p0.y) * d.y
  const a = along(q)
  const crossOf = (p: Point) => -(q.x - p.x) * d.y + (q.y - p.y) * d.x
  if (a <= 0) {
    const e = a / (row[0].tx * d.x + row[0].ty * d.y)
    return { s: e, t: crossOf({ x: p0.x + row[0].tx * e, y: p0.y + row[0].ty * e }) }
  }
  const end = row[n - 1]
  const aEnd = along(end)
  if (a >= aEnd) {
    const e = (a - aEnd) / (end.tx * d.x + end.ty * d.y)
    return { s: (n - 1) * flow.ds + e, t: crossOf({ x: end.x + end.tx * e, y: end.y + end.ty * e }) }
  }
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (along(row[mid]) <= a) lo = mid
    else hi = mid
  }
  const a0 = along(row[lo])
  const g = (a - a0) / Math.max(along(row[hi]) - a0, 1e-12)
  const p = { x: row[lo].x + (row[hi].x - row[lo].x) * g, y: row[lo].y + (row[hi].y - row[lo].y) * g }
  return { s: (lo + g) * flow.ds, t: crossOf(p) }
}

function sweepPos(flow: PathFlow, d: Point, s: number, t: number): Point {
  const row = flow.rows[0][0]
  const n = row.length
  const x = s / flow.ds
  let p: Point
  if (x <= 0) p = { x: row[0].x + row[0].tx * s, y: row[0].y + row[0].ty * s }
  else if (x >= n - 1) {
    const e = s - (n - 1) * flow.ds
    p = { x: row[n - 1].x + row[n - 1].tx * e, y: row[n - 1].y + row[n - 1].ty * e }
  } else {
    const k = Math.floor(x)
    const g = x - k
    p = { x: row[k].x + (row[k + 1].x - row[k].x) * g, y: row[k].y + (row[k + 1].y - row[k].y) * g }
  }
  return { x: p.x - d.y * t, y: p.y + d.x * t }
}

/**
 * A streak's path as its lines follow it (see PathFlow), from the points
 * drawn and the shape's outline (both in the streak's units): how far the
 * shape reaches from the path sets how smooth the furthest version is.
 * Null for a path too short to follow.
 */
export function pathFlow(
  points: Point[],
  outline: Point[],
  ease = 1,
  canSweep = true,
  n = STREAK_PATH_SAMPLES,
): PathFlow | null {
  if (points.length < 2) return null
  let path = samplePath(points, n)
  if (Math.hypot(path[1].x - path[0].x, path[1].y - path[0].y) < 1e-5) return null
  const flow = (pts: Point[]): PathFlow => {
    const row = withTangents(pts)
    const ds = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)
    return { rows: [0, 1].map(() => Array.from({ length: PATH_LEVELS }, () => row)), reach: Array.from({ length: PATH_LEVELS }, (_, k) => k), ds, sweep: null }
  }
  const across = canSweep ? sweepOf(path, outline) : null
  if (across) return { ...flow(path), sweep: across }
  // How far the shape reaches either side of the path, its sides sampled along.
  const reaches = (f: PathFlow) => {
    let left = 0
    let right = 0
    outline.forEach((p, k) => {
      const q = outline[(k + 1) % outline.length]
      for (let m = 0; m < 8; m++) {
        const at = { x: p.x + ((q.x - p.x) * m) / 8, y: p.y + ((q.y - p.y) * m) / 8 }
        const t = projectPath(f, 0, 0, 0, at, 0, n - 1).t
        if (t > 0) left = Math.max(left, t)
        else right = Math.max(right, -t)
      }
    })
    return [left, right]
  }
  // Each line is the path moved sideways, so every bar keeps its width and
  // length the whole way along. A bend tighter than the streak reaches on
  // its inside would fold the lines there, so those bends — and only those
  // — are eased until they are wider than that; the rest stays as drawn.
  // Easing moves the path, so how far the shape reaches is measured again.
  for (let round = 0; round < 3; round++) {
    const [left, right] = reaches(flow(path))
    // At ease 1 wide enough that nothing folds; less, closer to the curve as drawn.
    const eased = easeToward(easeToward(path, left * 1.1 * ease, 1), right * 1.1 * ease, -1)
    const moved = eased.some((p, k) => Math.hypot(p.x - path[k].x, p.y - path[k].y) > 1e-6)
    path = eased
    if (!moved) break
  }
  return flow(path)
}

/**
 * A streak's own coordinates for point q, as the shader's streakCoords finds
 * them: s with the flow, t across it. Straight streaks run along `dir`; with
 * a path the lines follow it (see PathFlow); with `vanish` they run through
 * its point, s the distance along them and t the angle round it, as a
 * distance at the shape's middle. All in the same units as q.
 */
export function streakCoords(q: Point, dir: Point, path: PathFlow | null, vanish: Vanish | null = null): { s: number; t: number } {
  if (path) return pathCoords(path, q)
  if (vanish) {
    // The lines' middle direction, out from the point: e = g dir.
    const ex = vanish.g * dir.x
    const ey = vanish.g * dir.y
    const dx = q.x - vanish.x
    const dy = q.y - vanish.y
    const theta = Math.atan2(ex * dy - ey * dx, ex * dx + ey * dy)
    return { s: vanish.g * Math.hypot(dx, dy), t: vanish.g * vanish.r * theta }
  }
  return { s: q.x * dir.x + q.y * dir.y, t: -q.x * dir.y + q.y * dir.x }
}

/** The inverse, for drawing: the point at (s, t). */
export function streakPos(s: number, t: number, dir: Point, path: PathFlow | null, vanish: Vanish | null = null): Point {
  if (path) return pathPos(path, s, t)
  if (vanish) {
    const ex = vanish.g * dir.x
    const ey = vanish.g * dir.y
    const r = vanish.g * s
    const theta = (vanish.g * t) / vanish.r
    const c = Math.cos(theta)
    const n = Math.sin(theta)
    return { x: vanish.x + r * (ex * c - ey * n), y: vanish.y + r * (ey * c + ex * n) }
  }
  return { x: dir.x * s - dir.y * t, y: dir.y * s + dir.x * t }
}

/**
 * The bars a fix covers, as the shader picks them: those whose centre is in
 * its span [lo, hi] across the flow (at least one), from `first` to `past`.
 * Its feather straddles those two sides, so the bars it touches at all run
 * from `outer0` to `outer1`; colours borrowed from beside it come from
 * past those. All in short-side units.
 */
export function fixBarRange(lo: number, hi: number, band: number, feather: number) {
  let k0 = Math.ceil(lo / band - 0.5)
  let k1 = Math.floor(hi / band - 0.5)
  if (k0 > k1) k0 = k1 = Math.floor((lo + hi) / 2 / band)
  const first = k0 * band
  const past = (k1 + 1) * band
  const outer0 = Math.floor((first - feather / 2) / band + 1e-6) * band
  const outer1 = Math.ceil((past + feather / 2) / band - 1e-6) * band
  return { first, past, outer0, outer1 }
}

/** Samples of a trail's end line across it (see StreakShape.ends). */
export const END_SAMPLES = 32

/**
 * A trail's end line as the shader reads it: for evenly spaced lines across
 * the streak, from t0 to t1, how far along (s) each meets the drawn line.
 * `ends` is the line in streak coordinates (see streakCoords). Lines past
 * either end of it take its nearer end's s, so it carries on level.
 */
export function endTable(ends: { s: number; t: number }[], t0: number, t1: number, n = END_SAMPLES): Float32Array {
  const out = new Float32Array(n)
  const lo = ends.reduce((a, b) => (b.t < a.t ? b : a))
  const hi = ends.reduce((a, b) => (b.t > a.t ? b : a))
  for (let k = 0; k < n; k++) {
    const t = t0 + ((t1 - t0) * k) / Math.max(1, n - 1)
    let s: number | null = null
    for (let j = 0; j < ends.length - 1 && s === null; j++) {
      const a = ends[j]
      const b = ends[j + 1]
      if ((t - a.t) * (t - b.t) > 0) continue
      const f = Math.abs(b.t - a.t) < 1e-9 ? 0 : (t - a.t) / (b.t - a.t)
      s = a.s + (b.s - a.s) * f
    }
    out[k] = s ?? (t < lo.t ? lo.s : hi.s)
  }
  return out
}
