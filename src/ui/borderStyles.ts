import type { BorderParams } from '../engine/types'

/**
 * Ready-made borders: each sets everything about the border but its seed, so
 * picking one after another leaves nothing of the last behind. All of it
 * stays adjustable in the module afterwards.
 */
export interface BorderStyle {
  id: string
  name: string
  hint: string
  patch: Omit<BorderParams, 'seed'>
}

type Rgb = [number, number, number]

/** What a style doesn't say: flat paper, no shadow, bevel, line or inset. */
const PLAIN: Omit<BorderParams, 'seed' | 'width' | 'colour'> = {
  bottomExtra: 0,
  texture: 0,
  irregularity: 0,
  grain: 0,
  fill: 'solid',
  colour2: [1, 1, 1],
  fillAngle: 90,
  corner: 0,
  shadow: 0,
  shadowSize: 0.02,
  shadowDistance: 0.008,
  shadowAngle: 60,
  bevel: 0,
  bevelLight: 0.6,
  line: 0,
  lineGap: 0,
  lineColour: [0.1, 0.1, 0.1],
  inset: 0,
}

const style = (id: string, name: string, hint: string, width: number, colour: Rgb, rest: Partial<BorderParams> = {}): BorderStyle => ({
  id,
  name,
  hint,
  patch: { ...PLAIN, width, colour, colour2: colour, ...rest },
})

export const BORDER_STYLES: BorderStyle[] = [
  style('darkroom', 'Darkroom', 'Warm paper with tooth, an uneven printed edge and grain', 0.05, [0.94, 0.925, 0.895], {
    texture: 0.5,
    irregularity: 0.35,
    grain: 0.7,
  }),
  style('deckle', 'Torn', 'Rough cream paper, the edge torn rather than cut', 0.055, [0.93, 0.9, 0.84], { texture: 0.85, irregularity: 1, grain: 0.8 }),
  style('instant', 'Instant', 'An instant print: even white, a deep bottom, the photo slightly set in', 0.045, [0.96, 0.955, 0.94], {
    bottomExtra: 0.17,
    texture: 0.2,
    grain: 0.25,
    inset: 0.25,
  }),
  style('mat', 'Mat', 'A wide gallery mat with a bevelled cut, as framed', 0.12, [0.95, 0.94, 0.91], {
    bottomExtra: 0.015,
    texture: 0.25,
    grain: 0.15,
    bevel: 0.009,
    bevelLight: 0.7,
    inset: 0.2,
  }),
  style('clean', 'Clean', 'Plain digital white, a straight edge, nothing on it', 0.04, [1, 1, 1]),
  style('black', 'Black', 'Flat black round the photo', 0.04, [0.055, 0.055, 0.06]),
  style('keyline', 'Keyline', 'White with a thin line round the photo', 0.05, [0.98, 0.98, 0.97], { line: 0.0025, lineGap: 0.007 }),
  style('floating', 'Floating', 'The photo lifted off grey paper, with a soft shadow and rounded corners', 0.09, [0.9, 0.9, 0.89], {
    corner: 0.008,
    shadow: 0.55,
    shadowSize: 0.03,
    shadowDistance: 0.012,
  }),
  style('gradient', 'Gradient', 'A colour gradient behind the photo, with a shadow and rounded corners', 0.08, [0.97, 0.72, 0.55], {
    fill: 'linear',
    colour2: [0.5, 0.42, 0.8],
    fillAngle: 135,
    corner: 0.025,
    shadow: 0.4,
    shadowSize: 0.035,
    shadowDistance: 0.014,
  }),
  style('spotlight', 'Spotlight', 'Dark, lighter behind the photo, its shadow under it', 0.1, [0.24, 0.24, 0.27], {
    fill: 'radial',
    colour2: [0.04, 0.04, 0.05],
    corner: 0.006,
    shadow: 0.7,
    shadowSize: 0.05,
    shadowDistance: 0.016,
    shadowAngle: 90,
  }),
]

const same = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b)
    ? a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-3)
    : typeof a === 'number' && typeof b === 'number'
      ? Math.abs(a - b) < 1e-4
      : a === b

/** The style a border is, if it is exactly one (width and bottom aside: those are often changed). */
export function borderStyleOf(border: BorderParams): string | null {
  const have = { ...PLAIN, colour2: border.colour, ...border } as Record<string, unknown>
  const found = BORDER_STYLES.find((s) => Object.entries(s.patch).every(([k, v]) => k === 'width' || k === 'bottomExtra' || same(have[k], v)))
  return found?.id ?? null
}
