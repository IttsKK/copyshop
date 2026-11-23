import { DEFAULT_LIGHTING } from '../engine/lighting'
import { DEFAULT_REPEAT, DEFAULT_REPEAT_MODULE } from '../engine/repeatParams'
import { DEFAULT_KALEIDO } from '../engine/kaleido'
import { baseActive } from '../engine/base'
import { doubleOn, lensOn, prismOn } from '../engine/extras'
import { DEFAULT_BLEND_PARAMS, DEFAULT_GLASS, glassOn, type BlendParams } from '../engine/types'
import { DEFAULT_HALFTONE } from '../engine/extras'
import { BUILT_IN_RECIPES } from '../storage/recipes'
import { resetPart, type PartKind } from '../storage/parts'
import { DEFAULT_BASE } from '../engine/base'
import { DEFAULT_CROP } from '../engine/crop'

/**
 * The modules, sorted into categories. The panel shows the modules a photo
 * uses (and any you added), grouped by category in the order the engine
 * applies them; a category tab shows everything in it, with the unused ones
 * one click from being added.
 *
 * Categories follow what an effect is to the picture, not how it is built:
 * colour & tone change the scene, light adds light, film & texture is the
 * emulsion, shapes are things placed on this photo, print is the paper.
 */
export type CategoryId = 'base' | 'camera' | 'colour' | 'light' | 'texture' | 'shapes' | 'print'

export interface Category {
  id: CategoryId
  label: string
  /** Its colour in the panel: glyphs, the tab, the card's edge. */
  tint: string
  hint: string
  /** A few words on where it sits in the pipeline, for the rail and the headers. */
  brief: string
  /** Its name under its icon on the rail. */
  short: string
}

export const CATEGORIES: Category[] = [
  // First in the stack, as it is applied first; last on the shelf, as most
  // photos arrive already edited and never need it.
  { id: 'base', label: 'Base photo', tint: '#9fb3c8', hint: "Corrections for a photo that hasn't been edited elsewhere, like a camera JPEG or RAW file", brief: "Exposure, white balance, curve", short: 'Base' },
  { id: 'camera', label: 'Camera', tint: '#a9c27a', hint: "Framing and lens effects, a second exposure, and a date stamp", brief: "Crop, lens, double exposure, date stamp", short: 'Camera' },
  { id: 'colour', label: 'Colour & tone', tint: '#e48aa6', hint: "Tone and colour grading", brief: "Tone, colour grading", short: 'Colour' },
  { id: 'light', label: 'Glow', tint: '#f2a65e', hint: "Glow, edge light, solarizing, lights placed on the photo, light leaks and burns", brief: "Glow, edges, solarize, lighting, leaks", short: 'Glow' },
  { id: 'texture', label: 'Film & texture', tint: '#d6c6a2', hint: "Black and white, grain, dither and pixel art", brief: "B&W, grain, dither, pixel art", short: 'Film' },
  { id: 'shapes', label: 'Effects', tint: '#7fcdc4', hint: "Effects made on the photo from your selections: streaks, glass, collage, repeat and kaleidoscope", brief: "Streaks, glass, collage, repeat, kaleidoscope", short: 'Effects' },
  { id: 'print', label: 'Print', tint: '#b9b2a6', hint: "Halftone, borders and print damage", brief: "Halftone, border, dust, surge", short: 'Print' },
]

export type StackModuleId =
  | 'exposure'
  | 'balance'
  | 'curve'
  | 'crop'
  | 'repeat'
  | 'kaleido'
  | 'lighting'
  | 'lens'
  | 'prism'
  | 'double'
  | 'stamp'
  | 'mono'
  | 'halftone'
  | 'tone'
  | 'colour'
  | 'light'
  | 'edges'
  | 'solarize'
  | 'leaks'
  | 'grain'
  | 'dither'
  | 'pixel'
  | 'streaks'
  | 'glass'
  | 'collage'
  | 'border'
  | 'dust'
  | 'surge'

export interface ModuleDef {
  id: StackModuleId
  title: string
  category: CategoryId
  /** One line for the Add menu: what it does to a photo, plainly. */
  blurb: string
  /** Words it is found by in the Add menu besides its title. */
  keywords: string
}

/** In the order the engine applies them, within and across categories. */
export const MODULES: ModuleDef[] = [
  { id: 'exposure', title: 'Exposure', category: 'base', blurb: 'Exposure, contrast, highlights and shadows', keywords: 'brightness light dark contrast highlights shadows whites blacks auto correct raw' },
  { id: 'balance', title: 'White balance', category: 'base', blurb: 'Temperature, tint and saturation', keywords: 'temperature tint wb warm cool colour correct saturation neutral grey auto raw' },
  { id: 'curve', title: 'Curve', category: 'base', blurb: 'A tone curve, from a preset or drawn', keywords: 'tone curve contrast matte s-curve levels' },
  { id: 'crop', title: 'Crop', category: 'camera', blurb: 'Crop to an aspect ratio', keywords: 'crop frame aspect ratio square 4:5 composition trim straighten reframe instagram' },
  { id: 'lens', title: 'Lens', category: 'camera', blurb: 'Distortion, fringing, soft corners, diffusion and tilt-shift', keywords: 'distortion fisheye barrel chromatic aberration fringe soft focus diffusion pro mist blur tilt shift miniature toy camera' },
  { id: 'prism', title: 'Prism', category: 'camera', blurb: 'Splits the colours apart: red and blue, or a rainbow', keywords: 'prism rgb split chromatic aberration rainbow dispersion fringe glitch colour shift spectrum refraction crystal' },
  { id: 'double', title: 'Double exposure', category: 'camera', blurb: 'Blends a second photo over this one', keywords: 'multiple exposure overlay blend second photo screen ghost' },
  { id: 'stamp', title: 'Date stamp', category: 'camera', blurb: 'A date printed in the corner, like a point-and-shoot camera', keywords: 'date time lcd orange disposable point and shoot text' },
  { id: 'colour', title: 'Colour', category: 'colour', blurb: 'Colour grading with palettes from the photo or set by hand', keywords: 'grade palette recipe tint warmth vibrance film stock pop' },
  { id: 'tone', title: 'Tone', category: 'colour', blurb: 'Film exposure, fade, soft highlights, vignette and clarity', keywords: 'push overexpose fade matte vignette structure clarity film' },
  { id: 'light', title: 'Glow', category: 'light', blurb: 'Halation and bloom around highlights', keywords: 'halation bloom glow light flare haze soft blur' },
  { id: 'edges', title: 'Edges', category: 'light', blurb: 'Glow and contrast along edges', keywords: 'rim edge glow crunch outline sharpen local contrast' },
  { id: 'solarize', title: 'Solarize', category: 'light', blurb: 'Reverses the brightest tones, with lines along edges', keywords: 'sabattier reverse invert halo mackie lines darkroom' },
  { id: 'lighting', title: 'Lighting', category: 'light', blurb: 'Light drawn onto parts of the photo, in any colour', keywords: 'light lighting relight glow spotlight sun window warm cool tint dodge brighten colour cast' },
  { id: 'leaks', title: 'Leaks & burns', category: 'light', blurb: 'Light leaks and burns at the edges of the frame', keywords: 'light leak burn flare' },
  { id: 'mono', title: 'Black & white', category: 'texture', blurb: 'Black and white with a colour filter and toning', keywords: 'monochrome bw grayscale greyscale filter red yellow orange tri-x hp5' },
  { id: 'grain', title: 'Grain', category: 'texture', blurb: 'Film grain, generated or from a scanned plate', keywords: 'noise film texture plate' },
  { id: 'dither', title: 'Dither', category: 'texture', blurb: 'Posterized bands with stipple or ordered dither', keywords: 'bands banding stipple posterize steps' },
  { id: 'pixel', title: 'Pixel art', category: 'texture', blurb: 'Pixelation and limited colour palettes', keywords: 'pixelate blocks palette gameboy retro' },
  { id: 'streaks', title: 'Streaks', category: 'shapes', blurb: 'Smears the photo along a drawn shape', keywords: 'smear motion blur slit scan stretch pixel stretch drag speed trail' },
  { id: 'glass', title: 'Glass', category: 'shapes', blurb: 'Reeded, faceted or rippled glass distortion', keywords: 'reeded prism ripple refraction' },
  { id: 'collage', title: 'Collage', category: 'shapes', blurb: 'Pieces from other photos placed into this one', keywords: 'pieces cut paste arrange' },
  { id: 'repeat', title: 'Repeat', category: 'shapes', blurb: 'Copies of a masked part of the photo, on a grid, along a path or placed', keywords: 'repeat copy clone stamp duplicate echo array grid pattern tile' },
  { id: 'kaleido', title: 'Kaleidoscope', category: 'shapes', blurb: 'The photo, or a part of it, copied round a point', keywords: 'kaleidoscope mirror symmetry symmetric radial rotate turn spin mandala twist tunnel reflect fold' },
  { id: 'halftone', title: 'Halftone & riso', category: 'print', blurb: 'Halftone dots or lines, or a two-colour riso print', keywords: 'halftone dots screen print riso risograph zine newspaper comic duotone' },
  { id: 'border', title: 'Border', category: 'print', blurb: 'A paper border around the image', keywords: 'frame paper edge white' },
  { id: 'dust', title: 'Dust & scratches', category: 'print', blurb: 'Dust, hairs and scratches', keywords: 'defects dirt hair scratch scan' },
  { id: 'surge', title: 'Surge marks', category: 'print', blurb: 'Bands from uneven development', keywords: 'development bands marks' },
]

export const MODULE_BY_ID = Object.fromEntries(MODULES.map((m) => [m.id, m])) as Record<StackModuleId, ModuleDef>

/**
 * What every module's header offers, in one place, so they are all alike:
 * each has a switch and a reset; one that works on part of the picture can
 * be masked (its MaskSection is its own id); one that is a style, not a
 * correction of this photo or something placed on it, keeps presets (its
 * PartKind is its own id). Left out, and why:
 * - masks: the base corrections (exposure, white balance, curve) and the
 *   camera (crop, lens, double exposure, date stamp) work on the whole frame
 *   before anything else; collage pieces are shapes of their own; the border
 *   is the paper round the photo.
 * - presets: the base corrections and crop belong to this photo; streaks,
 *   collage, repeat and lighting are placed on it; a double exposure needs
 *   its second photo.
 */
export const MASKABLE: ReadonlySet<StackModuleId> = new Set<StackModuleId>([
  'tone', 'colour', 'light', 'edges', 'solarize', 'lighting', 'leaks',
  'mono', 'grain', 'dither', 'pixel',
  'streaks', 'glass', 'repeat', 'kaleido',
  'halftone', 'dust', 'surge',
])
export const WITH_PRESETS: ReadonlySet<StackModuleId> = new Set<StackModuleId>([
  'lens', 'prism', 'stamp',
  'tone', 'colour', 'light', 'edges', 'solarize', 'leaks',
  'mono', 'grain', 'dither', 'pixel',
  'glass',
  'halftone', 'border', 'dust', 'surge',
])
export const presetKind = (id: StackModuleId): PartKind | null => (WITH_PRESETS.has(id) ? (id as PartKind) : null)

/**
 * Every module's reset: its settings back to how adding it starts them (the
 * values a slider's double-click returns to, FACTORY), its switch as it was:
 * on, it stays on and shows what it does; off, it stays off. Everything else
 * in the edit untouched.
 */
export function resetModule(id: StackModuleId, b: BlendParams, on = inUse(id, b)): BlendParams {
  const started = startModule(id, clearModule(id, b))
  return on ? started : stopModule(id, started)
}

/** A module's settings back to the app's defaults (mostly nothing), its switch as it was. */
function clearModule(id: StackModuleId, b: BlendParams): BlendParams {
  const kind = presetKind(id)
  if (kind) return resetPart(kind, b)
  const e = b.effects
  const d = DEFAULT_BLEND_PARAMS.effects
  const fx = (patch: Partial<BlendParams['effects']>): BlendParams => ({ ...b, effects: { ...e, ...patch } })
  switch (id) {
    case 'exposure':
      return fx({ base: { ...e.base, exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0 } })
    case 'balance':
      return fx({ base: { ...e.base, temperature: 0, tint: 0, saturation: 0 } })
    case 'curve':
      return fx({ base: { ...e.base, curve: DEFAULT_BASE.curve } })
    case 'crop':
      return fx({ crop: { ...DEFAULT_CROP, enabled: e.crop.enabled } })
    case 'double':
      // The second photo stays: it is chosen, not a setting.
      return fx({ double: { ...d.double, image: e.double.image, enabled: e.double.enabled } })
    case 'streaks':
      return fx({ streaks: { ...d.streaks, enabled: e.streaks.enabled } })
    case 'collage':
      return fx({ collage: { ...d.collage, enabled: e.collage.enabled } })
    case 'repeat':
      // What each copies stays: its piece is made, not a setting.
      return fx({ repeat: { enabled: !!e.repeat?.enabled, items: (e.repeat?.items ?? []).map((r) => ({ ...DEFAULT_REPEAT, id: r.id, enabled: r.enabled, source: r.source })) } })
    case 'kaleido':
      // Its piece stays: it is made, not a setting. The point goes back to the middle.
      return fx({ kaleido: { ...DEFAULT_KALEIDO, enabled: !!e.kaleido?.enabled, source: e.kaleido?.source ?? null } })
    case 'lighting':
      return fx({ lighting: { ...DEFAULT_LIGHTING, enabled: !!e.lighting?.enabled } })
    default:
      return b
  }
}
export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<CategoryId, Category>

export const isStackModule = (id: string): id is StackModuleId => id in MODULE_BY_ID

/** Where a module sits in the panel: by category, then the engine's order. */
export function moduleOrder(id: StackModuleId): number {
  const def = MODULE_BY_ID[id]
  const cat = CATEGORIES.findIndex((c) => c.id === def.category)
  return (cat + 1) * 100 + MODULES.indexOf(def) + 1
}
export const categoryOrder = (id: CategoryId) => (CATEGORIES.findIndex((c) => c.id === id) + 1) * 100

/** Whether a module is on and doing something to this photo. */
export function inUse(id: StackModuleId, b: BlendParams): boolean {
  const e = b.effects
  const g = e.grade
  const on = b.modules
  switch (id) {
    case 'crop':
      return e.crop.enabled
    case 'lens':
      return lensOn(e.lens)
    case 'prism':
      return prismOn(e.prism)
    case 'double':
      return doubleOn(e.double)
    case 'stamp':
      return e.stamp.enabled
    case 'mono':
      return e.mono.enabled && e.mono.amount > 0
    case 'halftone':
      return e.halftone.enabled && e.halftone.amount > 0
    case 'exposure':
      return baseActive(e.base).light
    case 'balance':
      return baseActive(e.base).colour
    case 'curve':
      return baseActive(e.base).curve
    case 'tone':
      return on.tone && (e.exposure !== 0 || e.fade > 0 || e.shoulder > 0 || e.vignette > 0 || e.structure > 0)
    case 'colour':
      return (
        on.colour &&
        (g.mapAmount > 0 ||
          g.vibrance !== 0 ||
          g.warmth !== 0 ||
          g.tint !== 0 ||
          g.shadowAmount > 0 ||
          g.highlightAmount > 0 ||
          g.isolateAmount > 0 ||
          g.popAmount > 0 ||
          g.blobs.length > 0 ||
          e.stock.id !== 'none')
      )
    case 'light':
      return on.light && (e.halation > 0 || e.bloom > 0)
    case 'edges':
      return on.edges && (e.rim > 0 || e.crunch > 0)
    case 'solarize':
      return on.solarize && (e.solarize > 0 || e.halo > 0)
    case 'leaks':
      return on.leaks && e.leaks.amount > 0
    case 'grain':
      return on.grain && b.amount > 0
    case 'dither':
      return e.dither.enabled && e.dither.amount > 0
    case 'pixel':
      return e.pixelArt.enabled && (e.pixelArt.pixelate > 1 || e.pixelArt.palette !== 'off')
    // The modules things are placed in are on as soon as they are switched
    // on, as Repeat is: what they place is made in the module.
    case 'streaks':
      return e.streaks.enabled
    case 'glass':
      return glassOn(e.glass)
    case 'collage':
      return e.collage.enabled
    case 'repeat':
      // On as soon as it is switched on: its piece is chosen in the module.
      return !!e.repeat?.enabled
    case 'kaleido':
      return !!e.kaleido?.enabled
    case 'lighting':
      return !!e.lighting?.enabled
    case 'border':
      return on.border && (b.border.width > 0 || b.border.bottomExtra > 0)
    case 'dust':
      return on.defects && (e.defects.strength > 0 || e.defects.scanLines > 0 || e.defects.scanStreaks > 0)
    case 'surge':
      return on.surge && e.surge.strength > 0
  }
}

/**
 * The settings with a module switched on, and given a gentle start if it had
 * nothing set, so adding one shows what it does straight away.
 */
export function startModule(id: StackModuleId, b: BlendParams): BlendParams {
  const e = b.effects
  const on = (key: keyof BlendParams['modules']) => ({ ...b.modules, [key]: true })
  const fx = (patch: Partial<BlendParams['effects']>): BlendParams => ({ ...b, effects: { ...e, ...patch } })
  const base = (patch: Partial<BlendParams['effects']['base']>): BlendParams => fx({ base: { ...e.base, ...patch } })
  switch (id) {
    case 'lens': {
      const l = e.lens
      const blank = l.distortion === 0 && l.fringe <= 0 && l.diffusion <= 0 && l.softEdges <= 0 && l.tilt <= 0
      return fx({ lens: { ...l, enabled: true, ...(blank ? { diffusion: 0.3, softEdges: 0.35, fringe: 0.25 } : {}) } })
    }
    case 'prism': {
      const p = e.prism
      return fx({ prism: { ...p, enabled: true, ...(p.split <= 0 ? { split: 0.3 } : {}), ...(p.amount <= 0 ? { amount: 1 } : {}) } })
    }
    case 'crop':
      return fx({ crop: { ...e.crop, enabled: true } })
    case 'double':
      return fx({ double: { ...e.double, enabled: true } })
    case 'stamp':
      return fx({ stamp: { ...e.stamp, enabled: true } })
    case 'mono':
      return fx({ mono: { ...e.mono, enabled: true, amount: e.mono.amount > 0 ? e.mono.amount : 1 } })
    case 'halftone':
      // Dots and lines start in newspaper black; riso keeps its blue and pink pair.
      return fx({
        halftone: {
          ...e.halftone,
          enabled: true,
          amount: e.halftone.amount > 0 ? e.halftone.amount : 1,
          ...(e.halftone.style !== 'riso' && e.halftone.inkA.every((v, k) => v === DEFAULT_HALFTONE.inkA[k]) ? { inkA: [0.1, 0.1, 0.12] as [number, number, number] } : {}),
        },
      })
    // Corrections start at rest: nothing is changed until asked.
    case 'exposure':
      return base({ lightOn: true })
    case 'balance':
      return base({ colourOn: true })
    case 'curve':
      return base({ curveOn: true })
    case 'tone': {
      const blank = e.exposure === 0 && e.fade <= 0 && e.shoulder <= 0 && e.vignette <= 0 && e.structure <= 0
      return { ...b, modules: on('tone'), effects: blank ? { ...e, fade: 0.04, shoulder: 0.35 } : e }
    }
    case 'colour': {
      // Nothing set yet: the gentlest recipe, built from the photo's own light.
      if (inUse('colour', { ...b, modules: on('colour') })) return { ...b, modules: on('colour') }
      const r = BUILT_IN_RECIPES[0]
      return { ...b, modules: on('colour'), effects: { ...e, grade: { ...e.grade, ...r.look, recipe: r.rule, mapHarmony: r.rule.harmony } } }
    }
    case 'light': {
      const blank = e.halation <= 0 && e.bloom <= 0
      return { ...b, modules: on('light'), effects: blank ? { ...e, halation: 0.35, bloom: 0.1 } : e }
    }
    case 'edges': {
      const blank = e.rim <= 0 && e.crunch <= 0
      return { ...b, modules: on('edges'), effects: blank ? { ...e, rim: 0.5 } : e }
    }
    case 'solarize': {
      const blank = e.solarize <= 0 && e.halo <= 0
      return { ...b, modules: on('solarize'), effects: blank ? { ...e, solarize: 0.4, halo: 0.25 } : e }
    }
    case 'leaks':
      return { ...b, modules: on('leaks'), effects: { ...e, leaks: { ...e.leaks, amount: e.leaks.amount > 0 ? e.leaks.amount : 0.6 } } }
    case 'grain':
      // Switched on, it starts where its slider's reset goes (FACTORY), not somewhere else.
      return { ...b, modules: on('grain'), amount: b.amount > 0 ? b.amount : DEFAULT_BLEND_PARAMS.amount }
    case 'dither':
      return fx({ dither: { ...e.dither, enabled: true, amount: e.dither.amount > 0 ? e.dither.amount : 0.5 } })
    case 'pixel':
      return fx({ pixelArt: { ...e.pixelArt, enabled: true, pixelate: e.pixelArt.pixelate > 1 || e.pixelArt.palette !== 'off' ? e.pixelArt.pixelate : 4 } })
    case 'streaks':
      return fx({ streaks: { ...e.streaks, enabled: true } })
    case 'glass': {
      const g = e.glass ?? DEFAULT_GLASS
      return fx({ glass: { ...g, enabled: true, amount: g.amount > 0 ? g.amount : 0.5 } })
    }
    case 'collage':
      return fx({ collage: { ...e.collage, enabled: true } })
    case 'repeat':
      return fx({ repeat: { ...(e.repeat ?? DEFAULT_REPEAT_MODULE), enabled: true } })
    case 'kaleido':
      // Straight away: a slice from the middle, copied round it.
      return fx({ kaleido: { ...(e.kaleido ?? DEFAULT_KALEIDO), enabled: true } })
    case 'lighting':
      return fx({ lighting: { ...(e.lighting ?? DEFAULT_LIGHTING), enabled: true } })
    case 'border': {
      const bo = b.border
      const blank = bo.width <= 0 && bo.bottomExtra <= 0
      return { ...b, modules: on('border'), border: blank ? { ...bo, width: 0.035 } : bo }
    }
    case 'dust':
      return { ...b, modules: on('defects'), effects: { ...e, defects: { ...e.defects, strength: e.defects.strength > 0 ? e.defects.strength : 0.5 } } }
    case 'surge':
      return { ...b, modules: on('surge'), effects: { ...e, surge: { ...e.surge, strength: e.surge.strength > 0 ? e.surge.strength : 0.6 } } }
  }
}

/**
 * The settings with a module's switch on and nothing else changed: what
 * touching a control of a switched-off module does before the change itself.
 */
export function switchOn(id: StackModuleId, b: BlendParams): BlendParams {
  const e = b.effects
  const mod = (key: keyof BlendParams['modules']) => ({ ...b, modules: { ...b.modules, [key]: true } })
  const fx = (patch: Partial<BlendParams['effects']>): BlendParams => ({ ...b, effects: { ...e, ...patch } })
  switch (id) {
    case 'exposure':
      return fx({ base: { ...e.base, lightOn: true } })
    case 'balance':
      return fx({ base: { ...e.base, colourOn: true } })
    case 'curve':
      return fx({ base: { ...e.base, curveOn: true } })
    case 'crop':
    case 'lens':
    case 'prism':
    case 'double':
    case 'stamp':
    case 'mono':
    case 'halftone':
    case 'streaks':
    case 'collage':
    case 'dither':
      return fx({ [id]: { ...e[id], enabled: true } } as Partial<BlendParams['effects']>)
    case 'repeat':
      return fx({ repeat: { ...(e.repeat ?? DEFAULT_REPEAT_MODULE), enabled: true } })
    case 'kaleido':
      return fx({ kaleido: { ...(e.kaleido ?? DEFAULT_KALEIDO), enabled: true } })
    case 'lighting':
      return fx({ lighting: { ...(e.lighting ?? DEFAULT_LIGHTING), enabled: true } })
    case 'pixel':
      return fx({ pixelArt: { ...e.pixelArt, enabled: true } })
    case 'glass':
      return fx({ glass: { ...(e.glass ?? DEFAULT_GLASS), enabled: true } })
    case 'dust':
      return mod('defects')
    default:
      return mod(id)
  }
}

/**
 * The settings with a module switched off. Every module has a switch, and
 * its settings stay, so switching it on again brings them back.
 */
export function stopModule(id: StackModuleId, b: BlendParams): BlendParams {
  const e = b.effects
  const off = (key: keyof BlendParams['modules']) => ({ ...b, modules: { ...b.modules, [key]: false } })
  const fx = (patch: Partial<BlendParams['effects']>): BlendParams => ({ ...b, effects: { ...e, ...patch } })
  const base = (patch: Partial<BlendParams['effects']['base']>): BlendParams => fx({ base: { ...e.base, ...patch } })
  switch (id) {
    case 'crop':
      return fx({ crop: { ...e.crop, enabled: false } })
    case 'lens':
      return fx({ lens: { ...e.lens, enabled: false } })
    case 'prism':
      return fx({ prism: { ...e.prism, enabled: false } })
    case 'double':
      return fx({ double: { ...e.double, enabled: false } })
    case 'stamp':
      return fx({ stamp: { ...e.stamp, enabled: false } })
    case 'mono':
      return fx({ mono: { ...e.mono, enabled: false } })
    case 'halftone':
      return fx({ halftone: { ...e.halftone, enabled: false } })
    case 'exposure':
      return base({ lightOn: false })
    case 'balance':
      return base({ colourOn: false })
    case 'curve':
      return base({ curveOn: false })
    case 'tone':
    case 'colour':
    case 'light':
    case 'edges':
    case 'solarize':
    case 'leaks':
    case 'grain':
    case 'border':
    case 'surge':
      return off(id)
    case 'dust':
      return off('defects')
    case 'dither':
      return fx({ dither: { ...e.dither, enabled: false } })
    case 'pixel':
      return fx({ pixelArt: { ...e.pixelArt, enabled: false } })
    case 'streaks':
      return fx({ streaks: { ...e.streaks, enabled: false } })
    case 'glass':
      return fx({ glass: { ...(e.glass ?? DEFAULT_GLASS), enabled: false } })
    case 'collage':
      return fx({ collage: { ...e.collage, enabled: false } })
    case 'repeat':
      return fx({ repeat: { ...(e.repeat ?? DEFAULT_REPEAT_MODULE), enabled: false } })
    case 'kaleido':
      return fx({ kaleido: { ...(e.kaleido ?? DEFAULT_KALEIDO), enabled: false } })
    case 'lighting':
      return fx({ lighting: { ...(e.lighting ?? DEFAULT_LIGHTING), enabled: false } })
  }
}

/**
 * Every module as Add starts it, on the app's defaults: what a control is
 * measured from when it shows how far it has been moved (Slider's def). A
 * recipe's own settings, and yours, show as changes from this.
 */
export const FACTORY: BlendParams = MODULES.reduce((b, m) => startModule(m.id, b), DEFAULT_BLEND_PARAMS)
export const FACTORY_GLASS = FACTORY.effects.glass ?? DEFAULT_GLASS
