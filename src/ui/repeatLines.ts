import type { RepeatParams } from '../engine/repeatParams'
import { streakVanish } from '../engine/streaks'
import { STREAK_DEFAULTS, type Rect } from '../engine/types'
import { matchStreakLines, type StreakSpace } from './streakLines'

/**
 * Repeat lined up with the photo: the subject's own straight edges found
 * round its piece (`box`, fractions of the frame masks are in), as a
 * streak's are (matchStreakLines), running the way the copies go; where they
 * meet is the copies' vanishing point (RepeatParams.vanish), so they carry
 * the subject on in its own perspective. Edges that do not meet (seen
 * straight on) turn the line of copies to run along them instead. Null when
 * no clear edges are found.
 */
export function repeatLineUp(
  bitmap: ImageBitmap,
  repeat: RepeatParams,
  box: { x: number; y: number; width: number; height: number },
  space: StreakSpace,
  photoFrame: Rect,
): { patch: Partial<RepeatParams>; edges: number } | null {
  const outline = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ]
  // The way the copies go, before any turn.
  const base = repeat.up !== 0 ? (repeat.up > 0 ? -90 : 90) : repeat.across >= 0 ? 0 : 180
  const probe = { ...STREAK_DEFAULTS, mode: 'trail' as const, seed: 1, outline, angle: base + (repeat.angle ?? 0) }
  const got = matchStreakLines(bitmap, probe, space, photoFrame)
  if (!got) return null
  const { frame, measure } = space
  const toS = (p: { x: number; y: number }) => ({ x: (frame.x + p.x * frame.width - measure.x) / measure.unit, y: (frame.y + p.y * frame.height - measure.y) / measure.unit })
  const fromS = (q: { x: number; y: number }) => ({ x: (q.x * measure.unit + measure.x - frame.x) / frame.width, y: (q.y * measure.unit + measure.y - frame.y) / frame.height })
  const rad = (got.angle * Math.PI) / 180
  const v = streakVanish(outline.map(toS), { x: Math.cos(rad), y: Math.sin(rad) }, got.converge ?? 0)
  const edges = got.guides.length
  if (v) return { patch: { layout: 'grid', vanish: fromS(v), angle: 0, ...(repeat.spacing ? {} : { spacing: [1, 1] }) }, edges }
  return { patch: { vanish: null, angle: Math.round((got.angle - base) * 10) / 10 }, edges }
}
