import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS } from '../engine/types'
import { LOOKS } from './looks'
import { PALETTES_FOR, designedIn, paletteOf, palettesFor, withPalette } from './recipePalettes'

describe('recipe palettes', () => {
  it('every recipe with palettes comes in its first one, and is found in each it is put in', () => {
    for (const [id, palettes] of Object.entries(PALETTES_FOR)) {
      const look = LOOKS.find((l) => l.id === id)
      expect(look, id).toBeTruthy()
      expect(paletteOf(look!.doc.blend, palettes)?.id, id).toBe(palettes[0].id)
      for (const p of palettes) expect(paletteOf(withPalette(look!.doc.blend, p), palettes)?.id, `${id}/${p.id}`).toBe(p.id)
    }
  })

  it('a recipe in another of its palettes reads as the recipe as designed', () => {
    for (const [id, palettes] of Object.entries(PALETTES_FOR)) {
      const doc = LOOKS.find((l) => l.id === id)!.doc.blend
      for (const p of palettes) {
        const blend = withPalette(doc, p)
        expect(JSON.stringify(designedIn(doc, blend, palettes)), `${id}/${p.id}`).toBe(JSON.stringify(blend))
      }
    }
  })

  it('changes only the colours, keeping the strength the recipe set', () => {
    const stipple = LOOKS.find((l) => l.id === 'stipple-tide')!.doc.blend
    const next = withPalette(stipple, palettesFor('stipple-tide')[1])
    expect(next.effects.grade.mapAmount).toBe(stipple.effects.grade.mapAmount)
    expect(next.effects.halation).toBe(stipple.effects.halation)
    expect(next.effects.dither).toEqual(stipple.effects.dither)
  })

  it("Grit's Its colour takes the photo's own colour on top, and Ice is fixed", () => {
    const grit = palettesFor('grit')
    const own = withPalette(DEFAULT_BLEND_PARAMS, grit.find((p) => p.id === 'own-colour')!)
    expect(own.effects.grade.mapHigh.source).toBe('accent')
    expect(withPalette(own, grit[0]).effects.grade.mapHigh.source).toBe('manual')
  })

  it('no recipe borrows another recipe\'s palette', () => {
    const seen = new Map<string, string>()
    for (const [id, palettes] of Object.entries(PALETTES_FOR))
      for (const p of palettes) {
        expect(seen.get(p.id), `${p.id} in ${id} and ${seen.get(p.id)}`).toBeUndefined()
        seen.set(p.id, id)
      }
  })

  it('recipes without colours of their own have no palettes', () => {
    expect(palettesFor('pushed')).toEqual([])
    expect(palettesFor(null)).toEqual([])
  })
})
