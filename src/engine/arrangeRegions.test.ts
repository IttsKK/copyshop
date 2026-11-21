import { describe, expect, it } from 'vitest'
import { arrangePieces, assign, placeImage, regionsOf, type Cell, type ImageInfo } from './arrange'
import { DEFAULT_ARRANGE } from './types'

const cell = (x: number, y: number): Cell => ({ seed: { x, y }, area: [x - 0.05, y - 0.05, x + 0.05, y + 0.05], cx: x, cy: y, size: 100 })
const info = (id: string, warm: number): ImageInfo =>
  ({ id, width: 1000, height: 600, window: [0, 0, 1, 1], lin: [0.3 + warm, 0.3, 0.3 - warm], lum: 0.3, lab: [0.5, warm, -warm], mean: [0.3, 0.3, 0.3] }) as unknown as ImageInfo
const photo = { width: 1000, height: 800 }

describe('Arrange regions', () => {
  const clicks = [
    { x: 0.2, y: 0.2, group: 1 },
    { x: 0.4, y: 0.2, group: 1 },
    { x: 0.7, y: 0.6, group: 2, image: 'b' },
    { x: 0.2, y: 0.7 },
  ]
  const cells = clicks.map((c) => cell(c.x, c.y))
  const touch = cells.map(() => new Map<number, number>())
  touch[1].set(2, 0.5)
  touch[2].set(1, 0.5)
  const { regions, touch: near, pinned } = regionsOf(clicks, cells, touch, [0, 1, 2, 3])

  it('makes the gaps of one group one region, across all of them', () => {
    expect(regions).toHaveLength(3)
    expect(regions[0].seeds).toEqual([{ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.2 }])
    expect(regions[0].area[0]).toBeCloseTo(0.15)
    expect(regions[0].area[2]).toBeCloseTo(0.45)
    expect(regions[2].seeds).toEqual([{ x: 0.2, y: 0.7 }])
  })
  it('regions touch where their gaps do', () => {
    expect(near[0].get(1)).toBe(0.5)
    expect(near[1].get(0)).toBe(0.5)
  })
  it('keeps the image a region is set to have', () => {
    expect(pinned).toEqual([undefined, 'b', undefined])
    const images = [info('a', 0.1), info('c', -0.1), info('b', 0)]
    // 'b' is set but not among those it may choose (only the first two).
    const a = assign(regions, near, images, DEFAULT_ARRANGE, photo, [undefined, 2, undefined], 2)
    expect(a[1]).toBe(2)
    expect(a[0]).toBeLessThan(2)
    expect(a[2]).toBeLessThan(2)
  })
  it('lays one image across a whole region, every gap of it in the piece', () => {
    const images = [info('a', 0.1), info('c', -0.1), info('b', 0)]
    const pieces = arrangePieces(regions, near, images, [0, 2, 1], DEFAULT_ARRANGE, photo)
    const first = pieces.find((p) => p.image === 'a')!
    expect(first.seeds).toHaveLength(2)
  })
})

describe('placing an image over a region', () => {
  // An image whose lower half is ground: only its top half may show.
  const w = 20
  const h = 12
  const data = new Uint8Array(w * h)
  for (let y = 0; y < h / 2; y++) for (let x = 0; x < w; x++) data[y * w + x] = 1
  const im = { ...info('sky', 0), width: 2000, height: 1200, usable: { w, h, data } } as ImageInfo
  const area: [number, number, number, number] = [0.3, 0.3, 0.5, 0.4]
  const points = Array.from({ length: 36 }, (_, k) => ({ x: 0.3 + 0.2 * ((k % 6) + 0.5) / 6, y: 0.3 + 0.1 * (Math.floor(k / 6) + 0.5) / 6 }))
  const s = { ...DEFAULT_ARRANGE, size: 0.5 }
  const seq = (seed: number) => {
    let a = seed
    return () => ((a = (a * 16807) % 2147483647) / 2147483647)
  }
  const showsOnlySky = (p: { scale: number; cx: number; cy: number; flip: boolean }) =>
    points.every((q) => {
      const imw = p.scale * photo.width
      const imh = imw * 0.6
      let u = (q.x * photo.width - (p.cx - imw / 2)) / imw
      const v = (q.y * photo.height - (p.cy - imh / 2)) / imh
      if (p.flip) u = 1 - u
      return u >= 0 && u <= 1 && v >= 0 && v < 0.5
    })

  it('never shows what the image may not show, however it is shuffled', () => {
    for (let seed = 1; seed < 30; seed++) expect(showsOnlySky(placeImage(im, points, area, s, photo, [], seq(seed)))).toBe(true)
  })
  it('shuffled, it is placed differently', () => {
    const spots = new Set(Array.from({ length: 12 }, (_, k) => placeImage(im, points, area, s, photo, [], seq(k + 7))).map((p) => `${p.cx.toFixed(0)},${p.cy.toFixed(0)}`))
    expect(spots.size).toBeGreaterThan(3)
  })
  it('a second region using the same image shows another part of it', () => {
    const first = placeImage(im, points, area, s, photo, [], seq(3))
    const second = placeImage(im, points, area, s, photo, [first.footprint], seq(3))
    const [a0, b0, a1, b1] = first.footprint
    const [c0, d0, c1, d1] = second.footprint
    const ow = Math.max(0, Math.min(a1, c1) - Math.max(a0, c0))
    const oh = Math.max(0, Math.min(b1, d1) - Math.max(b0, d0))
    expect((ow * oh) / ((c1 - c0) * (d1 - d0))).toBeLessThan(0.5)
  })
})
