import type { ColourChoice, LeakSpot, Rgb } from './types'

/**
 * Leak styles: recipes rather than fixed placements. Real leaks are never the
 * same twice, so a style decides the *kind* of leak — a glow in a corner, a
 * streak down one edge, the burnt end of a roll — and a seed decides this
 * particular one. Randomise re-rolls the seed; the vibe stays.
 *
 * Generators are prefix-stable: spot i depends only on the seed and i, so
 * raising the count adds spots without moving the ones already there, and a
 * spot the user dragged stays where they put it.
 */
export interface LeakStyle {
  id: string
  label: string
  hint: string
  colour: ColourChoice
  count: number
  /** Leak amount to switch on at, if leaks were off. */
  amount: number
  generate: (seed: number, count: number) => LeakSpot[]
}

function rng(seed: number, salt = 0): () => number {
  let a = (Math.imul(seed | 0, 2654435761) ^ Math.imul(salt + 1, 40503)) >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const range = (r: () => number, lo: number, hi: number) => lo + (hi - lo) * r()
const manual = (colour: Rgb): ColourChoice => ({ source: 'manual', colour })

type Side = 0 | 1 | 2 | 3 // left, right, top, bottom

/** A point on a side, `out` beyond the edge, and the angle running along it. */
function onSide(side: Side, t: number, out: number): { x: number; y: number; angle: number } {
  if (side === 0) return { x: -out, y: t, angle: 90 }
  if (side === 1) return { x: 1 + out, y: t, angle: 90 }
  if (side === 2) return { x: t, y: -out, angle: 0 }
  return { x: t, y: 1 + out, angle: 0 }
}

function spotsBy(
  count: number,
  seed: number,
  make: (i: number, r: () => number, style: () => number) => LeakSpot,
): LeakSpot[] {
  const out: LeakSpot[] = []
  for (let i = 0; i < count; i++) out.push(make(i, rng(seed, i + 1), rng(seed, 0)))
  return out
}

const WARM: Rgb = [1, 0.6, 0.3]
const EMBER: Rgb = [1, 0.4, 0.16]
const GOLD: Rgb = [1, 0.76, 0.36]
const RED: Rgb = [1, 0.28, 0.16]
const ROSE: Rgb = [1, 0.4, 0.62]
const SKY: Rgb = [0.55, 0.8, 1]

export const LEAK_STYLES: LeakStyle[] = [
  {
    id: 'corner',
    label: 'Corner glow',
    hint: 'A soft glow in one corner, fading along both edges',
    colour: manual(WARM),
    count: 2,
    amount: 0.5,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r, style) => {
        const s = style()
        const right = s < 0.5
        const top = style() < 0.7
        // The first spot sits on the corner; later ones walk out along its
        // two edges, alternating, each a little smaller.
        const along = i === 0 ? 0 : 0.12 + 0.18 * Math.ceil(i / 2) + range(r, 0, 0.08)
        const onVertical = i % 2 === 1
        const x = right ? (onVertical ? 1.03 : 1 - along) : onVertical ? -0.03 : along
        const y = top ? (onVertical ? along : -0.03) : onVertical ? 1 - along : 1.03
        return {
          x: i === 0 ? (right ? 1.02 : -0.02) : x,
          y: i === 0 ? (top ? -0.02 : 1.02) : y,
          size: i === 0 ? range(r, 0.45, 0.6) : range(r, 0.22, 0.34),
          stretch: i === 0 ? range(r, 1.2, 1.6) : range(r, 1.6, 2.2),
          angle: i === 0 ? (right === top ? 135 : 45) : onVertical ? 90 : 0,
          strength: i === 0 ? 1 : range(r, 0.55, 0.85),
          kind: 'light',
        }
      }),
  },
  {
    id: 'edge',
    label: 'Edge streak',
    hint: 'Long thin streaks down one edge',
    colour: manual(EMBER),
    count: 3,
    amount: 0.6,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r, style) => {
        const side = Math.floor(style() * 4) as Side
        // Just inside the edge, so the streak reads as light in the picture
        // rather than as a coloured border round it.
        // Spread along the edge by the golden ratio, so each streak's place
        // depends only on its index and adding one never moves the others.
        const t = 0.12 + ((style() + i * 0.618) % 1) * 0.76
        const p = onSide(side, t + range(r, -0.05, 0.05), -range(r, 0.0, 0.04))
        return {
          ...p,
          size: range(r, 0.15, 0.24),
          stretch: range(r, 2.2, 3.2),
          strength: range(r, 0.9, 1.3),
          kind: 'light',
        }
      }),
  },
  {
    id: 'rollEnd',
    label: 'Roll end',
    hint: 'The first frame of a roll: a burnt edge with hot light just inside it',
    colour: manual(GOLD),
    count: 3,
    amount: 0.6,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r, style) => {
        const side = (style() < 0.5 ? 0 : 1) as Side
        if (i === 0) {
          return { ...onSide(side, 0.5, 0.1), size: range(r, 0.4, 0.5), stretch: 2.6, strength: 1.1, kind: 'burn' }
        }
        const p = onSide(side, range(r, 0.15, 0.85), -range(r, 0.02, 0.12))
        return {
          ...p,
          size: range(r, 0.22, 0.32),
          stretch: range(r, 1.4, 2.4),
          strength: range(r, 0.8, 1.1),
          kind: 'light',
          colour: manual(i % 2 === 1 ? GOLD : RED),
        }
      }),
  },
  {
    id: 'flare',
    label: 'Flare',
    hint: 'Round glows inside the frame, in the colour of the photo’s light',
    colour: { source: 'light', colour: WARM },
    count: 1,
    amount: 0.4,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r) => ({
        x: range(r, 0.15, 0.85),
        y: i === 0 ? range(r, 0.05, 0.3) : range(r, 0.05, 0.6),
        size: i === 0 ? range(r, 0.22, 0.32) : range(r, 0.08, 0.16),
        stretch: range(r, 0.9, 1.2),
        angle: range(r, 0, 180),
        strength: i === 0 ? 0.9 : range(r, 0.5, 0.8),
        kind: 'light',
      })),
  },
  {
    id: 'scatter',
    label: 'Scattered',
    hint: 'Small leaks all round the frame, warm and red',
    colour: manual(WARM),
    count: 5,
    amount: 0.5,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r) => {
        const side = Math.floor(r() * 4) as Side
        return {
          ...onSide(side, range(r, 0.08, 0.92), range(r, 0, 0.04)),
          size: range(r, 0.12, 0.24),
          stretch: range(r, 1.2, 2.2),
          strength: range(r, 0.6, 1.1),
          kind: 'light',
          colour: manual(i % 3 === 2 ? RED : WARM),
        }
      }),
  },
  {
    id: 'prism',
    label: 'Prism',
    hint: 'Coloured bands falling from the top edge: rose, gold and sky',
    colour: manual(ROSE),
    count: 3,
    amount: 0.45,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r, style) => {
        const start = range(style, 0.05, 0.35)
        return {
          x: start + i * range(r, 0.16, 0.24),
          y: -0.04,
          size: range(r, 0.1, 0.16),
          stretch: range(r, 3.2, 4.5),
          angle: 90 + range(r, -8, 8),
          strength: range(r, 0.7, 1),
          kind: 'light',
          colour: manual([ROSE, GOLD, SKY][i % 3]),
        }
      }),
  },
  {
    id: 'painted',
    label: 'Painted',
    hint: 'Irregular painted shapes spilling in from an edge — drag their points to reshape',
    colour: manual(WARM),
    count: 2,
    amount: 0.55,
    generate: (seed, count) =>
      spotsBy(count, seed, (i, r, style) => {
        const side = Math.floor(style() * 4) as Side
        // Centred on the edge so half the blob is off the frame and it reads
        // as light coming in, not a sticker.
        const c = onSide(side, range(r, 0.15, 0.85), 0)
        const radius = range(r, 0.12, 0.22)
        const n = 6 + Math.floor(r() * 3)
        const outline = Array.from({ length: n }, (_, k) => {
          const a = (k / n) * Math.PI * 2 + range(r, -0.25, 0.25)
          const rr = radius * range(r, 0.6, 1.35)
          return { x: c.x + Math.cos(a) * rr * 1.3, y: c.y + Math.sin(a) * rr }
        })
        return {
          x: c.x,
          y: c.y,
          size: range(r, 0.04, 0.09),
          stretch: 1,
          angle: 0,
          strength: range(r, 0.8, 1.1),
          kind: 'light',
          outline,
          seed: Math.floor(r() * 99991),
          colour: manual(i % 2 === 1 ? EMBER : WARM),
        }
      }),
  },
]

export const LEAK_STYLE_BY_ID: Record<string, LeakStyle> = Object.fromEntries(LEAK_STYLES.map((s) => [s.id, s]))

export function leakStyle(id: string): LeakStyle {
  return LEAK_STYLE_BY_ID[id] ?? LEAK_STYLES[0]
}
