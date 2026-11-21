import { hsvToRgb, oklab, rampColour, rgbToHsv } from './harmony'
import type { Rgb } from './types'

/**
 * Light & shade: a palette made from two colours, one for the light and one
 * for the shade, each held to where good palettes live (see README, "Why
 * Tide works"):
 *
 * - The light is warm (pink-red through orange and amber to yellow) and the
 *   shade is cool (teal through blue to violet), as real light is: sun and
 *   lamps warm, shade lit by the sky.
 * - Each colour is made at the brightness it is used at, so it is only as
 *   deep as that hue can be there: no muddy dark yellows, no clipped light
 *   violets.
 * - The midtones lean to the shade but sit near grey, so the ramp crosses
 *   neutral between the two, as Tide's teal and orange do.
 * - The strongest colour on the ramp is capped near Tide's.
 *
 * Hues are OKLCh angles in degrees (red ≈ 29, orange ≈ 55, yellow ≈ 110,
 * teal ≈ 195, blue ≈ 264, violet ≈ 300).
 */
export interface Side {
  /** OKLCh hue, degrees. */
  hue: number
  /** How deep, 0 (grey) .. 1 (as deep as this side goes). */
  r: number
}
export interface LightShade {
  light: Side
  shade: Side
}

export const LIGHT_ARC: [number, number] = [10, 115]
export const SHADE_ARC: [number, number] = [165, 315]

/** The most chroma anywhere on the ramp: Tide peaks at about 0.12. */
const RAMP_CAP = 0.13

/** Where on screen a hue sits, degrees clockwise from the top: warm up, cool down. */
export const SCREEN_OFFSET = 62

const wrap = (d: number) => ((d % 360) + 360) % 360

/** Bring a hue into an arc: the nearer end if it is outside. */
export function clampHue(hue: number, [a, b]: [number, number]): number {
  const h = wrap(hue)
  if (h >= a && h <= b) return h
  const dist = (x: number, y: number) => Math.min(wrap(x - y), wrap(y - x))
  return dist(h, a) <= dist(h, b) ? a : b
}

/** Which side a hue belongs to, or which it is nearer. */
export function sideOf(hue: number): 'light' | 'shade' {
  const h = wrap(hue)
  const mid = (arc: [number, number]) => (arc[0] + arc[1]) / 2
  const dist = (x: number, y: number) => Math.min(wrap(x - y), wrap(y - x))
  return dist(h, mid(LIGHT_ARC)) <= dist(h, mid(SHADE_ARC)) ? 'light' : 'shade'
}

const toSrgb = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)

/** sRGB (unclamped) of an OKLab colour. */
export function fromOklab([L, a, b]: [number, number, number]): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((v) => Math.sign(v) * toSrgb(Math.abs(v))) as Rgb
}

const inGamut = (c: Rgb) => c.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** An OKLCh colour, its chroma reduced until it fits sRGB. */
export function oklch(L: number, C: number, hue: number): Rgb {
  const h = (hue * Math.PI) / 180
  const at = (c: number) => fromOklab([L, c * Math.cos(h), c * Math.sin(h)])
  if (inGamut(at(C))) return at(C).map((v) => Math.min(1, Math.max(0, v))) as Rgb
  let lo = 0
  let hi = C
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(at(mid))) lo = mid
    else hi = mid
  }
  return at(lo).map((v) => Math.min(1, Math.max(0, v))) as Rgb
}

export function lch(c: Rgb): [number, number, number] {
  const [L, a, b] = oklab(c)
  return [L, Math.hypot(a, b), wrap((Math.atan2(b, a) * 180) / Math.PI)]
}

/** The HSV hue (turns) of an OKLCh hue (degrees). */
const hsvHue = (hue: number) => rgbToHsv(oklch(0.65, 0.1, hue))[0]

/** Turn `hue` toward `to` by 30% of the way, at most `most` degrees. */
function lean(hue: number, to: number, most: number) {
  let d = wrap(to - hue)
  if (d > 180) d -= 360
  return wrap(hue + Math.sign(d) * Math.min(Math.abs(d) * 0.3, most))
}

/** The three stops (shadows, midtones, light) for a light & shade palette. */
export function lightShadeStops(p: LightShade): [Rgb, Rgb, Rgb] {
  const lightHue = clampHue(p.light.hue, LIGHT_ARC)
  const shadeHue = clampHue(p.shade.hue, SHADE_ARC)
  // The gradient map rescales each stop to the pixel's own brightness, so what
  // a stop carries is its hue and how saturated it is; its brightness only
  // weighs how it blends with its neighbours. Built as Tide is: a deep, dim
  // shadow a little bluer than the shade, a midtone in the shade's colour, and
  // the light at full brightness. Mid and light mix toward grey between them.
  const rs = Math.max(0, Math.min(1, p.shade.r))
  const rl = Math.max(0, Math.min(1, p.light.r))
  const deepHue = lean(shadeHue, 264, 25)
  const make = (scale: number): [Rgb, Rgb, Rgb] => [
    hsvToRgb([hsvHue(deepHue), Math.min(0.92, 0.9 * rs * scale), 0.2]),
    hsvToRgb([hsvHue(shadeHue), Math.min(0.9, 0.83 * rs * scale), 0.5]),
    hsvToRgb([hsvHue(lightHue), Math.min(0.9, 0.82 * rl * scale), 1]),
  ]
  // Cap the strongest colour the ramp actually gives the photo.
  let scale = 1
  let stops = make(scale)
  for (let i = 0; i < 4; i++) {
    const peak = rampPeak(stops)
    if (peak <= RAMP_CAP) break
    scale *= RAMP_CAP / peak
    stops = make(scale)
  }
  return stops
}

/** The most chroma anywhere along a ramp, as the gradient map gives it. */
export function rampPeak(stops: [Rgb, Rgb, Rgb]): number {
  let peak = 0
  for (let k = 0; k <= 20; k++) peak = Math.max(peak, lch(rampColour(stops, k / 20, 0, 0))[1])
  return peak
}

/**
 * Read a palette back as light & shade, for placing the handles: the shade
 * from the midtone colour, the light from the light's. A palette the ramp
 * cap scaled down reads back a little shallower than it was set.
 */
export function lightShadeOf(mid: Rgb, high: Rgb): LightShade {
  const side = (c: Rgb, full: number, arc: [number, number], fallback: number): Side => {
    const [, sat] = rgbToHsv(c)
    const [, chroma, h] = lch(c)
    if (chroma < 0.01 || sat < 0.02) return { hue: fallback, r: 0 }
    return { hue: clampHue(h, arc), r: Math.min(1, sat / full) }
  }
  return { light: side(high, 0.82, LIGHT_ARC, 55), shade: side(mid, 0.83, SHADE_ARC, 235) }
}

/** The other side's hue, mirrored across the wheel and held to its arc. */
export function mirrored(hue: number, to: 'light' | 'shade'): number {
  return clampHue(hue + 180, to === 'light' ? LIGHT_ARC : SHADE_ARC)
}
