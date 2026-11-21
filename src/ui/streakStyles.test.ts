import { describe, expect, it } from 'vitest'
import type { StreakShape } from '../engine/types'
import { STREAK_STYLES, stylePatch } from './streakStyles'

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
