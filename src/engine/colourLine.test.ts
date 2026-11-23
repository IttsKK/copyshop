import { expect, it } from 'vitest'
import { colourLineAt, colourLineRow, defaultColourLine } from './colourLine'

// A streak going up (s = -y), t across (x).
const coords = (p: { x: number; y: number }) => ({ s: -p.y, t: p.x })

it('starts on the edge the bars read from, with few points', () => {
  const box = [{ x: 0, y: 0.2 }, { x: 1, y: 0.2 }, { x: 1, y: 0.8 }, { x: 0, y: 0.8 }]
  const fill = defaultColourLine(box, coords, false)
  const trail = defaultColourLine(box, coords, true)
  expect(fill.length).toBeLessThan(6)
  expect(fill.every((p) => Math.abs(p.y - 0.8) < 1e-6)).toBe(true)
  expect(trail.every((p) => Math.abs(p.y - 0.2) < 1e-6)).toBe(true)
})

it('each line reads where it crosses the line; past its ends it reads at its edge', () => {
  const line = [{ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.3 }]
  const st = line.map(coords)
  expect(colourLineAt(line, st, 0.4)!.p.y).toBeCloseTo(0.4)
  expect(colourLineAt(line, st, 0.9)).toBeNull()
  const row = colourLineRow(line, coords, 0, 0.25, 4, -1, 1, () => 0.5)
  // Lines at t 0.125 (outside), 0.375, 0.625 (just outside), 0.875 (outside).
  expect([row[3], row[7], row[11], row[15]]).toEqual([0, 255, 0, 0])
})
