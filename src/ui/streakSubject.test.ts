import { describe, expect, it } from 'vitest'
import { encodeRaster } from '../engine/maskRaster'
import { STREAK_DEFAULTS, type MaskRaster, type StreakShape } from '../engine/types'
import { guessFlow, subjectOutline } from './streakSubject'
import { STREAK_STYLES, styleOf } from './streakStyles'

/** A raster over the whole photo with a block set from (x0, y0) to (x1, y1), in cells. */
function block(w: number, h: number, x0: number, y0: number, x1: number, y1: number): MaskRaster {
  const grid = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * w + x] = 1
  return { w, h, runs: encodeRaster(grid, w, h), x: 0, y: 0, width: 1, height: 1 }
}

// A 200 x 200 px photo, one px a cell, measured in its short side.
const space = { frame: { x: 0, y: 0, width: 200, height: 200 }, measure: { x: 0, y: 0, unit: 200 } }

describe('subject streaks', () => {
  it('trace the subject a little inside its edge', () => {
    const r = block(200, 200, 50, 60, 150, 200)
    const out = subjectOutline(r, 0.05, space)!
    expect(out.length).toBeGreaterThanOrEqual(4)
    const xs = out.map((p) => p.x)
    const ys = out.map((p) => p.y)
    // 0.05 of the short side is 10 cells in from each side.
    expect(Math.min(...xs)).toBeGreaterThan(0.29)
    expect(Math.max(...xs)).toBeLessThan(0.71)
    expect(Math.min(...ys)).toBeGreaterThan(0.34)
  })

  it('go up from a subject standing on the bottom edge, as far as the top', () => {
    const flow = guessFlow(block(200, 200, 80, 100, 120, 200), space)
    expect(flow.angle).toBe(-90)
    expect(flow.length).toBeCloseTo(0.51, 2)
  })

  it('go away from a subject coming in from one side', () => {
    expect(guessFlow(block(200, 200, 0, 80, 60, 120), space).angle).toBe(0)
    expect(guessFlow(block(200, 200, 150, 80, 200, 120), space).angle).toBe(180)
  })

  it('go the way with most room when the subject reaches the top', () => {
    expect(guessFlow(block(200, 200, 120, 0, 160, 190), space).angle).toBe(180)
  })

  it('know the style a streak is in', () => {
    const base = { ...STREAK_DEFAULTS, outline: [], mode: 'trail', seed: 1 } as StreakShape
    for (const st of STREAK_STYLES) expect(styleOf({ ...base, ...st.patch })).toBe(st.id)
    expect(styleOf({ ...base, ...STREAK_STYLES[0].patch, band: 0.02 })).toBeNull()
  })
})
