import type { PaletteId, Rgb } from './types'

const hex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb

/** Fixed retro palettes. */
export const FIXED_PALETTES: Record<
  Exclude<PaletteId, 'off' | 'photo'>,
  { label: string; hint: string; colours: Rgb[] }
> = {
  gameboy: {
    label: 'Game Boy',
    hint: 'Four greens, the original handheld',
    colours: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'].map(hex),
  },
  pico8: {
    label: 'PICO-8',
    hint: 'The fantasy console’s sixteen',
    colours: [
      '#000000',
      '#1d2b53',
      '#7e2553',
      '#008751',
      '#ab5236',
      '#5f574f',
      '#c2c3c7',
      '#fff1e8',
      '#ff004d',
      '#ffa300',
      '#ffec27',
      '#00e436',
      '#29adff',
      '#83769c',
      '#ff77a8',
      '#ffccaa',
    ].map(hex),
  },
  cga: {
    label: 'CGA',
    hint: 'Black, cyan, magenta, white',
    colours: ['#000000', '#55ffff', '#ff55ff', '#ffffff'].map(hex),
  },
  onebit: { label: '1-bit', hint: 'Ink and paper', colours: ['#141414', '#ece6d8'].map(hex) },
  dusk: {
    label: 'Dusk',
    hint: 'Navy, plum, ember, gold — for sunsets',
    colours: ['#0b1026', '#2b2d5c', '#6b3a6e', '#d0573a', '#f29e4c', '#fde3a7'].map(hex),
  },
}

/**
 * The photo's own palette, k colours by k-means on a small downsample of its
 * pixels, seeded by spreading picks across brightness so dark and light ends
 * are both represented. Deterministic for the same image and k.
 */
export function photoPalette(data: Uint8ClampedArray, k: number): Rgb[] {
  const px: Rgb[] = []
  for (let i = 0; i < data.length; i += 4) px.push([data[i] / 255, data[i + 1] / 255, data[i + 2] / 255])
  if (px.length === 0)
    return [
      [0, 0, 0],
      [1, 1, 1],
    ]
  const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const sorted = [...px].sort((a, b) => luma(a) - luma(b))
  let centres: Rgb[] = Array.from(
    { length: k },
    (_, i) => [...sorted[Math.floor(((i + 0.5) / k) * sorted.length)]] as Rgb,
  )
  const dist = (a: Rgb, b: Rgb) => 0.3 * (a[0] - b[0]) ** 2 + 0.59 * (a[1] - b[1]) ** 2 + 0.11 * (a[2] - b[2]) ** 2
  for (let iter = 0; iter < 12; iter++) {
    const sum = centres.map(() => [0, 0, 0, 0])
    for (const p of px) {
      let best = 0
      let bd = Infinity
      centres.forEach((c, j) => {
        const d = dist(p, c)
        if (d < bd) {
          bd = d
          best = j
        }
      })
      const s = sum[best]
      s[0] += p[0]
      s[1] += p[1]
      s[2] += p[2]
      s[3]++
    }
    centres = centres.map((c, j) =>
      sum[j][3] ? ([sum[j][0] / sum[j][3], sum[j][1] / sum[j][3], sum[j][2] / sum[j][3]] as Rgb) : c,
    )
  }
  return centres.sort((a, b) => luma(a) - luma(b))
}

/** Typical gap between neighbouring palette colours: how far a dither offset should reach. */
export function paletteSpacing(colours: Rgb[]): number {
  if (colours.length < 2) return 0.5
  let total = 0
  for (const a of colours) {
    let near = Infinity
    for (const b of colours) {
      if (a === b) continue
      near = Math.min(near, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]))
    }
    total += near
  }
  return total / colours.length
}
