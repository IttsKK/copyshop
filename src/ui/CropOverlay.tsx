import { useRef, useState } from 'react'
import { cropFrameSize, insideTurned, quarterOf, type CropParams } from '../engine/crop'
import type { Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

export interface CropEditor {
  crop: CropParams
  /** Width over height in pixels the crop keeps to; null when free. */
  ratio: number | null
  /** The photo's size in pixels, for the crop's size shown on it. */
  photo: Size
  onChange: (patch: Partial<Pick<CropParams, 'x' | 'y' | 'width' | 'height' | 'angle'>>) => void
  onDone: () => void
}

interface Props {
  editor: CropEditor
  /** The whole photo, in print pixels. */
  frame: Rect
  region: Rect
  css: Size
  /** The photo on screen made this much smaller, to fit turned (PreviewCanvas turnFit). */
  fit?: number
}

type Handle = 'move' | 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se' | 'turn'
type Box = { x: number; y: number; width: number; height: number }

const MIN = 0.03

/**
 * The crop over the whole photo, the photo turned under it on screen as the
 * crop turns it (CropParams.quarter and angle) and the crop upright: what is
 * cut away dimmed, the picture with a rule-of-thirds grid. Drag inside to
 * move it, a corner or a side to size it; with an aspect chosen, the corners
 * keep it and the sides hold their centre. Drag outside it to straighten the
 * photo under it: the crop stops at the photo's edges, no empty corner
 * inside. Double-click, Enter or Done finish.
 */
export function CropOverlay({ editor, frame, region, css, fit = 1 }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ handle: Handle; from: { x: number; y: number }; css: { x: number; y: number }; was: Box; angle: number; last: Box } | null>(null)
  const [dragging, setDragging] = useState(false)
  const c = editor.crop
  const quarter = quarterOf(c)
  const deg = quarter * 90 + (c.angle ?? 0)
  // The crop's frame (the photo, on its side for an odd quarter) in print pixels, about the photo's middle.
  const fw = quarter % 2 ? frame.height : frame.width
  const fh = quarter % 2 ? frame.width : frame.height
  const s = (css.width / region.width) * fit
  const mid = {
    x: ((frame.x + frame.width / 2 - region.x) * css.width) / region.width,
    y: ((frame.y + frame.height / 2 - region.y) * css.height) / region.height,
  }
  const toCss = (x: number, y: number): [number, number] => [mid.x + (x - 0.5) * fw * s, mid.y + (y - 0.5) * fh * s]
  const cssOf = (e: React.PointerEvent) => {
    const r = svg.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const fromCss = (p: { x: number; y: number }) => ({ x: (p.x - mid.x) / (fw * s) + 0.5, y: (p.y - mid.y) / (fh * s) + 0.5 })
  // The aspect as a ratio of fractions of the frame.
  const k = editor.ratio === null ? null : (editor.ratio * fh) / fw

  const begin = (e: React.PointerEvent, handle: Handle) => {
    e.stopPropagation()
    e.preventDefault()
    const was = { x: c.x, y: c.y, width: c.width, height: c.height }
    const at = cssOf(e)
    drag.current = { handle, from: fromCss(at), css: at, was, angle: c.angle ?? 0, last: was }
    setDragging(true)
    capturePointer(e.target, e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const at = cssOf(e)
    const p = fromCss(at)
    const dx = p.x - d.from.x
    const dy = p.y - d.from.y
    const w = d.was
    // Outside the crop: straightened by how far the pointer has gone round the crop's middle, on screen.
    if (d.handle === 'turn') {
      const [mx, my] = toCss(w.x + w.width / 2, w.y + w.height / 2)
      const a0 = Math.atan2(d.css.y - my, d.css.x - mx)
      const a1 = Math.atan2(at.y - my, at.x - mx)
      let turn = d.angle + ((a1 - a0) * 180) / Math.PI
      turn = ((((turn + 180) % 360) + 360) % 360) - 180
      editor.onChange({ angle: Math.round(Math.max(-45, Math.min(45, turn)) * 10) / 10 })
      return
    }
    let next: Box
    if (d.handle === 'move') {
      next = { ...w, x: Math.min(1 - w.width, Math.max(0, w.x + dx)), y: Math.min(1 - w.height, Math.max(0, w.y + dy)) }
    } else {
      let left = w.x
      let top = w.y
      let right = w.x + w.width
      let bottom = w.y + w.height
      if (d.handle.includes('w')) left = Math.min(right - MIN, Math.max(0, left + dx))
      if (d.handle.includes('e')) right = Math.max(left + MIN, Math.min(1, right + dx))
      if (d.handle.includes('n')) top = Math.min(bottom - MIN, Math.max(0, top + dy))
      if (d.handle.includes('s')) bottom = Math.max(top + MIN, Math.min(1, bottom + dy))
      next = { x: left, y: top, width: right - left, height: bottom - top }
      if (k !== null) next = keepRatio(next, w, d.handle, k)
    }
    // Turned, it stops where it would show an empty corner: as far toward the
    // pointer as it can go from where it last was.
    if (deg && !insideTurned(next, editor.photo, deg, quarter)) {
      const from = d.last
      const at = (t: number): Box => ({
        x: from.x + (next.x - from.x) * t,
        y: from.y + (next.y - from.y) * t,
        width: from.width + (next.width - from.width) * t,
        height: from.height + (next.height - from.height) * t,
      })
      let lo = 0
      let hi = 1
      for (let i = 0; i < 20; i++) {
        const m = (lo + hi) / 2
        if (insideTurned(at(m), editor.photo, deg, quarter)) lo = m
        else hi = m
      }
      next = at(lo)
    }
    d.last = next
    editor.onChange(next)
  }

  const stop = () => {
    drag.current = null
    setDragging(false)
  }

  const [x0, y0] = toCss(c.x, c.y)
  const [x1, y1] = toCss(c.x + c.width, c.y + c.height)
  // Dimmed all round it, as far as the view goes.
  const [fx0, fy0, fx1, fy1] = [-4000, -4000, css.width + 4000, css.height + 4000]
  const w = x1 - x0
  const h = y1 - y0
  const corners: [Handle, number, number][] = [
    ['nw', x0, y0],
    ['ne', x1, y0],
    ['sw', x0, y1],
    ['se', x1, y1],
  ]
  const sides: [Handle, number, number][] = [
    ['n', x0 + w / 2, y0],
    ['s', x0 + w / 2, y1],
    ['w', x0, y0 + h / 2],
    ['e', x1, y0 + h / 2],
  ]
  return (
    <svg
      ref={svg}
      className={`crop-overlay${dragging ? ' dragging' : ''}`}
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <path
        className="crop-shade"
        onPointerDown={(e) => begin(e, 'turn')}
        fillRule="evenodd"
        d={`M${fx0} ${fy0}H${fx1}V${fy1}H${fx0}Z M${x0} ${y0}V${y1}H${x1}V${y0}Z`}
      />
      <rect className="crop-body" x={x0} y={y0} width={w} height={h} onPointerDown={(e) => begin(e, 'move')} onDoubleClick={editor.onDone} />
      {[1, 2].map((i) => (
        <g key={i} className="crop-thirds">
          <line x1={x0 + (w * i) / 3} y1={y0} x2={x0 + (w * i) / 3} y2={y1} />
          <line x1={x0} y1={y0 + (h * i) / 3} x2={x1} y2={y0 + (h * i) / 3} />
        </g>
      ))}
      <rect className="crop-edge" x={x0} y={y0} width={w} height={h} />
      {/* Each side can be dragged along its length; with an aspect, it holds its centre. */}
      {sides.map(([id]) => {
        const across = id === 'n' || id === 's'
        const at = id === 'n' ? y0 : id === 's' ? y1 : id === 'w' ? x0 : x1
        return across ? (
          <rect key={`${id}-hit`} className={`crop-side-hit ${id}`} x={x0 + 14} y={at - 7} width={Math.max(0, w - 28)} height={14} onPointerDown={(e) => begin(e, id)} />
        ) : (
          <rect key={`${id}-hit`} className={`crop-side-hit ${id}`} x={at - 7} y={y0 + 14} width={14} height={Math.max(0, h - 28)} onPointerDown={(e) => begin(e, id)} />
        )
      })}
      {sides.map(([id, x, y]) => (
        <rect
          key={id}
          className={`crop-side ${id}`}
          x={id === 'n' || id === 's' ? x - 14 : x - 2.5}
          y={id === 'n' || id === 's' ? y - 2.5 : y - 14}
          width={id === 'n' || id === 's' ? 28 : 5}
          height={id === 'n' || id === 's' ? 5 : 28}
          rx={2}
        />
      ))}
      {corners.map(([id, x, y]) => (
        <path
          key={id}
          className={`crop-corner ${id}`}
          d={`M${x + (id.includes('w') ? 22 : -22)} ${y} H${x} V${y + (id.includes('n') ? 22 : -22)}`}
        />
      ))}
      {corners.map(([id, x, y]) => (
        <rect key={`${id}-hit`} className={`crop-hit ${id}`} x={x - 13} y={y - 13} width={26} height={26} onPointerDown={(e) => begin(e, id)} />
      ))}
      {/* Its size in the photo's pixels, above it (inside when it reaches the top). */}
      <text className="crop-size" x={x0 + w / 2} y={y0 > 26 ? y0 - 9 : y0 + 18}>
        {Math.round(c.width * cropFrameSize(editor.photo, c).width)} × {Math.round(c.height * cropFrameSize(editor.photo, c).height)}
      </text>
    </svg>
  )
}

/**
 * A resized box brought back to the aspect, from the corner or side that is
 * not being dragged, and kept inside the photo. `k` is width over height in
 * fractions of the photo.
 */
function keepRatio(b: Box, was: Box, handle: Handle, k: number): Box {
  // Dragging a corner: the larger change wins. A side: it sets that size.
  let width = b.width
  let height = b.height
  if (handle === 'n' || handle === 's') width = height * k
  else if (handle === 'e' || handle === 'w') height = width / k
  else if (width / height > k) height = width / k
  else width = height * k
  // Anchor on the opposite corner (or a side's centre line).
  const right = was.x + was.width
  const bottom = was.y + was.height
  let x = handle.includes('w') ? right - width : handle.includes('e') ? was.x : was.x + (was.width - width) / 2
  let y = handle.includes('n') ? bottom - height : handle.includes('s') ? was.y : was.y + (was.height - height) / 2
  // Too big for the photo: shrink to fit, keeping the anchor.
  const fit = Math.min(1, (handle.includes('w') ? right : 1 - x) / width, (handle.includes('n') ? bottom : 1 - y) / height, 1 / width, 1 / height)
  if (fit < 1) {
    const nw = width * fit
    const nh = height * fit
    if (handle.includes('w')) x = right - nw
    if (handle.includes('n')) y = bottom - nh
    width = nw
    height = nh
  }
  x = Math.min(1 - width, Math.max(0, x))
  y = Math.min(1 - height, Math.max(0, y))
  return { x, y, width, height }
}
