import { FLAT_CURVE } from '../engine/curve'
import { DEFAULT_SURFACE, type SurfaceParams } from '../engine/surface'
import { DEFAULT_HALFTONE, DEFAULT_LENS, DEFAULT_MONO, DEFAULT_PRISM, DEFAULT_STAMP, RISO_INKS, STAMP_THEMES, type HalftoneParams, type LensParams, type MonoParams, type PrismParams, type StampParams } from '../engine/extras'
import { leakStyle } from '../engine/leakStyles'
import {
  DEFAULT_BLEND_PARAMS,
  DEFAULT_BORDER,
  DEFAULT_DITHER,
  DEFAULT_EFFECTS,
  DEFAULT_GLASS,
  DEFAULT_GRADE,
  DEFAULT_LEAKS,
  DEFAULT_PIXEL_ART,
  DEFAULT_STOCK,
  DEFAULT_SURGE,
  type BlendParams,
  type BorderParams,
  type ColourChoice,
  type DitherParams,
  type EffectParams,
  type GlassParams,
  type GradeParams,
  type PixelArtParams,
  type StockParams,
  type SurgeParams,
} from '../engine/types'
import { DEFAULT_DEFECTS, type DefectParams } from '../sources/defects'
import { DEFAULT_PROCEDURAL_PARAMS, type ProceduralGrainParams } from '../sources/generateGrain'
import type { PartData, PartKind, StoredPart } from './parts'
import { PRESET_SCHEMA_VERSION } from './presets'

/**
 * Presets that ship with the app, for each module that keeps presets, the
 * way darktable ships its own: listed above the ones you saved, applied the
 * same way (merged in and passed through parsePreset), never renamed or
 * deleted. Each one sets everything its module owns (see OWNS in parts.ts),
 * so it looks the same whatever the module was set to before.
 */
type Builtin = { name: string; data: PartData }

const v = PRESET_SCHEMA_VERSION
const fx = (effects: Partial<EffectParams>, module?: keyof BlendParams['modules']): PartData => ({
  schemaVersion: v,
  blend: { effects, ...(module ? { modules: { [module]: true } } : {}) },
})
const manual = (colour: [number, number, number]): ColourChoice => ({ source: 'manual', colour })

/* ----------------------------------------------------------------- grain */

const grain = (name: string, amount: number, params: Partial<ProceduralGrainParams>, blend: Partial<BlendParams> = {}): Builtin => ({
  name,
  data: {
    schemaVersion: v,
    grainSource: { kind: 'procedural', id: 'procedural', name: 'Generated grain', params: { ...DEFAULT_PROCEDURAL_PARAMS, ...params } },
    blend: {
      amount,
      blendMode: 'overlay',
      colorSpace: 'linear',
      tiling: 'stochastic',
      grainScale: 1,
      grainRotation: 0,
      chroma: 1,
      softness: 0,
      plateNormalise: 'centre',
      plateFlatten: 0,
      plateSampling: 'crisp',
      response: [...FLAT_CURVE],
      responseMode: 'luminance',
      layerSpread: DEFAULT_BLEND_PARAMS.layerSpread,
      grainFollowsColour: 0,
      ...blend,
      modules: { grain: true },
    },
  },
})

// Coarser grain is the same small grains drawn larger (Scale, read smoothly),
// as film's grain is: big grains in the plate come out as flat blotches.
const GRAIN: Builtin[] = [
  grain('Fine', 0.16, { size: 512, grainSize: 0.4, contrast: 0.33, clumps: 0.25, unevenness: 0.1, chroma: 0, seed: 7 }),
  grain('Medium', 0.36, { grainSize: 0.4, contrast: 0.4, clumps: 0.4, unevenness: 0.12, chroma: 0.2, seed: 11 }, { grainScale: 1.5, plateSampling: 'smooth' }),
  grain('Coarse', 0.55, { grainSize: 0.45, contrast: 0.55, roughness: 0.15, hardness: 0.15, clumps: 0.6, unevenness: 0.2, chroma: 0.15, seed: 13 }, { grainScale: 2, plateSampling: 'smooth' }),
  grain('Pushed 3200', 0.75, { grainSize: 0.4, contrast: 0.6, roughness: 0.25, hardness: 0.6, clumps: 0.5, definition: 0.4, unevenness: 0.22, chroma: 0, seed: 17 }, { grainScale: 2, plateSampling: 'smooth' }),
  grain('Colour negative', 0.42, { grainSize: 0.45, contrast: 0.45, roughness: 0.1, hardness: 0.1, clumps: 0.45, unevenness: 0.15, chroma: 0.5, seed: 19 }, { responseMode: 'channel', grainScale: 2, plateSampling: 'smooth' }),
]

/* ---------------------------------------------------------------- colour */

const colour = (name: string, grade: Partial<GradeParams>, stock: Partial<StockParams> = {}): Builtin => ({
  name,
  data: fx({ grade: { ...DEFAULT_GRADE, ...grade }, stock: { ...DEFAULT_STOCK, ...stock } }, 'colour'),
})

const COLOUR: Builtin[] = [
  colour('Warmer', { warmth: 0.25, vibrance: 0.1 }),
  colour('Cooler', { warmth: -0.25, tint: -0.03 }),
  colour('Muted', { vibrance: -0.45 }),
  colour('Teal shadows, warm highlights', {
    shadowTint: manual([0.1, 0.45, 0.5]),
    shadowAmount: 0.45,
    highlightTint: manual([1, 0.72, 0.42]),
    highlightAmount: 0.35,
  }),
  colour('Expired film', {}, { id: 'expired', strength: 1 }),
]

/* ------------------------------------------------------------------ tone */

const tone = (name: string, t: Partial<Pick<EffectParams, 'exposure' | 'fade' | 'shoulder' | 'vignette' | 'structure' | 'structureRadius'>>): Builtin => ({
  name,
  data: fx({ exposure: 0, fade: 0, shoulder: 0, vignette: 0, structure: 0, structureRadius: DEFAULT_EFFECTS.structureRadius, ...t }, 'tone'),
})

const TONE: Builtin[] = [
  tone('Soft highlights', { fade: 0.03, shoulder: 0.5 }),
  tone('Overexposed', { exposure: 0.7, fade: 0.06, shoulder: 0.65 }),
  tone('Faded', { fade: 0.16, shoulder: 0.3 }),
  tone('Vignette', { fade: 0.02, shoulder: 0.25, vignette: 0.55 }),
  tone('Local contrast', { shoulder: 0.2, structure: 0.45, structureRadius: 0.01 }),
]

/* ------------------------------------------------------------------ glow */

const glow = (name: string, halation: number, bloom: number, glowThreshold: number, glowRadius: number, glowColour: ColourChoice = DEFAULT_EFFECTS.glowColour): Builtin => ({
  name,
  data: fx({ halation, bloom, glowThreshold, glowFit: true, glowRadius, glowColour }, 'light'),
})

const LIGHT: Builtin[] = [
  glow('Soft halation', 0.3, 0.05, 0.72, 0.02),
  glow('Strong halation', 0.75, 0.12, 0.62, 0.03),
  glow('Red halation', 0.8, 0.05, 0.65, 0.025, manual([1, 0.25, 0.12])),
  glow('Bloom', 0, 0.45, 0.6, 0.04),
  glow('Wide haze', 0.12, 0.35, 0.35, 0.09),
]

/* ----------------------------------------------------------------- edges */

const edges = (name: string, rim: number, rimRadius: number, crunch: number): Builtin => ({
  name,
  data: fx({ rim, rimRadius, crunch }, 'edges'),
})

const EDGES: Builtin[] = [
  edges('Edge glow', 0.6, 0.0025, 0),
  edges('Wide edge glow', 1.4, 0.007, 0),
  edges('Crunch', 0, 0.0025, 0.5),
  edges('Glow and crunch', 0.5, 0.003, 0.35),
]

/* -------------------------------------------------------------- solarize */

const sol = (name: string, solarize: number, solarizeFrom: number, halo: number, haloRadius: number): Builtin => ({
  name,
  data: fx({ solarize, solarizeFrom, halo, haloRadius }, 'solarize'),
})

const SOLARIZE: Builtin[] = [
  sol('Light reversal', 0.3, 0.8, 0.15, 0.035),
  sol('Strong reversal', 0.75, 0.55, 0.3, 0.035),
  sol('Lines only', 0, 0.72, 0.55, 0.02),
  sol('Wide lines', 0.35, 0.7, 0.45, 0.07),
]

/* ----------------------------------------------------------------- leaks */

/** A leak style's spots from a fixed layout, so the preset is the same every time. */
const leak = (name: string, styleId: string, layoutSeed: number, amount?: number, colour?: ColourChoice): Builtin => {
  const style = leakStyle(styleId)
  return {
    name,
    data: fx(
      {
        leaks: {
          ...DEFAULT_LEAKS,
          amount: amount ?? style.amount,
          colour: colour ?? style.colour,
          spots: style.generate(layoutSeed, style.count),
          style: style.id,
          layoutSeed,
        },
      },
      'leaks',
    ),
  }
}

const LEAKS: Builtin[] = [
  leak('Corner glow', 'corner', 4),
  leak('Red corner', 'corner', 9, 0.55, manual([1, 0.3, 0.2])),
  leak('Edge streaks', 'edge', 2),
  leak('Roll end', 'rollEnd', 3),
  leak('Prism bands', 'prism', 5),
]

/* ---------------------------------------------------------------- border */

const border = (name: string, patch: Partial<BorderParams>, on = true): Builtin => ({
  name,
  data: { schemaVersion: v, blend: { border: { ...DEFAULT_BORDER, ...patch }, modules: { border: on } } },
})

const BORDER: Builtin[] = [
  border('None', { width: 0, bottomExtra: 0 }, false),
  border('Thin white', { width: 0.03, bottomExtra: 0, colour: [0.955, 0.955, 0.955], texture: 0.3, irregularity: 0.2, grain: 0.5 }),
  border('Print', { width: 0.05, bottomExtra: 0.09, colour: [0.94, 0.925, 0.895], texture: 0.55, irregularity: 0.4, grain: 0.75, seed: 4 }),
  border('Cream, wide', { width: 0.08, bottomExtra: 0, colour: [0.93, 0.9, 0.82], texture: 0.6, irregularity: 0.35, grain: 0.7 }),
  border('Black frame', { width: 0.04, bottomExtra: 0, colour: [0.07, 0.07, 0.075], texture: 0.4, irregularity: 0.5, grain: 0.9 }),
]

/* ------------------------------------------------------------------ lens */

const lens = (name: string, patch: Partial<LensParams>): Builtin => ({ name, data: fx({ lens: { ...DEFAULT_LENS, ...patch, enabled: true } }) })

const LENS: Builtin[] = [
  lens('Soft focus', { diffusion: 0.55 }),
  lens('Cheap lens', { distortion: 0.15, fringe: 0.4, softEdges: 0.5, diffusion: 0.1 }),
  lens('Fisheye', { distortion: 0.8, fringe: 0.15, softEdges: 0.25 }),
  lens('Tilt-shift', { tilt: 0.7, focus: 0.6, focusWidth: 0.18 }),
  lens('Colour fringes', { fringe: 0.75 }),
]

/* ----------------------------------------------------------------- prism */

const prism = (name: string, patch: Partial<PrismParams>): Builtin => ({ name, data: fx({ prism: { ...DEFAULT_PRISM, ...patch, enabled: true } }) })

const PRISM: Builtin[] = [
  prism('Slight split', { split: 0.15 }),
  prism('RGB split', { split: 0.55 }),
  prism('Rainbow edges', { split: 0.6, shape: 'radial', colours: 'spectrum' }),
  prism('Prism on the lights', { split: 0.7, colours: 'spectrum', light: 0.6 }),
  prism('Up and down', { split: 0.45, angle: 90 }),
]

/* ------------------------------------------------------------ date stamp */

const stamp = (name: string, theme: StampParams['theme'], patch: Partial<StampParams> = {}): Builtin => {
  const t = STAMP_THEMES.find((s) => s.id === theme)!
  // The date stays the photo's: applying a part keeps it (parts.ts, applyPart).
  return { name, data: fx({ stamp: { ...DEFAULT_STAMP, ...t.look, theme, ...patch, enabled: true } }) }
}

const STAMP: Builtin[] = [
  stamp('Digital camera', 'digicam'),
  stamp('Digital camera, with time', 'digicam', { format: 'mm/dd/yyyy-time' }),
  stamp('Film date back', 'film'),
  stamp('Film date back, red', 'film', { colour: [1, 0.3, 0.14], glow: 0.75 }),
]

/* --------------------------------------------------------- black & white */

const mono = (name: string, patch: Partial<MonoParams>): Builtin => ({ name, data: fx({ mono: { ...DEFAULT_MONO, amount: 1, ...patch, enabled: true } }) })

const MONO: Builtin[] = [
  mono('Neutral', {}),
  mono('Yellow filter', { filter: 'yellow', contrast: 0.15 }),
  mono('Red filter', { filter: 'red', contrast: 0.35 }),
  mono('Sepia', { filter: 'orange', contrast: 0.05, tone: 'sepia', toneAmount: 0.6 }),
  mono('Cyanotype', { filter: 'blue', contrast: 0.1, tone: 'cyan', toneAmount: 0.85 }),
]

/* ---------------------------------------------------------------- dither */

const dither = (name: string, patch: Partial<DitherParams>): Builtin => ({ name, data: fx({ dither: { ...DEFAULT_DITHER, ...patch, enabled: true } }) })

const DITHER: Builtin[] = [
  dither('Fine stipple', { amount: 0.6, steps: 12, spread: 0.6, pixel: 1, pattern: 'grain' }),
  // Coarse as soft clumps of the grain, not the square blocks of a bigger Pixel size.
  dither('Coarse stipple', { amount: 0.85, steps: 6, spread: 0.5, pixel: 1, clumps: 2, pattern: 'grain' }),
  dither('Ordered, 4 steps', { amount: 1, steps: 4, spread: 1, pixel: 3, pattern: 'ordered', transitionsOnly: 0.5 }),
  // Pixel dots: whole blocks where the pattern shows, the photo's detail kept elsewhere (Keep detail).
  dither('Pixel dither', { amount: 0.9, steps: 5, spread: 0.6, pixel: 4, pattern: 'ordered', blocks: true, keepLines: 0.6 }),
  dither('Bands, top to bottom', { amount: 0.8, steps: 8, spread: 0.6, follow: 1, pixel: 2, pattern: 'grain' }),
]

/* ------------------------------------------------------------- pixel art */

const pixel = (name: string, patch: Partial<PixelArtParams>): Builtin => ({ name, data: fx({ pixelArt: { ...DEFAULT_PIXEL_ART, ...patch, enabled: true } }) })

const PIXEL: Builtin[] = [
  pixel('Pixelate', { pixelate: 6, palette: 'off' }),
  pixel('Game Boy', { pixelate: 4, palette: 'gameboy', amount: 1, dither: 0.6 }),
  pixel('PICO-8', { pixelate: 4, palette: 'pico8', amount: 1, dither: 0.4 }),
  pixel('1-bit', { pixelate: 3, palette: 'onebit', amount: 1, dither: 0.8 }),
  pixel('Photo colours, 8', { pixelate: 5, palette: 'photo', colours: 8, amount: 1, dither: 0.5 }),
]

/* ----------------------------------------------------------------- glass */

const glass = (name: string, patch: Partial<GlassParams>): Builtin => ({ name, data: fx({ glass: { ...DEFAULT_GLASS, ...patch, enabled: true } }) })

const GLASS: Builtin[] = [
  glass('Reeded', { kind: 'reeded', amount: 0.5, width: 0.04 }),
  glass('Fine reeded', { kind: 'reeded', amount: 0.4, width: 0.015, dispersion: 0.2, edges: 0.25 }),
  glass('Reeded, level', { kind: 'reeded', amount: 0.5, width: 0.05, angle: 90 }),
  glass('Facets', { kind: 'facets', amount: 0.5, width: 0.08, dispersion: 0.4, edges: 0.4 }),
  glass('Ripple', { kind: 'ripple', amount: 0.4, width: 0.1, dispersion: 0.15, edges: 0.15 }),
]

/* -------------------------------------------------------------- halftone */

const halftone = (name: string, patch: Partial<HalftoneParams>): Builtin => ({ name, data: fx({ halftone: { ...DEFAULT_HALFTONE, amount: 1, ...patch, enabled: true } }) })

const HALFTONE: Builtin[] = [
  halftone('Fine dots', { style: 'dots', cell: 0.006, angle: 45 }),
  halftone('Coarse dots', { style: 'dots', cell: 0.018, angle: 45 }),
  halftone('Lines', { style: 'lines', cell: 0.008, angle: -30 }),
  halftone('Riso, blue and pink', { style: 'riso', cell: 0.007, angle: 45, inkA: RISO_INKS[0].a, inkB: RISO_INKS[0].b, slip: 0.003 }),
  halftone('Riso, teal and orange', { style: 'riso', cell: 0.007, angle: 15, inkA: RISO_INKS[1].a, inkB: RISO_INKS[1].b, slip: 0.004 }),
]

/* --------------------------------------------------------------- surface */

const surface = (name: string, patch: Partial<SurfaceParams>): Builtin => ({ name, data: fx({ surface: { ...DEFAULT_SURFACE, ...patch, enabled: true } }) })

/** Ready-made surfaces, each a kind with its strength, size and relief set for it; all of it changes after. */
const SURFACE: Builtin[] = [
  surface('Fine art paper', { kind: 'watercolour', amount: 0.45, relief: 0.5 }),
  surface('Canvas print', { kind: 'canvas', amount: 0.6, relief: 0.7, scale: 1.2 }),
  surface('Crumpled flyer', { kind: 'crumpled', amount: 0.7, relief: 0.9 }),
  surface('Cracked paint', { kind: 'cracked', amount: 0.6, relief: 0.6 }),
  surface('Old wall', { kind: 'concrete', amount: 0.55, relief: 0.6, scale: 1.5 }),
]

/* ------------------------------------------------------ dust & scratches */

const dust = (name: string, patch: Partial<DefectParams>): Builtin => ({
  name,
  data: fx({ defects: { ...DEFAULT_DEFECTS, hairs: 0, scratches: 0, scanLines: 0, scanStreaks: 0, ...patch } }, 'defects'),
})

const DUST: Builtin[] = [
  dust('Light dust', { strength: 0.35, dust: 30 }),
  dust('Dust and hairs', { strength: 0.5, dust: 90, hairs: 3, scratches: 1 }),
  dust('Scratched', { strength: 0.6, dust: 40, hairs: 1, scratches: 5 }),
  dust('Old scan', { strength: 0.45, dust: 60, hairs: 1, scratches: 1, scanLines: 0.4, scanStreaks: 0.3 }),
]

/* ----------------------------------------------------------- surge marks */

const surge = (name: string, patch: Partial<SurgeParams>): Builtin => ({ name, data: fx({ surge: { ...DEFAULT_SURGE, ...patch } }, 'surge') })

const SURGE: Builtin[] = [
  surge('Light', { strength: 0.35, count: 3, width: 0.06 }),
  surge('Strong', { strength: 0.75, count: 4, width: 0.08 }),
  surge('Many narrow', { strength: 0.5, count: 7, width: 0.025 }),
  surge('Few wide', { strength: 0.55, count: 2, width: 0.15 }),
]

export const PART_BUILTINS: Record<PartKind, Builtin[]> = {
  surface: SURFACE,
  grain: GRAIN,
  colour: COLOUR,
  tone: TONE,
  light: LIGHT,
  edges: EDGES,
  solarize: SOLARIZE,
  leaks: LEAKS,
  border: BORDER,
  lens: LENS,
  prism: PRISM,
  stamp: STAMP,
  mono: MONO,
  dither: DITHER,
  pixel: PIXEL,
  glass: GLASS,
  halftone: HALFTONE,
  dust: DUST,
  surge: SURGE,
}

const slug = (s: string) => s.toLowerCase().replace(/\W+/g, '-').replace(/^-|-$/g, '')

/** Every built-in as a stored part, in the order shown. */
export const BUILT_IN_PARTS: StoredPart[] = (Object.keys(PART_BUILTINS) as PartKind[]).flatMap((kind) =>
  PART_BUILTINS[kind].map((b) => ({
    id: `builtin-${kind}-${slug(b.name)}`,
    kind,
    name: b.name,
    data: b.data,
    updatedAt: 0,
    builtIn: true,
  })),
)
