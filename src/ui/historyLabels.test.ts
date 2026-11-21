import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS, type BlendParams, type EffectParams } from '../engine/types'
import type { OutputSettings } from '../storage/presets'
import type { EditState } from './history'
import { changeTitle, listTitle, wholeTitle } from './historyLabels'
import { STREAK_STYLES, finishPatch } from './streakStyles'

const OUTPUT = {} as OutputSettings
const state = (blend: BlendParams): EditState => ({ blend, source: null, output: OUTPUT, look: null, presetId: '' })
const B = DEFAULT_BLEND_PARAMS
const fx = (patch: Partial<EffectParams>): BlendParams => ({ ...B, effects: { ...B.effects, ...patch } })
const title = (after: BlendParams, before: BlendParams = B) => changeTitle(state(before), state(after))

describe('wholeTitle', () => {
  it.each([
    ['the Stipple Tide recipe', 'Recipe: Stipple Tide'],
    ['the recipe “Mine”', 'Recipe: Mine'],
    ['the grain preset “Fine”', 'Grain preset: Fine'],
    ['the Dusk palette', 'Palette: Dusk'],
    ['the palette’s richness', 'Palette richness'],
    ['adding grain', 'Grain added'],
    ['removing streak 2', 'Streak 2 removed'],
    ['removing Subject 1', 'Subject 1 removed'],
    ['switching lens off', 'Lens off'],
    ['switching on Mask 2', 'Mask 2 on'],
    ['resetting tone', 'Tone reset'],
    ['a painted mask', 'Painted mask added'],
    ['a radial mask', 'Radial mask added'],
    ['a light', 'Light added'],
    ['matching the streak to the photo\'s lines', 'Streak matched to the photo\'s lines'],
    ['automatic white balance', 'Auto white balance'],
    ['clearing everything', 'Everything cleared'],
    ['cropping for Instagram', 'Cropped for Instagram'],
    ['Snapshot 3', 'Snapshot 3'],
  ])('%s → %s', (phrase, want) => expect(wholeTitle(phrase)).toBe(want))
})

describe('changeTitle', () => {
  it('names a module and the setting', () => {
    expect(title({ ...B, amount: B.amount + 0.1 })).toBe('Grain: strength')
    expect(title(fx({ fade: 0.2 }))).toBe('Tone: fade')
    expect(title(fx({ lens: { ...B.effects.lens, distortion: 0.3 } }))).toBe('Lens: distortion')
    expect(title(fx({ grade: { ...B.effects.grade, warmth: 0.2 } }))).toBe('Colour: warmth')
  })

  it('names the base corrections by their control', () => {
    expect(title(fx({ base: { ...B.effects.base, shadows: 0.2 } }))).toBe('Shadows')
    expect(title(fx({ base: { ...B.effects.base, temperature: 0.2 } }))).toBe('Temperature')
    expect(title(fx({ base: { ...B.effects.base, curve: [{ x: 0, y: 0.1 }, { x: 1, y: 1 }] } }))).toBe('Curve')
  })

  it('names a module switched', () => {
    expect(title({ ...B, modules: { ...B.modules, grain: false } })).toBe('Grain off')
    expect(title(fx({ lens: { ...B.effects.lens, enabled: true } }))).toBe('Lens on')
  })

  it('names the control, not the switch, when touching a control switches a module on', () => {
    const off = { ...B, modules: { ...B.modules, tone: false } }
    expect(title({ ...B, effects: { ...B.effects, vignette: 0.3 } }, off)).toBe('Tone: vignette')
  })

  it('names changes to more than one module', () => {
    expect(title({ ...B, amount: 0.9, effects: { ...B.effects, fade: 0.2 } })).toBe('Grain and tone')
  })

  it('names placed things', () => {
    const shape = { outline: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.3 }], angle: 0 } as never
    const one = fx({ streaks: { ...B.effects.streaks, shapes: [shape] } })
    expect(title(one)).toBe('Streak added')
    expect(title(B, one)).toBe('Streak removed')
    const moved = { outline: [{ x: 0.2, y: 0.15 }, { x: 0.3, y: 0.35 }], angle: 0 } as never
    expect(title(fx({ streaks: { ...B.effects.streaks, shapes: [moved] } }), one)).toBe('Streak 1 moved')
    const bent = { outline: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.3 }], angle: 0 } as never
    expect(title(fx({ streaks: { ...B.effects.streaks, shapes: [bent] } }), one)).toBe('Streak 1 reshaped')
  })

  it('names masks by their own name', () => {
    const m = { id: 'a', name: 'Subject 1', outline: [], feather: 0.1 }
    expect(listTitle([], [m], 'Mask')).toBe('Mask added')
    expect(listTitle([m], [{ ...m, feather: 0.3 }], 'Mask')).toBe('Subject 1: feather')
    expect(listTitle([m], [{ ...m, enabled: false }], 'Mask')).toBe('Subject 1 off')
    const n = { ...m, id: 'b', name: 'Subject 2' }
    expect(listTitle([m, n], [n, m], 'Mask')).toBe('Masks reordered')
  })

  it('names the recipe strength dials', () => {
    expect(title({ ...B, keys: { ...B.keys, look: 0.5 } })).toBe('Recipe strength: overall')
  })

  it('is empty when nothing changed', () => {
    expect(title(B)).toBe('')
  })
})

describe('names what changed, not just where', () => {
  const shape = { outline: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.3 }], angle: 0, fixes: [] } as never
  const streak = (p: object = {}) => fx({ streaks: { ...B.effects.streaks, shapes: [{ ...(shape as object), ...p } as never] } })

  it('names a streak style chosen', () => {
    const fade = STREAK_STYLES.find((s) => s.id === 'fade')!
    expect(title(streak(finishPatch(shape, fade.patch)), streak())).toBe('Streak 1: Fade style')
  })

  it('names a setting kept at both ends of a bar as one', () => {
    expect(title(streak({ opacity: 0.5, endOpacity: 0.5 }), streak())).toBe('Streak 1: opacity')
  })

  it('names a mask matched to the photo by its control', () => {
    const m = { id: 'm1', name: 'Sky', outline: [], key: 'off' } as never
    const masks = (x: object) => fx({ masks: [{ ...(m as object), ...x } as never] })
    expect(title(masks({ key: 'darker', keyAt: 'edge', keyBand: 0.02 }), masks({}))).toBe('Sky: edge follows the photo')
    expect(title(masks({ key: 'off', keyWas: 'darker' }), masks({ key: 'darker', keyAt: 'edge' }))).toBe('Sky: edge as selected')
    expect(title(masks({ keyBand: 0.03 }), masks({}))).toBe('Sky: edge width')
  })

  it('names several settings of a module', () => {
    expect(title(fx({ lens: { ...B.effects.lens, distortion: 0.3, vignette: 0.2 } as never }))).toBe('Lens: distortion and vignette')
    expect(title(fx({ base: { ...B.effects.base, shadows: 0.2, highlights: -0.2 } }))).toBe('Highlights and shadows')
  })

  it("names a repeat's and a collage piece's settings by their panels", () => {
    const r = { id: 'r1', layout: 'grid', count: 5, across: 0, up: 3, angle: 0, size: [1, 1] } as never
    expect(listTitle([r], [{ ...(r as object), layout: 'path', count: 3 }], 'Repeat')).toBe('Repeat 1: layout and copies')
    expect(listTitle([r], [{ ...(r as object), angle: 20 }], 'Repeat')).toBe('Repeat 1: angle')
    expect(listTitle([r], [{ ...(r as object), size: [1, 0.5] }], 'Repeat')).toBe('Repeat 1: size')
    const p = { id: 'p1', tolerance: 0.3, seal: 0.2, takeLook: 0 } as never
    expect(listTitle([p], [{ ...(p as object), tolerance: 0.5 }], 'Piece')).toBe('Piece 1: reach')
    expect(listTitle([p], [{ ...(p as object), takeLook: 1, seal: 0.5 }], 'Piece')).toBe('Piece 1: stop at thin lines and match the look')
  })
})
