import { describe, expect, it } from 'vitest'
import { decodeRaster, encodeRaster } from '../engine/maskRaster'
import type { MaskShape } from '../engine/types'
import { cellColours, paintRaster } from './maskBrush'

describe('brushing only over similar colours', () => {
  // A 20 x 10 raster over the whole photo: the left half red, the right half blue.
  const w = 20
  const h = 10
  const rgba = new Uint8ClampedArray(w * h * 4)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const k = (y * w + x) * 4
      rgba.set(x < w / 2 ? [200, 40, 30, 255] : [30, 60, 200, 255], k)
    }
  const lab = cellColours(rgba, w * h)
  const frame = { x: 0, y: 0, width: 1, height: 1 }
  const mask = {
    id: 'm',
    name: 'Subject',
    outline: [],
    raster: { x: 0, y: 0, width: 1, height: 1, w, h, runs: encodeRaster(new Uint8Array(w * h), w, h) },
  } as unknown as MaskShape
  // A stroke right across the photo, through its middle, wide enough to cover every row.
  const stroke = [
    { x: 0.05, y: 0.5 },
    { x: 0.95, y: 0.5 },
  ]
  const painted = (start: { x: number; y: number }[], similar: boolean) => {
    const m = paintRaster(mask, start, 'add', 1, frame, frame, similar ? { lab, range: 0.08 } : undefined)
    return decodeRaster({ w, h, runs: m.raster!.paintSure! })
  }

  it('started on red, paints only the red half', () => {
    const grid = painted(stroke, true)
    for (let x = 0; x < w; x++) expect(grid[5 * w + x]).toBe(x < w / 2 ? 1 : 0)
  })
  it('started on blue, paints only the blue half', () => {
    const grid = painted([...stroke].reverse(), true)
    for (let x = 0; x < w; x++) expect(grid[5 * w + x]).toBe(x < w / 2 ? 0 : 1)
  })
  it('without it, paints everywhere it goes', () => {
    const grid = painted(stroke, false)
    for (let x = 0; x < w; x++) expect(grid[5 * w + x]).toBe(1)
  })
})
