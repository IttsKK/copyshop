import type { StreakShape } from '../engine/types'

/**
 * The five ways a streak can run, as the Streaks module offers them: up a
 * building in perspective, straight, out from a middle, round a middle, or
 * along a curve. A streak's kind is read from its settings, never stored,
 * so every saved edit already has one.
 */
export type StreakKind = 'building' | 'straight' | 'radial' | 'circle' | 'curve'

export const STREAK_KINDS: { id: StreakKind; name: string; title: string }[] = [
  {
    id: 'building',
    name: 'Building',
    title: "Lines that close in as they go, as a building's sides do going up. Lined up with the photo's own lines to start",
  },
  { id: 'straight', name: 'Straight', title: 'Parallel bars, all one way' },
  { id: 'radial', name: 'Radial', title: 'Bars out from a middle in every direction, like spokes' },
  { id: 'circle', name: 'Circle', title: 'Arcs round a middle, in rings' },
  { id: 'curve', name: 'Curve', title: 'Bars that follow a curve you draw on the photo' },
]

const TINY = 1e-4

export function kindOf(s: StreakShape): StreakKind {
  if (s.path && s.path.length >= 2) return 'curve'
  if (s.radial) return s.radialAround ? 'circle' : 'radial'
  if (Math.abs(s.converge ?? 0) > TINY || Math.abs(s.bend ?? 0) > TINY || (s.guides?.length ?? 0) > 0) return 'building'
  return 'straight'
}

/** What each kind has of its own, kept while another kind is tried. */
const OWN: Record<StreakKind, (keyof StreakShape)[]> = {
  building: ['converge', 'bend', 'guides', 'angle'],
  straight: ['angle'],
  radial: ['radialCentre', 'radialRadius'],
  circle: ['radialCentre', 'radialRadius', 'radialReach'],
  curve: ['path', 'pathWidth'],
}

/** Everything that makes a streak one kind and not another, at plain values. */
const PLAIN: Partial<StreakShape> = { path: null, radial: false, radialAround: false, converge: 0, bend: 0, guides: undefined }

/**
 * Each streak's settings for the kinds it has been, by its seed, for this
 * session: trying Curve and going back to Building brings its lines back.
 */
const kept = new Map<number, Partial<Record<StreakKind, Partial<StreakShape>>>>()

function pick(s: StreakShape, keys: (keyof StreakShape)[]): Partial<StreakShape> {
  const out: Partial<StreakShape> = {}
  for (const k of keys) (out as Record<string, unknown>)[k] = s[k]
  return out
}

/**
 * A first curve for a streak that has none: from its middle, the way it
 * points, a third of the photo's short side, bowed gently to one side, in
 * photo fractions. `aspect` is the photo's width over its height.
 */
export function startingCurve(s: StreakShape, aspect: number): { x: number; y: number }[] {
  const n = Math.max(1, s.outline.length)
  const c = s.outline.reduce((m, p) => ({ x: m.x + p.x / n, y: m.y + p.y / n }), { x: 0, y: 0 })
  const a = (s.angle * Math.PI) / 180
  // In units of the photo's height: x fractions are aspect times as long.
  const L = 0.33 * Math.min(aspect, 1)
  const at = (along: number, aside: number) => ({
    x: c.x + (Math.cos(a) * along - Math.sin(a) * aside) / aspect,
    y: c.y + Math.sin(a) * along + Math.cos(a) * aside,
  })
  return [at(0, 0), at(L * 0.5, L * 0.18), at(L, 0)]
}

/**
 * The patch that turns streak `s` into `kind`, and whether that kind still
 * needs its first guess from the photo (Building's lines, Curve's path):
 * none was kept from an earlier try.
 */
export function kindPatch(s: StreakShape, kind: StreakKind): { patch: Partial<StreakShape>; fresh: boolean } {
  const from = kindOf(s)
  const mine = kept.get(s.seed) ?? {}
  mine[from] = pick(s, OWN[from])
  kept.set(s.seed, mine)
  const back = kind === from ? null : mine[kind]
  const base: Partial<StreakShape> = { ...PLAIN, angle: s.angle }
  switch (kind) {
    case 'radial':
      return { patch: { ...base, radial: true, radialAround: false, ...back }, fresh: false }
    case 'circle':
      return { patch: { ...base, radial: true, radialAround: true, ...back }, fresh: false }
    case 'straight':
      return { patch: { ...base, ...back }, fresh: false }
    case 'building':
      return { patch: { ...base, ...back }, fresh: !back || (Math.abs(back.converge ?? 0) <= TINY && !back.guides?.length) }
    case 'curve':
      return { patch: { ...base, ...back }, fresh: !back?.path || back.path.length < 2 }
  }
}
