import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS } from '../engine/types'
import { RECIPE_COLOURS, coloursOf, withColours } from './recipeColours'

describe('recipe colours', () => {
  it('each set is found again on the edit it makes', () => {
    for (const c of RECIPE_COLOURS) expect(coloursOf(withColours(DEFAULT_BLEND_PARAMS, c))).toBe(c.id)
  })

  it('a fixed set after a photo one lets go of the photo rule', () => {
    const photo = withColours(DEFAULT_BLEND_PARAMS, RECIPE_COLOURS.find((c) => c.rule)!)
    const fixed = withColours(photo, RECIPE_COLOURS.find((c) => c.fixed)!)
    expect(fixed.effects.grade.recipe).toBeUndefined()
  })

  it('changes only the colours, keeping the strength the recipe set', () => {
    const blend = { ...DEFAULT_BLEND_PARAMS, modules: { ...DEFAULT_BLEND_PARAMS.modules, colour: true }, effects: { ...DEFAULT_BLEND_PARAMS.effects, halation: 0.4, grade: { ...DEFAULT_BLEND_PARAMS.effects.grade, mapAmount: 0.6 } } }
    const next = withColours(blend, RECIPE_COLOURS[3])
    expect(next.effects.grade.mapAmount).toBe(0.6)
    expect(next.effects.halation).toBe(0.4)
  })

  it('turns the map on when there was none', () => {
    expect(withColours(DEFAULT_BLEND_PARAMS, RECIPE_COLOURS[3]).effects.grade.mapAmount).toBeGreaterThan(0.5)
  })
})
