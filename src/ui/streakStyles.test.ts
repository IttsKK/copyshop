import { describe, expect, it } from 'vitest'
import { STREAK_DEFAULTS, type StreakShape } from '../engine/types'
import { FINISHES, STREAK_STYLES, finishOf, styleOf, stylePatch, variedBars } from './streakStyles'

describe('stylePatch', () => {
  const smear = STREAK_STYLES[0].patch
  const shape = { length: 0.35 } as StreakShape

  it('leaves a streak that never had Extend alone', () => {
    expect(stylePatch(shape, smear)).toBe(smear)
  })

  it('gives back the length from before Extend', () => {
    const extended = { ...shape, length: 2, lengthBeforeExtend: 0.35 } as StreakShape
    const patch = stylePatch(extended, smear)
    expect(patch.length).toBe(0.35)
    expect(patch.lengthBeforeExtend).toBeUndefined()
    expect({ ...extended, ...patch }.length).toBe(0.35)
  })
})

describe('variedBars', () => {
  const base = { ...STREAK_DEFAULTS, outline: [], mode: 'trail', seed: 1 } as StreakShape

  it('keeps every style its own, whatever the seed', () => {
    for (const st of STREAK_STYLES)
      for (let seed = 0; seed < 400; seed += 7) {
        const shape = { ...base, ...variedBars(st.patch, seed) }
        expect(styleOf(shape)).toBe(st.id)
        if (FINISHES.includes(st.id)) expect(finishOf(shape)).toBe(st.id)
      }
  })

  it('makes two streaks in one style differ', () => {
    const a = variedBars(STREAK_STYLES[0].patch, 1)
    const b = variedBars(STREAK_STYLES[0].patch, 2)
    expect(a.band).not.toBe(b.band)
  })

  it('keeps even lengths and square ends', () => {
    const even = STREAK_STYLES.find((s) => s.id === 'even')!.patch
    const v = variedBars(even, 5)
    expect(v.lengthMin).toBe(1)
    expect(v.endSoftness).toBe(0)
  })
})
