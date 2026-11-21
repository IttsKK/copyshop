import { GrainEngine } from '../engine/GrainEngine'
import { hsvToRgb, rgbToHsv } from '../engine/harmony'
import { DEFAULT_MODULES, type BlendParams, type GradeParams, type Rgb } from '../engine/types'

const withoutRecipe = (g: GradeParams): GradeParams => {
  const { recipe: _recipe, ...rest } = g
  return rest
}
import type { GrainTexture } from '../sources/GrainSource'

/**
 * The palette wheels (Light & shade, Wheel) edit one thing: the palette, a
 * colour for the shadows, the midtones and the light. A look can colour the
 * picture other ways too — a film stock, the shadow and light tints, Isolate
 * and Pop — and then the wheels' colours have nothing to do with what is
 * seen. This works out what the look actually does to each tone of this
 * photo, as three palette colours, and how strong a palette of them comes
 * closest, so any look can be put on the wheels and carried on from there.
 */

/**
 * What colours the picture by tone besides the palette, by name: the tools a
 * palette can stand in for. Isolate and Pop are left out: they pick out one
 * colour, which a palette (colour by brightness) cannot do, and they work on
 * top of it, so they stay as they are.
 */
export function offWheelColour(b: BlendParams): string[] {
  const fx = b.effects
  const g = fx.grade
  if (!b.modules.colour) return []
  const out: string[] = []
  if (fx.stock.id !== 'none' && fx.stock.strength > 0) out.push('film stock')
  if (g.shadowAmount > 0) out.push('shadow tint')
  if (g.highlightAmount > 0) out.push('light tint')
  if (g.blobs.length > 0) out.push('colour magnets')
  return out
}

/** The tools that pick out one colour, which stay on beside the palette. */
export function accentTools(b: BlendParams): string[] {
  const g = b.effects.grade
  if (!b.modules.colour) return []
  return [...(g.isolateAmount > 0 ? ['Isolate'] : []), ...(g.popAmount > 0 ? ['Pop'] : [])]
}

/** The same look with its colour moved onto the palette alone. */
function onPalette(b: BlendParams, stops: [Rgb, Rgb, Rgb], amount: number): BlendParams {
  const fx = b.effects
  const manual = (colour: Rgb) => ({ source: 'manual' as const, colour })
  return {
    ...b,
    modules: { ...b.modules, colour: true },
    effects: {
      ...fx,
      stock: { ...fx.stock, strength: 0 },
      grade: {
        ...withoutRecipe(fx.grade),
        mapShadow: manual(stops[0]),
        mapMid: manual(stops[1]),
        mapHigh: manual(stops[2]),
        mapHarmony: 'free',
        mapAmount: amount,
        mapContrast: 0,
        mapBalance: 0,
        shadowAmount: 0,
        highlightAmount: 0,
        blobs: [],
      },
    },
  }
}

let engine: GrainEngine | null = null
const smalls = new WeakMap<ImageBitmap, { canvas: HTMLCanvasElement; pixels: Uint8ClampedArray }>()
const SIDE = 160

function smallOf(photo: ImageBitmap) {
  let s = smalls.get(photo)
  if (s) return s
  const k = Math.min(1, SIDE / Math.max(photo.width, photo.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(photo.width * k))
  canvas.height = Math.max(1, Math.round(photo.height * k))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(photo, 0, 0, canvas.width, canvas.height)
  s = { canvas, pixels: ctx.getImageData(0, 0, canvas.width, canvas.height).data }
  smalls.set(photo, s)
  return s
}

/** The colour step alone (or with others), rendered small: only those sections on. */
function renderColour(
  b: BlendParams,
  photo: ImageBitmap,
  grain: GrainTexture,
  imageSeed?: number,
  keep: (keyof BlendParams['modules'])[] = ['colour'],
): Uint8ClampedArray {
  const small = smallOf(photo)
  engine ??= new GrainEngine()
  const only = Object.fromEntries(
    Object.keys(DEFAULT_MODULES).map((k) => [k, keep.includes(k as keyof BlendParams['modules']) && b.modules[k as keyof BlendParams['modules']]]),
  ) as unknown as BlendParams['modules']
  const out = engine.render({
    base: small.canvas,
    baseSize: { width: small.canvas.width, height: small.canvas.height },
    grain: grain.source,
    grainSize: grain.size,
    grainMean: grain.mean,
    grainSd: grain.sd,
    params: { ...b, modules: only, border: { ...b.border, width: 0, bottomExtra: 0 } },
    imageSeed,
  }) as HTMLCanvasElement
  const c = document.createElement('canvas')
  c.width = out.width
  c.height = out.height
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(out, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height).data
}

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}
const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** Where the three stops sit in brightness, and how bright each is drawn (as the wheels draw them). */
const ZONES = [
  { at: 0.15, v: 0.32 },
  { at: 0.5, v: 0.75 },
  { at: 0.85, v: 1 },
]

export interface PaletteFit {
  /** Shadows, midtones, light: what the look gives each tone of this photo. */
  stops: [Rgb, Rgb, Rgb]
  /** The look with its colour moved onto the palette, as close as it comes. */
  blend: BlendParams
}

/**
 * What the look's colour does to each tone of this photo, as three palette
 * colours: the average colour the look gives the photo's shadows, midtones
 * and light, each kept to its hue and saturation. Then the palette strength
 * that comes closest to the look itself, tried at a few strengths.
 */
export function fitPalette(b: BlendParams, photo: ImageBitmap, grain: GrainTexture, imageSeed?: number): PaletteFit {
  const before = smallOf(photo).pixels
  // Measured without the one-colour tools: they stay on, on top of the
  // palette, and counted here as well they would grey it twice.
  const toneOnly: BlendParams = { ...b, effects: { ...b.effects, grade: { ...b.effects.grade, isolateAmount: 0, popAmount: 0, popKeep: 0 } } }
  const look = renderColour(toneOnly, photo, grain, imageSeed)
  const sums = ZONES.map(() => ({ r: 0, g: 0, b: 0, w: 0 }))
  for (let i = 0; i < before.length; i += 4) {
    const l = (0.2126 * before[i] + 0.7152 * before[i + 1] + 0.0722 * before[i + 2]) / 255
    ZONES.forEach((z, k) => {
      const w = Math.max(0, 1 - Math.abs(l - z.at) / 0.3)
      if (w <= 0) return
      const s = sums[k]
      s.r += lin(look[i]) * w
      s.g += lin(look[i + 1]) * w
      s.b += lin(look[i + 2]) * w
      s.w += w
    })
  }
  const hsvOf = (k: number): [number, number] | null => {
    const s = sums[k]
    if (s.w < 1) return null
    const [h, sat] = rgbToHsv([enc(s.r / s.w), enc(s.g / s.w), enc(s.b / s.w)])
    return [h, sat]
  }
  const found = ZONES.map((_, k) => hsvOf(k))
  // A tone the photo barely has takes its neighbour's colour.
  const filled = found.map((f, k) => f ?? found[1] ?? found[k === 0 ? 2 : 0] ?? [0, 0])
  const stops = ZONES.map((z, k) => hsvToRgb([filled[k][0], Math.min(0.95, filled[k][1]), z.v])) as [Rgb, Rgb, Rgb]
  // The strength that comes closest to the look.
  let best = { amount: 1, err: Infinity }
  for (const amount of [0.5, 0.65, 0.8, 0.9, 1]) {
    const px = renderColour(onPalette(toneOnly, stops, amount), photo, grain, imageSeed)
    let err = 0
    for (let i = 0; i < px.length; i += 16) err += Math.abs(px[i] - look[i]) + Math.abs(px[i + 1] - look[i + 1]) + Math.abs(px[i + 2] - look[i + 2])
    if (err < best.err) best = { amount, err }
  }
  return { stops, blend: onPalette(b, stops, best.amount) }
}

/** How far apart two looks' colour is on this photo, mean per channel (0..255): for the self-test. */
export function colourError(a: BlendParams, b: BlendParams, photo: ImageBitmap, grain: GrainTexture): number {
  const pa = renderColour(a, photo, grain)
  const pb = renderColour(b, photo, grain)
  let err = 0
  for (let i = 0; i < pa.length; i += 4) err += Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2])
  return err / ((pa.length / 4) * 3)
}

/**
 * Paper colours that go with the finished look, not just the photo: its
 * deepest colour as an ink, its shade, a muted midtone, its light as a tinted
 * paper and its accent taken deep. Read from the look's colour and tone on
 * this photo (a gradient map changes every colour, so the photo's own would
 * not match), each kept to the hue it has in the picture.
 */
export function lookPapers(b: BlendParams, photo: ImageBitmap, grain: GrainTexture, imageSeed?: number): { label: string; colour: Rgb }[] {
  return papersOf(renderColour(b, photo, grain, imageSeed, ['colour', 'tone']))
}

/**
 * The same from the finished picture itself, as the preview drew it (every
 * module: a dither, a light leak, a halftone too): `picture` a whole print,
 * `photo` where the photo is in it, as fractions, so the paper round it
 * now is left out.
 */
export function picturePapers(picture: CanvasImageSource & { width: number; height: number }, photo: { x: number; y: number; width: number; height: number }): { label: string; colour: Rgb }[] {
  const sx = photo.x * picture.width
  const sy = photo.y * picture.height
  const sw = photo.width * picture.width
  const sh = photo.height * picture.height
  const k = Math.min(1, SIDE / Math.max(sw, sh))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(sw * k))
  c.height = Math.max(1, Math.round(sh * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(picture, sx, sy, sw, sh, 0, 0, c.width, c.height)
  return papersOf(ctx.getImageData(0, 0, c.width, c.height).data)
}

function papersOf(px: Uint8ClampedArray): { label: string; colour: Rgb }[] {
  const all: { l: number; r: number; g: number; b: number; sat: number }[] = []
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255
    const g = px[i + 1] / 255
    const bl = px[i + 2] / 255
    const [, sat] = rgbToHsv([r, g, bl])
    all.push({ l: 0.2126 * r + 0.7152 * g + 0.0722 * bl, r, g, b: bl, sat })
  }
  all.sort((a, c) => a.l - c.l)
  /** The average colour of a slice of the picture, darkest to lightest. */
  const band = (from: number, to: number): Rgb => {
    const part = all.slice(Math.floor(from * all.length), Math.max(Math.floor(from * all.length) + 1, Math.floor(to * all.length)))
    const n = part.length || 1
    return [part.reduce((a, p) => a + lin(p.r * 255), 0) / n, part.reduce((a, p) => a + lin(p.g * 255), 0) / n, part.reduce((a, p) => a + lin(p.b * 255), 0) / n].map(enc) as Rgb
  }
  /** A colour's hue and saturation at a given brightness (HSV value). */
  const at = (c: Rgb, v: number, satScale = 1, satMax = 0.9): Rgb => {
    const [h, sat] = rgbToHsv(c)
    return hsvToRgb([h, Math.min(satMax, sat * satScale), v])
  }
  const ink = band(0, 0.06)
  const shade = band(0.08, 0.25)
  const mid = band(0.4, 0.6)
  const light = band(0.9, 1)
  // The accent: the most saturated tenth of the picture.
  const vivid = [...all].sort((a, c) => c.sat - a.sat).slice(0, Math.max(1, Math.floor(all.length / 10)))
  const accent: Rgb = [vivid.reduce((a, p) => a + p.r, 0), vivid.reduce((a, p) => a + p.g, 0), vivid.reduce((a, p) => a + p.b, 0)].map(
    (v) => v / vivid.length,
  ) as Rgb
  return [
    { label: 'Ink', colour: at(ink, 0.09, 1.1, 0.75) },
    { label: 'Shade', colour: at(shade, 0.2, 0.95, 0.7) },
    { label: 'Muted mid', colour: at(mid, 0.42, 0.45, 0.35) },
    { label: 'Tinted', colour: at(light, 0.92, 0.35, 0.18) },
    { label: 'Deep accent', colour: at(accent, 0.3, 0.8, 0.7) },
  ]
}
