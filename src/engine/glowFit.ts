import type { Palette } from './palette'

/**
 * Glow fitted to the photo. Halation and bloom add the blurred highlights
 * back onto the picture, so how much they brighten it depends on how much of
 * the photo is above the glow's threshold: a street at night has a few
 * lights, a snowfield or a white sky is nearly all highlight, and the same
 * setting washes it out. Fitted, the glow keeps its strength while the
 * bright part is small and is turned down as it grows, by the photo's own
 * brightness (Palette.lumas), so preview, export and batch agree.
 */

/** How much of the photo a glow lights before it is turned down: about the middle photo of a few hundred. */
export const GLOW_FIT_FROM = 0.1
/** How quickly it is turned down past that. */
const FALL = 0.85
/** Never below this share of the setting: a bright photo still glows. */
const FLOOR = 0.3

/**
 * How much light a glow at this threshold picks up from the photo, as the
 * glow pass does (glow.ts): each pixel's linear luminance through the same
 * soft knee, averaged over the frame.
 */
export function glowFill(lumas: number[], threshold: number): number {
  if (!lumas.length) return 0
  let sum = 0
  for (const l of lumas) {
    const x = Math.min(1, Math.max(0, (l - threshold) / Math.max(1e-6, Math.min(1, threshold + 0.18) - threshold)))
    sum += l * x * x * (3 - 2 * x)
  }
  return sum / lumas.length
}

/** The share of halation and bloom kept on this photo: 1 while little of it glows, less as more does. */
export function glowFitGain(palette: Palette, threshold: number): number {
  if (!palette.lumas) return 1
  const fill = glowFill(palette.lumas, threshold)
  if (fill <= GLOW_FIT_FROM) return 1
  return Math.max(FLOOR, (GLOW_FIT_FROM / fill) ** FALL)
}
