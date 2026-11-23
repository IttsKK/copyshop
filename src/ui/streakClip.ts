import type { StreakShape } from '../engine/types'

/**
 * What belongs to where a streak is, and stays with it when another's
 * settings are pasted on: its outline and the way it goes there (direction,
 * curve, perspective, guides, radial middle, end line, mirror line), its
 * subject and masks, its fixes, whether it is on, and its pick of bars.
 */
const PLACE: readonly (keyof StreakShape)[] = [
  'outline',
  'angle',
  'path',
  'converge',
  'bend',
  'guides',
  'radial',
  'radialAround',
  'radialCentre',
  'radialRadius',
  'radialReach',
  'ends',
  'colourLine',
  'mirrorAt',
  'subject',
  'maskIds',
  'maskMode',
  'repeatMask',
  'key',
  'keyOn',
  'keyLevel',
  'keySoftness',
  'fixes',
  'enabled',
  'seed',
]

/** A streak's settings, to paste onto another: everything but where it is (PLACE). */
export function streakSettingsOf(sh: StreakShape): Partial<StreakShape> {
  const out = structuredClone(sh) as Partial<StreakShape>
  for (const k of PLACE) delete out[k]
  // A streak mask is not a streak's look.
  if (out.mode === 'mask') delete out.mode
  return out
}

/**
 * Settings pasted onto a streak. A subject streak stays a trail off its
 * subject; settings measured on the other one's subject (Repeat's pattern)
 * go with them.
 */
export function pasteStreakSettingsOnto(sh: StreakShape, settings: Partial<StreakShape>): StreakShape {
  const next = { ...sh, ...structuredClone(settings) } as Record<string, unknown>
  // What the other one did not have set (Mirror, a Repeat), this one does not either.
  for (const k of Object.keys(sh)) if (!(PLACE as readonly string[]).includes(k) && !(k in settings) && k !== 'mode') delete next[k]
  if (sh.subject || sh.mode === 'mask' || next.mode === undefined) next.mode = sh.mode
  return next as unknown as StreakShape
}

/**
 * How many of the subject's own repeats (Fit to the pattern's measure)
 * each Repeat copy takes: Copy length over it, to the nearest whole one.
 * One with nothing measured.
 */
export function repeatLayers(sh: Pick<StreakShape, 'repeatLength' | 'repeatPeriod'>): number {
  const p = sh.repeatPeriod
  if (!p || p <= 0) return 1
  return Math.max(1, Math.round((sh.repeatLength ?? p) / p))
}

/**
 * Copy perspective as the panel shows it: how strong against the streak's
 * own (1× the same; 2× the copies' point half as far).
 */
export function vanishWords(v: number): string {
  if (Math.abs(v) < 0.005) return 'same as the streak'
  return `${(1 / (1 + v)).toFixed(2)}× the streak’s`
}
