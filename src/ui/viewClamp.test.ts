import { describe, expect, it } from 'vitest'
import { centredPan, clampPan, MIN_OVERLAP, overlapOf, type Pan } from './viewClamp'

const photo = { width: 6000, height: 4000 }
const screen = { width: 1600, height: 1000 }
const viewAt = (scale: number, s = screen) => ({ width: s.width / scale, height: s.height / scale })

function expectOverlap(pan: Pan, ph: { width: number; height: number }, view: { width: number; height: number }) {
  const o = overlapOf(pan, ph, view)
  expect(o.x).toBeGreaterThanOrEqual(Math.min(ph.width, view.width * MIN_OVERLAP) - 1e-6)
  expect(o.y).toBeGreaterThanOrEqual(Math.min(ph.height, view.height * MIN_OVERLAP) - 1e-6)
}

/** Zoom from `scale` to `next` keeping the screen point (hx, hy) steady, then clamp. */
function zoomAt(pan: Pan, scale: number, next: number, hx: number, hy: number, s = screen) {
  const target = { x: pan.x + hx / scale - hx / next, y: pan.y + hy / scale - hy / next }
  return { target, pan: clampPan(target, photo, viewAt(next, s)) }
}

describe('clampPan', () => {
  it('holds the overlap when dragged far past every edge', () => {
    for (const scale of [0.05, 0.2, 1, 4]) {
      const view = viewAt(scale)
      for (const [dx, dy] of [[-1e6, 0], [1e6, 0], [0, -1e6], [0, 1e6], [-1e6, -1e6], [1e6, 1e6], [-1e6, 1e6], [1e6, -1e6]]) {
        const pan = clampPan({ x: dx, y: dy }, photo, view)
        expectOverlap(pan, photo, view)
      }
    }
  })

  it('lets the view go past the edge when zoomed in', () => {
    const view = viewAt(1)
    const pan = clampPan({ x: -1e6, y: -1e6 }, photo, view)
    expect(pan.x).toBeLessThan(0)
    expect(pan.y).toBeLessThan(0)
    expect(overlapOf(pan, photo, view).x).toBeCloseTo(view.width * MIN_OVERLAP)
  })

  it('leaves a pan that already keeps the overlap alone', () => {
    const view = viewAt(1)
    const pan = { x: 1234, y: -100 }
    expect(clampPan(pan, photo, view)).toEqual(pan)
  })

  it('keeps the point under the cursor when zooming in, and the overlap when zooming out at a corner', () => {
    // In at the middle of the photo: nothing to clamp, the point stays put.
    let pan = centredPan(photo, viewAt(0.25))
    const z = zoomAt(pan, 0.25, 1, 800, 500)
    expect(z.pan).toEqual(z.target)
    pan = z.pan

    // Dragged out to the top-left corner, then zoomed out hard at the
    // screen's opposite corner: the clamp moves the view, never loses the photo.
    let scale = 1
    pan = clampPan({ x: -1e6, y: -1e6 }, photo, viewAt(scale))
    for (const next of [0.5, 0.25, 0.1, 0.05, 0.02]) {
      const step = zoomAt(pan, scale, next, screen.width, screen.height)
      expectOverlap(step.pan, photo, viewAt(next))
      pan = step.pan
      scale = next
    }
    // And at the near corner too.
    pan = clampPan({ x: 1e6, y: 1e6 }, photo, viewAt(1))
    scale = 1
    for (const next of [0.5, 0.2, 0.05]) {
      const step = zoomAt(pan, scale, next, 0, 0)
      expectOverlap(step.pan, photo, viewAt(next))
      pan = step.pan
      scale = next
    }
  })

  it('keeps a photo smaller than the view in view, free to move within the rule', () => {
    const small = { width: 300, height: 200 }
    const view = { width: 1600, height: 1000 }
    // Smaller than MIN_OVERLAP of the view: wholly in view wherever it is dragged.
    for (const p of [{ x: -1e6, y: -1e6 }, { x: 1e6, y: 1e6 }, { x: -1e6, y: 1e6 }, { x: 1e6, y: -1e6 }]) {
      const pan = clampPan(p, small, view)
      const o = overlapOf(pan, small, view)
      expect(o.x).toBeCloseTo(small.width)
      expect(o.y).toBeCloseTo(small.height)
    }
    // Not snapped to the middle: a drag inside the view stays where it is put.
    const moved = { x: -100, y: -50 }
    expect(clampPan(moved, small, view)).toEqual(moved)
    // Fit puts it back in the middle, which keeps the rule.
    const mid = centredPan(small, view)
    expect(clampPan(mid, small, view)).toEqual(mid)

    // Larger than MIN_OVERLAP of the view but still smaller than it: part may go off.
    const mid2 = { width: 1000, height: 800 }
    const pan = clampPan({ x: 1e6, y: -1e6 }, mid2, view)
    expectOverlap(pan, mid2, view)
    expect(overlapOf(pan, mid2, view).x).toBeLessThan(mid2.width)
  })

  it('holds the overlap when the view changes size under a pan', () => {
    const scale = 1
    // At the far right edge with a wide view, then a panel opens and the view narrows.
    const wide = viewAt(scale, { width: 2400, height: 1400 })
    const pan = clampPan({ x: 1e6, y: 1e6 }, photo, wide)
    expectOverlap(pan, photo, wide)
    for (const s of [{ width: 1200, height: 1400 }, { width: 400, height: 300 }, { width: 3000, height: 2000 }]) {
      const view = viewAt(scale, s)
      const after = clampPan(pan, photo, view)
      expectOverlap(after, photo, view)
    }
    // And the same when a view narrows from the left edge.
    const left = clampPan({ x: -1e6, y: -1e6 }, photo, wide)
    const narrow = viewAt(scale, { width: 500, height: 400 })
    expectOverlap(clampPan(left, photo, narrow), photo, narrow)
  })

  it('centres a photo on the view', () => {
    const view = viewAt(0.2)
    const pan = centredPan(photo, view)
    expect(pan.x + view.width / 2).toBeCloseTo(photo.width / 2)
    expect(pan.y + view.height / 2).toBeCloseTo(photo.height / 2)
    expect(clampPan(pan, photo, view)).toEqual(pan)
  })
})
