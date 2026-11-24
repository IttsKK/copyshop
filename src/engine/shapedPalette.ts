import type { Trio } from './harmony'
import type { Rgb } from './types'

/**
 * Gradient maps built the way Tide is, in any pair of hues. Tide holds up on
 * nearly every photo because of how it is built, not its hues:
 *
 * - a near-black shadow (luminance 0.05), so the contrast never goes muddy;
 * - a strong middle colour (saturation about 0.83) at luminance 0.31;
 * - a strong, fully bright highlight colour at about luminance 0.6, a colour
 *   and not white, so the brightest parts of a photo (a sky) take a colour
 *   instead of washing out;
 * - the middle and highlight nearly opposite on the wheel, which gives depth
 *   on any subject.
 *
 * These keep all of that and change only the two hues.
 */

const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
const hsv = (h: number, s: number, v: number): Rgb => {
  const f = (n: number) => {
    const k = (n + (((h % 360) + 360) % 360) / 60) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}
const round = (c: Rgb): Rgb => c.map((v) => Math.round(v * 1000) / 1000) as Rgb

/** A colour of this hue and saturation at this luminance; less saturated at full value when the hue can't be that light. */
function at(hue: number, sat: number, target: number): Rgb {
  if (luma(hsv(hue, sat, 1)) < target) {
    let lo = 0
    let hi = sat
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2
      if (luma(hsv(hue, m, 1)) < target) hi = m
      else lo = m
    }
    return round(hsv(hue, (lo + hi) / 2, 1))
  }
  let lo = 0
  let hi = 1
  for (let i = 0; i < 30; i++) {
    const m = (lo + hi) / 2
    if (luma(hsv(hue, sat, m)) < target) lo = m
    else hi = m
  }
  return round(hsv(hue, sat, (lo + hi) / 2))
}

/** A fully bright colour of this hue, as near luminance 0.6 as it gets (yellows and cyans can't go that dark). */
function bright(hue: number): Rgb {
  let best = { d: Infinity, c: hsv(hue, 0.82, 1) }
  for (let s = 0.7; s <= 1.0001; s += 0.01) {
    const c = hsv(hue, s, 1)
    const d = Math.abs(luma(c) - 0.6)
    if (d < best.d) best = { d, c }
  }
  return round(best.c)
}

/** Shadow, middle and highlight in Tide's build: the middle in `midHue`, the highlight in `highHue` (degrees). */
export function shapedColours(midHue: number, highHue: number): Trio<Rgb> {
  return [at(midHue + 28, 0.87, 0.05), at(midHue, 0.83, 0.31), bright(highHue)]
}
