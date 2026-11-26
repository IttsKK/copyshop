import type { Rgb } from './types'

/**
 * Colours picked from the photo, each told what to do: kept as they are in
 * the photo (whatever the palette, film stock or black and white does to the
 * rest), changed to another colour, or taken to grey. Each pick reaches the
 * photo's colours like it, as near as its Range; it reads the photo's colours
 * before Colour, so what it matches doesn't move as the palette changes.
 * Applied in the look's shader after Colour and Black & white (applyPicks).
 */
export type PickAction = 'keep' | 'change' | 'grey'

export interface ColourPick {
  id: string
  /** The colour picked, from the photo. */
  colour: Rgb
  action: PickAction
  /** What it becomes (action 'change'). */
  to: Rgb
  /** 0..1: only this colour, to everything near it. */
  range: number
  /** 0..1 */
  amount: number
}

export const MAX_PICKS = 4

export const PICK_ACTIONS: { id: PickAction; label: string; hint: string }[] = [
  { id: 'keep', label: 'Keep', hint: 'Stays as it is in the photo, whatever the palette or black and white does' },
  { id: 'change', label: 'Change', hint: 'Becomes another colour, its light and shade kept' },
  { id: 'grey', label: 'Grey', hint: 'Loses its colour' },
]

export const ACTION_INDEX: Record<PickAction, number> = { keep: 0, change: 1, grey: 2 }

export function newPick(colour: Rgb, n: number): ColourPick {
  return { id: `pick-${Date.now().toString(36)}-${n}`, colour, action: 'keep', to: [0.95, 0.35, 0.3], range: 0.45, amount: 1 }
}

export const livePicks = (picks: ColourPick[] | undefined): ColourPick[] => (picks ?? []).filter((p) => p.amount > 0).slice(0, MAX_PICKS)

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const unit = (x: unknown, d: number) => (finite(x) ? Math.min(1, Math.max(0, x)) : d)
const rgb = (x: unknown, d: Rgb): Rgb => (Array.isArray(x) && x.length === 3 && x.every(finite) ? (x.map((v) => Math.min(1, Math.max(0, v))) as Rgb) : d)

export function parsePicks(value: unknown): ColourPick[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.slice(0, MAX_PICKS).map((v, i) => {
    const p = (v ?? {}) as Record<string, unknown>
    const d = newPick([0.5, 0.5, 0.5], i)
    return {
      id: typeof p.id === 'string' && p.id ? p.id.slice(0, 60) : `pick-${i + 1}`,
      colour: rgb(p.colour, d.colour),
      action: p.action === 'change' || p.action === 'grey' ? p.action : 'keep',
      to: rgb(p.to, d.to),
      range: unit(p.range, d.range),
      amount: unit(p.amount, d.amount),
    }
  })
}

/** Hue (0..1), saturation and value, as the shader's rgb2hsv has them. */
export function hsvOf([r, g, b]: Rgb): [number, number, number] {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h /= 6
    if (h < 0) h += 1
  }
  return [h, max > 0 ? d / max : 0, max]
}
