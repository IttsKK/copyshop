import { MAX_CONVERGE } from './streaks'

export interface Pt {
  x: number
  y: number
}

/** A straight line in the photo, end to end, and how strongly the photo shows it. */
export interface FoundLine {
  a: Pt
  b: Pt
  weight: number
}

/**
 * Where lines meet, as near as they all allow: the point nearest every line
 * at once, each weighed by its length. Null when they are as good as
 * parallel (the point is effectively at infinity).
 */
export function meetingPoint(lines: { a: Pt; b: Pt; weight?: number }[]): Pt | null {
  let sxx = 0
  let sxy = 0
  let syy = 0
  let bx = 0
  let by = 0
  for (const l of lines) {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const len = Math.hypot(dx, dy)
    if (len < 1e-9) continue
    const nx = -dy / len
    const ny = dx / len
    const d = nx * l.a.x + ny * l.a.y
    const w = l.weight ?? len
    sxx += w * nx * nx
    sxy += w * nx * ny
    syy += w * ny * ny
    bx += w * nx * d
    by += w * ny * d
  }
  const det = sxx * syy - sxy * sxy
  // Nearly parallel lines meet far away, and the fit says so with a tiny determinant.
  if (Math.abs(det) < 1e-9 * Math.max(sxx * syy, 1e-12)) return null
  return { x: (syy * bx - sxy * by) / det, y: (sxx * by - sxy * bx) / det }
}

/**
 * A straight streak's angle (degrees) and perspective that send its lines
 * along these lines: through the point where they meet, which is ahead
 * along the flow when they close in, behind when they spread. All in the
 * streak's short-side units; `centre` is its shape's middle and `flow` the
 * way it runs now, which picks the way along the lines it keeps going.
 */
export function streakPerspective(lines: { a: Pt; b: Pt; weight?: number }[], centre: Pt, flow: Pt): { angle: number; converge: number } | null {
  const usable = lines.filter((l) => Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y) > 1e-6)
  if (usable.length < 2) return null
  const v = meetingPoint(usable)
  const far = v ? Math.hypot(v.x - centre.x, v.y - centre.y) : Infinity
  if (!v || far > 1 / 0.002) {
    // Parallel, or as good as: their average direction, the way the flow goes.
    let mx = 0
    let my = 0
    for (const l of usable) {
      let dx = l.b.x - l.a.x
      let dy = l.b.y - l.a.y
      const len = Math.hypot(dx, dy)
      if (dx * flow.x + dy * flow.y < 0) {
        dx = -dx
        dy = -dy
      }
      mx += dx / len
      my += dy / len
    }
    return { angle: (Math.atan2(my, mx) * 180) / Math.PI, converge: 0 }
  }
  const toward = (v.x - centre.x) * flow.x + (v.y - centre.y) * flow.y > 0
  const dx = toward ? v.x - centre.x : centre.x - v.x
  const dy = toward ? v.y - centre.y : centre.y - v.y
  const converge = Math.max(-MAX_CONVERGE, Math.min(MAX_CONVERGE, (toward ? 1 : -1) / Math.max(far, 1e-6)))
  return { angle: (Math.atan2(dy, dx) * 180) / Math.PI, converge }
}

/**
 * The photo's straight lines running roughly along `angle` (radians, the
 * way the streak runs), inside `box` (pixels of the grey picture): a Hough
 * transform over the edges whose own direction is within reach of it.
 * Strongest first.
 */
export function findLines(grey: Float32Array, w: number, h: number, box: { x0: number; y0: number; x1: number; y1: number }, angle: number, reach = (35 * Math.PI) / 180): FoundLine[] {
  const x0 = Math.max(1, Math.floor(box.x0))
  const y0 = Math.max(1, Math.floor(box.y0))
  const x1 = Math.min(w - 2, Math.ceil(box.x1))
  const y1 = Math.min(h - 2, Math.ceil(box.y1))
  if (x1 <= x0 || y1 <= y0) return []
  // Edges: Sobel, kept above the brighter part of the box's own edges.
  const mags: number[] = []
  const gxs = new Float32Array(w * h)
  const gys = new Float32Array(w * h)
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      const gx = grey[i - w + 1] + 2 * grey[i + 1] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - 1] - grey[i + w - 1]
      const gy = grey[i + w - 1] + 2 * grey[i + w] + grey[i + w + 1] - grey[i - w - 1] - 2 * grey[i - w] - grey[i - w + 1]
      gxs[i] = gx
      gys[i] = gy
      if ((x + y) % 7 === 0) mags.push(Math.hypot(gx, gy))
    }
  mags.sort((a, b) => a - b)
  const threshold = Math.max(mags[Math.floor(mags.length * 0.82)] ?? 0, 0.04)

  // Hough over the normals near the flow's: θ is a line's normal, ρ its distance from the corner.
  const centreTheta = angle + Math.PI / 2
  const STEP = (0.25 * Math.PI) / 180
  const nTheta = Math.round((2 * reach) / STEP) + 1
  const diag = Math.ceil(Math.hypot(w, h))
  const nRho = 2 * diag + 1
  const votes = new Float32Array(nTheta * nRho)
  const tMin = new Float32Array(nTheta * nRho).fill(Infinity)
  const tMax = new Float32Array(nTheta * nRho).fill(-Infinity)
  const cos = new Float32Array(nTheta)
  const sin = new Float32Array(nTheta)
  for (let k = 0; k < nTheta; k++) {
    const th = centreTheta - reach + k * STEP
    cos[k] = Math.cos(th)
    sin[k] = Math.sin(th)
  }
  const spread = 4 // bins either side a pixel's own normal votes for
  // The edge pixels themselves, for fitting each line found exactly.
  const ex: number[] = []
  const ey: number[] = []
  const eth: number[] = []
  const em: number[] = []
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const i = y * w + x
      const gx = gxs[i]
      const gy = gys[i]
      const mag = Math.hypot(gx, gy)
      if (mag < threshold) continue
      // The edge's normal, brought within half a turn of the flow's normal.
      let th = Math.atan2(gy, gx)
      while (th - centreTheta > Math.PI / 2) th -= Math.PI
      while (th - centreTheta < -Math.PI / 2) th += Math.PI
      const k0 = Math.round((th - (centreTheta - reach)) / STEP)
      if (k0 < -spread || k0 >= nTheta + spread) continue
      ex.push(x)
      ey.push(y)
      eth.push(th)
      em.push(mag)
      for (let k = Math.max(0, k0 - spread); k <= Math.min(nTheta - 1, k0 + spread); k++) {
        const rho = Math.round(x * cos[k] + y * sin[k]) + diag
        const b = k * nRho + rho
        votes[b] += mag * (1 - Math.abs(k - k0) / (spread + 1))
        const t = -x * sin[k] + y * cos[k]
        if (t < tMin[b]) tMin[b] = t
        if (t > tMax[b]) tMax[b] = t
      }
    }
  // Peaks, each the best in its neighbourhood.
  const order: number[] = []
  let top = 0
  for (let b = 0; b < votes.length; b++) if (votes[b] > top) top = votes[b]
  for (let b = 0; b < votes.length; b++) if (votes[b] > top * 0.12) order.push(b)
  order.sort((a, b) => votes[b] - votes[a])
  const kept: { k: number; r: number }[] = []
  const out: FoundLine[] = []
  for (const b of order) {
    if (out.length >= 40) break
    const k = Math.floor(b / nRho)
    const r = b % nRho
    if (kept.some((q) => Math.abs(q.k - k) <= 8 && Math.abs(q.r - r) <= 6)) continue
    kept.push({ k, r })
    let rho = r - diag
    let nx = cos[k]
    let ny = sin[k]
    // Settled on the edge pixels along it, pointing its way: a straight
    // line through them by least squares, finer than the transform's steps.
    const th0 = Math.atan2(ny, nx)
    for (let pass = 0; pass < 2; pass++) {
      let sw = 0
      let mx = 0
      let my = 0
      const pick: number[] = []
      for (let e = 0; e < ex.length; e++) {
        if (Math.abs(ex[e] * nx + ey[e] * ny - rho) > 1.5) continue
        let d = eth[e] - th0
        d -= Math.round(d / Math.PI) * Math.PI
        if (Math.abs(d) > (4 * Math.PI) / 180) continue
        pick.push(e)
        sw += em[e]
        mx += em[e] * ex[e]
        my += em[e] * ey[e]
      }
      if (pick.length < 8) break
      mx /= sw
      my /= sw
      let sxx = 0
      let sxy = 0
      let syy = 0
      for (const e of pick) {
        const dx = ex[e] - mx
        const dy = ey[e] - my
        sxx += em[e] * dx * dx
        sxy += em[e] * dx * dy
        syy += em[e] * dy * dy
      }
      // The line's direction is the spread's long axis; its normal the short.
      const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy)
      nx = -Math.sin(phi)
      ny = Math.cos(phi)
      rho = mx * nx + my * ny
    }
    let ta = Infinity
    let tb = -Infinity
    for (let e = 0; e < ex.length; e++) {
      if (Math.abs(ex[e] * nx + ey[e] * ny - rho) > 1.5) continue
      const t = -ex[e] * ny + ey[e] * nx
      if (t < ta) ta = t
      if (t > tb) tb = t
    }
    if (!(tb - ta > 0.06 * (y1 - y0))) continue
    out.push({ a: { x: rho * nx - ta * ny, y: rho * ny + ta * nx }, b: { x: rho * nx - tb * ny, y: rho * ny + tb * nx }, weight: votes[b] })
  }
  return out
}

/**
 * The one point most of the lines run toward (or the one direction, when
 * they are parallel), and the lines that agree with it: tried from where
 * each pair of the strongest meets, kept for the most weight agreeing to
 * within a degree, then settled on those.
 */
export function dominantMeeting(lines: FoundLine[]): { point: Pt | null; inliers: FoundLine[] } | null {
  const top = lines.slice(0, 24)
  if (top.length < 2) return null
  const homo = (l: FoundLine) => {
    const dx = l.b.x - l.a.x
    const dy = l.b.y - l.a.y
    const len = Math.hypot(dx, dy)
    const nx = -dy / len
    const ny = dx / len
    return { n: [nx, ny, -(nx * l.a.x + ny * l.a.y)], d: { x: dx / len, y: dy / len }, m: { x: (l.a.x + l.b.x) / 2, y: (l.a.y + l.b.y) / 2 } }
  }
  const hs = top.map(homo)
  const agrees = (i: number, v: number[]) => {
    const h = hs[i]
    let tx: number
    let ty: number
    if (Math.abs(v[2]) < 1e-9) {
      tx = v[0]
      ty = v[1]
    } else {
      tx = v[0] / v[2] - h.m.x
      ty = v[1] / v[2] - h.m.y
    }
    const tl = Math.hypot(tx, ty)
    if (tl < 1e-9) return true
    const c = Math.abs((tx * h.d.x + ty * h.d.y) / tl)
    return c > Math.cos((1.5 * Math.PI) / 180)
  }
  let best: { score: number; set: number[] } = { score: 0, set: [] }
  for (let i = 0; i < hs.length; i++)
    for (let j = i + 1; j < hs.length; j++) {
      const a = hs[i].n
      const b = hs[j].n
      const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
      const set: number[] = []
      let score = 0
      for (let k = 0; k < hs.length; k++)
        if (agrees(k, v)) {
          set.push(k)
          score += top[k].weight
        }
      if (score > best.score) best = { score, set }
    }
  if (best.set.length < 2) return null
  const inliers = best.set.map((k) => top[k])
  return { point: meetingPoint(inliers), inliers }
}
