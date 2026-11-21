import type { BlendParams, GradeParams, ModuleToggles } from '../../engine/types'

/*
 * What more than one module's settings use, and App too.
 */

/**
 * What the dropper samples for a colour, when reading the edited picture: the
 * edit minus the effect being picked for, so the colour that effect already
 * paints is not what comes back (an isolate would leave only grey to pick).
 */
const withoutGrade =
  (patch: Partial<GradeParams>) =>
  (b: BlendParams): BlendParams => ({
    ...b,
    effects: { ...b.effects, grade: { ...b.effects.grade, ...patch } },
  })
const withoutModule =
  (m: keyof ModuleToggles) =>
  (b: BlendParams): BlendParams => ({
    ...b,
    modules: { ...b.modules, [m]: false },
  })
export const SAMPLE_FOR = {
  map: withoutGrade({ mapAmount: 0 }),
  isolate: withoutGrade({ isolateAmount: 0, mapAmount: 0 }),
  shadowTint: withoutGrade({ shadowAmount: 0 }),
  highlightTint: withoutGrade({ highlightAmount: 0 }),
  light: withoutModule('light'),
  leaks: withoutModule('leaks'),
}

/** A setting from -1 to 1 as a signed whole number: +12, -40. */
export const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`
