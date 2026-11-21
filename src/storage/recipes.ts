import type { ColourRule } from '../engine/recipe'
import type { GradeParams } from '../engine/types'
import { PART_STORE, getAll, newId, put, remove } from './db'

/**
 * Colour recipes (engine/recipe.ts): a palette rule and how strongly it is
 * laid on. Kept beside the section presets, as their own kind, so they back
 * up and sync with them.
 */
export type RecipeLook = Pick<GradeParams, 'mapAmount' | 'mapContrast' | 'mapBalance' | 'vibrance' | 'warmth' | 'tint'>

export interface ColourRecipe {
  id: string
  kind: 'recipe'
  name: string
  hint?: string
  rule: ColourRule
  look: RecipeLook
  updatedAt: number
  builtIn?: boolean
  /** Saved with Vibrance, Warmth and Tint on the palette's colours (schema 6); missing: before. */
  after?: boolean
}

const look = (mapAmount: number, mapContrast = 0, mapBalance = 0, extra: Partial<RecipeLook> = {}): RecipeLook => ({
  mapAmount,
  mapContrast,
  mapBalance,
  vibrance: 0,
  warmth: 0,
  tint: 0,
  ...extra,
})

/** `was`: the name the id was made from, kept when a palette is renamed so saved edits still find it. */
const builtIn = (name: string, hint: string, rule: ColourRule, l: RecipeLook, was = name): ColourRecipe => ({
  id: `builtin-recipe-${was.toLowerCase().replace(/\W+/g, '-')}`,
  kind: 'recipe',
  name,
  hint,
  rule,
  look: l,
  updatedAt: 0,
  builtIn: true,
})

/**
 * Built-in recipes, deliberately far apart: different photo colours lead,
 * different harmonies, rich and quiet, so the row offers real choices rather
 * than one safe look in several strengths.
 */
export const BUILT_IN_RECIPES: ColourRecipe[] = [
  builtIn('Highlight colour', "The photo's highlight colour across all tones", { from: 'light', harmony: 'analogous', lead: 2, turn: 0, richness: 1 }, look(0.5, 0.1, 0, { vibrance: 0.05 }), 'Its own light'),
  builtIn('Highlight and opposite', "The highlight colour in the highlights, its complement in the shadows", { from: 'light', harmony: 'complementary', lead: 2, turn: 0, richness: 1.1 }, look(0.7, 0.2, 0.1), 'Light & opposite'),
  builtIn('Shadow colour', "The shadow colour across all tones, cool and dark", { from: 'shadow', harmony: 'mono', lead: 0, turn: 0, richness: 0.85 }, look(0.65, 0.15, -0.2, { warmth: -0.05 }), 'Moonlit'),
  builtIn('Main colour and neighbours', "The main colour and its neighbouring hues", { from: 'accent', harmony: 'analogous', lead: 1, turn: 0, richness: 1 }, look(0.6, 0, 0, { vibrance: 0.06 }), 'Echo'),
  builtIn('Standout colour, split', "The most vivid colour in the highlights, split complements in the shadows", { from: 'vivid', harmony: 'split', lead: 2, turn: 0, richness: 1.1 }, look(0.65, 0.25), 'Standout split'),
  builtIn('Triad', "Three hues evenly spaced from the main colour", { from: 'accent', harmony: 'triad', lead: 1, turn: 0, richness: 1.2 }, look(0.5, 0.1, 0, { vibrance: 0.1 })),
  builtIn('Pale highlight colour', "One pale colour from the highlights, low contrast", { from: 'light', harmony: 'mono', lead: 2, turn: 0, richness: 0.45 }, look(0.5, -0.35, 0.2), 'Faded print'),
  builtIn('Highlight colour in shadows', "The highlight colour in the shadows, its complement on top", { from: 'light', harmony: 'complementary', lead: 0, turn: 0, richness: 1 }, look(0.7, 0.2, -0.1), 'Night swap'),
  builtIn('Highlight colour, warmer', "The highlight colour, warmer and richer", { from: 'light', harmony: 'analogous', lead: 2, turn: 0.06, richness: 1.25 }, look(0.6, 0.1, 0, { warmth: 0.06 }), 'Warmer'),
]

export async function listRecipes(): Promise<ColourRecipe[]> {
  let mine: ColourRecipe[] = []
  try {
    mine = (await getAll<ColourRecipe>(PART_STORE)).filter((r) => r.kind === 'recipe')
  } catch {
    /* storage unavailable: the built-in recipes still work */
  }
  mine.sort((a, b) => a.name.localeCompare(b.name))
  // Saved before Vibrance, Warmth and Tint worked on the palette's colours
  // (see parsePreset): scaled to what they did then.
  mine = mine.map((r) => {
    if (r.after || r.builtIn) return r
    const m = r.look.mapAmount
    const k = (v: number) => Math.round(v * (1 - m) * 1000) / 1000
    return { ...r, look: { ...r.look, vibrance: k(r.look.vibrance), warmth: k(r.look.warmth), tint: k(r.look.tint) } }
  })
  return [...BUILT_IN_RECIPES, ...mine]
}

export async function saveRecipe(name: string, rule: ColourRule, l: RecipeLook, id?: string): Promise<ColourRecipe> {
  const recipe: ColourRecipe = { id: id ?? newId('recipe'), kind: 'recipe', name, rule: structuredClone(rule), look: { ...l }, updatedAt: Date.now(), after: true }
  await put(PART_STORE, recipe)
  return recipe
}

export async function deleteRecipe(id: string): Promise<void> {
  await remove(PART_STORE, id)
}

export const lookOf = (g: GradeParams): RecipeLook => ({
  mapAmount: g.mapAmount,
  mapContrast: g.mapContrast,
  mapBalance: g.mapBalance,
  vibrance: g.vibrance,
  warmth: g.warmth,
  tint: g.tint,
})
