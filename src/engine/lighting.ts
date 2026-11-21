import { MAX_LEAK_SPOTS, type BlendParams, type ColourChoice, type LeakSpot } from './types'

/**
 * A light: a shape drawn on the photo where light falls, lit evenly with a
 * soft edge, fading across itself away from the side it comes from. Not a
 * leak: no film breakup, and the grain is left as it is under it.
 */
export interface LightShape {
  id: string
  name: string
  /** Where it falls: points in fractions of the print, as leak shapes are. */
  outline: { x: number; y: number }[]
  /** A smooth curve through its points, or straight lines between them. */
  rounded: boolean
  colour: ColourChoice
  /** How bright, 0..3: added light, or for Colour only, how much it tints. */
  strength: number
  /** Its soft edge, fraction of the print's short side. Drawn lights only: a light from a mask has `soft`. */
  edge: number
  /**
   * From a mask: its edge softened by this much, fraction of the short side,
   * as a drawn light's is by `edge` (the mask itself, which other things may
   * use, stays as it is). Missing or 0: exactly the mask.
   */
  soft?: number
  /** How much it fades across itself, away from `angle`, 0 (even) .. 1 (to nothing). */
  falloff: number
  /** The side the light comes from, degrees: 0 from the right, -90 from the top. */
  angle: number
  /** Adds light, or only tints what is there. */
  mode: 'add' | 'tint'
  /** Off: kept, not drawn. Missing: on. */
  enabled?: boolean
  /** Shaped by a mask instead of its own outline (moved from Leaks). */
  mask?: string
  /**
   * With `mask`: a glow round the mask instead of the mask lit. Light comes
   * from its edge, brightest there, fading out over this far (fraction of
   * the short side), and only outside it: a light behind the building.
   */
  glow?: number
  /** A mask it stays behind (the building in front of it), or with `inside`, the only place it shows. */
  holdMask?: string | null
  holdInside?: boolean
  /** Only where there are no streaks: the streaks in front of it. */
  behindStreaks?: boolean
}

export interface LightingParams {
  enabled: boolean
  lights: LightShape[]
}

export const MAX_LIGHTS = 6

export const DEFAULT_LIGHTING: LightingParams = { enabled: false, lights: [] }

export const DEFAULT_LIGHT: Omit<LightShape, 'id' | 'name' | 'outline'> = {
  rounded: true,
  colour: { source: 'manual', colour: [1, 0.82, 0.6] },
  strength: 0.8,
  edge: 0.04,
  falloff: 0,
  angle: -90,
  mode: 'add',
}

/** The lights drawn: on, with a shape and some strength. */
export function liveLights(p: BlendParams): LightShape[] {
  const L = p.effects.lighting
  if (!L?.enabled) return []
  return L.lights.filter((l) => l.enabled !== false && l.strength > 0 && (l.mask || l.outline.length >= 3)).slice(0, MAX_LIGHTS)
}

/**
 * The edit with its lights drawn as leaks are — the shapes, soft edge,
 * direction and colour all render the same way — before the leaks, which
 * keep their Amount in their own strength. The lights are marked so they
 * leave the grain alone and can tint only (LeakSpot.lightMode).
 */
export function withLighting(p: BlendParams): BlendParams {
  const lights = liveLights(p)
  if (!lights.length) return p
  const leaks = p.effects.leaks
  const leaksOn = p.modules.leaks !== false && leaks.amount > 0
  const fromLeaks: LeakSpot[] = leaksOn ? leaks.spots.map((s) => ({ ...s, strength: s.strength * leaks.amount })) : []
  const fromLights: LeakSpot[] = lights.map((l, i) => ({
    x: 0,
    y: 0,
    size: 0.05,
    stretch: 1,
    angle: l.angle,
    strength: l.strength,
    kind: 'light',
    colour: l.colour,
    ...(l.mask ? { mask: l.mask, ...(l.glow ? { glow: l.glow } : {}) } : { outline: l.outline, polygon: true, rounded: l.rounded }),
    texture: 0,
    // A light from a mask softens it by its own amount (LightShape.soft).
    edge: l.mask ? (l.soft ?? 0) : l.edge,
    falloff: l.falloff,
    seed: 101 + i,
    lightMode: l.mode,
    ...(l.holdMask || l.behindStreaks ? { hold: { mask: l.holdMask ?? undefined, inside: !!l.holdInside, behindStreaks: !!l.behindStreaks } } : {}),
  }))
  return {
    ...p,
    modules: { ...p.modules, leaks: true },
    effects: { ...p.effects, leaks: { ...leaks, amount: 1, spots: [...fromLights, ...fromLeaks].slice(0, MAX_LEAK_SPOTS) } },
  }
}
