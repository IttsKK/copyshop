import { hsvToRgb, rgbToHsv } from './harmony'
import type { Rgb } from './types'

/**
 * Colour blobs (experiment): soft spots on the colour wheel that pull the
 * photo's colours toward them. A pixel's colour is a point on the wheel —
 * hue round it, saturation out from the middle. Each blob pulls the points
 * within its reach toward itself, more the closer they are, and only on the
 * tones it is set to. The pixel keeps its own brightness.
 *
 * The Magnets lab uses local blobs (a small reach: only colours near it
 * move); the Ladder uses blobs that reach every colour and pick their tone
 * instead, which makes a free-form gradient map with gaps where the photo's
 * own colour shows through.
 */
export interface ColourBlob {
  /** Where it sits on the wheel: x = sat · sin(hue), y = sat · cos(hue). */
  x: number
  y: number
  /** How far round it colours are pulled, in wheel radii; 2 or more reaches every colour. */
  reach: number
  /** Which tones it works on: centre 0 (darkest) .. 1 (lightest), and width; width 1 or more is every tone. */
  tone: number
  toneWidth: number
  /** How hard it pulls, 0..1. */
  strength: number
  /** Which lab made it, so each shows only its own. */
  kind: 'magnet' | 'ladder'
}

export const MAX_BLOBS = 6

/** A colour's point on the wheel. */
export function wheelXY(c: Rgb): [number, number] {
  const [h, s] = rgbToHsv(c)
  return [s * Math.sin(h * Math.PI * 2), s * Math.cos(h * Math.PI * 2)]
}

/** The full-strength colour at a wheel point. */
export function colourAt(x: number, y: number): Rgb {
  const hue = ((Math.atan2(x, y) / (Math.PI * 2)) % 1 + 1) % 1
  return hsvToRgb([hue, Math.min(1, Math.hypot(x, y)), 1])
}

const W: Rgb = [0.2126, 0.7152, 0.0722]

/**
 * Where a colour moves to under the blobs: its point on the wheel, pulled.
 * `t` is its tone, 0..1 across the photo's range. The shader does the same.
 */
export function pullPoint(x: number, y: number, t: number, blobs: ColourBlob[]): [number, number] {
  let px = 0
  let py = 0
  let total = 0
  for (const b of blobs) {
    const d = Math.hypot(x - b.x, y - b.y)
    const reach = b.reach >= 2 ? 1 : Math.exp(-(d * d) / (b.reach * b.reach))
    const tone = b.toneWidth >= 1 ? 1 : Math.exp(-((t - b.tone) ** 2) / (b.toneWidth * b.toneWidth))
    const w = reach * tone * b.strength
    px += w * (b.x - x)
    py += w * (b.y - y)
    total += w
  }
  const k = 1 / Math.max(1, total)
  return [x + px * k, y + py * k]
}

/** A pixel's colour under the blobs, keeping its brightness (as the shader). */
export function pullColour(c: Rgb, t: number, blobs: ColourBlob[]): Rgb {
  const [x, y] = pullPoint(...wheelXY(c), t, blobs)
  const l = c[0] * W[0] + c[1] * W[1] + c[2] * W[2]
  const raw = colourAt(x, y)
  const scale = (l + 1e-3) / (raw[0] * W[0] + raw[1] * W[1] + raw[2] * W[2] + 1e-3)
  let out = raw.map((v) => v * scale) as Rgb
  const top = Math.max(...out)
  if (top > 1) out = out.map((v) => l + ((v - l) * (1 - l)) / Math.max(top - l, 1e-4)) as Rgb
  return out.map((v) => Math.min(1, Math.max(0, v))) as Rgb
}
