/**
 * Colour stocks: stylised palettes rather than faithful film profiles.
 *
 * Each one is a handful of hue moves plus a split tone, applied to the encoded
 * image. Hue moves are Gaussian bumps on the hue circle — "greens, pushed a
 * quarter turn toward blue" — which is how the looks that inspired these read:
 * LomoChrome Purple turns foliage blue and skies lavender, Turquoise turns
 * skies teal and warms everything else. A 3×3 channel mixer can approximate
 * those, but it moves every hue at once and a sky ends up somewhere nobody
 * chose; anchored hue moves change only what they name.
 *
 * Stored in presets by id, so improving a stock here improves every look that
 * uses it.
 */

export interface HueMove {
  /** Hue to act on, 0..1 around the circle (0 red, 1/3 green, 2/3 blue). */
  hue: number
  /** How far to rotate it, in turns. */
  shift: number
  /** Saturation multiplier at the centre of the move. */
  saturation: number
  /** Half-width of the affected band, in turns. */
  width: number
}

export interface Stock {
  id: string
  label: string
  hint: string
  moves: HueMove[]
  /** Added to the shadows, fading out by the highlights. */
  lift: [number, number, number]
  /** Multiplies the highlights, fading out by the shadows. */
  gain: [number, number, number]
  /** Global saturation multiplier. */
  saturation: number
  /** S-curve strength around mid-grey; negative flattens. */
  contrast: number
}

export const MAX_HUE_MOVES = 4

export const STOCKS: Stock[] = [
  {
    id: 'none',
    label: 'Natural',
    hint: 'The picture’s own colour',
    moves: [],
    lift: [0, 0, 0],
    gain: [1, 1, 1],
    saturation: 1,
    contrast: 0,
  },
  {
    id: 'sunburn',
    label: 'Sunburn',
    hint: 'Hot reds and oranges, pale cyan light',
    moves: [
      { hue: 0.07, shift: -0.02, saturation: 1.45, width: 0.09 },
      { hue: 0.58, shift: -0.06, saturation: 0.75, width: 0.12 },
      { hue: 0.75, shift: -0.12, saturation: 1.1, width: 0.08 },
    ],
    lift: [0.035, 0.0, 0.015],
    gain: [1.06, 0.99, 0.9],
    saturation: 1.15,
    contrast: 0.18,
  },
  {
    id: 'violet',
    label: 'Violet',
    hint: 'Greens turn blue, skies lavender — after LomoChrome Purple',
    moves: [
      { hue: 0.3, shift: 0.3, saturation: 1.5, width: 0.12 },
      { hue: 0.62, shift: 0.07, saturation: 0.85, width: 0.1 },
      { hue: 0.08, shift: -0.02, saturation: 1.25, width: 0.08 },
    ],
    lift: [0.03, 0.0, 0.05],
    gain: [1.02, 0.96, 1.02],
    saturation: 1.1,
    contrast: 0.12,
  },
  {
    id: 'turquoise',
    label: 'Turquoise',
    hint: 'Teal skies, golden warms — after LomoChrome Turquoise',
    moves: [
      { hue: 0.64, shift: -0.14, saturation: 1.2, width: 0.12 },
      { hue: 0.08, shift: 0.03, saturation: 1.3, width: 0.08 },
      { hue: 0.3, shift: 0.12, saturation: 1.1, width: 0.1 },
    ],
    lift: [0.0, 0.03, 0.035],
    gain: [1.05, 1.0, 0.92],
    saturation: 1.1,
    contrast: 0.1,
  },
  {
    id: 'amber',
    label: 'Amber',
    hint: 'Foliage turns amber and rust, skies go deep blue, whites warm to peach',
    moves: [
      { hue: 0.3, shift: -0.21, saturation: 1.3, width: 0.1 },
      // Yellows only nudged: already-sunlit foliage should land on amber, not
      // be pushed on through orange into red.
      { hue: 0.16, shift: -0.065, saturation: 1.15, width: 0.06 },
      { hue: 0.6, shift: 0.0, saturation: 1.35, width: 0.09 },
      { hue: 0.06, shift: 0.0, saturation: 0.9, width: 0.05 },
    ],
    lift: [0.0, 0.025, 0.035],
    gain: [1.02, 0.95, 0.89],
    saturation: 1.05,
    contrast: 0.22,
  },
  {
    id: 'expired',
    label: 'Expired',
    hint: 'Faded, magenta shadows, soft colour',
    moves: [
      { hue: 0.33, shift: 0.08, saturation: 0.8, width: 0.12 },
      { hue: 0.62, shift: 0.04, saturation: 0.8, width: 0.12 },
    ],
    lift: [0.07, 0.035, 0.075],
    gain: [0.99, 0.95, 0.86],
    saturation: 0.82,
    contrast: -0.12,
  },
  {
    id: 'redscale',
    label: 'Redscale',
    hint: 'Red and amber throughout, like film shot through its base',
    moves: [
      { hue: 0.62, shift: -0.5, saturation: 0.7, width: 0.2 },
      { hue: 0.3, shift: -0.22, saturation: 0.9, width: 0.15 },
    ],
    lift: [0.04, 0.0, 0.0],
    gain: [1.12, 0.78, 0.42],
    saturation: 1.2,
    contrast: 0.15,
  },
]

export const STOCK_BY_ID: Record<string, Stock> = Object.fromEntries(STOCKS.map((s) => [s.id, s]))

export function stockById(id: string): Stock {
  return STOCK_BY_ID[id] ?? STOCKS[0]
}

/** Hue moves packed for a vec4 uniform array: hue, shift, saturation, width. */
export function packHueMoves(stock: Stock): Float32Array {
  const out = new Float32Array(MAX_HUE_MOVES * 4)
  stock.moves.slice(0, MAX_HUE_MOVES).forEach((m, i) => {
    out.set([m.hue, m.shift, m.saturation, m.width], i * 4)
  })
  return out
}
