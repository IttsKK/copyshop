import { expect, it } from 'vitest'
import { ownMasks } from './presets'
import { DEFAULT_EFFECTS, DEFAULT_MASK, STREAK_DEFAULTS, type EffectParams } from '../engine/types'
import { DEFAULT_REPEAT } from '../engine/repeatParams'

it('a mask used only as a streak’s subject, or only as Repeat’s piece, becomes theirs; one used elsewhere too stays listed', () => {
  const mask = (id: string) => ({ ...DEFAULT_MASK, id, name: id, outline: [] })
  const fx: EffectParams = {
    ...DEFAULT_EFFECTS,
    masks: [mask('subj'), mask('shared'), mask('piece'), mask('loose')],
    streaks: {
      ...DEFAULT_EFFECTS.streaks,
      shapes: [
        { ...STREAK_DEFAULTS, mode: 'trail', seed: 1, outline: [], subject: { mask: 'subj', inset: 0 }, maskIds: ['subj'], maskMode: 'exclude' },
        { ...STREAK_DEFAULTS, mode: 'trail', seed: 2, outline: [], subject: { mask: 'shared', inset: 0 }, maskIds: ['shared'], maskMode: 'exclude' },
      ],
    },
    maskUse: { grain: { ids: ['shared'], mode: 'only' } },
    repeat: { enabled: true, items: [{ ...DEFAULT_REPEAT, source: 'piece' }] },
  }
  const owners = Object.fromEntries(ownMasks(fx).masks.map((m) => [m.id, m.owner ?? null]))
  expect(owners).toEqual({ subj: 'streak', shared: null, piece: 'repeat', loose: null })
})
