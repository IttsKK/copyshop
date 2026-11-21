import type { Rgb } from './types'

/**
 * Colour harmonies for the palette wheel. A palette is three colours — for
 * the shadows, the midtones and the light — and a harmony ties their hues
 * together, so turning one turns the rest with it. Saturation stays each
 * colour's own: how far from the wheel's centre it sits.
 */
export type Harmony = 'mono' | 'complementary' | 'split' | 'triad' | 'analogous' | 'free'

export const HARMONIES: { id: Harmony; label: string; hint: string }[] = [
  { id: 'complementary', label: 'Opposite', hint: 'Shadows and midtones on one hue, the light on the hue across the wheel — teal and orange, navy and gold' },
  { id: 'split', label: 'Split', hint: 'The light on one hue; shadows and midtones either side of its opposite' },
  { id: 'triad', label: 'Triad', hint: 'Three hues a third of the wheel apart' },
  { id: 'analogous', label: 'Neighbours', hint: 'Three hues next to each other: a gentle shift through the tones' },
  { id: 'mono', label: 'Mono', hint: 'One hue through every tone, deeper or paler by how far out each colour sits' },
  { id: 'free', label: 'Free', hint: 'Each colour moves on its own' },
]

/** A colour on the wheel: hue in turns (0..1, red at 0), saturation 0..1. */
export interface WheelPoint {
  hue: number
  sat: number
}

/** Shadows, midtones, light. */
export type Trio<T> = [T, T, T]

/** Each colour's hue, in turns from the light's, for each harmony. */
const OFFSETS: Record<Exclude<Harmony, 'free'>, Trio<number>> = {
  mono: [0, 0, 0],
  complementary: [0.5, 0.5, 0],
  split: [5 / 12, 7 / 12, 0],
  triad: [2 / 3, 1 / 3, 0],
  analogous: [-1 / 6, -1 / 12, 0],
}

const turn = (h: number) => ((h % 1) + 1) % 1

/** Move one colour to `to` and leave the others (the wheel's Free mode). */
export function moveOne(points: Trio<WheelPoint>, index: number, to: WheelPoint): Trio<WheelPoint> {
  const moved = { hue: turn(to.hue), sat: Math.min(1, Math.max(0, to.sat)) }
  return points.map((p, i) => (i === index ? moved : p)) as Trio<WheelPoint>
}

export function rgbToHsv([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d + 6) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
  }
  return [h / 6, max > 0 ? d / max : 0, max]
}

export function hsvToRgb([h, s, v]: [number, number, number]): Rgb {
  const f = (n: number) => {
    const k = (n + h * 6) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

export const wheelPoint = (c: Rgb): WheelPoint => {
  const [hue, sat] = rgbToHsv(c)
  return { hue, sat }
}

/**
 * The colour for a wheel point, keeping the brightness the colour had. The
 * gradient map keeps each pixel's own brightness, so a colour's brightness
 * only weighs how two neighbouring colours mix; it is floored so a black
 * colour can still take a hue.
 */
export const fromWheel = (p: WheelPoint, was: Rgb): Rgb => hsvToRgb([p.hue, p.sat, Math.max(0.2, rgbToHsv(was)[2])])

const W: Rgb = [0.2126, 0.7152, 0.0722]
const luma = (c: Rgb) => c[0] * W[0] + c[1] * W[1] + c[2] * W[2]

/**
 * Where a brightness lands on the ramp, as the shader works it out: Balance
 * slides the midtone colour toward the shadows (-1) or the light (+1).
 */
export function mapPosition(t: number, balance: number): number {
  return Math.pow(Math.min(1, Math.max(0, t)), Math.pow(2, -balance))
}

/**
 * The brightness a pixel is given back, about the middle of the photo's range
 * `mid`: Contrast above 0 pulls the tones apart, below 0 draws them together.
 */
export function mapTone(l: number, contrast: number, mid = 0.5): number {
  const k = Math.pow(2, contrast * 1.2)
  const m = Math.min(0.95, Math.max(0.05, mid))
  const x = Math.min(1, Math.max(0, l))
  return x < m ? m * Math.pow(x / m, k) : 1 - (1 - m) * Math.pow((1 - x) / (1 - m), k)
}

/** The palette as a strip, dark to light, for showing under the wheel. */
export function rampColour(colours: Trio<Rgb>, t: number, balance: number, contrast: number): Rgb {
  const p = mapPosition(t, balance)
  const [a, b] = p < 0.5 ? [colours[0], colours[1]] : [colours[1], colours[2]]
  const f = p < 0.5 ? p * 2 : p * 2 - 1
  const mixed: Rgb = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
  const l = mapTone(t, contrast)
  const scale = (l + 1e-3) / (luma(mixed) + 1e-3)
  let out: Rgb = [mixed[0] * scale, mixed[1] * scale, mixed[2] * scale]
  const top = Math.max(...out)
  if (top > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / Math.max(top - l, 1e-4)) as Rgb
  return out.map((v) => Math.min(1, Math.max(0, v))) as Rgb
}

// ---------------------------------------------------------------------------
// OKLab, for judging how light a colour looks.

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4))

/** OKLab of an sRGB colour: L 0..1, then a (green-red) and b (blue-yellow). */
export function oklab(c: Rgb): [number, number, number] {
  const [r, g, b] = c.map(toLinear)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

// ---------------------------------------------------------------------------
// The guided wheel.

/**
 * How naturally light a colour is: its lightness at full brightness, plus
 * warmth. Sunlight is warm and shade is lit by blue sky, so of two colours
 * equally light the warmer reads as the light: Tide's orange over its teal.
 */
export function naturalLightness(p: WheelPoint): number {
  const [L, a, b] = oklab(hsvToRgb([p.hue, Math.max(p.sat, 0.6), 1]))
  return L + 1.5 * b + 0.6 * a
}

/** Brightness each tone's colour is stored at: it weighs how neighbouring colours blend, dark into light. */
export const TONE_VALUES: Trio<number> = [0.25, 0.55, 1]

/** How deep each tone's colour runs next to the others: shadows deepest, the light a little paler. */
const DEPTH: Trio<number> = [1, 0.88, 0.94]

/** Hues the shadows lean toward (a sky blue) and the light toward (a sunlit amber), in turns. */
const COOL = 0.62
const WARM = 0.1
/** How far, at most, in turns. */
const LEAN: Trio<number> = [0.045, 0.015, 0.03]

/** Turn `hue` toward `to` by up to `most`. */
const lean = (hue: number, to: number, most: number) => {
  let d = turn(to - hue)
  if (d > 0.5) d -= 1
  return turn(hue + Math.sign(d) * Math.min(Math.abs(d) * 0.35, most))
}

/**
 * The guided wheel: drag one colour and the other two are laid out from it
 * as a palette that works. The dragged one goes exactly where it is put. The
 * others take the harmony's hues from it; whichever colour is naturally
 * lighter goes on the light tones (the dragged one changes tone only when
 * the order clearly asks, so it does not flicker at the crossover); the
 * shadows lean a little cool and the light a little warm, as real light
 * does; and their depth follows the dragged one's. Returns the palette,
 * darkest tone first, and where the dragged colour is now.
 */
export function guidedMove(
  harmony: Exclude<Harmony, 'free'>,
  index: number,
  to: WheelPoint,
): { points: Trio<WheelPoint>; index: number } {
  const lead: WheelPoint = { hue: turn(to.hue), sat: Math.min(1, Math.max(0, to.sat)) }
  const off = OFFSETS[harmony]
  // Each tone the dragged colour could take, scored by how far the result is
  // from naturally ordered (darkest colour on the shadows).
  const layouts = [0, 1, 2].map((k) => {
    const hues = off.map((o) => turn(lead.hue - off[k] + o)) as Trio<number>
    const light = hues.map((h, i) => naturalLightness({ hue: h, sat: i === k ? lead.sat : 0.8 }))
    const wrong = Math.max(0, light[0] - light[1]) + Math.max(0, light[1] - light[2]) + Math.max(0, light[0] - light[2])
    return { k, hues, wrong }
  })
  const stay = layouts[index]
  const best = layouts.reduce((b, l) => (l.wrong < b.wrong ? l : b))
  // Hysteresis: keep the tone it has unless another is clearly better.
  const pick = stay.wrong - best.wrong > 0.05 ? best : stay
  const k = pick.k
  const sat = (i: number) => Math.min(0.95, Math.max(0.12, (lead.sat * DEPTH[i]) / DEPTH[k]))
  const out = pick.hues.map((h, i) => {
    if (i === k) return lead
    const toward = i === 0 ? COOL : i === 2 ? WARM : h
    return { hue: lean(h, toward, LEAN[i]), sat: sat(i) }
  }) as Trio<WheelPoint>
  return { points: out, index: k }
}

/** The palette's colours for wheel points, each at its tone's brightness. */
export const toneColours = (points: Trio<WheelPoint>): Trio<Rgb> =>
  points.map((p, i) => hsvToRgb([p.hue, p.sat, TONE_VALUES[i]])) as Trio<Rgb>
