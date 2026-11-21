/**
 * A lens's bend: straight lines in front of it come out bowed, more the
 * further from the middle of the frame (barrel, or pincushion). One number,
 * k, over the photo's half-diagonal R from its middle (cx, cy), in the
 * streaks' short-side units. A streak with a bend works out its lines as if
 * the lens were perfect and draws them bent back, so its bars curve as the
 * photo's own straight edges do.
 */
export interface LensBend {
  k: number
  cx: number
  cy: number
  R: number
}

type Pt = { x: number; y: number }

/** Where a point of the photo would be through a perfect lens. */
export function unbend(p: Pt, b: LensBend | null | undefined): Pt {
  if (!b || b.k === 0) return p
  const dx = p.x - b.cx
  const dy = p.y - b.cy
  const r2 = (dx * dx + dy * dy) / (b.R * b.R)
  const f = 1 + b.k * r2
  return { x: b.cx + dx * f, y: b.cy + dy * f }
}

/** Where a point through a perfect lens lands through this one (unbend's inverse). */
export function bend(p: Pt, b: LensBend | null | undefined): Pt {
  if (!b || b.k === 0) return p
  const dx = p.x - b.cx
  const dy = p.y - b.cy
  let f = 1
  for (let i = 0; i < 6; i++) {
    const r2 = (dx * dx + dy * dy) / (f * f * b.R * b.R)
    f = 1 + b.k * r2
  }
  return { x: b.cx + dx / f, y: b.cy + dy / f }
}
