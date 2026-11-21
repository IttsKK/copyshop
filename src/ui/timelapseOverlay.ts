import { samplePath } from '../engine/streaks'
import { printSizeOf, shapeFrame, type BlendParams, type Rect, type Size } from '../engine/types'
import type { TimelapseFocus } from './timelapse'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Point = { x: number; y: number }

const STREAK = { line: 'rgba(140, 200, 255, 0.9)', fill: 'rgba(140, 200, 255, 0.12)', dim: 'rgba(140, 200, 255, 0.45)' }
const MASK = { line: 'rgba(255, 190, 110, 0.95)', fill: 'rgba(255, 190, 110, 0.14)', dim: 'rgba(255, 190, 110, 0.5)' }

/**
 * The shapes being edited, drawn over a timelapse video's frame as the app
 * shows them on the photo: the one being edited solid with its points, the
 * others of its kind faint and dashed, one being drawn as its points so far.
 * `at` is where the print is drawn on the canvas.
 */
export function drawFocus(ctx: Ctx, focus: TimelapseFocus, blend: BlendParams, base: Size, at: Rect): void {
  const print = printSizeOf(base, blend)
  const frame = shapeFrame(base, blend)
  const k = at.width / print.width
  const px = (p: Point): [number, number] => [at.x + (frame.x + p.x * frame.width) * k, at.y + (frame.y + p.y * frame.height) * k]
  // Lines as thick on the video as the app's are on a screen.
  const u = Math.max(1, Math.min(at.width, at.height) / 520)
  const fx = blend.effects
  const outlines: { outline: Point[]; path: Point[] | null; angle: number; radial: boolean }[] =
    focus.kind === 'streak'
      ? fx.streaks.shapes.map((s) => ({ outline: s.outline, path: s.path, angle: s.angle, radial: s.radial }))
      : fx.masks.map((m) => ({ outline: m.outline, path: null, angle: 0, radial: false }))
  const c = focus.kind === 'streak' ? STREAK : MASK

  ctx.save()
  ctx.beginPath()
  ctx.rect(at.x, at.y, at.width, at.height)
  ctx.clip()
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const trace = (pts: Point[], close: boolean) => {
    ctx.beginPath()
    pts.forEach((p, i) => {
      const [x, y] = px(p)
      if (i) ctx.lineTo(x, y)
      else ctx.moveTo(x, y)
    })
    if (close) ctx.closePath()
  }
  const dot = (p: Point, r: number, fill: string, stroke: string) => {
    const [x, y] = px(p)
    ctx.beginPath()
    ctx.arc(x, y, r * u, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.lineWidth = 1.5 * u
    ctx.strokeStyle = stroke
    ctx.stroke()
  }
  const arrowPath = (pts: Point[]) => {
    const line = samplePath(pts, Math.max(2, pts.length * 12))
    trace(line, false)
    ctx.setLineDash([6 * u, 4 * u])
    ctx.lineWidth = 1.6 * u
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)'
    ctx.stroke()
    ctx.setLineDash([])
    if (line.length >= 2) {
      const [x1, y1] = px(line[line.length - 2])
      const [x2, y2] = px(line[line.length - 1])
      const a = Math.atan2(y2 - y1, x2 - x1)
      const h = 9 * u
      ctx.beginPath()
      ctx.moveTo(x2, y2)
      ctx.lineTo(x2 - h * Math.cos(a - 0.45), y2 - h * Math.sin(a - 0.45))
      ctx.lineTo(x2 - h * Math.cos(a + 0.45), y2 - h * Math.sin(a + 0.45))
      ctx.closePath()
      ctx.fillStyle = 'rgba(255, 255, 255, 0.9)'
      ctx.fill()
    }
  }

  const drawingOutline = focus.draft && !focus.path
  outlines.forEach((s, i) => {
    const on = focus.index === i && !drawingOutline
    if (s.outline.length < 3) return
    trace(s.outline, true)
    if (!on) {
      ctx.setLineDash([3 * u, 5 * u])
      ctx.lineWidth = 1.2 * u
      ctx.strokeStyle = c.dim
      ctx.stroke()
      ctx.setLineDash([])
      return
    }
    ctx.fillStyle = c.fill
    ctx.fill()
    ctx.lineWidth = 1.8 * u
    ctx.strokeStyle = c.line
    ctx.stroke()
    if (focus.kind === 'streak') {
      const mid = s.outline.reduce((a, p) => ({ x: a.x + p.x / s.outline.length, y: a.y + p.y / s.outline.length }), { x: 0, y: 0 })
      if (s.path && s.path.length >= 2 && !focus.path) arrowPath(s.path)
      else if (s.radial) dot(mid, 6, '#ffd27a', '#17181a')
      else if (!focus.path) {
        const [cx, cy] = px(mid)
        const a = (s.angle * Math.PI) / 180
        const arm = Math.max(30 * u, Math.min(at.width, at.height) * 0.08)
        ctx.beginPath()
        ctx.moveTo(cx, cy)
        ctx.lineTo(cx + Math.cos(a) * arm, cy + Math.sin(a) * arm)
        ctx.lineWidth = 1.5 * u
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)'
        ctx.stroke()
        const [hx, hy] = [cx + Math.cos(a) * arm, cy + Math.sin(a) * arm]
        ctx.beginPath()
        ctx.arc(hx, hy, 7 * u, 0, Math.PI * 2)
        ctx.fillStyle = '#8cc8ff'
        ctx.fill()
        ctx.lineWidth = 2 * u
        ctx.strokeStyle = '#17181a'
        ctx.stroke()
      }
    }
    for (const p of s.outline) dot(p, 3.5, 'rgba(20, 21, 24, 0.85)', '#fff')
  })

  // One being drawn: its points so far, joined up.
  const draft = focus.draft
  if (draft && draft.length) {
    if (focus.path) {
      if (draft.length >= 2) arrowPath(draft)
      for (const p of draft) dot(p, 3.5, '#8cc8ff', '#17181a')
    } else {
      trace(draft, false)
      ctx.lineWidth = 1.8 * u
      ctx.strokeStyle = c.line
      ctx.stroke()
      for (const p of draft) dot(p, 3.5, 'rgba(20, 21, 24, 0.85)', '#fff')
      dot(draft[draft.length - 1], 5, c.line, '#17181a')
    }
  }
  ctx.restore()
}
