import { describe, expect, it } from 'vitest'
import { glowFill, glowFitGain } from './glowFit'
import { NEUTRAL_PALETTE, paletteFromPixels } from './palette'

/** A photo of n pixels, `bright` of them white and the rest dark grey. */
function photo(n: number, bright: number) {
  const px = new Uint8ClampedArray(n * 4)
  for (let i = 0; i < n; i++) px.set(i < bright ? [250, 250, 250, 255] : [40, 40, 40, 255], i * 4)
  return paletteFromPixels(px)
}

describe('glowFitGain', () => {
  it('keeps the whole glow on a few lights in the dark', () => {
    expect(glowFitGain(photo(1000, 30), 0.28)).toBe(1)
  })

  it('turns it down on a photo that is mostly highlight, never below the floor', () => {
    const g = glowFitGain(photo(1000, 800), 0.28)
    expect(g).toBeLessThan(0.5)
    expect(g).toBeGreaterThanOrEqual(0.3)
  })

  it('turns it down further the more of the photo glows', () => {
    expect(glowFitGain(photo(1000, 700), 0.28)).toBeLessThan(glowFitGain(photo(1000, 300), 0.28))
  })

  it('leaves a palette without brightness (no pixels) alone', () => {
    expect(glowFitGain(NEUTRAL_PALETTE, 0.28)).toBe(1)
  })

  it('measures nothing below the threshold', () => {
    expect(glowFill([0.01, 0.05, 0.1], 0.28)).toBe(0)
  })
})
