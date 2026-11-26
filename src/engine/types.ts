import { DEFAULT_CROP, type CropParams } from './crop'
import { DEFAULT_REPEAT_MODULE, type RepeatModule } from './repeatParams'
import type { KaleidoParams } from './kaleido'
import type { SurfaceParams } from './surface'
import type { RecolourModule } from './recolour'
import type { LightingParams } from './lighting'
import type { ColourBlob } from './blobs'
import type { ColourPick } from './colourPicks'
import type { Harmony } from './harmony'
import type { ColourRule } from './recipe'
import { FLAT_CURVE, type GrainCurve } from './curve'
import { DEFAULT_BASE, type BaseParams } from './base'
import { DEFAULT_DOUBLE, DEFAULT_HALFTONE, DEFAULT_LENS, DEFAULT_MONO, DEFAULT_PRISM, DEFAULT_STAMP, type DoubleParams, type HalftoneParams, type LensParams, type MonoParams, type PrismParams, type StampParams } from './extras'
import { DEFAULT_DEFECTS, type DefectParams } from '../sources/defects'

/**
 * Engine-level types. This module knows nothing about React, the DOM beyond
 * canvas/texture primitives, IndexedDB, or where grain textures come from.
 */

export type BlendMode = 'overlay' | 'softLight' | 'linearLight'

export type ColorSpace = 'linear' | 'srgb'

export type PlateNormalise = 'off' | 'centre' | 'match'

/**
 * How the plate is read when it does not land one texel per pixel.
 *
 * 'smooth' interpolates, which averages neighbouring grains and costs about a
 * third of the contrast the moment the scale is anything but exactly 1.
 * 'crisp' snaps each read to a whole plate texel, so scale changes the size of
 * the grain without changing how strong it is.
 */
export type PlateSampling = 'smooth' | 'crisp'

/**
 * What the response curve is read against.
 *
 * 'luminance' scales all three channels by one curve of overall brightness,
 * which is why grain treated that way reads as a layer sitting on top: it is
 * the same everywhere the picture is the same brightness, regardless of what
 * colour it is.
 *
 * 'channel' reads the curve separately for each channel against that channel's
 * own value, which is how film works — three dye layers, each with its own
 * response. Measured on a colour negative reference, the channels' grain peaked
 * at 0.19 (blue), 0.31 (green) and 0.56 (red) of their own densities. The grain
 * then follows the picture's colour rather than lying across it.
 */
export type ResponseMode = 'luminance' | 'channel'

/** Contrast that 'match' normalises a plate to, in 0..1 units. */
export const REFERENCE_PLATE_SD = 0.075

/** How the grain texture is repeated across the base image. */
export type TilingMode = 'repeat' | 'mirror' | 'stochastic'

/**
 * The complete description of a grain render. This is the only thing that
 * changes between preview, single export and batch export — the code path
 * behind it is identical.
 */
/**
 * Light-transport effects that happen to the image itself, before and after the
 * grain. These are the things a raw editor cannot do: they depend on light
 * moving sideways through the emulsion and the lens, not on a per-pixel curve.
 *
 * All of them run in linear light, because that is where scattering, halation
 * and exposure actually behave linearly.
 */
/**
 * Surge marks: bands where the film developed harder than its surroundings.
 *
 * Developer flowing unevenly across the emulsion — usually from too little
 * agitation, or from flow past the sprocket holes — leaves streaks that
 * developed further than the film around them. They read as bands of heavier,
 * coarser grain rather than as a brightness change, they drift rather than
 * running straight, and they characteristically fade in along their length and
 * then stop.
 *
 * This modulates the grain, which is what separates it from a scanner artefact.
 */
export interface SurgeParams {
  strength: number
  /** How many bands. */
  count: number
  /** Band width as a fraction of the frame's short side. */
  width: number
  /** Direction the bands run, in degrees. */
  angle: number
  seed: number
}

export const DEFAULT_SURGE: SurgeParams = {
  strength: 0,
  count: 3,
  width: 0.06,
  angle: 90,
  seed: 1,
}

/** An sRGB colour, each channel 0..1. */
export type Rgb = [number, number, number]

/**
 * Where a colour in a look comes from. `manual` uses the stored colour; the
 * others are read from the photo being rendered (engine/palette.ts), so one
 * look takes its glow from an orange sunset and a blue dusk alike. The stored
 * colour is kept either way, so switching back to manual loses nothing.
 */
export type ColourSource = 'manual' | 'light' | 'shadow' | 'accent' | 'vivid'

export interface ColourChoice {
  source: ColourSource
  colour: Rgb
  /**
   * Saturation applied to a colour read from the photo, 0..1.5; 1 as read.
   * Photo colours come out at full saturation, which for a look that wants
   * the photo's hue at a muted strength — a print, not neon — is too much.
   */
  saturation?: number
}

export type LeakKind = 'light' | 'burn'

/**
 * One leak or burn, placed on the print. Position is a fraction of the print's
 * width and height (a little outside 0..1 is allowed: leaks usually enter from
 * beyond the edge); size is in units of the short side, so the same spot is the
 * same shape at any resolution.
 */
export interface LeakSpot {
  x: number
  y: number
  /** Radius across the spot, as a fraction of the short side. */
  size: number
  /** Length along the spot's axis relative to its width, 1 = round. */
  stretch: number
  /** Direction of the long axis, degrees. */
  angle: number
  strength: number
  kind: LeakKind
  /** This spot's own colour; unset uses the leaks' colour. Ignored for burns. */
  colour?: ColourChoice
  /**
   * A shape leak: a closed smooth outline through these points (print
   * fractions, like x and y) marking the area the leak happens in, instead of
   * an ellipse. Inside it the leak behaves like any other — noise-broken edge,
   * hot core where the area is deepest, uneven patches — so the outline says
   * where, not exactly what. x, y, size, stretch and angle are unused.
   */
  outline?: { x: number; y: number }[]
  /** Varies a shape's edge and patches; reroll for a different take on the same area. */
  seed?: number
  /**
   * A shape's breakup, 0..1: at 0 it is an even glow filling exactly the
   * outline, soft only at its edge, brightest well inside; at 1 (and unset,
   * as shapes always were) the noise-broken edge, hot patches and streaks of
   * a real leak, so the outline says roughly where. Between, a mix.
   */
  texture?: number
  /** A shape's soft edge, as a fraction of the print's short side (unset: 0.03). */
  edge?: number
  /**
   * The outline is straight lines between its points, as masks' and
   * streaks' are, edited with the same tools. Unset (shapes from before):
   * a smooth curve through a few points, made into a dense straight-sided
   * one when first edited (see roundedOutline).
   */
  polygon?: boolean
  /**
   * Drawn as a smooth curve through the points rather than straight lines
   * between them. Shapes from before (no `polygon`) are always rounded.
   */
  rounded?: boolean
  /**
   * A light: shaped by a mask (its id in BlendParams.effects.masks), so it is
   * drawn, traced, keyed, feathered and grown like any mask, and lights
   * exactly what the mask covers — a key makes it light only the brighter or
   * darker parts of what it is drawn round. x, y, size and stretch are
   * unused; `angle` is the direction the light comes from (degrees, 0 from
   * the right, -90 from the top), used with `falloff`.
   */
  mask?: string
  /** With `mask`: lights a glow round the mask, this far out (short-side fraction), not the mask itself. */
  glow?: number
  /**
   * How much a shape (or a light) fades across itself away from `angle`, the
   * direction the light comes from (degrees: 0 from the right, -90 from the
   * top), 0 (even) .. 1 (to nothing).
   */
  falloff?: number
  /**
   * A tone key, as a mask's: within the shape, only the photo's pixels
   * darker (or lighter) than keyLevel are lit, so a loose outline lights
   * just the leaves, not the sky between them, or the reverse.
   */
  key?: 'off' | 'darker' | 'lighter'
  keyOn?: 'brightness' | 'blue'
  keyLevel?: number
  keySoftness?: number
  /**
   * Set only on lights from Lighting, as the engine draws them with the
   * leaks (engine/lighting.ts): they leave the grain alone, and `tint` only
   * colours what is there.
   */
  lightMode?: 'add' | 'tint'
  /** A light from Lighting kept behind (or only inside) a mask, and behind the streaks. */
  hold?: { mask?: string; inside?: boolean; behindStreaks?: boolean }
}

export const MAX_LEAK_SPOTS = 8

/**
 * Light leaks and burns: patches of colour where light got past the camera
 * back, or dark smoky edges where film was fogged and over-developed.
 *
 * Built as exposure, so they sit under the grain and colour the grain that
 * lands on them; the grain is also pushed harder inside them, which is what
 * makes a leaked corner read as a different part of the film rather than a
 * gradient laid on top.
 */
export interface LeakParams {
  amount: number
  /** Colour of light leaks; burns are always a smoky red-brown. */
  colour: ColourChoice
  spots: LeakSpot[]
  /** Varies the noise that breaks up each spot's outline. */
  seed: number
  /**
   * The leak style the spots were generated from (engine/leakStyles.ts), and
   * the seed that placed them. Adding spots or randomising keeps to the style,
   * so a look keeps its kind of leak while the exact leaks vary.
   */
  style: string
  layoutSeed: number
}

export const LEAK_COLOURS: { id: string; label: string; colour: Rgb }[] = [
  { id: 'warm', label: 'Warm', colour: [1, 0.6, 0.3] },
  { id: 'red', label: 'Red', colour: [1, 0.3, 0.2] },
  { id: 'violet', label: 'Violet', colour: [0.85, 0.5, 1] },
]

export const DEFAULT_LEAKS: LeakParams = {
  amount: 0,
  colour: { source: 'manual', colour: LEAK_COLOURS[0].colour },
  spots: [{ x: 1.02, y: 0.18, size: 0.45, stretch: 1.9, angle: 90, strength: 1, kind: 'light' }],
  seed: 3,
  style: 'corner',
  layoutSeed: 1,
}

/**
 * Colour on top of whatever the photo already has. Every control starts at
 * zero, so a look built from these augments the edit rather than replacing it.
 */
export interface GradeParams {
  /**
   * How much colour, -1..1, on everything the colour module has made (the
   * palette included): above 0 the muted colours gain most; below 0 the
   * dullest lose most and the most vivid least, so the strongest still
   * stand out.
   */
  vibrance: number
  /** Blue to amber, -1..1, on everything the colour module has made. */
  warmth: number
  /** Green to magenta, -1..1, on everything the colour module has made. */
  tint: number
  shadowTint: ColourChoice
  shadowAmount: number
  highlightTint: ColourChoice
  highlightAmount: number
  /**
   * Gradient map: recolour the picture through three colours by brightness —
   * shadows, midtones, highlights — keeping its own brightness, so the tones
   * stay and only the colour is replaced. A graphic, duotone/tritone look.
   */
  mapAmount: number
  mapShadow: ColourChoice
  mapMid: ColourChoice
  mapHigh: ColourChoice
  /**
   * The map's own contrast, -1..1, about the middle of the photo's range:
   * above 0 the tones it hands back are pulled apart, below 0 drawn together.
   * Fades with the map's amount.
   */
  mapContrast: number
  /** Where the midtone colour sits, -1..1: toward the shadows (-) or the light (+). */
  mapBalance: number
  /** How the palette wheel ties the three colours' hues together. Only the wheel reads it. */
  mapHarmony: Harmony
  /** Colour blobs (experiment): see blobs.ts. Empty is off. */
  blobs: ColourBlob[]
  /** Isolate colour: everything but this hue loses its saturation. */
  isolateAmount: number
  isolateColour: ColourChoice
  /** How wide a band of hues around it is kept, 0..1. */
  isolateWidth: number
  /**
   * Recolour the kept colour — the one that pops — toward this colour, 0..1.
   * Its hue changes; its own brightness and depth of colour stay. A grey pop
   * colour turns it grey.
   */
  popAmount: number
  popColour: ColourChoice
  /**
   * Shield the standout colour from the gradient map, 0..1: at 1 it keeps its
   * own (or its Becomes) colour while the map recolours everything else.
   */
  popKeep: number
  /**
   * The colour the rest goes to as it loses saturation: neutral grey is plain
   * graphite, a blue is silver-blue, a teal a cyanotype. Its brightness is
   * ignored; only its hue and depth tint the greys.
   */
  restColour: ColourChoice
  /**
   * A colour recipe's rule: when set, the palette's three colours are built
   * from each photo's own colours at render time (see recipe.ts), and the
   * stored map colours are only what they came to on the photo last edited.
   */
  recipe?: ColourRule
  /** Colours picked from the photo, each kept, changed or greyed (colourPicks.ts); none when unset. */
  picks?: ColourPick[]
}

export const DEFAULT_GRADE: GradeParams = {
  vibrance: 0,
  warmth: 0,
  tint: 0,
  shadowTint: { source: 'manual', colour: [0.35, 0.3, 0.75] },
  shadowAmount: 0,
  highlightTint: { source: 'light', colour: [1, 0.75, 0.45] },
  highlightAmount: 0,
  mapAmount: 0,
  mapShadow: { source: 'manual', colour: [0.08, 0.1, 0.32] },
  mapMid: { source: 'manual', colour: [0.78, 0.3, 0.45] },
  mapHigh: { source: 'manual', colour: [1, 0.78, 0.45] },
  mapContrast: 0,
  mapBalance: 0,
  mapHarmony: 'complementary',
  blobs: [],
  isolateAmount: 0,
  isolateColour: { source: 'accent', colour: [1, 0.5, 0.2] },
  isolateWidth: 0.35,
  popAmount: 0,
  popKeep: 0,
  popColour: { source: 'manual', colour: [1, 0.45, 0.15] },
  restColour: { source: 'manual', colour: [0.5, 0.5, 0.5] },
}

/**
 * The key controls: a handful of dials over the whole look. Each scales a group
 * of the look's own settings, so "Glow 150%" means this look's halation, edge
 * glow and crunch, half as strong again — whatever they were set to. 1 is the
 * look as designed. `look` scales every group at once.
 */
export interface KeyControls {
  look: number
  grain: number
  colour: number
  glow: number
  leaks: number
  wash: number
}

export const DEFAULT_KEYS: KeyControls = { look: 1, grain: 1, colour: 1, glow: 1, leaks: 1, wash: 1 }

/**
 * Each module can be switched off without losing its settings: off renders as
 * though every control in it were at zero, and switching it back on restores
 * exactly what was there. Stored in presets, and resolved inside the engine
 * like the key controls, so export and batch honour it too.
 */
export interface ModuleToggles {
  grain: boolean
  colour: boolean
  tone: boolean
  light: boolean
  /** Edge glow and crunch: light along edges. */
  edges: boolean
  /** Solarize and the halo lines that go with it. */
  solarize: boolean
  leaks: boolean
  border: boolean
  defects: boolean
  surge: boolean
}

export const DEFAULT_MODULES: ModuleToggles = {
  grain: true,
  colour: true,
  tone: true,
  light: true,
  edges: true,
  solarize: true,
  leaks: true,
  border: true,
  defects: true,
  surge: true,
}

/** A colour stock from engine/stocks.ts, and how far to apply it. */
export interface StockParams {
  id: string
  strength: number
  /**
   * 0 lets the stock re-grade tones too; 1 keeps the photo's own brightness
   * everywhere and takes only the stock's colour — hue and saturation on top
   * of the edit you already made.
   */
  keepTone: number
}

export const DEFAULT_STOCK: StockParams = { id: 'none', strength: 1, keepTone: 0 }

/**
 * A streak: a shape whose inside is filled by dragging the colours at its
 * entering edge across it, in one direction — the smear a sensor or scanner
 * leaves when it runs out of picture. Draw it past the frame edge to streak
 * off the image, or round a subject to stretch the subject into a streak.
 */
export interface StreakShape {
  /** Closed outline, fractions of the photo (not the print: a border does not move it). */
  outline: { x: number; y: number }[]
  /** Direction the colours are dragged, degrees (0 = rightward, 90 = down). Unused with a path. */
  angle: number
  /**
   * A drawn path the streaks flow along, fractions of the photo, from its first
   * point to its last. The streak lines run parallel to it, bending where it
   * bends. Null: straight, along `angle`.
   */
  path: { x: number; y: number }[] | null
  /**
   * Perspective, without a path: the streak lines all run through one
   * vanishing point on the line along `angle` through the shape's middle,
   * 1/converge photo short sides away — ahead (positive: the lines close in
   * along the flow, as a building's sides do going up) or behind (negative:
   * they spread out). 0 is parallel.
   */
  converge: number
  /**
   * Radial, without a path: the lines run out from the shape's middle in
   * every direction, like spokes, and the bars are wedges that widen as they
   * go, each the colour where its spoke leaves (a trail) or enters (a fill)
   * the shape. Round a circle, a burst. Bars are fitted to a whole number
   * round it so the ring has no seam; `angle` turns where it closes.
   */
  radial: boolean
  /**
   * Radial only: the shape is a true circle round the outline's middle, this
   * radius (fraction of the short side), instead of the outline drawn — so
   * the edge the spokes read need not be traced exactly. 0: the outline.
   */
  radialRadius: number
  /**
   * Radial only: the bars run round the middle instead of out from it —
   * arcs orbiting it in rings stacked outward from the edge, each starting
   * at its own place on the edge with the subject's texture there, sweeping
   * round for the streak's length.
   */
  radialAround: boolean
  /** Radial only: the middle the lines run out from (or round), as the outline is placed; null: the middle of the outline. */
  radialCentre: { x: number; y: number } | null
  /** Radial Around: how far out past the edge the rings reach, fraction of the short side; 0: out to the outline drawn (with a Circle), else no end. */
  radialReach: number
  /**
   * How far a path's tight bends are eased, 0..1: at 1 until none is tighter
   * than the streak reaches on its inside, so no line folds and every bar
   * keeps its shape; at 0 the curve exactly as drawn, folding where it must.
   */
  pathEase: number
  /**
   * With a path: how far either side of it the bars reach, a fraction of the
   * short side, in whole bars. Past it there are none, so the streak's side
   * ends along one of its own lines, a curve, rather than cut across by the
   * outline. 0: out to the outline.
   */
  pathWidth: number
  /**
   * A trail's end line, drawn across it, fractions of the photo: each bar
   * runs from where it leaves the shape to where its line meets this, times
   * its share between Shortest and Longest, instead of a set Length. Null:
   * Length decides.
   */
  ends: { x: number; y: number }[] | null
  /** Bar thickness, fraction of the short side. */
  band: number
  /**
   * The colour lines' thinnest and thickest, fractions of the short side.
   * Each line across the flow normally takes its own colour from the edge,
   * so the edge's every detail (needles, leaves) is a line a pixel or two
   * wide. Above 0, the lines are grouped into stripes between these widths,
   * each reading the edge around where its middle line meets it.
   * 0 (both): every line its own.
   */
  stripeMin: number
  stripeMax: number
  /**
   * How much of the edge's fine detail each colour stripe keeps, 0–1: the
   * stripe reads a slice of the edge this share of its width, spread across
   * it, so the needles stay but come out wider. 0: each stripe one colour.
   */
  stripeTexture: number
  /** How uneven the bars' widths are, 0..0.95: each edge between bars moved by up to half this share of Band either way. 0: all Band wide. */
  barVary: number
  /**
   * Mirrored: either side of a middle line along the flow the bars are the
   * same the other way round, their widths, lengths and end cuts, so the
   * streak is symmetrical about it (its colours are still the photo's
   * under each bar). mirrorAt is a point the line runs through, fractions
   * of the photo (null: the middle of the outline); mirrorVary how far each
   * side goes its own way, 0 an exact mirror, 1 none.
   */
  mirror?: boolean
  mirrorAt?: { x: number; y: number } | null
  mirrorVary?: number
  seed: number
  /**
   * fill: colour from the edge each line enters the shape by, dragged along
   * the line — across the inside, and past the far edge too unless clipped.
   * trail: colour from the edge each line leaves the shape by, smeared out
   * beyond it — a subject pulled into a streak; the shape itself is kept.
   * mask: no streak of its own; every streak is held off its inside, so an
   * object drawn round stays in front of the smear.
   */
  mode: 'fill' | 'trail' | 'mask'
  /** Fill only: keep the streak inside the outline. Off, it runs on past the far edge for its length. */
  clip: boolean
  /**
   * How a clipped fill measures its bars. across: Shortest and Longest are
   * shares of the way across the shape, each bar measured along its own
   * centre line. distance: they are shares of Length, as for a trail or an
   * unclipped fill.
   */
  measure: 'across' | 'distance'
  /** A streak's full length, fraction of the short side (trails, unclipped fills, measure 'distance'). */
  length: number
  /** Shortest and longest bar, as shares of the full length. Each bar picks its own between them. */
  lengthMin: number
  lengthMax: number
  /**
   * How independently the bars pick their lengths: 0 neighbours follow one
   * slow wave, a smooth skyline; 1 every bar on its own.
   */
  variation: number
  /**
   * Where a clipped fill's bars are fixed. edge: they grow from the colour
   * edge and stop short of the far side. far: they hang from the far side
   * and stop short of the colour edge. Trails and unclipped fills always
   * grow from the colour edge.
   */
  anchor: 'edge' | 'far'
  /** The cut across each bar's end, degrees from square (0 = straight across). */
  tipAngle: number
  /** Each bar's cut turns by up to this much either way, degrees. */
  tipRange: number
  /**
   * The outline's soft edge, fraction of the short side: the streak (or a
   * mask's hold-out) eases in over this distance, placed by `featherAt`.
   */
  feather: number
  /** How far each bar's end fades out, fraction of the short side; apart from the outline's feather. */
  endSoftness: number
  /**
   * The streak's tone along each bar, from where the bar takes its colour
   * (start) to where it ends (end): brightness in stops, contrast about
   * mid-grey (-1..1), opacity (0..1). The start's values hold until
   * `changeAt` (a share of the bar), then ease to the end's over
   * `changeLength` (0 a sudden step).
   */
  brightness: number
  contrast: number
  opacity: number
  endBrightness: number
  endContrast: number
  endOpacity: number
  changeAt: number
  changeLength: number
  /**
   * Where the soft edge sits: inside the outline (the streak eases in from
   * it), centred on it, or outside it (the streak is solid to the line and
   * fades out past it). For masks the same, for what they hold off.
   */
  featherAt: 'inside' | 'centre' | 'outside'
  /**
   * How the soft edge is made. smooth: the streak and the photo are mixed.
   * grain: each pixel is one or the other, dissolved through a grain
   * pattern — no in-between tones for a gradient map to colour.
   */
  featherEdge: 'smooth' | 'grain'
  /**
   * Where the colour is read, moved along the streak from the edge it enters
   * by (fill) or leaves by (trail), fraction of the short side. The shape
   * still decides where the streak shows; this decides what it shows.
   */
  pull: number
  /**
   * What each line carries out from its colour edge: the colour there, held
   * along it (colour), or the subject's last stretch behind the edge, copied
   * over and over (repeat), so its windows or bands echo out along the
   * streak. The tone along the bar works on either.
   */
  /** Off: kept as it is, not drawn. Missing: on. */
  enabled?: boolean
  carry?: 'colour' | 'repeat'
  /**
   * Lines laid along the photo's own straight edges (a building's sides),
   * in the frame the outline is in: where they meet sets the streak's angle
   * and perspective, so its bars run up the subject's lines.
   */
  guides?: StreakGuide[]
  /**
   * The lens's bend (engine/lensBend.ts): the streak's lines are worked out
   * as through a perfect lens and bent back as this one bends, so its bars
   * curve as the photo's own straight edges do. 0 or missing: straight.
   */
  bend?: number
  /** How deep a stretch of the subject each copy is, fraction of the short side. */
  repeatLength?: number
  /**
   * The subject's own repeat as Fit to the pattern measured it (one floor
   * of a building), in the same units: Copy length is a whole number of
   * these (Layers), so a copy can take the top few floors, not only one.
   */
  repeatPeriod?: number
  /**
   * In perspective, the copies' own meeting point, moved along the streak's
   * lines from the streak's: a share of the streak's distance to its point,
   * below 0 nearer (the copies shrink faster than the lines close in, as on
   * a building that tapers), above further. Unset or 0: the streak's own.
   * Fit to the pattern measures it from the subject's floors.
   */
  repeatVanish?: number
  /** Every other copy flipped, so the joins between copies meet. */
  repeatMirror?: boolean
  /** Each copy's size against the one before: below 1 they shrink away, above 1 they grow. */
  repeatScale?: number
  /** How strongly the repeated stretch's lines and edges show on the smear, 0..2. Missing: 0.8. */
  repeatDetail?: number
  /** No longer used: each bar's copies set apart from its neighbours' broke the subject's lines into steps. */
  repeatScatter?: number
  /** The length before Extend made the streak run on to the edge; picking another style puts it back. */
  lengthBeforeExtend?: number
  /** While extended (Extend the subject): the settings Extend changed, as they were, for Stop extending to put back. */
  beforeExtend?: Partial<Record<keyof StreakShape, number | string | boolean>>
  /** How far along each bar the copy stays as it is — the subject carried on — before it eases into the streak's colour, 0..1 of the bar. Missing: 0.5. */
  repeatHold?: number
  /** Each copy taken from a stretch further into the subject than the last (four in turn), so the same part is not stacked up again and again. Missing: on. */
  repeatVary?: boolean
  /** How far in from the edge the copied stretch starts, fraction of the short side: past a roof's lip, say. Missing: 0. */
  repeatFrom?: number
  /** Repeat only where this mask covers where a bar takes its colour (the parts of the subject to carry on); elsewhere the streak's colour. Missing: everywhere. */
  repeatMask?: string | null
  /**
   * Bars whose colour would come from under a mask that holds the streaks
   * back (or from inside a streak mask) borrow it from clear bars nearby
   * instead: a subject kept in front of the smear is not smeared behind it
   * as well.
   */
  skipMasked: boolean
  /** Spans of bars given other colours than the ones they would take. */
  fixes: StreakFix[]
  /**
   * This streak's own masks (ids of MaskShape): kept off them ('exclude') or
   * only on them ('only'). Apart from the section's Mask button, which holds
   * every streak back; this one is just for this streak.
   */
  maskIds: string[]
  maskMode: 'off' | 'exclude' | 'only'
  /**
   * Where its bars read their colours, drawn across it (engine/colourLine.ts):
   * each line reads where it crosses this one, exactly there; a line that
   * doesn't cross it reads at its edge. Fractions of the frame shapes are
   * kept in. Missing: at the edge, as the shape decides.
   */
  colourLine?: { x: number; y: number }[] | null
  /**
   * A tone key on where this streak shows: only over the photo's pixels
   * darker (or lighter) than `keyLevel` — streaks over the sky and not the
   * trees in front of it — measured in brightness or blue, as a mask's is.
   */
  key: 'off' | 'darker' | 'lighter'
  keyOn: 'brightness' | 'blue'
  keyLevel: number
  keySoftness: number
  /**
   * Made from a selected subject (Streak a subject): the mask that keeps the
   * subject in front, and how far inside its edge the outline runs, fraction
   * of the short side, so each bar's colour is the subject's own and not the
   * soft rim between it and what is behind. Missing: drawn by hand.
   */
  subject?: { mask: string; inset: number }
}

/** A guide: a line laid along a straight edge in the photo, end to end (see StreakShape.guides). */
export interface StreakGuide {
  a: { x: number; y: number }
  b: { x: number; y: number }
  /** Points placed along the edge, in order, when more than its two ends: they show how the lens bends it. */
  points?: { x: number; y: number }[]
}

/**
 * A colour fix: a span of a streak's bars, dragged across them on the photo,
 * rebuilt from another part of the streak — beside the span, or a part you
 * choose — so it has that part's character: its colours, how often they
 * change from line to line, the texture across each bar. It is put together
 * from runs of a few bars copied out of the source at scattered places,
 * some reversed or a little stretched, so nothing is repeated as a copy.
 * borrow: the source's own colours. colours: its pattern of light and dark,
 * recoloured with chosen colours, darkest to lightest.
 */
/**
 * A fix: a span of a streak's bars, chosen across the flow, and what it
 * changes on them — their colours (copied from another part of the streak,
 * or recoloured in yours) and their tone.
 */
export interface StreakFix {
  /** The span's two ends, fractions of the photo; it covers the whole bars between them, across the flow. */
  a: { x: number; y: number }
  /**
   * How softly its sides fade, across the flow (short-side units, see
   * shapeMeasure), straddling them: its tone eases in, and its colours mix
   * in bar by bar, more of its bars the further in.
   */
  feather: number
  b: { x: number; y: number }
  /** Its colours: kept as the streak has them, copied from another part of it, or recoloured in yours. */
  mode: 'keep' | 'borrow' | 'colours'
  /** Where the colours come from: the bars between these two points (fractions of the photo), or null for beside the span. */
  source: { a: { x: number; y: number }; b: { x: number; y: number } } | null
  /** Beside the span: how far out (each side, as a share of its width) the colours come from. */
  reach: number
  /** Beside the span: from before it (left of the flow), after it, or both. */
  side: 'both' | 'before' | 'after'
  /** Colours: the ones to recolour with, sRGB 0..1. */
  colours: Rgb[]
  /** Take colours from under a mask that holds the streaks back too. Off, those parts of the source are skipped. */
  masked: boolean
  /** How much each run's brightness moves: 0 exact, 1 a lot. */
  variation: number
  /** What its bars carry, over the streak's own Carry: the subject copied (repeat), the streak's colour, or as the streak does. Missing: as the streak does. */
  carry?: 'streak' | 'repeat' | 'colour'
  /** The bars' tone, on top of the streak's own: brightness in stops, contrast, and how much of them shows. */
  brightness: number
  contrast: number
  opacity: number
  seed: number
}

export const MAX_STREAK_FIXES = 8
export const MAX_FIX_COLOURS = 4

export const DEFAULT_STREAK_FIX: Omit<StreakFix, 'a' | 'b' | 'seed'> = {
  mode: 'keep',
  feather: 0,
  source: null,
  reach: 1,
  side: 'both',
  colours: [],
  masked: false,
  variation: 0.2,
  brightness: 0,
  contrast: 0,
  opacity: 1,
}

/** A streak just drawn points up. (STREAK_DEFAULTS.angle stays 0: it fills in old saves that had none.) */
export const NEW_STREAK_ANGLE = -90

/** Everything about a streak but where it is: square, full-length bars, straight. */
export const STREAK_DEFAULTS: Omit<StreakShape, 'outline' | 'mode' | 'seed'> = {
  angle: 0,
  path: null,
  converge: 0,
  radial: false,
  radialRadius: 0,
  radialAround: false,
  radialCentre: null,
  radialReach: 0,
  pathEase: 1,
  pathWidth: 0,
  ends: null,
  band: 0.012,
  stripeMin: 0,
  stripeMax: 0,
  stripeTexture: 0.5,
  barVary: 0,
  clip: true,
  measure: 'across',
  length: 0.4,
  lengthMin: 1,
  lengthMax: 1,
  variation: 1,
  anchor: 'edge',
  tipAngle: 0,
  tipRange: 0,
  feather: 0,
  endSoftness: 0,
  brightness: 0,
  contrast: 0,
  opacity: 1,
  endBrightness: 0,
  endContrast: 0,
  endOpacity: 1,
  changeAt: 0,
  changeLength: 1,
  featherAt: 'inside',
  featherEdge: 'smooth',
  pull: 0,
  skipMasked: true,
  fixes: [],
  maskIds: [],
  maskMode: 'off',
  key: 'off',
  keyOn: 'brightness',
  keyLevel: 0.5,
  keySoftness: 0.08,
}

export interface StreakParams {
  enabled: boolean
  amount: number
  shapes: StreakShape[]
  /**
   * Prism: each bar's red and blue taken from a little to either side of it,
   * as light splits through glass — colour fringes where bars meet. Fraction
   * of the short side between red and blue; 0 off.
   */
  prism?: number
  /** The split's direction against the bars, degrees: 0 across them, 90 along. */
  prismAngle?: number
  /** Light off the bars: their own colour, blurred, added back in light. 0 off. */
  glow?: number
  /** How far that light spreads, fraction of the frame's longest side. */
  glowRadius?: number
  /**
   * The Colour module's grade (its palette, gradient map and stock) on the
   * streaks too; false leaves streaked pixels as the streak made them, so a
   * subject kept out of the grade keeps its own colour in its streaks.
   * Missing: on.
   */
  graded?: boolean
}

export const MAX_STREAKS = 4

/**
 * A mask: a drawn shape that sections of the look can be kept off (or kept
 * to). The shape describes the subject — a bird, a tree — once; each section
 * says which masks apply to it (see SectionMask), so one outline serves them
 * all.
 */
/** A soft ellipse: centre in fractions of the shape frame, radii as shares of its short side. */
export interface RadialMask {
  x: number
  y: number
  /** Radius along `angle`, and across it, shares of the frame's short side. */
  rx: number
  ry: number
  /** Degrees, clockwise from the x axis. */
  angle: number
  /** 0..1: how far in from its edge it fades from full to nothing. */
  soft: number
}

/** A linear fade: full at the start, nothing at the end. Points are fractions of the shape frame. */
export interface GradientMask {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * A subject mask's selection, kept as a grid (see engine/maskRaster.ts): `w`
 * by `h` cells, run-length encoded in `runs`, lying over x, y, width, height
 * in the fractions masks are kept in (the photo).
 */
export interface MaskRaster {
  w: number
  h: number
  runs: string
  x: number
  y: number
  width: number
  height: number
  /**
   * Painted by hand over the selection, cell for cell as `runs`: in, and out.
   * Out always wins. paintSure is simply in. paintIn, painted with "Let the
   * photo decide" on a mask matched to the photo (MaskShape.key), is in where
   * the photo's colours say so.
   */
  paintIn?: string
  paintSure?: string
  paintOut?: string
}

export interface MaskShape {
  id: string
  name: string
  /**
   * Drawn round something (an outline), or made from a few numbers: a soft
   * ellipse or a linear fade. The engine works the made ones out exactly;
   * their outline is only the area they can cover.
   */
  kind?: 'outline' | 'radial' | 'gradient'
  /** A selected subject, kept as the selection itself; its outline is then just its bounds. */
  raster?: MaskRaster
  radial?: RadialMask
  gradient?: GradientMask
  /** Off: kept, but no section or streak uses it. */
  enabled?: boolean
  /** Closed outline, fractions of the photo (not the print); straight lines between the points. */
  outline: { x: number; y: number }[]
  /** Soft edge, fraction of the short side, placed by `featherAt`. */
  feather: number
  featherAt: 'inside' | 'centre' | 'outside'
  /**
   * A tone key: within the outline, only the photo's pixels darker (or
   * lighter) than `keyLevel` count, so the mask takes the subject's own edge
   * — a dark bird against the sky — and the outline can be loose.
   */
  key: 'off' | 'darker' | 'lighter'
  /**
   * What the key measures: brightness, or how blue a pixel is (its blue,
   * 0..1 encoded) — which tells foliage and land from sky when they are as
   * bright as each other: hazy blue sky and sunlit needles can be — or how
   * like `keyColour` it is (keyValue.ts), 0..1: a green tree, a red car.
   * With a colour, lighter keeps what is like it, darker what is not.
   */
  keyOn: 'brightness' | 'blue' | 'colour'
  /** The colour a key on colour compares with (encoded 0..1). */
  keyColour?: Rgb
  /** Where the key cuts, 0..1 (encoded), in what it measures. */
  keyLevel: number
  /** How gradually it cuts, 0..0.5. */
  keySoftness: number
  /**
   * Where the key works: over all of the mask, or only in a band along its
   * edge (`keyBand` wide, a fraction of the short side), the rest solid. At
   * the edge, a rough selection or outline says where the subject is and the
   * photo's own colours say exactly where it ends. Missing: all.
   */
  keyAt?: 'all' | 'edge'
  keyBand?: number
  /** With the key switched off: which side it kept, so switching it back on keeps its settings. */
  keyWas?: 'darker' | 'lighter'
  /**
   * With a key, used by Streaks: how far its edge pixels lose what is behind
   * the subject, 0..1. A needle's edge pixel is partly the sky beside it;
   * kept in front of the streaks, that sky showed as a pale ring. Cleaned,
   * the sky's share of it becomes the streak (see edgeBehind in the shader).
   */
  cleanEdges: number
  /**
   * How far the mask reaches out past what it covers, fraction of the short
   * side: a margin of empty space round the subject (the streaks kept that
   * far off a keyed moon), well past what a feather softens. 0: none.
   */
  grow?: number
  /**
   * What this mask belongs to, when it is something's own (Repeat's piece,
   * a streak's subject, Kaleidoscope's piece, a part Recolour colours): made, changed and removed there, and left out of
   * the Masks list and every module's mask menus.
   */
  owner?: MaskOwner
}

/** The modules that own masks of their own (MaskShape.owner). */
export type MaskOwner = 'repeat' | 'streak' | 'kaleido' | 'recolour'

export const MAX_MASKS = 8

/**
 * Collage: other photos laid into parts of this one — a different sky in
 * each gap between overhead wires, say. A piece is found, not drawn: click a
 * gap and it spreads through what looks like the place clicked, stopping at
 * thin dark lines (wires, branches) and at anything of another colour. Where
 * a wire crosses, each pixel is treated as a mix of the wire and the sky
 * behind it and only the sky part is swapped, so the wire stays crisp and
 * keeps its own soft edge. See engine/collage.ts.
 *
 * Everything here is in fractions of the photo (not the print), and the
 * regions are worked out from the original photo at a fixed working size, so
 * the preview, the Small view and the export all agree.
 */
export interface CollagePiece {
  id: string
  /** The image laid in: an id in the collage library (storage/collageImages.ts). */
  image: string
  /** Places clicked; the piece is every gap any of them reaches. */
  seeds: { x: number; y: number }[]
  /** How far it spreads from the clicked colour, 0..1. */
  tolerance: number
  /** How readily faint, broken lines count as edges, 0..1. */
  seal: number
  /** Softens the piece's edges where they are not a wire, 0..1. */
  soften: number
  /** The image's centre, in photo fractions. */
  x: number
  y: number
  /** The image's width as a fraction of the photo's width. */
  scale: number
  /** The image turned about its centre, degrees clockwise. */
  rotation: number
  flip: boolean
  /** How far its brightness is matched to what it replaces, 0..1. */
  match: number
  /** Brighter or darker than matched, in stops. */
  brightness: number
  opacity: number
  /**
   * How much of the look's own editing (light, tone, colour) the piece takes:
   * 0 keeps the image's own colour, 1 edits it with the photo. Grain, dust
   * and paper go over it either way, so it sits in the same print.
   */
  takeLook: number
  /**
   * How much of the photo's own fine detail stays on the image, well inside
   * the piece, 0..1. At 0 the image is laid in as it is; above, the texture
   * of what it replaces (cloud edges, a gradient's grain) rides on it, as a
   * double exposure would. Next to a wire the photo is always read as a mix
   * of wire and sky, whatever this is, so the wire keeps its edge.
   */
  detail: number
  /**
   * Fill the patches the piece did not spread into but closes round — a
   * gap of blue between clouds, a bright cloud top — unless a line runs
   * through them (a lamp, a cable's end), which stay in front.
   */
  fillHoles: boolean
  /**
   * The image's colour scaled per channel (linear light), luminance kept:
   * Arrange pulls each image toward the set's shared colour by this, so the
   * pieces sit together. Absent: the image's own colour.
   */
  tint?: [number, number, number]
  /**
   * All of this sky: patches of the same sky the area runs into along much
   * of their edge (a bright cloud top beside trees), and specks of it seen
   * through leaves, which no click reaches, are filled too. For laying in a
   * whole sky. (Named for the specks, which came first.)
   */
  throughLeaves?: boolean
  /**
   * How much of the old sky's broad light the image takes on: brighter
   * toward the sun and the horizon, dimmer away, 0..1. The image's own
   * clouds stay; only the photo's large-scale glow is kept.
   */
  keepLight?: number
  /**
   * Lights the rest of the photo with the image's colour, 0..1: a warm sky
   * warms the street under it. For a sky laid in to look like the photo's own.
   */
  relight?: number
  /** Softens the image's own grain and noise, 0..1. */
  smooth?: number
}

/**
 * Arrange: images spread over chosen gaps (cells) by what is in them — tone,
 * warmth, hue — following a direction across the photo, with neighbours
 * blended or set apart, repeats placed differently, and tone and colour
 * evened out. It makes ordinary pieces, which stay editable; the cells and
 * settings are kept so it can be run again.
 */
/** A gap chosen for Arrange: a click in it, the region it belongs to, and the image that region is set to have. */
export interface ArrangeCell {
  x: number
  y: number
  group?: number
  image?: string
}

export interface CollageArrange {
  /**
   * One click inside each gap to fill, photo fractions. Gaps with the same
   * `group` are one region, filled by one image laid across them all (none:
   * a region of its own). `image`: the image that region is to have, in
   * place of one chosen for it (the same on each of its gaps).
   */
  cells: ArrangeCell[]
  /** The library images it may use; empty: all of this photo's. */
  images: string[]
  /** Which way the sequence runs across the photo. */
  flow: 'down' | 'up' | 'right' | 'left' | 'out' | 'in' | 'none'
  /** What the sequence orders the images by. */
  by: 'tone' | 'warmth' | 'hue'
  /** How closely the sequence is followed, 0 (evenly mixed) .. 1 (strict). */
  follow: number
  /** Touching cells: -1 alike (blend) .. 1 different (contrast). */
  neighbours: number
  /** Touching cells may share one image, laid across them as one piece. */
  join: boolean
  /** How far each piece's light is matched to the sky it replaces, 0..1. */
  match: number
  /** Pulls the images' own brightness toward the set's, 0..1. */
  evenTone: number
  /** Pulls the images' colour toward the set's shared colour, 0..1. */
  harmony: number
  /** The images' width as a fraction of the photo's (each grown to cover its cell if needed). */
  size: number
  /** Repeats of an image: a different part of it, some mirrored. */
  vary: boolean
  /** Shuffle: another arrangement with the same settings. */
  seed: number
}

export const DEFAULT_ARRANGE: CollageArrange = {
  cells: [],
  images: [],
  flow: 'down',
  by: 'warmth',
  follow: 0.7,
  neighbours: -0.3,
  join: false,
  match: 1,
  evenTone: 0.4,
  harmony: 0.3,
  size: 0.6,
  vary: true,
  seed: 1,
}

export interface CollageParams {
  enabled: boolean
  /**
   * The photo the pieces were made on (its seed, see photoSeed). Pieces are
   * places in one photo, so on any other — a batch, the next photo opened —
   * they do nothing.
   */
  photo: number
  /**
   * The size a new piece's image starts at, as a fraction of the photo's
   * width: the size last given to a piece (1 until then), so once one looks
   * right the next start identical. Each piece then sizes on its own.
   */
  scale: number
  pieces: CollagePiece[]
  /** Arrange's cells and settings, once used (see CollageArrange). */
  arrange?: CollageArrange
}

export const MAX_COLLAGE_PIECES = 48

export const DEFAULT_COLLAGE_PIECE: Omit<CollagePiece, 'id' | 'image' | 'seeds' | 'x' | 'y' | 'scale'> = {
  rotation: 0,
  tolerance: 0.45,
  seal: 0.5,
  soften: 0,
  flip: false,
  match: 1,
  brightness: 0,
  opacity: 1,
  takeLook: 0,
  detail: 0,
  fillHoles: true,
}

export const DEFAULT_COLLAGE: CollageParams = { enabled: false, photo: 0, scale: 1, pieces: [] }

export const DEFAULT_MASK: Omit<MaskShape, 'id' | 'name' | 'outline'> = {
  feather: 0,
  // Outside: a mask round a subject keeps all of the subject and fades
  // past the line, however small the subject is next to the feather.
  featherAt: 'outside',
  key: 'off',
  keyOn: 'brightness',
  keyLevel: 0.4,
  keySoftness: 0.08,
  cleanEdges: 1,
}

/** The sections a mask can apply to. */
export type MaskSection =
  | 'grain'
  | 'colour'
  | 'tone'
  | 'light'
  | 'leaks'
  | 'streaks'
  | 'glass'
  | 'edges'
  | 'solarize'
  | 'lighting'
  | 'mono'
  | 'dither'
  | 'pixel'
  | 'halftone'
  | 'dust'
  | 'surge'
  | 'repeat'
  | 'kaleido'
/** In the order the shader's uSectionMask holds them: new sections go on the end. */
// Order matters: the shader reads them by index (streaks 5, glass 6, edges 7, solarize 8).
export const MASK_SECTIONS: MaskSection[] = ['grain', 'colour', 'tone', 'light', 'leaks', 'streaks', 'glass', 'edges', 'solarize', 'lighting', 'mono', 'dither', 'pixel', 'halftone', 'dust', 'surge', 'repeat', 'kaleido']

/**
 * Which masks a section uses. exclude: the section leaves the masked area
 * alone. only: the section applies inside the masks and nowhere else.
 */
export interface SectionMask {
  ids: string[]
  mode: 'exclude' | 'only'
}
export const DEFAULT_STREAKS: StreakParams = {
  // Off until switched on or a streak is drawn (drawing one switches it on).
  enabled: false,
  amount: 1,
  shapes: [],
  prism: 0,
  prismAngle: 0,
  glow: 0,
  glowRadius: 0.03,
}

/**
 * Glass: the photo seen through a sheet of patterned glass in front of the
 * lens. Reeded glass is ribs of half-cylinders, each a small lens that
 * squeezes and flips a strip of what is behind; facets are flat-cut prisms,
 * each shifting a strip; ripple is poured glass, a soft wave. Everything on
 * the photo is behind it — the photo, streaks, masks — but not what is on the
 * film or print: grain, leaks, dust, the border.
 */
export interface GlassParams {
  /**
   * The section's switch. Absent (looks from before it had one): on while it
   * has an amount. Set, it stands on its own, so on at amount 0 stays on.
   */
  enabled?: boolean
  /** How strongly the glass bends what is behind it, 0 off. */
  amount: number
  kind: 'reeded' | 'facets' | 'ripple'
  /** Rib (or wave) width, fraction of the short side. */
  width: number
  /** Degrees: 0 upright ribs, 90 level. */
  angle: number
  /** Colour fringes where it bends most: red and blue bent apart, 0..1. */
  dispersion: number
  /** Light and shade along each rib's edges, 0..1. */
  edges: number
}

export const DEFAULT_GLASS: GlassParams = { amount: 0, kind: 'reeded', width: 0.04, angle: 0, dispersion: 0.3, edges: 0.3 }

/** Whether the glass section is switched on. */
export const glassOn = (g: GlassParams | undefined): boolean => !!g && (g.enabled ?? g.amount > 0)

/** How strongly the glass bends, counting its switch: 0 when off. */
export const glassAmount = (g: GlassParams | undefined): number => (g && g.enabled !== false ? g.amount : 0)

export type PaletteId = 'off' | 'photo' | 'gameboy' | 'pico8' | 'cga' | 'onebit' | 'dusk'

/**
 * Pixel art: the frame drawn in blocks, and its colours limited to a palette.
 * Pixelate snaps everything — photo, grain, dither, leaks — to a grid of
 * blocks; the palette maps every block to its nearest palette colour, with an
 * ordered (Bayer) dither between colours so gradients become the classic
 * checker blends of limited-colour art.
 */
export interface PixelArtParams {
  /** Its switch: off keeps the settings. */
  enabled: boolean
  /** Block size in output pixels; 1 is off. */
  pixelate: number
  palette: PaletteId
  /** Colours taken from the photo when palette is 'photo', 2..16. */
  colours: number
  /** How fully the palette replaces the colour, 0..1. */
  amount: number
  /** Ordered dither between palette colours, 0..1. */
  dither: number
  /**
   * Fine lines (wires, branches, edges) kept sharp through the blocks, 0..1:
   * a pixel that differs from its block by more than this allows keeps its
   * own colour, so flat areas go to blocks and lines stay as they are.
   * 0 (or missing): everything in blocks.
   */
  keepLines?: number
}

export const DEFAULT_PIXEL_ART: PixelArtParams = { enabled: false, pixelate: 1, palette: 'off', colours: 6, amount: 1, dither: 0.6 }

export const MAX_PALETTE = 16

export interface DitherParams {
  amount: number
  /** Colour steps per channel, 2..64. Fewer steps, bigger bands. */
  steps: number
  /** How wide the stippled transition between two steps is, 0..2. */
  spread: number
  /**
   * What the bands follow: 0 the picture's brightness (they ring round a
   * bright glow), 1 a direction across the frame (straight steps).
   */
  follow: number
  /**
   * The line the bands run along when they follow a direction, in print
   * fractions: they step from `from` to `to`, and fade out just past `to`.
   * Set by dragging two handles on the photo.
   */
  from: { x: number; y: number }
  to: { x: number; y: number }
  /**
   * Line: straight bands stepping from `from` to `to`. Oval: rings centred on
   * `from`, reaching `to` along one axis and `stretch` times as far across it.
   */
  shape: 'line' | 'oval'
  stretch: number
  /**
   * Guides: soft circles that nudge where the picture's own bands fall
   * without replacing them. A positive strength makes the bands treat the area
   * as brighter (rings shift and centre toward it), negative as darker.
   * Position in print fractions, radius in units of the short side.
   */
  guides: BandGuide[]
  /**
   * Size of each dither dot in output pixels. 1 is a stipple a phone screen
   * and Instagram's compression average away; 2–4 survives both and reads as
   * pixel art.
   */
  pixel: number
  /**
   * With Whole blocks: wires, branches and edges kept sharp through the
   * blocks, 0..1, as Pixel art's keepLines does (a pixel unlike its block
   * keeps its own colour). 0 (or missing): everything in blocks.
   */
  keepLines?: number
  /**
   * With the grain as the pattern and 1 px dots: the dots follow the grain
   * read this many times larger and smoothly, so they gather into soft
   * clumps, as coarse film grain does, instead of single-pixel speckle or the
   * square blocks of a bigger Pixel size. The grain itself is unchanged.
   * 1 (or missing): the grain as it is.
   */
  clumps?: number
  /**
   * Whole blocks: the picture is read once per dot-sized block, so each dot
   * is one solid colour, as pixel art is. Off, a dot's threshold is shared
   * but the picture under it is read pixel by pixel, so a band edge or fine
   * detail can split a dot. Edits from before it was offered have it off.
   */
  blocks?: boolean
  /** grain: the grain decides each dot (a random stipple). ordered: a Bayer matrix — the classic retro checker. */
  pattern: 'grain' | 'ordered'
  /**
   * Keep the pattern to where colours change. Ordered dither over an area
   * that sits flat between two bands is the same 50% checker everywhere — a
   * uniform screen; where the colour is moving it varies and reads as a
   * blend. Toward 1, flat areas snap to a solid band and only the
   * transitions keep the pattern.
   */
  transitionsOnly: number
  /**
   * Leave the standout colour (Colour → Pop) smooth, 0..1: its shading keeps
   * its gradients while the rest of the picture is banded. For a subject —
   * a red chair — that should read as an object, not as contour bands.
   */
  sparePop: number
  /** Dither on or off, keeping its settings. */
  enabled: boolean
  /** Band guides on or off, keeping the guides. */
  guidesOn: boolean
  /** Brightness range the pattern is kept to, 0..1, with soft edges. */
  toneLo: number
  toneHi: number
}

export interface BandGuide {
  x: number
  y: number
  radius: number
  strength: number
}

export const MAX_BAND_GUIDES = 6

export const DEFAULT_DITHER: DitherParams = {
  amount: 0,
  steps: 10,
  spread: 0.6,
  follow: 0,
  from: { x: 0.5, y: 0 },
  to: { x: 0.5, y: 1 },
  shape: 'line',
  stretch: 1.6,
  guides: [],
  pixel: 1,
  blocks: false,
  pattern: 'grain',
  transitionsOnly: 0,
  sparePop: 0,
  enabled: true,
  guidesOn: true,
  toneLo: 0,
  toneHi: 1,
}

export interface EffectParams {
  /** The base photo's corrections, applied before everything (engine/base.ts). Belongs to the photo, not a look. */
  base: BaseParams
  /** Black & white film (engine/extras.ts). */
  mono: MonoParams
  /** Halftone and riso print. */
  halftone: HalftoneParams
  /** A lens in front of the camera. */
  lens: LensParams
  /** A prism in front of the lens: the colours split apart (engine/extras.ts). */
  prism: PrismParams
  /** A second exposure on the same frame. Belongs to the photo, like the collage. */
  double: DoubleParams
  /** The date the camera prints in the corner. */
  stamp: StampParams
  /** Warm glow bleeding out of highlights: light reflecting off the film base
   *  back into the emulsion. Red-dominant because the anti-halation backing
   *  absorbs the shorter wavelengths. */
  halation: number
  /** Neutral glow: lens flare and veiling glare, the same blurred highlights
   *  without the warm cast. */
  bloom: number
  /**
   * Edge glow: light from bright areas spilling a short way into dark
   * neighbours, so a silhouette against a bright sky gets a burning outline.
   * Built from the whole picture rather than from thresholded highlights — an
   * orange sunset sky is nowhere near a highlight, and it is exactly what should
   * burn into the trees.
   */
  rim: number
  /** Edge-glow reach, as a fraction of the frame's longest side. */
  rimRadius: number
  /** Large-radius unsharp mask: punchy local contrast and outlined edges. */
  crunch: number
  /**
   * Mackie lines: the broad pale rim the Sabattier effect leaves where light
   * meets dark — the sky lightening round a treeline. A wide, luminance-only
   * local contrast, so it also darkens the middle of big bright areas.
   */
  halo: number
  /** Halo reach, as a fraction of the frame's longest side. */
  haloRadius: number
  /**
   * Structure: local contrast at texture scale — ripples on water, bark,
   * cloud detail. Brightness only, strongest in the midtones and shadows, so
   * it lifts texture without touching colour or smooth gradients. What keeps
   * mid-sized detail visible after a phone shrinks it and Instagram compresses.
   */
  structure: number
  /** Structure scale, as a fraction of the frame's longest side. */
  structureRadius: number
  /**
   * Sabattier: the brightest tones partly reverse, as when film is fogged by
   * light midway through development — whites go darker in the middle and take
   * on the glow colour.
   */
  solarize: number
  /** Brightness where the reversal begins, 0..1. */
  solarizeFrom: number
  /**
   * Dither: posterise into a few colour steps and let the grain decide which
   * step each pixel takes, so gradients break into stippled bands — pixel-art
   * dithering with the grain as its pattern, at the grain's own size.
   */
  dither: DitherParams
  /** Stylised colour palette. */
  stock: StockParams
  /** Colour on top of the photo's own. */
  grade: GradeParams
  /** Colour of halation and edge glow. */
  glowColour: ColourChoice
  /** Light leaks and edge burns. */
  leaks: LeakParams
  /** Pixelation and palette limits. */
  pixelArt: PixelArtParams
  /** Smeared streaks inside drawn shapes. */
  streaks: StreakParams
  /** Drawn masks, shared by the sections. */
  masks: MaskShape[]
  /** Which masks each section uses; a section absent here is not masked. */
  maskUse: Partial<Record<MaskSection, SectionMask>>
  /**
   * What streak shapes' and masks' fractions are of: 'photo' since shapes
   * stopped moving with the border (1 Nov 2026); 'print' (photo plus border)
   * for anything saved before, which is read as it was drawn rather than
   * shifted by the border. See shapeFrame.
   */
  shapeSpace: 'photo' | 'print'
  /**
   * What streaks' and masks' sizes (bar width, length, feather, reach) are
   * measured in, and where their bars are counted from: the photo's short
   * side from its corner, so a border changes nothing about them (2 Nov
   * 2026); or for anything saved before with a border, the print's from
   * its corner, which is how it was made and how it is kept. See
   * shapeMeasure.
   */
  shapeUnits: 'photo' | 'print'
  /**
   * Only on settings moved onto a crop for drawing (shapesOnCrop), never
   * saved: where the whole photo is on the crop, so streaks (their bars,
   * sizes and lens bend) and mask edges are measured on the whole photo and
   * stay the same wherever the crop is and however it is turned. Its
   * top-left corner (x, y) and middle (cx, cy) in fractions of the cropped
   * photo, its short side (unit) and half-diagonal (r) in the crop's short sides.
   */
  cropFrame?: { x: number; y: number; unit: number; cx: number; cy: number; r: number }
  /** Other photos laid into this one; belongs to the photo, not the look. */
  collage: CollageParams
  glass: GlassParams
  /** Luminance above which highlights start to glow. */
  glowThreshold: number
  /**
   * Halation and bloom turned down on a photo that is mostly highlight, so
   * they don't wash it out (glowFit.ts). Missing on edits made before it
   * existed, which glow as they always did.
   */
  glowFit?: boolean
  /** Glow radius as a fraction of the frame's longest side. */
  glowRadius: number
  /**
   * Exposure in stops, applied to the light before the film's response. Most
   * of the looks this is for are overexposed negatives — pale, washed skies with
   * the grain standing out in them — and that is a push of the exposure into
   * the shoulder, not a brightness slider afterwards.
   */
  exposure: number
  /** Highlight roll-off. Film saturates gradually where a sensor clips. */
  shoulder: number
  /**
   * Shadow lift — the film's toe. A negative always carries base and fog
   * density, so a scan's blacks are never black: measured on the beach
   * reference, its darkest 1% sat at 13 and darkest 5% at 21. That matters for
   * grain as much as for tone — crushed shadows clip the grain's lower half
   * away, so it has nowhere to live.
   */
  fade: number
  /** Corner falloff. */
  vignette: number
  /** Dust, hairs and scratches. See sources/defects.ts. */
  defects: DefectParams
  /** Bands of heavier grain from uneven development. */
  surge: SurgeParams
  /** The part of the photo that is the picture, taken before the edit (see engine/crop.ts). */
  crop: CropParams
  /** Copies of masked pieces of the photo (engine/repeat.ts). Missing in older edits: off. */
  repeat?: RepeatModule
  /** The photo, or a piece of it, copied round a point (engine/kaleido.ts). Missing in older edits: off. */
  kaleido?: KaleidoParams
  /** Parts of the photo in a new colour, or kept as shot (engine/recolour.ts). Missing in older edits: off. */
  recolour?: RecolourModule
  /** Lights drawn on the photo (engine/lighting.ts). Missing: none. */
  lighting?: LightingParams
  /** What the print is on: paper, canvas, an image of your own (engine/surface.ts). Missing in older edits: off. */
  surface?: SurfaceParams
}

export const DEFAULT_EFFECTS: EffectParams = {
  base: DEFAULT_BASE,
  mono: DEFAULT_MONO,
  halftone: DEFAULT_HALFTONE,
  lens: DEFAULT_LENS,
  prism: DEFAULT_PRISM,
  double: DEFAULT_DOUBLE,
  stamp: DEFAULT_STAMP,
  halation: 0,
  bloom: 0,
  rim: 0,
  rimRadius: 0.0025,
  crunch: 0,
  halo: 0,
  haloRadius: 0.035,
  structure: 0,
  structureRadius: 0.008,
  solarize: 0,
  solarizeFrom: 0.72,
  dither: DEFAULT_DITHER,
  stock: DEFAULT_STOCK,
  grade: DEFAULT_GRADE,
  // The photo's own light colour, so an untouched look adds no colour of its own.
  glowColour: { source: 'light', colour: [1, 0.61, 0.38] },
  leaks: DEFAULT_LEAKS,
  pixelArt: DEFAULT_PIXEL_ART,
  streaks: DEFAULT_STREAKS,
  masks: [],
  maskUse: {},
  shapeSpace: 'photo',
  shapeUnits: 'photo',
  collage: DEFAULT_COLLAGE,
  glass: DEFAULT_GLASS,
  glowThreshold: 0.72,
  glowFit: true,
  glowRadius: 0.02,
  exposure: 0,
  shoulder: 0,
  fade: 0,
  vignette: 0,
  defects: DEFAULT_DEFECTS,
  surge: DEFAULT_SURGE,
  crop: DEFAULT_CROP,
  repeat: DEFAULT_REPEAT_MODULE,
}

/**
 * A paper border around the photograph.
 *
 * The border is part of the print, not a frame pasted on afterwards: it is
 * composited before the grain and the defects, so the same emulsion texture and
 * the same dust cross the picture edge onto the paper. A clean border around a
 * grainy photograph reads as a graphic overlay immediately.
 */
export interface BorderParams {
  /** Border width as a fraction of the frame's short side. 0 disables it. */
  width: number
  /** Extra width at the bottom only, the way a print is signed. */
  bottomExtra: number
  /** Paper colour, linear-ish sRGB components 0..1. */
  colour: [number, number, number]
  /** Paper tooth and mottle. */
  texture: number
  /** How uneven the cut between picture and paper is. */
  irregularity: number
  /**
   * How much grain the paper gets, as a multiple of Amount.
   *
   * The response curve is not applied here: it models the film's response to
   * the scene, and the paper is not scene. Left to the curve the border would
   * get whatever the highlights get, which on a bright paper is almost nothing.
   */
  grain: number
  seed: number
  /*
   * The rest are optional: a border saved before them is the paper alone.
   * Lengths are fractions of the photo's short side, as width is.
   */
  /** The paper's colour: flat, or a gradient from colour to colour2, along fillAngle or out from the middle. */
  fill?: 'solid' | 'linear' | 'radial'
  colour2?: [number, number, number]
  /** Degrees, clockwise from rightward: 90 runs top to bottom. */
  fillAngle?: number
  /** Rounded corners on the photo. */
  corner?: number
  /** The photo lifted off the paper: its shadow's darkness 0..1, softness, and how far it falls, which way (degrees, clockwise from rightward). */
  shadow?: number
  shadowSize?: number
  shadowDistance?: number
  shadowAngle?: number
  /** A cut mat's bevel round the photo: its width, and how strongly the light catches it. */
  bevel?: number
  bevelLight?: number
  /** A thin line round the photo: its width (0 is none), its gap from the photo, its colour. */
  line?: number
  lineGap?: number
  lineColour?: [number, number, number]
  /** The photo set into the paper: shade along its inside edge, 0..1. */
  inset?: number
  /** What the paper is made of, for its texture (texture is how strongly it shows). None given is 'paper'. */
  paper?: PaperKind
  /** How the photo's edge meets the paper (irregularity is how much it wanders). None given is 'printed'. */
  edge?: EdgeKind
}

/** The photo's edge: an enlarger's easel (printed), torn, brushed-on emulsion, a filed film carrier's black edge, or deckled. */
export type EdgeKind = 'printed' | 'torn' | 'brush' | 'film' | 'deckle'
export const EDGE_KINDS: EdgeKind[] = ['printed', 'torn', 'brush', 'film', 'deckle']

/** Kinds of paper texture: fibrous print paper, smooth (a glossy print), woven canvas, linen, cold-press watercolour, and card with fibres and specks. */
export type PaperKind = 'paper' | 'smooth' | 'canvas' | 'linen' | 'watercolour' | 'fibre'
export const PAPER_KINDS: PaperKind[] = ['paper', 'smooth', 'canvas', 'linen', 'watercolour', 'fibre']

export const DEFAULT_BORDER: BorderParams = {
  width: 0,
  bottomExtra: 0,
  colour: [0.94, 0.925, 0.895],
  texture: 0.5,
  irregularity: 0.35,
  grain: 0.7,
  seed: 1,
}

/** Size of the finished print, given the photo and the border around it. */
/** The border actually printed: none while the border module is off. */
export function activeBorder(params: Pick<BlendParams, 'border' | 'modules'>): BorderParams {
  return params.modules.border ? params.border : { ...params.border, width: 0, bottomExtra: 0 }
}

/** Size of the print these settings produce from a photo of `base` size. */
export function printSizeOf(base: Size, params: Pick<BlendParams, 'border' | 'modules'>): Size {
  return printSize(base, activeBorder(params))
}

/**
 * Where the photo sits in the print, in print pixels. Streak shapes and masks
 * are placed in fractions of this — of the photo, not the print — so adding or
 * widening a border leaves them on what they were drawn round.
 */
export function photoFrame(base: Size, border: BorderParams): Rect {
  const edge = border.width <= 0 && border.bottomExtra <= 0 ? 0 : Math.round(border.width * Math.min(base.width, base.height))
  return { x: edge, y: edge, width: base.width, height: base.height }
}

/** The photo's frame in the print these settings produce. */
export function photoFrameOf(base: Size, params: Pick<BlendParams, 'border' | 'modules'>): Rect {
  return photoFrame(base, activeBorder(params))
}

/**
 * The rectangle streak shapes and masks are fractions of, in print pixels:
 * the photo, or for an edit saved before shapes were put on the photo, the
 * whole print (see EffectParams.shapeSpace).
 */
export function shapeFrame(base: Size, params: Pick<BlendParams, 'border' | 'modules' | 'effects'>): Rect {
  if (params.effects.shapeSpace === 'print') return { x: 0, y: 0, ...printSizeOf(base, params) }
  return photoFrameOf(base, params)
}

/**
 * The units streaks and masks are measured in, in print pixels: where their
 * origin is and how long one unit is (see EffectParams.shapeUnits). Both
 * the engine and the overlays use it, so the bars drawn are the bars made.
 */
export function shapeMeasure(
  base: Size,
  border: BorderParams,
  units: EffectParams['shapeUnits'],
  cropFrame?: EffectParams['cropFrame'],
): { x: number; y: number; unit: number } {
  if (units === 'print') {
    const print = printSize(base, border)
    return { x: 0, y: 0, unit: Math.min(print.width, print.height) }
  }
  const at = photoFrame(base, border)
  // On a crop: from the whole photo's corner, in its short side (EffectParams.cropFrame).
  if (cropFrame) return { x: at.x + cropFrame.x * base.width, y: at.y + cropFrame.y * base.height, unit: cropFrame.unit * Math.min(base.width, base.height) }
  return { x: at.x, y: at.y, unit: Math.min(base.width, base.height) }
}

export function printSize(base: Size, border: BorderParams): Size {
  if (border.width <= 0 && border.bottomExtra <= 0) return { ...base }
  const short = Math.min(base.width, base.height)
  const edge = Math.round(border.width * short)
  const bottom = Math.round(border.bottomExtra * short)
  return { width: base.width + edge * 2, height: base.height + edge * 2 + bottom }
}

export interface BlendParams {
  blendMode: BlendMode
  /** 0..1 mix between the untouched base and the fully blended result. */
  amount: number
  /** Space the blend math runs in. Grain plates are photographed light, so
   *  'linear' is physically correct; 'srgb' reproduces Photoshop's default. */
  colorSpace: ColorSpace
  tiling: TilingMode
  /** Grain pixels per base pixel. 1 = plate at native resolution. */
  grainScale: number
  /**
   * A photo replaced under its edit with a better copy (App's Replace
   * photo): its pixels per pixel of the photo the edit was made on, so all
   * that is drawn in pixels (grain, dither, pixel art, scan lines, paper
   * texture, dust) stays the size it was. Missing: 1.
   */
  pixelScale?: number
  /** That photo's seed (render.ts photoSeed), so all that varies from photo to photo stays as it was. */
  photoSeed?: number
  /** Degrees. Rotates the grain relative to the image, about its centre. */
  grainRotation: number
  /** 0 = grain forced monochrome, 1 = the source's own colour kept. */
  chroma: number
  /** 0 = grain as sharp as the source, 1 = softened as if slightly defocused. */
  softness: number
  /**
   * What to do about a plate that is not centred on mid-grey.
   *
   * Every blend mode here is neutral at 0.5, so a scan averaging 0.21 (which is
   * entirely normal — it is just how the plate was exposed and scanned) darkens
   * the picture hard rather than adding grain to it. 'centre' re-centres the
   * plate on mid-grey; 'match' also rescales its contrast so Amount means the
   * same thing whichever plate is loaded; 'off' uses the raw values.
   */
  plateNormalise: PlateNormalise
  /**
   * Removes the plate's own low-frequency density variation — scanner falloff,
   * uneven backlight, the density of the negative it came from — which
   * otherwise tiles across the picture as blotches. 0 keeps it, 1 removes it.
   */
  plateFlatten: number
  plateSampling: PlateSampling
  /** Grain strength against base luminance. See engine/curve.ts. */
  response: GrainCurve
  responseMode: ResponseMode
  /**
   * How far apart the three layers' response curves sit, 0..1. At 0 every
   * channel uses the same curve; at 1 they are spread the way the reference
   * measured, blue responding earliest and red latest.
   */
  layerSpread: number
  effects: EffectParams
  border: BorderParams
  /** Dials over the whole look; see KeyControls. */
  keys: KeyControls
  /** Which modules are switched on; see ModuleToggles. */
  modules: ModuleToggles
  /**
   * How much the grain gathers where the colour is: where the look changed
   * the photo's colour, and where the result is richly coloured. 0 is even
   * grain everywhere; toward 1 neutral, untouched areas go quiet and the grain
   * shows through the colour changes, as it does in the references.
   */
  grainFollowsColour: number
  /**
   * Give each photo its own grain pattern, paper imperfections, dust and
   * surges, from a hash of the photo (RenderRequest.imageSeed) mixed with the
   * seeds here. Off, every photo gets the identical pattern.
   */
  varyPerPhoto: boolean
}

export const DEFAULT_BLEND_PARAMS: BlendParams = {
  blendMode: 'overlay',
  amount: 0.5,
  colorSpace: 'linear',
  tiling: 'stochastic',
  grainScale: 1,
  grainRotation: 0,
  chroma: 1,
  softness: 0,
  plateNormalise: 'centre',
  plateFlatten: 0,
  plateSampling: 'crisp',
  response: FLAT_CURVE,
  responseMode: 'luminance',
  layerSpread: 0.6,
  effects: DEFAULT_EFFECTS,
  border: DEFAULT_BORDER,
  keys: DEFAULT_KEYS,
  modules: DEFAULT_MODULES,
  grainFollowsColour: 0,
  varyPerPhoto: true,
}

/** Anything WebGL can upload with texImage2D. */
export type TextureSource = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageData

export interface Size {
  width: number
  height: number
}

/** A rectangle in base-image pixel coordinates. */
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface RenderRequest {
  base: TextureSource
  /** Natural size of `base` in pixels. Needed because ImageData/ImageBitmap
   *  report it differently and the crop math must agree with the caller. */
  baseSize: Size
  grain: TextureSource
  grainSize: Size
  /** Average density of the grain texture, 0..1. Defaults to 0.5. Used by the
   *  stochastic tiler so it recombines copies around the plate's true centre,
   *  and by plate normalisation. */
  grainMean?: number
  /** Standard deviation of the grain texture, 0..1. Defaults to
   *  REFERENCE_PLATE_SD, i.e. "already the right contrast". */
  grainSd?: number
  /** Surface's uploaded image (engine/surface.ts kind 'image'); missing, the engine looks in its own store of them (surfaceImages). */
  surfaceImage?: TextureSource
  params: BlendParams
  /**
   * Region of the base image to render. Defaults to the whole image.
   * The grain is always sampled in base-image space, so a 1:1 crop shows
   * exactly the grain the full-resolution export will contain.
   */
  region?: Rect
  /**
   * Output pixel size. If smaller than `region`, the result is a downsampled
   * view — used by the fit-to-window preview.
   */
  outputSize?: Size
  /**
   * Where `base` sits in the original photo, in fractions of it, when it is a
   * crop (the Instagram size). Collage pieces are worked out on the whole
   * photo and placed through this. Defaults to all of it. `angle`: the crop
   * is of the photo turned this many degrees (engine/crop.ts, cropAngle).
   */
  photoCrop?: Rect & { angle?: number }
  /**
   * A number from the photo itself (see photoSeed), so each photo gets its
   * own random pattern when the look has varyPerPhoto on. Every caller that
   * renders a photo — preview, export, batch — passes the same one for it.
   */
  imageSeed?: number
  /**
   * A quick picture while something is being dragged: what is drawn once for
   * the whole photo (the streaked photo the wide passes blur) is drawn small.
   * The preview follows with a full render once the drag ends.
   */
  draft?: boolean
  /**
   * An open mask shown on the photo, as the preview does while it is being
   * worked on: what it covers, exactly as the modules get it, as a red or
   * green wash with its edge drawn, or the mask alone (white in, black out).
   */
  showMask?: { id: string; view: 'red' | 'green' | 'matte' }
}
