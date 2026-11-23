import { maskOn } from './maskShapes'
import { pieceCutter } from './repeat'
import type { ColourChoice, EffectParams, MaskSection, Rect, Rgb, SectionMask, Size, TextureSource } from './types'

/**
 * Recolour: parts of the photo (each its own selection or outline) given a
 * new colour, keeping their own light and shade, as Photoshop's Color blend
 * mode does: a grey building turned red is a red building, its windows and
 * shadows as they were. Hue only keeps each part's own strength of colour
 * and turns only its hue. As shot keeps a part out of the look's colour
 * instead: Colour and Black & white leave it as it was taken.
 *
 * Like Repeat's copies, the new colours go into the photo before every
 * other effect (first of all, so Repeat and the Kaleidoscope copy them),
 * and the look's own grade and grain then go over them as over the rest.
 */
export interface RecolourItem {
  id: string
  /** Its own switch in the list: off, kept but doing nothing. */
  enabled: boolean
  /** Its part: a mask Recolour owns. */
  source: string | null
  /** A new colour, its hue only, or the part kept as shot. */
  mode: 'colour' | 'hue' | 'asShot'
  colour: ColourChoice
  /** How much of the new colour, 0..1. */
  strength: number
  /** Its new colour kept through the look: Colour and Black & white leave the part (as they do one kept as shot). */
  keep?: boolean
  /**
   * How much the part takes the new colour's own brightness, 0..1: 0 keeps
   * its own light (a grey building turned red is lit as it was), 1 brings it
   * to the colour's lightness (a pale red is pale), its contrast kept.
   */
  brightness?: number
  /** How much the brightest parts (reflections, lit windows) keep their own colour, 0..1. */
  highlights?: number
  /** How much of the part's own differences in colour show through the new one, 0..1 (0: one even colour). */
  variation?: number
}

/** What a part starts with: natural, its reflections and its own variety in colour kept. */
export const RECOLOUR_NATURAL = { brightness: 0, highlights: 0.5, variation: 0.5 }

export interface RecolourModule {
  enabled: boolean
  items: RecolourItem[]
}

export const DEFAULT_RECOLOUR: RecolourModule = { enabled: false, items: [] }

/** Room for this many parts (each has its own mask, and masks are limited). */
export const MAX_RECOLOURS = 6

/**
 * Each new part's colour, in turn, so three parts made one after another come
 * out three colours: muted, as paint, brick and stone are, so a part starts
 * out looking like it could be that colour (a vivid one is a pick away).
 */
export const RECOLOUR_STARTS: Rgb[] = [
  [0.66, 0.3, 0.24], // brick
  [0.32, 0.43, 0.6], // slate blue
  [0.78, 0.62, 0.32], // ochre
  [0.42, 0.56, 0.44], // sage
  [0.55, 0.36, 0.52], // plum
  [0.8, 0.47, 0.26], // rust
]

export const newRecolourItem = (id: string, source: string, n: number): RecolourItem => ({
  id,
  enabled: true,
  source,
  mode: 'colour',
  colour: { source: 'manual', colour: RECOLOUR_STARTS[n % RECOLOUR_STARTS.length] },
  strength: 1,
  ...RECOLOUR_NATURAL,
})

const live = (fx: EffectParams) => {
  const m = fx.recolour
  if (!m?.enabled) return []
  return m.items.filter((it) => it.enabled && !!it.source && fx.masks.some((x) => x.id === it.source && maskOn(x)))
}

/** Whether Recolour changes the photo's own pixels (a part in a new colour, not only parts kept as shot). */
export const recolourPaints = (fx: EffectParams): boolean => live(fx).some((it) => it.mode !== 'asShot' && it.strength > 0)

/** The sections a part kept as shot is kept out of. */
const AS_SHOT_SECTIONS: MaskSection[] = ['colour', 'mono']

/**
 * A section's masks with Recolour's parts kept as shot left out of it too:
 * added to what it already keeps off (or the only thing it keeps off). A
 * section set to work only inside its masks keeps that; a part kept as shot
 * inside one of them is not taken out again (one mask setting can't say both).
 */
export function withAsShot(section: MaskSection, use: SectionMask | undefined, fx: EffectParams): SectionMask | undefined {
  if (!AS_SHOT_SECTIONS.includes(section)) return use
  const ids = live(fx)
    .filter((it) => it.mode === 'asShot' || it.keep)
    .map((it) => it.source!)
  if (!ids.length) return use
  if (!use || !use.ids.length) return { ids, mode: 'exclude' }
  if (use.mode === 'exclude') return { ids: [...use.ids, ...ids.filter((id) => !use.ids.includes(id))], mode: 'exclude' }
  return use
}

// Colour as the compositing spec's non-separable blend modes have it
// (Color, Hue): lightness by Rec. 601 weights, a colour's strength as its
// highest channel less its lowest.
const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b

/** (r, g, b) given lightness l, kept in range by moving it toward grey (ClipColor). Writes into o. */
function setLum(r: number, g: number, b: number, l: number, o: Float32Array) {
  const d = l - lum(r, g, b)
  r += d
  g += d
  b += d
  const L = lum(r, g, b)
  const n = Math.min(r, g, b)
  const x = Math.max(r, g, b)
  if (n < 0 && L - n > 1e-6) {
    const k = L / (L - n)
    r = L + (r - L) * k
    g = L + (g - L) * k
    b = L + (b - L) * k
  }
  if (x > 1 && x - L > 1e-6) {
    const k = (1 - L) / (x - L)
    r = L + (r - L) * k
    g = L + (g - L) * k
    b = L + (b - L) * k
  }
  o[0] = r
  o[1] = g
  o[2] = b
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * The photo with Recolour's parts in their new colours, or null when it
 * changes none. Colours are resolved already (resolveParams). The first in
 * the list is laid last, in front, as streaks and repeats are.
 *
 * Each pixel of a part takes the new colour's hue; its strength of colour is
 * the new colour's, scaled by how coloured the pixel is against the part as
 * a whole (Variation: panels and reflections stay a little different); its
 * lightness is its own, moved toward the colour's (Brightness) with its
 * contrast kept; the brightest pixels keep more of their own (Highlights).
 */
export function composeRecolour(base: TextureSource, size: Size, fx: EffectParams, maskFrame: Rect, photoFrame: Rect): OffscreenCanvas | null {
  const all = live(fx)
  const painting = all.filter((it) => it.mode !== 'asShot' && it.strength > 0)
  if (!painting.length) return null
  // Last in the list first, so the first is laid last, in front. A part kept
  // as shot puts the photo back over any part under it (one selected over it).
  const items = all.filter((it) => it.mode === 'asShot' || it.strength > 0).reverse()
  const cutter = pieceCutter(base, size, maskFrame, photoFrame)
  const { photo, W, H } = cutter
  const out = new OffscreenCanvas(W, H)
  const oc = out.getContext('2d', { willReadFrequently: true })!
  oc.drawImage(photo, 0, 0, W, H)
  const o = new Float32Array(3)
  for (const it of items) {
    const m = fx.masks.find((x) => x.id === it.source)!
    if (it.mode === 'asShot') {
      // The photo as it was, cut to the part.
      const layer = cutter.coverPicture(m)
      const lc = layer.getContext('2d')!
      lc.globalCompositeOperation = 'source-in'
      lc.drawImage(photo, 0, 0, W, H)
      oc.drawImage(layer, 0, 0)
      continue
    }
    const box = cutter.box(m)
    if (!box) continue
    const { bx, by, bw, bh } = box
    const cover = cutter.coverPicture(m).getContext('2d', { willReadFrequently: true })!.getImageData(bx, by, bw, bh).data
    // Read from the photo as it was (another part laid under this one changes
    // nothing it reads), laid over what is there now.
    const src = new OffscreenCanvas(bw, bh)
    const sc = src.getContext('2d', { willReadFrequently: true })!
    sc.drawImage(photo, bx, by, bw, bh, 0, 0, bw, bh)
    const px = sc.getImageData(0, 0, bw, bh).data
    const img = oc.getImageData(bx, by, bw, bh)
    const dst = img.data
    // The part as a whole: its mean lightness and strength of colour.
    let wsum = 0
    let lsum = 0
    let ssum = 0
    for (let i = 0; i < px.length; i += 4) {
      const a = cover[i + 3] / 255
      if (a <= 0.004) continue
      const r = px[i] / 255
      const g = px[i + 1] / 255
      const b = px[i + 2] / 255
      wsum += a
      lsum += a * lum(r, g, b)
      ssum += a * (Math.max(r, g, b) - Math.min(r, g, b))
    }
    if (wsum <= 0) continue
    const meanL = lsum / wsum
    const meanS = ssum / wsum
    const [tr, tg, tb] = it.colour.colour
    const tMin = Math.min(tr, tg, tb)
    const tMax = Math.max(tr, tg, tb)
    const tS = tMax - tMin
    const tL = lum(tr, tg, tb)
    const strength = Math.min(1, Math.max(0, it.strength))
    const bright = it.brightness ?? 0
    const keepHigh = it.highlights ?? 0
    const vary = it.variation ?? 0
    const shift = bright * (tL - meanL)
    const hue = it.mode === 'hue'
    for (let i = 0; i < px.length; i += 4) {
      const a = cover[i + 3] / 255
      if (a <= 0.004) continue
      const r = px[i] / 255
      const g = px[i + 1] / 255
      const b = px[i + 2] / 255
      const l = lum(r, g, b)
      const s = Math.max(r, g, b) - Math.min(r, g, b)
      // How strong its colour is: the pixel's own (Hue only), or the new colour's, varied as the part varies.
      // (Kept within half to one and a half times: a stray reflection is a little different, not a blotch.)
      const k = Math.min(1.5, Math.max(0.5, (s + 0.015) / (meanS + 0.015)))
      const sat = hue ? s : tS * (1 + (k - 1) * vary)
      // The new colour's hue at that strength (SetSat), then the pixel's lightness, moved by Brightness (SetLum).
      const f = tS > 1e-6 ? sat / tS : 0
      setLum((tr - tMin) * f, (tg - tMin) * f, (tb - tMin) * f, l + shift, o)
      // Reflections and lit windows keep more of their own.
      const w = a * strength * (1 - keepHigh * smooth(0.62, 0.95, l))
      const cr = dst[i] / 255
      const cg = dst[i + 1] / 255
      const cb = dst[i + 2] / 255
      dst[i] = Math.round((cr + (o[0] - cr) * w) * 255)
      dst[i + 1] = Math.round((cg + (o[1] - cg) * w) * 255)
      dst[i + 2] = Math.round((cb + (o[2] - cb) * w) * 255)
    }
    oc.putImageData(img, bx, by)
  }
  return out
}
