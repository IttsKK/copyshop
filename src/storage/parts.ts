import { DEFAULT_BLEND_PARAMS, type BlendParams } from '../engine/types'
import type { SerializedGrainSource } from '../sources/GrainSource'
import { PART_STORE, getAll, newId, put, remove } from './db'
import { PRESET_SCHEMA_VERSION, parsePreset } from './presets'
import { BUILT_IN_PARTS } from './partBuiltins'

/**
 * Section presets: a saved Grain, Colour, Tone, Light, Leaks or Border on its
 * own. Each kind owns a fixed set of settings, so saving one needs no choices
 * and applying one changes that section only — a border preset cannot alter
 * the grain, and a look preset no longer touches the border.
 *
 * Applied by merging into the current settings and passing the result through
 * parsePreset, so a part saved by an older build is validated and migrated the
 * same way a whole preset is.
 */
export type PartKind =
  | 'grain'
  | 'colour'
  | 'tone'
  | 'light'
  | 'edges'
  | 'solarize'
  | 'leaks'
  | 'border'
  | 'lens'
  | 'prism'
  | 'stamp'
  | 'mono'
  | 'dither'
  | 'pixel'
  | 'glass'
  | 'halftone'
  | 'dust'
  | 'surge'

export const PART_LABELS: Record<PartKind, string> = {
  grain: 'grain',
  colour: 'colour',
  tone: 'tone',
  light: 'glow',
  edges: 'edges',
  solarize: 'solarize',
  leaks: 'leaks',
  border: 'border',
  lens: 'lens',
  prism: 'prism',
  stamp: 'date stamp',
  mono: 'black & white',
  dither: 'dither',
  pixel: 'pixel art',
  glass: 'glass',
  halftone: 'halftone',
  dust: 'dust & scratches',
  surge: 'surge marks',
}

type Effects = BlendParams['effects']

/** Which settings each kind owns: top-level blend keys, effect keys, its module switch. */
export const OWNS: Record<PartKind, { blend: (keyof BlendParams)[]; effects: (keyof Effects)[]; module?: keyof BlendParams['modules']; source?: true }> = {
  grain: {
    source: true,
    blend: ['amount', 'blendMode', 'colorSpace', 'tiling', 'grainScale', 'grainRotation', 'chroma', 'softness', 'plateNormalise', 'plateFlatten', 'plateSampling', 'response', 'responseMode', 'layerSpread', 'grainFollowsColour'],
    effects: [],
    module: 'grain',
  },
  colour: { blend: [], effects: ['stock', 'grade'], module: 'colour' },
  tone: { blend: [], effects: ['exposure', 'fade', 'shoulder', 'vignette', 'structure', 'structureRadius'], module: 'tone' },
  // The glow's colour is set in Glow now; older colour presets that carry it still set it.
  light: { blend: [], effects: ['halation', 'bloom', 'glowThreshold', 'glowRadius', 'glowColour'], module: 'light' },
  edges: { blend: [], effects: ['rim', 'rimRadius', 'crunch'], module: 'edges' },
  solarize: { blend: [], effects: ['solarize', 'solarizeFrom', 'halo', 'haloRadius'], module: 'solarize' },
  leaks: { blend: [], effects: ['leaks'], module: 'leaks' },
  border: { blend: ['border'], effects: [], module: 'border' },
  lens: { blend: [], effects: ['lens'] },
  prism: { blend: [], effects: ['prism'] },
  stamp: { blend: [], effects: ['stamp'] },
  mono: { blend: [], effects: ['mono'] },
  dither: { blend: [], effects: ['dither'] },
  pixel: { blend: [], effects: ['pixelArt'] },
  glass: { blend: [], effects: ['glass'] },
  halftone: { blend: [], effects: ['halftone'] },
  dust: { blend: [], effects: ['defects'], module: 'defects' },
  surge: { blend: [], effects: ['surge'], module: 'surge' },
}

export interface PartData {
  /** The settings' version when saved (PRESET_SCHEMA_VERSION); missing: before 6. */
  schemaVersion?: number
  grainSource?: SerializedGrainSource
  blend: Partial<Omit<BlendParams, 'effects' | 'modules'>> & {
    effects?: Partial<Effects>
    modules?: Partial<BlendParams['modules']>
  }
}

export interface StoredPart {
  id: string
  kind: PartKind
  name: string
  data: PartData
  updatedAt: number
  /** Built-in parts ship with the app and cannot be deleted. */
  builtIn?: boolean
}

export function extractPart(kind: PartKind, blend: BlendParams, source: SerializedGrainSource | null): PartData {
  const own = OWNS[kind]
  const out: PartData = { schemaVersion: PRESET_SCHEMA_VERSION, blend: {} }
  for (const k of own.blend) (out.blend as Record<string, unknown>)[k] = structuredClone(blend[k])
  if (own.effects.length) {
    out.blend.effects = {}
    for (const k of own.effects) (out.blend.effects as unknown as Record<string, unknown>)[k] = structuredClone(blend.effects[k])
  }
  if (own.module) out.blend.modules = { [own.module]: blend.modules[own.module] }
  if (own.source && source) out.grainSource = structuredClone(source)
  return out
}

/** The current settings with this part's settings put in, validated. */
export function applyPart(
  part: PartData,
  blend: BlendParams,
  source: SerializedGrainSource,
): { blend: BlendParams; grainSource: SerializedGrainSource } {
  const effects = { ...blend.effects, ...(part.blend.effects ?? {}) }
  // The date the stamp prints is the photo's, not the part's.
  if (part.blend.effects?.stamp) effects.stamp = { ...effects.stamp, date: blend.effects.stamp.date }
  const merged = {
    ...blend,
    ...part.blend,
    effects,
    modules: { ...blend.modules, ...(part.blend.modules ?? {}) },
  }
  const doc = parsePreset({
    // An old part brings old settings up to date (parsePreset); only one that
    // carries the colour has any to bring, and the rest of the edit is current.
    schemaVersion: part.schemaVersion ?? (part.blend.effects?.grade ? 5 : PRESET_SCHEMA_VERSION),
    name: 'part',
    grainSource: part.grainSource ?? source,
    blend: merged,
    output: {},
  })
  return { blend: doc.blend, grainSource: doc.grainSource }
}

/**
 * This kind's settings back to their defaults, everything else as it is —
 * a section's reset button. Its on/off switch stays as it was.
 */
export function resetPart(kind: PartKind, blend: BlendParams): BlendParams {
  const own = OWNS[kind]
  const out: BlendParams = { ...blend, effects: { ...blend.effects } }
  const d = DEFAULT_BLEND_PARAMS
  for (const k of own.blend) (out as unknown as Record<string, unknown>)[k] = d[k]
  for (const k of own.effects) {
    const was = blend.effects[k] as unknown
    const def = d.effects[k] as unknown
    // Settings kept with their own switch (enabled) keep it, as the rest do.
    const keepOn = def && typeof def === 'object' && was && typeof was === 'object' && 'enabled' in (was as object)
    ;(out.effects as unknown as Record<string, unknown>)[k] = keepOn ? { ...(def as object), enabled: (was as { enabled: boolean }).enabled } : def
  }
  return out
}

/** Only this kind's settings of `blend`, for keeping across a look change. */
export function keepPart(kind: PartKind, from: BlendParams, into: BlendParams): BlendParams {
  const own = OWNS[kind]
  const out: BlendParams = { ...into, effects: { ...into.effects }, modules: { ...into.modules } }
  for (const k of own.blend) (out as unknown as Record<string, unknown>)[k] = from[k]
  for (const k of own.effects) (out.effects as unknown as Record<string, unknown>)[k] = from.effects[k]
  if (own.module) out.modules[own.module] = from.modules[own.module]
  return out
}

export async function listParts(kind: PartKind): Promise<StoredPart[]> {
  const mine = (await getAll<StoredPart>(PART_STORE)).filter((p) => p.kind === kind)
  mine.sort((a, b) => a.name.localeCompare(b.name))
  return [...BUILT_IN_PARTS.filter((p) => p.kind === kind), ...mine]
}

/** Saved module presets changed (one saved, renamed or deleted): lists of them shown elsewhere read them again. */
export const PARTS_CHANGED = 'grain:parts-changed'
const partsChanged = () => typeof window !== 'undefined' && window.dispatchEvent(new Event(PARTS_CHANGED))

export async function savePart(kind: PartKind, name: string, data: PartData, id?: string): Promise<StoredPart> {
  const part: StoredPart = { id: id ?? newId('part'), kind, name, data, updatedAt: Date.now() }
  await put(PART_STORE, part)
  partsChanged()
  return part
}

export async function deletePart(id: string): Promise<void> {
  await remove(PART_STORE, id)
  partsChanged()
}

/**
 * What is placed on one photo rather than part of a look: streaks (their
 * shapes carry their style), masks and which sections use them, and the
 * collage. Drawn round things in one picture, they mean nothing on another,
 * so a look is saved without them unless asked, applying a look keeps the
 * photo's own, and snapshots can leave them as they are now.
 */
export function placedOf(b: BlendParams): Pick<BlendParams['effects'], 'streaks' | 'masks' | 'maskUse' | 'collage' | 'shapeSpace' | 'shapeUnits' | 'base' | 'double' | 'crop' | 'repeat' | 'kaleido' | 'lighting' | 'glass'> {
  const e = b.effects
  // The base photo's corrections, a second exposure, the crop, Repeat
  // (copies of a piece of this photo), the Kaleidoscope (its centre and part), the lighting placed round its streaks
  // and masks, and glass (usually drawn over part of it) are this photo's
  // too: a recipe never changes them.
  return { streaks: e.streaks, masks: e.masks, maskUse: e.maskUse, collage: e.collage, shapeSpace: e.shapeSpace, shapeUnits: e.shapeUnits, base: e.base, double: e.double, crop: e.crop, repeat: e.repeat, kaleido: e.kaleido, lighting: e.lighting, glass: e.glass }
}

/** `into` with `from`'s placed things. The date the stamp prints is the photo's, so it stays too. */
export function withPlaced(from: BlendParams, into: BlendParams): BlendParams {
  return { ...into, effects: { ...into.effects, ...placedOf(from), stamp: { ...into.effects.stamp, date: from.effects.stamp.date } } }
}

/**
 * What belongs to the photo rather than the look, kept when a look or preset
 * is applied: the border, and what is placed on the photo — streaks, masks,
 * the collage (see placedOf) — unless the look was saved with its own.
 */
export function keepOwn(from: BlendParams, into: BlendParams, lookHasPlaced = false): BlendParams {
  const out = keepPart('border', from, into)
  return lookHasPlaced ? out : withPlaced(from, out)
}

/** None placed: what a look is saved as unless asked to include them. */
export function withoutPlaced(b: BlendParams): BlendParams {
  return withPlaced(DEFAULT_BLEND_PARAMS, b)
}

/** Whether anything is placed on the photo. */
export function hasPlaced(b: BlendParams): boolean {
  const e = b.effects
  return e.streaks.shapes.length > 0 || e.masks.length > 0 || e.collage.pieces.length > 0
}
