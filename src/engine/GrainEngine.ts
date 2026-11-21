import { colourKeyOf, edgeColours, EDGE_REACH, KEY_BAND } from './maskCover'
import { decodeRaster, rasterKey } from './maskRaster'
import type { EffectParams, LeakSpot, MaskRaster, MaskShape } from './types'
import { composeRepeat } from './repeat'
import { withLighting } from './lighting'
import { unbend } from './lensBend'
import { leanName, leanStreakShader, type LeanKind, type LeanVariant } from './streakLean'
import { distanceTo } from '../ml/trace'
import { BLEND_MODE_BY_ID } from './blendModes'
import { DEVELOP_FRAGMENT, baseActive, toneCurveLut, whiteBalanceGains, CURVE_LUT_SIZE } from './base'
import { maskKind, maskOn, withOutline } from './maskShapes'
import { DOUBLE_FRAGMENT, LENS_FRAGMENT, LENS_K, PRISM_FRAGMENT, PRISM_MAX, doubleOn, drawStamp, lensOn, monoMix, monoTone, prismOn, stampText } from './extras'
import { LUT_SIZE, curveKey, curveToLut } from './curve'
import { CALM_PACK_FRAGMENT, GLOW_BLUR_FRAGMENT, GLOW_THRESHOLD_FRAGMENT, GLOW_VERTEX } from './glow'
import { COLLAGE_FRAGMENT, collageLayers, lookupCollageImage, type CollageLayer } from './collage'
import { defectKey, generateDefectLayer } from '../sources/defects'
import { DEFAULT_GLASS, EDGE_KINDS, PAPER_KINDS, REFERENCE_PLATE_SD, glassAmount } from './types'
import { FRAGMENT_SHADER, FRAGMENT_SHADER_LIGHT, TILING_MIRROR, TILING_REPEAT, TILING_STOCHASTIC, VERTEX_SHADER } from './shaders'
import {
  MAX_BAND_GUIDES,
  MAX_LEAK_SPOTS,
  MAX_PALETTE,
  MAX_STREAKS,
  MAX_STREAK_FIXES,
  MAX_FIX_COLOURS,
  MAX_MASKS,
  MASK_SECTIONS,
  activeBorder,
  photoFrame,
  printSize,
  printSizeOf,
  shapeMeasure,
  type Rect,
  type Rgb,
  type BlendParams,
  type RenderRequest,
  type StreakShape,
  type Size,
  type TextureSource,
  type TilingMode,
} from './types'
import { extractPalette, NEUTRAL_PALETTE, samplePixels, type Palette } from './palette'
import { FIXED_PALETTES, paletteSpacing, photoPalette } from './pixelPalettes'
import { resolveParams, tintOf } from './resolve'
import { MIN_OUTLINE_POINTS, PATH_SAMPLES, SDF_RANGE, isRounded, roundedOutline, samplesPerSpan, sampleOutline, shapeMetrics } from './leaks'
import { MAX_BLOBS } from './blobs'
import { END_SAMPLES, endTable, MAX_CONVERGE, radialCircle, PATH_LEVELS, pathFlow, signedDistance, streakCoords, streakMirrorAt, streakVanish, STREAK_LAYER_SIZE, STREAK_MARCH, STREAK_PATH_SAMPLES } from './streaks'
import { MAX_HUE_MOVES, packHueMoves, stockById } from './stocks'

const TILING_INDEX: Record<TilingMode, number> = {
  repeat: TILING_REPEAT,
  mirror: TILING_MIRROR,
  stochastic: TILING_STOCHASTIC,
}

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas

interface CachedTexture {
  texture: WebGLTexture
  source: unknown
  wrap: number
}

interface RenderTarget {
  texture: WebGLTexture
  framebuffer: WebGLFramebuffer
  width: number
  height: number
}

/**
 * Resolution the glow is computed at, on the longest side. The glow is a wide
 * blur of the highlights, so it carries no detail worth more than this, and
 * keeping it small makes a large radius cheap.
 */
/** Whether any colour in these settings is read from the photo. */
/** Hue of an sRGB colour, 0..1 around the circle. */
function hueOf([r, g, b]: [number, number, number]): number {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d <= 0) return 0
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h / 6
}

function usesPalette(p: BlendParams): boolean {
  const fx = p.effects
  const g = fx.grade
  // The gradient map always reads the photo, for its tonal range.
  if (g.mapAmount > 0 || g.blobs.length > 0) return true
  const colours = [
    fx.glowColour,
    fx.leaks.colour,
    g.shadowTint,
    g.highlightTint,
    g.mapShadow,
    g.mapMid,
    g.mapHigh,
    g.isolateColour,
    g.popColour,
    g.restColour,
  ]
  for (const spot of fx.leaks.spots) if (spot.colour) colours.push(spot.colour)
  return colours.some((c) => c.source !== 'manual')
}

/** A whole-frame working size with the given long side, keeping aspect. */
function workingSize(base: Size, longSide: number): Size {
  const aspect = base.width / base.height
  return {
    width: Math.max(8, Math.round(aspect >= 1 ? longSide : longSide * aspect)),
    height: Math.max(8, Math.round(aspect >= 1 ? longSide / aspect : longSide)),
  }
}

const GLOW_SIZE = 320
/**
 * Working resolution of the detail pass behind edge glow and crunch. Both work
 * at a few pixels' reach, so this needs to be much finer than the glow; it is
 * still fixed per frame, never per crop, so the preview matches the export.
 */
const DETAIL_SIZE = 1024
/** The streaked photo's long side in a draft (see RenderRequest.draft). */
const DRAFT_PASS_SIZE = 320
/**
 * Largest render, in pixels, whose streaks are kept for the next (see
 * cacheStreaks): a view, not an export, which renders once.
 */
const STREAK_CACHE_MAX_PX = 4096 * 2304
/** Pixels per strip of a pass with the streak search (see drawStrips): some tens of milliseconds of GPU each. */
const STRIP_PX = 120_000
/** How many render sizes keep their streaks: the view, a draft, the loupe, a small render. */
const STREAK_CACHE_SLOTS = 4
/**
 * Graphics memory the streak caches may hold between them (32 bytes a
 * pixel): a few views' sizes, while a large one takes the room of several.
 * Laptops share their graphics memory with everything else.
 */
const STREAK_CACHE_BUDGET = 320 * 1024 * 1024
/**
 * One band of an export's streaks, in pixels with its margins: its cache
 * and the lean draws' targets (80 bytes a pixel between them) are held for
 * a band at a time and freed after the export.
 */
const STREAK_TILE_PX = 2048 * 2048
/** The halo's reach is a few percent of the frame, so a coarse blur is plenty. */
const HALO_SIZE = 512

function createCanvas(width: number, height: number): AnyCanvas {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = width
    c.height = height
    return c
  }
  return new OffscreenCanvas(width, height)
}

/**
 * The single blend implementation in the app.
 *
 * It knows about WebGL and nothing else — no React, no IndexedDB, no file
 * pickers, no notion of "preview" vs "export". Callers differ only in the
 * `region` and `outputSize` they ask for, which is what guarantees the export
 * matches what the preview showed.
 */
/** A texture array of shapes, one layer per shape, and what each layer was drawn from. */
interface LayerStore {
  texture: WebGLTexture | null
  depth: number
  /** Each layer's side, texels (see layerSide). */
  size?: number
  keys: string[]
  unit: number
  /** Per layer drawn as a distance field: the deepest point inside, in its units (see LayerShape.sdf). */
  deepest?: number[]
}

/** What a layer is drawn from. Streak modes also get the near-edge channel. */
interface LayerShape {
  outline: { x: number; y: number }[]
  feather: number
  mode?: 'fill' | 'trail' | 'mask'
  trailLength?: number
  /**
   * A keyed mask under a collage: what its key measures (brightness, or
   * blue) in the photo as it was, before the collage, kept in the layer's
   * blue. A sky laid in is not what the key was set against: read from the
   * collaged photo, a darker new sky passed for the subject.
   */
  keyOn?: 'brightness' | 'blue'
  /**
   * A leak shape: drawn as a signed distance field instead (r high, g low
   * byte; -SDF_RANGE..SDF_RANGE), its outline in fractions of `frame` (the
   * print), distances scaled by `scale` into the leaks' units (the print's
   * short side). Straight lines between the points, as masks and streaks.
   */
  sdf?: { frame: Rect; scale: number }
  /** A subject mask's selection, drawn as itself rather than from the outline (which is then its bounds). */
  raster?: MaskRaster
  /**
   * Matched to the photo at its edge: how much of the subject each pixel in
   * the band is, by its colour against the colours just inside and just
   * outside (maskCover.ts edgeColours), worked out here and kept in the
   * layer's blue. Not under a collage, which has the blue for its own key.
   */
  colourKey?: boolean
}

/**
 * A raster mask's cells, decoded once: red is the cells themselves, and the
 * distance from each cell to the edge, signed (inside positive), for the
 * feather's ramp. A few kept, most recent last.
 */
const rasterLooks = new Map<string, { red: OffscreenCanvas; signed: Float32Array; ramps: Map<number, OffscreenCanvas> }>()
const rasterEdges = new Map<string, { signed: Float32Array; ramps: Map<number, OffscreenCanvas> }>()
function rasterLook(r: MaskRaster) {
  const id = rasterKey(r)
  let look = rasterLooks.get(id)
  if (look) {
    rasterLooks.delete(id)
    rasterLooks.set(id, look)
    return look
  }
  const grid = decodeRaster(r)
  // Red: what was painted by hand (maskCover): half for neither, full for
  // painted in, none for painted out.
  const red = new OffscreenCanvas(r.w, r.h)
  const img = new ImageData(r.w, r.h)
  const pin = r.paintIn ? decodeRaster({ w: r.w, h: r.h, runs: r.paintIn }) : null
  const pout = r.paintOut ? decodeRaster({ w: r.w, h: r.h, runs: r.paintOut }) : null
  const psure = r.paintSure ? decodeRaster({ w: r.w, h: r.h, runs: r.paintSure }) : null
  for (let i = 0; i < grid.length; i++) {
    img.data[i * 4] = pout?.[i] ? 0 : psure?.[i] ? 255 : pin?.[i] ? 191 : 128
    img.data[i * 4 + 3] = 255
  }
  red.getContext('2d')!.putImageData(img, 0, 0)
  // The distances, and the ramps made from them, depend on its cells alone:
  // a brush stroke changes only the painting, so they are kept across it.
  const cellsKey = `${r.w}x${r.h}:${r.runs}`
  let edge = rasterEdges.get(cellsKey)
  if (!edge) {
    const toOut = distanceTo(grid, r.w, r.h, 0)
    const toIn = distanceTo(grid, r.w, r.h, 1)
    const signed = new Float32Array(grid.length)
    for (let i = 0; i < grid.length; i++) signed[i] = grid[i] ? toOut[i] - 0.5 : 0.5 - toIn[i]
    edge = { signed, ramps: new Map() }
    rasterEdges.set(cellsKey, edge)
    while (rasterEdges.size > 8) rasterEdges.delete(rasterEdges.keys().next().value!)
  }
  look = { red, signed: edge.signed, ramps: edge.ramps }
  rasterLooks.set(id, look)
  while (rasterLooks.size > 8) rasterLooks.delete(rasterLooks.keys().next().value!)
  return look
}
/** A drawn or selected mask keyed only along its edge (MaskShape.keyAt). */
const edgeKeyed = (m: MaskShape) => m.keyAt === 'edge' && m.key !== 'off' && (maskKind(m) === 'outline' || maskKind(m) === 'subject')

/** The feather's ramp over a raster mask (see buildLayers' green): 0.5 on the edge, 1 a feather in, 0 a feather out. */
function rasterRamp(r: MaskRaster, cells: number): OffscreenCanvas {
  const look = rasterLook(r)
  const at = Math.round(cells * 10) / 10
  let ramp = look.ramps.get(at)
  if (ramp) return ramp
  ramp = new OffscreenCanvas(r.w, r.h)
  const img = new ImageData(r.w, r.h)
  for (let i = 0; i < look.signed.length; i++) {
    const g = at > 0 ? Math.min(1, Math.max(0, 0.5 + look.signed[i] / (2 * at))) : look.signed[i] > 0 ? 1 : 0
    img.data[i * 4 + 1] = Math.round(g * 255)
    img.data[i * 4 + 3] = 255
  }
  ramp.getContext('2d')!.putImageData(img, 0, 0)
  look.ramps.set(at, ramp)
  if (look.ramps.size > 6) look.ramps.delete(look.ramps.keys().next().value!)
  return ramp
}

/** The side a distance field is worked out at before it is laid into its layer. */
const SDF_WORK = 512

/** Squared distance to the nearest set cell, per row then column (Felzenszwalb–Huttenlocher). */
function distanceSquared(seed: Uint8Array, n: number): Float32Array {
  const INF = 1e20
  const out = new Float32Array(n * n)
  for (let i = 0; i < n * n; i++) out[i] = seed[i] ? 0 : INF
  const f = new Float32Array(n)
  const d = new Float32Array(n)
  const v = new Int32Array(n)
  const z = new Float32Array(n + 1)
  const pass = (get: (k: number) => number, set: (k: number, x: number) => void) => {
    for (let q = 0; q < n; q++) f[q] = get(q)
    let k = 0
    v[0] = 0
    z[0] = -INF
    z[1] = INF
    for (let q = 1; q < n; q++) {
      let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) {
        k--
        s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      }
      k++
      v[k] = q
      z[k] = s
      z[k + 1] = INF
    }
    k = 0
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++
      d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]
    }
    for (let q = 0; q < n; q++) set(q, d[q])
  }
  for (let y = 0; y < n; y++) pass((x) => out[y * n + x], (x, val) => (out[y * n + x] = val))
  for (let x = 0; x < n; x++) pass((y) => out[y * n + x], (y, val) => (out[y * n + x] = val))
  return out
}

/** The photo the masks' keys are read from, before the collage (see LayerShape.keyOn). */
/** How finely the colours either side of an edge are worked out: they are smooth, so a few hundred cells. */
const COLOUR_WORK = 256

/**
 * A mask matched to the photo at its edge, its blue: each pixel's share of
 * the subject by its colour (maskCover.ts colourKeyOf), from the colours
 * just inside and just outside it. `data` is the layer (red: the mask, green:
 * the ramp across its edge); `place` puts the photo on the layer (scale x, y,
 * offset x, y), `band` is the edge ramp's half width in layer pixels.
 */
function colourKeyLayer(data: Uint8ClampedArray, size: number, image: TextureSource, place: number[], band: number): void {
  const photo = new OffscreenCanvas(size, size)
  const pc = photo.getContext('2d')!
  pc.imageSmoothingQuality = 'high'
  pc.setTransform(place[0], 0, 0, place[1], place[2], place[3])
  // Pixels as they are (a test's ImageData) go on a canvas first: they cannot be drawn.
  let drawable = image as CanvasImageSource
  if (image instanceof ImageData) {
    const c = new OffscreenCanvas(image.width, image.height)
    c.getContext('2d')!.putImageData(image, 0, 0)
    drawable = c
  }
  pc.drawImage(drawable, 0, 0)
  const src = pc.getImageData(0, 0, size, size).data
  // The photo and the ramp small, for the colours either side.
  const N = Math.min(COLOUR_WORK, size)
  const f = size / N
  const px = new Uint8ClampedArray(N * N * 4)
  const ramp = new Float32Array(N * N)
  const step = Math.max(1, Math.floor(f / 2))
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let r = 0, g = 0, b = 0, gr = 0, k = 0, on = 0
      for (let yy = Math.floor(y * f); yy < Math.min(size, Math.floor((y + 1) * f)); yy += step)
        for (let xx = Math.floor(x * f); xx < Math.min(size, Math.floor((x + 1) * f)); xx += step) {
          const o = (yy * size + xx) * 4
          gr += data[o + 1]
          k++
          // Past the photo's edge the layer has nothing: not a colour of either side.
          if (src[o + 3] < 128) continue
          r += src[o]
          g += src[o + 1]
          b += src[o + 2]
          on++
        }
      const o = (y * N + x) * 4
      px[o] = on ? r / on : 0
      px[o + 1] = on ? g / on : 0
      px[o + 2] = on ? b / on : 0
      px[o + 3] = on * 2 > k ? 255 : 0
      ramp[y * N + x] = gr / k / 255
    }
  const { fg, bg } = edgeColours(px, ramp, N, N, (band / f) * EDGE_REACH + 2)
  for (let y = 0; y < size; y++) {
    const sy = Math.min(N - 1.001, Math.max(0, (y + 0.5) / f - 0.5))
    const y0 = Math.floor(sy)
    const ty = sy - y0
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4
      // Everywhere, not only in the band: painting in where the photo decides uses it too.
      const g = data[o + 1] / 255
      const sx = Math.min(N - 1.001, Math.max(0, (x + 0.5) / f - 0.5))
      const x0 = Math.floor(sx)
      const tx = sx - x0
      const a = (y0 * N + x0) * 3
      const b = a + 3
      const c = a + N * 3
      const d = c + 3
      const lerp = (m: Float32Array, ch: number) => {
        const top = m[a + ch] + (m[b + ch] - m[a + ch]) * tx
        const bot = m[c + ch] + (m[d + ch] - m[c + ch]) * tx
        return top + (bot - top) * ty
      }
      const v = colourKeyOf(src[o] / 255, src[o + 1] / 255, src[o + 2] / 255, lerp(fg, 0), lerp(fg, 1), lerp(fg, 2), lerp(bg, 0), lerp(bg, 1), lerp(bg, 2), g)
      data[o + 2] = Math.round(v * 255)
    }
  }
}

interface KeySource {
  image: TextureSource
  size: Size
  /** Where the photo sits in the print, print px. */
  frame: Rect
}

/** A small id for each photo source, for the layers' keys. */
const sourceIds = new WeakMap<object, number>()
let nextSourceId = 1
const sourceIdOf = (o: object) => {
  let id = sourceIds.get(o)
  if (!id) sourceIds.set(o, (id = nextSourceId++))
  return id
}

/** Lines across a shape in the streaks' line table, at most. */
const LINE_TABLE_WIDTH = 1024

/** The edit without its streaks that are switched off: kept, not drawn. */
const withoutOffStreaks = (p: BlendParams): BlendParams =>
  p.effects.streaks.shapes.some((sh) => sh.enabled === false)
    ? { ...p, effects: { ...p.effects, streaks: { ...p.effects.streaks, shapes: p.effects.streaks.shapes.filter((sh) => sh.enabled !== false) } } }
    : p

/** What a spot is, for the shader (uLeakAxis.w): a leak 0, a burn 1, a light from Lighting 2, or one that only tints 3. */
const leakCode = (spot: LeakSpot) => (spot.kind === 'burn' ? 1 : spot.lightMode === 'tint' ? 3 : spot.lightMode === 'add' ? 2 : 0)

/** Whether a light is held behind the streaks (its edge then follows their bars' ends). */
const lightBehind = (spots: LeakSpot[]) => spots.some((s) => s.hold?.behindStreaks)

export type EngineReport = (level: 'warning' | 'error', message: string, extra?: Record<string, unknown>) => void
let engineReport: EngineReport | null = null

/**
 * Where engines report what the page can't otherwise see: a lost WebGL
 * context, a shader that took seconds to compile (Windows turns WebGL into
 * Direct3D, and its compiler is far slower on the big shaders). The page
 * sends it to Sentry; the render worker passes it to the page.
 */
export function setEngineReporter(report: EngineReport | null): void {
  engineReport = report
}

/** The crossing table: lines per streak, texels per line, and the row it starts at in the paths' texture (shaders.ts). */
const CROSS_LINES = 2048
const CROSS_TEXELS = 4
const CROSS_ROW = MAX_STREAKS * 2 * PATH_LEVELS

/** A shader build this slow is reported. */
const SLOW_COMPILE_MS = 1500
/**
 * How long a streak program building in the background is waited on by its
 * "finished" signal (KHR_parallel_shader_compile). Past this the build is
 * asked for directly, which waits for it: on some Windows machines the
 * signal never came and the streaks never drew.
 */
const LEAN_SIGNAL_MS = 20_000
/** Streaks still not drawn this long after a render first wanted them: reported, with each program's state. */
const STREAKS_STUCK_MS = 30_000

/**
 * Thrown by render while the look's shader is still being built in the
 * background (GrainEngine.background): nothing to draw yet, try again soon.
 */
export class ShaderPending extends Error {
  constructor() {
    super('The look is still being prepared.')
    this.name = 'ShaderPending'
  }
}

type MainKey = 'full' | 'light'

/**
 * The block the picture is read in, print px (1: every pixel): Pixel art's,
 * or Dither's dot size when its Whole blocks is on, so no dot is split.
 */
function blockSize(fx: EffectParams): number {
  const art = Math.max(1, fx.pixelArt.pixelate)
  const d = fx.dither
  const dots = d.blocks && d.enabled !== false && d.amount > 0 ? Math.max(1, d.pixel) : 1
  return art > 1 ? art : dots
}

/**
 * Keep lines for the blocks the picture is read in: Pixel art's when it
 * makes them; else Dither's Keep detail (Whole blocks), negative, which keeps
 * a whole block with detail in it as pixels rather than one pixel at a time.
 */
function keepLinesOf(fx: EffectParams): number {
  if (Math.max(1, fx.pixelArt.pixelate) > 1) return fx.pixelArt.keepLines ?? 0
  return blockSize(fx) > 1 ? -(fx.dither.keepLines ?? 0) : 0
}

export class GrainEngine {
  /**
   * Build the look's shaders in the background and never wait for one: render
   * throws ShaderPending until the shader without streaks is built, and leaves
   * streaks out (streaksLeftOut) until theirs is. On Windows those builds take
   * from seconds to many minutes (Direct3D's compiler), and waiting for one
   * held up every other GPU job in the window, so the app froze. Set by the
   * render worker; other engines (export, the dropper) wait as before.
   */
  background = false
  /** The last render left streaks out: their shader is still being built, or failed to build. */
  streaksLeftOut = false
  /** Shaders being built, not yet checked. */
  private building: Partial<Record<MainKey, { program: WebGLProgram; vs: WebGLShader; fs: WebGLShader; started: number }>> = {}
  /** Shaders that failed to build, with why. */
  private mainFailed: Partial<Record<MainKey, string>> = {}
  /** Which shader this render uses: with streaks or without. */
  private renderStreaks = false
  /**
   * How streaks are drawn: 'lean', by small programs of their own
   * (streakLean.ts) into the streak cache, the look's shader built without
   * them; or 'full', in the look's own shader, as before, where float
   * targets (which the lean programs need) cannot be drawn. The full shader
   * took Direct3D's compiler (Windows) minutes and then crashed it.
   */
  streakImpl: 'full' | 'lean' = 'lean'
  /** This render draws its streaks with the lean program. */
  private leanOn = false
  private leans: Partial<Record<string, WebGLProgram>> = {}
  readonly canvas: AnyCanvas
  private gl: WebGL2RenderingContext
  private program!: WebGLProgram
  private mains: { full?: { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> }; light?: { program: WebGLProgram; uniforms: Record<string, WebGLUniformLocation | null> } } = {}
  private vao: WebGLVertexArrayObject
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private baseCache: CachedTexture | null = null
  private grainCache: CachedTexture | null = null
  private lutTexture: WebGLTexture | null = null
  private lutKey = ''
  private glowProgram: WebGLProgram | null = null
  private blurProgram: WebGLProgram | null = null
  private glowTargets: [RenderTarget, RenderTarget] | null = null
  /** The streaks' line table (see lineTablePass in the shader): a row per shape. */
  private lineTable: { texture: WebGLTexture; framebuffer: WebGLFramebuffer } | null = null
  private glowKey = ''
  private glowResult: RenderTarget | null = null
  private detailTargets: [RenderTarget, RenderTarget] | null = null
  private detailKey = ''
  private detailResult: RenderTarget | null = null
  private haloTargets: [RenderTarget, RenderTarget] | null = null
  private haloKey = ''
  private haloResult: RenderTarget | null = null
  private structureTargets: [RenderTarget, RenderTarget] | null = null
  private structureKey = ''
  private structureResult: RenderTarget | null = null
  private calmTargets: [[RenderTarget, RenderTarget], [RenderTarget, RenderTarget]] | null = null
  private calmKey = ''
  private calmResult: [RenderTarget, RenderTarget] | null = null
  /** The two calm blurs' brightness in one texture (r fine, g wide): the main pass has no unit to spare for two. */
  private calmPacked: RenderTarget | null = null
  private calmPackProgram: WebGLProgram | null = null
  private streakGlowTargets: [RenderTarget, RenderTarget] | null = null
  private streakGlowKey = ''
  private streakGlowResult: RenderTarget | null = null
  private blank: WebGLTexture | null = null
  private glowBaseSource: unknown = null
  /**
   * What the wide passes (glow, detail, halo, structure, calm) are blurred
   * from: the photo, or with streaks on, the photo as streaked, rendered at
   * their working size (see buildStreaked) so what the streaks cover does not
   * glow through them. passId names it, for the passes' caches.
   */
  private passSource: { texture: WebGLTexture; size: Size } | null = null
  private passId: unknown = null
  private streaked: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number } | null = null
  private streakedKey = ''
  /**
   * Round the streaks' keyed masks, the colours surely behind them and
   * surely in front, mipmapped, for cleaning their edges (see buildMatte).
   */
  private matte: { back: WebGLTexture; fore: WebGLTexture; framebuffers: WebGLFramebuffer[]; width: number; height: number } | null = null
  private matteKey = ''
  private matteOn = false
  /**
   * The streak search's results for the last renders, one texel per output
   * pixel: the streaked photo before the look and how streaked (a), and
   * where each pixel's colour came from (b). One per render size, the least
   * recently used replaced, so a drag's drafts, the loupe and the small
   * renders in between do not throw out the view's.
   */
  private streakCache: {
    a: WebGLTexture
    b: WebGLTexture
    framebuffer: WebGLFramebuffer
    width: number
    height: number
    key: string
    used: number
  }[] = []
  private streakCacheClock = 0
  private objectIds = new WeakMap<object, number>()
  private nextObjectId = 1
  /**
   * What the passes read as the photo: the base itself, or the base with the
   * collage laid in (then a token that changes whenever the collage does, so
   * the glow and blur passes know to rebuild).
   */
  private sourceId: unknown = null
  private baseTexture: WebGLTexture | null = null
  private collageProgram: WebGLProgram | null = null
  // The base photo with its corrections (engine/base.ts), when it has any.
  private developProgram: WebGLProgram | null = null
  private prepTargets: ({ texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number; float: boolean } | null)[] = [null, null]
  private developResult: WebGLTexture | null = null
  private doubleProgram: WebGLProgram | null = null
  private lensProgram: WebGLProgram | null = null
  private prismProgram: WebGLProgram | null = null
  private secondTexture: WebGLTexture | null = null
  private secondSource: ImageBitmap | null = null
  private stampTexture: WebGLTexture | null = null
  private stampKey = ''
  private stampSize: [number, number] = [1, 1]
  private developKey = ''
  private developBase: unknown = null
  private developToken: object = {}
  private developCurve: WebGLTexture | null = null
  private developed: WebGLTexture | null = null
  private collageTargets: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number }[] = []
  private collageKey = ''
  private collageBase: unknown = null
  private collageResult: WebGLTexture | null = null
  /** Replaced whenever the collage is rebuilt, for the passes' caches. */
  private collageToken: object = {}
  /** This render's base carries the collage's "takes the look" alpha. */
  private collageOwn = false
  private collageTextures = new Map<object, WebGLTexture>()
  private glowGeneration = 0
  private defectTexture: WebGLTexture | null = null
  /** Streak shapes and masks as texture layers; see buildLayers. */
  private streakLayers: LayerStore = { texture: null, depth: 0, keys: [], unit: 10 }
  private maskLayers: LayerStore = { texture: null, depth: 0, keys: [], unit: 11 }
  private defectKey = ''
  private readonly canRenderFloat: boolean
  private palettes = new WeakMap<object, Palette>()
  private photoColours: { base: unknown; key: string; colours: Rgb[] } | null = null

  /**
   * The k-colour palette of the photo *as edited*: the look rendered small
   * without a palette, then clustered. Taken from the original instead, a
   * look that brightens a sky (glow, halation) had no colour for it, and the
   * whole sky collapsed onto the brightest one. Cached per image and look.
   */
  private photoColoursFor(input: RenderRequest, k: number): Rgb[] {
    const { pixelArt, ...rest } = input.params.effects
    const key = `${k}|${JSON.stringify({ ...input.params, effects: rest })}`
    if (this.photoColours && this.photoColours.base === input.base && this.photoColours.key === key)
      return this.photoColours.colours
    const long = Math.max(input.baseSize.width, input.baseSize.height)
    const scale = Math.min(1, 72 / long)
    const print = printSizeOf(input.baseSize, input.params)
    const small = this.render({
      ...input,
      region: undefined,
      outputSize: {
        width: Math.max(1, Math.round(print.width * scale)),
        height: Math.max(1, Math.round(print.height * scale)),
      },
      params: {
        ...input.params,
        effects: { ...input.params.effects, pixelArt: { ...pixelArt, palette: 'off', pixelate: 1 } },
      },
    })
    const data = samplePixels(small, small.width, small.height, 72)
    const colours = data ? photoPalette(data, k) : FIXED_PALETTES.dusk.colours
    this.photoColours = { base: input.base, key, colours }
    return colours
  }
  private disposed = false

  /**
   * opts.background: shaders build in the background (the render worker).
   * opts.streaksFirst: the common streak programs start building with the
   * look's shader, not after it (the lab compares the two).
   */
  constructor(canvas?: AnyCanvas, opts?: { background?: boolean; streaksFirst?: boolean }) {
    this.background = !!opts?.background
    this.streaksFirst = !!opts?.streaksFirst
    this.canvas = canvas ?? createCanvas(1, 1)
    const gl = (this.canvas as HTMLCanvasElement).getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    } as WebGLContextAttributes) as WebGL2RenderingContext | null
    if (!gl) throw new Error('WebGL2 is not available in this browser.')
    this.gl = gl
    // A GPU reset, or the system taking the GPU back: reported (setEngineReporter).
    ;(this.canvas as EventTarget).addEventListener?.('webglcontextlost', () => !this.disposed && engineReport?.('warning', 'The GPU context was lost', { gpu: this.gpuName() }), false)
    // Must be requested on this context, not merely supported by the browser:
    // without it a half-float render target is incomplete and the glow pass
    // silently produces garbage.
    this.canRenderFloat = !!gl.getExtension('EXT_color_buffer_float')
    this.wrapUniforms()

    this.vao = gl.createVertexArray()!
    // The look's shader without streaks starts building now, so it is ready
    // or nearly by the first render; the one with streaks, once a render has
    // streaks. KHR_parallel_shader_compile lets the builds run on their own.
    this.parallel = gl.getExtension('KHR_parallel_shader_compile')
    this.startMain('light')
    if (this.streaksFirst) this.warmStreaks()
  }

  /**
   * The common streak programs, started building in the background: once the
   * look's shader is built (render), so they do not hold up the photo's
   * first picture. Started with it, the browser prepared them before the
   * look's first render could even say it was waiting (4 s on Windows).
   */
  private streaksFirst = false
  private streaksWarmed = false
  private warmStreaks(): void {
    if (this.streaksWarmed || !this.background || !this.canRenderFloat) return
    this.streaksWarmed = true
    for (const k of ['table', 'trail', 'fill', 'colour'] as const) this.startLean(k)
  }

  /**
   * The look's shader, with or without streaks: their search is nearly all
   * of its compile time (seconds, cold), so a render without streaks — the
   * palette fit, thumbnails, a look with none — never waits for it.
   */
  private parallel: { COMPLETION_STATUS_KHR: number } | null = null

  /** Starts building the look's shader, with streaks (full) or without (light), unless it is built or building. */
  private startMain(key: MainKey): void {
    if (this.mains[key] || this.building[key] || this.mainFailed[key]) return
    const gl = this.gl
    const make = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      return shader
    }
    const started = performance.now()
    const vs = make(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = make(gl.FRAGMENT_SHADER, key === 'full' ? FRAGMENT_SHADER : FRAGMENT_SHADER_LIGHT)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    this.building[key] = { program, vs, fs, started }
  }

  /**
   * Whether the look's shader is built and ready to use. In the background,
   * false while it is still building (asking never waits); otherwise it waits
   * for the build. False too once a build has failed (reported, once).
   */
  private mainReady(key: MainKey): boolean {
    if (this.mains[key]) return true
    if (this.mainFailed[key]) return false
    this.startMain(key)
    const b = this.building[key]!
    const gl = this.gl
    if (this.background && this.parallel && !gl.getProgramParameter(b.program, this.parallel.COMPLETION_STATUS_KHR)) return false
    delete this.building[key]
    const ms = performance.now() - b.started
    const what = key === 'full' ? 'look with streaks' : 'look'
    if (!gl.getProgramParameter(b.program, gl.LINK_STATUS)) {
      const log = (gl.getShaderInfoLog(b.fs) || gl.getProgramInfoLog(b.program) || '').slice(0, 500)
      this.mainFailed[key] = log || 'no reason given'
      engineReport?.('error', `Shader failed to build: ${what}`, { seconds: Math.round(ms / 100) / 10, log, lost: gl.isContextLost(), gpu: this.gpuName() })
      gl.deleteProgram(b.program)
      gl.deleteShader(b.vs)
      gl.deleteShader(b.fs)
      return false
    }
    gl.deleteShader(b.vs)
    gl.deleteShader(b.fs)
    if (ms > SLOW_COMPILE_MS) engineReport?.(ms > 10_000 ? 'error' : 'warning', `Slow shader compile: ${what}`, { seconds: Math.round(ms / 100) / 10, background: this.background && !!this.parallel, gpu: this.gpuName() })
    this.setUpMain(key, b.program)
    return true
  }

  /** The look's shader once built: its uniforms found and its texture units set. */
  private setUpMain(key: MainKey, program: WebGLProgram): void {
    const gl = this.gl
    {
      const uniforms: Record<string, WebGLUniformLocation | null> = {}
      gl.useProgram(program)
      for (const name of [
      'uBase',
      'uGrain',
      'uBaseSize',
      'uGrainSize',
      'uRegionOrigin',
      'uRegionSize',
      'uBlendMode',
      'uTiling',
      'uAmount',
      'uGrainScale',
      'uLinearBlend',
      'uGrainMean',
      'uGrainRotation',
      'uGrainShift',
      'uChroma',
      'uResponseLut',
      'uSoftness',
      'uGrainCentre',
      'uGrainGain',
      'uFlatten',
      'uFlattenLod',
      'uCrisp',
      'uGlow',
      'uHalation',
      'uBloom',
      'uShoulder',
      'uFade',
      'uExposure',
      'uVignette',
      'uDefects',
      'uDefectStrength',
      'uPrintSize',
      'uImageOffset',
      'uShapeOrigin',
      'uShapeUnit',
      'uShapeFrame',
      'uPaperColour',
      'uPaperTexture',
      'uEdgeIrregularity',
      'uEdgeSoftness',
      'uBorderSeed',
      'uBorderGrain',
      'uHasBorder',
      'uPaperColour2',
      'uPaperFill',
      'uPaperKind',
      'uEdgeKind',
      'uPaperDir',
      'uCornerRadius',
      'uShadow',
      'uShadowBlur',
      'uShadowOffset',
      'uBevelWidth',
      'uBevelLight',
      'uLineWidth',
      'uLineGap',
      'uLineColour',
      'uInset',
      'uInsetSize',
      'uScanLines',
      'uScanStreaks',
      'uScanSeed',
      'uPixelScale',
      'uSurgeStrength',
      'uSurgeCount',
      'uSurgeWidth',
      'uSurgeAngle',
      'uSurgeSeed',
      'uPerChannelResponse',
      'uLayerShift',
      'uDetail',
      'uHalo',
      'uStructure',
      'uStructureAmount',
      'uCalm',
      'uStreakGlow',
      'uStreakGlowAmount',
      'uStreakMask',
      'uStreakKey',
      'uStreakKeyed',
      'uPrism',
      'uPrismTurn',
      'uGlass',
      'uLensK',
      'uGlassAxis',
      'uDitherTransitions',
      'uDitherSparePop',
      'uDitherTone',
      'uHaloAmount',
      'uSolarize',
      'uSolarizeFrom',
      'uMaskShape',
      'uMaskShape2',
      'uMonoAmount',
      'uMonoMix',
      'uMonoContrast',
      'uMonoTone',
      'uMonoToneAmount',
      'uHalftoneStyle',
      'uHalftoneAmount',
      'uHalftoneCell',
      'uHalftoneAngle',
      'uInkA',
      'uInkB',
      'uHalftonePaper',
      'uHalftoneSlip',
      'uFollowColour',
      'uDitherAmount',
      'uDitherSteps',
      'uDitherSpread',
      'uDitherNoise',
      'uDitherFollow',
      'uDitherFrom',
      'uDitherTo',
      'uDitherOval',
      'uDitherStretch',
      'uBandGuides',
      'uBandGuideCount',
      'uDitherPixel',
      'uDitherClumps',
      'uDitherOrdered',
      'uPixelate',
      'uPixelKeep',
      'uStreakShapes',
      'uStreakRect',
      'uStreakInfo',
      'uStreakExtra',
      'uStreakPaths',
      'uCrossRange',
      'uStreakPathReach',
      'uStreakSweep',
      'uStreakEnds',
      'uStreakEdge',
      'uStreakPathInfo',
      'uStreakVanish',
      'uStreakEndS',
      'uStreakEndInfo',
      'uStreakFlags',
      'uStreakRepeat',
      'uStreakBend',
      'uStreakRepeat2',
      'uStreakRepeat3',
      'uStreakRepeatMask',
      'uStreakEndSoft',
      'uStreakStripe',
      'uStreakMirror',
      'uStreakToneStart',
      'uStreakToneEnd',
      'uStreakCount',
      'uFixSpan',
      'uFixFrom',
      'uFixInfo',
      'uFixColours',
      'uFixTone',
      'uFixCount',
      'uLinePass',
      'uLineTable',
      'uLineInfo',
      'uLineSpan',
      'uMaskShapes',
      'uMaskRect',
      'uMaskFlags',
      'uMaskGrow',
      'uMaskKey',
      'uMaskCount',
      'uShowMask',
      'uSectionMask',
      'uStreakAmount',
      'uPalette',
      'uPaletteCount',
      'uPaletteAmount',
      'uPaletteDither',
      'uPaletteSpacing',
      'uRim',
      'uCrunch',
      'uStockStrength',
      'uStreakUngraded',
      'uHueMoves',
      'uHueMoveCount',
      'uStockLift',
      'uStockGain',
      'uStockSat',
      'uStockContrast',
      'uLeak',
      'uLeakCount',
      'uLeakSeed',
      'uLeakGeo',
      'uLeakAxis',
      'uLeakTint',
      'uLeakHold',
      'uLightBehind',
      'uLeakPath',
      'uLeakRect',
      'uLeakLight',
      'uLeakPoints',
      'uGlowTint',
      'uStockKeepTone',
      'uVibrance',
      'uWarmth',
      'uTint',
      'uShadowTint',
      'uShadowAmount',
      'uHighlightTint',
      'uHighlightAmount',
      'uHasGrade',
      'uMapAmount',
      'uMapShadow',
      'uMapMid',
      'uMapHigh',
      'uMapRange',
      'uMapShape',
      'uBlobCount',
      'uBlobA',
      'uBlobB',
      'uIsolateAmount',
      'uIsolateHue',
      'uIsolateWidth',
      'uPopAmount',
      'uPopKeep',
      'uPopColour',
      'uRestColour',
      'uCollageOwn',
      'uPassesStreaked',
      'uMatteBack',
      'uMatteFore',
      'uMatteOn',
      'uMatteLod',
      'uStreakCacheOn',
      'uCacheOffset',
    ]) {
        uniforms[name] = this.tokenFor(name, gl.getUniformLocation(program, name))
      }
      gl.uniform1i(uniforms.uBase, 0)
      gl.uniform1i(uniforms.uGrain, 1)
      gl.uniform1i(uniforms.uResponseLut, 2)
      gl.uniform1i(uniforms.uGlow, 3)
      gl.uniform1i(uniforms.uDefects, 4)
      gl.uniform1i(uniforms.uDetail, 5)
      gl.uniform1i(uniforms.uHalo, 6)
      gl.uniform1i(uniforms.uStructure, 7)
      gl.uniform1i(uniforms.uCalm, 8)
      gl.uniform1i(uniforms.uStreakGlow, 9)
      gl.uniform1i(uniforms.uStreakShapes, 10)
      gl.uniform1i(uniforms.uMaskShapes, 11)
      gl.uniform1i(uniforms.uLineTable, 12)
      gl.uniform1i(uniforms.uStreakPaths, 13)
      gl.uniform1i(uniforms.uMatteBack, 14)
      gl.uniform1i(uniforms.uMatteFore, 15)
      this.mains[key] = { program, uniforms }
    }
  }

  /** The streaks' shader failed to build: streaks cannot be drawn by this GPU. */
  get streaksFailed(): boolean {
    return !!this.mainFailed.full || this.leanWanted.some((w) => !!this.leanFailed[leanName(w.kind, w.v)])
  }

  /**
   * The look shader's uniforms by name: a token stands for each location, so
   * what is set through it is kept (setUniformsKept) and can be given to the
   * lean program, whose locations are its own. Tokens are passed to WebGL in
   * place of locations; the wrapped uniform calls take them back off.
   */
  private kept = new Map<string, { fn: string; args: unknown[] }>()
  private tokenFor(name: string, loc: WebGLUniformLocation | null): WebGLUniformLocation {
    return { __name: name, __loc: loc } as unknown as WebGLUniformLocation
  }
  private wrapUniforms(): void {
    const gl = this.gl as unknown as Record<string, (...a: unknown[]) => unknown>
    for (const fn of ['uniform1f', 'uniform2f', 'uniform3f', 'uniform4f', 'uniform1i', 'uniform2i', 'uniform3i', 'uniform4i', 'uniform1fv', 'uniform2fv', 'uniform3fv', 'uniform4fv', 'uniform1iv', 'uniform2iv', 'uniform3iv', 'uniform4iv', 'uniformMatrix3fv', 'uniformMatrix4fv']) {
      const orig = gl[fn].bind(this.gl)
      gl[fn] = (loc: unknown, ...args: unknown[]) => {
        const t = loc as { __name?: string; __loc?: WebGLUniformLocation | null } | null
        if (t && t.__name !== undefined) {
          this.kept.set(t.__name, { fn, args: args.map((a) => (ArrayBuffer.isView(a) ? (a as Float32Array).slice() : Array.isArray(a) ? [...a] : a)) })
          if (t.__loc) orig(t.__loc, ...args)
          return
        }
        return orig(loc, ...args)
      }
    }
  }

  /**
   * A lean program (streakLean.ts), current, with every uniform the look's
   * shader has been given for this pass: each program keeps its own, and
   * the engine sets them on the look's as it goes (kept by wrapUniforms).
   */
  /**
   * The straight lean programs, started building now (with
   * KHR_parallel_shader_compile, alongside everything else) so they are
   * ready, or nearly, when the first streak is drawn: on Windows they take
   * a few seconds between them.
   */
  private leanStarted: Partial<Record<string, { program: WebGLProgram; vs: WebGLShader; fs: WebGLShader; started: number }>> = {}
  private startLean(kind: LeanKind, v: LeanVariant = {}): void {
    const name = leanName(kind, v)
    if (this.leans[name] || this.leanStarted[name]) return
    const gl = this.gl
    const make = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      return shader
    }
    const vs = make(gl.VERTEX_SHADER, VERTEX_SHADER)
    const fs = make(gl.FRAGMENT_SHADER, leanStreakShader(FRAGMENT_SHADER, kind, v))
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    // Sent to the GPU now: from a worker, commands can otherwise wait until something is drawn.
    gl.flush()
    this.leanStarted[name] = { program, vs, fs, started: performance.now() }
  }

  /** Lean programs that failed to build, by name, with why (reported once each). */
  private leanFailed: Record<string, string> = {}
  /** The lean programs the last render with streaks needed (leanNeeded). */
  private leanWanted: { kind: LeanKind; v: LeanVariant }[] = []

  /**
   * A lean program's state: built (and set up), still building (only in the
   * background; asking never waits there), or failed. Elsewhere asking waits
   * for the build. The main program stays current.
   */
  private leanState(kind: LeanKind, v: LeanVariant = {}): 'ready' | 'building' | 'failed' {
    const gl = this.gl
    const name = leanName(kind, v)
    if (this.leans[name]) return 'ready'
    if (this.leanFailed[name]) return 'failed'
    this.startLean(kind, v)
    const b = this.leanStarted[name]!
    const waited = performance.now() - b.started
    if (this.background && this.parallel && !gl.getProgramParameter(b.program, this.parallel.COMPLETION_STATUS_KHR)) {
      if (waited < LEAN_SIGNAL_MS) return 'building'
      // No word it is finished: asked for directly below, which waits for the build.
      engineReport?.('warning', 'Streak program never said it was built', { program: name, seconds: Math.round(waited / 100) / 10, gpu: this.gpuName() })
    }
    delete this.leanStarted[name]
    const ms = performance.now() - b.started
    if (ms > SLOW_COMPILE_MS) engineReport?.(ms > 10_000 ? 'error' : 'warning', `Slow shader compile: streaks (${name})`, { seconds: Math.round(ms / 100) / 10, background: this.background && !!this.parallel, gpu: this.gpuName() })
    if (!gl.getProgramParameter(b.program, gl.LINK_STATUS)) {
      const log = (gl.getShaderInfoLog(b.fs) || gl.getProgramInfoLog(b.program) || '').slice(0, 500)
      this.leanFailed[name] = log || 'no reason given'
      engineReport?.('error', `Shader failed to build: streaks (${name})`, { log, lost: gl.isContextLost(), gpu: this.gpuName() })
      gl.deleteProgram(b.program)
      gl.deleteShader(b.vs)
      gl.deleteShader(b.fs)
      return 'failed'
    }
    gl.deleteShader(b.vs)
    gl.deleteShader(b.fs)
    const program = b.program
    this.leans[name] = program
    gl.useProgram(program)
    const units: Record<string, number> = { uBase: 0, uGrain: 1, uResponseLut: 2, uGlow: 3, uDefects: 4, uDetail: 5, uHalo: 6, uStructure: 7, uCalm: 8, uStreakGlow: 9, uStreakShapes: 10, uMaskShapes: 11, uLineTable: 12, uStreakPaths: 13, uMatteBack: 14, uMatteFore: 15, uLeanMatteBack: 3, uLeanMatteFore: 5, uLeanLight: 6 }
    for (const [name, unit] of Object.entries(units)) {
      const loc = gl.getUniformLocation(program, name)
      if (loc) gl.uniform1i(loc, unit)
    }
    gl.useProgram(this.program)
    return 'ready'
  }

  /**
   * The programs this render's streaks need, from the settings it has given
   * so far: the crossing table and the colour draw, the line table where
   * masked colours are skipped, each streak's trail or fill, and the light
   * draws where a light is held behind the streaks.
   */
  private leanNeeded(): { kind: LeanKind; v: LeanVariant }[] {
    const count = Math.min((this.kept.get('uStreakCount')?.args[0] as number) ?? 0, MAX_STREAKS)
    const extra = this.kept.get('uStreakExtra')?.args[0] as Float32Array | undefined
    const lines = this.kept.get('uLineInfo')?.args[0] as Float32Array | undefined
    const path = this.leanPath()
    const out: { kind: LeanKind; v: LeanVariant }[] = [
      { kind: 'table', v: { path } },
      { kind: 'colour', v: { path } },
    ]
    if (this.leanHolds && lines?.some((x, k) => k % 4 === 2 && x > 0)) out.push({ kind: 'lines', v: { path } })
    const light = (this.kept.get('uLightBehind')?.args[0] as number) === 1
    for (let i = 0; i < count; i++) {
      const mode = extra ? extra[i * 4 + 3] : 0
      if (mode > 1.5) continue
      out.push({ kind: mode > 0.5 ? 'trail' : 'fill', v: { path: this.leanPath(i), skip: this.leanSkip(i) } })
      if (light && mode > 0.5) out.push({ kind: 'light', v: { path: this.leanPath(i) } })
    }
    const seen = new Set<string>()
    return out.filter((w) => !seen.has(leanName(w.kind, w.v)) && !!seen.add(leanName(w.kind, w.v)))
  }

  private useLean(kind: LeanKind, v: LeanVariant = {}): WebGLProgram {
    const gl = this.gl
    const name = leanName(kind, v)
    const state = this.leanState(kind, v)
    // Never building here: leanState waits unless in the background, and a
    // background render checks its programs before drawing (see render).
    if (state !== 'ready') throw new Error(`The streaks' ${name} shader ${state === 'failed' ? `failed to build: ${this.leanFailed[name]}` : 'is not built yet'}`)
    const program = this.leans[name]!
    gl.useProgram(program)
    const g = gl as unknown as Record<string, (...a: unknown[]) => unknown>
    for (const [name, { fn, args }] of this.kept) {
      const loc = gl.getUniformLocation(program, name)
      if (loc) g[fn](loc, ...args)
    }
    return program
  }

  /** Whether streak i (or, without i, any streak) follows a drawn path: its programs need the path search. */
  /**
   * Whether streak i's programs skip masked colours: when something holds
   * the streaks back (set with the uniforms) and its line table is drawn.
   */
  private leanHolds = false
  private leanSkip(i: number): boolean {
    const info = this.kept.get('uLineInfo')?.args[0] as Float32Array | undefined
    return this.leanHolds && !!info && info[i * 4 + 2] > 0
  }

  private leanPath(i?: number): boolean {
    const info = this.kept.get('uStreakPathInfo')?.args[0] as Float32Array | undefined
    const count = Math.min((this.kept.get('uStreakCount')?.args[0] as number) ?? 0, MAX_STREAKS)
    if (!info) return false
    if (i !== undefined) return info[i * 4 + 1] >= 2
    for (let k = 0; k < count; k++) if (info[k * 4 + 1] >= 2) return true
    return false
  }

  /** The lean draws' two float targets, at one size. */
  private leanTargets: { a: WebGLTexture; b: WebGLTexture; c: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number; used: number }[] = []
  private leanClock = 0
  private leanTargetsFor(width: number, height: number) {
    const gl = this.gl
    const have = this.leanTargets.find((t) => t.width === width && t.height === height)
    if (have) {
      have.used = ++this.leanClock
      return have
    }
    // Two sizes are in use at once (the view's and the wide passes'): the least lately used makes way.
    if (this.leanTargets.length >= 2) {
      const old = this.leanTargets.reduce((x, y) => (x.used < y.used ? x : y))
      gl.deleteTexture(old.a)
      gl.deleteTexture(old.b)
      gl.deleteTexture(old.c)
      gl.deleteFramebuffer(old.framebuffer)
      this.leanTargets.splice(this.leanTargets.indexOf(old), 1)
    }
    const make = () => {
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, width, height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      return texture
    }
    const a = make()
    const b = make()
    // The third: a borrowing colour fix's read and tone (streakLean.ts, outFix).
    const c = make()
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT2, gl.TEXTURE_2D, c, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2])
    const made = { a, b, c, framebuffer, width, height, used: ++this.leanClock }
    this.leanTargets.push(made)
    this.bindMatte()
    return made
  }

  /**
   * The streaks into the bound target (the streak cache, or the streaked
   * photo for the wide passes), with the lean programs: each streak's trail
   * or fill draw into the two float targets, last to first, then the colour
   * draw from them into the target.
   */
  private drawLean(width: number, height: number): void {
    const gl = this.gl
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    // Units 3, 5 and 6 are the look's passes' (glow, detail, halo), already
    // bound for the main pass when the streak cache is drawn: put back after.
    const held = [3, 5, 6].map((unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      return gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null
    })
    const g = this.leanTargetsFor(width, height)
    this.bindMatte()
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.framebuffer)
    gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0])
    gl.clearBufferfv(gl.COLOR, 1, [0, 0, 0, 0])
    gl.clearBufferfv(gl.COLOR, 2, [0, 0, 0, 0])
    // Unit 12 (the third target's, for the colour draw) must not hold it
    // while it is drawn into: the line table there instead, for skipping
    // masked colours, or the blank.
    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, this.leanHolds && this.lineTable ? this.lineTable.texture : this.blankTexture())
    const count = Math.min((this.kept.get('uStreakCount')?.args[0] as number) ?? 0, MAX_STREAKS)
    const extra = this.kept.get('uStreakExtra')?.args[0] as Float32Array | undefined
    const pass = this.kept.get('uLinePass')?.args[0] as number | undefined
    for (let i = count - 1; i >= 0; i--) {
      const mode = extra ? extra[i * 4 + 3] : 0
      if (mode > 1.5) continue
      const program = this.useLean(mode > 0.5 ? 'trail' : 'fill', { path: this.leanPath(i), skip: this.leanSkip(i) })
      gl.uniform1i(gl.getUniformLocation(program, 'uLeanStreak'), i)
      this.drawStrips(width, height)
    }
    // A light held behind the streaks: where it is read past the trails'
    // bar ends, into a target of its own, the streak found here on unit 15.
    let light: WebGLTexture | null = null
    const trails = extra ? Array.from({ length: count }, (_, i) => i).filter((i) => extra[i * 4 + 3] > 0.5 && extra[i * 4 + 3] < 1.5) : []
    if ((this.kept.get('uLightBehind')?.args[0] as number) === 1 && pass !== 2 && trails.length) {
      const l = this.leanLightFor(width, height)
      light = l.texture
      gl.bindFramebuffer(gl.FRAMEBUFFER, l.framebuffer)
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0])
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
      gl.activeTexture(gl.TEXTURE15)
      gl.bindTexture(gl.TEXTURE_2D, g.b)
      for (const i of trails.reverse()) {
        const program = this.useLean('light', { path: this.leanPath(i) })
        gl.uniform1i(gl.getUniformLocation(program, 'uLeanStreak'), i)
        this.drawStrips(width, height)
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, target)
    gl.activeTexture(gl.TEXTURE14)
    gl.bindTexture(gl.TEXTURE_2D, g.a)
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, g.b)
    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, g.c)
    // The matte (Clean edges) and the light's reads on units of the look's
    // passes, which this draw does not read; theirs put back after.
    const matte = this.matteOn && this.matte
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, matte ? this.matte!.back : this.blankTexture())
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, matte ? this.matte!.fore : this.blankTexture())
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, light ?? this.blankTexture())
    this.useLean('colour', { path: this.leanPath() })
    this.drawStrips(width, height)
    gl.useProgram(this.program)
    ;[3, 5, 6].forEach((unit, k) => {
      gl.activeTexture(gl.TEXTURE0 + unit)
      gl.bindTexture(gl.TEXTURE_2D, held[k])
    })
    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
    this.bindMatte()
  }

  /** Where a light behind the streaks is read (the light draws'), at one size: made when first wanted. */
  private leanLight: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number } | null = null
  private leanLightFor(width: number, height: number) {
    const gl = this.gl
    if (this.leanLight && this.leanLight.width === width && this.leanLight.height === height) return this.leanLight
    this.freeLeanLight()
    const texture = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RG32F, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0])
    this.leanLight = { texture, framebuffer, width, height }
    return this.leanLight
  }

  private freeLeanLight(): void {
    if (!this.leanLight) return
    this.gl.deleteTexture(this.leanLight.texture)
    this.gl.deleteFramebuffer(this.leanLight.framebuffer)
    this.leanLight = null
  }

  /** Whether the streaks' shader is built, or has failed and will not be (never waits in the background). */
  streaksReady(): boolean {
    if (this.streakImpl === 'lean' && this.canRenderFloat) {
      const states = this.leanWanted.map((w) => ({ name: leanName(w.kind, w.v), state: this.leanState(w.kind, w.v) }))
      const ready = states.every((st) => st.state !== 'building')
      if (ready) this.streaksAsked = null
      else {
        this.streaksAsked ??= performance.now()
        const waited = performance.now() - this.streaksAsked
        if (waited > STREAKS_STUCK_MS && !this.streaksStuckSaid) {
          this.streaksStuckSaid = true
          engineReport?.('error', 'Streaks still not drawn', {
            seconds: Math.round(waited / 1000),
            programs: states.map((st) => `${st.name}: ${st.state}${this.leanStarted[st.name] ? ` (${Math.round((performance.now() - this.leanStarted[st.name]!.started) / 1000)} s)` : ''}`).join(', '),
            lost: this.gl.isContextLost(),
            gpu: this.gpuName(),
          })
        }
      }
      return ready
    }
    return this.mainReady('full') || !!this.mainFailed.full
  }
  /** When streaks were first waited on, and whether that wait was reported (streaksReady). */
  private streaksAsked: number | null = null
  private streaksStuckSaid = false

  private useMain(streaks: boolean): void {
    const key: MainKey = streaks ? 'full' : 'light'
    if (!this.mainReady(key)) throw new Error(`The ${streaks ? 'streaks' : 'look'} shader is not built.`)
    const v = this.mains[key]!
    this.program = v.program
    this.uniforms = v.uniforms
    this.gl.useProgram(v.program)
  }

  /**
   * A pass with the streak search drawn in strips, each sent to the GPU on
   * its own. As one draw it held the GPU for a third of a second, and the
   * window, drawn on the same GPU, stuttered for as long; between strips the
   * GPU can draw the window too.
   */
  private drawStrips(width: number, height: number): void {
    const gl = this.gl
    const strips = Math.min(24, Math.ceil((width * height) / STRIP_PX))
    if (strips <= 1) {
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      return
    }
    gl.enable(gl.SCISSOR_TEST)
    for (let k = 0; k < strips; k++) {
      const y0 = Math.floor((k * height) / strips)
      const y1 = Math.floor(((k + 1) * height) / strips)
      gl.scissor(0, y0, width, y1 - y0)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.flush()
    }
    gl.disable(gl.SCISSOR_TEST)
  }

  /** Waits until the GPU has finished the last render (a one-pixel read), for timing it. */
  waitForGpu(): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
  }

  /** The GPU reset or the system took the context back: this engine cannot render again. */
  /** Whether the look's shader is built, or has failed and will not be (never waits in the background). */
  lookReady(): boolean {
    return this.mainReady('light') || !!this.mainFailed.light
  }

  /**
   * A stand-in for a render while the look's shader is still building (it
   * takes seconds the first time on Windows): the photo as it is, on its
   * paper, where the render would put it. None of the look, so the preview
   * says it is preparing and draws again when the shader is ready.
   */
  provisional(req: RenderRequest): OffscreenCanvas {
    const print = printSizeOf(req.baseSize, req.params)
    const region = req.region ?? { x: 0, y: 0, ...print }
    const out = req.outputSize ?? { width: Math.round(region.width), height: Math.round(region.height) }
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(out.width)), Math.max(1, Math.round(out.height)))
    const ctx = canvas.getContext('2d')!
    const border = activeBorder(req.params)
    const paper = border.colour.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
    ctx.fillStyle = `rgb(${paper.join(',')})`
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    const at = photoFrame(req.baseSize, border)
    const sx = canvas.width / region.width
    const sy = canvas.height / region.height
    let src: CanvasImageSource = req.base as CanvasImageSource
    if (req.base instanceof ImageData) {
      const c = new OffscreenCanvas(req.base.width, req.base.height)
      c.getContext('2d')!.putImageData(req.base, 0, 0)
      src = c
    }
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(src, (at.x - region.x) * sx, (at.y - region.y) * sy, at.width * sx, at.height * sy)
    return canvas
  }

  isContextLost(): boolean {
    return this.gl.isContextLost()
  }

  /** Largest render this context can produce along either axis. */
  get maxSize(): number {
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number
  }

  private buildProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl
    const compile = (type: number, src: string) => {
      const shader = gl.createShader(type)!
      gl.shaderSource(shader, src)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(`Shader compile failed: ${log}`)
      }
      return shader
    }
    const started = performance.now()
    const kind = `pass (${fragmentSource.length} chars)`
    const vs = compile(gl.VERTEX_SHADER, vertexSource)
    const fs = compile(gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()!
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program)
      gl.deleteProgram(program)
      throw new Error(`Program link failed: ${log}`)
    }
    const ms = performance.now() - started
    if (ms > SLOW_COMPILE_MS) {
      engineReport?.(ms > 10_000 ? 'error' : 'warning', `Slow shader compile: ${kind}`, { seconds: Math.round(ms / 100) / 10, gpu: this.gpuName() })
    }
    return program
  }

  /** A WebGL error while drawing streaks has been reported (once per engine). */
  private streakErrorReported = false
  private gpu: string | null = null
  /** The GPU and driver as WebGL names them (Windows: through ANGLE and Direct3D). */
  gpuName(): string {
    if (this.gpu === null) {
      try {
        const gl = this.gl
        const info = gl.getExtension('WEBGL_debug_renderer_info')
        this.gpu = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).slice(0, 200)
      } catch {
        this.gpu = 'unknown'
      }
    }
    return this.gpu
  }

  private upload(
    cache: CachedTexture | null,
    source: RenderRequest['base'],
    unit: number,
    wrap: number,
  ): CachedTexture {
    const gl = this.gl
    let entry = cache
    if (!entry) {
      entry = { texture: gl.createTexture()!, source: null, wrap: -1 }
    }
    gl.activeTexture(gl.TEXTURE0 + unit)
    gl.bindTexture(gl.TEXTURE_2D, entry.texture)

    if (entry.source !== source) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      entry.source = source
    }
    if (entry.wrap !== wrap) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap)
      entry.wrap = wrap
    }
    return entry
  }

  private createTarget(width: number, height: number): RenderTarget {
    const gl = this.gl
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    // Half float keeps highlight energy above 1.0 for a natural-looking glow;
    // 8-bit clamps it, which is a visible but acceptable fallback.
    if (this.canRenderFloat) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null)
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      throw new Error('Could not create a render target for the glow pass.')
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return { texture, framebuffer, width, height }
  }

  /**
   * Render the blurred highlights used for halation and bloom.
   *
   * Always computed from the whole base image at a fixed resolution — never
   * from the region being rendered. Halation draws light in from outside any
   * crop, so a per-crop glow would both cut off at the crop edge and break the
   * guarantee that a preview crop matches the full-resolution export.
   */
  private buildGlow(req: RenderRequest): void {
    const { halation, bloom, glowThreshold, glowRadius } = req.params.effects
    if (halation <= 0 && bloom <= 0) return
    // Rebuild only when something it depends on actually changed. The base is
    // identified by the object itself, which is what the texture cache keys on.
    if (this.glowBaseSource !== this.passId) this.glowGeneration++
    this.glowBaseSource = this.passId
    const size = workingSize(req.baseSize, GLOW_SIZE)
    const key = `${this.glowGeneration}|${size.width}x${size.height}|${glowThreshold}|${glowRadius}`
    if (key === this.glowKey && this.glowResult) return
    this.glowKey = key
    this.glowTargets = this.ensureTargets(this.glowTargets, size)
    this.glowResult = this.blurInto(this.glowTargets, req, GLOW_SIZE, glowThreshold, false, glowRadius)
  }

  /**
   * The whole picture, blurred at a few pixels' reach: what edge glow compares
   * each pixel against, and what crunch sharpens away from.
   */
  private buildDetail(req: RenderRequest): void {
    const { rim, crunch, rimRadius } = req.params.effects
    if (rim <= 0 && crunch <= 0) return
    if (this.glowBaseSource !== this.passId) this.glowGeneration++
    this.glowBaseSource = this.passId
    // Never finer than the photo itself: upsampling a small image buys nothing.
    const longSide = Math.min(DETAIL_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = `${this.glowGeneration}|${size.width}x${size.height}|${rimRadius}`
    if (key === this.detailKey && this.detailResult) return
    this.detailKey = key
    this.detailTargets = this.ensureTargets(this.detailTargets, size)
    this.detailResult = this.blurInto(this.detailTargets, req, longSide, 0, true, rimRadius)
  }

  /** The whole picture blurred wide: what the halo compares each pixel with. */
  private buildHalo(req: RenderRequest): void {
    const { halo, haloRadius } = req.params.effects
    if (halo <= 0) return
    if (this.glowBaseSource !== this.passId) this.glowGeneration++
    this.glowBaseSource = this.passId
    const longSide = Math.min(HALO_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = `${this.glowGeneration}|${size.width}x${size.height}|${haloRadius}`
    if (key === this.haloKey && this.haloResult) return
    this.haloKey = key
    this.haloTargets = this.ensureTargets(this.haloTargets, size)
    this.haloResult = this.blurInto(this.haloTargets, req, longSide, 0, true, haloRadius)
  }

  /**
   * Two blurs of the picture, a little apart in scale. Their difference is a
   * smooth measure of how busy each area is — ripples, foliage — which the
   * dither uses to stay off texture.
   */
  private buildCalm(req: RenderRequest): void {
    const { dither, pixelArt } = req.params.effects
    if (dither.transitionsOnly <= 0 || (dither.amount <= 0 && pixelArt.palette === 'off')) return
    if (this.glowBaseSource !== this.passId) this.glowGeneration++
    this.glowBaseSource = this.passId
    const longSide = Math.min(DETAIL_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = `${this.glowGeneration}|${size.width}x${size.height}`
    if (key === this.calmKey && this.calmResult) return
    this.calmKey = key
    const pair = (t: [RenderTarget, RenderTarget] | undefined) => this.ensureTargets(t ?? null, size)
    this.calmTargets = [pair(this.calmTargets?.[0]), pair(this.calmTargets?.[1])]
    this.calmResult = [
      this.blurInto(this.calmTargets[0], req, longSide, 0, true, 0.003),
      this.blurInto(this.calmTargets[1], req, longSide, 0, true, 0.016),
    ]
    // Packed into one texture, the brightness of each.
    const gl = this.gl
    if (!this.calmPacked || this.calmPacked.width !== size.width || this.calmPacked.height !== size.height) {
      if (this.calmPacked) {
        gl.deleteTexture(this.calmPacked.texture)
        gl.deleteFramebuffer(this.calmPacked.framebuffer)
      }
      this.calmPacked = this.createTarget(size.width, size.height)
    }
    if (!this.calmPackProgram) this.calmPackProgram = this.buildProgram(GLOW_VERTEX, CALM_PACK_FRAGMENT)
    gl.useProgram(this.calmPackProgram)
    gl.viewport(0, 0, size.width, size.height)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.calmPacked.framebuffer)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.calmResult[0].texture)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.calmResult[1].texture)
    gl.uniform1i(gl.getUniformLocation(this.calmPackProgram, 'uFine'), 0)
    gl.uniform1i(gl.getUniformLocation(this.calmPackProgram, 'uWide'), 1)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture!)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.grainCache!.texture)
  }

  /**
   * Light off the streaks: the streaked photo's bars (its alpha says how much
   * of each pixel is bars), blurred, whole-frame at the glow's working size,
   * so a crop matches the export. Needs the streaked photo (buildStreaked).
   */
  private buildStreakGlow(req: RenderRequest): void {
    const glow = req.params.effects.streaks.glow ?? 0
    if (glow <= 0 || !this.streaked || this.passSource?.texture !== this.streaked.texture) {
      this.streakGlowResult = null
      return
    }
    const radius = req.params.effects.streaks.glowRadius ?? 0.03
    const longSide = 480
    const size = workingSize(req.baseSize, longSide)
    const key = `${this.streakedKey}|${size.width}x${size.height}|${radius}`
    if (key === this.streakGlowKey && this.streakGlowResult) return
    this.streakGlowKey = key
    this.streakGlowTargets = this.ensureTargets(this.streakGlowTargets, size)
    this.streakGlowResult = this.blurInto(this.streakGlowTargets, req, longSide, 0, true, radius, true)
  }

  /** The picture blurred at texture scale, for Structure. */
  private buildStructure(req: RenderRequest): void {
    const { structure, structureRadius } = req.params.effects
    if (structure <= 0) return
    if (this.glowBaseSource !== this.passId) this.glowGeneration++
    this.glowBaseSource = this.passId
    const longSide = Math.min(DETAIL_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = `${this.glowGeneration}|${size.width}x${size.height}|${structureRadius}`
    if (key === this.structureKey && this.structureResult) return
    this.structureKey = key
    this.structureTargets = this.ensureTargets(this.structureTargets, size)
    this.structureResult = this.blurInto(this.structureTargets, req, longSide, 0, true, structureRadius)
  }

  private ensureTargets(targets: [RenderTarget, RenderTarget] | null, size: Size): [RenderTarget, RenderTarget] {
    if (targets && targets[0].width === size.width && targets[0].height === size.height) return targets
    const gl = this.gl
    for (const t of targets ?? []) {
      gl.deleteTexture(t.texture)
      gl.deleteFramebuffer(t.framebuffer)
    }
    return [this.createTarget(size.width, size.height), this.createTarget(size.width, size.height)]
  }

  /**
   * Downsample the whole base into one of a pair of targets, optionally keeping
   * only the highlights, then blur it. Returns whichever target holds the result.
   */
  private blurInto(
    targets: [RenderTarget, RenderTarget],
    req: RenderRequest,
    longSide: number,
    threshold: number,
    passThrough: boolean,
    radius: number,
    alphaWeight = false,
  ): RenderTarget {
    const gl = this.gl
    const [a, b] = targets
    const { width, height } = a
    if (!this.glowProgram) this.glowProgram = this.buildProgram(GLOW_VERTEX, GLOW_THRESHOLD_FRAGMENT)
    if (!this.blurProgram) this.blurProgram = this.buildProgram(GLOW_VERTEX, GLOW_BLUR_FRAGMENT)
    gl.viewport(0, 0, width, height)
    gl.bindVertexArray(this.vao)

    // From a mip level close to the working resolution so the downsample does
    // not alias.
    gl.useProgram(this.glowProgram)
    gl.bindFramebuffer(gl.FRAMEBUFFER, a.framebuffer)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.passSource?.texture ?? this.baseTexture!)
    gl.uniform1i(gl.getUniformLocation(this.glowProgram, 'uSource'), 0)
    gl.uniform1f(gl.getUniformLocation(this.glowProgram, 'uThreshold'), threshold)
    gl.uniform1i(gl.getUniformLocation(this.glowProgram, 'uPassThrough'), passThrough ? 1 : 0)
    gl.uniform1i(gl.getUniformLocation(this.glowProgram, 'uAlphaWeight'), alphaWeight ? 1 : 0)
    const sourceSize = this.passSource?.size ?? req.baseSize
    const lod = Math.max(0, Math.log2(Math.max(sourceSize.width, sourceSize.height) / longSide))
    gl.uniform1f(gl.getUniformLocation(this.glowProgram, 'uSourceLod'), lod)
    gl.drawArrays(gl.TRIANGLES, 0, 3)

    // Separable blur, two iterations for a smoother falloff than one gives.
    gl.useProgram(this.blurProgram)
    const sourceLoc = gl.getUniformLocation(this.blurProgram, 'uSource')
    const stepLoc = gl.getUniformLocation(this.blurProgram, 'uStep')
    const radiusTexels = Math.max(1, radius * longSide)
    let from = a
    let to = b
    for (let pass = 0; pass < 4; pass++) {
      const horizontal = pass % 2 === 0
      // Later passes step wider, which widens the kernel without more taps.
      const spread = (radiusTexels / 4) * (pass < 2 ? 1 : 2)
      gl.bindFramebuffer(gl.FRAMEBUFFER, to.framebuffer)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, from.texture)
      gl.uniform1i(sourceLoc, 0)
      gl.uniform2f(stepLoc, horizontal ? spread / width : 0, horizontal ? 0 : spread / height)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      const swap = from
      from = to
      to = swap
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)

    // These passes borrow unit 0 for their own textures. Leaving it bound there
    // would make the main pass sample the blur as though it were the photo.
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture!)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.grainCache!.texture)
    return from
  }

  /** A texture for a collage map or image, uploaded once per object. */
  private collageTexture(source: ImageData | ImageBitmap, mipmaps: boolean): WebGLTexture {
    const gl = this.gl
    let tex = this.collageTextures.get(source)
    if (tex) {
      gl.bindTexture(gl.TEXTURE_2D, tex)
      return tex
    }
    tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    this.collageTextures.set(source, tex)
    return tex
  }

  /** A full-size target for the prepare passes, with mipmaps, made again when the size changes. */
  private prepTarget(slot: 0 | 1, width: number, height: number) {
    const gl = this.gl
    const was = this.prepTargets[slot]
    // Half float keeps the corrections from being rounded to 8 bits again,
    // where the GPU can draw into it and the photo is not huge.
    const float = this.canRenderFloat && width * height <= 26e6
    if (was && was.width === width && was.height === height && was.float === float) return was
    if (was) {
      gl.deleteTexture(was.texture)
      gl.deleteFramebuffer(was.framebuffer)
    }
    // Made on unit 0, which the pass binds its source to next: made on the
    // unit a step's lookup texture is on (the curve, the stamp), the pass
    // would read the target it draws into.
    gl.activeTexture(gl.TEXTURE0)
    const texture = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, texture)
    const levels = Math.floor(Math.log2(Math.max(width, height))) + 1
    gl.texStorage2D(gl.TEXTURE_2D, levels, float ? gl.RGBA16F : gl.RGBA8, width, height)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
    const t = { texture, framebuffer, width, height, float }
    this.prepTargets[slot] = t
    return t
  }

  /** A small texture of our own, filtered, clamped, its contents replaced. */
  private ownTexture(tex: WebGLTexture | null, source: TexImageSource | null, data?: { w: number; h: number; bytes: Uint8Array }, mipmaps = false): WebGLTexture {
    const gl = this.gl
    const t = tex ?? gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
    if (data) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, data.w, data.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, data.bytes)
    else if (source) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source)
    if (mipmaps) gl.generateMipmap(gl.TEXTURE_2D)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mipmaps ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return t
  }

  /**
   * The photo as the camera took it, before the look: the Base corrections
   * (engine/base.ts), a second exposure on the same frame, then the lens and
   * the date the camera prints (engine/extras.ts). Each step is a pass over
   * the whole photo into a target with mipmaps; the result is kept until its
   * settings or the photo change, and is null when there is nothing to do,
   * so an edited photo costs nothing extra.
   */
  private buildDevelop(req: RenderRequest): WebGLTexture | null {
    const gl = this.gl
    const fx = req.params.effects
    const b = fx.base
    const on = baseActive(b)
    const developOn = on.light || on.colour || on.curve
    const second = doubleOn(fx.double) ? lookupCollageImage(fx.double.image!) : null
    const lens = lensOn(fx.lens)
    const prism = prismOn(fx.prism) ? fx.prism : null
    const stamp = fx.stamp.enabled ? stampText(fx.stamp) : ''
    if (!developOn && !second && !prism && !lens && !stamp) return null
    const { width, height } = req.baseSize
    const key = JSON.stringify([developOn ? b : 0, second ? fx.double : 0, prism ?? 0, lens ? fx.lens : 0, stamp ? [fx.stamp, stamp] : 0, width, height])
    if (key === this.developKey && this.developBase === req.base && this.developResult) return this.developResult
    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, width, height)
    let source: WebGLTexture = this.baseCache!.texture
    let slot: 0 | 1 = 0
    const into = (program: WebGLProgram) => {
      const target = this.prepTarget(slot, width, height)
      gl.useProgram(program)
      gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, source)
      gl.uniform1i(gl.getUniformLocation(program, 'uSource'), 0)
      return (name: string) => gl.getUniformLocation(program, name)
    }
    const done = () => {
      const target = this.prepTargets[slot]!
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, target.texture)
      gl.generateMipmap(gl.TEXTURE_2D)
      source = target.texture
      slot = slot === 0 ? 1 : 0
    }
    if (developOn) {
      if (!this.developProgram) this.developProgram = this.buildProgram(GLOW_VERTEX, DEVELOP_FRAGMENT)
      gl.activeTexture(gl.TEXTURE1)
      this.developCurve = this.ownTexture(this.developCurve, null, { w: CURVE_LUT_SIZE, h: 1, bytes: toneCurveLut(b.curve) })
      const loc = into(this.developProgram)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.developCurve)
      const wb = on.colour ? whiteBalanceGains(b.temperature, b.tint) : [1, 1, 1]
      const ev = b.lightOn ? 2 ** b.exposure : 1
      gl.uniform1i(loc('uCurve'), 1)
      gl.uniform3f(loc('uGains'), wb[0] * ev, wb[1] * ev, wb[2] * ev)
      gl.uniform1i(loc('uToneOn'), on.light ? 1 : 0)
      gl.uniform1f(loc('uKnee'), b.lightOn && b.exposure > 0 ? Math.min(1, b.exposure) : 0)
      gl.uniform1f(loc('uContrast'), on.light ? b.contrast : 0)
      gl.uniform1f(loc('uHighlights'), on.light ? b.highlights : 0)
      gl.uniform1f(loc('uShadows'), on.light ? b.shadows : 0)
      gl.uniform1f(loc('uWhites'), on.light ? b.whites : 0)
      gl.uniform1f(loc('uBlacks'), on.light ? b.blacks : 0)
      gl.uniform1f(loc('uSaturation'), on.colour ? b.saturation : 0)
      gl.uniform1i(loc('uCurveOn'), on.curve ? 1 : 0)
      done()
    }
    if (second) {
      const d = fx.double
      if (!this.doubleProgram) this.doubleProgram = this.buildProgram(GLOW_VERTEX, DOUBLE_FRAGMENT)
      gl.activeTexture(gl.TEXTURE1)
      if (this.secondSource !== second.bitmap) {
        if (this.secondTexture) gl.deleteTexture(this.secondTexture)
        this.secondTexture = this.ownTexture(null, second.bitmap, undefined, true)
        this.secondSource = second.bitmap
      } else gl.bindTexture(gl.TEXTURE_2D, this.secondTexture)
      const loc = into(this.doubleProgram)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.secondTexture)
      // Cover the photo, as the second frame fills the same film.
      const photoAspect = width / height
      const imageAspect = second.bitmap.width / second.bitmap.height
      const span = imageAspect > photoAspect ? [imageAspect / photoAspect, 1] : [1, photoAspect / imageAspect]
      gl.uniform1i(loc('uSecond'), 1)
      gl.uniform2f(loc('uCentre'), d.x, d.y)
      gl.uniform2f(loc('uSpan'), span[0] * d.scale, span[1] * d.scale)
      gl.uniform1f(loc('uFlip'), d.flip ? 1 : 0)
      gl.uniform1i(loc('uMode'), ['screen', 'lighten', 'multiply', 'overlay'].indexOf(d.mode))
      gl.uniform1f(loc('uAmount'), d.amount)
      gl.uniform1f(loc('uMono'), d.mono)
      done()
    }
    // A prism in front of the lens: the colours apart, before the lens's own fringes.
    if (prism) {
      if (!this.prismProgram) this.prismProgram = this.buildProgram(GLOW_VERTEX, PRISM_FRAGMENT)
      const loc = into(this.prismProgram)
      const px = prism.split * PRISM_MAX * Math.min(width, height)
      const a = (prism.angle * Math.PI) / 180
      gl.uniform2f(loc('uSize'), width, height)
      gl.uniform2f(loc('uOffset'), (Math.cos(a) * px) / width, (Math.sin(a) * px) / height)
      gl.uniform1i(loc('uRadial'), prism.shape === 'radial' ? 1 : 0)
      gl.uniform1f(loc('uSplitPx'), px)
      gl.uniform1i(loc('uSpectrum'), prism.colours === 'spectrum' ? 1 : 0)
      gl.uniform1f(loc('uLight'), prism.light)
      gl.uniform1f(loc('uAmount'), prism.amount)
      done()
    }
    if (lens || stamp) {
      const l = fx.lens
      const s = fx.stamp
      if (!this.lensProgram) this.lensProgram = this.buildProgram(GLOW_VERTEX, LENS_FRAGMENT)
      let rect = [0, 0, 0, 0]
      if (stamp) {
        const px = Math.round(s.size * Math.min(width, height))
        const stampKey = JSON.stringify([stamp, px, s.theme])
        gl.activeTexture(gl.TEXTURE1)
        if (stampKey !== this.stampKey || !this.stampTexture) {
          const canvas = drawStamp(stamp, px, s.theme)
          if (canvas) {
            this.stampTexture = this.ownTexture(this.stampTexture, canvas as TexImageSource)
            this.stampSize = [canvas.width, canvas.height]
            this.stampKey = stampKey
          }
        } else gl.bindTexture(gl.TEXTURE_2D, this.stampTexture)
        const [cw, ch] = this.stampSize
        const margin = 0.03 * Math.min(width, height)
        const right = s.corner === 'br' || s.corner === 'tr'
        const bottom = s.corner === 'br' || s.corner === 'bl'
        const x = right ? width - margin - cw : margin
        const y = bottom ? height - margin - ch : margin
        rect = [x / width, y / height, cw / width, ch / height]
      }
      const loc = into(this.lensProgram)
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, this.stampTexture)
      const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      gl.uniform1i(loc('uStamp'), 1)
      gl.uniform2f(loc('uSize'), width, height)
      gl.uniform1i(loc('uLensOn'), lens ? 1 : 0)
      gl.uniform1f(loc('uFringe'), l.fringe)
      gl.uniform1f(loc('uDiffusion'), l.diffusion)
      gl.uniform1f(loc('uSoftEdges'), l.softEdges)
      gl.uniform1f(loc('uTilt'), l.tilt)
      gl.uniform1f(loc('uFocus'), l.focus)
      gl.uniform1f(loc('uFocusWidth'), l.focusWidth)
      gl.uniform1i(loc('uStampOn'), stamp && this.stampTexture ? 1 : 0)
      gl.uniform4f(loc('uStampRect'), rect[0], rect[1], rect[2], rect[3])
      gl.uniform3f(loc('uStampColour'), lin(s.colour[0]), lin(s.colour[1]), lin(s.colour[2]))
      gl.uniform1f(loc('uStampGlow'), s.glow)
      gl.uniform1i(loc('uStampPaint'), s.theme === 'digicam' ? 1 : 0)
      done()
    }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.grainCache!.texture)
    this.developKey = key
    this.developBase = req.base
    this.developToken = {}
    this.developResult = source
    return source
  }

  /**
   * The base with each collage piece laid in (engine/collage.ts), at the
   * base's own size and with mipmaps, as the photo itself has. Kept until the
   * collage or the base changes, so the rest of the edit costs nothing extra.
   */
  private buildCollage(req: RenderRequest, layers: CollageLayer[]): WebGLTexture {
    const gl = this.gl
    const { width, height } = req.baseSize
    const crop = req.photoCrop ?? { x: 0, y: 0, width: 1, height: 1 }
    const key = JSON.stringify([layers.map((l) => l.key), width, height, crop, this.developed ? this.developKey : ''])
    if (key === this.collageKey && this.collageBase === req.base && this.collageResult) return this.collageResult
    if (!this.collageProgram) this.collageProgram = this.buildProgram(GLOW_VERTEX, COLLAGE_FRAGMENT)
    // A (the result) and B (scratch): each piece is drawn into B over its own
    // rectangle only and copied back into A, so a piece costs its own area,
    // not the whole photo, however many there are.
    const need = 2
    if (this.collageTargets.length && (this.collageTargets[0].width !== width || this.collageTargets[0].height !== height)) {
      for (const t of this.collageTargets) {
        gl.deleteTexture(t.texture)
        gl.deleteFramebuffer(t.framebuffer)
      }
      this.collageTargets = []
    }
    while (this.collageTargets.length < need) {
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      const levels = Math.floor(Math.log2(Math.max(width, height))) + 1
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, width, height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      this.collageTargets.push({ texture, framebuffer, width, height })
    }
    const program = this.collageProgram
    gl.useProgram(program)
    gl.bindVertexArray(this.vao)
    gl.viewport(0, 0, width, height)
    const loc = (name: string) => gl.getUniformLocation(program, name)
    gl.uniform1i(loc('uSource'), 0)
    gl.uniform1i(loc('uSky'), 1)
    gl.uniform1i(loc('uWire'), 2)
    gl.uniform1i(loc('uImage'), 3)
    gl.uniform1i(loc('uLine'), 4)
    gl.uniform4f(loc('uCrop'), crop.x, crop.y, crop.width, crop.height)
    const turn = ((req.photoCrop?.angle ?? 0) * Math.PI) / 180
    gl.uniform3f(loc('uCropTurn'), Math.cos(turn), Math.sin(turn), turn ? width / crop.width / (height / crop.height) : 0)
    const used = new Set<object>()
    const [A, B] = this.collageTargets
    const bindPiece = (layer: CollageLayer) => {
      gl.activeTexture(gl.TEXTURE1)
      this.collageTexture(layer.sky, false)
      gl.activeTexture(gl.TEXTURE2)
      this.collageTexture(layer.wire, false)
      gl.activeTexture(gl.TEXTURE3)
      this.collageTexture(layer.image, true)
      gl.activeTexture(gl.TEXTURE4)
      this.collageTexture(layer.line, false)
      used.add(layer.sky).add(layer.wire).add(layer.image).add(layer.line)
      gl.uniform4f(loc('uRect'), ...layer.rect)
      gl.uniform2f(loc('uCentre'), ...layer.centre)
      gl.uniform2f(loc('uSpan'), ...layer.span)
      gl.uniform2f(loc('uPhotoPx'), ...layer.photoPx)
      gl.uniform1f(loc('uRotation'), layer.rotation)
      gl.uniform1f(loc('uFlip'), layer.flip ? 1 : 0)
      gl.uniform1f(loc('uGain'), layer.gain)
      gl.uniform1f(loc('uOpacity'), layer.opacity)
      gl.uniform1f(loc('uResidual'), layer.residual)
      gl.uniform1f(loc('uTakeLook'), layer.takeLook)
      gl.uniform1f(loc('uDetail'), layer.detail)
      gl.uniform3f(loc('uTint'), ...layer.tint)
      gl.uniform1f(loc('uKeepLight'), layer.keepLight)
      gl.uniform3f(loc('uRelight'), ...layer.relight)
      gl.uniform1f(loc('uSmooth'), layer.smooth)
    }
    // The photo into A first: the first piece's maps, with a rectangle no
    // pixel falls in, so the pass copies the base as it is.
    bindPiece(layers[0])
    gl.uniform4f(loc('uRect'), 2, 2, 3, 3)
    gl.uniform3f(loc('uRelight'), 1, 1, 1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, A.framebuffer)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.developed ?? this.baseCache!.texture)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.enable(gl.SCISSOR_TEST)
    for (const layer of layers) {
      // The piece's rectangle in the base's pixels (through the crop), a pixel spare.
      const toPx = (fx: number, size: number, from: number, span: number) => ((fx - from) / span) * size
      // A piece that lights the photo reaches all of it.
      const whole = layer.relight.some((v) => v !== 1) || turn !== 0
      const x0 = whole ? 0 : Math.max(0, Math.floor(toPx(layer.rect[0], width, crop.x, crop.width)) - 2)
      const y0 = whole ? 0 : Math.max(0, Math.floor(toPx(layer.rect[1], height, crop.y, crop.height)) - 2)
      const x1 = whole ? width : Math.min(width, Math.ceil(toPx(layer.rect[2], width, crop.x, crop.width)) + 2)
      const y1 = whole ? height : Math.min(height, Math.ceil(toPx(layer.rect[3], height, crop.y, crop.height)) + 2)
      if (x1 <= x0 || y1 <= y0) continue
      bindPiece(layer)
      gl.scissor(x0, y0, x1 - x0, y1 - y0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, B.framebuffer)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, A.texture)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      // Back into A, that rectangle only.
      gl.bindTexture(gl.TEXTURE_2D, A.texture)
      gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, x0, y0, x0, y0, x1 - x0, y1 - y0)
    }
    gl.disable(gl.SCISSOR_TEST)
    const source = A.texture
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, source)
    gl.generateMipmap(gl.TEXTURE_2D)
    // Maps from earlier versions of a piece (a tolerance being dragged) are let go.
    for (const [obj, tex] of this.collageTextures)
      if (!used.has(obj)) {
        gl.deleteTexture(tex)
        this.collageTextures.delete(obj)
      }
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, this.grainCache!.texture)
    this.collageKey = key
    this.collageBase = req.base
    this.collageResult = source
    this.collageToken = {}
    return source
  }

  /**
   * The defect layer, rebuilt only when its parameters or the frame size
   * change. Generated across the whole frame and sampled in image coordinates,
   * so a preview crop shows the same specks the export will have.
   */
  private bindDefects(req: RenderRequest, print: Size): void {
    const gl = this.gl
    const params = req.params.effects.defects
    gl.activeTexture(gl.TEXTURE4)
    if (params.strength <= 0) {
      gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
      return
    }
    // Generated across the whole print so dust falls on the border too; at
    // the size of the print the edit was made on (BlendParams.pixelScale),
    // so a better copy of the photo gets the same specks, only larger.
    const ps = pixelScaleOf(req.params)
    const pw = Math.max(1, Math.round(print.width / ps))
    const ph = Math.max(1, Math.round(print.height / ps))
    const key = defectKey(pw, ph, params)
    if (key !== this.defectKey || !this.defectTexture) {
      const layer = generateDefectLayer(pw, ph, params)
      this.defectTexture ??= gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.defectTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, layer)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      this.defectKey = key
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.defectTexture)
    }
  }

  /** A 1x1 black texture, so the glow sampler is always bound to something. */
  /**
   * The streaks' line table, drawn by the main program with every uniform as
   * set for the picture, then bound for the picture to read.
   */
  /**
   * Each line's crossings of each streak's shape (crossTablePass), drawn
   * once per set of shapes and copied in below the paths on unit 13, where
   * the searches along lines look them up.
   */
  private crossTable: { texture: WebGLTexture; framebuffer: WebGLFramebuffer; into: WebGLFramebuffer; key: string } | null = null
  private drawCrossTable(key: string): void {
    const gl = this.gl
    if (!this.canRenderFloat || !this.pathTexture) return
    if (!this.crossTable) {
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, CROSS_LINES, MAX_STREAKS * CROSS_TEXELS)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      const into = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, into)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.pathTexture, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      this.crossTable = { texture, framebuffer, into, key: '' }
      // Made on unit 14: the blank there while the table is drawn, so it is never read and written at once.
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
    }
    if (this.crossTable.key === key) return
    this.crossTable.key = key
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.crossTable.framebuffer)
    gl.viewport(0, 0, CROSS_LINES, MAX_STREAKS * CROSS_TEXELS)
    this.useLean('table', { path: this.leanPath() })
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.useProgram(this.program)
    this.bindMatte()
    // Copied (not drawn) into the paths' texture: the pass reads the paths.
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.crossTable.framebuffer)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.crossTable.into)
    gl.blitFramebuffer(0, 0, CROSS_LINES, MAX_STREAKS * CROSS_TEXELS, 0, CROSS_ROW, CROSS_LINES, CROSS_ROW + MAX_STREAKS * CROSS_TEXELS, gl.COLOR_BUFFER_BIT, gl.NEAREST)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
  }

  private drawLineTable(lean = false): void {
    const gl = this.gl
    if (!this.lineTable) {
      gl.activeTexture(gl.TEXTURE12)
      const texture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LINE_TABLE_WIDTH, MAX_STREAKS, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      this.lineTable = { texture, framebuffer }
      // Made on whatever unit was active, which is 12: put the blank back
      // there, or the first table is drawn into the texture it reads (a
      // feedback loop the draw refuses, leaving that render's table empty).
      gl.activeTexture(gl.TEXTURE12)
      gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
    }
    // Unit 12 holds the blank texture while the table is drawn, so it is
    // never read and written at once.
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.lineTable.framebuffer)
    gl.viewport(0, 0, LINE_TABLE_WIDTH, MAX_STREAKS)
    if (lean) {
      this.useLean('lines', { path: this.leanPath() })
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.useProgram(this.program)
    } else {
      gl.uniform1i(this.uniforms.uLinePass, 1)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.uniform1i(this.uniforms.uLinePass, 0)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, this.lineTable.texture)
  }

  /** The streaks' paths (see pathFlow) into their float texture, on unit 13. */
  private pathTexture: WebGLTexture | null = null
  private uploadPaths(data: Float32Array): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE13)
    if (!this.pathTexture) {
      this.pathTexture = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.pathTexture)
      // The paths, and below them each line's crossings of each shape (drawCrossTable).
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, CROSS_LINES, CROSS_ROW + MAX_STREAKS * CROSS_TEXELS)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else gl.bindTexture(gl.TEXTURE_2D, this.pathTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, STREAK_PATH_SAMPLES, MAX_STREAKS * 2 * PATH_LEVELS, gl.RGBA, gl.FLOAT, data)
  }

  private blankTexture(): WebGLTexture {
    const gl = this.gl
    if (!this.blank) {
      this.blank = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, this.blank)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    }
    return this.blank
  }

  private disposeGlowTargets(): void {
    const gl = this.gl
    for (const t of [
      ...(this.glowTargets ?? []),
      ...(this.detailTargets ?? []),
      ...(this.haloTargets ?? []),
      ...(this.structureTargets ?? []),
      ...(this.calmTargets?.flat() ?? []),
      ...(this.streakGlowTargets ?? []),
      ...(this.calmPacked ? [this.calmPacked] : []),
    ]) {
      gl.deleteTexture(t.texture)
      gl.deleteFramebuffer(t.framebuffer)
    }
    this.glowTargets = null
    this.glowResult = null
    this.detailTargets = null
    this.detailResult = null
    this.haloTargets = null
    this.haloResult = null
    this.structureTargets = null
    this.structureResult = null
    this.calmTargets = null
    this.calmResult = null
    this.calmPacked = null
    this.streakGlowTargets = null
    this.streakGlowResult = null
    this.streakGlowKey = ''
  }

  /** Upload the response curve as a 1D lookup, rebuilt only when it changes. */
  private uploadCurve(curve: RenderRequest['params']['response']): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE2)
    if (!this.lutTexture) {
      this.lutTexture = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.lutTexture)
    }
    const key = curveKey(curve)
    if (key === this.lutKey) return
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, LUT_SIZE, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, curveToLut(curve))
    this.lutKey = key
  }

  /**
   * Render one request and return the canvas holding the result. The canvas is
   * reused between calls — copy or encode it before rendering again.
   */
  /**
   * The photo's palette, read once per base image. Keyed on the image object,
   * which is what the texture cache keys on too.
   */
  paletteFor(base: RenderRequest['base'], size: Size): Palette {
    if (typeof base !== 'object' || base === null) return NEUTRAL_PALETTE
    let palette = this.palettes.get(base)
    if (!palette) {
      palette = extractPalette(base, size.width, size.height)
      this.palettes.set(base, palette)
    }
    return palette
  }

  /**
   * The photo with Repeat's copies in it (engine/repeat.ts), made again only
   * when the photo, the copies or their masks change; null when Repeat is
   * doing nothing.
   */
  private repeatedBase(base: RenderRequest['base'], size: Size, params: BlendParams): RenderRequest['base'] | null {
    const fx = params.effects
    if (!fx.repeat?.enabled || !fx.repeat.items.length) return null
    const print = printSize(size, params.border)
    const photoAt = photoFrame(size, params.border)
    const maskFrame = fx.shapeSpace === 'print' ? { x: 0, y: 0, ...print } : photoAt
    const r = fx.repeat
    const use = fx.maskUse?.repeat
    const used = fx.masks.filter((m) => r.items.some((it) => it.source === m.id) || use?.ids.includes(m.id))
    const key = JSON.stringify([size, r, use, used, maskFrame, photoAt])
    const kept = this.repeatCache
    if (kept && kept.base === base && kept.key === key) return kept.canvas
    const canvas = composeRepeat(base, size, fx, maskFrame, photoAt)
    this.repeatCache = canvas ? { base, key, canvas } : null
    return canvas
  }
  private repeatCache: { base: RenderRequest['base']; key: string; canvas: OffscreenCanvas } | null = null

  render(given: RenderRequest): AnyCanvas {
    if (this.disposed) throw new Error('GrainEngine has been disposed.')
    // Lighting's lights are drawn as leaks are (engine/lighting.ts). A
    // photo replaced under its edit: what is sized in pixels in the pixels
    // of the photo the edit was made on, and that photo's seed.
    const input: RenderRequest = {
      ...given,
      params: inReferencePixels(withoutOffStreaks(withLighting(given.params))),
      imageSeed: given.params.photoSeed ?? given.imageSeed,
    }
    // Worked out before anything is set up for this pass: it renders too.
    const photoColours =
      input.params.effects.pixelArt.palette === 'photo'
        ? this.photoColoursFor(input, Math.round(input.params.effects.pixelArt.colours))
        : null
    const gl = this.gl
    // Key controls and "from the photo" colours resolve here, once, so every
    // caller — preview, export, batch — renders a look identically.
    const palette = usesPalette(input.params) ? this.paletteFor(input.base, input.baseSize) : NEUTRAL_PALETTE
    const resolved = withPhotoSeed(resolveParams(input.params, palette), input.imageSeed)
    // Which shader: with streaks if this render has any and theirs is built.
    // Until it is (or if it failed), everything else is drawn without them;
    // until the one without is built, nothing is (ShaderPending).
    const wantStreaks = input.params.effects.streaks.shapes.length > 0 && input.params.effects.streaks.amount > 0
    this.leanOn = wantStreaks && this.streakImpl === 'lean' && this.canRenderFloat
    const withStreaks = wantStreaks && !this.leanOn && this.mainReady('full')
    if (!withStreaks && !this.mainReady('light')) {
      if (this.mainFailed.light) throw new Error(`The look's shader failed to build: ${this.mainFailed.light}`)
      throw new ShaderPending()
    }
    this.warmStreaks()
    this.renderStreaks = withStreaks
    this.streaksLeftOut = wantStreaks && !withStreaks && !this.leanOn
    const req: RenderRequest = {
      ...input,
      // Repeat's copies go into the photo itself, before everything else.
      base: this.repeatedBase(input.base, input.baseSize, resolved) ?? input.base,
      params: resolved,
    }
    // The print is the photo plus its border; with no border they are the same
    // and every existing caller is unaffected.
    const print = printSize(req.baseSize, req.params.border) // already the active border
    const region = req.region ?? { x: 0, y: 0, ...print }
    const out: Size = req.outputSize ?? { width: Math.round(region.width), height: Math.round(region.height) }
    const width = Math.max(1, Math.round(out.width))
    const height = Math.max(1, Math.round(out.height))
    const limit = this.maxSize
    if (width > limit || height > limit) {
      throw new Error(`Requested render is ${width}×${height}px but this GPU caps out at ${limit}px per side.`)
    }

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width
      this.canvas.height = height
    }

    const wrap = req.params.tiling === 'mirror' ? gl.MIRRORED_REPEAT : gl.REPEAT
    gl.bindVertexArray(this.vao)
    this.baseCache = this.upload(this.baseCache, req.base, 0, gl.CLAMP_TO_EDGE)
    this.grainCache = this.upload(this.grainCache, req.grain, 1, wrap)
    // The base photo's corrections first, then the collage, so every later
    // pass sees one photo.
    this.developed = this.buildDevelop(req)
    const collage = collageLayers(req.imageSeed, req.params.effects.collage)
    if (collage.length) {
      this.baseTexture = this.buildCollage(req, collage)
      this.sourceId = this.collageToken
    } else if (this.developed) {
      this.baseTexture = this.developed
      this.sourceId = this.developToken
    } else {
      this.baseTexture = this.baseCache.texture
      this.sourceId = req.base
    }
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, this.baseTexture)
    // The date stamp keeps its own LCD colour the same way a collage piece keeps
    // its own (the base's alpha says where), while grain and dust go over it.
    this.collageOwn = collage.length > 0 || req.params.effects.stamp.enabled

    // The wide passes are built once the main pass's settings are in place
    // (see the end): with streaks on, they are blurred from the streaked photo.
    // Without any, the shader built without their search (see useMain).
    this.useMain(this.renderStreaks)

    const u = this.uniforms
    gl.uniform2f(u.uBaseSize, req.baseSize.width, req.baseSize.height)
    gl.uniform2f(u.uGrainSize, req.grainSize.width, req.grainSize.height)
    gl.uniform2f(u.uRegionOrigin, region.x, region.y)
    gl.uniform2f(u.uRegionSize, region.width, region.height)
    gl.uniform1i(u.uBlendMode, BLEND_MODE_BY_ID[req.params.blendMode].index)
    gl.uniform1i(u.uTiling, TILING_INDEX[req.params.tiling])
    gl.uniform1f(u.uAmount, req.params.amount)
    gl.uniform1f(u.uGrainScale, Math.max(0.01, req.params.grainScale))
    gl.uniform1i(u.uLinearBlend, req.params.colorSpace === 'linear' ? 1 : 0)
    gl.uniform1f(u.uGrainMean, req.grainMean ?? 0.5)
    gl.uniform1f(u.uGrainRotation, (req.params.grainRotation * Math.PI) / 180)
    gl.uniform2fv(u.uGrainShift, grainShift(req))
    gl.uniform1f(u.uChroma, req.params.chroma)
    gl.uniform1f(u.uSoftness, req.params.softness)

    // Plate normalisation. 'off' leaves the values alone by centring on 0.5
    // with unit gain, so the same shader path serves every mode.
    const plateMean = req.grainMean ?? 0.5
    const plateSd = req.grainSd ?? REFERENCE_PLATE_SD
    const normalise = req.params.plateNormalise
    gl.uniform1f(u.uGrainCentre, normalise === 'off' ? 0.5 : plateMean)
    gl.uniform1f(u.uGrainGain, normalise === 'match' ? REFERENCE_PLATE_SD / Math.max(plateSd, 1e-4) : 1)
    gl.uniform1f(u.uFlatten, req.params.plateFlatten)
    gl.uniform1i(u.uCrisp, req.params.plateSampling === 'crisp' ? 1 : 0)
    const fx = req.params.effects
    gl.uniform1f(u.uHalation, fx.halation)
    gl.uniform1f(u.uBloom, fx.bloom)
    gl.uniform1f(u.uShoulder, fx.shoulder)
    gl.uniform1f(u.uFade, fx.fade)
    gl.uniform1f(u.uExposure, fx.exposure)
    gl.uniform1f(u.uRim, fx.rim)
    gl.uniform1f(u.uCrunch, fx.crunch)
    gl.uniform1f(u.uHaloAmount, fx.halo)
    gl.uniform1f(u.uStructureAmount, fx.structure)
    gl.uniform1f(u.uSolarize, fx.solarize)
    gl.uniform1f(u.uSolarizeFrom, fx.solarizeFrom)
    gl.uniform1f(u.uMonoAmount, fx.mono.enabled ? fx.mono.amount : 0)
    gl.uniform3f(u.uMonoMix, ...monoMix(fx.mono.filter))
    gl.uniform3f(u.uMonoTone, ...monoTone(fx.mono.tone))
    gl.uniform1f(u.uMonoToneAmount, fx.mono.tone === 'none' ? 0 : fx.mono.toneAmount)
    gl.uniform1f(u.uMonoContrast, fx.mono.contrast)
    {
      const h = fx.halftone
      const short = Math.min(req.baseSize.width, req.baseSize.height)
      gl.uniform1i(u.uHalftoneStyle, h.enabled && h.amount > 0 ? ['dots', 'lines', 'riso'].indexOf(h.style) : -1)
      gl.uniform1f(u.uHalftoneAmount, h.amount)
      gl.uniform1f(u.uHalftoneCell, Math.max(2, h.cell * short))
      gl.uniform1f(u.uHalftoneAngle, (h.angle * Math.PI) / 180)
      gl.uniform3f(u.uInkA, ...h.inkA)
      gl.uniform3f(u.uInkB, ...h.inkB)
      gl.uniform3f(u.uHalftonePaper, ...h.paper)
      gl.uniform1f(u.uHalftoneSlip, h.slip * short)
    }
    gl.uniform1f(u.uFollowColour, req.params.grainFollowsColour)
    gl.uniform1f(u.uDitherAmount, fx.dither.amount)
    gl.uniform1f(u.uDitherSteps, Math.max(2, fx.dither.steps))
    gl.uniform1f(u.uDitherSpread, fx.dither.spread)
    gl.uniform1f(u.uDitherFollow, fx.dither.follow)
    gl.uniform2f(u.uDitherFrom, fx.dither.from.x * print.width, fx.dither.from.y * print.height)
    gl.uniform2f(u.uDitherTo, fx.dither.to.x * print.width, fx.dither.to.y * print.height)
    gl.uniform1i(u.uDitherOval, fx.dither.shape === 'oval' ? 1 : 0)
    gl.uniform1f(u.uDitherStretch, fx.dither.stretch)
    const guides = fx.dither.guides.slice(0, MAX_BAND_GUIDES)
    const guideData = new Float32Array(MAX_BAND_GUIDES * 4)
    const short = Math.min(print.width, print.height)
    guides.forEach((g, i) =>
      guideData.set([(g.x * print.width) / short, (g.y * print.height) / short, g.radius, g.strength], i * 4),
    )
    gl.uniform4fv(u.uBandGuides, guideData)
    gl.uniform1i(u.uBandGuideCount, guides.length)
    // Not rounded: drawn at an export's size (PreviewCanvas asExported) a dot can be 2.5 photo pixels.
    gl.uniform1f(u.uDitherPixel, Math.max(1, fx.dither.pixel))
    gl.uniform1i(u.uDitherOrdered, fx.dither.pattern === 'ordered' ? 1 : 0)
    gl.uniform1f(u.uDitherClumps, fx.dither.pattern === 'grain' && fx.dither.pixel <= 1 ? Math.max(1, fx.dither.clumps ?? 1) : 1)
    gl.uniform1f(u.uDitherTransitions, this.calmResult ? fx.dither.transitionsOnly : 0)
    gl.uniform1f(u.uDitherSparePop, fx.dither.sparePop)
    gl.uniform2f(u.uDitherTone, fx.dither.toneLo, fx.dither.toneHi)
    // Streaks: each shape drawn into its own texture layer (see
    // buildStreakShapes), every path sampled into one shared array, all in
    // short-side units.
    // Shapes are placed on the photo, wherever it sits in the print, and
    // measured on it, so a border neither moves nor resizes them.
    const frame = fx.shapeSpace === 'print' ? { x: 0, y: 0, ...print } : photoFrame(req.baseSize, req.params.border)
    const measure = shapeMeasure(req.baseSize, req.params.border, fx.shapeUnits, fx.cropFrame)
    gl.uniform2f(u.uShapeOrigin, measure.x, measure.y)
    gl.uniform1f(u.uShapeUnit, measure.unit)
    const toShort = (p: { x: number; y: number }) => ({
      x: (frame.x + p.x * frame.width - measure.x) / measure.unit,
      y: (frame.y + p.y * frame.height - measure.y) / measure.unit,
    })
    const fromShort = (q: { x: number; y: number }) => ({
      x: (q.x * measure.unit + measure.x - frame.x) / frame.width,
      y: (q.y * measure.unit + measure.y - frame.y) / frame.height,
    })
    // A radial streak with a radius is a true circle round its outline's middle.
    const streaks = fx.streaks.shapes
      .slice(0, MAX_STREAKS)
      .map((sh) => (sh.radial && (sh.radialRadius ?? 0) > 0 && !sh.path ? { ...sh, outline: radialCircle(sh.outline.map(toShort), sh.radialRadius, sh.radialCentre && toShort(sh.radialCentre)).map(fromShort) } : sh))
    const f0 = toShort({ x: 0, y: 0 })
    const f1 = toShort({ x: 1, y: 1 })
    gl.uniform4f(u.uShapeFrame, f0.x, f0.y, f1.x, f1.y)
    const sShapes = this.buildLayers(
      this.streakLayers,
      streaks.map((shape) => ({
        outline: shape.outline,
        feather: shape.feather ?? 0,
        mode: shape.mode,
        trailLength: shape.length,
      })),
      measure,
      frame,
    )
    // Each path-following streak's path, in PATH_LEVELS versions (see pathFlow):
    // a row of samples each, point and tangent, in a float texture.
    const sPaths = new Float32Array(STREAK_PATH_SAMPLES * MAX_STREAKS * 2 * PATH_LEVELS * 4)
    const sPathReach = new Float32Array(MAX_STREAKS * 8)
    const sSweep = new Float32Array(MAX_STREAKS * 4)
    const sInfo = new Float32Array(MAX_STREAKS * 4)
    const sExtra = new Float32Array(MAX_STREAKS * 4)
    const sEnds = new Float32Array(MAX_STREAKS * 4)
    const sEdge = new Float32Array(MAX_STREAKS * 4)
    const sPathInfo = new Float32Array(MAX_STREAKS * 4)
    const sVanish = new Float32Array(MAX_STREAKS * 4)
    // A trail's end line: across-the-streak samples of where each line meets it.
    const sEndS = new Float32Array(MAX_STREAKS * END_SAMPLES)
    const sEndInfo = new Float32Array(MAX_STREAKS * 4)
    const sFlags = new Float32Array(MAX_STREAKS * 4)
    // Each streak's lens bend: k, and the photo's middle and half-diagonal in short-side units.
    const sBend = new Float32Array(MAX_STREAKS * 4)
    const pfLens = photoFrame(req.baseSize, req.params.border)
    // On a crop, the whole photo's middle and half-diagonal (EffectParams.cropFrame): a lens bends about the photo, not the crop.
    const cf = fx.shapeUnits !== 'print' ? fx.cropFrame : undefined
    const lensFrame = cf
      ? {
          cx: (pfLens.x + cf.cx * pfLens.width - measure.x) / measure.unit,
          cy: (pfLens.y + cf.cy * pfLens.height - measure.y) / measure.unit,
          R: (cf.r * Math.min(pfLens.width, pfLens.height)) / measure.unit,
        }
      : {
          cx: (pfLens.x + pfLens.width / 2 - measure.x) / measure.unit,
          cy: (pfLens.y + pfLens.height / 2 - measure.y) / measure.unit,
          R: Math.hypot(pfLens.width, pfLens.height) / 2 / measure.unit,
        }
    // Repeat: on, each copy's depth (short-side units), mirrored, each copy's size against the last.
    const sRepeat = new Float32Array(MAX_STREAKS * 4)
    // And its detail, scatter and the blur level its detail is measured against.
    const sRepeat2 = new Float32Array(MAX_STREAKS * 4)
    // And in perspective, how far the copies' own point is moved from the streak's (see repeatRead).
    const sRepeat3 = new Float32Array(MAX_STREAKS * 4)
    const sEndSoft = new Float32Array(MAX_STREAKS)
    // Colour stripes: their middle width, how far each edge may move and how
    // much of the edge's detail each keeps (see stripeRead).
    const sStripe = new Float32Array(MAX_STREAKS * 4)
    // Mirrored bars: the middle line across the flow (t), how far each side goes its own way, on.
    const sMirror = new Float32Array(MAX_STREAKS * 4)
    const sToneStart = new Float32Array(MAX_STREAKS * 4)
    const sToneEnd = new Float32Array(MAX_STREAKS * 4)
    const fSpan = new Float32Array(MAX_STREAK_FIXES * 4)
    const fFrom = new Float32Array(MAX_STREAK_FIXES * 4)
    const fInfo = new Float32Array(MAX_STREAK_FIXES * 4)
    const fColours = new Float32Array(MAX_STREAK_FIXES * MAX_FIX_COLOURS * 3)
    // Each fix's tone on its bars.
    const fTone = new Float32Array(MAX_STREAK_FIXES * 4)
    let fixCount = 0
    const lInfo = new Float32Array(MAX_STREAKS * 4)
    const lSpan = new Float32Array(MAX_STREAKS)
    const sCross = new Float32Array(MAX_STREAKS * 4)
    const follows = (shape: StreakShape) => shape.mode !== 'mask' && (shape.path?.length ?? 0) >= 2
    const rad = Math.PI / 180
    streaks.forEach((shape, i) => {
      // Its lens bend (StreakShape.bend): its lines worked out as through a
      // perfect lens, so its outline, ends and fixes are measured there too.
      const lens = shape.bend && !follows(shape) && !shape.radial ? { k: shape.bend, ...lensFrame } : null
      const toS = (p: { x: number; y: number }) => unbend(toShort(p), lens)
      sBend.set([lens ? lens.k : 0, lensFrame.cx, lensFrame.cy, lensFrame.R], i * 4)
      let reach = sShapes.reach[i]
      const a = shape.angle * rad
      const mode = shape.mode === 'mask' ? 2 : shape.mode === 'trail' ? 1 : 0
      sInfo.set([shape.mode !== 'mask' && shape.skipMasked !== false ? 1 : 0, follows(shape) ? (shape.pathWidth ?? 0) : 0, Math.cos(a), Math.sin(a)], i * 4)
      sEnds.set([shape.lengthMax ?? 1, shape.lengthMin ?? 1, shape.variation ?? 1, shape.anchor === 'far' ? 0 : 1], i * 4)
      const clipped = shape.mode === 'fill' && shape.clip !== false
      sEndSoft[i] = shape.endSoftness ?? shape.feather ?? 0
      const thick = shape.stripeMax ?? 0
      const thin = Math.min(shape.stripeMin ?? 0, thick)
      if (thick > 0) sStripe.set([(thin + thick) / 2, (thick - thin) / (thin + thick), Math.min(Math.max(shape.stripeTexture ?? 0, 0), 1), 0], i * 4)
      // Uneven bar widths ride in the stripes' spare slot (see streakAt).
      sStripe[i * 4 + 3] = Math.min(Math.max(shape.barVary ?? 0, 0), 0.95)
      sToneStart.set([shape.brightness ?? 0, shape.contrast ?? 0, shape.opacity ?? 1, shape.changeAt ?? 0], i * 4)
      sToneEnd.set(
        [
          shape.endBrightness ?? shape.brightness ?? 0,
          shape.endContrast ?? shape.contrast ?? 0,
          shape.endOpacity ?? shape.opacity ?? 1,
          shape.changeLength ?? 1,
        ],
        i * 4,
      )
      const featherAt = shape.featherAt === 'outside' ? 2 : shape.featherAt === 'centre' ? 1 : 0
      sFlags.set([clipped ? 1 : 0, clipped && shape.measure !== 'distance' ? 1 : 0, featherAt, shape.featherEdge === 'grain' ? 1 : 0], i * 4)
      sEdge.set([shape.feather ?? 0, shape.pull ?? 0, shape.length, (shape.tipAngle ?? 0) * rad], i * 4)
      // Repeat's settings go in for a streak that repeats, or one only some of whose fixes do.
      if (shape.carry === 'repeat' || (shape.fixes ?? []).some((f) => f.carry === 'repeat')) {
        const length = Math.max(shape.repeatLength ?? 0.08, 0.002)
        // z: mirrored (1) and varied (2), together.
        sRepeat.set([1, length, (shape.repeatMirror ? 1 : 0) + (shape.repeatVary === false ? 0 : 2), shape.repeatScale ?? 1], i * 4)
        // Detail is what is finer than about a tenth of a copy, in the photo's own pixels.
        const blurPx = Math.max(2, length * measure.unit * 0.1)
        sRepeat2.set([shape.repeatDetail ?? 0.8, shape.repeatFrom ?? 0, Math.log2(blurPx), shape.repeatHold ?? 0.5], i * 4)
        // A share of the streak's distance to its point (streakVanish: 1 / converge).
        const k = Math.min(MAX_CONVERGE, Math.abs(shape.converge ?? 0))
        if (k > 1e-4 && shape.repeatVanish) sRepeat3.set([shape.repeatVanish / k, 0, 0, 0], i * 4)
      }
      const followed = follows(shape) ? pathFlow(shape.path!.map(toShort), shape.outline.map(toShort), shape.pathEase ?? 1) : null
      if (followed) {
        followed.rows.forEach((versions, side) =>
          versions.forEach((row, level) =>
            row.forEach((p, k) =>
              sPaths.set([p.x, p.y, p.tx, p.ty], (((i * 2 + side) * PATH_LEVELS + level) * STREAK_PATH_SAMPLES + k) * 4),
            ),
          ),
        )
        sPathReach.set(followed.reach, i * 8)
        // How far the searches along a line look: along a winding path the
        // lines run further than the shape is across, and capped at that a
        // bar on the outside of a bend stopped short of the far side.
        const along = shape.outline.map((p) => streakCoords(toS(p), { x: 1, y: 0 }, followed).s)
        reach = Math.max(reach, Math.max(...along) - Math.min(...along) + 0.05)
      }
      sExtra.set([shape.band, shape.seed % 997, reach, mode], i * 4)
      // In perspective (no path): the lines run through a vanishing point.
      const flowDir = { x: Math.cos(a), y: Math.sin(a) }
      const vanish =
        shape.mode === 'mask' || followed ? null : streakVanish(shape.outline.map(toS), flowDir, shape.converge ?? 0, shape.radial ? Math.max(shape.band, 1e-3) : 0, shape.radialCentre && toS(shape.radialCentre))
      if (vanish) sVanish.set([vanish.x, vanish.y, vanish.r, vanish.g], i * 4)
      // Mirrored, about the line along the flow through its middle (streakMirrorAt).
      if (shape.mirror && shape.mode !== 'mask' && !shape.radial) {
        const t = streakCoords(toS(streakMirrorAt(shape)), flowDir, followed, vanish).t
        if (Number.isFinite(t)) sMirror.set([t, Math.min(Math.max(shape.mirrorVary ?? 0, 0), 1), 1, 0], i * 4)
      }
      // Radial Around: the edge circle's radius, in the sweep's spare slots (radial has no path).
      if (vanish && shape.radial && shape.radialAround) {
        const o = shape.outline.map(toS)
        const meanFrom = (pts: { x: number; y: number }[]) =>
          pts.reduce((sum, p) => sum + Math.hypot(p.x - vanish.x, p.y - vanish.y), 0) / Math.max(pts.length, 1)
        const radius = meanFrom(o)
        // With a Circle, the outline drawn is free: the rings stop at it.
        // How far the rings go: a set Reach past the edge; else, with a Circle, the outline drawn.
        const drawn = (shape.radialRadius ?? 0) > 0 ? meanFrom(fx.streaks.shapes[i].outline.map(toS)) : 0
        const outer = (shape.radialReach ?? 0) > 0 ? radius + shape.radialReach : drawn > radius ? drawn : 0
        sSweep.set([0, outer, radius, 1], i * 4)
      }
      if (shape.mode === 'trail' && shape.ends && shape.ends.length >= 2) {
        const own = shape.outline.map((p) => streakCoords(toS(p), flowDir, followed, vanish))
        const t0 = Math.min(...own.map((c) => c.t))
        const t1 = Math.max(...own.map((c) => c.t))
        const line = shape.ends.map((p) => streakCoords(toS(p), flowDir, followed, vanish))
        sEndS.set(endTable(line, t0, t1), i * END_SAMPLES)
        // Across from t0 in steps; the shape's nearest along, for the search back to it.
        sEndInfo.set([t0, Math.max((t1 - t0) / (END_SAMPLES - 1), 1e-6), Math.min(...own.map((c) => c.s)), 1], i * 4)
      }
      // The line table's extent: the shape's lines across (t) and along (s),
      // from its outline, which holds the extremes of both — but for the
      // nearest point to a vanishing point, which may be along a side.
      if (shape.mode !== 'mask' && (shape.skipMasked !== false || (shape.fixes?.length ?? 0) > 0)) {
        const dir = flowDir
        const st = shape.outline.map((p) => streakCoords(toS(p), dir, followed, vanish))
        const t0 = Math.min(...st.map((c) => c.t))
        const t1 = Math.max(...st.map((c) => c.t))
        // A fill skipping masked colours looks back past them (STREAK_MARCH).
        let s0 = Math.min(...st.map((c) => c.s)) - 0.01 - (shape.mode !== 'trail' && shape.skipMasked !== false ? STREAK_MARCH : 0)
        let s1 = Math.max(...st.map((c) => c.s)) + 0.01
        if (vanish) {
          const pts = shape.outline.map(toS)
          let near = Infinity
          pts.forEach((p, k) => {
            const q = pts[(k + 1) % pts.length]
            const ex = q.x - p.x
            const ey = q.y - p.y
            const f = Math.max(0, Math.min(1, ((vanish.x - p.x) * ex + (vanish.y - p.y) * ey) / Math.max(ex * ex + ey * ey, 1e-12)))
            near = Math.min(near, Math.hypot(p.x + ex * f - vanish.x, p.y + ey * f - vanish.y))
          })
          // Toward the point s is minus the distance: the near side is its top end.
          if (vanish.g > 0) s0 = Math.min(s0, near - 0.01)
          else s1 = Math.max(s1, -near + 0.01)
        }
        const count = Math.min(LINE_TABLE_WIDTH, Math.max(1, Math.ceil(((t1 - t0) / shape.band) * 4)))
        lInfo.set([t0, Math.max((t1 - t0) / count, 1e-6), count, s0], i * 4)
        lSpan[i] = s1 - s0
      }
      // Colour fixes: each span's ends placed across the flow, and the
      // stretches beside it a borrowing span takes its colours from.
      if (shape.mode !== 'mask')
        for (const fix of shape.fixes ?? []) {
          if (fixCount >= MAX_STREAK_FIXES) break
          const dir = { x: Math.cos(a), y: Math.sin(a) }
          const ta = streakCoords(toS(fix.a), dir, followed, vanish).t
          const tb = streakCoords(toS(fix.b), dir, followed, vanish).t
          const lo = Math.min(ta, tb)
          const hi = Math.max(ta, tb)
          fTone.set([fix.brightness, fix.contrast, fix.opacity, fix.feather], fixCount * 4)
          const before = fix.side !== 'after'
          const after = fix.side !== 'before'
          const n = fix.mode === 'colours' ? Math.min(fix.colours.length, MAX_FIX_COLOURS) : 0
          fSpan.set([i, lo, hi, fix.mode === 'colours' ? 1 : fix.mode === 'keep' ? 2 : 0], fixCount * 4)
          // Where it copies from (streakLean.ts, leanStretch): a part picked
          // on the photo, its lines from one side to the other (w 2), or
          // beside it, mirrored across its sides (z before, w after).
          if (fix.source) {
            const sa = streakCoords(toS(fix.source.a), dir, followed, vanish).t
            const sb = streakCoords(toS(fix.source.b), dir, followed, vanish).t
            fFrom.set([sa, sb, 0, 2], fixCount * 4)
          } else fFrom.set([0, 0, before ? 1 : 0, after ? 1 : 0], fixCount * 4)
          fInfo.set([(((fix.seed * 2654435761) >>> 0) / 4294967296) % 1, fix.variation, n, (fix.masked ? 1 : 0) + (fix.carry === 'repeat' ? 2 : fix.carry === 'colour' ? 4 : 0)], fixCount * 4)
          // Darkest first: the source's light and dark pick among them in order.
          const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
          ;[...fix.colours.slice(0, n)].sort((p, q) => lum(p) - lum(q)).forEach((c, k) => fColours.set(c, (fixCount * MAX_FIX_COLOURS + k) * 3))
          fixCount++
        }
      sPathInfo.set([followed?.sweep ? 1 : 0, followed ? STREAK_PATH_SAMPLES : 0, followed?.ds ?? 0, (shape.tipRange ?? 0) * rad], i * 4)
      if (followed?.sweep) sSweep.set([followed.sweep.x, followed.sweep.y, 0, 0], i * 4)
      // The lines the crossing table covers: the shape's layer and the frame,
      // and a margin, in the streak's own (s, t).
      if (shape.mode !== 'mask' && !(shape.radial && shape.radialAround)) {
        const r = sShapes.rects.slice(i * 4, i * 4 + 4)
        const x0 = Math.min(r[0], f0.x)
        const y0 = Math.min(r[1], f0.y)
        const x1 = Math.max(r[0] + r[2], f1.x)
        const y1 = Math.max(r[1] + r[3], f1.y)
        const mx = (x1 - x0) * 0.25
        const my = (y1 - y0) * 0.25
        let s0 = Infinity
        let s1 = -Infinity
        let t0 = Infinity
        let t1 = -Infinity
        const N = 24
        for (let a = 0; a <= N; a++)
          for (let b = 0; b <= N; b++) {
            const q = { x: x0 - mx + ((x1 - x0 + 2 * mx) * a) / N, y: y0 - my + ((y1 - y0 + 2 * my) * b) / N }
            const st = streakCoords(unbend(q, lens), flowDir, followed, vanish)
            if (!Number.isFinite(st.s) || !Number.isFinite(st.t)) continue
            s0 = Math.min(s0, st.s)
            s1 = Math.max(s1, st.s)
            t0 = Math.min(t0, st.t)
            t1 = Math.max(t1, st.t)
          }
        if (s1 > s0 && t1 > t0) sCross.set([s0, s1, t0, t1], i * 4)
      }
    })
    this.uploadPaths(sPaths)
    gl.uniform4fv(u.uCrossRange, sCross)
    gl.activeTexture(gl.TEXTURE10)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.streakLayers.texture)
    gl.uniform4fv(u.uStreakRect, sShapes.rects)
    gl.uniform4fv(u.uStreakPathReach, sPathReach)
    gl.uniform4fv(u.uStreakSweep, sSweep)
    gl.uniform4fv(u.uStreakInfo, sInfo)
    gl.uniform4fv(u.uStreakExtra, sExtra)
    gl.uniform4fv(u.uStreakEnds, sEnds)
    gl.uniform4fv(u.uStreakEdge, sEdge)
    gl.uniform4fv(u.uStreakPathInfo, sPathInfo)
    gl.uniform4fv(u.uStreakVanish, sVanish)
    gl.uniform4fv(u.uStreakEndS, sEndS)
    gl.uniform4fv(u.uStreakEndInfo, sEndInfo)
    gl.uniform4fv(u.uStreakFlags, sFlags)
    gl.uniform4fv(u.uStreakRepeat, sRepeat)
    gl.uniform4fv(u.uStreakBend, sBend)
    gl.uniform4fv(u.uStreakRepeat2, sRepeat2)
    gl.uniform4fv(u.uStreakRepeat3, sRepeat3)
    gl.uniform1fv(u.uStreakEndSoft, sEndSoft)
    gl.uniform4fv(u.uStreakStripe, sStripe)
    gl.uniform4fv(u.uStreakMirror, sMirror)
    gl.uniform4fv(u.uStreakToneStart, sToneStart)
    gl.uniform4fv(u.uStreakToneEnd, sToneEnd)
    gl.uniform1i(u.uStreakCount, streaks.length)
    gl.uniform4fv(u.uFixSpan, fSpan)
    gl.uniform4fv(u.uFixFrom, fFrom)
    gl.uniform4fv(u.uFixInfo, fInfo)
    gl.uniform3fv(u.uFixColours, fColours)
    gl.uniform1i(u.uFixCount, fixCount)
    gl.uniform4fv(u.uFixTone, fTone)
    gl.uniform1i(u.uLinePass, 0)

    // Masks: their own layers, how each is softened and keyed, and for each
    // section which masks it uses (a bit per mask) and how.
    // A mask switched off is kept but used by nothing: a section or streak
    // that only used it goes back to the whole photo.
    const masks = (fx.masks ?? []).slice(0, MAX_MASKS).map((m) => withOutline(m, frame))
    const live = (id: string) => masks.some((m) => m.id === id && maskOn(m))
    const sectionUse = MASK_SECTIONS.map((section) => fx.maskUse?.[section])
    const streakUse = streaks.map((sh) =>
      sh.maskMode && sh.maskMode !== 'off' ? masks.reduce((bits, m, i) => ((sh.maskIds ?? []).includes(m.id) && maskOn(m) ? bits | (1 << i) : bits), 0) : 0,
    )
    // Lights (LeakSpot.mask) are shaped by masks too.
    const lightsUse =
      req.params.modules.leaks !== false && fx.leaks.amount > 0 && fx.leaks.spots.some((s) => (s.mask && live(s.mask)) || (s.hold?.mask && live(s.hold.mask)))
    // A streak's Repeat kept to part of the subject by a mask: which mask, per streak (-1 none).
    // -2: the streak carries its colour, and only some of its fixes repeat.
    const repeatOn = streaks.map((sh) =>
      sh.carry !== 'repeat'
        ? (sh.fixes ?? []).some((f) => f.carry === 'repeat')
          ? -2
          : -1
        : sh.repeatMask && live(sh.repeatMask)
          ? masks.findIndex((m) => m.id === sh.repeatMask)
          : -1,
    )
    // A mask shown on the photo (RenderRequest.showMask) needs the masks too.
    const shownMask = req.showMask ? masks.findIndex((m) => m.id === req.showMask!.id && maskOn(m)) : -1
    const anyUsed =
      sectionUse.some((u) => u && u.ids.some(live)) || streakUse.some((bits) => bits !== 0) || lightsUse || repeatOn.some((k) => k >= 0) || shownMask >= 0
    // Under a collage, keyed masks keep the photo's own key (LayerShape.keyOn).
    const underCollage = collageLayers(req.imageSeed, fx.collage).length > 0
    // Leak shapes ride in the same layers, after the masks: each a distance
    // field of its outline (LayerShape.sdf), read once per pixel however many
    // points it has.
    const leakShapeSpots = fx.leaks.amount > 0
      ? fx.leaks.spots.slice(0, MAX_LEAK_SPOTS).flatMap((s, i) => (!s.mask && s.outline && s.outline.length >= MIN_OUTLINE_POINTS ? [i] : []))
      : []
    const leakBase = anyUsed ? masks.length : 0
    const printShort = Math.min(print.width, print.height)
    const mLayers = this.buildLayers(
      this.maskLayers,
      [
        ...(anyUsed
          ? masks.map((m) => ({
              outline: m.outline,
              // Keyed at the edge: the ramp spans the band the key works in.
              feather: edgeKeyed(m) ? m.keyBand ?? KEY_BAND : m.feather,
              ...(m.raster && maskKind(m) === 'subject' ? { raster: m.raster } : {}),
              ...(underCollage && m.key && m.key !== 'off' ? { keyOn: m.keyOn ?? 'brightness' } : {}),
              ...(edgeKeyed(m) && !underCollage ? { colourKey: true } : {}),
            }))
          : []),
        ...leakShapeSpots.map((i) => ({
          outline: isRounded(fx.leaks.spots[i]) ? roundedOutline(fx.leaks.spots[i].outline!, print) : fx.leaks.spots[i].outline!,
          // Room past the outline for the leak's own falloff.
          feather: (0.3 * printShort) / measure.unit,
          sdf: { frame: { x: 0, y: 0, width: print.width, height: print.height }, scale: measure.unit / printShort },
        })),
      ],
      measure,
      fx.shapeSpace === 'print' ? { x: 0, y: 0, ...print } : photoFrame(req.baseSize, req.params.border),
      underCollage ? { image: req.base, size: req.baseSize, frame: photoFrame(req.baseSize, req.params.border) } : undefined,
      { image: req.base, size: req.baseSize, frame: photoFrame(req.baseSize, req.params.border) },
    )
    const mFlags = new Float32Array(MAX_MASKS * 4)
    const mKey = new Float32Array(MAX_MASKS * 2)
    const mGrow = new Float32Array(MAX_MASKS)
    const mShape = new Float32Array(MAX_MASKS * 4)
    const mShape2 = new Float32Array(MAX_MASKS * 4)
    masks.forEach((m, i) => {
      mGrow[i] = m.grow ?? 0
      mFlags.set(
        [
          m.featherAt === 'outside' ? 2 : m.featherAt === 'centre' ? 1 : 0,
          m.keyOn === 'blue' ? 1 : 0,
          m.key === 'darker' ? 1 : m.key === 'lighter' ? 2 : 0,
          m.key === 'off' ? 0 : (m.cleanEdges ?? 1),
        ],
        i * 4,
      )
      mKey.set([m.keyLevel, Math.max(m.keySoftness, 0.002)], i * 2)
      // A radial or gradient mask, in shape units, worked out exactly (maskCover).
      const kind = maskKind(m)
      // y: keyed at the edge; z: a selection, with painting in its layer's red;
      // w: keyed at the edge by colour, the key worked out in its layer's blue.
      if (kind === 'outline' || kind === 'subject') mShape.set([0, edgeKeyed(m) ? 1 : 0, kind === 'subject' ? 1 : 0, edgeKeyed(m) && !underCollage ? 1 : 0], i * 4)
      const at = (x: number, y: number) => [(frame.x + x * frame.width - measure.x) / measure.unit, (frame.y + y * frame.height - measure.y) / measure.unit]
      if (kind === 'radial') {
        const r = m.radial!
        const [cx, cy] = at(r.x, r.y)
        const k = Math.min(frame.width, frame.height) / measure.unit
        mShape.set([1, cx, cy, (r.angle * Math.PI) / 180], i * 4)
        mShape2.set([r.rx * k, r.ry * k, r.soft, 0], i * 4)
      } else if (kind === 'gradient') {
        const g = m.gradient!
        mShape.set([2, ...at(g.x0, g.y0), 0], i * 4)
        mShape2.set([...at(g.x1, g.y1), 0, 0], i * 4)
      }
    })
    const sectionMask = new Int32Array(MASK_SECTIONS.length * 2)
    sectionUse.forEach((u, k) => {
      if (!u || !anyUsed) return
      let bits = 0
      masks.forEach((m, i) => {
        if (u.ids.includes(m.id) && maskOn(m)) bits |= 1 << i
      })
      sectionMask.set([bits, bits ? (u.mode === 'only' ? 2 : 1) : 0], k * 2)
    })
    gl.activeTexture(gl.TEXTURE11)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.maskLayers.texture)
    gl.uniform4fv(u.uMaskRect, mLayers.rects.subarray(0, MAX_MASKS * 4))
    gl.uniform4fv(u.uMaskFlags, mFlags)
    gl.uniform2fv(u.uMaskKey, mKey)
    gl.uniform1fv(u.uMaskGrow, mGrow)
    gl.uniform4fv(u.uMaskShape, mShape)
    gl.uniform4fv(u.uMaskShape2, mShape2)
    gl.uniform1i(u.uMaskCount, anyUsed ? masks.length : 0)
    gl.uniform2f(u.uShowMask, shownMask, req.showMask?.view === 'matte' ? 2 : req.showMask?.view === 'green' ? 1 : 0)
    const sRepeatMask = new Float32Array(MAX_STREAKS).fill(-1)
    repeatOn.forEach((k, i) => i < MAX_STREAKS && (sRepeatMask[i] = k))
    gl.uniform1fv(u.uStreakRepeatMask, sRepeatMask)
    gl.uniform2iv(u.uSectionMask, sectionMask)
    // Each streak's own masks and key.
    const sMask = new Int32Array(MAX_STREAKS * 2)
    const sKey = new Float32Array(MAX_STREAKS * 4)
    streaks.forEach((sh, i) => {
      if (i >= MAX_STREAKS) return
      if (streakUse[i]) sMask.set([streakUse[i], sh.maskMode === 'only' ? 2 : 1], i * 2)
      if (sh.key && sh.key !== 'off')
        sKey.set([sh.key === 'darker' ? 1 : 2, sh.keyOn === 'blue' ? 1 : 0, sh.keyLevel ?? 0.5, Math.max(sh.keySoftness ?? 0.08, 0.002)], i * 4)
    })
    gl.uniform2iv(u.uStreakMask, sMask)
    gl.uniform4fv(u.uStreakKey, sKey)
    gl.uniform1i(u.uStreakKeyed, sKey.some((v, k) => k % 4 === 0 && v > 0) ? 1 : 0)
    {
      const shortPx = Math.min(req.baseSize.width, req.baseSize.height)
      gl.uniform1f(u.uPrism, streaks.length ? (fx.streaks.prism ?? 0) * shortPx : 0)
      const turn = ((fx.streaks.prismAngle ?? 0) * Math.PI) / 180
      gl.uniform2f(u.uPrismTurn, Math.cos(turn), Math.sin(turn))
      const glass = fx.glass ?? DEFAULT_GLASS
      const a = (glass.angle * Math.PI) / 180
      gl.uniform4f(u.uGlass, glassAmount(glass), glass.kind === 'facets' ? 1 : glass.kind === 'ripple' ? 2 : 0, glass.width * shortPx, glass.dispersion)
      gl.uniform4f(u.uGlassAxis, Math.cos(a), Math.sin(a), glass.edges, 0)
    }
    // The lens's distortion, here rather than in the develop pass, so all
    // that is on the photo (streaks, masks, lights, copies) bends with it.
    gl.uniform1f(u.uLensK, lensOn(fx.lens) ? fx.lens.distortion * LENS_K : 0)
    gl.uniform1f(u.uStreakAmount, streaks.length ? fx.streaks.amount : 0)
    // The line table is only wanted where something holds the streaks back:
    // a streak mask, or a mask the streaks section keeps off.
    const holds = streaks.some((sh) => sh.mode === 'mask') || (sectionMask[5 * 2] !== 0 && sectionMask[5 * 2 + 1] === 1)
    this.leanHolds = holds
    // Fixes read their sources from the table too.
    streaks.forEach((sh, i) => {
      if (!holds && !(sh.mode !== 'mask' && (sh.fixes?.length ?? 0) > 0)) lInfo.fill(0, i * 4, i * 4 + 4)
    })
    gl.uniform4fv(u.uLineInfo, lInfo)
    gl.uniform1fv(u.uLineSpan, lSpan)
    const art = fx.pixelArt
    gl.uniform1f(u.uPixelate, blockSize(fx))
    gl.uniform1f(u.uPixelKeep, keepLinesOf(fx))
    const colours =
      art.palette === 'off' ? [] : art.palette === 'photo' ? (photoColours ?? []) : FIXED_PALETTES[art.palette].colours
    const paletteData = new Float32Array(MAX_PALETTE * 3)
    colours.slice(0, MAX_PALETTE).forEach((c, i) => paletteData.set(c, i * 3))
    gl.uniform3fv(u.uPalette, paletteData)
    gl.uniform1i(u.uPaletteCount, Math.min(MAX_PALETTE, colours.length))
    gl.uniform1f(u.uPaletteAmount, art.amount)
    gl.uniform1f(u.uPaletteDither, art.dither)
    gl.uniform1f(u.uPaletteSpacing, paletteSpacing(colours))
    // The dither reads the grain as unit noise: divide by the plate's
    // contrast after normalisation, so Spread means the same on any grain.
    const effectiveSd = normalise === 'match' ? REFERENCE_PLATE_SD : plateSd
    gl.uniform1f(u.uDitherNoise, 1 / Math.max(effectiveSd, 0.01))
    const stock = stockById(fx.stock.id)
    gl.uniform1f(u.uStockStrength, stock.id === 'none' ? 0 : fx.stock.strength)
    gl.uniform1f(u.uStreakUngraded, fx.streaks.enabled && fx.streaks.graded === false ? 1 : 0)
    gl.uniform4fv(u.uHueMoves, packHueMoves(stock))
    gl.uniform1i(u.uHueMoveCount, Math.min(MAX_HUE_MOVES, stock.moves.length))
    gl.uniform3f(u.uStockLift, ...stock.lift)
    gl.uniform3f(u.uStockGain, ...stock.gain)
    gl.uniform1f(u.uStockSat, stock.saturation)
    gl.uniform1f(u.uStockContrast, stock.contrast)
    gl.uniform1f(u.uStockKeepTone, fx.stock.keepTone)
    const leaks = fx.leaks
    const spots = leaks.spots.slice(0, MAX_LEAK_SPOTS)
    const shortSide = Math.min(print.width, print.height)
    const geo = new Float32Array(MAX_LEAK_SPOTS * 4)
    const axis = new Float32Array(MAX_LEAK_SPOTS * 4)
    const tints = new Float32Array(MAX_LEAK_SPOTS * 3)
    const pathInfo = new Float32Array(MAX_LEAK_SPOTS * 2)
    const leakRects = new Float32Array(MAX_LEAK_SPOTS * 4)
    // A shape's lighting: falloff, direction it comes from (radians), key
    // (0 off; 1 + level darker; -(1 + level) lighter; blue measured: +4 / -4
    // more), key softness.
    const leakLight = new Float32Array(MAX_LEAK_SPOTS * 4)
    const pathPoints = new Float32Array(PATH_SAMPLES * 2)
    const outlineCount = spots.filter((s) => !s.mask && s.outline && s.outline.length >= MIN_OUTLINE_POINTS).length
    let used = 0
    const maskList = (fx.masks ?? []).slice(0, MAX_MASKS)
    spots.forEach((spot, i) => {
      tints.set(tintOf((spot.colour ?? leaks.colour).colour), i * 3)
      const a = (spot.angle * Math.PI) / 180
      if (spot.mask) {
        // A light: its mask's layer (x), marked by a count of -1; how much it
        // falls off, toward the side away from where it comes from. A mask
        // that is gone lights nothing.
        const m = maskList.findIndex((mk) => mk.id === spot.mask && maskOn(mk))
        pathInfo.set([Math.max(m, 0), -1], i * 2)
        // y: a glow round the mask, how far it reaches; 0 lights the mask itself.
        // z: Lighting's light softened (LightShape.soft), in shape units.
        geo.set([spot.falloff ?? 0, spot.glow ?? 0, spot.lightMode ? Math.max(spot.edge ?? 0, 0) : 0, 0], i * 4)
        axis.set([Math.cos(a), Math.sin(a), m < 0 ? 0 : spot.strength, leakCode(spot)], i * 4)
        return
      }
      const layerAt = leakShapeSpots.indexOf(i)
      if (layerAt >= 0) {
        // Its layer (a distance field, see LayerShape.sdf), marked by a count of -2.
        const layer = leakBase + layerAt
        const pts = (isRounded(spot) ? roundedOutline(spot.outline!, print) : spot.outline!).map((p) => ({ x: (p.x * print.width) / shortSide, y: (p.y * print.height) / shortSide }))
        const { axis: dir } = shapeMetrics(pts)
        const depth = this.maskLayers.deepest?.[layer] ?? 0.05
        pathInfo.set([layer, -2], i * 2)
        const lvl = spot.keyLevel ?? 0.4
        const blue = spot.keyOn === 'blue' ? 4 : 0
        const keyCode = spot.key === 'darker' ? 1 + lvl + blue : spot.key === 'lighter' ? -(1 + lvl + blue) : 0
        leakLight.set([spot.falloff ?? 0, (spot.angle * Math.PI) / 180, keyCode, Math.max(spot.keySoftness ?? 0.08, 0.002)], i * 4)
        leakRects.set(mLayers.rects.subarray(layer * 4, layer * 4 + 4), i * 4)
        geo.set([depth, (spot.seed ?? i * 7.3) % 997, spot.texture ?? 1, spot.edge ?? 0.03], i * 4)
        axis.set([dir[0], dir[1], spot.strength, leakCode(spot)], i * 4)
        return
      }
      if (spot.outline && spot.outline.length >= MIN_OUTLINE_POINTS) {
        // Sampled in short-side units, where distances are isotropic.
        const control = spot.outline.map((p) => ({
          x: (p.x * print.width) / shortSide,
          y: (p.y * print.height) / shortSide,
        }))
        const samples = sampleOutline(control, samplesPerSpan(control.length, outlineCount)).slice(
          0,
          PATH_SAMPLES - used,
        )
        samples.forEach((p, k) => pathPoints.set([p.x, p.y], (used + k) * 2))
        pathInfo.set([used, samples.length], i * 2)
        used += samples.length
        const { depth, axis: dir } = shapeMetrics(samples)
        // z, w: its breakup and soft edge (LeakSpot.texture, edge).
        geo.set([depth, (spot.seed ?? i * 7.3) % 997, spot.texture ?? 1, spot.edge ?? 0.03], i * 4)
        axis.set([dir[0], dir[1], spot.strength, leakCode(spot)], i * 4)
        return
      }
      geo.set([(spot.x * print.width) / shortSide, (spot.y * print.height) / shortSide, spot.size, spot.stretch], i * 4)
      axis.set([Math.cos(a), Math.sin(a), spot.strength, leakCode(spot)], i * 4)
    })
    gl.uniform1f(u.uLeak, spots.length ? leaks.amount : 0)
    gl.uniform1i(u.uLeakCount, spots.length)
    gl.uniform1f(u.uLeakSeed, leaks.seed % 983)
    gl.uniform4fv(u.uLeakGeo, geo)
    gl.uniform4fv(u.uLeakAxis, axis)
    gl.uniform3fv(u.uLeakTint, tints)
    // A light's mask and whether it is behind the streaks (LeakSpot.hold).
    const lightHolds = new Float32Array(MAX_LEAK_SPOTS * 4)
    spots.forEach((spot, i) => {
      const mi = spot.hold?.mask ? (fx.masks ?? []).slice(0, MAX_MASKS).findIndex((m) => m.id === spot.hold!.mask && maskOn(m)) : -1
      lightHolds.set([mi, spot.hold?.behindStreaks ? 1 : 0, spot.hold?.inside ? 1 : 0, 0], i * 4)
    })
    gl.uniform4fv(u.uLeakHold, lightHolds)
    gl.uniform1i(u.uLightBehind, lightBehind(spots) ? 1 : 0)
    gl.uniform2fv(u.uLeakPath, pathInfo)
    gl.uniform4fv(u.uLeakRect, leakRects)
    gl.uniform4fv(u.uLeakLight, leakLight)
    gl.uniform2fv(u.uLeakPoints, pathPoints)
    gl.uniform3f(u.uGlowTint, ...tintOf(fx.glowColour.colour))
    const grade = fx.grade
    gl.uniform1f(u.uVibrance, grade.vibrance)
    gl.uniform1f(u.uWarmth, grade.warmth)
    gl.uniform1f(u.uTint, grade.tint)
    gl.uniform3f(u.uShadowTint, ...grade.shadowTint.colour)
    gl.uniform1f(u.uShadowAmount, grade.shadowAmount)
    gl.uniform3f(u.uHighlightTint, ...grade.highlightTint.colour)
    gl.uniform1f(u.uHighlightAmount, grade.highlightAmount)
    gl.uniform1f(u.uMapAmount, grade.mapAmount)
    gl.uniform3f(u.uMapShadow, ...grade.mapShadow.colour)
    gl.uniform3f(u.uMapMid, ...grade.mapMid.colour)
    gl.uniform3f(u.uMapHigh, ...grade.mapHigh.colour)
    gl.uniform2f(u.uMapRange, palette.range[0], palette.range[1])
    gl.uniform3f(u.uMapShape, grade.mapContrast, grade.mapBalance, 0)
    const blobs = grade.blobs.filter((b) => b.strength > 0).slice(0, MAX_BLOBS)
    const blobA = new Float32Array(MAX_BLOBS * 4)
    const blobB = new Float32Array(MAX_BLOBS * 4)
    blobs.forEach((b, i) => {
      blobA.set([b.x, b.y, b.reach, b.strength], i * 4)
      blobB.set([b.tone, b.toneWidth, 0, 0], i * 4)
    })
    gl.uniform1i(u.uBlobCount, blobs.length)
    gl.uniform4fv(u.uBlobA, blobA)
    gl.uniform4fv(u.uBlobB, blobB)
    gl.uniform1f(u.uIsolateAmount, grade.isolateAmount)
    gl.uniform1f(u.uIsolateHue, hueOf(grade.isolateColour.colour))
    gl.uniform1f(u.uIsolateWidth, grade.isolateWidth)
    gl.uniform1f(u.uPopAmount, grade.popAmount)
    gl.uniform1f(u.uPopKeep, grade.mapAmount > 0 ? grade.popKeep : 0)
    gl.uniform3f(u.uPopColour, ...grade.popColour.colour)
    gl.uniform3f(u.uRestColour, ...grade.restColour.colour)
    gl.uniform1i(u.uCollageOwn, this.collageOwn ? 1 : 0)
    gl.uniform1i(
      u.uHasGrade,
      fx.dither.sparePop > 0 ||
        grade.vibrance !== 0 ||
        grade.warmth !== 0 ||
        grade.tint !== 0 ||
        grade.shadowAmount > 0 ||
        grade.highlightAmount > 0 ||
        grade.mapAmount > 0 ||
        grade.blobs.some((b) => b.strength > 0) ||
        grade.isolateAmount > 0 ||
        grade.popAmount > 0
        ? 1
        : 0,
    )
    gl.uniform1f(u.uVignette, fx.vignette)
    gl.uniform1f(u.uDefectStrength, fx.defects.strength)
    gl.uniform1f(u.uScanLines, fx.defects.scanLines)
    gl.uniform1f(u.uScanStreaks, fx.defects.scanStreaks)
    gl.uniform1f(u.uScanSeed, fx.defects.seed % 997)
    gl.uniform1f(u.uPixelScale, pixelScaleOf(req.params))
    const surge = fx.surge
    gl.uniform1f(u.uSurgeStrength, surge.strength)
    gl.uniform1i(u.uSurgeCount, Math.min(8, Math.round(surge.count)))
    gl.uniform1f(u.uSurgeWidth, surge.width)
    gl.uniform1f(u.uSurgeAngle, surge.angle)
    gl.uniform1f(u.uSurgeSeed, surge.seed % 991)

    // Shifts chosen so each channel's curve peaks where the reference measured:
    // blue at 0.19, green at 0.31 and red at 0.56 of their own densities,
    // against a curve peaking near 0.42.
    const spread = req.params.layerSpread
    gl.uniform1i(u.uPerChannelResponse, req.params.responseMode === 'channel' ? 1 : 0)
    gl.uniform3f(u.uLayerShift, 0.14 * spread, -0.11 * spread, -0.23 * spread)

    const border = req.params.border
    const edge = Math.round(border.width * Math.min(req.baseSize.width, req.baseSize.height))
    gl.uniform2f(u.uPrintSize, print.width, print.height)
    gl.uniform2f(u.uImageOffset, edge, edge)
    gl.uniform3f(u.uPaperColour, border.colour[0], border.colour[1], border.colour[2])
    gl.uniform1f(u.uPaperTexture, border.texture)
    // Wander scaled to the border: a 2px wobble is invisible against a wide
    // border and overwhelming against a thin one.
    // Wander and softness in print pixels, scaled to the photo, not the border
    // width: an edge is the same physical thing however much paper is around it.
    const shortPx = Math.min(req.baseSize.width, req.baseSize.height)
    gl.uniform1f(u.uEdgeIrregularity, border.irregularity * shortPx * 0.004)
    // Not rough at all, a clean cut: on a pixel's edge, as a digital border
    // is, so no pixel along it is part photo and part paper (with the
    // photo's grain on the paper). Rounded corners are still smoothed.
    gl.uniform1f(u.uEdgeSoftness, border.irregularity > 0 ? 0.6 + border.irregularity * shortPx * 0.0015 : 0.5)
    gl.uniform1f(u.uBorderSeed, border.seed % 1000)
    gl.uniform1f(u.uBorderGrain, border.grain)
    gl.uniform1i(u.uHasBorder, border.width > 0 || border.bottomExtra > 0 ? 1 : 0)
    // The rest of the border: a gradient, rounded corners, a shadow, a bevel, a line, an inset.
    const c2 = border.colour2 ?? border.colour
    gl.uniform3f(u.uPaperColour2, c2[0], c2[1], c2[2])
    gl.uniform1i(u.uPaperFill, border.fill === 'linear' ? 1 : border.fill === 'radial' ? 2 : 0)
    gl.uniform1i(u.uPaperKind, Math.max(0, PAPER_KINDS.indexOf(border.paper ?? 'paper')))
    gl.uniform1i(u.uEdgeKind, Math.max(0, EDGE_KINDS.indexOf(border.edge ?? 'printed')))
    const fa = ((border.fillAngle ?? 90) * Math.PI) / 180
    gl.uniform2f(u.uPaperDir, Math.cos(fa), Math.sin(fa))
    gl.uniform1f(u.uCornerRadius, (border.corner ?? 0) * shortPx)
    gl.uniform1f(u.uShadow, border.shadow ?? 0)
    gl.uniform1f(u.uShadowBlur, Math.max(1, (border.shadowSize ?? 0.02) * shortPx))
    const sa = ((border.shadowAngle ?? 60) * Math.PI) / 180
    const sd = (border.shadowDistance ?? 0.008) * shortPx
    gl.uniform2f(u.uShadowOffset, Math.cos(sa) * sd, Math.sin(sa) * sd)
    gl.uniform1f(u.uBevelWidth, (border.bevel ?? 0) * shortPx)
    gl.uniform1f(u.uBevelLight, border.bevelLight ?? 0.6)
    const line = border.line ?? 0
    gl.uniform1f(u.uLineWidth, line > 0 ? Math.max(1, line * shortPx) : 0)
    gl.uniform1f(u.uLineGap, (border.lineGap ?? 0) * shortPx)
    const lc = border.lineColour ?? [0.1, 0.1, 0.1]
    gl.uniform3f(u.uLineColour, lc[0], lc[1], lc[2])
    gl.uniform1f(u.uInset, border.inset ?? 0)
    gl.uniform1f(u.uInsetSize, 0.025 * shortPx)

    this.bindDefects(req, print)
    // A mip level roughly a sixteenth of the plate across: large enough to be
    // only density, small enough not to eat the grain itself.
    const longest = Math.max(req.grainSize.width, req.grainSize.height)
    gl.uniform1f(u.uFlattenLod, Math.max(0, Math.log2(longest) - 4))
    this.uploadCurve(req.params.response)

    gl.activeTexture(gl.TEXTURE12)
    gl.bindTexture(gl.TEXTURE_2D, this.blankTexture())
    // The streaks' programs, before anything is drawn with them: in the
    // background, one still building (or failed) leaves the streaks out of
    // this render, drawn when it is ready (streaksReady, asked by the page).
    if (this.leanOn && streaks.length && fx.streaks.amount > 0) {
      this.leanWanted = this.leanNeeded()
      const states = this.leanWanted.map((w) => this.leanState(w.kind, w.v))
      if (states.includes('failed') && !this.background) {
        const failed = this.leanWanted.find((w) => this.leanFailed[leanName(w.kind, w.v)])!
        throw new Error(`The streaks' ${leanName(failed.kind, failed.v)} shader failed to build: ${this.leanFailed[leanName(failed.kind, failed.v)]}`)
      }
      if (states.some((st) => st !== 'ready')) {
        this.leanOn = false
        this.streaksLeftOut = true
      }
    }
    if (this.leanOn && streaks.length && fx.streaks.amount > 0) this.drawCrossTable(JSON.stringify([streaks, sCross, this.streakLayers.keys]))
    // Skipping masked colours: the line table, by a lean program of its own.
    if (this.leanOn && this.leanHolds && streaks.length && fx.streaks.amount > 0 && lInfo.some((v, k) => k % 4 === 2 && v > 0)) this.drawLineTable(true)
    if (this.renderStreaks && streaks.length && fx.streaks.amount > 0 && lInfo.some((v, k) => k % 4 === 2 && v > 0)) this.drawLineTable()

    // The wide passes: their own targets, programs and viewports, so the main
    // program is put back after. With streaks, from the streaked photo.
    const streaksOn = (this.renderStreaks || this.leanOn) && streaks.length > 0 && fx.streaks.amount > 0
    const cleans =
      streaksOn &&
      sectionMask[5 * 2 + 1] !== 0 &&
      masks.some((m, i) => (sectionMask[5 * 2] >> i) & 1 && m.key !== 'off' && (m.cleanEdges ?? 1) > 0)
    this.buildMatte(req, region, cleans)
    this.buildStreaked(req, region, streaksOn)
    gl.uniform1i(u.uPassesStreaked, this.passSource ? 1 : 0)
    this.buildGlow(req)
    this.buildDetail(req)
    this.buildHalo(req)
    this.buildStructure(req)
    this.buildCalm(req)
    this.buildStreakGlow(req)
    gl.useProgram(this.program)
    gl.uniform1f(u.uStreakGlowAmount, this.streakGlowResult ? (fx.streaks.glow ?? 0) : 0)
    gl.uniform1f(u.uDitherTransitions, this.calmResult ? fx.dither.transitionsOnly : 0)
    gl.activeTexture(gl.TEXTURE3)
    gl.bindTexture(gl.TEXTURE_2D, this.glowResult?.texture ?? this.blankTexture())
    gl.activeTexture(gl.TEXTURE5)
    gl.bindTexture(gl.TEXTURE_2D, this.detailResult?.texture ?? this.blankTexture())
    gl.activeTexture(gl.TEXTURE6)
    gl.bindTexture(gl.TEXTURE_2D, this.haloResult?.texture ?? this.blankTexture())
    gl.activeTexture(gl.TEXTURE7)
    gl.bindTexture(gl.TEXTURE_2D, this.structureResult?.texture ?? this.blankTexture())
    gl.activeTexture(gl.TEXTURE8)
    gl.bindTexture(gl.TEXTURE_2D, (this.calmResult && this.calmPacked?.texture) || this.blankTexture())
    gl.activeTexture(gl.TEXTURE9)
    gl.bindTexture(gl.TEXTURE_2D, this.streakGlowResult?.texture ?? this.blankTexture())
    this.bindMatte()
    gl.viewport(0, 0, width, height)
    // Any WebGL error before the streaks are drawn is someone else's: cleared, so one after is theirs.
    if (streaksOn && !this.streakErrorReported) while (gl.getError() !== gl.NO_ERROR);
    gl.uniform2i(u.uCacheOffset, 0, 0)
    const cached = this.cacheStreaks(req, region, width, height, streaksOn)
    if (streaksOn && !cached && this.leanOn) this.drawLeanTiles(width, height)
    else if (streaksOn && !cached) this.drawStrips(width, height)
    else gl.drawArrays(gl.TRIANGLES, 0, 3)
    // Streaks have drawn nothing on some Windows machines (WebGL through
    // Direct3D) with no error thrown: a WebGL error here says where, once.
    if (streaksOn && !this.streakErrorReported) {
      const code = gl.getError()
      if (code !== gl.NO_ERROR) {
        this.streakErrorReported = true
        engineReport?.('error', 'WebGL error drawing streaks', { code, cached, width, height, floatTargets: this.canRenderFloat, gpu: this.gpuName() })
      }
    }
    // The matte back on its units: nothing may read the cache while the next
    // render draws into it.
    gl.uniform1i(u.uStreakCacheOn, 0)
    this.bindMatte()
    return this.canvas
  }

  /**
   * The streak search is most of a render's cost, and its results depend
   * only on the streaks, the masks, the photo and the view: kept per output
   * pixel, a look edit (grain, colour, light) reads them instead of searching
   * again. Searched afresh into the cache when any of those change, then
   * bound for the main pass on the matte's units, which only the search
   * reads. Needs float targets; a render too large for one searches as before.
   */
  private cacheStreaks(req: RenderRequest, region: Rect, width: number, height: number, on: boolean): boolean {
    const gl = this.gl
    const u = this.uniforms
    gl.uniform1i(u.uStreakCacheOn, 0)
    if (!on || !this.canRenderFloat || width * height > STREAK_CACHE_MAX_PX) return false
    const fx = req.params.effects
    const key = JSON.stringify([
      this.idOf(this.sourceId),
      req.baseSize,
      borderShape(req.params.border),
      { ...fx.streaks, glow: 0, glowRadius: 0 },
      fx.masks,
      fx.maskUse,
      fx.shapeSpace,
      fx.shapeUnits,
      blockSize(fx),
      glassAmount(fx.glass) > 0 ? { ...fx.glass, enabled: true } : 0,
      lensOn(fx.lens) ? fx.lens.distortion : 0,
      // The search also finds how far a light behind the streaks moves.
      lightBehind(fx.leaks.spots.slice(0, MAX_LEAK_SPOTS)),
      region,
      width,
      height,
    ])
    let cache = this.streakCache.find((c) => c.width === width && c.height === height)
    if (!cache) {
      const bytes = (c: { width: number; height: number }) => c.width * c.height * 32
      while (
        this.streakCache.length &&
        (this.streakCache.length >= STREAK_CACHE_SLOTS ||
          this.streakCache.reduce((n, c) => n + bytes(c), 0) + bytes({ width, height }) > STREAK_CACHE_BUDGET)
      ) {
        const old = this.streakCache.reduce((a, c) => (c.used < a.used ? c : a))
        gl.deleteTexture(old.a)
        gl.deleteTexture(old.b)
        gl.deleteFramebuffer(old.framebuffer)
        this.streakCache.splice(this.streakCache.indexOf(old), 1)
      }
      const make = (format: number) => {
        const texture = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE14)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        return texture
      }
      const a = make(gl.RGBA32F)
      const b = make(gl.RGBA32F)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0)
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      // The matte (or blanks) back where they were.
      this.bindMatte()
      if (!complete) {
        gl.deleteTexture(a)
        gl.deleteTexture(b)
        gl.deleteFramebuffer(framebuffer)
        return false
      }
      cache = { a, b, framebuffer, width, height, key: '', used: 0 }
      this.streakCache.push(cache)
    }
    cache.used = ++this.streakCacheClock
    if (cache.key !== key) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, cache.framebuffer)
      gl.uniform1i(u.uLinePass, 5)
      if (this.leanOn) this.drawLean(width, height)
      else this.drawStrips(width, height)
      gl.uniform1i(u.uLinePass, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      cache.key = key
    }
    gl.activeTexture(gl.TEXTURE14)
    gl.bindTexture(gl.TEXTURE_2D, cache.a)
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, cache.b)
    gl.uniform1i(u.uStreakCacheOn, 1)
    return true
  }

  /**
   * A picture too large for one streak cache (an export), with the lean
   * programs: a band of rows at a time, each band's streaks into a cache of
   * its own size, then the look's pass over that band reading it. Each band
   * is drawn with margins above and below, where the prism reads the
   * neighbouring pixels' streaks. Its targets are freed after.
   */
  private tileCache: { a: WebGLTexture; b: WebGLTexture; framebuffer: WebGLFramebuffer; width: number; height: number } | null = null
  /** Pixels in one band with its margins (STREAK_TILE_PX; the lab makes it smaller to test the seams). */
  tilePx = STREAK_TILE_PX
  private drawLeanTiles(width: number, height: number): void {
    const gl = this.gl
    const u = this.uniforms
    // The prism splits by up to 1.5% of the short side (and the glass a little more).
    const margin = Math.ceil(0.025 * Math.min(width, height)) + 8
    const rows = Math.max(64, Math.floor(this.tilePx / width) - 2 * margin)
    const th = Math.min(height, rows) + 2 * margin
    const target = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null
    const tile = this.tileCacheFor(width, th)
    for (let y0 = 0; y0 < height; y0 += rows) {
      const h = Math.min(rows, height - y0)
      const top = y0 - margin
      // This band's streaks: the whole picture's quad, moved down so the band and its margins land in the cache.
      gl.bindFramebuffer(gl.FRAMEBUFFER, tile.framebuffer)
      gl.viewport(0, -top, width, height)
      this.drawLean(width, th)
      // The look over the band, reading its cache from the band's first row.
      gl.bindFramebuffer(gl.FRAMEBUFFER, target)
      gl.viewport(0, 0, width, height)
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, tile.a)
      gl.activeTexture(gl.TEXTURE15)
      gl.bindTexture(gl.TEXTURE_2D, tile.b)
      gl.uniform1i(u.uStreakCacheOn, 1)
      gl.uniform2i(u.uCacheOffset, 0, top)
      gl.enable(gl.SCISSOR_TEST)
      gl.scissor(0, y0, width, h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disable(gl.SCISSOR_TEST)
      gl.flush()
      this.bindMatte()
    }
    gl.uniform2i(u.uCacheOffset, 0, 0)
    gl.uniform1i(u.uStreakCacheOn, 0)
    // An export's bands are not drawn again: their graphics memory back now.
    this.freeTileCache()
    this.freeLeanTargets(width, th)
    if (this.leanLight?.height === th) this.freeLeanLight()
  }

  private freeTileCache(): void {
    if (!this.tileCache) return
    const gl = this.gl
    gl.deleteTexture(this.tileCache.a)
    gl.deleteTexture(this.tileCache.b)
    gl.deleteFramebuffer(this.tileCache.framebuffer)
    this.tileCache = null
  }

  /** The lean draws' targets at one size (or every size) deleted. */
  private freeLeanTargets(width?: number, height?: number): void {
    const gl = this.gl
    for (const t of this.leanTargets.filter((t) => width === undefined || (t.width === width && t.height === height))) {
      gl.deleteTexture(t.a)
      gl.deleteTexture(t.b)
      gl.deleteTexture(t.c)
      gl.deleteFramebuffer(t.framebuffer)
      this.leanTargets.splice(this.leanTargets.indexOf(t), 1)
    }
  }

  private tileCacheFor(width: number, height: number) {
    const gl = this.gl
    if (this.tileCache && this.tileCache.width === width && this.tileCache.height === height) return this.tileCache
    if (this.tileCache) {
      gl.deleteTexture(this.tileCache.a)
      gl.deleteTexture(this.tileCache.b)
      gl.deleteFramebuffer(this.tileCache.framebuffer)
    }
    const make = (format: number) => {
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      return texture
    }
    const a = make(gl.RGBA32F)
    const b = make(gl.RGBA32F)
    const framebuffer = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, a, 0)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, b, 0)
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1])
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.tileCache = { a, b, framebuffer, width, height }
    this.bindMatte()
    return this.tileCache
  }

  /** The matte's two textures on their units, or blanks without one. */
  private bindMatte(): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE14)
    gl.bindTexture(gl.TEXTURE_2D, this.matteOn && this.matte ? this.matte.back : this.blankTexture())
    gl.activeTexture(gl.TEXTURE15)
    gl.bindTexture(gl.TEXTURE_2D, this.matteOn && this.matte ? this.matte.fore : this.blankTexture())
    gl.uniform1i(this.uniforms.uMatteOn, this.matteOn && this.matte ? 1 : 0)
  }

  /**
   * For masks that keep things in front of the streaks and clean their
   * edges: over the whole photo at the wide passes' working size, the photo
   * where it is surely streaked (behind) and where surely kept (in front),
   * each premultiplied by how surely, mipmapped, so the main pass can read
   * the colours of each nearby, as close as there are any (see edgeBehind).
   * Redrawn only when the masks or the photo change. The main pass's
   * settings must be in place.
   */
  private buildMatte(req: RenderRequest, region: Rect, on: boolean): void {
    this.matteOn = false
    if (!on) return
    const gl = this.gl
    const u = this.uniforms
    const fx = req.params.effects
    const longSide = Math.min(DETAIL_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = JSON.stringify([
      this.idOf(this.sourceId),
      req.baseSize,
      size,
      borderShape(req.params.border),
      fx.masks,
      fx.maskUse,
      fx.shapeSpace,
      fx.shapeUnits,
    ])
    if (!this.matte || this.matte.width !== size.width || this.matte.height !== size.height) {
      if (this.matte) {
        gl.deleteTexture(this.matte.back)
        gl.deleteTexture(this.matte.fore)
        this.matte.framebuffers.forEach((f) => gl.deleteFramebuffer(f))
      }
      const levels = Math.floor(Math.log2(Math.max(size.width, size.height))) + 1
      const make = () => {
        const texture = gl.createTexture()!
        gl.activeTexture(gl.TEXTURE14)
        gl.bindTexture(gl.TEXTURE_2D, texture)
        gl.texStorage2D(gl.TEXTURE_2D, levels, this.canRenderFloat ? gl.RGBA16F : gl.RGBA8, size.width, size.height)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
        const framebuffer = gl.createFramebuffer()!
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.bindTexture(gl.TEXTURE_2D, null)
        return { texture, framebuffer }
      }
      const back = make()
      const fore = make()
      this.matte = {
        back: back.texture,
        fore: fore.texture,
        framebuffers: [back.framebuffer, fore.framebuffer],
        width: size.width,
        height: size.height,
      }
      this.matteKey = ''
    }
    // The finest level read: about two of the photo's pixels across.
    gl.uniform1f(u.uMatteLod, Math.max(0, Math.log2((2 * longSide) / Math.max(req.baseSize.width, req.baseSize.height))))
    if (key !== this.matteKey) {
      const at = photoFrame(req.baseSize, req.params.border)
      // Nothing it draws into may be read while it draws: blanks, then the
      // colours behind once drawn, for drawing those in front.
      this.bindMatte()
      gl.viewport(0, 0, size.width, size.height)
      // Upside down, as the streaked photo is (see buildStreaked).
      gl.uniform2f(u.uRegionOrigin, at.x, at.y + req.baseSize.height)
      gl.uniform2f(u.uRegionSize, req.baseSize.width, -req.baseSize.height)
      gl.uniform1f(u.uPixelate, 1)
      const matte = this.matte
      matte.framebuffers.forEach((framebuffer, k) => {
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
        gl.uniform1i(u.uLinePass, 3 + k)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        if (k === 0) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, null)
          gl.activeTexture(gl.TEXTURE14)
          gl.bindTexture(gl.TEXTURE_2D, matte.back)
          gl.generateMipmap(gl.TEXTURE_2D)
        }
      })
      gl.uniform1i(u.uLinePass, 0)
      gl.uniform2f(u.uRegionOrigin, region.x, region.y)
      gl.uniform2f(u.uRegionSize, region.width, region.height)
      gl.uniform1f(u.uPixelate, blockSize(fx))
      gl.uniform1f(u.uPixelKeep, keepLinesOf(fx))
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.activeTexture(gl.TEXTURE15)
      gl.bindTexture(gl.TEXTURE_2D, matte.fore)
      gl.generateMipmap(gl.TEXTURE_2D)
      this.matteKey = key
    }
    this.matteOn = true
    this.bindMatte()
  }

  /** A stable number for an object, for cache keys. */
  private idOf(o: unknown): number {
    if (!o || typeof o !== 'object') return 0
    let id = this.objectIds.get(o)
    if (!id) {
      id = this.nextObjectId++
      this.objectIds.set(o, id)
    }
    return id
  }

  /**
   * With streaks on, the photo as streaked — the main pass stopped before the
   * look (uLinePass 2) — over the whole photo at the wide passes' working
   * size, mipmapped, for them to blur. Blurred from the photo itself, the
   * bright sky a streak covers glowed through it onto what is beside it, and
   * the streak read glow from what it hides. Redrawn only when the streaks,
   * the masks or the photo change. The main pass's settings must be in place.
   */
  private buildStreaked(req: RenderRequest, region: Rect, on: boolean): void {
    const fx = req.params.effects
    const wanted =
      on &&
      ((fx.streaks.glow ?? 0) > 0 || fx.halation > 0 || fx.bloom > 0 || fx.rim > 0 || fx.crunch > 0 || fx.halo > 0 || fx.structure > 0 ||
        (fx.dither.transitionsOnly > 0 && (fx.dither.amount > 0 || fx.pixelArt.palette !== 'off')))
    if (!wanted) {
      this.passSource = null
      this.passId = this.sourceId
      return
    }
    const gl = this.gl
    const u = this.uniforms
    // Drawn small for a draft: it runs the whole streak search once per pixel.
    const longSide = Math.min(req.draft ? DRAFT_PASS_SIZE : DETAIL_SIZE, Math.max(req.baseSize.width, req.baseSize.height))
    const size = workingSize(req.baseSize, longSide)
    const key = JSON.stringify([
      this.idOf(this.sourceId),
      req.baseSize,
      size,
      borderShape(req.params.border),
      // Not the light off the bars or the prism: neither is in this pass.
      { ...fx.streaks, glow: 0, glowRadius: 0, prism: 0, prismAngle: 0 },
      fx.masks,
      fx.maskUse,
      fx.shapeSpace,
      fx.shapeUnits,
    ])
    if (!this.streaked || this.streaked.width !== size.width || this.streaked.height !== size.height) {
      if (this.streaked) {
        gl.deleteTexture(this.streaked.texture)
        gl.deleteFramebuffer(this.streaked.framebuffer)
      }
      const texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(size.width, size.height))) + 1, gl.RGBA8, size.width, size.height)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const framebuffer = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.streaked = { texture, framebuffer, width: size.width, height: size.height }
      this.streakedKey = ''
    }
    if (key !== this.streakedKey) {
      const at = photoFrame(req.baseSize, req.params.border)
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.streaked.framebuffer)
      gl.viewport(0, 0, size.width, size.height)
      // Upside down: the main pass's rows run top to bottom on the canvas,
      // and this texture's must run as the photo's do, for the passes.
      gl.uniform2f(u.uRegionOrigin, at.x, at.y + req.baseSize.height)
      gl.uniform2f(u.uRegionSize, req.baseSize.width, -req.baseSize.height)
      gl.uniform1f(u.uPixelate, 1)
      this.bindMatte()
      gl.uniform1i(u.uLinePass, 2)
      if (this.leanOn) this.drawLean(size.width, size.height)
      else this.drawStrips(size.width, size.height)
      gl.uniform1i(u.uLinePass, 0)
      gl.uniform2f(u.uRegionOrigin, region.x, region.y)
      gl.uniform2f(u.uRegionSize, region.width, region.height)
      gl.uniform1f(u.uPixelate, blockSize(fx))
      gl.uniform1f(u.uPixelKeep, keepLinesOf(fx))
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.activeTexture(gl.TEXTURE14)
      gl.bindTexture(gl.TEXTURE_2D, this.streaked.texture)
      gl.generateMipmap(gl.TEXTURE_2D)
      gl.bindTexture(gl.TEXTURE_2D, null)
      this.streakedKey = key
    }
    this.passSource = { texture: this.streaked.texture, size }
    this.passId = key
  }

  /**
   * Shapes as images, one texture layer each — streak shapes and masks, each
   * in their own store: red is the inside, antialiased, green the same
   * blurred by the shape's feather. The shader
   * looks a point up here instead of testing it against every edge of the
   * outline, so outlines can have as many points as they need and cost the
   * same per pixel. Each layer covers its own shape's bounds (square, so the
   * blur stays round), and only layers whose shape changed are redrawn.
   * Coordinates are in the shapes' units (see shapeMeasure), the same for
   * a preview and the export, so both read the same layers.
   */
  private buildLayers(
    store: LayerStore,
    shapes: LayerShape[],
    measure: { x: number; y: number; unit: number },
    frame: Rect,
    keySource?: KeySource,
    /** The photo, for masks matched at the edge by colour (LayerShape.colourKey). */
    photoSource?: KeySource,
  ): { rects: Float32Array; reach: number[] } {
    const gl = this.gl
    const short = measure.unit
    const size = layerSide(shapes, measure, frame, Math.min(STREAK_LAYER_SIZE, this.maxSize))
    const rects = new Float32Array(Math.max(MAX_STREAKS, MAX_MASKS, shapes.length) * 4)
    const reach: number[] = []
    const depth = Math.max(1, shapes.length)
    if (!store.texture || store.depth !== depth || store.size !== size) {
      if (store.texture) gl.deleteTexture(store.texture)
      store.texture = gl.createTexture()!
      gl.activeTexture(gl.TEXTURE0 + store.unit)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.texture)
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, size, size, depth)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      store.depth = depth
      store.size = size
      store.keys = []
    }
    shapes.forEach((shape, i) => {
      // Straight lines between the points, as the overlay draws them: a
      // smooth curve through clicked corners bulged well off the edges
      // you drew, and a traced outline is dense enough to be smooth anyway.
      // Outlines are fractions of the photo (a leak shape's, of the print);
      // the layers are in shape units.
      const of = shape.sdf?.frame ?? frame
      const samples = shape.outline.map((p) => ({
        x: (of.x + p.x * of.width - measure.x) / short,
        y: (of.y + p.y * of.height - measure.y) / short,
      }))
      const xs = samples.map((p) => p.x)
      const ys = samples.map((p) => p.y)
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      reach.push(Math.hypot(x1 - x0, y1 - y0) + 0.01)
      // Room round the shape for the blur, and a few texels so the edge
      // never meets the border.
      const feather = shape.feather
      const span = Math.max(x1 - x0, y1 - y0, 1e-3)
      const pad = feather * 1.5 + (span * 6) / size
      const side = span + pad * 2
      const left = (x0 + x1) / 2 - side / 2
      const top = (y0 + y1) / 2 - side / 2
      rects.set([left, top, side, side], i * 4)
      // How near counts as near for the look-back's closer scan (blue): one
      // step of it, the shape's run (fill) or trail length (trail) over 64.
      const near = shape.mode === 'trail' ? (shape.trailLength ?? 0) / 64 : shape.mode === 'fill' ? (x1 - x0 + y1 - y0) / 64 : 0
      // In short-side units, so a preview and an export at another size share layers.
      const keyed = shape.keyOn && keySource ? [shape.keyOn, sourceIdOf(keySource.image as object), keySource.frame] : null
      const coloured = shape.colourKey && photoSource ? [sourceIdOf(photoSource.image as object), photoSource.frame] : null
      const sdfKey = shape.sdf ? [shape.sdf.frame, shape.sdf.scale] : null
      const key = JSON.stringify([size, (frame.x - measure.x) / short, (frame.y - measure.y) / short, frame.width / short, frame.height / short, feather, shape.mode, near, shape.outline, keyed, sdfKey, shape.raster ? rasterKey(shape.raster) : null, coloured])
      if (store.keys[i] === key) return
      store.keys[i] = key
      // Drawn already by another engine in this worker (the view's, a
      // thumbnail's, a snapshot's): the same pixels, uploaded again.
      const made = madeLayers.get(key)
      if (made) {
        madeLayers.delete(key)
        madeLayers.set(key, made)
        if (made.deepest !== undefined) {
          store.deepest ??= []
          store.deepest[i] = made.deepest
        }
        gl.activeTexture(gl.TEXTURE0 + store.unit)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        if (made.pixels instanceof OffscreenCanvas) gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, made.pixels)
        else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, made.pixels)
        return
      }
      if (shape.sdf) {
        // A leak shape: how far each point is inside or outside it, worked
        // out small (it is smooth) and laid into the layer smoothly. The
        // shader softens the edge itself, by the shape's own Edge.
        const N = SDF_WORK
        const small = new OffscreenCanvas(N, N)
        const sc = small.getContext('2d', { willReadFrequently: true })!
        const k = N / side
        const path = new Path2D()
        samples.forEach((p, j) => (j ? path.lineTo((p.x - left) * k, (p.y - top) * k) : path.moveTo((p.x - left) * k, (p.y - top) * k)))
        path.closePath()
        sc.fillStyle = '#fff'
        sc.fill(path, 'evenodd')
        const px = sc.getImageData(0, 0, N, N).data
        const inside = new Uint8Array(N * N)
        const outside = new Uint8Array(N * N)
        for (let j = 0; j < N * N; j++) {
          const on = px[j * 4] > 127
          inside[j] = on ? 1 : 0
          outside[j] = on ? 0 : 1
        }
        const toIn = distanceSquared(inside, N)
        const toOut = distanceSquared(outside, N)
        const cell = (side / N) * shape.sdf.scale
        const sdAt = new Float32Array(N * N)
        let deepest = 0
        for (let j = 0; j < N * N; j++) {
          sdAt[j] = inside[j] ? -(Math.sqrt(toOut[j]) - 0.5) * cell : (Math.sqrt(toIn[j]) - 0.5) * cell
          if (-sdAt[j] > deepest) deepest = -sdAt[j]
        }
        // Up to the layer's size in floats, then split into two bytes: the
        // bytes blended apart would round each on its own and lose the low one.
        const field = new ImageData(size, size)
        const f = (N - 1) / Math.max(size - 1, 1)
        for (let y = 0; y < size; y++) {
          const sy = y * f
          const y0 = Math.floor(sy)
          const y1 = Math.min(N - 1, y0 + 1)
          const ty = sy - y0
          for (let x = 0; x < size; x++) {
            const sx = x * f
            const x0 = Math.floor(sx)
            const x1 = Math.min(N - 1, x0 + 1)
            const tx = sx - x0
            const top0 = sdAt[y0 * N + x0] + (sdAt[y0 * N + x1] - sdAt[y0 * N + x0]) * tx
            const bot0 = sdAt[y1 * N + x0] + (sdAt[y1 * N + x1] - sdAt[y1 * N + x0]) * tx
            const sd = top0 + (bot0 - top0) * ty
            const enc = Math.round(Math.min(1, Math.max(0, (sd / SDF_RANGE) * 0.5 + 0.5)) * 65535)
            const o = (y * size + x) * 4
            field.data[o] = enc >> 8
            field.data[o + 1] = enc & 255
            field.data[o + 3] = 255
          }
        }
        store.deepest ??= []
        store.deepest[i] = Math.max(deepest, 0.002)
        gl.activeTexture(gl.TEXTURE0 + store.unit)
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.texture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, field.data)
        keepLayer(key, { pixels: field.data, deepest: store.deepest[i] })
        return
      }
      const canvas = new OffscreenCanvas(size, size)
      const ctx = canvas.getContext('2d')!
      const scale = size / side
      if (shape.raster) {
        // A selected subject: its cells, red, and the feather's ramp over
        // them, green; laid where the selection lies in the frame.
        const r = shape.raster
        const X = ((of.x + r.x * of.width - measure.x) / short - left) * scale
        const Y = ((of.y + r.y * of.height - measure.y) / short - top) * scale
        const W = ((r.width * of.width) / short) * scale
        const H = ((r.height * of.height) / short) * scale
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, size, size)
        ctx.globalCompositeOperation = 'lighter'
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(rasterLook(r).red, X, Y, W, H)
        ctx.drawImage(rasterRamp(r, (feather * scale) / Math.max(W / r.w, 1e-6)), X, Y, W, H)
      } else {
        const outline = new Path2D()
        samples.forEach((p, k) => {
          const x = (p.x - left) * scale
          const y = (p.y - top) * scale
          if (k) outline.lineTo(x, y)
          else outline.moveTo(x, y)
        })
        outline.closePath()
        // Opaque black first, then the channels added on top, so neither
        // channel's coverage ends up in the alpha.
        ctx.fillStyle = '#000'
        ctx.fillRect(0, 0, size, size)
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = '#f00'
        ctx.fill(outline, 'evenodd')
        // Green: the feather's ramp, 0.5 on the outline, 1 a feather inside it
        // and 0 a feather outside, so the shader can place the soft edge
        // inside, across or outside the line.
        if (feather > 0) {
          ctx.imageSmoothingQuality = 'high'
          ctx.drawImage(featherRamp(outline, size, feather * scale), 0, 0, size, size)
        } else {
          ctx.fillStyle = '#0f0'
          ctx.fill(outline, 'evenodd')
        }
        // Blue: within a step of the edge the look-back is searching for — the
        // shape for a trail, its outside for a fill — so it scans closely there
        // and catches parts thinner than its step.
        if (near > 0) ctx.drawImage(nearEdge(outline, size, near * scale, shape.mode === 'fill'), 0, 0, size, size)
      }
      // Blue, for a keyed mask under a collage: the key's measure in the photo
      // as it was (see LayerShape.keyOn), the photo drawn as the layer sees it.
      if (shape.keyOn && keySource) {
        const photo = new OffscreenCanvas(size, size)
        const pc = photo.getContext('2d')!
        const pf = keySource.frame
        const k = (pf.width / keySource.size.width / short) * scale
        pc.imageSmoothingQuality = 'high'
        pc.setTransform(k, 0, 0, (pf.height / keySource.size.height / short) * scale, ((pf.x - measure.x) / short - left) * scale, ((pf.y - measure.y) / short - top) * scale)
        pc.drawImage(keySource.image as CanvasImageSource, 0, 0)
        const src = pc.getImageData(0, 0, size, size).data
        const layer = ctx.getImageData(0, 0, size, size)
        const out = layer.data
        const blue = shape.keyOn === 'blue'
        for (let q = 0; q < out.length; q += 4)
          out[q + 2] = blue ? src[q + 2] : Math.round(0.2126 * src[q] + 0.7152 * src[q + 1] + 0.0722 * src[q + 2])
        ctx.putImageData(layer, 0, 0)
      }
      gl.activeTexture(gl.TEXTURE0 + store.unit)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, store.texture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
      if (shape.colourKey && photoSource) {
        const pf = photoSource.frame
        const layer = ctx.getImageData(0, 0, size, size)
        colourKeyLayer(
          layer.data,
          size,
          photoSource.image,
          [(pf.width / photoSource.size.width / short) * scale, (pf.height / photoSource.size.height / short) * scale, ((pf.x - measure.x) / short - left) * scale, ((pf.y - measure.y) / short - top) * scale],
          feather * scale,
        )
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, layer.data)
        keepLayer(key, { pixels: layer.data })
        return
      }
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, size, size, 1, gl.RGBA, gl.UNSIGNED_BYTE, canvas)
      keepLayer(key, { pixels: canvas })
    })
    return { rects, reach }
  }

  dispose(): void {
    if (this.disposed) return
    const gl = this.gl
    if (this.lineTable) {
      gl.deleteTexture(this.lineTable.texture)
      gl.deleteFramebuffer(this.lineTable.framebuffer)
    }
    if (this.baseCache) gl.deleteTexture(this.baseCache.texture)
    if (this.grainCache) gl.deleteTexture(this.grainCache.texture)
    if (this.lutTexture) gl.deleteTexture(this.lutTexture)
    if (this.blank) gl.deleteTexture(this.blank)
    if (this.defectTexture) gl.deleteTexture(this.defectTexture)
    if (this.streakLayers.texture) gl.deleteTexture(this.streakLayers.texture)
    if (this.maskLayers.texture) gl.deleteTexture(this.maskLayers.texture)
    if (this.pathTexture) gl.deleteTexture(this.pathTexture)
    if (this.streaked) {
      gl.deleteTexture(this.streaked.texture)
      gl.deleteFramebuffer(this.streaked.framebuffer)
    }
    if (this.matte) {
      gl.deleteTexture(this.matte.back)
      gl.deleteTexture(this.matte.fore)
      this.matte.framebuffers.forEach((f) => gl.deleteFramebuffer(f))
    }
    for (const c of this.streakCache) {
      gl.deleteTexture(c.a)
      gl.deleteTexture(c.b)
      gl.deleteFramebuffer(c.framebuffer)
    }
    this.freeTileCache()
    this.freeLeanTargets()
    this.freeLeanLight()
    for (const p of Object.values(this.leans)) if (p) gl.deleteProgram(p)
    for (const b of Object.values(this.leanStarted)) {
      if (!b) continue
      gl.deleteProgram(b.program)
      gl.deleteShader(b.vs)
      gl.deleteShader(b.fs)
    }
    if (this.glowProgram) gl.deleteProgram(this.glowProgram)
    if (this.blurProgram) gl.deleteProgram(this.blurProgram)
    if (this.collageProgram) gl.deleteProgram(this.collageProgram)
    for (const t of this.collageTargets) {
      gl.deleteTexture(t.texture)
      gl.deleteFramebuffer(t.framebuffer)
    }
    for (const tex of this.collageTextures.values()) gl.deleteTexture(tex)
    this.disposeGlowTargets()
    gl.deleteVertexArray(this.vao)
    for (const v of Object.values(this.mains)) if (v) gl.deleteProgram(v.program)
    for (const b of Object.values(this.building)) if (b) gl.deleteProgram(b.program)
    this.disposed = true
    // The context itself let go now, not when it is collected: a browser
    // keeps only so many (16 in Chrome) and drops the oldest past that,
    // which can be the editor's own after enough exports.
    gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}

/**
 * The border as the streaks, their matte and the streaked photo see it: its
 * size and shape, which place the photo in the print. Its colour, paper
 * texture and grain go on after those passes, so changing them (picking a
 * border colour) no longer runs the streaks' search again.
 */
function borderShape(b: RenderRequest['params']['border']): unknown {
  if (!b) return b
  const { colour: _c, texture: _t, grain: _g, ...shape } = b as unknown as Record<string, unknown>
  return shape
}

/**
 * The look's seeds mixed with the photo's own, so random detail — paper,
 * dust, surges — differs from photo to photo while staying fixed for each
 * one: the preview, its export and a batch all get the same pattern. Placed
 * things (leaks, streaks) keep their seeds: they were put there on purpose.
 */
/** BlendParams.pixelScale, or 1. */
function pixelScaleOf(params: BlendParams): number {
  const ps = params.pixelScale
  return ps && Number.isFinite(ps) && ps > 0 ? ps : 1
}

/**
 * A replaced photo's settings sized in pixels, in its own pixels: the grain,
 * the dither's cell and Pixel art's blocks as large as they were on the
 * photo the edit was made on (BlendParams.pixelScale).
 */
function inReferencePixels(params: BlendParams): BlendParams {
  const ps = pixelScaleOf(params)
  if (ps === 1) return params
  const fx = params.effects
  return {
    ...params,
    grainScale: params.grainScale * ps,
    effects: {
      ...fx,
      dither: { ...fx.dither, pixel: fx.dither.pixel * ps },
      pixelArt: { ...fx.pixelArt, pixelate: fx.pixelArt.pixelate * ps },
    },
  }
}

function withPhotoSeed(params: BlendParams, imageSeed: number | undefined): BlendParams {
  if (!imageSeed || !params.varyPerPhoto) return params
  const mix = (seed: number, salt: number) => (Math.abs(seed) + ((imageSeed * salt) >>> 0)) % 2 ** 31
  return {
    ...params,
    border: { ...params.border, seed: mix(params.border.seed, 1) },
    effects: {
      ...params.effects,
      defects: { ...params.effects.defects, seed: mix(params.effects.defects.seed, 7) },
      surge: { ...params.effects.surge, seed: mix(params.effects.surge.seed, 13) },
    },
  }
}

/** Where on the grain the photo starts, in base pixels: its own spot per photo. */
function grainShift(req: RenderRequest): [number, number] {
  const seed = req.imageSeed
  if (!seed || !req.params.varyPerPhoto) return [0, 0]
  // Whole grain tiles plus a fraction, so a stochastic tiler lands on new
  // lattice cells and a plain repeat on a new alignment. Kept under ~40 000 px
  // so float precision in the shader is untouched.
  const span = req.grainSize.width * Math.max(0.01, req.params.grainScale)
  const a = (seed % 9973) / 9973
  const b = (Math.floor(seed / 9973) % 9967) / 9967
  const tiles = Math.max(1, Math.floor(40000 / Math.max(1, span)))
  return [a * tiles * span, b * tiles * span]
}

/**
 * Shape layers already drawn, by their key, shared by every engine in this
 * worker: the view's engine, the thumbnails', a snapshot's. The newest few.
 */
const madeLayers = new Map<string, { pixels: OffscreenCanvas | Uint8ClampedArray; deepest?: number }>()
const KEEP_LAYERS = 8
function keepLayer(key: string, made: { pixels: OffscreenCanvas | Uint8ClampedArray; deepest?: number }) {
  madeLayers.set(key, made)
  while (madeLayers.size > KEEP_LAYERS) madeLayers.delete(madeLayers.keys().next().value!)
}

/**
 * How many texels a side the shape layers need: about one for each pixel of
 * the photo the largest shape spans (with room for its feather), in steps of
 * 256, between 512 and `max`. A layer drawn finer than the photo it is laid
 * on shows nothing more; on a 1.6 MP photo the fixed 2048 cost four times the
 * drawing for the same picture. It depends only on the photo and the shapes,
 * so the preview and the export of a photo use the same layers.
 */
function layerSide(shapes: LayerShape[], measure: { x: number; y: number; unit: number }, frame: Rect, max: number): number {
  let need = 0
  for (const shape of shapes) {
    const of = shape.sdf?.frame ?? frame
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    for (const p of shape.outline) {
      const x = of.x + p.x * of.width
      const y = of.y + p.y * of.height
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    // In print px: the span, plus the feather's room either side.
    const span = Math.max(x1 - x0, y1 - y0, 1) + shape.feather * measure.unit * 3
    need = Math.max(need, span * 1.15)
  }
  return Math.max(512, Math.min(max, Math.ceil(need / 256) * 256))
}

/**
 * A shape's feather ramp in the green channel over opaque black (so it can be
 * added onto a layer): its signed distance from the outline over the feather,
 * 0.5 on the line. Worked out at a lower resolution where the feather is wide
 * enough not to need the detail, which keeps a big feather quick to redraw;
 * the caller scales it back up, and a straight ramp scales up exactly.
 */
function featherRamp(outline: Path2D, size: number, feather: number): OffscreenCanvas {
  const res = Math.min(size, Math.max(256, Math.ceil((size * 32) / feather)))
  const canvas = new OffscreenCanvas(res, res)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, res, res)
  ctx.scale(res / size, res / size)
  ctx.fillStyle = '#fff'
  ctx.fill(outline, 'evenodd')
  const image = ctx.getImageData(0, 0, res, res)
  const cover = new Float32Array(res * res)
  for (let k = 0; k < cover.length; k++) cover[k] = image.data[k * 4] / 255
  const distance = signedDistance(cover, res, res)
  // Ramp per pixel of this canvas: the feather is `feather` layer pixels.
  const per = 0.5 / ((feather * res) / size)
  for (let k = 0; k < cover.length; k++) {
    image.data[k * 4] = 0
    image.data[k * 4 + 1] = Math.round(Math.min(1, Math.max(0, 0.5 + distance[k] * per)) * 255)
    image.data[k * 4 + 2] = 0
    image.data[k * 4 + 3] = 255
  }
  ctx.putImageData(image, 0, 0)
  return canvas
}

/**
 * Where a look-back step could be about to miss the edge it is searching for:
 * the shape (or, for `outside`, everything but the shape) grown by `reach`
 * layer pixels, in the blue channel over opaque black. Worked out at a
 * quarter resolution and grown a little extra to cover that: it only has to
 * err towards "near".
 */
function nearEdge(outline: Path2D, size: number, reach: number, outside: boolean): OffscreenCanvas {
  const res = Math.max(64, size >> 2)
  const canvas = new OffscreenCanvas(res, res)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, res, res)
  ctx.scale(res / size, res / size)
  ctx.fillStyle = '#fff'
  ctx.fill(outline, 'evenodd')
  const image = ctx.getImageData(0, 0, res, res)
  const mask = new Uint8Array(res * res)
  for (let k = 0; k < mask.length; k++) mask[k] = (image.data[k * 4] > 8) !== outside ? 1 : 0
  const r = Math.ceil((reach * res) / size) + 2
  const grown = dilate(dilate(mask, res, res, r, 1, res), res, res, r, res, 1)
  for (let k = 0; k < grown.length; k++) image.data.set([0, 0, grown[k] ? 255 : 0, 255], k * 4)
  ctx.putImageData(image, 0, 0)
  return canvas
}

/** A 0/1 mask grown by `r` along lines (`step` apart within a line, `stride` between lines). */
function dilate(src: Uint8Array, len: number, lines: number, r: number, step: number, stride: number): Uint8Array {
  const out = new Uint8Array(src.length)
  for (let line = 0; line < lines; line++) {
    const base = line * stride
    // Fill within r of a set cell, looking back and then forward.
    let last = -Infinity
    for (let k = 0; k < len; k++) {
      if (src[base + k * step]) last = k
      if (k - last <= r) out[base + k * step] = 1
    }
    last = Infinity
    for (let k = len - 1; k >= 0; k--) {
      if (src[base + k * step]) last = k
      if (last - k <= r) out[base + k * step] = 1
    }
  }
  return out
}
