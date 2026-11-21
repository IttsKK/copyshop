import type { Rect } from '../engine/types'

type Pt = { x: number; y: number }

/**
 * The lens's distortion for what is drawn over the preview. The engine shows
 * each print pixel the scene from where the lens bends it (lensScene in the
 * main shader), so a point on the photo — a streak's corner, a mask's
 * outline — is seen somewhere else. The editors on the photo draw points
 * where they are seen (toView) and turn a click back into where it is on the
 * photo (toScene). Set by the app each render; off, both are the point itself.
 */
let lens: { k: number; frame: Rect } | null = null

export function setLensView(k: number, frame: Rect | null): void {
  lens = k !== 0 && frame ? { k, frame } : null
}

/** The scale at a print position (see lensScene): the photo's point shown there is its middle plus this much of the way out. */
function scaleAt(p: Pt, l: { k: number; frame: Rect }): number {
  const f = l.frame
  const u = (p.x - f.x) / f.width - 0.5
  const v = (p.y - f.y) / f.height - 0.5
  const aspect = f.width / f.height
  const r2 = (u * u * aspect * aspect + v * v) / (0.25 * (aspect * aspect + 1))
  let s = 1 - l.k * r2
  if (l.k < 0) s /= 1 - l.k
  return s
}

/** Where a print position shows the photo from (print px in, print px out). */
export function toScene(p: Pt): Pt {
  if (!lens) return p
  const f = lens.frame
  const s = scaleAt(p, lens)
  const cx = f.x + f.width / 2
  const cy = f.y + f.height / 2
  return { x: cx + (p.x - cx) * s, y: cy + (p.y - cy) * s }
}

/** Where a point of the photo is seen in the print (toScene's inverse). */
export function toView(p: Pt): Pt {
  if (!lens) return p
  const f = lens.frame
  const cx = f.x + f.width / 2
  const cy = f.y + f.height / 2
  let v = p
  for (let i = 0; i < 8; i++) {
    const s = Math.max(scaleAt(v, lens), 0.05)
    v = { x: cx + (p.x - cx) / s, y: cy + (p.y - cy) / s }
  }
  return v
}

/** Whether the lens bends the view at all. */
export const lensBends = () => lens !== null

/**
 * A line through points of the photo (print px), as the lens shows it: each
 * stretch cut finer so it bows as the lens bends it. Closed: back to the start.
 */
export function viewLine(pts: Pt[], closed: boolean): Pt[] {
  if (!lens || pts.length < 2) return pts.map(toView)
  const out: Pt[] = []
  const n = closed ? pts.length : pts.length - 1
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    const steps = 8
    for (let k = 0; k < steps; k++) out.push(toView({ x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps }))
  }
  if (!closed) out.push(toView(pts[pts.length - 1]))
  return out
}
