import type { Rgb } from './types'

/** What a mask's key measures: brightness, how blue, or how like a colour. */
export type KeyOn = 'brightness' | 'blue' | 'colour'

/**
 * What a key measures in a colour (encoded, 0..1 each): its brightness, its
 * blue, or how like `colour` it is, 0..1, its hue and strength of colour
 * counting more than how light it is (a tree in sun and in shade are both
 * like its green). The same sum as the look shader's keyValue.
 */
export function keyValue(r: number, g: number, b: number, on: KeyOn | undefined, colour: Rgb | undefined): number {
  if (on === 'blue') return b
  if (on !== 'colour' || !colour) return 0.2126 * r + 0.7152 * g + 0.0722 * b
  const y = 0.299 * r + 0.587 * g + 0.114 * b
  const [kr, kg, kb] = colour
  const yk = 0.299 * kr + 0.587 * kg + 0.114 * kb
  const dy = (y - yk) * 0.35
  const db = (b - y - kb + yk) * 0.564
  const dr = (r - y - kr + yk) * 0.713
  return Math.min(1, Math.max(0, 1 - Math.hypot(dy, db, dr) * 2.5))
}

/** A key colour as one number for the shader (r·65536 + g·256 + b, 0..255 each). */
export const packKeyColour = (c: Rgb | undefined): number => {
  if (!c) return 0
  const q = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255)
  return q(c[0]) * 65536 + q(c[1]) * 256 + q(c[2])
}

/** A colour to key on before one is picked: foliage green. */
export const DEFAULT_KEY_COLOUR: Rgb = [0.32, 0.45, 0.24]
