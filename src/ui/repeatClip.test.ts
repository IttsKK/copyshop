import { describe, expect, it } from 'vitest'
import { DEFAULT_REPEAT, type RepeatParams } from '../engine/repeatParams'
import { pasteRepeatSettingsOnto, repeatSettingsOf } from './repeatClip'

const base = (patch: Partial<RepeatParams>): RepeatParams => ({ ...DEFAULT_REPEAT, enabled: true, ...patch })

describe('copying a repeat’s settings', () => {
  it('takes its layout and look and leaves its piece and points', () => {
    const from = base({ id: 'a', source: 'pa', across: 5, size: [1, 0.4], turn: [0, 90], blend: 'screen', both: true, vanish: { x: 0.5, y: 0.1 } })
    const onto = base({ id: 'b', source: 'pb', across: 2, enabled: false, path: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.9 }] })
    const got = pasteRepeatSettingsOnto(onto, repeatSettingsOf(from))
    expect(got.across).toBe(5)
    expect(got.size).toEqual([1, 0.4])
    expect(got.turn).toEqual([0, 90])
    expect(got.blend).toBe('screen')
    expect(got.both).toBe(true)
    expect(got.id).toBe('b')
    expect(got.source).toBe('pb')
    expect(got.enabled).toBe(false)
    expect(got.path).toEqual(onto.path)
    expect(got.vanish).toBeUndefined()
  })
  it('keeps its own layout when it has no points for the other’s', () => {
    const from = base({ layout: 'path', path: [{ x: 0, y: 0 }, { x: 1, y: 1 }], count: 9 })
    const onto = base({ layout: 'grid', path: [] })
    const got = pasteRepeatSettingsOnto(onto, repeatSettingsOf(from))
    expect(got.layout).toBe('grid')
    expect(got.count).toBe(9)
    expect(got.path).toEqual([])
  })
  it('drops what the other did not have set', () => {
    const from = base({})
    const onto = base({ both: true, mirror: true, angle: 20 })
    const got = pasteRepeatSettingsOnto(onto, repeatSettingsOf(from))
    expect(got.both).toBeUndefined()
    expect(got.mirror).toBeUndefined()
    expect(got.angle).toBeUndefined()
  })
})
