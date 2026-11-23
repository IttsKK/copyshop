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
}

export interface RecolourModule {
  enabled: boolean
  items: RecolourItem[]
}

export const DEFAULT_RECOLOUR: RecolourModule = { enabled: false, items: [] }

/** Room for this many parts (each has its own mask, and masks are limited). */
export const MAX_RECOLOURS = 6

/** Each new part's colour, in turn, so three parts made one after another come out three colours. */
export const RECOLOUR_STARTS: Rgb[] = [
  [0.85, 0.25, 0.18],
  [0.2, 0.42, 0.85],
  [0.93, 0.72, 0.15],
  [0.2, 0.62, 0.42],
  [0.75, 0.25, 0.65],
  [0.95, 0.5, 0.18],
]

export const newRecolourItem = (id: string, source: string, n: number): RecolourItem => ({
  id,
  enabled: true,
  source,
  mode: 'colour',
  colour: { source: 'manual', colour: RECOLOUR_STARTS[n % RECOLOUR_STARTS.length] },
  strength: 1,
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

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`

/**
 * The photo with Recolour's parts in their new colours, or null when it
 * changes none. Colours are resolved already (resolveParams). The first in
 * the list is laid last, in front, as streaks and repeats are.
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
  const oc = out.getContext('2d')!
  oc.drawImage(photo, 0, 0, W, H)
  for (const it of items) {
    const m = fx.masks.find((x) => x.id === it.source)!
    const layer = cutter.coverPicture(m)
    const lc = layer.getContext('2d')!
    lc.globalCompositeOperation = 'source-in'
    if (it.mode === 'asShot') {
      // The photo as it was, cut to the part.
      lc.drawImage(photo, 0, 0, W, H)
      oc.globalAlpha = 1
      oc.globalCompositeOperation = 'source-over'
    } else {
      // The colour, cut to the part (its soft edge with it). Color: its hue and
      // strength of colour, the photo's own light. Hue: the hue alone.
      lc.fillStyle = css(it.colour.colour)
      lc.fillRect(0, 0, W, H)
      oc.globalAlpha = Math.min(1, Math.max(0, it.strength))
      oc.globalCompositeOperation = it.mode === 'hue' ? 'hue' : 'color'
    }
    oc.drawImage(layer, 0, 0)
  }
  oc.globalAlpha = 1
  oc.globalCompositeOperation = 'source-over'
  return out
}
