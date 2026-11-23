import { describe, expect, it } from 'vitest'
import { DEFAULT_KALEIDO, kaleidoActive } from './kaleido'
import { DEFAULT_BLEND_PARAMS, DEFAULT_EFFECTS, DEFAULT_MASK, type BlendParams } from './types'
import { ownMasks, parseKaleido } from '../storage/presets'
import { shapesOnCrop } from '../pipeline/instagram'

describe('Kaleidoscope', () => {
  it('copies a slice with no part of its own, and needs its part while it has one', () => {
    expect(kaleidoActive(undefined, [])).toBe(false)
    expect(kaleidoActive({ ...DEFAULT_KALEIDO, enabled: true }, [])).toBe(true)
    expect(kaleidoActive({ ...DEFAULT_KALEIDO, enabled: true, source: 'gone' }, [])).toBe(false)
    expect(kaleidoActive({ ...DEFAULT_KALEIDO, enabled: true, source: 'part' }, ['part'])).toBe(true)
  })

  it('reads its settings back, kept within what the controls reach', () => {
    const k = { ...DEFAULT_KALEIDO, enabled: true, copies: 8, mirror: false, angle: 45, rings: 3, ringSize: 0.5, twist: -20, centre: { x: 0.3, y: 0.7 }, source: 'part' }
    expect(parseKaleido(JSON.parse(JSON.stringify(k)))).toEqual(k)
    const wild = parseKaleido({ enabled: true, copies: 99, rings: -4, ringSize: 5, centre: 'middle' })
    expect(wild.copies).toBe(16)
    expect(wild.rings).toBe(1)
    expect(wild.ringSize).toBe(0.95)
    expect(wild.centre).toBeNull()
    expect(wild.mirror).toBe(true)
  })

  it('owns a mask used only as its part', () => {
    const fx = { ...DEFAULT_EFFECTS, masks: [{ ...DEFAULT_MASK, id: 'part', name: 'part', outline: [] }], kaleido: { ...DEFAULT_KALEIDO, enabled: true, source: 'part' } }
    expect(ownMasks(fx).masks[0].owner).toBe('kaleido')
  })

  it('moves its centre onto a crop; the middle stays the middle of what is shown', () => {
    const photo = { width: 1000, height: 1000 }
    const crop = { x: 500, y: 0, width: 500, height: 1000 }
    const at = (centre: { x: number; y: number } | null): BlendParams => ({ ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, shapeSpace: 'photo', kaleido: { ...DEFAULT_KALEIDO, enabled: true, centre } } })
    const moved = shapesOnCrop(at({ x: 0.75, y: 0.5 }), photo, crop).effects.kaleido!.centre!
    expect(moved.x).toBeCloseTo(0.5)
    expect(moved.y).toBeCloseTo(0.5)
    expect(shapesOnCrop(at(null), photo, crop).effects.kaleido!.centre).toBeNull()
  })
})
