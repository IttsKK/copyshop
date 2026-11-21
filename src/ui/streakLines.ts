import { dominantMeeting, findLines, streakPerspective, type Pt } from '../engine/perspective'
import { streakCoords, streakPos, streakVanish } from '../engine/streaks'
import type { Rect, StreakGuide, StreakShape } from '../engine/types'
import { unbend, type LensBend } from '../engine/lensBend'

/** Where streak shapes and bars are measured: the frame their points are fractions of, and the short-side unit (print px). */
export interface StreakSpace {
  frame: Rect
  measure: { x: number; y: number; unit: number }
}

const toShort = (p: Pt, s: StreakSpace): Pt => ({
  x: (s.frame.x + p.x * s.frame.width - s.measure.x) / s.measure.unit,
  y: (s.frame.y + p.y * s.frame.height - s.measure.y) / s.measure.unit,
})

/** The lens frame (lensBend.ts) for the photo: its middle and half-diagonal, in short-side units. */
export function lensFrameOf(space: StreakSpace, photoFrame: Rect): Omit<LensBend, 'k'> {
  return {
    cx: (photoFrame.x + photoFrame.width / 2 - space.measure.x) / space.measure.unit,
    cy: (photoFrame.y + photoFrame.height / 2 - space.measure.y) / space.measure.unit,
    R: Math.hypot(photoFrame.width, photoFrame.height) / 2 / space.measure.unit,
  }
}

/** A guide's points, end to end: the ones placed along it, or its two ends. */
export const guidePoints = (g: StreakGuide) => (g.points && g.points.length >= 2 ? g.points : [g.a, g.b])

/** The straight line through some points (their long axis), end to end over them, and how far off it they lie (mean square). */
function lineThrough(pts: Pt[]): { a: Pt; b: Pt; off: number; span: number } {
  const n = pts.length
  const mx = pts.reduce((t, p) => t + p.x, 0) / n
  const my = pts.reduce((t, p) => t + p.y, 0) / n
  let sxx = 0
  let sxy = 0
  let syy = 0
  for (const p of pts) {
    sxx += (p.x - mx) ** 2
    sxy += (p.x - mx) * (p.y - my)
    syy += (p.y - my) ** 2
  }
  const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(phi)
  const uy = Math.sin(phi)
  let lo = Infinity
  let hi = -Infinity
  let off = 0
  for (const p of pts) {
    const t = (p.x - mx) * ux + (p.y - my) * uy
    const d = -(p.x - mx) * uy + (p.y - my) * ux
    lo = Math.min(lo, t)
    hi = Math.max(hi, t)
    off += d * d
  }
  return { a: { x: mx + ux * lo, y: my + uy * lo }, b: { x: mx + ux * hi, y: my + uy * hi }, off: off / n, span: hi - lo }
}

/** How much a lens usually bends (LensBend.k): the measured bend is held near this unless the guides clearly show more. */
const BEND_TYPICAL = 0.02

/**
 * A streak's angle, perspective and lens bend from its guides, or null while
 * it has fewer than two. Guides with three or more points show how the lens
 * bends straight lines: the bend is the one that makes them straightest; the
 * perspective is then where they meet, straightened. With none, no bend.
 */
export function perspectiveFromGuides(
  shape: StreakShape,
  guides: StreakGuide[],
  space: StreakSpace,
  photoFrame?: Rect,
): Pick<StreakShape, 'angle' | 'converge' | 'bend'> | null {
  if (guides.length < 2 || !shape.outline.length) return null
  const lens = photoFrame ? lensFrameOf(space, photoFrame) : null
  const polys = guides.map((g) => guidePoints(g).map((p) => toShort(p, space)))
  const curved = polys.filter((p) => p.length >= 3)
  let k = 0
  if (lens && curved.length && photoFrame) {
    // How far the guides' points stray from straight lines, against how far
    // a point placed on an edge strays anyway (snapped to a pixel of a
    // 1600-pixel picture, and edges are never quite clean). Near the middle
    // of the frame a lens bends lines very little, so a bend measured there
    // is only worth what the guides show past that wobble: half a pixel of
    // it is not a bend, and taken as one it swung the streaks far out at the
    // frame's edges. And lenses seldom bend much (BEND_TYPICAL).
    const wobble = (0.75 * Math.max(photoFrame.width, photoFrame.height)) / 1600 / space.measure.unit
    const cost = (kk: number) =>
      curved.reduce((t, pts) => t + lineThrough(pts.map((p) => unbend(p, { k: kk, ...lens }))).off * pts.length, 0) / (wobble * wobble) +
      (kk / BEND_TYPICAL) ** 2
    let best = 0
    let bestCost = cost(0)
    for (let kk = -0.3; kk <= 0.3001; kk += 0.01) {
      const c = cost(kk)
      if (c < bestCost) {
        best = kk
        bestCost = c
      }
    }
    for (let kk = best - 0.01; kk <= best + 0.01; kk += 0.0005) {
      const c = cost(kk)
      if (c < bestCost) {
        best = kk
        bestCost = c
      }
    }
    k = Math.round(best * 1000) / 1000
  }
  const lb = lens && k !== 0 ? { k, ...lens } : null
  const lines = polys.map((pts) => lineThrough(pts.map((p) => unbend(p, lb))))
  const outline = shape.outline.map((p) => unbend(toShort(p, space), lb))
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
  const rad = (shape.angle * Math.PI) / 180
  const got = streakPerspective(lines, centre, { x: Math.cos(rad), y: Math.sin(rad) })
  return got ? { angle: Math.round(got.angle * 100) / 100, converge: Math.round(got.converge * 1000) / 1000, bend: k } : null
}

const snapCache = new WeakMap<ImageBitmap, { w: number; h: number; mag: Float32Array }>()

/**
 * A point placed on the photo, moved onto the strongest edge within a few
 * pixels of it (nearer ones winning ties), so a guide's points sit on the
 * edge itself. Frame fractions in and out.
 */
export function snapToEdge(bitmap: ImageBitmap, p: Pt, space: StreakSpace, photoFrame: Rect, radius = 7): Pt {
  let g = snapCache.get(bitmap)
  if (!g) {
    const LONG = 1600
    const k = Math.min(1, LONG / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(16, Math.round(bitmap.width * k))
    const h = Math.max(16, Math.round(bitmap.height * k))
    const c = new OffscreenCanvas(w, h)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, w, h)
    const px = ctx.getImageData(0, 0, w, h).data
    const grey = new Float32Array(w * h)
    for (let i = 0; i < grey.length; i++) grey[i] = 0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]
    const mag = new Float32Array(w * h)
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x
        const gx = grey[i - w + 1] + 2 * grey[i + 1] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - 1] - grey[i + w - 1]
        const gy = grey[i + w - 1] + 2 * grey[i + w] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - w] - grey[i - w + 1]
        mag[i] = Math.hypot(gx, gy)
      }
    g = { w, h, mag }
    snapCache.set(bitmap, g)
  }
  const gx = ((space.frame.x + p.x * space.frame.width - photoFrame.x) / photoFrame.width) * g.w
  const gy = ((space.frame.y + p.y * space.frame.height - photoFrame.y) / photoFrame.height) * g.h
  let best = { x: gx, y: gy, score: 0 }
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      const d = Math.hypot(dx, dy)
      if (d > radius) continue
      const x = Math.round(gx + dx)
      const y = Math.round(gy + dy)
      if (x < 1 || y < 1 || x >= g.w - 1 || y >= g.h - 1) continue
      const score = g.mag[y * g.w + x] * (1 - (0.5 * d) / (radius + 1))
      if (score > best.score) best = { x, y, score }
    }
  return {
    x: ((best.x / g.w) * photoFrame.width + photoFrame.x - space.frame.x) / space.frame.width,
    y: ((best.y / g.h) * photoFrame.height + photoFrame.y - space.frame.y) / space.frame.height,
  }
}

/**
 * The photo's own straight lines the streak should follow, found round its
 * shape: the strongest that run near its direction and meet at one point
 * (a building's sides and window columns, shot from below), a few of them
 * kept, spread apart, as the streak's guides. Null when nothing clear is
 * there. `photoFrame` is where the photo sits in the print.
 */
export function matchStreakLines(bitmap: ImageBitmap, shape: StreakShape, space: StreakSpace, photoFrame: Rect): { guides: StreakGuide[] } & Pick<StreakShape, 'angle' | 'converge' | 'bend'> | null {
  const LONG = 900
  const k = Math.min(1, LONG / Math.max(bitmap.width, bitmap.height))
  const gw = Math.max(16, Math.round(bitmap.width * k))
  const gh = Math.max(16, Math.round(bitmap.height * k))
  const c = new OffscreenCanvas(gw, gh)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, gw, gh)
  const px = ctx.getImageData(0, 0, gw, gh).data
  const grey = new Float32Array(gw * gh)
  for (let i = 0; i < grey.length; i++) grey[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255
  // Frame fractions to the grey picture's pixels, and back.
  const sx = (gw / photoFrame.width)
  const sy = (gh / photoFrame.height)
  const toGrey = (p: Pt) => ({ x: (space.frame.x + p.x * space.frame.width - photoFrame.x) * sx, y: (space.frame.y + p.y * space.frame.height - photoFrame.y) * sy })
  const fromGrey = (p: Pt) => ({ x: (p.x / sx + photoFrame.x - space.frame.x) / space.frame.width, y: (p.y / sy + photoFrame.y - space.frame.y) / space.frame.height })
  const outline = shape.outline.map(toGrey)
  if (!outline.length) return null
  const xs = outline.map((p) => p.x)
  const ys = outline.map((p) => p.y)
  const bw = Math.max(...xs) - Math.min(...xs)
  const bh = Math.max(...ys) - Math.min(...ys)
  // Round the shape, half its size out each way: the subject's lines carry on
  // past it, but measured further off a lens's bending tilts them.
  const reach = Math.max(bw, bh) * 0.15
  const box = { x0: Math.min(...xs) - reach, y0: Math.min(...ys) - reach, x1: Math.max(...xs) + reach, y1: Math.max(...ys) + reach }
  // Only lines that, carried on, run into the shape: the streak carries the
  // subject's lines on, and a pole or a tree beside it is not one of them.
  const pad = Math.max(bw, bh) * 0.04
  const sx0 = Math.min(...xs) - pad
  const sx1 = Math.max(...xs) + pad
  const sy0 = Math.min(...ys) - pad
  const sy1 = Math.max(...ys) + pad
  const meetsShape = (l: { a: Pt; b: Pt }) => {
    const nx = -(l.b.y - l.a.y)
    const ny = l.b.x - l.a.x
    const side = (x: number, y: number) => Math.sign(nx * (x - l.a.x) + ny * (y - l.a.y))
    const s4 = [side(sx0, sy0), side(sx1, sy0), side(sx0, sy1), side(sx1, sy1)]
    return s4.some((v) => v !== s4[0]) || s4[0] === 0
  }
  // How far a line passes from the shape's middle, across the flow; and how
  // far the shape itself reaches that way. A line further out than the shape
  // is beside the subject, not on it.
  const mid = { x: (sx0 + sx1) / 2, y: (sy0 + sy1) / 2 }
  const across = (l: { a: Pt; b: Pt }) => {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const len = Math.hypot(dx, dy)
    return ((mid.x - l.a.x) * -dy + (mid.y - l.a.y) * dx) / len
  }
  const rad = (shape.angle * Math.PI) / 180
  // Carried on both ways, the line passes through the shape itself (a hair's
  // room either side), not just near its corners.
  const inside = (x: number, y: number) => {
    let hit = false
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const p = outline[i]
      const q = outline[j]
      if (p.y > y !== q.y > y && x < ((q.x - p.x) * (y - p.y)) / (q.y - p.y) + p.x) hit = !hit
    }
    return hit
  }
  const tol = Math.max(bw, bh) * 0.015
  const throughShape = (l: { a: Pt; b: Pt }) => {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const len = Math.hypot(dx, dy)
    const ux = dx / len
    const uy = dy / len
    // From where it passes the shape's middle, out a shape's size each way.
    const t0 = (mid.x - l.a.x) * ux + (mid.y - l.a.y) * uy
    const span = Math.max(bw, bh)
    for (let k = -60; k <= 60; k++) {
      const t = t0 + (span * k) / 60
      const x = l.a.x + ux * t
      const y = l.a.y + uy * t
      if (inside(x, y) || inside(x - uy * tol, y + ux * tol) || inside(x + uy * tol, y - ux * tol)) return true
    }
    return false
  }
  const lines = findLines(grey, gw, gh, box, rad, (20 * Math.PI) / 180).filter((l) => meetsShape(l) && throughShape(l))
  const found = dominantMeeting(lines)
  if (!found || found.inliers.length < 2) return null
  // A few guides, strongest first, spread across the shape so each one
  // counts: two pieces of one edge are one guide. Lines are told apart by
  // where they pass the shape's middle.
  const chosen: typeof found.inliers = []
  const gap = Math.max(bw, bh) * 0.1
  for (const l of found.inliers) {
    const at = across(l)
    if (chosen.some((q) => Math.abs(Math.abs(across(q)) - Math.abs(at)) < gap && Math.sign(across(q)) === Math.sign(at))) continue
    chosen.push(l)
    if (chosen.length >= 4) break
  }
  if (chosen.length < 2) return null
  // Each followed along its length, a few points snapped onto the edge
  // itself, so a lens's bend shows and is fitted too.
  const guides = chosen.map((l) => {
    const a = fromGrey(l.a)
    const b = fromGrey(l.b)
    const points = [0, 0.25, 0.5, 0.75, 1].map((f) => snapToEdge(bitmap, { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }, space, photoFrame, 3))
    return { a: points[0], b: points[4], points }
  })
  const got = perspectiveFromGuides(shape, guides, space, photoFrame)
  return got ? { guides, ...got } : null
}

/**
 * The length a streak's Repeat copies should be to follow the subject's own
 * rhythm (a building's floors): the photo is read along the streak's lines,
 * back from where each leaves the shape into the subject — in perspective
 * evenly in one over the distance to the point, as the copies are laid out —
 * and the shortest spacing at which it repeats strongly is the length, in
 * short-side units at the edge.
 *
 * In perspective, the floors need not shrink toward the streak's own point:
 * a building that tapers, or a lens, puts its sides' meeting point (which
 * the streak's lines follow) further off or nearer than the floors'. So the
 * copies' own point is found too (vanish: how far it is moved along the
 * lines, a share of the streak's distance to its point, 0 the same): the
 * one at which the floors repeat most evenly. Null when nothing repeats
 * clearly.
 */
export function fitRepeatLength(
  bitmap: ImageBitmap,
  shape: StreakShape,
  space: StreakSpace,
  photoFrame: Rect,
  /** Each perspective tried: its share, the spacing found (samples), how strongly it repeats and how well floors further in line up (the streak lab). */
  report?: (vanish: number, lag: number, score: number, deep: number) => void,
): { length: number; vanish: number } | null {
  const LONG = 1400
  const k = Math.min(1, LONG / Math.max(bitmap.width, bitmap.height))
  const gw = Math.max(16, Math.round(bitmap.width * k))
  const gh = Math.max(16, Math.round(bitmap.height * k))
  const c = new OffscreenCanvas(gw, gh)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, gw, gh)
  const px = ctx.getImageData(0, 0, gw, gh).data
  const lum = (x: number, y: number) => {
    const xi = Math.min(gw - 1, Math.max(0, Math.round(x)))
    const yi = Math.min(gh - 1, Math.max(0, Math.round(y)))
    const i = (yi * gw + xi) * 4
    return 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
  }
  // Short-side units to the grey picture's pixels.
  const toGrey = (q: Pt) => ({
    x: ((q.x * space.measure.unit + space.measure.x - photoFrame.x) * gw) / photoFrame.width,
    y: ((q.y * space.measure.unit + space.measure.y - photoFrame.y) * gh) / photoFrame.height,
  })
  const pxPerUnit = (space.measure.unit * gw) / photoFrame.width
  const outline = shape.outline.map((p) => toShort(p, space))
  if (outline.length < 3) return null
  const rad = (shape.angle * Math.PI) / 180
  const dir = { x: Math.cos(rad), y: Math.sin(rad) }
  const vanish = streakVanish(outline, dir, shape.converge ?? 0)
  const inside = (q: Pt) => {
    let hit = false
    for (let i = 0, j = outline.length - 1; i < outline.length; j = i++) {
      const a = outline[i]
      const b = outline[j]
      if (a.y > q.y !== b.y > q.y && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit
    }
    return hit
  }
  const st = outline.map((p) => streakCoords(p, dir, null, vanish))
  const s0 = Math.min(...st.map((c) => c.s))
  const s1 = Math.max(...st.map((c) => c.s))
  const t0 = Math.min(...st.map((c) => c.t))
  const t1 = Math.max(...st.map((c) => c.t))
  const step = 1 / pxPerUnit // a pixel, in short-side units
  const reach = 0.3 // how far into the subject to read
  const samples = Math.round(reach / step)
  // Where each line leaves the shape, going along the flow (a trail's colour
  // edge; a fill's enters the same way), less where the copies start.
  const lines: { t: number; e: number; edge: number }[] = []
  for (let n = 0; n < 48; n++) {
    const t = t0 + (t1 - t0) * (0.1 + (0.8 * (n + 0.5)) / 48)
    let exit: number | null = null
    let was = false
    for (let s = s0 - 0.01; s <= s1 + 0.01; s += step * 2) {
      const now = inside(streakPos(s, t, dir, null, vanish))
      if (was && !now) exit = s
      was = now
    }
    if (exit !== null) lines.push({ t, e: exit - step * 3 - (shape.repeatFrom ?? 0), edge: exit })
  }
  if (lines.length < 4) return null
  const minLag = Math.max(4, Math.round(0.012 / step))
  const maxLag = Math.min(Math.floor(samples / 2), Math.round(0.2 / step))
  /** The lines read with the copies' point moved by delta (short-side units): the spacing that repeats, and how strongly. */
  const measure = (delta: number): { lag: number; score: number; deep: number } | null => {
    const profiles: Float32Array[] = []
    for (const { t, e, edge } of lines) {
      const prof = new Float32Array(samples)
      if (vanish) {
        // Read from where the copies start (Copy from in), but a pixel at
        // the edge's size each step: the copies' length is taken at the
        // edge (repeatRead), and measured deeper in it would come out short.
        const g = vanish.g
        const re = Math.max(g * e, 1e-4) + delta
        const rEdge = Math.max(g * edge, 1e-4) + delta
        if (re <= 0.02 || rEdge <= 0.02) return null
        const dw = step / (rEdge * rEdge)
        for (let j = 0; j < samples; j++) {
          const w = 1 / re + g * j * dw
          if (w <= 1e-6) break
          const q = toGrey(streakPos(g * (1 / w - delta), t, dir, null, vanish))
          prof[j] = lum(q.x, q.y)
        }
      } else {
        for (let j = 0; j < samples; j++) {
          const q = toGrey(streakPos(e - j * step, t, dir, null, vanish))
          prof[j] = lum(q.x, q.y)
        }
      }
      profiles.push(prof)
    }
    // How alike each line is with itself moved by each spacing, all lines together.
    const corr = new Float32Array(maxLag + 2)
    for (let lag = minLag; lag <= maxLag; lag++) {
      let sum = 0
      for (const p of profiles) {
        const n = samples - lag
        let ma = 0
        let mb = 0
        for (let j = 0; j < n; j++) {
          ma += p[j]
          mb += p[j + lag]
        }
        ma /= n
        mb /= n
        let ab = 0
        let aa = 0
        let bb = 0
        for (let j = 0; j < n; j++) {
          const a = p[j] - ma
          const b = p[j + lag] - mb
          ab += a * b
          aa += a * a
          bb += b * b
        }
        sum += ab / Math.sqrt(aa * bb + 1e-9)
      }
      corr[lag] = sum / profiles.length
    }
    // The peaks: the strongest, then the shortest spacing nearly as strong (one floor, not two).
    const peaks: number[] = []
    for (let lag = minLag + 1; lag < maxLag; lag++) if (corr[lag] > corr[lag - 1] && corr[lag] >= corr[lag + 1] && corr[lag] > 0.2) peaks.push(lag)
    if (!peaks.length) return null
    const best = Math.max(...peaks.map((l) => corr[l]))
    const lag = peaks.find((l) => corr[l] >= best * 0.85) ?? peaks[0]
    // Read to a whole pixel, the spacing is off by up to half of one: a few
    // percent, which adds up over Vary's deeper copies and Copy from's
    // layers. So it is taken from the furthest clear repeat of it (several
    // floors apart, divided by how many), each peak placed between pixels.
    const between = (l: number) => {
      const a = corr[l - 1]
      const c = corr[l + 1]
      const d = a - 2 * corr[l] + c
      return d < 0 ? l + Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : l
    }
    let precise = between(lag)
    for (let n = 2; n * lag + 3 < maxLag; n++) {
      let at = n * lag - 3
      for (let l = n * lag - 3; l <= n * lag + 3; l++) if (corr[l] > corr[at]) at = l
      if (corr[at] < corr[lag] * 0.6 || at <= minLag) break
      precise = between(at) / n
    }
    // How well the floors two, three and four further in line up with the
    // first, read along the lines, against how well the next one does: what
    // Vary the copies, taking each from further in, would join up.
    let deep = 1
    for (let n = 2; n <= 4; n++) {
      const l = Math.round(precise * n)
      deep = Math.min(deep, l + 1 < corr.length && l >= minLag ? corr[l] / corr[lag] : 1)
    }
    return { lag: precise, score: corr[lag], deep }
  }
  let found = measure(0)
  if (found) report?.(0, found.lag, found.score, found.deep)
  let vanishShare = 0
  if (vanish) {
    // The copies' point moved nearer (below 0) or further (above), a share
    // of the streak's distance to its own; kept only if the floors repeat
    // clearly more evenly there, the next one and those further in (Vary's)
    // together. Otherwise the streak's own: a flat score is noise.
    const fit = (f: { score: number; deep: number }) => f.score * f.deep
    for (let m = -0.8; m <= 2.001; m += 0.1) {
      if (Math.abs(m) < 0.05) continue
      const got = measure(m * vanish.r)
      if (got) report?.(Math.round(m * 100) / 100, got.lag, got.score, got.deep)
      if (got && (!found || fit(got) > fit(found) + 0.04)) {
        found = got
        vanishShare = Math.round(m * 100) / 100
      }
    }
  }
  if (!found) return null
  return { length: Math.round(found.lag * step * 10000) / 10000, vanish: vanishShare }
}
