import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS, DEFAULT_BORDER } from '../engine/types'
import { DEFAULT_OUTPUT, PRESET_SCHEMA_VERSION, parsePreset, presetToJson } from '../storage/presets'
import { BORDER_STYLES, borderStyleOf } from './borderStyles'

describe('border styles', () => {
  it('knows each style once applied, and an older border as none of them', () => {
    for (const s of BORDER_STYLES) expect(borderStyleOf({ ...DEFAULT_BORDER, ...s.patch })).toBe(s.id)
    expect(borderStyleOf({ ...DEFAULT_BORDER, texture: 0.123 })).toBeNull()
  })

  it('keeps a style through saving and reading back', () => {
    for (const s of BORDER_STYLES) {
      const doc = {
        schemaVersion: PRESET_SCHEMA_VERSION,
        name: s.name,
        grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
        blend: { ...DEFAULT_BLEND_PARAMS, border: { ...DEFAULT_BORDER, ...s.patch } },
        output: DEFAULT_OUTPUT,
      }
      const back = parsePreset(JSON.parse(presetToJson(doc as never)))
      expect(borderStyleOf(back.blend.border)).toBe(s.id)
    }
  })
})
