/**
 * Where one photo sits inside another copy of it: a better copy (larger, or
 * uncropped, as a RAW often is) put under an edit made on the first (App's
 * Replace photo). Matched in brightness with normalised cross-correlation,
 * so a copy with other exposure or contrast still finds its place; scale
 * and position only (no rotation).
 */
import type { Rect } from './types'

/** A grey image: brightness 0..1, row by row. */
export interface Gray {
  w: number
  h: number
  data: Float32Array
}

/** Where the first photo is in the second, as fractions of the second, and how sure (correlation, -1..1). */
export interface Located {
  rect: Rect
  score: number
  /** The same framing: the whole of the second, as when it is the same photo at another size. */
  whole: boolean
}

/** A grey copy of a picture, at most `long` pixels on its long side. */
export function grayOf(src: CanvasImageSource & { width: number; height: number }, long: number): Gray {
  const k = Math.min(1, long / Math.max(src.width, src.height))
  const w = Math.max(1, Math.round(src.width * k))
  const h = Math.max(1, Math.round(src.height * k))
  const c = new OffscreenCanvas(w, h)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const data = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) data[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255
  return { w, h, data }
}

/** g resampled to w × h (area-averaged when shrinking, bilinear otherwise). */
export function resample(g: Gray, w: number, h: number): Gray {
  const out = new Float32Array(w * h)
  const sx = g.w / w
  const sy = g.h / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (sx > 1 || sy > 1) {
        // The source pixels this one covers, averaged.
        const x0 = Math.floor(x * sx)
        const x1 = Math.max(x0 + 1, Math.min(g.w, Math.floor((x + 1) * sx)))
        const y0 = Math.floor(y * sy)
        const y1 = Math.max(y0 + 1, Math.min(g.h, Math.floor((y + 1) * sy)))
        let sum = 0
        for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) sum += g.data[yy * g.w + xx]
        out[y * w + x] = sum / ((x1 - x0) * (y1 - y0))
      } else {
        const fx = Math.min(g.w - 1, Math.max(0, (x + 0.5) * sx - 0.5))
        const fy = Math.min(g.h - 1, Math.max(0, (y + 0.5) * sy - 0.5))
        const ax = Math.floor(fx)
        const ay = Math.floor(fy)
        const bx = Math.min(g.w - 1, ax + 1)
        const by = Math.min(g.h - 1, ay + 1)
        const tx = fx - ax
        const ty = fy - ay
        const top = g.data[ay * g.w + ax] * (1 - tx) + g.data[ay * g.w + bx] * tx
        const bot = g.data[by * g.w + ax] * (1 - tx) + g.data[by * g.w + bx] * tx
        out[y * w + x] = top * (1 - ty) + bot * ty
      }
    }
  return { w, h, data: out }
}

/** Sums and sums of squares over every rectangle of g at once (summed-area tables). */
function tables(g: Gray) {
  const W = g.w + 1
  const s = new Float64Array(W * (g.h + 1))
  const q = new Float64Array(W * (g.h + 1))
  for (let y = 0; y < g.h; y++) {
    let rs = 0
    let rq = 0
    for (let x = 0; x < g.w; x++) {
      const v = g.data[y * g.w + x]
      rs += v
      rq += v * v
      s[(y + 1) * W + x + 1] = s[y * W + x + 1] + rs
      q[(y + 1) * W + x + 1] = q[y * W + x + 1] + rq
    }
  }
  const box = (t: Float64Array, x: number, y: number, w: number, h: number) => t[(y + h) * W + x + w] - t[y * W + x + w] - t[(y + h) * W + x] + t[y * W + x]
  return { sum: (x: number, y: number, w: number, h: number) => box(s, x, y, w, h), sq: (x: number, y: number, w: number, h: number) => box(q, x, y, w, h) }
}

/** The template's own mean taken out, and its spread: ready to correlate. */
function centred(t: Gray) {
  let m = 0
  for (const v of t.data) m += v
  m /= t.data.length
  const c = new Float32Array(t.data.length)
  let ss = 0
  for (let i = 0; i < c.length; i++) {
    c[i] = t.data[i] - m
    ss += c[i] * c[i]
  }
  return { c, norm: Math.sqrt(ss) }
}

/** The correlation of template t (centred) with g's window at (x, y). */
function corr(g: Gray, tab: ReturnType<typeof tables>, t: Gray, tc: ReturnType<typeof centred>, x: number, y: number): number {
  const n = t.w * t.h
  const sum = tab.sum(x, y, t.w, t.h)
  const sq = tab.sq(x, y, t.w, t.h)
  const varW = sq - (sum * sum) / n
  if (varW <= 1e-9 || tc.norm <= 1e-9) return -1
  // Σ tc·w = Σ tc·(w − mean w), as Σ tc = 0.
  let dot = 0
  for (let ty = 0; ty < t.h; ty++) {
    const row = (y + ty) * g.w + x
    const trow = ty * t.w
    for (let tx = 0; tx < t.w; tx++) dot += tc.c[trow + tx] * g.data[row + tx]
  }
  return dot / (tc.norm * Math.sqrt(varW))
}

interface Pose {
  /** The template's width in the searched image's pixels. */
  tw: number
  x: number
  y: number
  score: number
}

/**
 * The best place for `old` in `neu` (both grey, any sizes): over widths from
 * `f0` to `f1` of neu's width in steps of `df`, every position (or within
 * `near` pixels of a guess).
 */
function search(old: Gray, neu: Gray, f0: number, f1: number, df: number, near?: { x: number; y: number; r: number }): Pose {
  const tab = tables(neu)
  const aspect = old.h / old.w
  let best: Pose = { tw: neu.w, x: 0, y: 0, score: -2 }
  // As wide as fits: the whole width, or the whole height for a taller photo.
  const most = Math.min(f1, neu.h / neu.w / aspect)
  const widths: number[] = []
  for (let f = f0; f < most - 1e-9; f += df) widths.push(f)
  widths.push(most)
  for (const f of widths) {
    const tw = Math.min(neu.w, Math.round(f * neu.w))
    const th = Math.min(neu.h, Math.round(tw * aspect))
    if (tw < 8 || th < 8) continue
    const t = resample(old, tw, th)
    const tc = centred(t)
    const x0 = near ? Math.max(0, near.x - near.r) : 0
    const y0 = near ? Math.max(0, near.y - near.r) : 0
    const x1 = near ? Math.min(neu.w - tw, near.x + near.r) : neu.w - tw
    const y1 = near ? Math.min(neu.h - th, near.y + near.r) : neu.h - th
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const score = corr(neu, tab, t, tc, x, y)
        if (score > best.score) best = { tw, x, y, score }
      }
  }
  return best
}

/**
 * Where `old` (the photo the edit was made on) is in `neu` (a better copy):
 * a coarse search over every size and place, a fine one round the best,
 * then two detailed patches pinned to a fraction of a pixel. Found within a
 * tenth of a percent of the whole on every side, it is the whole (the same
 * framing at another size).
 */
export function locatePhoto(old: Gray, neu: Gray): Located {
  const aspectOld = old.h / old.w
  // Coarse: the new copy at 96 px across its long side.
  const k1 = 96 / Math.max(neu.w, neu.h)
  const n1 = resample(neu, Math.max(8, Math.round(neu.w * k1)), Math.max(8, Math.round(neu.h * k1)))
  const coarse = search(old, n1, 0.25, 1, 0.02)
  // Fine: at 320 px, round the coarse answer.
  const k2 = 320 / Math.max(neu.w, neu.h)
  const n2 = resample(neu, Math.max(8, Math.round(neu.w * k2)), Math.max(8, Math.round(neu.h * k2)))
  const f = coarse.tw / n1.w
  const at = { x: Math.round((coarse.x / n1.w) * n2.w), y: Math.round((coarse.y / n1.h) * n2.h), r: 6 }
  const fine = search(old, n2, Math.max(0.05, f - 0.025), Math.min(1, f + 0.025), 0.0025, at)
  const rough: Rect = { x: fine.x / n2.w, y: fine.y / n2.h, width: fine.tw / n2.w, height: (fine.tw * aspectOld) / n2.h }
  const rect = pinned(old, neu, rough) ?? rough
  // Within a tenth of a percent of the whole of it on every side, and the
  // same shape: the same framing at another size (a full-size export of the
  // same photo). A few pixels trimmed (as an export can be) stay a crop.
  const near = (v: number) => Math.abs(v) < 0.001
  const whole = near(rect.x) && near(rect.y) && near(1 - (rect.x + rect.width)) && near(1 - (rect.y + rect.height)) && near(aspectOld / (neu.h / neu.w) - 1)
  return whole ? { rect: { x: 0, y: 0, width: 1, height: 1 }, score: fine.score, whole } : { rect, score: fine.score, whole }
}

/** The peak of three samples, as a fraction of a step either side of the middle. */
const peak = (a: number, b: number, c: number) => {
  const d = a - 2 * b + c
  return d < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / d)) : 0
}

/**
 * The rough place made exact, at the full detail given: two detailed patches
 * of the old photo (one in each half, across a diagonal) found in the new
 * copy near where the rough place puts them, each to a fraction of a pixel,
 * and the scale and position solved from the two. Null if either is not
 * found clearly.
 */
function pinned(old: Gray, neu: Gray, rough: Rect): Rect | null {
  const s = (rough.width * neu.w) / old.w
  // A patch about 72 new pixels across, in old pixels.
  const side = Math.max(12, Math.round(72 / s))
  if (old.w < side * 3 || old.h < side * 3) return null
  const tab = tables(neu)
  // The most detailed patch (largest spread) of a few in each half.
  const pick = (cx0: number, cy0: number) => {
    let best = { x: 0, y: 0, v: -1 }
    for (const fx of [0.15, 0.25, 0.35])
      for (const fy of [0.15, 0.25, 0.35]) {
        const x = Math.round((cx0 + fx) * old.w - side / 2)
        const y = Math.round((cy0 + fy) * old.h - side / 2)
        if (x < 0 || y < 0 || x + side > old.w || y + side > old.h) continue
        let m = 0
        let q = 0
        for (let yy = 0; yy < side; yy++)
          for (let xx = 0; xx < side; xx++) {
            const v = old.data[(y + yy) * old.w + x + xx]
            m += v
            q += v * v
          }
        const n = side * side
        const v = q / n - (m / n) ** 2
        if (v > best.v) best = { x, y, v }
      }
    return best
  }
  const found: { old: { x: number; y: number }; neu: { x: number; y: number } }[] = []
  for (const [cx, cy] of [[0, 0], [0.5, 0.5]] as const) {
    const p = pick(cx, cy)
    if (p.v <= 1e-5) return null
    const crop: Gray = { w: side, h: side, data: new Float32Array(side * side) }
    for (let yy = 0; yy < side; yy++) for (let xx = 0; xx < side; xx++) crop.data[yy * side + xx] = old.data[(p.y + yy) * old.w + p.x + xx]
    const tw = Math.max(8, Math.round(side * s))
    const t = resample(crop, tw, tw)
    const tc = centred(t)
    // Where the rough place puts it, and a margin round that.
    const ex = Math.round(rough.x * neu.w + p.x * s)
    const ey = Math.round(rough.y * neu.h + p.y * s)
    const r = Math.max(4, Math.round(0.006 * Math.max(neu.w, neu.h)))
    let best = { x: 0, y: 0, score: -2 }
    const score = (x: number, y: number) => (x < 0 || y < 0 || x + tw > neu.w || y + tw > neu.h ? -2 : corr(neu, tab, t, tc, x, y))
    for (let y = ey - r; y <= ey + r; y++)
      for (let x = ex - r; x <= ex + r; x++) {
        const v = score(x, y)
        if (v > best.score) best = { x, y, score: v }
      }
    if (best.score < 0.5) return null
    const dx = peak(score(best.x - 1, best.y), best.score, score(best.x + 1, best.y))
    const dy = peak(score(best.x, best.y - 1), best.score, score(best.x, best.y + 1))
    // Centres: the patch's in old pixels, its match's in new.
    found.push({ old: { x: p.x + side / 2, y: p.y + side / 2 }, neu: { x: best.x + dx + tw / 2, y: best.y + dy + tw / 2 } })
  }
  const [a, b] = found
  const dOld = Math.hypot(b.old.x - a.old.x, b.old.y - a.old.y)
  if (dOld < 1) return null
  const k = Math.hypot(b.neu.x - a.neu.x, b.neu.y - a.neu.y) / dOld
  // One scale (pixels are square); placed so both patches land as found, on average.
  const x0 = (a.neu.x - a.old.x * k + b.neu.x - b.old.x * k) / 2
  const y0 = (a.neu.y - a.old.y * k + b.neu.y - b.old.y * k) / 2
  const rect = { x: x0 / neu.w, y: y0 / neu.h, width: (old.w * k) / neu.w, height: (old.h * k) / neu.h }
  // Far from the rough place: a mismatch, not a refinement.
  if (Math.abs(rect.width - rough.width) > 0.02 || Math.abs(rect.x - rough.x) > 0.02 || Math.abs(rect.y - rough.y) > 0.02) return null
  return rect
}
