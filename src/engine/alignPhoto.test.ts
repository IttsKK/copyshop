import { describe, expect, it } from 'vitest'
import { locatePhoto, resample, type Gray } from './alignPhoto'

/** A made-up photo: soft shapes and some fine detail, w × h. */
function scene(w: number, h: number): Gray {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      data[y * w + x] =
        0.5 +
        0.2 * Math.sin(u * 7.3 + v * 2.1) +
        0.15 * Math.cos(v * 11.7 - u * 3.3) +
        0.08 * Math.sin(u * 61 + Math.sin(v * 37) * 3) +
        0.05 * Math.sin((u + v) * 143)
    }
  return { w, h, data }
}

/** Part of g (fractions), resampled to `width` pixels across. */
function cropOf(g: Gray, r: { x: number; y: number; width: number; height: number }, width: number): Gray {
  const x0 = Math.round(r.x * g.w)
  const y0 = Math.round(r.y * g.h)
  const w = Math.round(r.width * g.w)
  const h = Math.round(r.height * g.h)
  const c: Gray = { w, h, data: new Float32Array(w * h) }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) c.data[y * w + x] = g.data[(y0 + y) * g.w + x0 + x]
  return resample(c, width, Math.round((width * h) / w))
}

describe('locatePhoto', () => {
  const big = scene(1600, 1200)

  it('finds a crop of a larger copy, to a fraction of a pixel of the photo', () => {
    const r = { x: 0.125, y: 0.1, width: 0.6, height: 0.7 }
    const old = cropOf(big, r, 600)
    const found = locatePhoto(old, big)
    expect(found.whole).toBe(false)
    expect(found.score).toBeGreaterThan(0.9)
    // Within a pixel of the large copy.
    expect(Math.abs(found.rect.x - r.x) * big.w).toBeLessThan(1.5)
    expect(Math.abs(found.rect.y - r.y) * big.h).toBeLessThan(1.5)
    expect(Math.abs(found.rect.width - r.width) * big.w).toBeLessThan(2)
  })

  it('finds it with other exposure and contrast', () => {
    const r = { x: 0.3, y: 0.2, width: 0.5, height: 0.5 }
    const old = cropOf(big, r, 500)
    for (let i = 0; i < old.data.length; i++) old.data[i] = 0.15 + old.data[i] * 0.6
    const found = locatePhoto(old, big)
    expect(Math.abs(found.rect.x - r.x) * big.w).toBeLessThan(1.5)
    expect(Math.abs(found.rect.width - r.width) * big.w).toBeLessThan(2)
  })

  it('takes the same framing at another size as the whole of it', () => {
    const old = resample(big, 400, 300)
    const found = locatePhoto(old, big)
    expect(found.whole).toBe(true)
    expect(found.rect).toEqual({ x: 0, y: 0, width: 1, height: 1 })
    expect(found.score).toBeGreaterThan(0.95)
  })

  it('says when it is another photo', () => {
    const other = scene(900, 600)
    for (let i = 0; i < other.data.length; i++) other.data[i] = Math.sin(i * 0.37) * 0.5 + 0.5
    const found = locatePhoto(other, big)
    expect(found.score).toBeLessThan(0.5)
  })
})
