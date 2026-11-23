import { describe, expect, it } from 'vitest'
import { edgeGuide, refineEdge } from './refineEdge'

/** The refinement as it was first written: fresh arrays for everything, one mask at a time. */
function reference(logits: Float32Array, gray: Float32Array, w: number, h: number): Uint8Array {
  const boxMean = (src: Float32Array, r: number) => {
    const sum = new Float64Array((w + 1) * (h + 1))
    for (let y = 0; y < h; y++) {
      let row = 0
      for (let x = 0; x < w; x++) {
        row += src[y * w + x]
        sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row
      }
    }
    const out = new Float32Array(w * h)
    for (let y = 0; y < h; y++) {
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(h, y + r + 1)
      for (let x = 0; x < w; x++) {
        const x0 = Math.max(0, x - r)
        const x1 = Math.min(w, x + r + 1)
        const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]
        out[y * w + x] = s / ((x1 - x0) * (y1 - y0))
      }
    }
    return out
  }
  const p = new Float32Array(w * h)
  for (let i = 0; i < p.length; i++) p[i] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logits[i]))))
  const r = Math.max(3, Math.round(Math.min(w, h) * 0.008))
  const meanI = boxMean(gray, r)
  const meanP = boxMean(p, r)
  const II = new Float32Array(w * h)
  const IP = new Float32Array(w * h)
  for (let i = 0; i < II.length; i++) {
    II[i] = gray[i] * gray[i]
    IP[i] = gray[i] * p[i]
  }
  const corrI = boxMean(II, r)
  const corrIP = boxMean(IP, r)
  const a = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i]
    const cov = corrIP[i] - meanI[i] * meanP[i]
    a[i] = cov / (varI + 1e-3)
    b[i] = meanP[i] - a[i] * meanI[i]
  }
  const ma = boxMean(a, r)
  const mb = boxMean(b, r)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = ma[i] * gray[i] + mb[i] >= 0.5 ? 1 : 0
  return out
}

describe('refineEdge', () => {
  it('gives exactly what the first version gave, for several masks in a row on one guide', () => {
    const w = 213
    const h = 157
    let seed = 7
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    const gray = new Float32Array(w * h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) gray[y * w + x] = (x > w * 0.4 && y > h * 0.3 ? 0.8 : 0.2) + (rand() - 0.5) * 0.2
    const guide = edgeGuide(gray, w, h)
    for (let m = 0; m < 3; m++) {
      const logits = new Float32Array(w * h)
      const cx = w * (0.4 + m * 0.1)
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) logits[y * w + x] = (60 - Math.hypot(x - cx, y - h / 2)) / 6 + (rand() - 0.5) * 4
      const got = refineEdge(logits, guide, new Uint8Array(w * h))
      expect(Array.from(got)).toEqual(Array.from(reference(logits, gray, w, h)))
    }
  })
})
