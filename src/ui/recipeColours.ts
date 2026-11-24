import type { Palette } from '../engine/palette'
import { mergeGrade, ruleColours, sameRule, type ColourRule } from '../engine/recipe'
import type { BlendParams, GradeParams, Rgb } from '../engine/types'
import type { Trio } from '../engine/harmony'
import { shapedColours } from '../engine/shapedPalette'

/**
 * The recipe in use, in other colours: the gradient map's three colours
 * swapped, everything else the recipe does (texture, glow, tone) left as it
 * is. Fixed sets of colours, and a few built from the photo's own colours
 * (engine/recipe.ts), worked out again on every photo.
 */
export interface RecipeColours {
  id: string
  name: string
  hint: string
  /** Shadow, middle and light, sRGB. */
  fixed?: Trio<Rgb>
  /** Built from the photo (a built-in palette's rule). */
  rule?: ColourRule
}

/** Built from the photo in Tide's build (shapedPalette.ts): its colour on the highlight, the opposite in the middle. */
const fromPhoto = (from: 'light'): ColourRule => ({ from, harmony: 'complementary', lead: 2, turn: 0, richness: 1, shape: 'tide' })

/**
 * Tide first, as it was. Every set is built as Tide is (shapedPalette.ts)
 * and keeps what makes it look natural: warm light over cool shade, as
 * sunlight over shade lit by the sky, so skin and sunsets stay warm and
 * water and shadow cool. They differ as film stocks do: how warm the light
 * is, which blue or green the shade is, and how rich or soft the colours.
 */
export const RECIPE_COLOURS: RecipeColours[] = [
  { id: 'tide', name: 'Tide', hint: 'Navy, teal and orange', fixed: [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [1, 0.52, 0.18]] },
  { id: 'own-light', name: 'Its light', hint: "The photo's own light colour on top, the shade across from it below", rule: fromPhoto('light') },
  { id: 'golden', name: 'Golden', hint: 'Navy, slate blue and gold', fixed: shapedColours(212, 40, { midSat: 0.6, highSat: 0.8, highLuma: 0.62 }) },
  { id: 'peach', name: 'Peach', hint: 'Indigo, dusty blue and peach', fixed: shapedColours(222, 16, { midSat: 0.5, highSat: 0.55, highLuma: 0.66 }) },
  { id: 'pine', name: 'Pine', hint: 'Deep blue, pine green and cream', fixed: shapedColours(172, 42, { midSat: 0.6, highSat: 0.5, highLuma: 0.7, shadowHue: 200 }) },
  { id: 'ember', name: 'Ember', hint: 'Navy, teal and red-orange', fixed: shapedColours(192, 10, { midSat: 0.72, highSat: 0.8, highLuma: 0.55 }) },
  { id: 'soft', name: 'Soft', hint: 'Slate, grey-blue and warm beige, low colour', fixed: shapedColours(205, 28, { midSat: 0.35, highSat: 0.5, highLuma: 0.68 }) },
  { id: 'pale', name: 'Pale', hint: 'Black, steel blue and warm white', fixed: shapedColours(212, 38, { midSat: 0.45, highSat: 0.22, highLuma: 0.78 }) },
]

/** The colours a set gives on this photo, shadow first. */
export function coloursOn(c: RecipeColours, palette: Palette): Trio<Rgb> {
  return c.fixed ?? ruleColours(c.rule!, palette)
}

/** How strong the map is when colours are picked with none on: as strong as the stippled recipes have it. */
const NEW_STRENGTH = 0.9

/** The edit in these colours: only the gradient map changes, turned on if it was off. */
export function withColours(blend: BlendParams, c: RecipeColours): BlendParams {
  const grade = blend.effects.grade
  const strength: Partial<GradeParams> = grade.mapAmount > 0 && blend.modules.colour ? {} : { mapAmount: NEW_STRENGTH }
  const manual = (colour: Rgb) => ({ source: 'manual' as const, colour })
  const next = c.fixed
    ? mergeGrade(grade, { ...strength, mapShadow: manual(c.fixed[0]), mapMid: manual(c.fixed[1]), mapHigh: manual(c.fixed[2]), mapHarmony: 'free' })
    : mergeGrade(grade, { ...strength, recipe: c.rule, mapHarmony: c.rule!.harmony })
  return { ...blend, modules: { ...blend.modules, colour: true }, effects: { ...blend.effects, grade: next } }
}

const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3)

/** The set the edit's map is in, if exactly one of them. */
export function coloursOf(blend: BlendParams): string | null {
  const g = blend.effects.grade
  if (!blend.modules.colour || g.mapAmount <= 0) return null
  if (g.recipe) return RECIPE_COLOURS.find((c) => c.rule && sameRule(c.rule, g.recipe))?.id ?? null
  const slots = [g.mapShadow, g.mapMid, g.mapHigh]
  if (slots.some((s) => s.source !== 'manual')) return null
  return RECIPE_COLOURS.find((c) => c.fixed && c.fixed.every((f, i) => near(f, slots[i].colour)))?.id ?? null
}
