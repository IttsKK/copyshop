import type { Palette } from '../engine/palette'
import { mergeGrade, ruleColours, sameRule, type ColourRule } from '../engine/recipe'
import type { BlendParams, ColourChoice, GradeParams, Rgb } from '../engine/types'
import type { HalftoneParams } from '../engine/extras'
import type { Trio } from '../engine/harmony'
import { shapedColours } from '../engine/shapedPalette'

/**
 * A recipe's palettes: the colours it comes in. Each recipe has a few picked
 * for it, the first the one it comes with, and a palette is whatever colours
 * that recipe uses: the gradient map for the dithered ones (fixed colours,
 * built from the photo, or some of each), the inks for the printed ones.
 * Picking one changes only those colours; texture, glow and tone stay.
 */
export interface RecipePalette {
  id: string
  name: string
  hint: string
  /** The gradient map's colours, shadow first: fixed, built from the photo by a rule, or as colour choices (any of them the photo's). */
  map?: { fixed?: Trio<Rgb>; rule?: ColourRule; choices?: Trio<ColourChoice> }
  /** The inks of a printed recipe (halftone, riso). */
  inks?: Pick<HalftoneParams, 'inkA' | 'inkB' | 'paper'>
}

const fixed = (id: string, name: string, hint: string, colours: Trio<Rgb>): RecipePalette => ({ id, name, hint, map: { fixed: colours } })
const manual = (colour: Rgb): ColourChoice => ({ source: 'manual', colour })

/*
 * The map palettes keep what makes Tide look natural: warm light over cool
 * shade, as sunlight over shade lit by the sky, built as Tide is
 * (shapedPalette.ts). They differ as film stocks do.
 */
const TIDE = fixed('tide', 'Tide', 'Navy, teal and orange', [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [1, 0.52, 0.18]])
const GOLDEN = fixed('golden', 'Golden', 'Navy, slate blue and gold', shapedColours(212, 40, { midSat: 0.6, highSat: 0.8, highLuma: 0.62 }))
const EMBER = fixed('ember', 'Ember', 'Navy, teal and red-orange', shapedColours(192, 10, { midSat: 0.72, highSat: 0.8, highLuma: 0.55 }))
const PALE = fixed('pale', 'Pale', 'Black, steel blue and warm white', shapedColours(212, 38, { midSat: 0.45, highSat: 0.22, highLuma: 0.78 }))
/** Grit's own: Tide's navy and teal under the photo's own main colour. */
const OWN_COLOUR: RecipePalette = {
  id: 'own-colour',
  name: 'Its colour',
  hint: "Navy and teal under the photo's own main colour",
  map: { choices: [manual([0.02, 0.05, 0.16]), manual([0.08, 0.36, 0.48]), { source: 'accent', colour: [1, 0.55, 0.2] }] },
}
/*
 * Grit's and Pixel's own: coarser textures carry bolder colours, so they
 * aren't held to warm-over-cool the way Stipple's are.
 */
const ICE = fixed('ice', 'Ice', 'Navy, teal and ice blue', [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [0.55, 0.8, 1]])
const RUST = fixed('rust', 'Rust', 'Black-brown, brick and cream', [[0.07, 0.03, 0.03], [0.55, 0.18, 0.08], [1, 0.82, 0.55]])
const SMOKE = fixed('smoke', 'Smoke', 'Black, warm grey and bone: no colour', [[0.04, 0.035, 0.03], [0.38, 0.35, 0.31], [0.95, 0.92, 0.85]])
const DUSK = fixed('dusk', 'Dusk', 'Navy, rose and peach', [[0.08, 0.1, 0.32], [0.78, 0.3, 0.45], [1, 0.78, 0.45]])
const LAGOON = fixed('lagoon', 'Lagoon', 'Navy, teal and pale yellow', [[0.03, 0.08, 0.22], [0.05, 0.55, 0.6], [1, 0.92, 0.6]])
const FIRE = fixed('fire', 'Fire', 'Black-red, orange and yellow', [[0.1, 0.02, 0.05], [0.85, 0.3, 0.1], [1, 0.85, 0.35]])
const GRAPE = fixed('grape', 'Grape', 'Deep purple, violet and peach', [[0.1, 0.04, 0.2], [0.55, 0.25, 0.6], [1, 0.75, 0.6]])

const PAPER: Rgb = [0.96, 0.94, 0.88]
const ink = (id: string, name: string, hint: string, inkA: Rgb, inkB: Rgb = [1, 0.36, 0.45]): RecipePalette => ({ id, name, hint, inks: { inkA, inkB, paper: PAPER } })

/** Each recipe's palettes, by its id, its own and no other's; the first is the one it comes with (its own settings). */
export const PALETTES_FOR: Record<string, RecipePalette[]> = {
  'stipple-tide': [TIDE, GOLDEN, EMBER, PALE],
  grit: [ICE, OWN_COLOUR, RUST, SMOKE],
  pixel: [DUSK, LAGOON, FIRE, GRAPE],
  copy: [
    ink('blue', 'Blue', 'Blue ink on paper', [0.12, 0.25, 0.62]),
    ink('black', 'Black', 'Black toner on paper', [0.08, 0.08, 0.09]),
    ink('red', 'Red', 'Red ink on paper', [0.78, 0.16, 0.16]),
    ink('green', 'Green', 'Green ink on paper', [0.05, 0.36, 0.28]),
  ],
  riso: [
    ink('teal-pink', 'Teal & pink', 'Teal and fluorescent pink', [0.0, 0.47, 0.58], [1, 0.36, 0.55]),
    ink('teal-orange', 'Teal & orange', 'Teal and orange', [0.0, 0.47, 0.51], [1, 0.42, 0.13]),
    ink('blue-pink', 'Blue & pink', 'Blue and pink', [0.12, 0.25, 0.62], [1, 0.36, 0.45]),
    ink('black-red', 'Black & red', 'Black and red', [0.1, 0.1, 0.12], [0.9, 0.18, 0.2]),
  ],
}

/** The palettes of the recipe with this id; none for recipes without colours of their own to change. */
export const palettesFor = (lookId: string | null | undefined): RecipePalette[] => (lookId ? (PALETTES_FOR[lookId] ?? []) : [])

/** Three colours to show for a palette on this photo. */
export function swatchOf(p: RecipePalette, palette: Palette): Trio<Rgb> {
  if (p.inks) return [p.inks.inkA, p.inks.inkB, p.inks.paper]
  const m = p.map!
  if (m.fixed) return m.fixed
  if (m.rule) return ruleColours(m.rule, palette)
  return m.choices!.map((c) => (c.source === 'manual' ? c.colour : palette[c.source])) as Trio<Rgb>
}

/** How strong the map is when a map palette is picked with none on: as strong as the stippled recipes have it. */
const NEW_STRENGTH = 0.9

/** The edit in this palette: only its colours change (the map turned on if it was off). */
export function withPalette(blend: BlendParams, p: RecipePalette): BlendParams {
  let next = blend
  if (p.map) {
    const grade = blend.effects.grade
    const strength: Partial<GradeParams> = grade.mapAmount > 0 && blend.modules.colour ? {} : { mapAmount: NEW_STRENGTH }
    const slots = p.map.fixed ? (p.map.fixed.map(manual) as Trio<ColourChoice>) : p.map.choices
    const g = slots
      ? mergeGrade(grade, { ...strength, mapShadow: slots[0], mapMid: slots[1], mapHigh: slots[2] })
      : mergeGrade(grade, { ...strength, recipe: p.map.rule, mapHarmony: p.map.rule!.harmony })
    next = { ...next, modules: { ...next.modules, colour: true }, effects: { ...next.effects, grade: g } }
  }
  if (p.inks) next = { ...next, effects: { ...next.effects, halftone: { ...next.effects.halftone, ...p.inks } } }
  return next
}

const near = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) < 1e-3)
const sameChoice = (a: ColourChoice, b: ColourChoice) => a.source === b.source && (a.source !== 'manual' || near(a.colour, b.colour))

/** Whether the edit is in this palette. */
function isIn(blend: BlendParams, p: RecipePalette): boolean {
  if (p.inks) {
    const h = blend.effects.halftone
    if (!near(h.inkA, p.inks.inkA) || !near(h.inkB, p.inks.inkB) || !near(h.paper, p.inks.paper)) return false
  }
  if (p.map) {
    const g = blend.effects.grade
    if (!blend.modules.colour || g.mapAmount <= 0) return false
    if (p.map.rule) return !!g.recipe && sameRule(p.map.rule, g.recipe)
    if (g.recipe) return false
    const want = p.map.fixed ? p.map.fixed.map(manual) : p.map.choices!
    return [g.mapShadow, g.mapMid, g.mapHigh].every((s, i) => sameChoice(s, want[i]))
  }
  return true
}

/** The one of these palettes the edit is in, if any. */
export function paletteOf(blend: BlendParams, palettes: RecipePalette[]): RecipePalette | null {
  return palettes.find((p) => isIn(blend, p)) ?? null
}

/**
 * A recipe as designed, in the palette the edit is in: picking one of its
 * palettes isn't changing the recipe. (The wheel's harmony shape follows
 * what was last picked, and isn't a change either.)
 */
export function designedIn(designed: BlendParams, blend: BlendParams, palettes: RecipePalette[]): BlendParams {
  const p = paletteOf(blend, palettes)
  if (!p) return designed
  const d = withPalette(designed, p)
  return { ...d, effects: { ...d.effects, grade: { ...d.effects.grade, mapHarmony: blend.effects.grade.mapHarmony } } }
}
