import type { Palette } from '../engine/palette'
import { mergeGrade, ruleColours, sameRule, type ColourRule } from '../engine/recipe'
import type { BlendParams, GradeParams, Rgb } from '../engine/types'
import type { Trio } from '../engine/harmony'
import { BUILT_IN_RECIPES } from '../storage/recipes'

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

const rule = (name: string) => BUILT_IN_RECIPES.find((r) => r.name === name)!.rule

export const RECIPE_COLOURS: RecipeColours[] = [
  // From the photo, first: they suit every photo, worked out from its own light.
  { id: 'own-light', name: 'Its light', hint: "The colour of the photo's own light across all tones", rule: rule('Highlight colour') },
  { id: 'light-opposite', name: 'Opposite', hint: "The photo's light colour on top, its opposite in the shadows", rule: rule('Highlight and opposite') },
  { id: 'opposite-on-top', name: 'Flipped', hint: "The photo's light colour in the shadows, its opposite on top", rule: rule('Highlight colour in shadows') },
  // Fixed: the same on every photo.
  { id: 'tide', name: 'Tide', hint: 'Navy, teal and orange', fixed: [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [1, 0.52, 0.18]] },
  { id: 'violet', name: 'Violet', hint: 'Blue, violet and amber', fixed: [[0.035, 0.161, 0.245], [0.238, 0.136, 0.544], [1, 0.8, 0.2]] },
  { id: 'gold', name: 'Gold', hint: 'Slate and gold', fixed: [[0.094, 0.131, 0.206], [0.248, 0.329, 0.492], [1, 0.74, 0.18]] },
  { id: 'silver', name: 'Silver', hint: 'Black, steel blue and white', fixed: [[0.02, 0.03, 0.07], [0.3, 0.5, 0.78], [0.96, 0.98, 1]] },
  { id: 'dusk', name: 'Dusk', hint: 'Navy, rose and peach', fixed: [[0.08, 0.1, 0.32], [0.78, 0.3, 0.45], [1, 0.78, 0.45]] },
  { id: 'moss', name: 'Moss', hint: 'Forest green, sage and cream', fixed: [[0.04, 0.08, 0.05], [0.27, 0.4, 0.24], [0.98, 0.92, 0.7]] },
  { id: 'rust', name: 'Rust', hint: 'Brown, brick red and butter', fixed: [[0.1, 0.04, 0.035], [0.6, 0.2, 0.1], [1, 0.86, 0.5]] },
  { id: 'coral', name: 'Coral', hint: 'Deep teal, sea green and coral', fixed: [[0.02, 0.09, 0.1], [0.14, 0.4, 0.4], [1, 0.6, 0.52]] },
  { id: 'sepia', name: 'Sepia', hint: 'Dark brown, tan and cream', fixed: [[0.08, 0.05, 0.03], [0.45, 0.32, 0.2], [1, 0.93, 0.8]] },
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
