import { describe, expect, it } from 'vitest'
import type { Selection } from '../ml/segment'
import { combinePieces } from './pickPieces'

/** A 4×1 selection, three readings all the given cells. */
const sel = (cells: number[], w = 4, h = 1): Selection => {
  const m = new Uint8Array(w * h)
  cells.forEach((c) => (m[c] = 1))
  return { width: w, height: h, masks: [m, m, m], scores: [1, 1, 1], best: 0 }
}

describe('Selecting by pieces', () => {
  it('adds what each click found, leaving the rest as it was', () => {
    const got = combinePieces([{ piece: { sel: sel([0]), reading: 0 }, on: true }, { piece: { sel: sel([2]), reading: 0 }, on: true }], null)!
    expect([...got.masks[0]]).toEqual([1, 0, 1, 0])
  })

  it('takes out what a click to leave out found, and a later click puts it back', () => {
    const a = { piece: { sel: sel([0, 1, 2]), reading: 0 }, on: true }
    const out = { piece: { sel: sel([1]), reading: 0 }, on: false }
    expect([...combinePieces([a, out], null)!.masks[0]]).toEqual([1, 0, 1, 0])
    const back = { piece: { sel: sel([1, 3]), reading: 0 }, on: true }
    expect([...combinePieces([a, out, back], null)!.masks[0]]).toEqual([1, 1, 1, 1])
  })

  it('adds to a selection there already, at the finest size', () => {
    const base = { grid: Uint8Array.from([1, 0]), width: 2, height: 1 }
    const got = combinePieces([{ piece: { sel: sel([3]), reading: 0 }, on: true }], base)!
    expect(got.width).toBe(4)
    expect([...got.masks[0]]).toEqual([1, 1, 0, 1])
  })

  it('is nothing with no pieces and nothing there', () => {
    expect(combinePieces([], null)).toBeNull()
  })
})
