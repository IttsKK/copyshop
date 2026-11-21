import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS, DEFAULT_EFFECTS, type BlendParams } from './types'
import { originalOf } from './original'

describe('originalOf', () => {
  const edited: BlendParams = {
    ...DEFAULT_BLEND_PARAMS,
    amount: 0.8,
    effects: {
      ...DEFAULT_EFFECTS,
      exposure: 0.5,
      halation: 0.6,
      base: { ...DEFAULT_EFFECTS.base, lightOn: true, colourOn: true, curveOn: true },
      lens: { ...DEFAULT_EFFECTS.lens, enabled: true },
      stamp: { ...DEFAULT_EFFECTS.stamp, enabled: true },
      repeat: { enabled: true } as BlendParams['effects']['repeat'],
      lighting: { enabled: true } as BlendParams['effects']['lighting'],
      shapeSpace: 'print',
    },
  }

  it('turns every module off but the border', () => {
    const o = originalOf(edited)
    for (const [k, on] of Object.entries(o.modules)) expect(on, k).toBe(k === 'border' ? edited.modules.border : false)
  })

  it('puts every effect back to its default, keeping the crop and where shapes are measured', () => {
    const o = originalOf(edited)
    const { crop, shapeSpace, shapeUnits, ...rest } = o.effects
    const { crop: c0, shapeSpace: s0, shapeUnits: u0, ...defaults } = DEFAULT_EFFECTS
    void c0
    void s0
    void u0
    expect(rest).toEqual(defaults)
    expect(crop).toBe(edited.effects.crop)
    expect(shapeSpace).toBe('print')
    expect(shapeUnits).toBe(edited.effects.shapeUnits)
    expect(o.effects.repeat?.enabled ?? false).toBe(false)
    expect(o.effects.lighting?.enabled ?? false).toBe(false)
  })

  it('keeps the border as it is', () => {
    expect(originalOf(edited).border).toBe(edited.border)
  })
})
