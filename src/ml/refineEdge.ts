/**
 * A selection's edge refined against the photo (a guided filter, He et al.):
 * the model's soft answer smoothed where the photo is flat, and snapped to
 * the photo's own edges where it has them; then cut at half. 1 inside.
 *
 * Made for several masks of one photo at a time: what depends only on the
 * photo is worked out once, and every mask reuses the same few buffers. A
 * fresh set of full-size arrays for each mask (about 140 MB each at the work
 * size) made the tap that picks a subject the moment a phone ran out of memory.
 */
export interface EdgeGuide {
  width: number
  height: number
  /** The photo's brightness, 0..1. */
  gray: Float32Array
  /** Box radius, in pixels. */
  r: number
  meanI: Float32Array
  corrI: Float32Array
  /** Scratch for the box sums and the four working planes, reused mask after mask. */
  sum: Float64Array
  planes: [Float32Array, Float32Array, Float32Array, Float32Array]
}

const EPS = 1e-3

/** Sums over a (2r+1)² box at every cell, edges clamped (an integral image), written into `out`. */
export function boxMean(src: Float32Array, w: number, h: number, r: number, out: Float32Array, sum: Float64Array): Float32Array {
  const W = w + 1
  for (let x = 0; x <= w; x++) sum[x] = 0
  for (let y = 0; y < h; y++) {
    let row = 0
    sum[(y + 1) * W] = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
    }
  }
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/** What every mask of this photo is refined against. */
export function edgeGuide(gray: Float32Array, width: number, height: number): EdgeGuide {
  const n = width * height
  const r = Math.max(3, Math.round(Math.min(width, height) * 0.008))
  const sum = new Float64Array((width + 1) * (height + 1))
  const planes: EdgeGuide['planes'] = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)]
  const meanI = boxMean(gray, width, height, r, new Float32Array(n), sum)
  const II = planes[0]
  for (let i = 0; i < n; i++) II[i] = gray[i] * gray[i]
  const corrI = boxMean(II, width, height, r, new Float32Array(n), sum)
  return { width, height, gray, r, meanI, corrI, sum, planes }
}

/** One mask's soft answer (logits) refined and cut, written into `out` (1 inside). */
export function refineEdge(logits: Float32Array, g: EdgeGuide, out: Uint8Array): Uint8Array {
  const { width: w, height: h, gray, r, meanI, corrI, sum } = g
  const [p, meanP, ip, corrIP] = g.planes
  const n = w * h
  for (let i = 0; i < n; i++) p[i] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logits[i]))))
  boxMean(p, w, h, r, meanP, sum)
  for (let i = 0; i < n; i++) ip[i] = gray[i] * p[i]
  boxMean(ip, w, h, r, corrIP, sum)
  // a (in ip) and b (in corrIP), then their box means (in p and meanP).
  const a = ip
  const b = corrIP
  for (let i = 0; i < n; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i]
    const cov = corrIP[i] - meanI[i] * meanP[i]
    a[i] = cov / (varI + EPS)
    b[i] = meanP[i] - a[i] * meanI[i]
  }
  const ma = boxMean(a, w, h, r, p, sum)
  const mb = boxMean(b, w, h, r, meanP, sum)
  for (let i = 0; i < n; i++) out[i] = ma[i] * gray[i] + mb[i] >= 0.5 ? 1 : 0
  return out
}
