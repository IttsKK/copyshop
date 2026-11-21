import { describe, expect, it } from 'vitest'
import { DEFAULT_REPEAT, copySpacing, fitRepeat } from './repeatParams'
import { repeatCopies } from './repeat'

describe('Repeat spacing', () => {
  const piece = { width: 100, height: 200 }
  const centre = { x: 500, y: 800 }
  const toPx = (p: { x: number; y: number }) => p
  it('copies stay the same distance apart whatever their size', () => {
    const r = { ...DEFAULT_REPEAT, across: 0, up: 3, spacing: [1, 1] as [number, number] }
    const a = repeatCopies(r, centre, piece, toPx).map((c) => c.y)
    const b = repeatCopies({ ...r, size: [0.5, 0.3] }, centre, piece, toPx).map((c) => c.y)
    expect(a).toEqual([600, 400, 200])
    expect(b).toEqual(a)
  })
  it('an edit from before Spacing keeps its gaps tied to size', () => {
    const r = { ...DEFAULT_REPEAT, up: 2, spacing: undefined, size: [0.5, 0.5] as [number, number], gapY: 0 }
    expect(repeatCopies(r, centre, piece, toPx).map((c) => c.y)).toEqual([800 - 150, 800 - 250])
  })
  it('fitted, Spacing stays within its slider (5% to 300%)', () => {
    // A tiny piece with the whole photo above it: reaching the edge would need far more than 300%.
    const r = { ...DEFAULT_REPEAT, across: 0, up: 1, spacing: [1, 1] as [number, number] }
    const fit = fitRepeat(r, { x: 0.5, y: 0.95, width: 0.02, height: 0.02 })
    expect(fit.spacing![0]).toBeLessThanOrEqual(3)
    expect(fit.spacing![1]).toBeLessThanOrEqual(3)
  })
  it('fitted, the last copy reaches the edge the way there is room', () => {
    // A piece low on the left: copies go right, the last just inside the edge.
    const box = { x: 0.1, y: 0.6, width: 0.1, height: 0.2 }
    const r = { ...DEFAULT_REPEAT, across: 4, up: 0, spacing: [1, 1] as [number, number], size: [1, 1] as [number, number] }
    const fit = fitRepeat(r, box)
    expect(fit.across).toBe(4)
    const step = fit.spacing![0] * box.width
    expect(box.x + box.width / 2 + 4 * step + box.width / 2).toBeCloseTo(1, 5)
    // Near the right edge instead: they go left.
    expect(fitRepeat(r, { ...box, x: 0.85 }).across).toBe(-4)
    // Within: only brought closer.
    expect(fitRepeat({ ...r, spacing: [0.4, 0.4] }, box, false, true).spacing).toEqual([0.4, 0.4])
    // Any way: a tall piece with no room above goes across.
    const any = fitRepeat({ ...r, across: 0, up: 3 }, { x: 0.4, y: 0.05, width: 0.2, height: 0.9 }, false, false, true)
    expect(any.up).toBe(0)
    expect(Math.abs(any.across!)).toBe(3)
  })
  it('spacing first to last', () => {
    const r = { ...DEFAULT_REPEAT, spacing: [1, 0.5] as [number, number] }
    expect(copySpacing(r, 1, 3)).toBe(1)
    expect(copySpacing(r, 3, 3)).toBe(0.5)
  })
})

describe('Repeat in perspective and both sides', () => {
  const toPx = (p: { x: number; y: number }) => p
  it('toward a point: each copy smaller about it, its far side on the one before’s near side', () => {
    const r = { ...DEFAULT_REPEAT, across: 0, up: 3, spacing: [1, 1] as [number, number], size: [1, 1] as [number, number], vanish: { x: 500, y: -1000 } }
    const centre = { x: 500, y: 800 }
    const piece = { width: 100, height: 200 }
    const c = repeatCopies(r, centre, piece, toPx)
    expect(c.length).toBe(3)
    // Piece top at 700 (1700 from the point), bottom at 900 (1900): factor 1700/1900.
    const k = 1700 / 1900
    expect(c[0].scale).toBeCloseTo(k, 6)
    // The copy's bottom (its middle plus half its height) is the piece's top.
    expect(c[0].y + (piece.height / 2) * c[0].scale).toBeCloseTo(700, 4)
    expect(c[1].scale).toBeCloseTo(k * k, 6)
  })
  it('both sides, the other side mirrored', () => {
    const r = { ...DEFAULT_REPEAT, across: 2, up: 0, both: true, mirror: true, spacing: [1, 1] as [number, number] }
    const c = repeatCopies(r, { x: 500, y: 500 }, { width: 100, height: 100 }, toPx)
    expect(c.map((x) => x.x).sort((a, b) => a - b)).toEqual([300, 400, 600, 700])
    expect(c.filter((x) => x.flipX).map((x) => x.x).sort()).toEqual([300, 400])
  })
  it('turned, the line runs at its angle', () => {
    const r = { ...DEFAULT_REPEAT, across: 1, up: 0, angle: 90, spacing: [1, 1] as [number, number] }
    const [c] = repeatCopies(r, { x: 0, y: 0 }, { width: 100, height: 100 }, toPx)
    expect(c.x).toBeCloseTo(0)
    expect(c.y).toBeCloseTo(100)
  })
  it('with the piece in the middle of its path, a step out is the same on either side', () => {
    const r = { ...DEFAULT_REPEAT, layout: 'path' as const, pieceOnPath: 'middle' as const, count: 14, opacity: [1, 0.45] as [number, number], spacing: [1, 1] as [number, number], path: [{ x: 0.9, y: 0.4 }, { x: 0, y: 0.4 }] }
    // The piece near the path's start: two copies behind it, twelve ahead.
    const out = repeatCopies(r, { x: 800, y: 400 }, { width: 50, height: 50 }, (p) => ({ x: p.x * 1000, y: p.y * 1000 }))
    const behind = out.filter((c) => c.x > 800).sort((a, b) => a.x - b.x)
    const ahead = out.filter((c) => c.x < 800).sort((a, b) => b.x - a.x)
    expect(behind.length).toBeGreaterThan(0)
    behind.forEach((c, k) => expect(c.opacity).toBeCloseTo(ahead[k].opacity, 5))
    // Along the whole path instead: one fade from its start to its end.
    const along = repeatCopies({ ...r, firstToLast: 'along' }, { x: 800, y: 400 }, { width: 50, height: 50 }, (p) => ({ x: p.x * 1000, y: p.y * 1000 })).sort((a, b) => b.x - a.x)
    expect(along[0].opacity).toBeCloseTo(1, 5)
    expect(along[along.length - 1].opacity).toBeCloseTo(0.45, 5)
  })
})
