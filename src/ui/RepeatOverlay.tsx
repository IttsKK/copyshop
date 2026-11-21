import { keyWords } from '../platform/os'
import { useEffect, useRef, useState } from 'react'
import { inTextField } from './shortcuts'
import { toScene, toView } from './lensView'
import type { RepeatParams, RepeatPoint } from '../engine/repeatParams'
import { pieceIndexOnPath, smoothPath, straightPath } from '../engine/repeat'
import type { Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

export interface RepeatEditor {
  repeat: RepeatParams
  /** Where the piece is (pieceCentreOf): on the path when it starts or runs through there (RepeatParams.pieceOnPath). */
  start?: RepeatPoint | null
  /** The box round the piece (pieceBoxOf): a grid in perspective draws its lines from its corners. */
  box?: { x: number; y: number; width: number; height: number } | null
  /** `step` names the edit, so a drag is one step to undo. */
  onChange: (patch: Partial<RepeatParams>, step: string) => void
  onDone: () => void
}

interface Props {
  editor: RepeatEditor
  /** The frame masks (and Repeat's points) are kept in, in print pixels. */
  frame: Rect
  region: Rect
  css: Size
}

/**
 * Repeat's points on the photo, edited as a streak's path is. Path: click
 * the photo to add a point at its end, click the line to add one there, drag
 * a point to move it; double-click or Option-click one, or Delete after
 * touching it, takes it away. With the piece on the path, the line runs
 * from the piece (marked, not movable) through the points, or through it
 * where it fits best among them. Placed: click to put a
 * copy there; the same to move and take away.
 */
export function RepeatOverlay(props: Props) {
  return props.editor.repeat.layout === 'grid' ? <RepeatPerspective {...props} /> : <RepeatPoints {...props} />
}

/**
 * A grid in perspective (RepeatParams.vanish): two lines from the piece's
 * corners on its far side from the point, out to where they meet. Drag a
 * line onto one of the subject's own edges (a building's side): the point
 * moves to where it meets the other, so the copies follow the subject's
 * lines, however far off the photo the point is.
 */
function RepeatPerspective({ editor, frame, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const r = editor.repeat
  const box = editor.box
  const V = r.vanish
  const sx = css.width / region.width
  const sy = css.height / region.height
  // In frame pixels, so lines meet as they do on the photo.
  const px = (p: RepeatPoint) => ({ x: p.x * frame.width, y: p.y * frame.height })
  const toCss = (p: { x: number; y: number }) => {
    const v = toView({ x: frame.x + p.x, y: frame.y + p.y })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: q.x - frame.x, y: q.y - frame.y }
  }
  if (!box || !V) return null
  const v = px(V)
  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ].map(px)
  // The two corners furthest from the point, one each side of the line to it.
  const c = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }
  const ux = v.x - c.x
  const uy = v.y - c.y
  const side = (p: { x: number; y: number }) => (p.x - c.x) * -uy + (p.y - c.y) * ux
  const along = (p: { x: number; y: number }) => (p.x - c.x) * ux + (p.y - c.y) * uy
  const left = corners.filter((p) => side(p) < 0).sort((a, b) => along(a) - along(b))[0] ?? corners[0]
  const right = corners.filter((p) => side(p) >= 0).sort((a, b) => along(a) - along(b))[0] ?? corners[2]
  const anchors = [left, right]
  const onMove = (e: React.PointerEvent) => {
    const k = drag.current
    if (k === null) return
    const p = fromEvent(e)
    const a = anchors[k]
    const o = anchors[1 - k]
    // The dragged line through its corner and the pointer; the other through its corner and the point.
    const d1 = { x: p.x - a.x, y: p.y - a.y }
    const d2 = { x: v.x - o.x, y: v.y - o.y }
    const den = d1.x * d2.y - d1.y * d2.x
    if (Math.abs(den) < 1e-6) return
    const t = ((o.x - a.x) * d2.y - (o.y - a.y) * d2.x) / den
    // Ahead of the corners, on the side the copies go.
    if (t <= 0.2) return
    const m = { x: a.x + d1.x * t, y: a.y + d1.y * t }
    editor.onChange({ vanish: { x: m.x / frame.width, y: m.y / frame.height } }, 'repeat:vanish')
  }
  const end = () => (drag.current = null)
  // Each line drawn from its corner well past the photo toward the point.
  const lineTo = (a: { x: number; y: number }) => {
    const A = toCss(a)
    const B = toCss(v)
    return `M${A.x} ${A.y} L${B.x} ${B.y}`
  }
  return (
    <svg ref={svg} className="repeat-overlay" width={css.width} height={css.height} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      {anchors.map((a, k) => (
        <g key={k} className="repeat-vanish">
          <path className="repeat-vanish-line" d={lineTo(a)} />
          <path
            className="repeat-vanish-grab"
            d={lineTo(a)}
            onPointerDown={(e) => {
              e.stopPropagation()
              e.preventDefault()
              drag.current = k
              capturePointer(e.target, e.pointerId)
            }}
          >
            <title>Drag onto one of the subject's own edges: the copies follow its lines</title>
          </path>
        </g>
      ))}
    </svg>
  )
}

function RepeatPoints({ editor, frame, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<{ index: number } | null>(null)
  // The point last touched, for Delete.
  const [touched, setTouched] = useState<number | null>(null)
  const r = editor.repeat
  const placing = r.layout === 'placed'
  const points = placing ? r.placed : r.path
  const key: 'placed' | 'path' = placing ? 'placed' : 'path'
  const start = !placing && r.pieceOnPath !== 'off' && editor.start ? editor.start : null
  // Where the piece goes among the points (as repeatCopies puts it), measured in the frame's pixels.
  const px = (p: RepeatPoint) => ({ x: p.x * frame.width, y: p.y * frame.height })
  const pieceAt = !start ? -1 : r.pieceOnPath === 'middle' ? pieceIndexOnPath(points.map(px), px(start)) : 0
  /** The path's points with the piece among them. */
  const withPiece = <T,>(pts: T[], piece: T) => (pieceAt < 0 ? pts : [...pts.slice(0, pieceAt), piece, ...pts.slice(pieceAt)])
  /** The point on the line before point `index` (the piece, if it is there). */
  const before = (index: number) => (pieceAt === index && start ? start : index > 0 ? points[index - 1] : null)
  const sx = css.width / region.width
  const sy = css.height / region.height
  // Through the lens: where a point of the photo is seen, and back (lensView.ts).
  const toCss = (p: RepeatPoint) => {
    const v = toView({ x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: React.PointerEvent): RepeatPoint => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: (q.x - frame.x) / frame.width, y: (q.y - frame.y) / frame.height }
  }
  const set = (next: RepeatPoint[], step: string) => editor.onChange({ [key]: next } as Partial<RepeatParams>, step)
  // Shift: the line from the point before kept to a straight direction, in steps of 15°.
  const snapFrom = (prev: RepeatPoint | null | undefined, p: RepeatPoint, e: React.PointerEvent): RepeatPoint => {
    if (!e.shiftKey || !prev || placing) return p
    const dx = (p.x - prev.x) * frame.width
    const dy = (p.y - prev.y) * frame.height
    const len = Math.hypot(dx, dy)
    const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12)
    return { x: prev.x + (Math.cos(a) * len) / frame.width, y: prev.y + (Math.sin(a) * len) / frame.height }
  }
  const remove = (index: number) => {
    set(
      points.filter((_, i) => i !== index),
      `repeat:${key}:remove`,
    )
    setTouched(null)
  }

  const add = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const p = snapFrom(pieceAt === points.length && start ? start : points.length ? points[points.length - 1] : start, fromEvent(e), e)
    set([...points, p], `repeat:${key}:add`)
    drag.current = { index: points.length }
    setTouched(points.length)
    capturePointer(e.target, e.pointerId)
  }
  /** A point added where the line was clicked, between the two it runs between. */
  const insert = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const p = fromEvent(e)
    const control = start ? withPiece(points, start) : points
    const at = nearestSegment(control.map(px), px(p))
    // Its place among the points: after the segment's start, less one if the piece is before it.
    const index = at + 1 - (pieceAt >= 0 && pieceAt <= at ? 1 : 0)
    set([...points.slice(0, index), p, ...points.slice(index)], `repeat:${key}:insert`)
    drag.current = { index }
    setTouched(index)
    capturePointer(e.target, e.pointerId)
  }
  const grab = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    e.preventDefault()
    if (e.altKey) {
      remove(index)
      return
    }
    drag.current = { index }
    setTouched(index)
    capturePointer(e.target, e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = snapFrom(before(d.index), fromEvent(e), e)
    set(
      points.map((q, i) => (i === d.index ? p : q)),
      `repeat:${key}:move${d.index}`,
    )
  }
  const end = () => (drag.current = null)

  // Delete or Backspace: the point last touched goes. With none touched, the
  // key stops here: while the path is being edited it never removes the piece.
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
  const startCss = start ? toCss(start) : null
  const control = startCss ? withPiece(css2, startCss) : css2
  const line = !placing && control.length >= 2 ? (r.straight ? straightPath(control) : smoothPath(control)) : []
  const linePoints = line.map((p) => `${p.x},${p.y}`).join(' ')
  return (
    <svg ref={svg} className="repeat-overlay" width={css.width} height={css.height} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      <rect className="repeat-catch" x={0} y={0} width={css.width} height={css.height} onPointerDown={add} onDoubleClick={editor.onDone} />
      {line.length > 1 && <polyline className="repeat-path" points={linePoints} />}
      {line.length > 1 && (
        <polyline className="repeat-edge" points={linePoints} onPointerDown={insert}>
          <title>Click the path to add a point there</title>
        </polyline>
      )}
      {startCss && (
        <g className="repeat-start" transform={`translate(${startCss.x} ${startCss.y})`}>
          <rect x={-6} y={-6} width={12} height={12} transform="rotate(45)" />
          <title>{r.pieceOnPath === 'middle' ? 'The original: the path runs through it' : 'The original: the path starts here'}</title>
        </g>
      )}
      {css2.map((p, i) => (
        <g
          key={i}
          className={`repeat-point${!placing && i === 0 && !start ? ' first' : ''}${touched === i ? ' touched' : ''}`}
          transform={`translate(${p.x} ${p.y})`}
          onPointerDown={(e) => grab(e, i)}
          onDoubleClick={(e) => {
            e.stopPropagation()
            remove(i)
          }}
        >
          <circle r={placing ? 9 : 6} />
          {placing && <text dy="3.5">{i + 1}</text>}
          <title>{keyWords("Drag to move; double-click, Option-click or Delete to take away")}</title>
        </g>
      ))}
    </svg>
  )
}

/** Index of the segment of an open polyline nearest to a point. */
function nearestSegment(pts: { x: number; y: number }[], p: { x: number; y: number }): number {
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
