import { describe, expect, it } from 'vitest'
import { DEFAULT_MASK, STREAK_DEFAULTS, type BlendParams } from '../engine/types'
import { NONE_LOOK } from './looks'
import { inUse, startModule } from './moduleCatalog'
import { clipOf, pasteClip, partsOf } from './editClip'

const none = NONE_LOOK.doc.blend
const grain = NONE_LOOK.doc.grainSource
const edit = (b: BlendParams) => ({ blend: b, grainSource: grain })
const streaked = (b: BlendParams): BlendParams => ({
  ...b,
  effects: {
    ...b.effects,
    masks: [...b.effects.masks, { ...DEFAULT_MASK, id: 's1', name: 'Subject', outline: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.6 }], owner: 'streak' }],
    streaks: { ...b.effects.streaks, enabled: true, shapes: [{ ...STREAK_DEFAULTS, mode: 'trail', outline: [{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }, { x: 0.4, y: 0.6 }], seed: 1, subject: { mask: 's1', inset: 0 } }] },
  },
})

describe('copying and pasting an edit', () => {
  const from = streaked(startModule('colour', startModule('grain', none)))
  it('offers what the edit uses, its look chosen and its placed things not', () => {
    expect(partsOf(from)).toEqual(expect.arrayContaining(['grain', 'colour', 'streaks']))
    const clip = clipOf('a.jpg', edit(from))
    expect(clip.parts).toContain('grain')
    expect(clip.parts).toContain('colour')
    expect(clip.parts).not.toContain('streaks')
  })
  it('pasting the whole look gives its modules and switches off the rest, leaving placed things', () => {
    const into = startModule('tone', none)
    const out = pasteClip(clipOf('a.jpg', edit(from)), edit(into)).blend
    expect(inUse('grain', out)).toBe(true)
    expect(inUse('colour', out)).toBe(true)
    expect(inUse('tone', out)).toBe(false)
    expect(inUse('streaks', out)).toBe(false)
  })
  it('pasting some parts changes only those', () => {
    const into = startModule('tone', none)
    const out = pasteClip({ ...clipOf('a.jpg', edit(from)), parts: ['grain'] }, edit(into)).blend
    expect(inUse('grain', out)).toBe(true)
    expect(inUse('tone', out)).toBe(true)
    expect(inUse('colour', out)).toBe(false)
  })
  it('a placed thing, chosen, comes with its own masks', () => {
    const out = pasteClip({ ...clipOf('a.jpg', edit(from)), parts: ['streaks'] }, edit(none)).blend
    expect(inUse('streaks', out)).toBe(true)
    expect(out.effects.masks.filter((m) => m.owner === 'streak').map((m) => m.id)).toEqual(['s1'])
  })
  it('a base correction pastes its own settings only', () => {
    const lit = { ...none, effects: { ...none.effects, base: { ...none.effects.base, exposure: 0.5, temperature: 0.3, lightOn: true, colourOn: true } } }
    const out = pasteClip({ ...clipOf('a.jpg', edit(lit)), parts: ['exposure'] }, edit(none)).blend
    expect(out.effects.base.exposure).toBe(0.5)
    expect(out.effects.base.temperature).toBe(none.effects.base.temperature)
  })
})
