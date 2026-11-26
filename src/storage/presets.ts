import { KEY_BAND, OLD_KEY_BAND } from '../engine/maskCover'
import { MAX_BLOBS } from '../engine/blobs'
import { parsePicks } from '../engine/colourPicks'
import { parseBase } from '../engine/base'
import { parseDouble, parseHalftone, parseLens, parseMono, parsePrism, parseStamp } from '../engine/extras'
import { HARMONIES, type Harmony } from '../engine/harmony'
import { MAX_RICHNESS, RECIPE_FROM, type ColourRule, type RecipeFrom, type RecipeHarmony } from '../engine/recipe'
import { isBlendMode } from '../engine/blendModes'
import { FLAT_CURVE, MAX_STRENGTH, normaliseCurve, type GrainCurve } from '../engine/curve'
import { DEFAULT_DEFECTS } from '../sources/defects'
import { MAX_CONVERGE, MAX_STREAK_POINTS } from '../engine/streaks'
import {
  DEFAULT_BLEND_PARAMS,
  DEFAULT_BORDER,
  PAPER_KINDS,
  EDGE_KINDS,
  type PaperKind,
  type EdgeKind,
  DEFAULT_DITHER,
  DEFAULT_EFFECTS,
  DEFAULT_GRADE,
  DEFAULT_KEYS,
  DEFAULT_MODULES,
  DEFAULT_PIXEL_ART,
  DEFAULT_STREAKS,
  DEFAULT_GLASS,
  STREAK_DEFAULTS,
  DEFAULT_STREAK_FIX,
  MAX_STREAK_FIXES,
  MAX_FIX_COLOURS,
  MAX_STREAKS,
  DEFAULT_MASK,
  MAX_MASKS,
  DEFAULT_COLLAGE_PIECE,
  DEFAULT_ARRANGE,
  type CollageArrange,
  MAX_COLLAGE_PIECES,
  type CollageParams,
  type CollagePiece,
  MASK_SECTIONS,
  type MaskShape,
  type StreakShape,
  MAX_PALETTE,
  type PaletteId,
  MAX_BAND_GUIDES,
  type ModuleToggles,
  DEFAULT_LEAKS,
  DEFAULT_STOCK,
  MAX_LEAK_SPOTS,
  type ColourChoice,
  type ColourSource,
  type KeyControls,
  type LeakParams,
  type LeakSpot,
  type Rgb,
  DEFAULT_SURGE,
  type BorderParams,
  type EffectParams,
  type BlendParams,
  type PlateNormalise,
  type PlateSampling,
  type ResponseMode,
  type TilingMode,
} from '../engine/types'
import { MAX_OUTLINE_POINTS, MIN_OUTLINE_POINTS, randomSpots } from '../engine/leaks'
import { LEAK_STYLE_BY_ID } from '../engine/leakStyles'
import { STOCK_BY_ID } from '../engine/stocks'
import type { SerializedGrainSource } from '../sources/GrainSource'
import { PRESET_STORE, getAll, newId, put, remove, type PresetRecord } from './db'
import { CROP_ASPECTS, type CropAspect } from '../engine/crop'
import { DEFAULT_REPEAT, MAX_REPEATS, type RepeatModule, type RepeatParams } from '../engine/repeatParams'
import { DEFAULT_KALEIDO, KALEIDO_COPIES, KALEIDO_RINGS, type KaleidoParams } from '../engine/kaleido'
import { DEFAULT_SURFACE, SURFACE_KINDS, type SurfaceKind, type SurfaceParams } from '../engine/surface'
import { MAX_RECOLOURS, RECOLOUR_STARTS, type RecolourItem, type RecolourModule } from '../engine/recolour'
import { DEFAULT_LIGHT, MAX_LIGHTS } from '../engine/lighting'
import type { ExportFormat, ExportSizing } from '../pipeline/exportSize'

export const PRESET_SCHEMA_VERSION = 7

/** Versions this build can read; older ones are migrated on load. */
export const READABLE_SCHEMA_VERSIONS = [1, 2, 3, 4, 5, 6, 7]

export interface OutputSettings extends ExportSizing {
  /** 0..1, for a JPEG. */
  jpegQuality: number
  /** Appended to the input filename stem on export. */
  suffix: string
  /** 'match' keeps the photo's own format (a RAW, HEIC, AVIF, GIF or BMP file's is a JPEG). */
  format: ExportFormat
}

export const DEFAULT_OUTPUT: OutputSettings = { jpegQuality: 0.95, suffix: '', shape: 'original', longEdge: null, format: 'match' }

export interface PresetDoc {
  schemaVersion: number
  name: string
  grainSource: SerializedGrainSource
  blend: BlendParams
  output: OutputSettings
  /** What the recipe is for, in a line or two, for whoever it is shared with. */
  description?: string
  /**
   * The doc carries what was placed on its photo — streaks, masks, the
   * collage (see storage/parts.ts, placedOf) — on purpose: an export's
   * recipe, the session, a look saved with "include" ticked. Applying it
   * then brings them; otherwise a look leaves the photo's own alone.
   */
  placed?: boolean
}

const TILINGS: TilingMode[] = ['repeat', 'mirror', 'stochastic']
const PLATE_NORMALISE: PlateNormalise[] = ['off', 'centre', 'match']

/**
 * v2 stored grain response as three band multipliers evaluated against basis
 * curves that peak at black, mid-grey and white. That function is piecewise
 * linear with a kink at 0.5, so sampling it at five points and re-interpolating
 * reproduces the original rendering to within a fraction of a code value.
 */
function bandsToCurve(bands: Record<string, unknown>): GrainCurve {
  const at = (key: string) => num(bands[key], 1, 0, MAX_STRENGTH)
  const shadows = at('shadows')
  const midtones = at('midtones')
  const highlights = at('highlights')
  const legacy = (luma: number) => {
    const s = Math.max(0, 1 - 2 * luma)
    const h = Math.max(0, 2 * luma - 1)
    return shadows * s + midtones * (1 - s - h) + highlights * h
  }
  return [0, 0.25, 0.5, 0.75, 1].map((x) => ({ x, y: legacy(x) }))
}

const COLOUR_SOURCES: ColourSource[] = ['manual', 'light', 'shadow', 'accent', 'vivid']

function parseRgb(value: unknown, fallback: Rgb): Rgb {
  if (!Array.isArray(value) || value.length !== 3) return fallback
  return [num(value[0], fallback[0], 0, 1), num(value[1], fallback[1], 0, 1), num(value[2], fallback[2], 0, 1)]
}

function parseColour(value: unknown, fallback: ColourChoice): ColourChoice {
  const c = (value ?? {}) as Record<string, unknown>
  return {
    source: COLOUR_SOURCES.includes(c.source as ColourSource) ? (c.source as ColourSource) : fallback.source,
    colour: parseRgb(c.colour, fallback.colour),
    ...(typeof c.saturation === 'number' ? { saturation: num(c.saturation, 1, 0, 1.5) } : {}),
  }
}

function parseRule(value: unknown): ColourRule {
  const r = (value ?? {}) as Record<string, unknown>
  const from = RECIPE_FROM.some((f) => f.id === r.from) ? (r.from as RecipeFrom) : 'light'
  const harmony = HARMONIES.some((h) => h.id === r.harmony && h.id !== 'free') ? (r.harmony as RecipeHarmony) : 'complementary'
  const lead = r.lead === 0 || r.lead === 1 || r.lead === 2 ? r.lead : 2
  return {
    from,
    ...(from === 'fixed' ? { fixed: parseRgb(r.fixed, [1, 0.6, 0.35]) } : {}),
    harmony,
    lead,
    turn: num(r.turn, 0, -0.5, 0.5),
    richness: num(r.richness, 1, 0, MAX_RICHNESS),
    ...(r.shape === 'tide' ? { shape: 'tide' as const } : {}),
  }
}

/** Old leak styles, before leaks had a colour and placed spots. */
const LEGACY_LEAK_COLOURS: Record<string, Rgb> = {
  warm: [1, 0.6, 0.3],
  red: [1, 0.3, 0.2],
  violet: [0.85, 0.5, 1],
  burn: [1, 0.6, 0.3],
}

function parseLeaks(value: unknown): LeakParams {
  const l = (value ?? {}) as Record<string, unknown>
  const seed = Math.round(num(l.seed, DEFAULT_LEAKS.seed, 0, 2 ** 31))
  const amount = num(l.amount, DEFAULT_LEAKS.amount, 0, 1)
  if (!Array.isArray(l.spots)) {
    // v4: a style and a count of randomly placed patches. Keep the colour and
    // the number, placed from the same seed.
    const style = typeof l.style === 'string' && l.style in LEGACY_LEAK_COLOURS ? l.style : 'warm'
    const count = Math.round(num(l.count, 2, 1, 4))
    return {
      amount,
      colour: { source: 'manual', colour: LEGACY_LEAK_COLOURS[style] },
      spots: randomSpots(seed, count, style === 'burn' ? 'burn' : 'light'),
      seed,
      style: 'scatter',
      layoutSeed: seed,
    }
  }
  const spots = l.spots.slice(0, MAX_LEAK_SPOTS).map((raw): LeakSpot => {
    const p = (raw ?? {}) as Record<string, unknown>
    return {
      x: num(p.x, 1, -0.5, 1.5),
      y: num(p.y, 0.2, -0.5, 1.5),
      size: num(p.size, 0.45, 0.02, 2),
      stretch: num(p.stretch, 1.9, 0.3, 5),
      angle: num(p.angle, 90, -360, 360),
      strength: num(p.strength, 1, 0, 2),
      kind: p.kind === 'burn' ? 'burn' : 'light',
      ...(p.colour ? { colour: parseColour(p.colour, DEFAULT_LEAKS.colour) } : {}),
      ...(typeof p.mask === 'string' ? { mask: p.mask } : {}),
      ...(typeof p.falloff === 'number' ? { falloff: num(p.falloff, 0, 0, 1) } : {}),
      ...(p.key === 'darker' || p.key === 'lighter' ? { key: p.key } : {}),
      ...(p.keyOn === 'blue' ? { keyOn: 'blue' as const } : {}),
      ...(typeof p.keyLevel === 'number' ? { keyLevel: num(p.keyLevel, 0.4, 0, 1) } : {}),
      ...(typeof p.keySoftness === 'number' ? { keySoftness: num(p.keySoftness, 0.08, 0.002, 0.5) } : {}),
      ...(Array.isArray(p.outline) && p.outline.length >= MIN_OUTLINE_POINTS
        ? {
            outline: p.outline.slice(0, p.polygon === true ? MAX_STREAK_POINTS : MAX_OUTLINE_POINTS).map((pt) => {
              const o = (pt ?? {}) as Record<string, unknown>
              return { x: num(o.x, 0.5, -0.5, 1.5), y: num(o.y, 0.5, -0.5, 1.5) }
            }),
            seed: Math.round(num(p.seed, 0, 0, 99991)),
            ...(p.polygon === true ? { polygon: true } : {}),
            ...(p.rounded === true ? { rounded: true } : {}),
            ...(typeof p.texture === 'number' ? { texture: num(p.texture, 1, 0, 1) } : {}),
            ...(typeof p.edge === 'number' ? { edge: num(p.edge, 0.03, 0.002, 0.3) } : {}),
          }
        : {}),
    }
  })
  return {
    amount,
    colour: parseColour(l.colour, DEFAULT_LEAKS.colour),
    spots,
    seed,
    style: typeof l.style === 'string' && l.style in LEAK_STYLE_BY_ID ? l.style : DEFAULT_LEAKS.style,
    layoutSeed: Math.round(num(l.layoutSeed, DEFAULT_LEAKS.layoutSeed, 0, 2 ** 31)),
  }
}

function parseModules(value: unknown): ModuleToggles {
  const m = (value ?? {}) as Record<string, unknown>
  const out = { ...DEFAULT_MODULES }
  for (const key of Object.keys(out) as (keyof ModuleToggles)[])
    if (typeof m[key] === 'boolean') out[key] = m[key] as boolean
  // Looks from before Edges and Solarize had switches: edges went with the
  // Glow switch, solarize with Tone's.
  if (typeof m.edges !== 'boolean') out.edges = out.light
  if (typeof m.solarize !== 'boolean') out.solarize = out.tone
  return out
}

function parsePoint(value: unknown, fallback: { x: number; y: number }): { x: number; y: number } {
  const p = (value ?? {}) as Record<string, unknown>
  return { x: num(p.x, fallback.x, -0.5, 1.5), y: num(p.y, fallback.y, -0.5, 1.5) }
}

function parseKeys(value: unknown): KeyControls {
  const k = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_KEYS
  return {
    look: num(k.look, d.look, 0, 2),
    grain: num(k.grain, d.grain, 0, 3),
    colour: num(k.colour, d.colour, 0, 3),
    glow: num(k.glow, d.glow, 0, 3),
    leaks: num(k.leaks, d.leaks, 0, 3),
    wash: num(k.wash, d.wash, 0, 3),
  }
}

const MASK_KEYS = ['off', 'darker', 'lighter'] as const
const FEATHER_AT = ['inside', 'centre', 'outside'] as const

function parseMask(raw: unknown, fallbackId: string, fallbackName: string): MaskShape | null {
  const m = (raw ?? {}) as Record<string, unknown>
  if (!Array.isArray(m.outline) || m.outline.length < 3) return null
  const d = DEFAULT_MASK
  const r = (m.radial ?? null) as Record<string, unknown> | null
  const g = (m.gradient ?? null) as Record<string, unknown> | null
  const radial =
    m.kind === 'radial' && r
      ? {
          x: num(r.x, 0.5, -0.5, 1.5),
          y: num(r.y, 0.5, -0.5, 1.5),
          rx: num(r.rx, 0.3, 0.01, 3),
          ry: num(r.ry, 0.3, 0.01, 3),
          angle: num(r.angle, 0, -360, 360),
          soft: num(r.soft, 0.5, 0, 1),
        }
      : undefined
  const gradient =
    m.kind === 'gradient' && g
      ? { x0: num(g.x0, 0.5, -1, 2), y0: num(g.y0, 0.15, -1, 2), x1: num(g.x1, 0.5, -1, 2), y1: num(g.y1, 0.6, -1, 2) }
      : undefined
  return {
    ...(radial ? { kind: 'radial' as const, radial } : gradient ? { kind: 'gradient' as const, gradient } : {}),
    ...(m.enabled === false ? { enabled: false } : {}),
    id: typeof m.id === 'string' && m.id ? m.id : fallbackId,
    name: typeof m.name === 'string' && m.name ? m.name.slice(0, 60) : fallbackName,
    outline: m.outline.slice(0, MAX_STREAK_POINTS).map((pt) => parsePoint(pt, { x: 0.5, y: 0.5 })),
    feather: num(m.feather, d.feather, 0, 0.5),
    featherAt: FEATHER_AT.includes(m.featherAt as never) ? (m.featherAt as MaskShape['featherAt']) : d.featherAt,
    key: MASK_KEYS.includes(m.key as never) ? (m.key as MaskShape['key']) : d.key,
    keyOn: m.keyOn === 'blue' ? 'blue' : m.keyOn === 'colour' ? 'colour' : 'brightness',
    ...(Array.isArray(m.keyColour) && m.keyColour.length === 3 && m.keyColour.every((v) => typeof v === 'number' && Number.isFinite(v))
      ? { keyColour: (m.keyColour as number[]).map((v) => Math.min(1, Math.max(0, v))) as Rgb }
      : {}),
    keyLevel: num(m.keyLevel, d.keyLevel, 0, 1),
    keySoftness: num(m.keySoftness, d.keySoftness, 0, 0.5),
    cleanEdges: num(m.cleanEdges, d.cleanEdges, 0, 1),
    ...(m.keyWas === 'darker' || m.keyWas === 'lighter' ? { keyWas: m.keyWas } : {}),
    ...(m.keyAt === 'edge' ? { keyAt: 'edge' as const, keyBand: m.keyBand === OLD_KEY_BAND ? KEY_BAND : num(m.keyBand, KEY_BAND, 0.002, 0.2) } : {}),
    grow: num(m.grow, 0, 0, 0.5),
    ...(m.owner === 'repeat' || m.owner === 'streak' || m.owner === 'kaleido' || m.owner === 'recolour' ? { owner: m.owner } : {}),
    ...(() => {
      const r = (m.raster ?? null) as Record<string, unknown> | null
      if (!r || typeof r.runs !== 'string' || !r.runs) return {}
      const w = Math.round(num(r.w, 0, 0, 4096))
      const h = Math.round(num(r.h, 0, 0, 4096))
      if (w < 1 || h < 1) return {}
      return {
        raster: {
          w,
          h,
          runs: r.runs,
          x: num(r.x, 0, -2, 2),
          y: num(r.y, 0, -2, 2),
          width: num(r.width, 1, 0.001, 4),
          height: num(r.height, 1, 0.001, 4),
          ...(typeof r.paintIn === 'string' && r.paintIn ? { paintIn: r.paintIn } : {}),
          ...(typeof r.paintSure === 'string' && r.paintSure ? { paintSure: r.paintSure } : {}),
          ...(typeof r.paintOut === 'string' && r.paintOut ? { paintOut: r.paintOut } : {}),
        },
      }
    })(),
  }
}

/**
 * Masks and which sections use them. Masks used to be streak shapes of their
 * own (mode 'mask') that only held streaks back: those become masks here,
 * used by Streaks, so an older edit looks the same.
 */
function parseCollage(value: unknown): CollageParams {
  const c = (value ?? {}) as Record<string, unknown>
  const pieces: CollagePiece[] = []
  for (const raw of Array.isArray(c.pieces) ? c.pieces.slice(0, MAX_COLLAGE_PIECES) : []) {
    const p = (raw ?? {}) as Record<string, unknown>
    if (typeof p.id !== 'string' || typeof p.image !== 'string' || !Array.isArray(p.seeds)) continue
    const seeds = p.seeds
      .slice(0, 16)
      .map((q) => (q ?? {}) as Record<string, unknown>)
      .filter((q) => typeof q.x === 'number' && typeof q.y === 'number')
      .map((q) => ({ x: num(q.x, 0.5, 0, 1), y: num(q.y, 0.5, 0, 1) }))
    if (!seeds.length || pieces.some((x) => x.id === p.id)) continue
    const d = DEFAULT_COLLAGE_PIECE
    pieces.push({
      id: p.id,
      image: p.image,
      seeds,
      tolerance: num(p.tolerance, d.tolerance, 0, 1),
      seal: num(p.seal, d.seal, 0, 1),
      soften: num(p.soften, d.soften, 0, 1),
      x: num(p.x, 0.5, -2, 3),
      y: num(p.y, 0.5, -2, 3),
      scale: num(p.scale, 1, 0.02, 20),
      rotation: num(p.rotation, 0, -360, 360),
      flip: p.flip === true,
      match: num(p.match, d.match, 0, 1),
      brightness: num(p.brightness, d.brightness, -3, 3),
      opacity: num(p.opacity, d.opacity, 0, 1),
      takeLook: num(p.takeLook, d.takeLook, 0, 1),
      detail: num(p.detail, d.detail, 0, 1),
      fillHoles: p.fillHoles !== false,
      ...(p.throughLeaves === true ? { throughLeaves: true } : {}),
      ...(typeof p.keepLight === 'number' ? { keepLight: num(p.keepLight, 0, 0, 1) } : {}),
      ...(typeof p.relight === 'number' ? { relight: num(p.relight, 0, 0, 1) } : {}),
      ...(typeof p.smooth === 'number' ? { smooth: num(p.smooth, 0, 0, 1) } : {}),
      ...(Array.isArray(p.tint) && p.tint.length === 3 && p.tint.every((v) => typeof v === 'number' && Number.isFinite(v))
        ? { tint: (p.tint as number[]).map((v) => Math.min(4, Math.max(0.25, v))) as [number, number, number] }
        : {}),
    })
  }
  const arrange = parseArrange(c.arrange)
  return {
    enabled: c.enabled !== false,
    photo: Math.round(num(c.photo, 0, 0, 2 ** 32)),
    scale: num(c.scale, 1, 0.05, 20),
    pieces,
    ...(arrange ? { arrange } : {}),
  }
}

function parseArrange(value: unknown): CollageArrange | undefined {
  if (!value || typeof value !== 'object') return undefined
  const a = value as Record<string, unknown>
  const d = DEFAULT_ARRANGE
  const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
  return {
    cells: (Array.isArray(a.cells) ? a.cells : [])
      .slice(0, MAX_COLLAGE_PIECES * 2)
      .map((q) => (q ?? {}) as Record<string, unknown>)
      .filter((q) => typeof q.x === 'number' && typeof q.y === 'number')
      .map((q) => ({
        x: num(q.x, 0.5, 0, 1),
        y: num(q.y, 0.5, 0, 1),
        ...(typeof q.group === 'number' && Number.isFinite(q.group) ? { group: Math.round(q.group) } : {}),
        ...(typeof q.image === 'string' && q.image ? { image: q.image } : {}),
      })),
    images: (Array.isArray(a.images) ? a.images : []).filter((v): v is string => typeof v === 'string').slice(0, 200),
    flow: pick(a.flow, ['down', 'up', 'right', 'left', 'out', 'in', 'none'] as const, d.flow),
    by: pick(a.by, ['tone', 'warmth', 'hue'] as const, d.by),
    follow: num(a.follow, d.follow, 0, 1),
    neighbours: num(a.neighbours, d.neighbours, -1, 1),
    join: a.join === true,
    match: num(a.match, d.match, 0, 1),
    evenTone: num(a.evenTone, d.evenTone, 0, 1),
    harmony: num(a.harmony, d.harmony, 0, 1),
    size: num(a.size, d.size, 0.05, 4),
    vary: a.vary !== false,
    seed: Math.round(num(a.seed, d.seed, 0, 1e9)),
  }
}

function parseMasks(e: Record<string, unknown>): Pick<EffectParams, 'masks' | 'maskUse'> {
  const masks: MaskShape[] = []
  const raw = Array.isArray(e.masks) ? e.masks : []
  raw.forEach((m, i) => {
    const parsed = parseMask(m, `mask-${i + 1}`, `Mask ${i + 1}`)
    if (parsed && !masks.some((x) => x.id === parsed.id)) masks.push(parsed)
  })
  const maskUse: EffectParams['maskUse'] = {}
  const use = (e.maskUse ?? {}) as Record<string, unknown>
  for (const section of MASK_SECTIONS) {
    const u = (use[section] ?? null) as Record<string, unknown> | null
    if (!u || !Array.isArray(u.ids)) continue
    const ids = u.ids.filter((id): id is string => typeof id === 'string' && masks.some((m) => m.id === id))
    maskUse[section] = { ids, mode: u.mode === 'only' ? 'only' : 'exclude' }
  }
  // Before Edges and Solarize had masks of their own, Glow's mask covered
  // the edges and Tone's the solarizing: they keep what they had.
  if (!('edges' in use) && maskUse.light) maskUse.edges = { ...maskUse.light, ids: [...maskUse.light.ids] }
  if (!('solarize' in use) && maskUse.tone) maskUse.solarize = { ...maskUse.tone, ids: [...maskUse.tone.ids] }
  // Before Dither and Pixel art had masks of their own, Grain's held the
  // dither back and Colour's the palette; Repeat's copies kept inside one
  // mask of their own (within). They keep what they had.
  if (!('dither' in use) && maskUse.grain) maskUse.dither = { ...maskUse.grain, ids: [...maskUse.grain.ids] }
  if (!('pixel' in use) && maskUse.colour) maskUse.pixel = { ...maskUse.colour, ids: [...maskUse.colour.ids] }
  const within = (e.repeat as Record<string, unknown> | undefined)?.within
  if (!('repeat' in use) && typeof within === 'string' && masks.some((m) => m.id === within)) maskUse.repeat = { ids: [within], mode: 'only' }
  const streakShapes = Array.isArray((e.streaks as Record<string, unknown> | undefined)?.shapes)
    ? ((e.streaks as Record<string, unknown>).shapes as unknown[])
    : []
  const legacy: string[] = []
  streakShapes.forEach((raw, i) => {
    if ((raw as Record<string, unknown> | null)?.mode !== 'mask' || masks.length >= MAX_MASKS) return
    const parsed = parseMask(raw, `streak-mask-${i + 1}`, `Mask ${masks.length + 1}`)
    if (parsed) {
      masks.push(parsed)
      legacy.push(parsed.id)
    }
  })
  if (legacy.length) {
    const prev = maskUse.streaks
    maskUse.streaks = { ids: [...(prev?.ids ?? []), ...legacy], mode: prev?.mode ?? 'exclude' }
  }
  return { masks: masks.slice(0, MAX_MASKS), maskUse }
}

function parseEffects(value: unknown): EffectParams {
  return ownMasks(parseEffectsAsSaved(value))
}

/**
 * A streak's subject and Repeat's piece are theirs, kept in them, not in the
 * Masks list (MaskShape.owner). An edit from before took them from the list:
 * a mask used only as one streak's subject (and kept in front of it), or
 * only as Repeat's piece, becomes that one's own. One used anywhere else
 * stays in the list for all of them.
 */
export function ownMasks(fx: EffectParams): EffectParams {
  const uses = new Map<string, Set<string>>()
  const use = (id: string | null | undefined, by: string) => {
    if (!id) return
    if (!uses.has(id)) uses.set(id, new Set())
    uses.get(id)!.add(by)
  }
  fx.streaks.shapes.forEach((sh, i) => {
    if (sh.subject) use(sh.subject.mask, `subject:${i}`)
    sh.maskIds.forEach((id) => use(id, id === sh.subject?.mask ? `subject:${i}` : `streak:${i}`))
    use(sh.repeatMask ?? null, `streak:${i}`)
  })
  fx.repeat?.items.forEach((r) => use(r.source, 'piece'))
  use(fx.kaleido?.source ?? null, 'kaleido')
  fx.recolour?.items.forEach((it) => use(it.source, 'recolour'))
  for (const [section, m] of Object.entries(fx.maskUse ?? {})) m?.ids.forEach((id) => use(id, `section:${section}`))
  ;(fx.lighting?.lights ?? []).forEach((l) => {
    use(l.mask ?? null, 'light')
    use(l.holdMask ?? null, 'light')
  })
  fx.leaks.spots.forEach((s) => {
    use(s.mask ?? null, 'leak')
    use(s.hold?.mask ?? null, 'leak')
  })
  let changed = false
  const masks = fx.masks.map((m) => {
    if (m.owner) return m
    const by = [...(uses.get(m.id) ?? [])]
    if (by.length !== 1) return m
    const owner = by[0].startsWith('subject:') ? ('streak' as const) : by[0] === 'piece' ? ('repeat' as const) : by[0] === 'kaleido' ? ('kaleido' as const) : by[0] === 'recolour' ? ('recolour' as const) : null
    if (!owner) return m
    changed = true
    return { ...m, owner }
  })
  return changed ? { ...fx, masks } : fx
}

function parseEffectsAsSaved(value: unknown): EffectParams {
  const e = (value ?? {}) as Record<string, unknown>
  const masks = parseMasks(e)
  const streaks = (e.streaks ?? {}) as Record<string, unknown>
  const hasShapes = masks.masks.length > 0 || (Array.isArray(streaks.shapes) && streaks.shapes.length > 0)
  return {
    ...masks,
    // Saved before shapes were put on the photo (no shapeSpace): their
    // fractions are of the print, and are read that way so they stay where
    // they were drawn. With nothing drawn there is nothing to keep.
    shapeSpace: e.shapeSpace === 'photo' || !hasShapes ? 'photo' : 'print',
    // Saved before streaks were measured on the photo (no shapeUnits): their
    // bars were sized and counted on the print, and are kept that way so an
    // edit looks as it did. With nothing drawn there is nothing to keep.
    shapeUnits: e.shapeUnits === 'photo' || !hasShapes ? 'photo' : 'print',
    collage: parseCollage(e.collage),
    base: parseBase(e.base),
    mono: parseMono(e.mono),
    halftone: parseHalftone(e.halftone),
    lens: parseLens(e.lens),
    prism: parsePrism(e.prism),
    double: parseDouble(e.double),
    stamp: parseStamp(e.stamp),
    halation: num(e.halation, DEFAULT_EFFECTS.halation, 0, 1),
    bloom: num(e.bloom, DEFAULT_EFFECTS.bloom, 0, 1),
    rim: num(e.rim, DEFAULT_EFFECTS.rim, 0, 2),
    rimRadius: num(e.rimRadius, DEFAULT_EFFECTS.rimRadius, 0.001, 0.05),
    crunch: num(e.crunch, DEFAULT_EFFECTS.crunch, 0, 1),
    halo: num(e.halo, DEFAULT_EFFECTS.halo, 0, 1),
    haloRadius: num(e.haloRadius, DEFAULT_EFFECTS.haloRadius, 0.005, 0.1),
    structure: num(e.structure, DEFAULT_EFFECTS.structure, 0, 1),
    structureRadius: num(e.structureRadius, DEFAULT_EFFECTS.structureRadius, 0.002, 0.04),
    solarize: num(e.solarize, DEFAULT_EFFECTS.solarize, 0, 1),
    solarizeFrom: num(e.solarizeFrom, DEFAULT_EFFECTS.solarizeFrom, 0.3, 0.98),
    dither: (() => {
      const d = (e.dither ?? {}) as Record<string, unknown>
      return {
        amount: num(d.amount, DEFAULT_DITHER.amount, 0, 1),
        steps: Math.round(num(d.steps, DEFAULT_DITHER.steps, 2, 64)),
        spread: num(d.spread, DEFAULT_DITHER.spread, 0, 2),
        follow: num(d.follow, DEFAULT_DITHER.follow, 0, 1),
        from: parsePoint(d.from, DEFAULT_DITHER.from),
        to: parsePoint(d.to, DEFAULT_DITHER.to),
        shape: d.shape === 'oval' ? 'oval' : 'line',
        stretch: num(d.stretch, DEFAULT_DITHER.stretch, 0.2, 5),
        pixel: Math.round(num(d.pixel, DEFAULT_DITHER.pixel, 1, 32)),
        // Saved before Whole blocks was offered: as they were made, dots that can split.
        blocks: d.blocks === true,
        ...(typeof d.keepLines === 'number' && d.keepLines > 0 ? { keepLines: num(d.keepLines, 0, 0, 1) } : {}),
        ...(typeof d.clumps === 'number' && d.clumps > 1 ? { clumps: num(d.clumps, 1, 1, 4) } : {}),
        pattern: d.pattern === 'ordered' ? 'ordered' : 'grain',
        // Saved before the dither had dots of its own: its dots from the grain, as they were made.
        followGrain: d.followGrain !== false,
        enabled: d.enabled !== false,
        guidesOn: d.guidesOn !== false,
        transitionsOnly: num(d.transitionsOnly, DEFAULT_DITHER.transitionsOnly, 0, 1),
        sparePop: num(d.sparePop, DEFAULT_DITHER.sparePop, 0, 1),
        toneLo: num(d.toneLo, DEFAULT_DITHER.toneLo, 0, 1),
        toneHi: num(d.toneHi, DEFAULT_DITHER.toneHi, 0, 1),
        guides: Array.isArray(d.guides)
          ? d.guides.slice(0, MAX_BAND_GUIDES).map((raw) => {
              const g = (raw ?? {}) as Record<string, unknown>
              return {
                x: num(g.x, 0.5, -0.5, 1.5),
                y: num(g.y, 0.5, -0.5, 1.5),
                radius: num(g.radius, 0.3, 0.02, 2),
                strength: num(g.strength, 0.5, -1, 1),
              }
            })
          : [],
      }
    })(),
    stock: (() => {
      const st = (e.stock ?? {}) as Record<string, unknown>
      return {
        id: typeof st.id === 'string' && st.id in STOCK_BY_ID ? st.id : DEFAULT_STOCK.id,
        strength: num(st.strength, DEFAULT_STOCK.strength, 0, 1.5),
        keepTone: num(st.keepTone, DEFAULT_STOCK.keepTone, 0, 1),
      }
    })(),
    grade: (() => {
      const g = (e.grade ?? {}) as Record<string, unknown>
      const d = DEFAULT_GRADE
      return {
        vibrance: num(g.vibrance, d.vibrance, -1, 1),
        warmth: num(g.warmth, d.warmth, -1, 1),
        tint: num(g.tint, d.tint, -1, 1),
        shadowTint: parseColour(g.shadowTint, d.shadowTint),
        shadowAmount: num(g.shadowAmount, d.shadowAmount, 0, 1),
        highlightTint: parseColour(g.highlightTint, d.highlightTint),
        highlightAmount: num(g.highlightAmount, d.highlightAmount, 0, 1),
        mapAmount: num(g.mapAmount, d.mapAmount, 0, 1),
        mapShadow: parseColour(g.mapShadow, d.mapShadow),
        mapMid: parseColour(g.mapMid, d.mapMid),
        mapHigh: parseColour(g.mapHigh, d.mapHigh),
        mapContrast: num(g.mapContrast, d.mapContrast, -1, 1),
        mapBalance: num(g.mapBalance, d.mapBalance, -1, 1),
        mapHarmony: HARMONIES.some((h) => h.id === g.mapHarmony) ? (g.mapHarmony as Harmony) : d.mapHarmony,
        blobs: (Array.isArray(g.blobs) ? g.blobs : []).slice(0, MAX_BLOBS).map((raw) => {
          const b = (raw ?? {}) as Record<string, unknown>
          return {
            x: num(b.x, 0, -1, 1),
            y: num(b.y, 0, -1, 1),
            reach: num(b.reach, 0.4, 0.05, 2),
            tone: num(b.tone, 0.5, 0, 1),
            toneWidth: num(b.toneWidth, 1, 0.05, 1),
            strength: num(b.strength, 0.8, 0, 1),
            kind: b.kind === 'ladder' ? ('ladder' as const) : ('magnet' as const),
          }
        }),
        isolateAmount: num(g.isolateAmount, d.isolateAmount, 0, 1),
        isolateColour: parseColour(g.isolateColour, d.isolateColour),
        isolateWidth: num(g.isolateWidth, d.isolateWidth, 0.05, 1),
        popAmount: num(g.popAmount, d.popAmount, 0, 1),
        popKeep: num(g.popKeep, d.popKeep, 0, 1),
        popColour: parseColour(g.popColour, d.popColour),
        restColour: parseColour(g.restColour, d.restColour),
        ...(g.recipe ? { recipe: parseRule(g.recipe) } : {}),
        ...(Array.isArray(g.picks) && g.picks.length ? { picks: parsePicks(g.picks) } : {}),
      }
    })(),
    glowColour: parseColour(e.glowColour, DEFAULT_EFFECTS.glowColour),
    leaks: parseLeaks(e.leaks),
    streaks: (() => {
      const t = (e.streaks ?? {}) as Record<string, unknown>
      const shapes = Array.isArray(t.shapes) ? t.shapes : []
      return {
        enabled: t.enabled !== false,
        amount: num(t.amount, DEFAULT_STREAKS.amount, 0, 1),
        prism: num(t.prism, 0, 0, 0.05),
        prismAngle: num(t.prismAngle, 0, -180, 180),
        glow: num(t.glow, 0, 0, 2),
        glowRadius: num(t.glowRadius, 0.03, 0.003, 0.15),
        // Old masks were streak shapes; they are masks now (parseMasks).
        shapes: shapes
          .filter((raw) => (raw as Record<string, unknown> | null)?.mode !== 'mask')
          .slice(0, MAX_STREAKS)
          .flatMap((raw): StreakShape[] => {
          const sh = (raw ?? {}) as Record<string, unknown>
          if (!Array.isArray(sh.outline) || sh.outline.length < 3) return []
          const mode = sh.mode === 'trail' || sh.mode === 'mask' ? sh.mode : 'fill'
          const point = (pt: unknown) => {
            const o = (pt ?? {}) as Record<string, unknown>
            return { x: num(o.x, 0.5, -0.5, 1.5), y: num(o.y, 0.5, -0.5, 1.5) }
          }
          // Older streaks had one Ragged amount: bars down to 30% (fill) or
          // 15% (trail) shorter at full Ragged.
          const ragged = num(sh.ragged, 0.5, 0, 1)
          const d = STREAK_DEFAULTS
          const outline = sh.outline.slice(0, MAX_STREAK_POINTS).map(point)
          // Fills saved before Bar lengths existed measured their bars against
          // the diagonal of the box round the shape: as a distance, that is
          // about the box's diagonal in print fractions.
          const legacyFill = mode === 'fill' && sh.measure === undefined
          const xs = outline.map((p) => p.x)
          const ys = outline.map((p) => p.y)
          const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
          return [
            {
              outline,
              angle: num(sh.angle, d.angle, -360, 360),
              path: Array.isArray(sh.path) && sh.path.length >= 2 ? sh.path.slice(0, 16).map(point) : null,
              converge: num(sh.converge, d.converge, -MAX_CONVERGE, MAX_CONVERGE),
              radial: sh.radial === true,
              radialRadius: num(sh.radialRadius, d.radialRadius, 0, 2),
              radialAround: sh.radialAround === true,
              radialReach: num(sh.radialReach, d.radialReach, 0, 3),
              radialCentre: sh.radialCentre && typeof sh.radialCentre === 'object' ? point(sh.radialCentre) : null,
              pathEase: num(sh.pathEase, d.pathEase, 0, 1),
              pathWidth: num(sh.pathWidth, d.pathWidth, 0, 2),
              ends: Array.isArray(sh.ends) && sh.ends.length >= 2 ? sh.ends.slice(0, 32).map(point) : null,
              ...(Array.isArray(sh.colourLine) && sh.colourLine.length >= 2 ? { colourLine: sh.colourLine.slice(0, 24).map(point) } : {}),
              band: num(sh.band, d.band, 0.002, 0.1),
              stripeMin: Math.min(num(sh.stripeMin, d.stripeMin, 0, 0.1), num(sh.stripeMax, d.stripeMax, 0, 0.1)),
              stripeMax: num(sh.stripeMax, d.stripeMax, 0, 0.1),
              stripeTexture: num(sh.stripeTexture, d.stripeTexture, 0, 1),
              barVary: num(sh.barVary, d.barVary, 0, 0.95),
              seed: Math.round(num(sh.seed, 1, 0, 99991)),
              mode,
              clip: typeof sh.clip === 'boolean' ? sh.clip : d.clip,
              measure: sh.measure === 'across' || sh.measure === 'distance' ? sh.measure : legacyFill ? 'distance' : d.measure,
              length: legacyFill ? Math.min(2, Math.max(0.02, diagonal)) : num(sh.length, d.length, 0.02, 2),
              lengthMin: num(sh.lengthMin, 1 - ragged * (mode === 'trail' ? 0.85 : 0.7), 0, 1),
              lengthMax: num(sh.lengthMax, d.lengthMax, 0, 1),
              variation: num(sh.variation, d.variation, 0, 1),
              // Older shapes said which end was ragged: 'far' grew from the edge.
              anchor:
                sh.anchor === 'edge' || sh.anchor === 'far'
                  ? sh.anchor
                  : sh.tips === 'far'
                    ? 'edge'
                    : sh.tips === 'near' || legacyFill
                      ? 'far'
                      : d.anchor,
              tipAngle: num(sh.tipAngle, d.tipAngle, -75, 75),
              tipRange: num(sh.tipRange, d.tipRange, 0, 75),
              feather: num(sh.feather, d.feather, 0, 0.2),
              // Before Soft ends, the feather softened the bar ends too.
              endSoftness: num(sh.endSoftness, num(sh.feather, d.feather, 0, 0.2), 0, 0.2),
              brightness: num(sh.brightness, d.brightness, -3, 3),
              contrast: num(sh.contrast, d.contrast, -1, 1),
              opacity: num(sh.opacity, d.opacity, 0, 1),
              // Before the tone changed along the bar, its end was its start.
              endBrightness: num(sh.endBrightness, num(sh.brightness, d.brightness, -3, 3), -3, 3),
              endContrast: num(sh.endContrast, num(sh.contrast, d.contrast, -1, 1), -1, 1),
              endOpacity: num(sh.endOpacity, num(sh.opacity, d.opacity, 0, 1), 0, 1),
              changeAt: num(sh.changeAt, d.changeAt, 0, 1),
              changeLength: num(sh.changeLength, d.changeLength, 0, 1),
              featherAt: sh.featherAt === 'centre' || sh.featherAt === 'outside' ? sh.featherAt : 'inside',
              featherEdge: sh.featherEdge === 'grain' ? 'grain' : 'smooth',
              pull: num(sh.pull, d.pull, -0.5, 0.5),
              ...(sh.enabled === false ? { enabled: false } : {}),
              ...(sh.carry === 'repeat' ? { carry: 'repeat' as const } : {}),
              ...(typeof sh.bend === 'number' && sh.bend !== 0 ? { bend: num(sh.bend, 0, -0.6, 0.6) } : {}),
              ...(Array.isArray(sh.guides)
                ? {
                    guides: (sh.guides as unknown[]).slice(0, 8).flatMap((raw) => {
                      const g = (raw ?? {}) as Record<string, unknown>
                      const pts = Array.isArray(g.points) ? (g.points as unknown[]).slice(0, 32).map((q) => parsePoint(q, { x: 0.5, y: 0.5 })) : null
                      return g.a && g.b
                        ? [{ a: parsePoint(g.a, { x: 0.5, y: 0.5 }), b: parsePoint(g.b, { x: 0.5, y: 0.5 }), ...(pts && pts.length >= 2 ? { points: pts } : {}) }]
                        : []
                    }),
                  }
                : {}),
              ...(typeof sh.repeatLength === 'number' ? { repeatLength: num(sh.repeatLength, 0.08, 0.005, 1) } : {}),
              ...(typeof sh.repeatPeriod === 'number' && sh.repeatPeriod > 0 ? { repeatPeriod: num(sh.repeatPeriod, 0.08, 0.002, 1) } : {}),
              ...(typeof sh.repeatVanish === 'number' && sh.repeatVanish !== 0 ? { repeatVanish: num(sh.repeatVanish, 0, -0.9, 3) } : {}),
              ...(sh.repeatMirror === true ? { repeatMirror: true } : {}),
              ...(typeof sh.repeatScale === 'number' ? { repeatScale: num(sh.repeatScale, 1, 0.3, 3) } : {}),
              ...(typeof sh.repeatDetail === 'number' ? { repeatDetail: num(sh.repeatDetail, 0.8, 0, 2) } : {}),
              ...(typeof sh.repeatScatter === 'number' ? { repeatScatter: num(sh.repeatScatter, 0.6, 0, 1) } : {}),
              ...(typeof sh.repeatHold === 'number' ? { repeatHold: num(sh.repeatHold, 0.5, 0, 1) } : {}),
              ...(typeof sh.lengthBeforeExtend === 'number' ? { lengthBeforeExtend: num(sh.lengthBeforeExtend, 0.4, 0.02, 1.5) } : {}),
              // Only plain values of settings a streak has: anything else is dropped.
              ...(sh.beforeExtend && typeof sh.beforeExtend === 'object'
                ? {
                    beforeExtend: Object.fromEntries(
                      Object.entries(sh.beforeExtend as Record<string, unknown>).filter(
                        ([k, v]) => k in d && ['number', 'string', 'boolean'].includes(typeof v) && (typeof v !== 'number' || Number.isFinite(v)),
                      ),
                    ),
                  }
                : {}),
              ...(sh.repeatVary === false ? { repeatVary: false } : {}),
              ...(typeof sh.repeatFrom === 'number' ? { repeatFrom: num(sh.repeatFrom, 0, 0, 0.5) } : {}),
              ...(typeof sh.repeatMask === 'string' && sh.repeatMask ? { repeatMask: sh.repeatMask } : {}),
              skipMasked: typeof sh.skipMasked === 'boolean' ? sh.skipMasked : d.skipMasked,
              fixes: (Array.isArray(sh.fixes) ? sh.fixes : []).slice(0, MAX_STREAK_FIXES).flatMap((raw: unknown) => {
                const f = (raw ?? {}) as Record<string, unknown>
                if (!f.a || !f.b) return []
                const df = DEFAULT_STREAK_FIX
                return [
                  {
                    a: point(f.a),
                    b: point(f.b),
                    feather: num(f.feather, df.feather, 0, 0.1),
                    // Made before fixes could keep the colours: they copied, unless recoloured.
                    mode: f.mode === 'colours' ? ('colours' as const) : f.mode === 'keep' ? ('keep' as const) : ('borrow' as const),
                    brightness: num(f.brightness, df.brightness, -3, 3),
                    contrast: num(f.contrast, df.contrast, -1, 1),
                    opacity: num(f.opacity, df.opacity, 0, 1),
                    source: (() => {
                      const src = f.source as Record<string, unknown> | null | undefined
                      return src && src.a && src.b ? { a: point(src.a), b: point(src.b) } : null
                    })(),
                    masked: f.masked === true,
                    ...(f.carry === 'repeat' || f.carry === 'colour' ? { carry: f.carry as 'repeat' | 'colour' } : {}),
                    reach: num(f.reach, df.reach, 0.2, 6),
                    side: f.side === 'before' || f.side === 'after' ? f.side : ('both' as const),
                    colours: (Array.isArray(f.colours) ? f.colours : []).slice(0, MAX_FIX_COLOURS).map((c: unknown) => parseRgb(c, [0.5, 0.5, 0.5])),
                    variation: num(f.variation, df.variation, 0, 1),
                    seed: Math.round(num(f.seed, 1, 0, 99991)),
                  },
                ]
              }),
              maskIds: Array.isArray(sh.maskIds) ? sh.maskIds.filter((id): id is string => typeof id === 'string').slice(0, 8) : [],
              maskMode: sh.maskMode === 'exclude' || sh.maskMode === 'only' ? sh.maskMode : 'off',
              key: sh.key === 'darker' || sh.key === 'lighter' ? sh.key : 'off',
              keyOn: sh.keyOn === 'blue' ? 'blue' : 'brightness',
              keyLevel: num(sh.keyLevel, d.keyLevel, 0, 1),
              keySoftness: num(sh.keySoftness, d.keySoftness, 0, 0.5),
              ...(() => {
                const sub = sh.subject as Record<string, unknown> | undefined
                return sub && typeof sub.mask === 'string' ? { subject: { mask: sub.mask, inset: num(sub.inset, 0.008, 0, 0.1) } } : {}
              })(),
            },
          ]
        }),
      }
    })(),
    glass: (() => {
      const g = (e.glass ?? {}) as Record<string, unknown>
      const d = DEFAULT_GLASS
      return {
        ...(typeof g.enabled === 'boolean' ? { enabled: g.enabled } : {}),
        amount: num(g.amount, d.amount, 0, 1),
        kind: g.kind === 'facets' || g.kind === 'ripple' ? g.kind : 'reeded',
        width: num(g.width, d.width, 0.004, 0.3),
        angle: num(g.angle, d.angle, -180, 180),
        dispersion: num(g.dispersion, d.dispersion, 0, 1),
        edges: num(g.edges, d.edges, 0, 1),
      }
    })(),
    pixelArt: (() => {
      const p = (e.pixelArt ?? {}) as Record<string, unknown>
      const d = DEFAULT_PIXEL_ART
      const ids: PaletteId[] = ['off', 'photo', 'gameboy', 'pico8', 'cga', 'onebit', 'dusk']
      const pixelate = Math.round(num(p.pixelate, d.pixelate, 1, 64))
      const palette = ids.includes(p.palette as PaletteId) ? (p.palette as PaletteId) : d.palette
      return {
        // Saved before it had a switch: on if it was doing anything.
        enabled: typeof p.enabled === 'boolean' ? p.enabled : pixelate > 1 || palette !== 'off',
        pixelate,
        palette,
        colours: Math.round(num(p.colours, d.colours, 2, MAX_PALETTE)),
        amount: num(p.amount, d.amount, 0, 1),
        dither: num(p.dither, d.dither, 0, 1),
        ...(typeof p.keepLines === 'number' && p.keepLines > 0 ? { keepLines: num(p.keepLines, 0, 0, 1) } : {}),
      }
    })(),
    glowThreshold: num(e.glowThreshold, DEFAULT_EFFECTS.glowThreshold, 0, 1),
    // Saved before glow was fitted to the photo: left out, so it glows as it did.
    ...(typeof e.glowFit === 'boolean' ? { glowFit: e.glowFit } : {}),
    glowRadius: num(e.glowRadius, DEFAULT_EFFECTS.glowRadius, 0.002, 0.15),
    exposure: num(e.exposure, DEFAULT_EFFECTS.exposure, -3, 3),
    shoulder: num(e.shoulder, DEFAULT_EFFECTS.shoulder, 0, 1),
    fade: num(e.fade, DEFAULT_EFFECTS.fade, 0, 0.3),
    vignette: num(e.vignette, DEFAULT_EFFECTS.vignette, 0, 1),
    defects: (() => {
      const d = (e.defects ?? {}) as Record<string, unknown>
      return {
        strength: num(d.strength, DEFAULT_DEFECTS.strength, 0, 1),
        dust: num(d.dust, DEFAULT_DEFECTS.dust, 0, 600),
        hairs: Math.round(num(d.hairs, DEFAULT_DEFECTS.hairs, 0, 12)),
        scratches: Math.round(num(d.scratches, DEFAULT_DEFECTS.scratches, 0, 12)),
        scanLines: num(d.scanLines, DEFAULT_DEFECTS.scanLines, 0, 1),
        scanStreaks: num(d.scanStreaks, DEFAULT_DEFECTS.scanStreaks, 0, 1),
        seed: Math.round(num(d.seed, DEFAULT_DEFECTS.seed, 0, 2 ** 31)),
      }
    })(),
    surge: (() => {
      const g = (e.surge ?? {}) as Record<string, unknown>
      return {
        strength: num(g.strength, DEFAULT_SURGE.strength, 0, 1),
        count: Math.round(num(g.count, DEFAULT_SURGE.count, 0, 8)),
        width: num(g.width, DEFAULT_SURGE.width, 0.01, 0.3),
        angle: num(g.angle, DEFAULT_SURGE.angle, -180, 180),
        seed: Math.round(num(g.seed, DEFAULT_SURGE.seed, 0, 2 ** 31)),
      }
    })(),
    crop: (() => {
      const c = (e.crop ?? {}) as Record<string, unknown>
      const x = num(c.x, 0, 0, 0.98)
      const y = num(c.y, 0, 0, 0.98)
      return {
        enabled: c.enabled === true,
        x,
        y,
        width: num(c.width, 1, 0.02, 1 - x),
        height: num(c.height, 1, 0.02, 1 - y),
        aspect: CROP_ASPECTS.some((a) => a.id === c.aspect) ? (c.aspect as CropAspect) : 'free',
        turned: c.turned === true,
      }
    })(),
    repeat: parseRepeatModule(e.repeat),
    ...(e.kaleido ? { kaleido: parseKaleido(e.kaleido) } : {}),
    ...(e.surface ? { surface: parseSurface(e.surface) } : {}),
    ...(e.recolour ? { recolour: parseRecolour(e.recolour) } : {}),
  }
}

/** Recolour's parts, each with its own mask, colour and strength. */
export function parseRecolour(value: unknown): RecolourModule {
  const r = (value ?? {}) as Record<string, unknown>
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, MAX_RECOLOURS).map((v, i): RecolourItem => {
    const it = (v ?? {}) as Record<string, unknown>
    const c = (it.colour ?? {}) as Record<string, unknown>
    const rgb = Array.isArray(c.colour) && c.colour.length === 3 && c.colour.every((x) => typeof x === 'number' && Number.isFinite(x)) ? (c.colour.map((x) => Math.min(1, Math.max(0, x as number))) as Rgb) : RECOLOUR_STARTS[i % RECOLOUR_STARTS.length]
    const sources = ['manual', 'light', 'shadow', 'accent', 'vivid']
    return {
      id: typeof it.id === 'string' && it.id ? it.id.slice(0, 60) : `recolour-${i + 1}`,
      enabled: it.enabled !== false,
      source: typeof it.source === 'string' && it.source ? it.source : null,
      mode: it.mode === 'hue' || it.mode === 'asShot' ? it.mode : 'colour',
      colour: {
        source: sources.includes(c.source as string) ? (c.source as ColourChoice['source']) : 'manual',
        colour: rgb,
        ...(typeof c.saturation === 'number' && Number.isFinite(c.saturation) ? { saturation: num(c.saturation, 1, 0, 1.5) } : {}),
      },
      strength: num(it.strength, 1, 0, 1),
      ...(it.keep === true ? { keep: true } : {}),
      // Missing (a part from before these): even colour, its own light, as it was then.
      brightness: num(it.brightness, 0, 0, 1),
      highlights: num(it.highlights, 0, 0, 1),
      variation: num(it.variation, 0, 0, 1),
    }
  })
  return { enabled: r.enabled === true, items }
}

/** Kaleidoscope's settings, each kept within what its controls reach. */
export function parseSurface(value: unknown): SurfaceParams {
  const s = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_SURFACE
  const kind = SURFACE_KINDS.some((k) => k.id === s.kind) ? (s.kind as SurfaceKind) : d.kind
  return {
    enabled: s.enabled === true,
    kind,
    amount: num(s.amount, d.amount, 0, 1),
    scale: num(s.scale, d.scale, 0.25, 4),
    relief: num(s.relief, d.relief, 0, 1),
    light: num(s.light, d.light, 0, 360),
    turn: num(s.turn, d.turn, -180, 180),
    colour: num(s.colour, d.colour, 0, 1),
    seed: Math.round(num(s.seed, d.seed, 0, 99999)),
    ...(typeof s.image === 'string' && s.image ? { image: s.image } : {}),
    ...(typeof s.imageName === 'string' && s.imageName ? { imageName: s.imageName.slice(0, 120) } : {}),
  }
}

export function parseKaleido(value: unknown): KaleidoParams {
  const k = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_KALEIDO
  const c = (k.centre ?? null) as Record<string, unknown> | null
  return {
    enabled: k.enabled === true,
    centre: c && typeof c.x === 'number' && typeof c.y === 'number' ? { x: num(c.x, 0.5, -1, 2), y: num(c.y, 0.5, -1, 2) } : null,
    copies: Math.round(num(k.copies, d.copies, KALEIDO_COPIES.min, KALEIDO_COPIES.max)),
    mirror: k.mirror !== false,
    angle: num(k.angle, d.angle, -180, 180),
    source: typeof k.source === 'string' && k.source ? k.source : null,
    rings: Math.round(num(k.rings, d.rings, KALEIDO_RINGS.min, KALEIDO_RINGS.max)),
    ringSize: num(k.ringSize, d.ringSize, 0.2, 0.95),
    twist: num(k.twist, d.twist, -180, 180),
  }
}

/**
 * Lighting's lights, or for an edit from before Lighting, the leaks that
 * were lights: even shapes (no breakup) and mask lights move across, as
 * bright as they were, and leave the leaks to the leaks.
 */
function parseLighting(fx: EffectParams, raw: Record<string, unknown>, modules: Record<string, unknown>): EffectParams {
  const point = (p: unknown) => {
    const q = (p ?? {}) as Record<string, unknown>
    return { x: num(q.x, 0.5, -1, 2), y: num(q.y, 0.5, -1, 2) }
  }
  if (raw.lighting && typeof raw.lighting === 'object') {
    const l = raw.lighting as Record<string, unknown>
    const d = DEFAULT_LIGHT
    const lights = (Array.isArray(l.lights) ? l.lights : []).slice(0, MAX_LIGHTS).flatMap((v: unknown, i: number) => {
      const s = (v ?? {}) as Record<string, unknown>
      const outline = (Array.isArray(s.outline) ? s.outline : []).slice(0, 200).map(point)
      const mask = typeof s.mask === 'string' && s.mask ? s.mask : undefined
      if (outline.length < 3 && !mask) return []
      return [
        {
          id: typeof s.id === 'string' && s.id ? s.id : `light-${i + 1}`,
          name: typeof s.name === 'string' && s.name ? s.name.slice(0, 60) : `Light ${i + 1}`,
          outline,
          rounded: s.rounded !== false,
          colour: parseColour(s.colour, d.colour),
          strength: num(s.strength, d.strength, 0, 3),
          edge: num(s.edge, d.edge, 0, 0.3),
          falloff: num(s.falloff, d.falloff, 0, 1),
          angle: num(s.angle, d.angle, -360, 360),
          mode: s.mode === 'tint' ? ('tint' as const) : ('add' as const),
          ...(s.enabled === false ? { enabled: false } : {}),
          ...(mask ? { mask } : {}),
          ...(mask && typeof s.glow === 'number' && s.glow > 0 ? { glow: Math.min(0.5, Math.max(0.002, s.glow)) } : {}),
          ...(mask && typeof s.soft === 'number' && s.soft > 0 ? { soft: Math.min(0.3, s.soft) } : {}),
          ...(typeof s.holdMask === 'string' && s.holdMask ? { holdMask: s.holdMask } : {}),
          ...(s.holdInside === true ? { holdInside: true } : {}),
          ...(s.behindStreaks === true ? { behindStreaks: true } : {}),
        },
      ]
    })
    return { ...fx, lighting: { enabled: l.enabled === true, lights } }
  }
  // From before Lighting: the leaks that were lights.
  const leaks = fx.leaks
  const isLight = (s: LeakSpot) => s.kind === 'light' && (!!s.mask || (!!s.outline && s.outline.length >= 3 && s.texture === 0))
  const moved = leaks.spots.filter(isLight).slice(0, MAX_LIGHTS)
  if (!moved.length) return fx
  const on = modules.leaks !== false && leaks.amount > 0
  return {
    ...fx,
    leaks: { ...leaks, spots: leaks.spots.filter((s) => !moved.includes(s)) },
    lighting: {
      enabled: on,
      lights: moved.map((s, i) => ({
        id: `light-${i + 1}`,
        name: `Light ${i + 1}`,
        outline: s.outline ?? [],
        rounded: s.rounded ?? !s.polygon,
        colour: s.colour ?? leaks.colour,
        strength: Math.min(3, s.strength * leaks.amount),
        edge: s.edge ?? 0.03,
        falloff: s.falloff ?? 0,
        angle: s.angle,
        mode: 'add' as const,
        ...(s.mask ? { mask: s.mask } : {}),
      })),
    },
  }
}

/** How many copies a saved Repeat had (copySpan), before its ranges are read. */
function layoutSpan(r: Record<string, unknown>): number {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.abs(Math.round(v)) : 0)
  if (r.layout === 'path') return Math.max(1, n(r.count) || DEFAULT_REPEAT.count)
  if (r.layout === 'placed') return Math.max(1, Array.isArray(r.placed) ? r.placed.length : 1)
  return Math.max(1, n(r.across), n(r.up))
}

/**
 * Size, turn and opacity, first copy to last. Saved before they were ranges,
 * as a step from each copy to the next: the first copy one step on, the last
 * as many steps as there were copies.
 */
function repeatRanges(r: Record<string, unknown>, span: number): Pick<RepeatParams, 'size' | 'turn' | 'opacity'> {
  const pair = (v: unknown, def: [number, number], lo: number, hi: number): [number, number] =>
    Array.isArray(v) && v.length === 2 ? [num(v[0], def[0], lo, hi), num(v[1], def[1], lo, hi)] : def
  if (Array.isArray(r.size) || Array.isArray(r.turn) || Array.isArray(r.opacity) || (r.scaleStep === undefined && r.turnStep === undefined && r.fadeStep === undefined))
    return {
      // (What a Repeat saved without them had: the copies as the piece is, not today's defaults.)
      size: pair(r.size, [1, 1], 0.05, 3),
      turn: pair(r.turn, [0, 0], -1440, 1440),
      opacity: pair(r.opacity, [1, 1], 0, 1),
    }
  const s = num(r.scaleStep, 1, 0.3, 2)
  const t = num(r.turnStep, 0, -180, 180)
  const f = num(r.fadeStep, 1, 0, 1)
  const round = (v: number) => Math.round(v * 1000) / 1000
  return {
    size: [round(s), round(Math.min(3, Math.max(0.05, Math.pow(s, span))))],
    turn: [round(t), round(Math.max(-360, Math.min(360, t * span)))],
    opacity: [round(f), round(Math.pow(f, span))],
  }
}

/**
 * Repeat: its switch and its repeats. Saved before there could be more than
 * one, it was a single repeat whose switch was the module's: that becomes
 * the list's one repeat, if it copied anything.
 */
function parseRepeatModule(value: unknown): RepeatModule {
  const r = (value ?? {}) as Record<string, unknown>
  if (Array.isArray(r.items)) {
    const items = r.items.slice(0, MAX_REPEATS).map((v, i) => parseRepeat(v, i))
    // Two with one id (copied by hand): the later one gets its own.
    const seen = new Set<string>()
    return { enabled: r.enabled === true, items: items.map((it, i) => (seen.has(it.id!) ? { ...it, id: `repeat-${i + 1}-${seen.size}` } : (seen.add(it.id!), it))) }
  }
  if (typeof r.source === 'string' && r.source) return { enabled: r.enabled === true, items: [{ ...parseRepeat(r, 0), enabled: true }] }
  return { enabled: r.enabled === true, items: [] }
}

function parseRepeat(value: unknown, at: number): RepeatParams {
  const r = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_REPEAT
  const points = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : []).slice(0, max).flatMap((p) => {
      const q = (p ?? {}) as Record<string, unknown>
      return typeof q.x === 'number' && typeof q.y === 'number' && Number.isFinite(q.x) && Number.isFinite(q.y)
        ? [{ x: num(q.x, 0.5, -2, 3), y: num(q.y, 0.5, -2, 3) }]
        : []
    })
  return {
    id: typeof r.id === 'string' && r.id ? r.id.slice(0, 60) : `repeat-${at + 1}`,
    enabled: r.enabled !== false,
    source: typeof r.source === 'string' ? r.source : null,
    layout: r.layout === 'path' || r.layout === 'placed' ? r.layout : 'grid',
    across: Math.round(num(r.across, d.across, -20, 20)),
    up: Math.round(num(r.up, d.up, -20, 20)),
    gapX: num(r.gapX, d.gapX, -0.9, 3),
    gapY: num(r.gapY, d.gapY, -0.9, 3),
    // Unset in an edit made before Spacing: it keeps its old gaps (see RepeatParams.spacing).
    ...(Array.isArray(r.spacing) && r.spacing.length === 2 ? { spacing: [num(r.spacing[0], 1, 0.02, 4), num(r.spacing[1], 1, 0.02, 4)] as [number, number] } : {}),
    ...(r.fitPending === 'reach' || r.fitPending === 'within' || r.fitPending === 'any' ? { fitPending: r.fitPending } : {}),
    stagger: num(r.stagger, d.stagger, -1, 1),
    ...(r.both === true ? { both: true } : {}),
    ...(r.mirror === true ? { mirror: true } : {}),
    ...(typeof r.angle === 'number' && Number.isFinite(r.angle) && r.angle !== 0 ? { angle: num(r.angle, 0, -180, 180) } : {}),
    ...(r.vanish && typeof (r.vanish as { x?: unknown }).x === 'number' && typeof (r.vanish as { y?: unknown }).y === 'number'
      ? { vanish: { x: num((r.vanish as { x: number }).x, 0.5, -50, 50), y: num((r.vanish as { y: number }).y, 0.5, -50, 50) } }
      : {}),
    path: points(r.path, 64),
    count: Math.round(num(r.count, d.count, 1, 60)),
    followPath: r.followPath === true,
    ...(r.straight === true ? { straight: true } : {}),
    ...(typeof r.turnEase === 'number' && Number.isFinite(r.turnEase) && r.turnEase !== 0 ? { turnEase: num(r.turnEase, 0, -1, 1) } : {}),
    // Before it could be in the middle, a path either started at the piece or not (fromPiece).
    pieceOnPath: (['start', 'middle', 'off'] as const).includes(r.pieceOnPath as never) ? (r.pieceOnPath as RepeatParams['pieceOnPath']) : (r as { fromPiece?: unknown }).fromPiece === false ? 'off' : 'start',
    ...((['out', 'along', 'back'] as const).includes(r.firstToLast as never) ? { firstToLast: r.firstToLast as RepeatParams['firstToLast'] } : {}),
    placed: points(r.placed, 60),
    ...repeatRanges(r, layoutSpan(r)),
    behind: r.behind !== false,
    blend: (['normal', 'lighten', 'darken', 'screen', 'multiply'] as const).includes(r.blend as never) ? (r.blend as RepeatParams['blend']) : 'normal',
  }
}

function parseBorder(value: unknown): BorderParams {
  const b = (value ?? {}) as Record<string, unknown>
  const colour = Array.isArray(b.colour) ? b.colour : DEFAULT_BORDER.colour
  return {
    width: num(b.width, DEFAULT_BORDER.width, 0, 0.3),
    bottomExtra: num(b.bottomExtra, DEFAULT_BORDER.bottomExtra, 0, 0.5),
    colour: [
      num(colour[0], DEFAULT_BORDER.colour[0], 0, 1),
      num(colour[1], DEFAULT_BORDER.colour[1], 0, 1),
      num(colour[2], DEFAULT_BORDER.colour[2], 0, 1),
    ],
    texture: num(b.texture, DEFAULT_BORDER.texture, 0, 1),
    irregularity: num(b.irregularity, DEFAULT_BORDER.irregularity, 0, 1),
    grain: num(b.grain, DEFAULT_BORDER.grain, 0, 2),
    seed: Math.round(num(b.seed, DEFAULT_BORDER.seed, 0, 2 ** 31)),
    ...(b.fill === 'linear' || b.fill === 'radial' ? { fill: b.fill } : {}),
    ...(Array.isArray(b.colour2) ? { colour2: rgbOf(b.colour2) } : {}),
    ...optNum(b, 'fillAngle', 0, 360),
    ...optNum(b, 'corner', 0, 0.25),
    ...optNum(b, 'shadow', 0, 1),
    ...optNum(b, 'shadowSize', 0, 0.2),
    ...optNum(b, 'shadowDistance', 0, 0.1),
    ...optNum(b, 'shadowAngle', 0, 360),
    ...optNum(b, 'bevel', 0, 0.05),
    ...optNum(b, 'bevelLight', 0, 1),
    ...optNum(b, 'line', 0, 0.05),
    ...optNum(b, 'lineGap', 0, 0.2),
    ...(Array.isArray(b.lineColour) ? { lineColour: rgbOf(b.lineColour) } : {}),
    ...optNum(b, 'inset', 0, 1),
    ...(typeof b.paper === 'string' && (PAPER_KINDS as string[]).includes(b.paper) ? { paper: b.paper as PaperKind } : {}),
    ...(typeof b.edge === 'string' && (EDGE_KINDS as string[]).includes(b.edge) ? { edge: b.edge as EdgeKind } : {}),
  }
}

/** A colour read back: three components 0..1. */
function rgbOf(c: unknown[]): [number, number, number] {
  return [num(c[0], 0, 0, 1), num(c[1], 0, 0, 1), num(c[2], 0, 0, 1)]
}

/** An optional number, kept only if it is one, within its range. */
function optNum(b: Record<string, unknown>, key: string, min: number, max: number): Record<string, number> {
  return typeof b[key] === 'number' && Number.isFinite(b[key]) ? { [key]: num(b[key], min, min, max) } : {}
}

function parseResponse(value: unknown): GrainCurve {
  if (Array.isArray(value)) {
    const points = value
      .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
      .map((p) => ({ x: num(p.x, 0, 0, 1), y: num(p.y, 1, 0, MAX_STRENGTH) }))
    return points.length ? normaliseCurve(points) : [...FLAT_CURVE]
  }
  if (value && typeof value === 'object') return bandsToCurve(value as Record<string, unknown>)
  return [...FLAT_CURVE]
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback
}

/**
 * Parse an untrusted preset document (from a .json file or storage), brought
 * up to this build's settings.
 *
 * Before version 6 Vibrance, Warmth and Tint worked on the photo before the
 * palette recoloured it, so with a palette on they did little (by the
 * palette's strength), and the palette had a Saturation of its own. Now they
 * work on what the palette made, and Vibrance is the one saturation: an old
 * edit's are scaled to what they did, and its palette Saturation folded in.
 */
export function parsePreset(input: unknown): PresetDoc {
  const doc = parsePresetAsIs(input)
  const version = (input as Record<string, unknown>).schemaVersion as number
  if (version < 7) {
    // Before 7, Streaks and Collage were on by default and counted as in use
    // only once something was placed; now their switch is what says so, as
    // every module's does. With nothing placed they come in off.
    const fx = doc.blend.effects
    if (!fx.streaks.shapes.length) fx.streaks = { ...fx.streaks, enabled: false }
    if (!fx.collage.pieces.length) fx.collage = { ...fx.collage, enabled: false }
  }
  if (version >= 6) return doc
  const raw = (((input as Record<string, unknown>).blend as Record<string, unknown> | undefined)?.effects as Record<string, unknown> | undefined)?.grade as Record<string, unknown> | undefined
  const g = doc.blend.effects.grade
  const m = g.mapAmount
  const s = typeof raw?.mapSaturation === 'number' && Number.isFinite(raw.mapSaturation) ? Math.max(-1, Math.min(1, raw.mapSaturation)) : 0
  if (m <= 0) return doc
  const round = (v: number) => Math.round(Math.max(-1, Math.min(1, v)) * 1000) / 1000
  doc.blend.effects.grade = { ...g, vibrance: round(g.vibrance * (1 - m) + s * m), warmth: round(g.warmth * (1 - m)), tint: round(g.tint * (1 - m)) }
  return doc
}

function parsePresetAsIs(input: unknown): PresetDoc {
  if (!input || typeof input !== 'object') throw new Error('Preset is not a JSON object.')
  const doc = input as Record<string, unknown>
  const version = doc.schemaVersion
  if (typeof version !== 'number' || !READABLE_SCHEMA_VERSIONS.includes(version)) {
    throw new Error(
      `Unsupported preset schemaVersion: ${String(version)} (this build reads ${READABLE_SCHEMA_VERSIONS.join(', ')}).`,
    )
  }
  const source = doc.grainSource as Record<string, unknown> | undefined
  if (!source || typeof source.kind !== 'string' || typeof source.id !== 'string') {
    throw new Error('Preset is missing a grainSource with kind and id.')
  }
  const blend = (doc.blend ?? {}) as Record<string, unknown>
  const output = (doc.output ?? {}) as Record<string, unknown>

  return {
    schemaVersion: PRESET_SCHEMA_VERSION,
    ...(doc.placed === true ? { placed: true } : {}),
    name: typeof doc.name === 'string' && doc.name.trim() ? doc.name.trim() : 'Untitled',
    ...(typeof doc.description === 'string' && doc.description.trim() ? { description: doc.description.trim().slice(0, 400) } : {}),
    grainSource: {
      // Keep fields this build doesn't know about: a procedural source carries
      // its whole definition here, and future kinds will carry theirs.
      ...source,
      kind: source.kind,
      id: source.id,
      name: typeof source.name === 'string' ? source.name : source.id,
    },
    blend: {
      blendMode: isBlendMode(blend.blendMode) ? blend.blendMode : DEFAULT_BLEND_PARAMS.blendMode,
      amount: num(blend.amount, DEFAULT_BLEND_PARAMS.amount, 0, 1),
      colorSpace: blend.colorSpace === 'srgb' ? 'srgb' : 'linear',
      tiling: TILINGS.includes(blend.tiling as TilingMode) ? (blend.tiling as TilingMode) : DEFAULT_BLEND_PARAMS.tiling,
      grainScale: num(blend.grainScale, DEFAULT_BLEND_PARAMS.grainScale, 0.05, 20),
      // Fields added after v1. A v1 preset gets neutral defaults, which
      // reproduce exactly how it rendered when it was saved.
      grainRotation: num(blend.grainRotation, DEFAULT_BLEND_PARAMS.grainRotation, -180, 180),
      chroma: num(blend.chroma, DEFAULT_BLEND_PARAMS.chroma, 0, 1),
      softness: num(blend.softness, DEFAULT_BLEND_PARAMS.softness, 0, 1),
      // Deliberately defaulted to 'centre' for presets that predate the field
      // rather than to the old behaviour. Applying an uncentred plate did not
      // render a look worth preserving: it darkened the picture by up to 38
      // code values, which is a bug, not a choice anyone made.
      plateNormalise: PLATE_NORMALISE.includes(blend.plateNormalise as PlateNormalise)
        ? (blend.plateNormalise as PlateNormalise)
        : DEFAULT_BLEND_PARAMS.plateNormalise,
      plateFlatten: num(blend.plateFlatten, DEFAULT_BLEND_PARAMS.plateFlatten, 0, 1),
      plateSampling:
        blend.plateSampling === 'smooth' ? 'smooth' : (DEFAULT_BLEND_PARAMS.plateSampling as PlateSampling),
      // v1 has no response at all, v2 has three bands, v3 has a curve.
      response: parseResponse(blend.response),
      responseMode: (blend.responseMode === 'channel' ? 'channel' : 'luminance') as ResponseMode,
      layerSpread: num(blend.layerSpread, DEFAULT_BLEND_PARAMS.layerSpread, 0, 1),
      // Absent in presets that predate the effect stages, and zero by default,
      // so those presets render exactly as they did.
      effects: parseLighting(parseEffects(blend.effects), (blend.effects ?? {}) as Record<string, unknown>, (blend.modules ?? {}) as Record<string, unknown>),
      border: parseBorder(blend.border),
      keys: parseKeys(blend.keys),
      modules: parseModules(blend.modules),
      grainFollowsColour: num(blend.grainFollowsColour, 0, 0, 1),
      varyPerPhoto: typeof blend.varyPerPhoto === 'boolean' ? blend.varyPerPhoto : true,
    },
    output: parseOutput(output),
  }
}

/** Export settings, from any version: the old two sizes become the matching shapes. */
export function parseOutput(output: Record<string, unknown>): OutputSettings {
  // Exports no longer crop: a fixed aspect from before reads as the photo's own.
  const shape = output.shape === 'instagram' || output.size === 'instagram' ? 'instagram' : 'original'
  const longEdge = typeof output.longEdge === 'number' && output.longEdge >= 64 ? Math.min(20000, Math.round(output.longEdge)) : null
  const format = output.format === 'jpeg' || output.format === 'png' || output.format === 'tiff' || output.format === 'webp' ? output.format : 'match'
  return {
    jpegQuality: num(output.jpegQuality, DEFAULT_OUTPUT.jpegQuality, 0.1, 1),
    // '_grain' was the default once, never a choice: read as none.
    suffix: typeof output.suffix === 'string' && output.suffix !== '_grain' ? output.suffix : DEFAULT_OUTPUT.suffix,
    shape,
    longEdge,
    format,
  }
}

export function presetToJson(doc: PresetDoc): string {
  return `${JSON.stringify(doc, null, 2)}\n`
}

export interface StoredPreset extends PresetRecord {
  data: PresetDoc
}

export async function listPresets(): Promise<StoredPreset[]> {
  const records = await getAll<PresetRecord>(PRESET_STORE)
  return records
    .map((r) => {
      try {
        return { ...r, data: parsePreset(r.data) }
      } catch {
        return null
      }
    })
    .filter((r): r is StoredPreset => r !== null)
    .sort((a, b) => a.data.name.localeCompare(b.data.name))
}

export async function savePreset(doc: PresetDoc, existingId?: string): Promise<StoredPreset> {
  const record: StoredPreset = {
    id: existingId ?? newId('preset'),
    name: doc.name,
    data: doc,
    updatedAt: Date.now(),
  }
  await put(PRESET_STORE, record)
  return record
}

export async function deletePreset(id: string): Promise<void> {
  await remove(PRESET_STORE, id)
}
