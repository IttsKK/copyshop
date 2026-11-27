import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS } from '../engine/types'
import { DEFAULT_SURFACE } from '../engine/surface'
import { LOOKS, NONE_LOOK } from './looks'
import { editUsage } from './usageSummary'

describe('editUsage', () => {
  it('names the recipe: built-in by id, yours as own, else none', () => {
    const recipe = (look: typeof NONE_LOOK | null, presetId: string) => editUsage(DEFAULT_BLEND_PARAMS, look, presetId).find(([a]) => a === 'recipe')?.[1]
    expect(recipe(NONE_LOOK, '')).toBe('none')
    expect(recipe(null, 'p-123')).toBe('own')
    expect(recipe(LOOKS[0], '')).toBe(LOOKS[0].id)
  })

  it('lists modules in use and streak kinds, built-in names only', () => {
    for (const look of LOOKS) {
      const blend = look.doc.blend
      const rows = editUsage(blend, look, '')
      for (const [a, b] of rows) {
        expect(a).toMatch(/^[a-z]+( [a-z]+)?$/)
        if (b != null) expect(b).toMatch(/^[\w .:/-]{1,64}$/)
      }
      if (blend.effects.streaks.enabled && blend.effects.streaks.shapes.length) expect(rows.some(([a]) => a.startsWith('streak '))).toBe(true)
    }
  })

  it('says which dither dots, surface and picked colours an edit uses', () => {
    const b = DEFAULT_BLEND_PARAMS
    const e = b.effects
    const blend = {
      ...b,
      modules: { ...b.modules, dither: true, surface: true, colour: true },
      effects: {
        ...e,
        dither: { ...e.dither, enabled: true, amount: 0.8, pixel: 4, pattern: 'ordered' as const, blendOnly: true, followGrain: false },
        surface: { ...DEFAULT_SURFACE, enabled: true, kind: 'canvas' as const },
        grade: { ...e.grade, picks: [{ id: 'a', colour: [1, 0, 0] as [number, number, number], action: 'keep' as const, to: [0, 0, 1] as [number, number, number], range: 0.4, amount: 1 }] },
      },
    }
    const rows = new Map(editUsage(blend, null, ''))
    expect(rows.get('dither')).toBe('pixel/ordered/blend')
    expect(rows.get('surface')).toBe('canvas')
    expect(rows.get('picks')).toBe('keep')
  })
})
