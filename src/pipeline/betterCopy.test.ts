import { describe, expect, it } from 'vitest'
import { resample, type Gray } from '../engine/alignPhoto'
import { DEFAULT_BLEND_PARAMS, DEFAULT_EFFECTS, STREAK_DEFAULTS, type BlendParams } from '../engine/types'
import { moveEditOnto } from './betterCopy'

function scene(w: number, h: number): Gray {
  const data = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      data[y * w + x] = 0.5 + 0.2 * Math.sin(u * 7.3 + v * 2.1) + 0.15 * Math.cos(v * 11.7 - u * 3.3) + 0.08 * Math.sin(u * 61 + Math.sin(v * 37) * 3)
    }
  return { w, h, data }
}

/** An edit with a streak whose outline has a point at (0.5, 0.5) of the photo. */
const edit = (): BlendParams => ({
  ...DEFAULT_BLEND_PARAMS,
  effects: {
    ...DEFAULT_EFFECTS,
    shapeSpace: 'photo',
    streaks: {
      ...DEFAULT_EFFECTS.streaks,
      shapes: [{ ...STREAK_DEFAULTS, mode: 'trail', seed: 1, outline: [{ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, { x: 0.6, y: 0.7 }] }],
    },
  },
})

describe('moveEditOnto', () => {
  const big = scene(1200, 900)

  it('onto the same photo larger: the scale and seed kept, nothing moved', () => {
    const old = resample(big, 400, 300)
    const moved = moveEditOnto(edit(), old, { width: 400, height: 300 }, 4242, big, { width: 3600, height: 2700 })
    expect(moved.found.whole).toBe(true)
    expect(moved.blend.pixelScale).toBeCloseTo(9, 5)
    expect(moved.blend.photoSeed).toBe(4242)
    expect(moved.blend.effects.streaks.shapes[0].outline[0]).toEqual({ x: 0.5, y: 0.5 })
    expect(moved.blend.effects.crop.enabled).toBe(false)
  })

  it('onto a wider copy: cropped to where the old photo was, everything placed where it was in the picture', () => {
    // The old photo: x 0.2..0.8, y 0.1..0.7 of the new one, at a third of its size.
    const r = { x: 0.2, y: 0.1, width: 0.6, height: 0.6 }
    const crop: Gray = { w: 720, h: 540, data: new Float32Array(720 * 540) }
    for (let y = 0; y < 540; y++) for (let x = 0; x < 720; x++) crop.data[y * 720 + x] = big.data[(90 + y) * 1200 + 240 + x]
    const old = resample(crop, 240, 180)
    const moved = moveEditOnto(edit(), old, { width: 240, height: 180 }, 7, big, { width: 1200, height: 900 })
    expect(moved.found.whole).toBe(false)
    const c = moved.blend.effects.crop
    expect(c.enabled).toBe(true)
    expect(c.x).toBeCloseTo(r.x, 2)
    expect(c.y).toBeCloseTo(r.y, 2)
    expect(c.width).toBeCloseTo(r.width, 2)
    expect(c.height).toBeCloseTo(r.height, 2)
    // (0.5, 0.5) of the old photo is (0.5, 0.4) of the new one.
    const p = moved.blend.effects.streaks.shapes[0].outline[0]
    expect(p.x).toBeCloseTo(0.5, 2)
    expect(p.y).toBeCloseTo(0.4, 2)
    expect(moved.blend.pixelScale).toBeCloseTo(3, 1)
    expect(moved.lost).toBeLessThan(0.002)
  })
  it('a crop turned a quarter: still turned, on the same part of the photo', () => {
    const crop: Gray = { w: 720, h: 540, data: new Float32Array(720 * 540) }
    for (let y = 0; y < 540; y++) for (let x = 0; x < 720; x++) crop.data[y * 720 + x] = big.data[(90 + y) * 1200 + 240 + x]
    const old = resample(crop, 240, 180)
    const e = edit()
    e.effects = { ...e.effects, crop: { ...e.effects.crop, enabled: true, quarter: 1 } }
    const moved = moveEditOnto(e, old, { width: 240, height: 180 }, 7, big, { width: 1200, height: 900 })
    const c = moved.blend.effects.crop
    expect(c.quarter).toBe(1)
    // The old photo, x 240..960 and y 90..630 of the new one, turned right about the new one's middle: x 420..960, y 90..810 of its 900 x 1200 frame (from -150 up).
    expect(c.x).toBeCloseTo(0.3, 2)
    expect(c.y).toBeCloseTo(0.2, 2)
    expect(c.width).toBeCloseTo(0.6, 2)
    expect(c.height).toBeCloseTo(0.6, 2)
  })
})
