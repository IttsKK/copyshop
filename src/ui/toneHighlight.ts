import { createContext } from 'react'

/**
 * A range of brightness to show on the photo: while a brightness slider is
 * dragged (Glow from, Darkest, Reverses from…) or a band of the tone strip
 * is pointed at, the parts of the photo it touches are tinted, so a
 * threshold is seen on the picture rather than guessed from a number.
 */
export interface ToneRange {
  /** 0..1, in the scale the setting itself uses. */
  lo: number
  hi: number
  /** Width of the soft edge either side, same scale. */
  soft?: number
  /**
   * Glow thresholds are measured in linear light, a mask key set to Blue on
   * the blue channel; everything else on the encoded brightness.
   */
  space?: 'encoded' | 'linear' | 'blue'
  /** What is being shown, for the label on the photo. */
  label?: string
}

export const ToneHighlightContext = createContext<(range: ToneRange | null) => void>(() => {})

/**
 * The brightness of the photo under the pointer, 0..1 encoded, or null: the
 * tone strip marks it, so pointing at the sky shows which of its ranges the
 * sky falls in. A tiny store of its own, so moving over the photo re-renders
 * the strip and nothing else.
 */
let pointed: number | null = null
const pointedListeners = new Set<() => void>()
export const pointedTone = {
  get: () => pointed,
  set(v: number | null) {
    if (v === pointed) return
    pointed = v
    pointedListeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    pointedListeners.add(l)
    return () => pointedListeners.delete(l)
  },
}

/** The photo's brightness (encoded) as bin counts, for the graphs under brightness sliders. */
export const HistogramContext = createContext<number[] | null>(null)
