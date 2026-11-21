import { describe, expect, it } from 'vitest'
import { STREAK_DEFAULTS, type StreakShape } from '../engine/types'
import { pasteStreakSettingsOnto, streakSettingsOf } from './streakClip'

const base = (patch: Partial<StreakShape>): StreakShape =>
  ({ ...STREAK_DEFAULTS, outline: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], angle: -90, fixes: [], maskIds: [], maskMode: 'off', ...patch }) as StreakShape

describe('copying a streak’s settings', () => {
  it('takes its look and leaves where it is', () => {
    const from = base({ band: 0.03, brightness: 0.5, mirror: true, angle: 10, outline: [{ x: 0.5, y: 0.5 }], seed: 7 })
    const onto = base({ band: 0.01, angle: 45, maskIds: ['m'], maskMode: 'exclude', seed: 3, subject: { mask: 'm', inset: 0.01 }, mode: 'trail' })
    const got = pasteStreakSettingsOnto(onto, streakSettingsOf(from))
    expect(got.band).toBe(0.03)
    expect(got.brightness).toBe(0.5)
    expect(got.mirror).toBe(true)
    expect(got.angle).toBe(45)
    expect(got.outline).toBe(onto.outline)
    expect(got.maskIds).toEqual(['m'])
    expect(got.seed).toBe(3)
    expect(got.subject).toEqual({ mask: 'm', inset: 0.01 })
    // A subject streak stays a trail off its subject.
    expect(got.mode).toBe('trail')
  })
  it('drops what the other did not have set', () => {
    const from = base({})
    const onto = base({ mirror: true, carry: 'repeat', repeatLength: 0.1 })
    const got = pasteStreakSettingsOnto(onto, streakSettingsOf(from))
    expect(got.mirror).toBeUndefined()
    expect(got.carry).toBeUndefined()
    expect(got.repeatLength).toBeUndefined()
  })
})
