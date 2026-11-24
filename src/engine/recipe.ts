import { guidedMove, toneColours, wheelPoint, type Harmony, type Trio, type WheelPoint } from './harmony'
import type { Palette } from './palette'
import { shapedColours } from './shapedPalette'
import type { Rgb } from './types'

/**
 * Colour recipes: a palette described by where its colours come from rather
 * than by the colours themselves. "The light's own colour on the highlights,
 * its opposite in the shadows" makes a palette that belongs to every photo it
 * is used on — a sunset gets amber over blue, an overcast street pale cream
 * over slate — and it is worked out again for each photo at render time, so a
 * batch gets each photo's own version.
 *
 * The lead colour is read from the photo, turned and made richer or quieter,
 * and the other two are laid out from it by the palette wheel's guided layout
 * (harmony.ts, guidedMove): the harmony's hues, the lighter colour on the
 * light tones, the shade leaning cool and the light warm.
 */
export type RecipeFrom = 'light' | 'shadow' | 'accent' | 'vivid' | 'fixed'
export type RecipeHarmony = Exclude<Harmony, 'free'>

export interface ColourRule {
  /** Which of the photo's colours leads, or a fixed colour. */
  from: RecipeFrom
  /** The lead colour when `from` is fixed, sRGB. */
  fixed?: Rgb
  harmony: RecipeHarmony
  /** The tone the lead colour goes on: 0 shadows, 1 midtones, 2 light. */
  lead: 0 | 1 | 2
  /** Hue turn applied to the photo's colour, in turns (-0.5..0.5). */
  turn: number
  /** How rich the colours are, 0..MAX_RICHNESS; 1 is the recipe's natural depth. */
  richness: number
  /**
   * 'tide': built as Tide is (shapedPalette.ts), the lead colour's hue on the
   * highlight and its opposite in the middle, instead of the harmony layout.
   */
  shape?: 'tide'
}

export const RECIPE_FROM: { id: RecipeFrom; label: string; hint: string }[] = [
  { id: 'light', label: 'Light', hint: "The colour of the photo's light: its brightest tenth" },
  { id: 'shadow', label: 'Shade', hint: "The colour of the photo's darkest quarter" },
  { id: 'accent', label: 'Main colour', hint: 'The most widespread strong colour, like a big sky' },
  { id: 'vivid', label: 'Standout', hint: 'The colour that stands out most, like a red coat' },
  { id: 'fixed', label: 'Fixed', hint: 'The same colour on every photo' },
]

/** Enough to take even a grey photo's colour to full depth. */
export const MAX_RICHNESS = 4.5

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const turnOf = (h: number) => ((h % 1) + 1) % 1
/** How rich the lead colour comes out at richness 1, on this photo. */
const naturalSat = (base: WheelPoint) => 0.22 + base.sat * 0.6

/** The lead colour of a rule on a photo, before the layout. */
export function recipeLead(rule: ColourRule, palette: Palette): Rgb {
  if (rule.from === 'fixed') return rule.fixed ?? [1, 0.6, 0.35]
  return palette[rule.from]
}

/**
 * A rule's three colours on a photo, darkest tone first. Photo colours are
 * often nearly grey (overcast light); the lead is given a floor of colour so
 * a recipe always reads as a palette, then scaled by richness.
 */
export function ruleColours(rule: ColourRule, palette: Palette): Trio<Rgb> {
  if (rule.shape === 'tide') {
    // A nearly grey light has no hue to speak of: the colour that stands out leads instead.
    const light = wheelPoint(recipeLead(rule, palette))
    const lead = rule.from === 'light' && light.sat < 0.12 ? wheelPoint(palette.vivid) : light
    const high = (lead.hue + rule.turn) * 360
    return shapedColours(high + 180, high)
  }
  const base = wheelPoint(recipeLead(rule, palette))
  const sat = clamp(naturalSat(base) * rule.richness, 0.04, 0.95)
  const lead = { hue: turnOf(base.hue + rule.turn), sat }
  const { points } = guidedMove(rule.harmony, rule.lead, lead)
  return toneColours(points)
}

/**
 * The rule that puts its lead colour at a place on the wheel, on this photo:
 * the turn and richness that get there, in a harmony. Dragging the wheel
 * while a recipe is in use reshapes the recipe, so it still builds its
 * colours from each photo it is used on.
 */
export function ruleTowards(rule: ColourRule, palette: Palette, to: WheelPoint, harmony: RecipeHarmony): ColourRule {
  const base = wheelPoint(recipeLead(rule, palette))
  let turn = turnOf(to.hue - base.hue)
  if (turn >= 0.5) turn -= 1
  return { ...rule, harmony, turn, richness: clamp(to.sat / naturalSat(base), 0, MAX_RICHNESS) }
}

/** How far apart two palettes sit on the wheel, as sets: each colour to its nearest in the other. */
function trioGap(a: Trio<Rgb>, b: Trio<Rgb>): number {
  const pa = a.map(wheelPoint)
  const pb = b.map(wheelPoint)
  const d = (p: WheelPoint, q: WheelPoint) => {
    const dh = Math.abs(p.hue - q.hue) % 1
    return Math.min(dh, 1 - dh) * Math.max(p.sat, q.sat) + Math.abs(p.sat - q.sat)
  }
  return pa.reduce((sum, p) => sum + Math.min(...pb.map((q) => d(p, q))), 0)
}

/**
 * The rule whose colours on this photo come closest to a palette the wheel
 * was dragged to. The layout can hand the lead colour to another tone (a
 * blue light moves to the shadows), so each of the three is tried as the
 * lead and the one that rebuilds the palette is kept.
 */
export function ruleMatching(rule: ColourRule, palette: Palette, colours: Trio<Rgb>, harmony: RecipeHarmony): ColourRule {
  // The tone it leads stays put when that rebuilds it; another only when clearly closer.
  let best = { rule, gap: Infinity }
  for (const lead of [rule.lead, ...([0, 1, 2] as const).filter((l) => l !== rule.lead)])
    for (const c of colours) {
      const next = ruleTowards({ ...rule, lead }, palette, wheelPoint(c), harmony)
      const gap = trioGap(ruleColours(next, palette), colours) + (lead === rule.lead ? 0 : 0.01)
      if (gap < best.gap) best = { rule: next, gap }
    }
  return best.rule
}

export const sameRule = (a: ColourRule | undefined, b: ColourRule | undefined): boolean =>
  !!a &&
  !!b &&
  a.from === b.from &&
  a.harmony === b.harmony &&
  a.lead === b.lead &&
  a.shape === b.shape &&
  Math.abs(a.turn - b.turn) < 1e-4 &&
  Math.abs(a.richness - b.richness) < 1e-4 &&
  (a.from !== 'fixed' || (a.fixed ?? []).every((v, i) => Math.abs(v - (b.fixed ?? [])[i]) < 1e-4))

/**
 * Grade settings with a patch put in. A patch that sets the palette's colours
 * by hand (a wheel, a variation, an explored palette) lets go of the recipe,
 * since the recipe would otherwise build its own colours over them.
 */
export function mergeGrade<G extends { recipe?: ColourRule; mapShadow: unknown; mapMid: unknown; mapHigh: unknown }>(
  grade: G,
  patch: Partial<G>,
): G {
  const next = { ...grade, ...patch }
  if (!('recipe' in patch) && ('mapShadow' in patch || 'mapMid' in patch || 'mapHigh' in patch)) delete next.recipe
  return next
}
