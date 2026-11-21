import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS } from '../engine/types'
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
})
