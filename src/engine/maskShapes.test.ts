import { describe, expect, it } from 'vitest'
import { outlineRuns } from './maskShapes'

describe('an outline of several parts, drawn', () => {
  it('leaves out the bridges between its rings', () => {
    const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
    const b = [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]
    const c = [{ x: 9, y: 0 }, { x: 9, y: 1 }, { x: 8, y: 1 }]
    // As ml/trace.ts joins them: each ring closed on its start, then back along the bridges.
    const joined = [...a, a[0], ...b, b[0], ...c, c[0], b[0]]
    const { runs, closed } = outlineRuns(joined)
    expect(closed).toBe(false)
    expect(runs).toEqual([
      [...a, a[0]],
      [...b, b[0]],
      [...c, c[0]],
    ])
  })
  it('one ring is drawn as it was', () => {
    const a = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
    expect(outlineRuns(a)).toEqual({ runs: [a], closed: true })
  })
})
