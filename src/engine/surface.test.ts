import { describe, expect, it } from 'vitest'
import { parsePreset } from '../storage/presets'
import { DEFAULT_BLEND_PARAMS } from './types'
import { DEFAULT_SURFACE, SURFACE_KINDS, surfaceKindIndex, surfaceOn } from './surface'

const doc = (effects: Record<string, unknown>) => ({ schemaVersion: 7, name: 't', grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_BLEND_PARAMS.effects, ...effects } } })

describe('Surface', () => {
  it('is off in an edit made before it, and stays out of it', () => {
    expect(parsePreset(doc({})).blend.effects.surface).toBeUndefined()
  })

  it('reads back what it was saved with, kept in range', () => {
    const s = parsePreset(doc({ surface: { ...DEFAULT_SURFACE, enabled: true, kind: 'mesh', amount: 2, scale: 9, light: 400, image: 'surface-x', imageName: 'wall' } })).blend.effects.surface!
    expect(s.kind).toBe('mesh')
    expect(s.amount).toBe(1)
    expect(s.scale).toBe(4)
    expect(s.light).toBe(360)
    expect(s.image).toBe('surface-x')
  })

  it('an unknown kind is paper', () => {
    expect(parsePreset(doc({ surface: { enabled: true, kind: 'velvet' } })).blend.effects.surface!.kind).toBe('paper')
  })

  it('shows only when on, with some strength, and with its image when it is one', () => {
    expect(surfaceOn({ ...DEFAULT_SURFACE, enabled: true })).toBe(true)
    expect(surfaceOn({ ...DEFAULT_SURFACE, enabled: true, amount: 0 })).toBe(false)
    expect(surfaceOn({ ...DEFAULT_SURFACE, enabled: true, kind: 'image' })).toBe(false)
    expect(surfaceOn({ ...DEFAULT_SURFACE, enabled: true, kind: 'image', image: 'surface-x' })).toBe(true)
    expect(surfaceOn(undefined)).toBe(false)
  })

  it("numbers its kinds in the shader's order", () => {
    SURFACE_KINDS.forEach((k, i) => expect(surfaceKindIndex(k.id)).toBe(i))
    expect(SURFACE_KINDS.at(-1)!.id).toBe('image')
  })
})
