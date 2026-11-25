import type { EditState } from './history'
import { MODULE_BY_ID, isStackModule, type StackModuleId } from './moduleCatalog'
import { STREAK_KINDS, kindOf } from './streakKinds'
import { STREAK_STYLES, finishOf } from './streakStyles'
import type { StreakShape } from '../engine/types'

/**
 * Names for the History list. The status line says "Undid the Stipple Tide
 * recipe."; a list of steps reads better as "Recipe: Stipple Tide", "Grain:
 * strength", "Streak 2 moved". A step either has a name given when it was
 * made (a WHOLE_STEP hint, worded for the status line) or is named here from
 * what changed between the states before and after it.
 */

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
/** "the streak" → "Streak": a subject at the start of a title. */
const subject = (s: string) => cap(s.replace(/^the /, ''))
/** scanLines → "scan lines". */
export const humanize = (key: string) => key.replace(/([A-Z])/g, ' $1').toLowerCase()

/** Phrases worded for "Undid …", each turned into a title for the list. First match wins. */
const PHRASES: [RegExp, (...m: string[]) => string][] = [
  [/^the recipe “(.+)”$/, (n) => `Recipe: ${n}`],
  [/^the (.+) recipe$/, (n) => `Recipe: ${n}`],
  [/^the (.+) preset “(.+)”$/, (part, n) => `${cap(part)} preset: ${n}`],
  [/^the (.+) palette$/, (n) => `Palette: ${n}`],
  [/^the (.+) curve$/, (n) => `Curve: ${n}`],
  [/^the (.+) stamp$/, (n) => `Date stamp: ${n}`],
  [/^the (.+) border$/, (n) => `Border: ${n}`],
  [/^the colour onto the palette$/, () => 'Colour added to the palette'],
  [/^the palette[’'](?:s)? (.+)$/, (what) => `Palette ${what}`],
  [/^where the palette leads$/, () => 'Palette lead'],
  [/^where the palette[’'](?:s)? colour comes from$/, () => 'Palette colour source'],
  [/^choosing what Repeat copies$/, () => 'Repeat original chosen'],
  [/^clearing everything$/, () => 'Everything cleared'],
  [/^starting over$/, () => 'Started over'],
  [/^a new photo, (.+)$/, (n) => `Opened ${n}`],
  [/^cropping for (.+)$/, (what) => `Cropped for ${what}`],
  [/^automatic (.+)$/, (what) => `Auto ${what}`],
  [/^adding (.+)$/, (what) => `${subject(what)} added`],
  [/^removing (.+)$/, (what) => `${subject(what)} removed`],
  [/^resetting (.+)$/, (what) => `${subject(what)} reset`],
  [/^painting (.+)$/, (what) => `${subject(what)} painted`],
  [/^drawing (.+)$/, (what) => `${subject(what)} drawn`],
  [/^extending (.+)$/, (what) => `${subject(what)} extended`],
  [/^switching (on|off) (.+)$/, (on, what) => `${subject(what)} ${on}`],
  [/^switching (.+) (on|off)$/, (what, on) => `${subject(what)} ${on}`],
  [/^matching (.+?) to (.+)$/, (what, to) => `${subject(what)} matched to ${to}`],
  [/^pinning (.+?) to (.+)$/, (what, to) => `${subject(what)} pinned to ${to}`],
  [/^an? (.+)$/, (what) => `${cap(what)} added`],
]

/** A step named when it was made (the text after WHOLE_STEP), as a title for the list. */
export function wholeTitle(phrase: string): string {
  const p = phrase.trim()
  for (const [re, make] of PHRASES) {
    const m = p.match(re)
    if (m) return make(...m.slice(1))
  }
  return cap(p)
}

// ---------------------------------------------------------------------------
// Named from what changed.

/** The settings on BlendParams itself, by the module that shows them. */
const BLEND_KEYS: Record<string, StackModuleId> = {
  amount: 'grain',
  blendMode: 'grain',
  colorSpace: 'grain',
  tiling: 'grain',
  grainScale: 'grain',
  grainRotation: 'grain',
  chroma: 'grain',
  softness: 'grain',
  plateNormalise: 'grain',
  plateFlatten: 'grain',
  plateSampling: 'grain',
  response: 'grain',
  responseMode: 'grain',
  layerSpread: 'grain',
  grainFollowsColour: 'grain',
  varyPerPhoto: 'grain',
  border: 'border',
}

/** The settings on EffectParams, by module. `base` is split three ways (BASE_KEYS). */
const EFFECT_KEYS: Record<string, StackModuleId> = {
  mono: 'mono',
  halftone: 'halftone',
  surface: 'surface',
  lens: 'lens',
  prism: 'prism',
  double: 'double',
  stamp: 'stamp',
  halation: 'light',
  bloom: 'light',
  glowColour: 'light',
  glowThreshold: 'light',
  glowFit: 'light',
  glowRadius: 'light',
  rim: 'edges',
  rimRadius: 'edges',
  crunch: 'edges',
  halo: 'solarize',
  haloRadius: 'solarize',
  solarize: 'solarize',
  solarizeFrom: 'solarize',
  structure: 'tone',
  structureRadius: 'tone',
  exposure: 'tone',
  shoulder: 'tone',
  fade: 'tone',
  vignette: 'tone',
  dither: 'dither',
  stock: 'colour',
  grade: 'colour',
  leaks: 'leaks',
  pixelArt: 'pixel',
  streaks: 'streaks',
  collage: 'collage',
  glass: 'glass',
  defects: 'dust',
  surge: 'surge',
  crop: 'crop',
  repeat: 'repeat',
  kaleido: 'kaleido',
  recolour: 'recolour',
  lighting: 'lighting',
}

const BASE_KEYS: Record<string, StackModuleId> = {
  exposure: 'exposure',
  contrast: 'exposure',
  highlights: 'exposure',
  shadows: 'exposure',
  whites: 'exposure',
  blacks: 'exposure',
  lightOn: 'exposure',
  temperature: 'balance',
  tint: 'balance',
  saturation: 'balance',
  colourOn: 'balance',
  curve: 'curve',
  curveOn: 'curve',
}

/** The module switches (ModuleToggles) by module. */
const TOGGLE_KEYS: Record<string, StackModuleId> = { defects: 'dust' }

/** A module's switch, wherever it is kept. */
const SWITCHES = new Set(['enabled', 'lightOn', 'colourOn', 'curveOn'])

/** The recipe's Strength dials (KeyControls). */
const KEY_NAMES: Record<string, string> = { look: 'overall', grain: 'grain', colour: 'colour', glow: 'glow', leaks: 'leaks', wash: 'wash' }

/** What the panels call a setting, where its key does not say it plainly. Others are humanized. */
const FIELDS: Partial<Record<StackModuleId, Record<string, string>>> = {
  grain: {
    amount: 'strength',
    chroma: 'colour',
    grainScale: 'pattern scale',
    plateFlatten: 'flatten',
    grainFollowsColour: 'follows colour',
    response: 'response curve',
    responseMode: 'response',
    colorSpace: 'blend space',
    plateNormalise: 'plate levels',
    plateSampling: 'sampling',
  },
  border: { bottomExtra: 'bottom', irregularity: 'edge', paper: 'surface', edge: 'edge' },
  exposure: {},
  balance: {},
  tone: { exposure: 'film exposure', shoulder: 'soft highlights', structureRadius: 'detail size' },
  light: { glowRadius: 'radius', glowThreshold: 'glow from', glowFit: 'fit to the photo', glowColour: 'colour' },
  edges: { rim: 'edge glow', rimRadius: 'reach' },
  solarize: { solarize: 'reverse', solarizeFrom: 'from', halo: 'lines', haloRadius: 'line width' },
  colour: {
    stock: 'film stock',
    mapAmount: 'strength',
    mapContrast: 'contrast',
    mapBalance: 'balance',
    mapHarmony: 'harmony',
    mapShadow: 'palette',
    mapMid: 'palette',
    mapHigh: 'palette',
    popAmount: 'recolour',
    popKeep: 'keep',
    popColour: 'recolour colour',
    isolateWidth: 'range',
    isolateAmount: 'fade',
    shadowAmount: 'shadow strength',
    highlightAmount: 'highlight strength',
    shadowTint: 'shadow colour',
    highlightTint: 'highlight colour',
  },
  dither: { follow: 'band by', pixel: 'pixel size', sparePop: 'spare pop colour', toneHi: 'brightest', toneLo: 'darkest', guidesOn: 'band guides' },
  double: { scale: 'size', x: 'across', y: 'down', mono: 'colour', image: 'photo' },
  halftone: { cell: 'dot size' },
  prism: { split: 'split', colours: 'colours', light: 'only the light', shape: 'direction' },
  lens: { focus: 'sharp at', focusWidth: 'band', fringe: 'fringes', softEdges: 'soft corners', tilt: 'blur' },
  mono: { toneAmount: 'toning' },
  pixel: { pixelate: 'pixelate', dither: 'blend dither' },
  streaks: { glowRadius: 'glow size', prismAngle: 'split angle', graded: 'colour grade' },
  surge: { count: 'bands' },
  dust: { strength: 'amount', scanLines: 'scan lines', scanStreaks: 'streaks' },
  leaks: { layoutSeed: 'layout', seed: 'layout' },
  repeat: { count: 'copies', gapX: 'gap across', gapY: 'gap up', source: 'piece', pieceOnPath: 'where the piece is on the path', followPath: 'follow path', behind: 'in front or behind', blend: 'mode', placed: 'placed copies', path: 'path' },
  crop: { aspect: 'aspect', turned: 'turned' },
  collage: { arrange: 'arrangement', scale: 'size' },
}

/** Modules whose unlabelled settings are just "the module": crop's corners, a curve's points. */
const PLAIN = new Set<StackModuleId>(['crop', 'curve', 'collage'])

/** Things placed on the photo, kept in lists: what one is called. */
const LISTS: Record<string, string> = {
  shapes: 'Streak',
  spots: 'Leak',
  lights: 'Light',
  pieces: 'Piece',
  items: 'Repeat',
  guides: 'Band guide',
  blobs: 'Palette colour',
  masks: 'Mask',
}

type Rec = Record<string, unknown>
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v)
const changedKeys = (a: Rec, b: Rec) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k])

interface Change {
  /** The module (or 'masks', 'maskUse', 'keys', 'shapes' for things that are not one). */
  area: string
  key: string
  a: unknown
  b: unknown
  /** A module's switch in ModuleToggles. */
  toggle?: boolean
}

function changes(a: Rec, b: Rec): Change[] {
  const out: Change[] = []
  for (const k of changedKeys(a, b)) {
    if (k === 'effects' && isRec(a[k]) && isRec(b[k])) {
      const ea = a[k] as Rec
      const eb = b[k] as Rec
      for (const e of changedKeys(ea, eb)) {
        if (e === 'base' && isRec(ea[e]) && isRec(eb[e])) {
          const ba = ea[e] as Rec
          const bb = eb[e] as Rec
          for (const f of changedKeys(ba, bb)) out.push({ area: BASE_KEYS[f] ?? 'exposure', key: f, a: ba[f], b: bb[f] })
        } else if (e === 'masks' || e === 'maskUse') out.push({ area: e, key: e, a: ea[e], b: eb[e] })
        else if (e === 'shapeSpace' || e === 'shapeUnits') out.push({ area: 'shapes', key: e, a: ea[e], b: eb[e] })
        else out.push({ area: EFFECT_KEYS[e] ?? e, key: e, a: ea[e], b: eb[e] })
      }
    } else if (k === 'modules' && isRec(a[k]) && isRec(b[k])) {
      const ma = a[k] as Rec
      const mb = b[k] as Rec
      for (const m of changedKeys(ma, mb)) out.push({ area: TOGGLE_KEYS[m] ?? m, key: m, a: ma[m], b: mb[m], toggle: true })
    } else if (k === 'keys' && isRec(a[k]) && isRec(b[k])) {
      for (const d of changedKeys(a[k] as Rec, b[k] as Rec)) out.push({ area: 'keys', key: d, a: undefined, b: undefined })
    } else out.push({ area: BLEND_KEYS[k] ?? k, key: k, a: a[k], b: b[k] })
  }
  return out
}

const moduleTitle = (area: string) => (isStackModule(area) ? MODULE_BY_ID[area].title : cap(humanize(area)))
const onOff = (v: unknown) => (v === false ? 'off' : 'on')

/** A setting's name in its module ("strength"), or null for a module that is one thing (a crop, a curve). */
function fieldWord(mod: StackModuleId, field: string): string | null {
  const label = FIELDS[mod]?.[field]
  if (!label && PLAIN.has(mod)) return null
  return label ?? humanize(field)
}

/** "a and b", "a, b and c", "a, b and 2 more". */
export function listWords(ws: string[]): string {
  if (ws.length <= 1) return ws[0] ?? ''
  if (ws.length === 2) return `${ws[0]} and ${ws[1]}`
  if (ws.length === 3) return `${ws[0]}, ${ws[1]} and ${ws[2]}`
  return `${ws[0]}, ${ws[1]} and ${ws.length - 2} more`
}

/** A module and the settings changed in it: "Grain: strength", "Lens: distortion and vignette", "Shadows". */
function fieldTitle(mod: StackModuleId, ...fields: string[]): string {
  const title = MODULE_BY_ID[mod].title
  const words = [...new Set(fields.map((f) => fieldWord(mod, f)))]
  if (words.includes(null)) return title
  const ws = words as string[]
  // The base corrections are named by their controls alone: "Shadows", "Temperature".
  if (mod === 'exposure' || mod === 'balance') return cap(listWords(ws))
  if (ws.length === 1 && ws[0] === title.toLowerCase()) return title
  return `${title}: ${listWords(ws)}`
}

/** Whether every point moved by the same amount. */
function shifted(a: unknown, b: unknown): boolean {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return false
  const d = (p: unknown, q: unknown, k: 'x' | 'y') => ((q as Rec)?.[k] as number) - ((p as Rec)?.[k] as number)
  const dx = d(a[0], b[0], 'x')
  const dy = d(a[0], b[0], 'y')
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false
  return a.every((p, i) => Math.abs(d(p, b[i], 'x') - dx) < 1e-6 && Math.abs(d(p, b[i], 'y') - dy) < 1e-6)
}

/** How a placed thing's field changed, if it only moved, sized or turned it; null for any other setting. */
function motion(k: string, a: unknown, b: unknown): 'moved' | 'reshaped' | 'resized' | 'turned' | null {
  if (k === 'x' || k === 'y' || k === 'cx' || k === 'cy') return 'moved'
  if (k === 'angle' || k === 'rotation') return 'turned'
  if (k === 'scale' || k === 'size') return 'resized'
  if (k === 'outline' || k === 'path' || k === 'points' || k === 'seeds') return shifted(a, b) ? 'moved' : 'reshaped'
  if (k === 'gradient' && isRec(a) && isRec(b)) {
    const ends = (g: Rec) => [{ x: g.x0, y: g.y0 }, { x: g.x1, y: g.y1 }]
    return shifted(ends(a), ends(b)) ? 'moved' : 'reshaped'
  }
  if (k === 'radial' && isRec(a) && isRec(b)) {
    const ks = changedKeys(a, b)
    if (ks.every((x) => x === 'x' || x === 'y')) return 'moved'
    if (ks.every((x) => x === 'rx' || x === 'ry')) return 'resized'
    if (ks.every((x) => x === 'angle')) return 'turned'
    return ks.includes('soft') ? null : 'reshaped'
  }
  return null
}

/** A placed thing's fields whose own names read badly. */
const ITEM_FIELDS: Record<string, string> = {
  maskIds: 'where it applies',
  colourLine: 'sample line',
  maskMode: 'where it applies',
  radial: 'softness',
  mirrorAt: 'mirror middle',
  mirrorVary: 'mirror variation',
  ends: 'end line',
  path: 'curve',
  changeAt: 'where the tone changes',
  changeLength: 'where the tone changes',
  // A bar's start and end values are one setting in the panel.
  endOpacity: 'opacity',
  endBrightness: 'brightness',
  endContrast: 'contrast',
  lengthMin: 'length',
  lengthMax: 'length',
  stripeMin: 'stripes',
  stripeMax: 'stripes',
  tipAngle: 'tips',
  tipRange: 'tips',
  endSoftness: 'end softness',
  barVary: 'bar widths',
  band: 'bar width',
  carry: 'carries',
}

/** A repeat's fields, as Repeat's panel names them. */
const REPEAT_FIELDS: Record<string, string> = {
  layout: 'layout',
  across: 'copies across',
  up: 'copies up',
  gapX: 'spacing',
  gapY: 'spacing',
  spacing: 'spacing',
  stagger: 'stagger',
  both: 'both sides',
  mirror: 'mirror',
  angle: 'angle',
  vanish: 'perspective',
  path: 'path',
  count: 'copies',
  followPath: 'turn with the path',
  straight: 'straight lines',
  pieceOnPath: 'where the original is',
  firstToLast: 'which way it runs',
  placed: 'placed copies',
  size: 'size',
  turn: 'turn',
  turnEase: 'twist',
  opacity: 'opacity',
  behind: 'copies behind or in front',
  blend: 'mode',
  source: 'original',
}

/** A collage piece's fields, as Collage's panel names them. */
const PIECE_FIELDS: Record<string, string> = {
  tolerance: 'reach',
  seal: 'stop at thin lines',
  soften: 'soften',
  flip: 'flip',
  match: 'match light',
  brightness: 'brightness',
  takeLook: 'match the look',
  detail: 'photo detail',
  fillHoles: 'fill holes',
  throughLeaves: 'fill all of this sky',
  keepLight: 'keep its light',
  relight: 'light the photo',
  smooth: 'smooth image',
  image: 'image',
  opacity: 'opacity',
}

/** A mask's fields, as its panel names them (Edge: Follow photo, Width, Compare, Level, Softness). */
const MASK_FIELDS: Record<string, string> = {
  key: 'follow photo',
  keyAt: 'follow photo',
  keyBand: 'edge width',
  keyOn: 'compare',
  keyColour: 'key colour',
  keyLevel: 'level',
  keySoftness: 'fade',
  featherAt: 'feather',
  raster: 'painted',
  runs: 'painted',
}

/** A Recolour part's settings, as its panel names them. */
const PART_FIELDS: Record<string, string> = { mode: 'colour, hue only or as shot', colour: 'new colour', strength: 'strength', keep: 'kept out of Colour and B&W', source: 'part', brightness: 'brightness', highlights: 'highlights', variation: 'variation' }

/** A streak's tone key fields, as its Mask tab names them. */
const STREAK_KEY_FIELDS: Record<string, string> = {
  key: 'tone key',
  keyOn: 'tone key',
  keyLevel: 'tone key level',
  keySoftness: 'tone key softness',
}

/** Bookkeeping a placed thing carries, never named in History: what a step changed is told by the rest. */
const INTERNAL = new Set(['fitPending', 'beforeExtend', 'lengthBeforeExtend', 'keyWas', 'at', 'updatedAt', 'seed', 'id'])

/** A mask's edge as its Follow photo choice names it, when that is what changed. */
function maskEdgeTitle(keys: string[], b: Rec): string | null {
  const edgeKeys = new Set(['key', 'keyAt', 'keyBand', 'keyOn', 'keyLevel', 'keySoftness'])
  if (!keys.every((k) => edgeKeys.has(k)) || !(keys.includes('key') || keys.includes('keyAt'))) return null
  if (b.key === 'off') return 'edge as selected'
  return b.keyAt === 'edge' ? 'edge follows the photo' : 'kept to the photo’s tones'
}

function itemTitle(a: unknown, b: unknown, noun: string, i: number): string {
  const name = (isRec(a) && typeof a.name === 'string' && a.name) || `${noun} ${i + 1}`
  if (!isRec(a) || !isRec(b)) return `${name} changed`
  let keys = changedKeys(a, b).filter((k) => !INTERNAL.has(k))
  if (!keys.length) return `${name} changed`
  if (noun === 'Mask') {
    const edge = maskEdgeTitle(keys, b)
    if (edge) return `${name}: ${edge}`
  }
  if (keys.length === 1 && keys[0] === 'enabled') return `${name} ${onOff(b.enabled)}`
  if (keys.length === 1 && keys[0] === 'raster') return `${name} painted`
  if (keys.length === 1 && keys[0] === 'name') return `${name} renamed`
  // A streak made another kind (Straight to Curve, say): named by its kind.
  if (noun === 'Streak' && Array.isArray(a.outline) && Array.isArray(b.outline)) {
    const to = kindOf(b as unknown as StreakShape)
    if (kindOf(a as unknown as StreakShape) !== to) return `${name}: ${STREAK_KINDS.find((k) => k.id === to)!.name.toLowerCase()}`
  }
  // A bar style chosen (Bars: Fade): named by the style.
  if (noun === 'Streak' && Array.isArray(b.fixes)) {
    const to = finishOf(b as unknown as StreakShape)
    if (to && to !== finishOf(a as unknown as StreakShape) && keys.length >= 3)
      return `${name}: ${STREAK_STYLES.find((st) => st.id === to)!.name} style`
  }
  // A shape's outline follows its circle or gradient: name the change to those.
  if (keys.includes('radial') || keys.includes('gradient')) keys = keys.filter((k) => k !== 'outline')
  // A repeat: its settings by the panel's names (its angle and size are settings, not a turn or a resize of it).
  if (noun === 'Repeat') {
    if (keys.length === 1 && keys[0] === 'path') {
      const had = Array.isArray(a.path) && a.path.length > 0
      return `${name}: path ${!had ? 'set' : shifted(a.path, b.path) ? 'moved' : 'changed'}`
    }
    return `${name}: ${listWords([...new Set(keys.map((k) => REPEAT_FIELDS[k] ?? humanize(k)))])}`
  }
  const moves = keys.map((k) => motion(k, a[k], b[k]))
  if (moves.length > 0 && moves.every((m) => m !== null)) return `${name} ${new Set(moves).size === 1 ? moves[0] : 'reshaped'}`
  // One setting, or several that read as one (both ends of where a streak's tone changes).
  const own = noun === 'Mask' ? MASK_FIELDS : noun === 'Streak' ? STREAK_KEY_FIELDS : noun === 'Piece' ? PIECE_FIELDS : noun === 'Part' ? PART_FIELDS : {}
  const named = [...new Set(keys.map((k) => own[k] ?? ITEM_FIELDS[k] ?? humanize(k)))]
  return named.length ? `${name}: ${listWords(named)}` : `${name} changed`
}

/** A list of placed things changed: one added, removed, moved, or changed. */
export function listTitle(a: unknown, b: unknown, noun: string): string {
  const xs = Array.isArray(a) ? a : []
  const ys = Array.isArray(b) ? b : []
  if (ys.length > xs.length) return `${noun} added`
  if (ys.length < xs.length) return `${noun} removed`
  const at = ys.map((_, i) => i).filter((i) => xs[i] !== ys[i])
  if (at.length === 1) return itemTitle(xs[at[0]], ys[at[0]], noun, at[0])
  const ids = (l: unknown[]) => l.map((x) => (isRec(x) ? x.id : undefined))
  const xi = ids(xs)
  const yi = ids(ys)
  if (at.length > 1 && xi.every((id) => id !== undefined) && xi.join() !== yi.join() && [...xi].sort().join() === [...yi].sort().join())
    return `${noun}s reordered`
  return `${noun}s changed`
}

function moduleChange(mod: StackModuleId, cs: Change[]): string {
  const title = MODULE_BY_ID[mod].title
  // Touching a control of a switched-off module switches it on too: name the control.
  const real = cs.filter((c) => !c.toggle && !(SWITCHES.has(c.key) && cs.length > 1))
  if (real.length === 0) {
    const sw = cs.find((c) => c.toggle || SWITCHES.has(c.key))
    return sw ? `${title} ${onOff(sw.b)}` : title
  }
  if (real.length > 1) return fieldTitle(mod, ...real.map((c) => c.key))
  const c = real[0]
  // Objects that are one setting (the film stock, a colour choice) are named by their own key.
  if (isRec(c.a) && isRec(c.b) && !FIELDS[mod]?.[c.key]) {
    // A module kept as one object (lens, dither, streaks, grade…): name the setting in it.
    const keys = changedKeys(c.a, c.b)
    const settings = keys.filter((k) => !(SWITCHES.has(k) && keys.length > 1))
    if (settings.length === 1) {
      const k = settings[0]
      if (SWITCHES.has(k)) return `${title} ${onOff(c.b[k])}`
      // Recolour's list is `items` too: its things are parts, not repeats.
      if (LISTS[k]) return listTitle(c.a[k], c.b[k], mod === 'recolour' && k === 'items' ? 'Part' : LISTS[k])
      return fieldTitle(mod, k)
    }
    // Several things in it: name them, unless one is a list of placed things.
    if (settings.length > 1 && !settings.some((k) => LISTS[k])) return fieldTitle(mod, ...settings)
    return title
  }
  return fieldTitle(mod, c.key)
}

const joinTitles = (ts: string[]) =>
  ts.length === 2 ? `${ts[0]} and ${ts[1].toLowerCase()}` : `${ts[0]} and ${ts.length - 1} more`

/**
 * A step named from what changed between the states before and after it:
 * the module and the setting ("Grain: strength", "Shadows"), a module
 * switched ("Lens off"), or a placed thing ("Streak 2 moved", "Mask added").
 * Empty if nothing did.
 */
export function changeTitle(a: EditState, b: EditState): string {
  if (a.source !== b.source) return 'Grain plate'
  if (a.blend !== b.blend) {
    const cs = changes(a.blend as unknown as Rec, b.blend as unknown as Rec)
    const areas = [...new Set(cs.map((c) => c.area))]
    if (areas.length === 0) return ''
    if (areas.length > 1) return joinTitles(areas.map((x) => areaTitle(x, [])))
    return areaTitle(areas[0], cs)
  }
  if (a.output !== b.output) return outputTitle(a.output, b.output)
  if (a.look !== b.look || a.presetId !== b.presetId) return 'Recipe'
  return ''
}

/** What an export setting change was: "Export format: PNG", "Export size", "Export quality". */
function outputTitle(a: EditState['output'], b: EditState['output']): string {
  const names: string[] = []
  if (a.format !== b.format) names.push(`Export format: ${b.format === 'match' ? 'as the photo' : b.format === 'webp' ? 'WebP' : b.format.toUpperCase()}`)
  if (a.shape !== b.shape || a.longEdge !== b.longEdge) names.push('Export size')
  if (a.jpegQuality !== b.jpegQuality) names.push('Export quality')
  if (a.suffix !== b.suffix) names.push('Export name')
  return names.length === 1 ? names[0] : 'Export settings'
}

function areaTitle(area: string, cs: Change[]): string {
  if (area === 'masks') return cs.length ? listTitle(cs[0].a, cs[0].b, 'Mask') : 'Masks'
  if (area === 'maskUse') {
    if (cs.length && isRec(cs[0].a ?? {}) && isRec(cs[0].b ?? {})) {
      const keys = changedKeys((cs[0].a ?? {}) as Rec, (cs[0].b ?? {}) as Rec)
      if (keys.length === 1) return `${moduleTitle(keys[0])} mask`
    }
    return 'Section masks'
  }
  if (area === 'keys') return cs.length === 1 ? `Recipe strength: ${KEY_NAMES[cs[0].key] ?? humanize(cs[0].key)}` : 'Recipe strength'
  if (area === 'shapes') return 'Shape placement'
  if (!isStackModule(area)) return cap(humanize(area))
  return cs.length ? moduleChange(area, cs) : MODULE_BY_ID[area].title
}
