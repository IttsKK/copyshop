import { describe, expect, it } from 'vitest'
import { encodeRaster, rasterToPoints } from './maskRaster'

const raster = (w: number, h: number, on: (x: number, y: number) => boolean, extra: object = {}) => {
  const g = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = on(x, y) ? 1 : 0
  return { w, h, runs: encodeRaster(g, w, h), x: 0, y: 0, width: 1, height: 1, ...extra }
}
/** Whether a point is inside a polygon (even-odd). */
const inPoly = (p: { x: number; y: number }, poly: { x: number; y: number }[]) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
    if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c
  return c
}

describe('a selection made into points', () => {
  it('a square becomes its four corners', () => {
    const got = rasterToPoints(raster(100, 100, (x, y) => x >= 20 && x < 60 && y >= 30 && y < 80))!
    expect(got.points.length).toBe(4)
    const xs = got.points.map((p) => p.x).sort()
    const ys = got.points.map((p) => p.y).sort()
    expect(xs[0]).toBeCloseTo(0.2)
    expect(xs[3]).toBeCloseTo(0.6)
    expect(ys[0]).toBeCloseTo(0.3)
    expect(ys[3]).toBeCloseTo(0.8)
    expect(got.pieces).toBe(0)
    expect(got.holes).toBe(false)
  })
  it('a disc keeps its shape in few enough points to move by hand', () => {
    const got = rasterToPoints(raster(400, 400, (x, y) => (x - 200) ** 2 + (y - 180) ** 2 < 120 ** 2), 80)!
    expect(got.points.length).toBeLessThanOrEqual(80)
    expect(got.points.length).toBeGreaterThan(12)
    expect(inPoly({ x: 0.5, y: 0.45 }, got.points)).toBe(true)
    expect(inPoly({ x: 0.5 + 0.28, y: 0.45 }, got.points)).toBe(true)
    expect(inPoly({ x: 0.5 + 0.32, y: 0.45 }, got.points)).toBe(false)
    for (const p of got.points) expect(Math.abs(Math.hypot(p.x - 0.5, p.y - 0.45) - 0.3)).toBeLessThan(0.01)
  })
  it('keeps the largest piece, and says how many others and whether there were holes', () => {
    const got = rasterToPoints(raster(100, 100, (x, y) => (x >= 10 && x < 70 && y >= 10 && y < 70 && !(x >= 30 && x < 40 && y >= 30 && y < 40)) || (x >= 80 && x < 95 && y >= 80 && y < 95)))!
    expect(got.pieces).toBe(1)
    expect(got.holes).toBe(true)
    expect(inPoly({ x: 0.2, y: 0.2 }, got.points)).toBe(true)
    expect(inPoly({ x: 0.87, y: 0.87 }, got.points)).toBe(false)
  })
  it('in the frame the selection sits in, with what was painted counted', () => {
    const w = 50
    const out = new Uint8Array(w * w)
    for (let y = 0; y < w; y++) for (let x = 25; x < w; x++) out[y * w + x] = 1
    const got = rasterToPoints(raster(w, w, (x, y) => x >= 5 && x < 45 && y >= 5 && y < 45, { x: 0.5, y: 0.25, width: 0.5, height: 0.5, paintOut: encodeRaster(out, w, w) }))!
    const xs = got.points.map((p) => p.x)
    expect(Math.min(...xs)).toBeCloseTo(0.5 + 0.05)
    expect(Math.max(...xs)).toBeCloseTo(0.5 + 0.25)
  })
  it('nothing selected: nothing', () => {
    expect(rasterToPoints(raster(10, 10, () => false))).toBeNull()
  })
})
