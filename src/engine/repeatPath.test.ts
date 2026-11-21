import { describe, expect, it } from 'vitest'
import { DEFAULT_REPEAT, type RepeatParams } from './repeatParams'
import { pieceIndexOnPath, repeatCopies } from './repeat'

const piece = { width: 20, height: 20 }
const centre = { x: 0, y: 0 }
const toPx = (p: { x: number; y: number }) => p
const xs = (r: Partial<RepeatParams>) =>
  repeatCopies({ ...DEFAULT_REPEAT, layout: 'path', straight: true, spacing: [1, 1], ...r }, centre, piece, toPx)
    .map((c) => Math.round(c.x))
    .sort((a, b) => a - b)

describe('Repeat along a path', () => {
  it('at the start: the copies run on from the piece to the end', () => {
    expect(xs({ pieceOnPath: 'start', path: [{ x: 100, y: 0 }], count: 4 })).toEqual([25, 50, 75, 100])
  })
  it('in the middle: the copies go both ways from the piece, shared by length', () => {
    expect(xs({ pieceOnPath: 'middle', path: [{ x: -100, y: 0 }, { x: 100, y: 0 }], count: 4 })).toEqual([-100, -50, 50, 100])
    expect(xs({ pieceOnPath: 'middle', path: [{ x: -50, y: 0 }, { x: 150, y: 0 }], count: 4 })).toEqual([-50, 50, 100, 150])
  })
  it('in the middle, each side goes first to last outward', () => {
    const copies = repeatCopies({ ...DEFAULT_REPEAT, layout: 'path', straight: true, pieceOnPath: 'middle', path: [{ x: -100, y: 0 }, { x: 100, y: 0 }], count: 4, size: [1, 0.5] }, centre, piece, toPx)
    const at = (x: number) => copies.find((c) => Math.round(c.x) === x)!.scale
    expect(at(-50)).toBeCloseTo(1)
    expect(at(-100)).toBeCloseTo(0.5)
    expect(at(50)).toBeCloseTo(1)
    expect(at(100)).toBeCloseTo(0.5)
  })
  it('not on it: the first copy at the path’s first point', () => {
    expect(xs({ pieceOnPath: 'off', path: [{ x: -100, y: 0 }, { x: 100, y: 0 }], count: 3 })).toEqual([-100, 0, 100])
  })
  it('the piece goes where the path is least made longer', () => {
    expect(pieceIndexOnPath([{ x: -100, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 5 })).toBe(1)
    expect(pieceIndexOnPath([{ x: 50, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 0 })).toBe(0)
    expect(pieceIndexOnPath([{ x: -100, y: 0 }, { x: -50, y: 0 }], { x: 0, y: 0 })).toBe(2)
  })
})

describe('an edit from before the piece could be in the middle', () => {
  it('keeps where its path started', async () => {
    const { parsePreset } = await import('../storage/presets')
    const { NONE_LOOK } = await import('../ui/looks')
    const doc = JSON.parse(JSON.stringify(NONE_LOOK.doc))
    const of = (item: Record<string, unknown>) => {
      doc.blend.effects.repeat = { enabled: true, items: [{ ...DEFAULT_REPEAT, pieceOnPath: undefined, ...item }] }
      return parsePreset(doc).blend.effects.repeat?.items[0]?.pieceOnPath
    }
    expect(of({ fromPiece: false })).toBe('off')
    expect(of({ fromPiece: true })).toBe('start')
    expect(of({ pieceOnPath: 'middle' })).toBe('middle')
  })
})
