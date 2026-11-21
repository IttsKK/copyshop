import stipple from '../../presets/vibe-stipple.json'
import stippleDusk from '../../presets/vibe-stipple-dusk.json'
import stippleSilver from '../../presets/vibe-stipple-silver.json'
import stippleTide from '../../presets/vibe-stipple-tide.json'
import { DEFAULT_BLEND_PARAMS, type BlendParams, type EffectParams } from '../engine/types'
import { DEFAULT_PROCEDURAL_PARAMS, type ProceduralGrainParams } from '../sources/generateGrain'
import { rgbToHsv } from '../engine/harmony'
import type { Palette } from '../engine/palette'
import type { Rgb } from '../engine/types'
import { BUILT_IN_RECIPES } from '../storage/recipes'
import { DEFAULT_OUTPUT, PRESET_SCHEMA_VERSION, parsePreset, type PresetDoc } from '../storage/presets'

export interface Look {
  id: string
  label: string
  hint: string
  doc: PresetDoc
  /** No longer listed (too like another): kept so edits and timelapses made with it still find it. */
  retired?: boolean
}

/** A preset file as a built-in recipe, named as the app lists it. */
function named(id: string, label: string, hint: string, file: unknown): Look {
  const doc = parsePreset(file)
  return { id, label, hint, doc: { ...doc, name: label, description: hint } }
}

/**
 * Looks that ship with the app. They are the same preset JSON as the files in
 * presets/, parsed through the same validator, so a built-in look and an
 * imported one cannot drift apart. Being bundled means they are there on a
 * fresh browser with nothing in IndexedDB.
 *
 * The stippled ones: a fine stipple dither, glow and fade with a strong
 * gradient map, each in its own colours. Named for the colours (their ids
 * keep the old Stipple names, which saved edits refer to). The rest of the
 * looks that used to ship are kept, unused, in presets/retired/.
 */
export const STIPPLE_LOOKS: Look[] = [
  named('stipple-tide', 'Tide', 'Navy, teal and orange · stipple', stippleTide),
  named('stipple', 'Ember', 'Mono, warm highlights · stipple', stipple),
  named('stipple-silver', 'Silver', 'Silver-blue mono · stipple', stippleSilver),
  named('stipple-dusk', 'Dusk', 'Own colours, deepened · stipple', stippleDusk),
]

/** Every module switched on but doing nothing: a recipe sets only what it uses. */
const BLANK: BlendParams = { ...DEFAULT_BLEND_PARAMS, amount: 0 }

/**
 * A recipe written as the settings it changes from blank, run through the
 * same validator as a file, so it can't hold anything a file couldn't.
 */
function built(
  id: string,
  label: string,
  hint: string,
  grain: Partial<ProceduralGrainParams>,
  blend: Partial<Omit<BlendParams, 'effects'>>,
  effects: (e: EffectParams) => Partial<EffectParams>,
): Look {
  const doc: PresetDoc = {
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: label,
    description: hint,
    grainSource: { kind: 'procedural', id: 'procedural', name: 'Generated grain', params: { ...DEFAULT_PROCEDURAL_PARAMS, ...grain } },
    blend: { ...BLANK, ...blend, effects: { ...BLANK.effects, ...effects(BLANK.effects) } },
    output: DEFAULT_OUTPUT,
  }
  return { id, label, hint, doc: parsePreset(JSON.parse(JSON.stringify(doc))) }
}

const palette = (name: string) => {
  const r = BUILT_IN_RECIPES.find((x) => x.name === name)!
  return { ...r.look, recipe: r.rule, mapHarmony: r.rule.harmony }
}

/**
 * Starting points across the modules, each a different idea of a photo
 * rather than one look at several strengths. Every one is plain modules at
 * plain settings: open "What's in it" to see them.
 */
export const MORE_LOOKS: Look[] = [
  built(
    'disposable',
    'Disposable',
    'Soft lens, fringing, bloom',
    { grainSize: 0.42, contrast: 0.45, chroma: 0.35, seed: 11 },
    { amount: 0.32 },
    (e) => ({
      lens: { ...e.lens, enabled: true, distortion: 0.12, fringe: 0.35, softEdges: 0.45, diffusion: 0.12 },
      exposure: 0.15,
      fade: 0.05,
      shoulder: 0.45,
      vignette: 0.35,
      stock: { ...e.stock, id: 'sunburn', strength: 0.7 },
      halation: 0.3,
      bloom: 0.05,
    }),
  ),
  built(
    'pushed',
    'Pushed',
    'Pushed film, big grain, glow',
    { grainSize: 0.3, contrast: 0.75, roughness: 0.45, clumps: 0.4, unevenness: 0.3, chroma: 0.15, seed: 17 },
    { amount: 0.5, grainScale: 1.75, plateSampling: 'smooth' },
    (e) => ({
      exposure: 0.12,
      shoulder: 0.2,
      vignette: 0.35,
      halation: 0.45,
      bloom: 0.06,
      crunch: 0.12,
      stock: { ...e.stock, id: 'sunburn', strength: 0.55 },
      grade: { ...e.grade, vibrance: 0.05 },
    }),
  ),
  built(
    'tri-x',
    'Press black & white',
    'Mono, coarse grain, dust',
    { grainSize: 0.3, contrast: 0.5, roughness: 0.25, clumps: 0.15, chroma: 0, seed: 23 },
    { amount: 0.5, grainScale: 2, plateSampling: 'smooth' },
    (e) => ({
      mono: { ...e.mono, enabled: true, amount: 1, filter: 'yellow', contrast: 0.3 },
      shoulder: 0.3,
      vignette: 0.25,
      structure: 0.2,
      defects: { ...e.defects, strength: 0.35 },
    }),
  ),
  built(
    'riso',
    'Riso zine',
    'Two-colour riso, pink and teal',
    { grainSize: 0.3, chroma: 0, seed: 31 },
    { amount: 0.15 },
    (e) => ({
      halftone: { ...e.halftone, enabled: true, style: 'riso', amount: 1, cell: 0.007, inkA: [0.0, 0.47, 0.58], inkB: [1, 0.36, 0.55], slip: 0.004 },
      fade: 0.04,
    }),
  ),
  built(
    'cinema',
    'Night cinema',
    'Red halation, soft highlights',
    { grainSize: 0.32, contrast: 0.35, chroma: 0.25, seed: 41 },
    { amount: 0.24 },
    (e) => ({
      halation: 0.85,
      bloom: 0.2,
      glowColour: { source: 'manual', colour: [1, 0.32, 0.18] },
      shoulder: 0.55,
      vignette: 0.2,
      grade: { ...e.grade, ...palette('Highlight and opposite'), mapAmount: 0.45 },
    }),
  ),
  built(
    'expired',
    'Expired roll',
    'Magenta fade, light leaks',
    { grainSize: 0.5, contrast: 0.5, unevenness: 0.35, chroma: 0.45, seed: 53 },
    { amount: 0.45 },
    (e) => ({
      stock: { ...e.stock, id: 'expired', strength: 1 },
      fade: 0.12,
      shoulder: 0.3,
      leaks: { ...e.leaks, amount: 0.55 },
      surge: { ...e.surge, strength: 0.45 },
      defects: { ...e.defects, strength: 0.3 },
    }),
  ),
]

/** Tide's recipe, changed: a copy of it, its name and line, and `edit` on its settings. */
function fromTide(id: string, label: string, hint: string, edit: (doc: PresetDoc) => void): Look {
  const doc: PresetDoc = JSON.parse(JSON.stringify(parsePreset(stippleTide)))
  doc.name = label
  doc.description = hint
  edit(doc)
  return { id, label, hint, doc: parsePreset(JSON.parse(JSON.stringify(doc))) }
}
const manual = (colour: Rgb) => ({ source: 'manual' as const, colour })

const TIDE_COLOURS: Look[] = [
  { ...fromTide('stipple-gold', 'Gold', 'Slate and gold · stipple', (d) => {
    d.blend.effects.grade = { ...d.blend.effects.grade, mapShadow: manual([0.094, 0.131, 0.206]), mapMid: manual([0.248, 0.329, 0.492]), mapHigh: manual([1, 0.74, 0.18]), mapHarmony: 'free', mapAmount: 0.9 }
  }), retired: true },
  fromTide('stipple-violet', 'Violet', 'Blue, violet and amber · stipple', (d) => {
    d.blend.effects.grade = { ...d.blend.effects.grade, mapShadow: manual([0.035, 0.161, 0.245]), mapMid: manual([0.238, 0.136, 0.544]), mapHigh: manual([1, 0.8, 0.2]), mapHarmony: 'free', mapAmount: 0.9 }
  }),
  // A finished photo's look: Tide's navy and teal under the photo's own main
  // colour, in five coarse steps of dither with rough grain.
  fromTide('grit', 'Grit', 'Coarse dither, rough grain', (d) => {
    d.blend.effects.grade = { ...d.blend.effects.grade, mapHigh: { source: 'accent', colour: [1, 0.55, 0.2] }, mapHarmony: 'free', mapAmount: 0.9 }
    d.blend.effects.dither = { ...d.blend.effects.dither, amount: 0.85, steps: 5, spread: 0.55 }
    d.blend.amount = 0.14
    // Its own grain at Scale 1, crisp: varied, rough specks are its look (not Tide's 1.5).
    d.blend.grainScale = 1
    if (d.grainSource.kind === 'procedural') d.grainSource.params = { ...(d.grainSource.params as ProceduralGrainParams), grainSize: 0.42, contrast: 0.55, roughness: 0.35, clumps: 0.2 }
  }),
  // Square ordered dither in big pixels, in a dusk palette of navy, rose and peach.
  fromTide('pixel', 'Pixel', 'Square pixel dither, five steps', (d) => {
    d.blend.effects.grade = { ...d.blend.effects.grade, mapShadow: manual([0.08, 0.1, 0.32]), mapMid: manual([0.78, 0.3, 0.45]), mapHigh: manual([1, 0.78, 0.45]), mapHarmony: 'free', mapAmount: 0.9 }
    d.blend.effects.dither = { ...d.blend.effects.dither, pattern: 'ordered', pixel: 5, blocks: true, keepLines: 0.6, amount: 0.85, steps: 5, spread: 0.55 }
    d.blend.amount = 0.03
    d.blend.effects.halation = 0.3
  }),
]

/**
 * The recipes with a strong gradient map that suit this photo best, first
 * the closest: the map's light colour nearest the photo's own light colour
 * (or its most vivid one, when the light is nearly grey), so the photo keeps
 * the feel of its light while its colours change.
 */
export function suggestedLooks(looks: Look[], palette: Palette, count = 3): Look[] {
  const turn = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b))
  const [lh, ls] = rgbToHsv(palette.light)
  const target = ls >= 0.12 ? lh : rgbToHsv(palette.vivid)[0]
  return looks
    .filter((l) => l.doc.blend.effects.grade.mapAmount >= 0.6)
    .map((l) => ({ l, d: turn(rgbToHsv(l.doc.blend.effects.grade.mapHigh.colour)[0], target) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, count)
    .map((x) => x.l)
}

/** No recipe: the photo as it is. What you place on it (crop, masks) stays, as with any recipe. */
export const NONE_LOOK: Look = built('none', 'None', 'No look. Streaks, masks and collage stay', {}, { amount: 0 }, () => ({}))

/** Every built-in recipe, in the order the Recipes page lists them. */
export const LOOKS: Look[] = (() => {
  const all = [...STIPPLE_LOOKS, ...TIDE_COLOURS, ...MORE_LOOKS]
  // The stippled colours together, then the coarser dithers, then film and print.
  const order = ['stipple-tide', 'stipple-violet', 'stipple-silver', 'stipple', 'grit', 'pixel', 'pushed']
  // Dusk was too like Silver and Ember on most photos: kept, not listed.
  const retired = new Set(['stipple-dusk'])
  const listed = [...order.map((id) => all.find((l) => l.id === id)!), ...all.filter((l) => !order.includes(l.id) && !retired.has(l.id))]
  return [...listed, ...all.filter((l) => retired.has(l.id) && !listed.includes(l)).map((l) => ({ ...l, retired: true }))]
})()

/** The built-in recipes the app lists (LOOKS also holds retired ones, for edits made with them). */
export const LISTED_LOOKS: Look[] = LOOKS.filter((l) => !l.retired)

/** What a newly opened photo starts with: nothing applied. */
export const STARTING_LOOK = NONE_LOOK
