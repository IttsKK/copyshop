import { useEffect, useRef, useState } from 'react'
import { keyWords } from '../platform/os'
import { COLOUR_LINE_MAX, COLOUR_LINE_MIN } from '../engine/colourLine'
import type { Rect, Size } from '../engine/types'
import { toScene, toView } from './lensView'
import { capturePointer } from './pointer'
import { inTextField } from './shortcuts'

type Pt = { x: number; y: number }

export interface ColourLineEditor {
  /** The streak's colour line: its points, fractions of the frame shapes are kept in. */
  points: Pt[]
  /** `step` names the edit, so a drag is one step to undo. */
  onChange: (points: Pt[], step: string) => void
  onDone: () => void
}

interface Props {
  editor: ColourLineEditor
  /** The frame shapes are kept in, in print pixels. */
  frame: Rect
  region: Rect
  css: Size
}

/**
 * A streak's colour line on the photo (StreakShape.colourLine): where its
 * bars read their colours. Drag a point to move it; click the line to add a
 * point there, or the photo to add one at the nearer end; double-click or
 * Option-click a point, or Delete after touching it, takes it away.
 */
export function ColourLineOverlay({ editor, frame, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const [touched, setTouched] = useState<number | null>(null)
  const points = editor.points
  const sx = css.width / region.width
  const sy = css.height / region.height
  // Through the lens: where a point of the photo is seen, and back (lensView.ts).
  const toCss = (p: Pt) => {
    const v = toView({ x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: React.PointerEvent): Pt => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: (q.x - frame.x) / frame.width, y: (q.y - frame.y) / frame.height }
  }
  const set = (next: Pt[], step: string) => editor.onChange(next, step)
  const remove = (k: number) => {
    if (points.length <= COLOUR_LINE_MIN) return
    set(
      points.filter((_, j) => j !== k),
      'colourLine:remove',
    )
    setTouched(null)
  }
  const startDrag = (e: React.PointerEvent, k: number) => {
    drag.current = k
    setTouched(k)
    capturePointer(e.target, e.pointerId)
  }
  /** The photo clicked: a point at the nearer end of the line. */
  const add = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (points.length >= COLOUR_LINE_MAX) return
    const p = fromEvent(e)
    const css2 = points.map(toCss)
    const c = toCss(p)
    const toFirst = Math.hypot(c.x - css2[0].x, c.y - css2[0].y)
    const toLast = Math.hypot(c.x - css2[css2.length - 1].x, c.y - css2[css2.length - 1].y)
    if (toFirst < toLast) {
      set([p, ...points], 'colourLine:add')
      startDrag(e, 0)
    } else {
      set([...points, p], 'colourLine:add')
      startDrag(e, points.length)
    }
  }
  /** The line clicked: a point there, between the two it runs between. */
  const insert = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (points.length >= COLOUR_LINE_MAX) return
    const p = fromEvent(e)
    const at = nearestSegment(points.map(toCss), toCss(p)) + 1
    set([...points.slice(0, at), p, ...points.slice(at)], 'colourLine:insert')
    startDrag(e, at)
  }
  const grab = (e: React.PointerEvent, k: number) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.altKey) return remove(k)
    startDrag(e, k)
  }
  const onMove = (e: React.PointerEvent) => {
    const k = drag.current
    if (k === null) return
    const p = fromEvent(e)
    set(
      points.map((q, j) => (j === k ? p : q)),
      `colourLine:move${k}`,
    )
  }
  const end = () => (drag.current = null)
  // Delete or Backspace: the point last touched goes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e.target) || (e.key !== 'Delete' && e.key !== 'Backspace')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (touched !== null && touched < points.length) remove(touched)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  const css2 = points.map(toCss)
  const line = css2.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <svg ref={svg} className="repeat-overlay colour-line-overlay" width={css.width} height={css.height} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      <rect className="repeat-catch" x={0} y={0} width={css.width} height={css.height} onPointerDown={add} onDoubleClick={editor.onDone} />
      <polyline className="colour-line" points={line} />
      <polyline className="repeat-edge" points={line} onPointerDown={insert}>
        <title>Click the line to add a point there</title>
      </polyline>
      {css2.map((p, k) => (
        <g
          key={k}
          className={`repeat-point colour-line-point${touched === k ? ' touched' : ''}`}
          transform={`translate(${p.x} ${p.y})`}
          onPointerDown={(e) => grab(e, k)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            remove(k)
          }}
        >
          <circle r={6} />
          <title>{keyWords('Drag to move where the bars read their colours; double-click, Option-click or Delete to take away')}</title>
        </g>
      ))}
    </svg>
  )
}

/** Index of the segment of an open polyline nearest to a point. */
function nearestSegment(pts: Pt[], p: Pt): number {
  let best = Infinity
  let index = 0
  for (let j = 0; j < pts.length - 1; j++) {
    const a = pts[j]
    const b = pts[j + 1]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / Math.max(abx * abx + aby * aby, 1e-12)))
    const d = Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t)
    if (d < best) {
      best = d
      index = j
    }
  }
  return index
}
