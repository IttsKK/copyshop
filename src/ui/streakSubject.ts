import { rasterBounds } from '../engine/maskRaster'
import type { MaskRaster, Rect } from '../engine/types'
import { insetSelection, traceSelection } from '../ml/trace'
import { rasterCover } from './maskBrush'

type Point = { x: number; y: number }

/** Where streak shapes are kept and measured (App's streakSpace): print px. */
export interface StreakSpace {
  frame: Rect
  measure: { x: number; y: number; unit: number }
}

/** How far inside the subject's edge a new subject streak starts, fraction of the short side. */
export const SUBJECT_INSET = 0.008

/** Points in a subject streak's outline: enough to follow the edge, few enough to move by hand. */
const SUBJECT_POINTS = 140

/** A raster cell's size in print px, across and down. */
function cellSize(raster: MaskRaster, space: StreakSpace) {
  return { x: (raster.width * space.frame.width) / raster.w, y: (raster.height * space.frame.height) / raster.h }
}

/**
 * A subject streak's outline: the selection (a mask's raster) taken in
 * `inset` (fraction of the short side) and traced, in the fractions streak
 * shapes are kept in. Null when the subject is too thin to take in that far.
 */
export function subjectOutline(raster: MaskRaster, inset: number, space: StreakSpace): Point[] | null {
  const grid = rasterCover(raster)
  const cell = cellSize(raster, space)
  const cells = (inset * space.measure.unit) / Math.max(1e-6, (cell.x + cell.y) / 2)
  const inner = insetSelection(grid, raster.w, raster.h, cells)
  const traced = traceSelection(inner, raster.w, raster.h, SUBJECT_POINTS, false)
  return traced?.map((p) => ({ x: raster.x + p.x * raster.width, y: raster.y + p.y * raster.height })) ?? null
}

/**
 * Which way a subject's streak most likely goes, and how long: up, as most
 * streaked subjects (towers, trees, people) go, unless it comes in from one
 * side only (a car streaks away from it) or reaches the top (then the way
 * with most room); long enough for the longest bars to run off the photo.
 */
export function guessFlow(raster: MaskRaster, space: StreakSpace): { angle: number; length: number } {
  const grid = rasterCover(raster)
  const b = rasterBounds(grid, raster.w, raster.h)
  if (!b) return { angle: -90, length: 0.6 }
  // The bounds in the shape frame's fractions.
  const x0 = raster.x + b.x * raster.width
  const y0 = raster.y + b.y * raster.height
  const x1 = x0 + b.width * raster.width
  const y1 = y0 + b.height * raster.height
  const near = 0.03
  const on = { top: y0 < near, bottom: y1 > 1 - near, left: x0 < near, right: x1 > 1 - near }
  const { width: W, height: H } = space.frame
  const unit = space.measure.unit
  // Each way: its angle (0 rightward, 90 down) and how far the subject's far side is from the photo's edge, short-side units.
  const ways = {
    up: { angle: -90, room: (y0 * H) / unit },
    down: { angle: 90, room: ((1 - y1) * H) / unit },
    right: { angle: 0, room: ((1 - x1) * W) / unit },
    left: { angle: 180, room: (x0 * W) / unit },
  }
  // A subject in from one side only (a car, a train) streaks away from it;
  // otherwise up, unless it reaches the top, then whichever way has most room.
  const sideOnly = !on.top && !on.bottom && on.left !== on.right
  const way = sideOnly
    ? on.left
      ? ways.right
      : ways.left
    : ways.up.room >= 0.15
      ? ways.up
      : [ways.down, ways.left, ways.right].reduce((a, b) => (b.room > a.room ? b : a))
  // Too little room that way (a subject right under the top edge): a set length instead.
  const length = way.room > 0.08 ? Math.min(1.5, way.room * 1.02) : 0.5
  return { angle: way.angle, length: Math.round(length * 1000) / 1000 }
}
