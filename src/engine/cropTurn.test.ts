import { describe, expect, it } from 'vitest'
import { DEFAULT_CROP, cropActive, cropAngle, cropRatio, cropRect, insideTurned, keepInside, turnPx, turnQuarter } from './crop'
import { shapesOnCrop } from '../pipeline/instagram'
import { DEFAULT_BLEND_PARAMS, DEFAULT_EFFECTS, STREAK_DEFAULTS, shapeMeasure, type BlendParams } from './types'

const photo = { width: 1200, height: 800 }

describe('turned crop', () => {
  it('turns about the middle', () => {
    const p = turnPx({ x: 1200, y: 400 }, photo, 90)
    expect(p.x).toBeCloseTo(600)
    expect(p.y).toBeCloseTo(1000)
    const back = turnPx(p, photo, -90)
    expect(back.x).toBeCloseTo(1200)
    expect(back.y).toBeCloseTo(400)
  })

  it('a turn alone makes the crop active', () => {
    expect(cropActive({ ...DEFAULT_CROP, enabled: true })).toBe(false)
    expect(cropActive({ ...DEFAULT_CROP, enabled: true, angle: 3 })).toBe(true)
  })

  it('the whole frame turned shows corners; kept inside, it shrinks about its middle and keeps its shape', () => {
    const whole = { x: 0, y: 0, width: 1, height: 1 }
    expect(insideTurned(whole, photo, 5)).toBe(false)
    const c = keepInside({ ...DEFAULT_CROP, enabled: true, ...whole, angle: 5 }, photo)
    expect(insideTurned(c, photo, 5)).toBe(true)
    expect(c.x + c.width / 2).toBeCloseTo(0.5, 4)
    expect(c.y + c.height / 2).toBeCloseTo(0.5, 4)
    expect(c.width / c.height).toBeCloseTo(1, 4)
    expect(c.width).toBeGreaterThan(0.8)
  })

  it('a crop near an edge slides in before it shrinks', () => {
    const c = keepInside({ ...DEFAULT_CROP, enabled: true, x: 0, y: 0.3, width: 0.3, height: 0.3, angle: 4 }, photo)
    expect(insideTurned(c, photo, 4)).toBe(true)
    expect(c.width).toBeCloseTo(0.3, 6)
    expect(c.x).toBeGreaterThan(0)
  })

  it('placed things turn with the photo: the streak and its angle', () => {
    const params: BlendParams = {
      ...DEFAULT_BLEND_PARAMS,
      effects: {
        ...DEFAULT_EFFECTS,
        shapeSpace: 'photo',
        streaks: { ...DEFAULT_EFFECTS.streaks, shapes: [{ ...STREAK_DEFAULTS, mode: 'trail', seed: 1, angle: -90, outline: [{ x: 0.75, y: 0.5 }] }] },
      },
    }
    // The whole frame, turned 90°: a point right of the middle goes below it.
    const out = shapesOnCrop(params, photo, { x: 0, y: 0, width: 1200, height: 800 }, 90)
    const s = out.effects.streaks.shapes[0]
    expect(s.angle).toBe(0)
    expect(s.outline[0].x).toBeCloseTo(0.5)
    expect(s.outline[0].y).toBeCloseTo(0.5 + 300 / 800)
  })
})

describe('streaks on a crop are measured on the whole photo', () => {
  // A point of the photo in short-side units from the measure's origin, before and after a crop.
  const at = (b: BlendParams, base: { width: number; height: number }, p: { x: number; y: number }) => {
    const m = shapeMeasure(base, b.border, b.effects.shapeUnits, b.effects.cropFrame)
    return { x: (p.x * base.width - m.x) / m.unit, y: (p.y * base.height - m.y) / m.unit, unit: m.unit }
  }
  const blend: BlendParams = { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, streaks: { ...DEFAULT_EFFECTS.streaks, shapes: [{ ...STREAK_DEFAULTS, mode: 'trail', seed: 1, outline: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.7 }] }] } } }
  const whole = at(blend, photo, { x: 0.5, y: 0.5 })

  it('a plain crop: the same point is the same distance from the same corner, in the same units', () => {
    const crop = { x: 120, y: 80, width: 900, height: 600 }
    const on = shapesOnCrop(blend, photo, crop)
    const p = at(on, crop, { x: (600 - 120) / 900, y: (400 - 80) / 600 })
    expect(p.x).toBeCloseTo(whole.x, 6)
    expect(p.y).toBeCloseTo(whole.y, 6)
    // One short-side unit is still the whole photo's short side, in the crop's pixels.
    expect(p.unit).toBeCloseTo(800, 6)
  })

  it('a turned crop: the photo’s middle stays the same distance from its corner', () => {
    const crop = { x: 100, y: 60, width: 1000, height: 680 }
    const on = shapesOnCrop(blend, photo, crop, 2)
    // The photo's middle is where turning leaves it; the streak's direction turns with the photo.
    const mid = turnPx({ x: 600, y: 400 }, photo, 2)
    const p = at(on, crop, { x: (mid.x - crop.x) / crop.width, y: (mid.y - crop.y) / crop.height })
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(Math.hypot(whole.x, whole.y), 6)
    expect(on.effects.streaks.shapes[0].angle).toBeCloseTo(blend.effects.streaks.shapes[0].angle + 2, 6)
  })
})

describe('a quarter turn', () => {
  const whole = { ...DEFAULT_CROP, enabled: true }
  it('stands a landscape photo up, the whole of it still there to crop', () => {
    const c = turnQuarter(whole, 1)
    expect(c.quarter).toBe(1)
    expect(cropActive(c)).toBe(true)
    expect(cropAngle(c)).toBe(90)
    const r = cropRect(photo, c)
    // Portrait, the photo's own size on its side, about its middle.
    expect(r).toEqual({ x: 200, y: -200, width: 800, height: 1200 })
    expect(insideTurned(c, photo, 90, 1)).toBe(true)
    expect(keepInside(c, photo)).toEqual(c)
    expect(cropRatio({ aspect: 'original', turned: false, quarter: 1 }, photo)).toBeCloseTo(800 / 1200)
  })
  it('the crop turns with the photo, and back', () => {
    const c = { ...whole, x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    const t = turnQuarter(c, 1)
    // The crop's corner at the photo's top left goes to its top right.
    const before = cropRect(photo, c)
    const after = cropRect(photo, t)
    const p = turnPx({ x: before.x, y: before.y }, photo, 90)
    expect(after.x + after.width).toBeCloseTo(p.x, -1)
    expect(after.y).toBeCloseTo(p.y, -1)
    const back = turnQuarter(t, -1)
    expect(back.x).toBeCloseTo(0.1)
    expect(back.y).toBeCloseTo(0.2)
    expect(back.width).toBeCloseTo(0.3)
    expect(back.height).toBeCloseTo(0.4)
    expect(back.quarter).toBe(0)
  })
  it('straightened on top of it, the crop keeps inside the turned photo', () => {
    const c = keepInside({ ...turnQuarter(whole, 1), angle: 6 }, photo)
    expect(insideTurned(c, photo, 96, 1)).toBe(true)
    expect(c.width).toBeLessThan(1)
    expect(cropAngle({ ...turnQuarter(turnQuarter(turnQuarter(whole, 1), 1), 1), angle: 2 })).toBe(-88)
  })
})
