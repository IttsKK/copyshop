import { expect, it } from 'vitest'
import { parsePreset } from './presets'
import { DEFAULT_DITHER } from '../engine/types'
import { LOOKS } from '../ui/looks'
import stipple from '../../presets/vibe-stipple.json'

const ditherOf = (dither: Record<string, unknown>) =>
  parsePreset({ ...stipple, blend: { ...stipple.blend, effects: { ...stipple.blend.effects, dither } } }).blend.effects.dither

it("an edit saved before the dither had dots of its own keeps taking them from the grain; a new one doesn't", () => {
  expect(DEFAULT_DITHER.followGrain).toBe(false)
  expect(ditherOf({ amount: 0.5 }).followGrain).toBe(true)
  expect(ditherOf({ amount: 0.5, followGrain: false }).followGrain).toBe(false)
  expect(ditherOf({ ...DEFAULT_DITHER, amount: 0.5 }).followGrain).toBe(false)
})

it('every recipe with a dither has dots of its own, which grain settings leave alone', () => {
  const dithered = LOOKS.filter((l) => l.doc.blend.effects.dither.amount > 0)
  expect(dithered.length).toBeGreaterThan(0)
  for (const l of dithered) expect([l.id, l.doc.blend.effects.dither.followGrain]).toEqual([l.id, false])
})
