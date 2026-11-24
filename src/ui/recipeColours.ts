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
 * Tide first, as it was. The rest are built as Tide is, in other pairs of
 * hues (shapedPalette.ts), so they hold up on as many photos; Silver is the
 * one without a colour.
 */
export const RECIPE_COLOURS: RecipeColours[] = [
  { id: 'tide', name: 'Tide', hint: 'Navy, teal and orange', fixed: [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [1, 0.52, 0.18]] },
  { id: 'own-light', name: 'Its light', hint: "The photo's own light colour on top, its opposite in the middle", rule: fromPhoto('light') },
  { id: 'amber', name: 'Amber', hint: 'Indigo, blue and amber', fixed: shapedColours(218, 38) },
  { id: 'coral', name: 'Coral', hint: 'Navy, steel blue and coral', fixed: shapedColours(205, 8) },
  { id: 'rose', name: 'Rose', hint: 'Black-green, jade and rose', fixed: shapedColours(165, 330) },
  { id: 'violet', name: 'Violet', hint: 'Plum, violet and gold', fixed: shapedColours(268, 40) },
  { id: 'forest', name: 'Forest', hint: 'Black-green, green and salmon', fixed: shapedColours(135, 18) },
  { id: 'silver', name: 'Silver', hint: 'Black, steel blue and white: no colour on top', fixed: [[0.02, 0.03, 0.07], [0.3, 0.5, 0.78], [0.96, 0.98, 1]] },
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
