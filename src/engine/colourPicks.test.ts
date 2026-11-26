import { describe, expect, it } from 'vitest'
import { parsePreset } from '../storage/presets'
import { DEFAULT_BLEND_PARAMS } from './types'
import { hsvOf, livePicks, MAX_PICKS, newPick } from './colourPicks'

const doc = (grade: Record<string, unknown>) => ({
  schemaVersion: 7,
  name: 't',
  grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
  blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_BLEND_PARAMS.effects, grade: { ...DEFAULT_BLEND_PARAMS.effects.grade, ...grade } } },
})

describe('Picked colours', () => {
  it('are none in an edit made before them', () => {
    expect(parsePreset(doc({})).blend.effects.grade.picks).toBeUndefined()
  })

  it('read back what they were saved with, kept in range', () => {
    const picks = [{ id: 'a', colour: [0.8, 0.1, 0.1], action: 'change', to: [0.1, 0.3, 2], range: 3, amount: 0.5 }, { id: 'b', colour: 'red', action: 'melt' }]
    const got = parsePreset(doc({ picks })).blend.effects.grade.picks!
    expect(got[0]).toEqual({ id: 'a', colour: [0.8, 0.1, 0.1], action: 'change', to: [0.1, 0.3, 1], range: 1, amount: 0.5 })
    expect(got[1].action).toBe('keep')
    expect(got[1].colour).toEqual([0.5, 0.5, 0.5])
  })

  it(`are at most ${MAX_PICKS}, and one at no strength does nothing`, () => {
    const many = Array.from({ length: 7 }, (_, i) => newPick([0.5, 0.2, 0.1], i))
    expect(parsePreset(doc({ picks: many })).blend.effects.grade.picks).toHaveLength(MAX_PICKS)
    expect(livePicks([{ ...many[0], amount: 0 }, many[1]])).toHaveLength(1)
  })

  it('give the shader hue, saturation and value as rgb2hsv does', () => {
    expect(hsvOf([1, 0, 0])).toEqual([0, 1, 1])
    const [h, s, v] = hsvOf([0, 0.5, 1])
    expect(h).toBeCloseTo(7 / 12)
    expect(s).toBe(1)
    expect(v).toBe(1)
    expect(hsvOf([0.4, 0.4, 0.4])).toEqual([0, 0, 0.4])
  })
})
