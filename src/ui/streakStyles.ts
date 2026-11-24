import type { StreakShape } from '../engine/types'

/**
 * Ready-made looks for a streak: how its bars are cut and toned, not where it
 * is. Each sets the same fields, so choosing one after another leaves
 * nothing of the first behind; the shape, its way, length, path, end line,
 * masks and fixes are left as they are.
 */
export interface StreakStyle {
  id: string
  name: string
  hint: string
  patch: Partial<StreakShape>
}

/** Everything a style sets, at the values a plain streak has. */
const BASE: Partial<StreakShape> = {
  carry: 'colour',
  radial: false,
  radialAround: false,
  band: 0.012,
  barVary: 0,
  stripeMin: 0,
  stripeMax: 0,
  stripeTexture: 0.5,
  lengthMin: 0.45,
  lengthMax: 1,
  variation: 1,
  tipAngle: 0,
  tipRange: 0,
  endSoftness: 0.04,
  brightness: 0,
  contrast: 0,
  opacity: 1,
  endBrightness: 0,
  endContrast: 0,
  endOpacity: 1,
  changeAt: 0,
  changeLength: 1,
  repeatHold: 0.5,
}

const style = (id: string, name: string, hint: string, patch: Partial<StreakShape> = {}): StreakStyle => ({
  id,
  name,
  hint,
  patch: { ...BASE, ...patch },
})

export const STREAK_STYLES: StreakStyle[] = [
  // The plain streak, at the values most finished streaks ended up with: a
  // ragged but not broken end (shortest about two thirds), softly faded.
  style('smear', 'Smear', 'Bars of the edge colour at different lengths, softly ended', { lengthMin: 0.65, endSoftness: 0.05 }),
  style('even', 'Even', 'Every bar the same length, cut square', { lengthMin: 1, variation: 0, endSoftness: 0 }),
  style('fade', 'Fade', 'Bars that fade away along their length', { lengthMin: 0.6, endSoftness: 0.02, endOpacity: 0, changeAt: 0.1 }),
  style('light', 'Light trail', 'Bars that brighten and thin out as they go', {
    lengthMin: 0.6,
    endSoftness: 0.03,
    endBrightness: 1.25,
    endOpacity: 0.4,
    changeAt: 0.2,
  }),
  style('fine', 'Fine', 'Thin lines, every detail of the edge its own line', { band: 0.004, lengthMin: 0.2, endSoftness: 0.02 }),
  style('blocks', 'Blocks', 'Wide uneven bars with slanted ends', { band: 0.03, barVary: 0.6, lengthMin: 0.3, tipRange: 25, endSoftness: 0 }),
  // From the web playground, where Melt is the most picked style.
  style('stripes', 'Stripes', 'Lines grouped into stripes a few wide, each keeping some of the edge', {
    stripeMin: 0.008,
    stripeMax: 0.024,
    stripeTexture: 0.65,
    lengthMin: 0.55,
    endSoftness: 0.03,
  }),
  style('melt', 'Melt', 'Neighbouring bars follow one slow wave: a smooth, dripping edge', {
    band: 0.006,
    lengthMin: 0.25,
    variation: 0.12,
    endSoftness: 0.1,
    endOpacity: 0.6,
    changeAt: 0.5,
  }),
  style('echo', 'Echo', "The subject's last stretch repeated along each bar, fading into its colour", {
    carry: 'repeat',
    lengthMin: 0.6,
    repeatHold: 0.4,
  }),
  style('burst', 'Burst', 'Bars out from the middle of the subject in every direction', { radial: true, lengthMin: 0.3, endSoftness: 0.04 }),
]

/** Extend: the subject carried on as it is, set by App's extendSubject (it fits the copies to the subject). */
export const EXTEND_STYLE = { id: 'extend', name: 'Extend', hint: 'The subject itself carried on, as if it kept going' }

/**
 * A new streak's bars, a little its own: the bars' width, how ragged their
 * lengths are and how soft their ends, moved a little from the style's by
 * the streak's seed, so two streaks in one style aren't twins. A style with
 * even lengths or square ends keeps them. The style still counts as the
 * streak's own (sameAs).
 */
export function variedBars(patch: Partial<StreakShape>, seed: number): Partial<StreakShape> {
  let s = (seed * 2654435761) >>> 0
  const next = () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const band = patch.band ?? (BASE.band as number)
  const lengthMin = patch.lengthMin ?? (BASE.lengthMin as number)
  const endSoftness = patch.endSoftness ?? (BASE.endSoftness as number)
  const round = (v: number) => Math.round(v * 10000) / 10000
  return {
    ...patch,
    band: round(band * (0.85 + next() * 0.3)),
    ...(lengthMin < 1 ? { lengthMin: round(Math.min(0.95, Math.max(0.12, lengthMin * (0.86 + next() * 0.28)))) } : {}),
    ...(endSoftness > 0 ? { endSoftness: round(Math.max(0.01, endSoftness + (next() - 0.4) * 0.05)) } : {}),
  }
}

/** How far a varied streak's bars may be from its style's and still be in it (variedBars). */
function sameAs(k: string, have: unknown, want: unknown): boolean {
  if (typeof have !== 'number' || typeof want !== 'number') return have === want
  if (k === 'band' || k === 'lengthMin') return Math.abs(have - want) <= Math.abs(want) * 0.2 + 1e-6
  if (k === 'endSoftness') return want > 0 ? Math.abs(have - want) <= 0.031 : have === 0
  return have === want
}

/** The style a streak is in, if it is exactly one of them. */
export function styleOf(shape: StreakShape): string | null {
  if (shape.carry === 'repeat' && (shape.repeatHold ?? 0.5) >= 0.999 && shape.variation === 0 && shape.lengthMin === 1) return EXTEND_STYLE.id
  const found = STREAK_STYLES.find((s) =>
    Object.entries(s.patch).every(([k, v]) => {
      const have = (shape as unknown as Record<string, unknown>)[k]
      if (k === 'carry') return (have ?? 'colour') === v
      if (k === 'repeatHold') return shape.carry !== 'repeat' || (have ?? 0.5) === v
      if (k === 'radialAround') return !shape.radial || (have ?? false) === v
      return sameAs(k, have ?? (BASE as Record<string, unknown>)[k], v)
    }),
  )
  return found?.id ?? null
}

/**
 * A style's patch for this streak: leaving Extend, which ran the streak on to
 * the photo's edge, also gives back the length it had before.
 */
export function stylePatch(shape: StreakShape, patch: Partial<StreakShape>): Partial<StreakShape> {
  if (shape.lengthBeforeExtend === undefined) return shape.beforeExtend ? { ...patch, beforeExtend: undefined } : patch
  return { ...patch, length: shape.lengthBeforeExtend, lengthBeforeExtend: undefined, beforeExtend: undefined }
}

/**
 * The style chosen for the first streak, while the module is empty (Streaks'
 * Style dropdown). Given to that streak where it is made, so nothing else
 * (a photo reopened, an undo) ever restyles a streak.
 */
let firstStyle = STREAK_STYLES[0].id
export const getFirstStreakStyle = () => firstStyle
export const setFirstStreakStyle = (id: string) => void (firstStyle = id)
/** The first-streak style's settings for a streak about to be made, if there are no streaks yet and it isn't the plain one. */
export function firstStreakPatch(count: number): Partial<StreakShape> | null {
  if (count > 0 || firstStyle === STREAK_STYLES[0].id) return null
  return STREAK_STYLES.find((s) => s.id === firstStyle)?.patch ?? null
}

/**
 * The styles that are a way of cutting and toning the bars, offered on a
 * streak at any time (its Bars tab). Echo and Burst are a streak's Carries
 * (Copies) and kind (Radial), chosen apart from its bars.
 */
export const FINISHES = ['smear', 'even', 'fade', 'light', 'fine', 'blocks', 'stripes', 'melt']

/** What a finish leaves alone: what the bars carry and which way they run. */
const NOT_FINISH = new Set(['carry', 'repeatHold', 'radial', 'radialAround'])

/** A finish's settings for this streak, leaving its kind and what it carries as they are. */
export function finishPatch(shape: StreakShape, patch: Partial<StreakShape>): Partial<StreakShape> {
  const own = Object.fromEntries(Object.entries(patch).filter(([k]) => !NOT_FINISH.has(k))) as Partial<StreakShape>
  return stylePatch(shape, own)
}

/** The finish this streak's bars have, if exactly one of them. */
export function finishOf(shape: StreakShape): string | null {
  const have = shape as unknown as Record<string, unknown>
  const found = STREAK_STYLES.filter((s) => FINISHES.includes(s.id)).find((s) =>
    Object.entries(s.patch).every(([k, v]) => NOT_FINISH.has(k) || sameAs(k, have[k] ?? (BASE as Record<string, unknown>)[k], v)),
  )
  return found?.id ?? null
}
