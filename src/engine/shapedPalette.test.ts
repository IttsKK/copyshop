import { describe, expect, it } from 'vitest'
import { shapedColours } from './shapedPalette'
import { ruleColours } from './recipe'
import { NEUTRAL_PALETTE } from './palette'

const luma = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

describe('shapedColours', () => {
  it("is built as Tide is: near-black shadow, middle at 0.31, a coloured highlight", () => {
    for (const [m, h] of [[218, 38], [205, 8], [165, 330], [268, 40], [135, 18]]) {
      const [s, mid, high] = shapedColours(m, h)
      expect(luma(s)).toBeCloseTo(0.05, 2)
      expect(luma(mid)).toBeCloseTo(0.31, 2)
      expect(luma(high)).toBeGreaterThan(0.45)
      expect(luma(high)).toBeLessThan(0.8)
      expect(Math.max(...high)).toBeCloseTo(1, 3)
    }
  })

  it('a photo rule in that build puts the light on top and its opposite in the middle', () => {
    const warm = { ...NEUTRAL_PALETTE, light: [1, 0.55, 0.2] as [number, number, number] }
    const [, mid, high] = ruleColours({ from: 'light', harmony: 'complementary', lead: 2, turn: 0, richness: 1, shape: 'tide' }, warm)
    expect(high[0]).toBeGreaterThan(high[2])
    expect(mid[2]).toBeGreaterThan(mid[0])
  })
})

describe('Its light', () => {
  const rule = { from: 'light' as const, harmony: 'complementary' as const, lead: 2 as const, turn: 0, richness: 1, shape: 'tide' as const }
  it('keeps the highlight warm and the shade cool, even under blue light', () => {
    for (const light of [[0.4, 0.6, 1], [1, 0.55, 0.2], [1, 0.4, 0.8], [0.5, 1, 0.5]] as [number, number, number][]) {
      const [, mid, high] = ruleColours(rule, { ...NEUTRAL_PALETTE, light })
      expect(high[0]).toBeGreaterThan(high[2])
      expect(mid[2]).toBeGreaterThanOrEqual(mid[0])
    }
  })
})
