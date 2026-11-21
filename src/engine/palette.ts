import type { Rgb, TextureSource } from './types'

/**
 * Three colours read from a photo, for looks that take their colour from the
 * picture instead of imposing one:
 *
 * - `light`  — the colour of the light: the saturation-weighted average of the
 *   brightest tenth of the frame. An orange sunset gives orange, overcast gives
 *   near-white, blue hour gives blue. Glow and leaks built from it belong to the
 *   picture they are on.
 * - `shadow` — the average colour of the darkest quarter.
 * - `accent` — the most prominent saturated hue anywhere in the frame, at full
 *   saturation.
 *
 * All sRGB, normalised so the brightest channel is 1: these are hues and
 * saturations, and each use decides its own intensity.
 */
export interface Palette {
  light: Rgb
  shadow: Rgb
  accent: Rgb
  /**
   * The most vivid colour: the hue with the highest average saturation among
   * those that cover a meaningful part of the frame. Where accent is the most
   * widespread colour (a big blue sky), vivid is the one that stands out (the
   * orange horizon under it).
   */
  vivid: Rgb
  /**
   * The photo's own tonal range, encoded luminance at the 3rd and 97th
   * percentiles. The gradient map spreads its colours across this, so a dark
   * photo still reaches its highlight colour.
   */
  range: [number, number]
}

export const NEUTRAL_PALETTE: Palette = {
  light: [1, 0.61, 0.38],
  shadow: [0.35, 0.3, 0.75],
  accent: [1, 0.45, 0.2],
  vivid: [1, 0.45, 0.2],
  range: [0, 1],
}

const SAMPLE = 96

function normalise(c: Rgb): Rgb {
  const m = Math.max(c[0], c[1], c[2], 1e-6)
  return [c[0] / m, c[1] / m, c[2] / m]
}

function hsvToRgb(h: number, s: number, v: number): Rgb {
  const f = (n: number) => {
    const k = (n + h * 6) % 6
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return [f(5), f(3), f(1)]
}

/** Palette from raw RGBA pixels. Pure, so it can be tested without a canvas. */
export function paletteFromPixels(data: Uint8ClampedArray): Palette {
  const n = data.length / 4
  if (n === 0) return NEUTRAL_PALETTE
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    luma[i] = (0.2126 * data[i * 4] + 0.7152 * data[i * 4 + 1] + 0.0722 * data[i * 4 + 2]) / 255
  }
  const sorted = Float32Array.from(luma).sort()
  const hi = sorted[Math.floor(n * 0.9)]
  const rangeLo = sorted[Math.floor(n * 0.03)]
  const rangeHi = sorted[Math.min(n - 1, Math.floor(n * 0.97))]
  const lo = sorted[Math.floor(n * 0.25)]

  const light = [0, 0, 0]
  const shadow = [0, 0, 0]
  let lightW = 0
  let shadowW = 0
  const bins = new Float32Array(36)
  const binSat = new Float32Array(36)
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] / 255
    const g = data[i * 4 + 1] / 255
    const b = data[i * 4 + 2] / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max > 0 ? (max - min) / max : 0
    if (luma[i] >= hi) {
      // Saturated bright pixels are the light source's colour; white clipping
      // carries none, so weight by saturation (with a floor, so an all-white
      // sky still yields white rather than nothing).
      const w = 0.05 + sat
      light[0] += r * w
      light[1] += g * w
      light[2] += b * w
      lightW += w
    }
    if (luma[i] <= lo) {
      const w = 0.1 + sat
      shadow[0] += r * w
      shadow[1] += g * w
      shadow[2] += b * w
      shadowW += w
    }
    if (max - min > 0.02) {
      let h: number
      if (max === r) h = ((g - b) / (max - min) + 6) % 6
      else if (max === g) h = (b - r) / (max - min) + 2
      else h = (r - g) / (max - min) + 4
      const bin = Math.min(35, Math.floor((h / 6) * 36))
      const w = sat * sat * max
      bins[bin] += w
      binSat[bin] += sat * w
    }
  }

  let peak = 0
  for (let i = 1; i < 36; i++) if (bins[i] > bins[peak]) peak = i
  const accent = bins[peak] > 0 ? hsvToRgb((peak + 0.5) / 36, 0.85, 1) : NEUTRAL_PALETTE.accent
  // Vivid: neighbouring bins pooled (a hue spreads over a few), then the pool
  // with the highest mean saturation among those holding at least 2% of the
  // colour weight — enough to be a real part of the picture, not a stray pixel.
  let totalW = 0
  for (let i = 0; i < 36; i++) totalW += bins[i]
  let vividBin = -1
  let vividSat = 0
  for (let i = 0; i < 36; i++) {
    const w = bins[(i + 35) % 36] + bins[i] + bins[(i + 1) % 36]
    const s = binSat[(i + 35) % 36] + binSat[i] + binSat[(i + 1) % 36]
    if (totalW <= 0 || w < totalW * 0.02) continue
    // Warm light, when the picture has any, is what stands out to the eye:
    // a sunset's orange beats a slightly more saturated blue in its clouds.
    const hue = (i + 0.5) / 36
    const warm = hue < 0.17 || hue > 0.9 ? 1.35 : 1
    const mean = (s / w) * warm
    if (mean > vividSat) {
      vividSat = mean
      vividBin = i
    }
  }
  const vivid = vividBin >= 0 ? hsvToRgb((vividBin + 0.5) / 36, 0.85, 1) : accent

  return {
    light: lightW > 0 ? normalise([light[0] / lightW, light[1] / lightW, light[2] / lightW]) : NEUTRAL_PALETTE.light,
    shadow:
      shadowW > 0 ? normalise([shadow[0] / shadowW, shadow[1] / shadowW, shadow[2] / shadowW]) : NEUTRAL_PALETTE.shadow,
    accent,
    vivid,
    range: rangeHi - rangeLo > 0.05 ? [rangeLo, rangeHi] : [0, 1],
  }
}

type Canvas2D = HTMLCanvasElement | OffscreenCanvas

function smallCanvas(width: number, height: number): Canvas2D {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height)
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  return c
}

/**
 * Palette of an image, read from a small downsample. The same file decoded
 * twice gives the same pixels and so the same palette, which is what keeps the
 * preview and the export in agreement.
 */
export function extractPalette(source: TextureSource, width: number, height: number): Palette {
  const data = samplePixels(source, width, height, SAMPLE)
  return data ? paletteFromPixels(data) : NEUTRAL_PALETTE
}

/** A small downsample of an image's pixels, longest side `max`. */
export function samplePixels(
  source: TextureSource,
  width: number,
  height: number,
  max: number,
): Uint8ClampedArray | null {
  const scale = Math.min(1, max / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale))
  const h = Math.max(1, Math.round(height * scale))
  const canvas = smallCanvas(w, h)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  if (!ctx) return null
  if (source instanceof ImageData) {
    const full = smallCanvas(source.width, source.height)
    ;(full.getContext('2d') as CanvasRenderingContext2D).putImageData(source, 0, 0)
    ctx.drawImage(full as CanvasImageSource, 0, 0, w, h)
  } else {
    ctx.drawImage(source as CanvasImageSource, 0, 0, w, h)
  }
  return ctx.getImageData(0, 0, w, h).data
}
