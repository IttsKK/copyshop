import { describe, expect, it } from 'vitest'
import { STREAK_DEFAULTS, type StreakShape } from '../engine/types'
import { kindOf, kindPatch, startingCurve } from './streakKinds'

const base: StreakShape = { ...STREAK_DEFAULTS, outline: [], mode: 'trail', seed: 7 }

describe('streak kinds', () => {
  it('reads each kind from the settings', () => {
    expect(kindOf(base)).toBe('straight')
    expect(kindOf({ ...base, converge: 0.3 })).toBe('building')
    expect(kindOf({ ...base, radial: true })).toBe('radial')
    expect(kindOf({ ...base, radial: true, radialAround: true })).toBe('circle')
    expect(kindOf({ ...base, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }] })).toBe('curve')
  })

  it('turns a streak into each kind', () => {
    for (const k of ['building', 'straight', 'radial', 'circle', 'curve'] as const) {
      const { patch } = kindPatch({ ...base, seed: 100 }, k)
      const s = { ...base, ...patch }
      // Building and Curve still need their lines or path: they start plain.
      expect(kindOf(s)).toBe(k === 'building' || k === 'curve' ? 'straight' : k)
    }
  })

  it('keeps what a kind had while another is tried', () => {
    const building = { ...base, seed: 200, converge: 0.4, angle: -80 }
    const toCurve = kindPatch(building, 'curve')
    const curved = { ...building, ...toCurve.patch, path: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }
    expect(kindOf(curved)).toBe('curve')
    const back = kindPatch(curved, 'building')
    expect(back.fresh).toBe(false)
    const again = { ...curved, ...back.patch }
    expect(kindOf(again)).toBe('building')
    expect(again.converge).toBe(0.4)
    expect(again.angle).toBe(-80)
    // And the curve is kept for the next time.
    expect(kindPatch(again, 'curve').fresh).toBe(false)
  })
})

describe('a first curve', () => {
  it('runs from the streak’s middle the way it points, bowed', () => {
    const s = { ...base, angle: -90, outline: [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 }, { x: 0.6, y: 0.6 }, { x: 0.4, y: 0.6 }] }
    const path = startingCurve(s, 1.5)
    expect(path).toHaveLength(3)
    expect(path[0]).toEqual({ x: 0.5, y: 0.5 })
    // Up the photo, and the middle point off the straight line.
    expect(path[2].y).toBeLessThan(0.5)
    expect(Math.abs(path[2].x - 0.5)).toBeLessThan(1e-9)
    expect(Math.abs(path[1].x - 0.5)).toBeGreaterThan(0.01)
    expect(kindOf({ ...s, path })).toBe('curve')
  })
})
