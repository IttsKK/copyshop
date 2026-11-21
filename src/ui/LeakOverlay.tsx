import { useRef } from 'react'
import { MIN_OUTLINE_POINTS, samplesPerSpan, sampleOutline, type Point } from '../engine/leaks'
import type { LeakSpot, Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

export interface LeakEditor {
  spots: LeakSpot[]
  selected: number | null
  onChange: (spots: LeakSpot[]) => void
  onSelect: (index: number | null) => void
  /** A shape being drawn: its points so far, in print fractions. */
  draft?: Point[] | null
}

interface Props {
  editor: LeakEditor
  print: Size
  /** Print-space region shown by the canvas, and the canvas's CSS size. */
  region: Rect
  css: Size
}

type Drag =
  | { index: number; handle: 'centre' | 'long' | 'short'; dx: number; dy: number }
  | { index: number; handle: 'point'; point: number }
  | { index: number; handle: 'body'; startX: number; startY: number; outline: Point[] }

const isShape = (s: LeakSpot) => !!s.outline && s.outline.length >= MIN_OUTLINE_POINTS

/**
 * Handles for placing leaks and burns on the photo.
 *
 * Round spots are drawn as the ellipse where their light has mostly died away,
 * with three handles: the centre moves it, the end of the long axis turns and
 * stretches it, the side sizes it. Shapes are drawn as their outline — the
 * same curve the engine paints inside — with a handle on every control point;
 * drag inside a shape to move it, double-click its edge to add a point and a
 * point to remove it. Positions are fractions of the print, so the handles
 * work the same in the fit view and at 100%.
 */
export function LeakOverlay({ editor, print, region, css }: Props) {
  const drag = useRef<Drag | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const short = Math.min(print.width, print.height)
  const scaleX = css.width / region.width
  const scaleY = css.height / region.height
  const toCss = (px: number, py: number) => [(px - region.x) * scaleX, (py - region.y) * scaleY]
  const fracToCss = (p: Point) => toCss(p.x * print.width, p.y * print.height)
  const toPrint = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect()
    return [(clientX - r.left) / scaleX + region.x, (clientY - r.top) / scaleY + region.y]
  }
  const shapeCount = editor.spots.filter(isShape).length

  const update = (index: number, patch: Partial<LeakSpot>) =>
    editor.onChange(editor.spots.map((s, i) => (i === index ? { ...s, ...patch } : s)))

  /** The outline as drawn: sampled exactly as the engine samples it. */
  const outlinePath = (outline: Point[]) => {
    const control = outline.map((p) => ({ x: p.x * print.width, y: p.y * print.height }))
    const samples = sampleOutline(control, samplesPerSpan(control.length, Math.max(1, shapeCount)))
    return samples.map((p, i) => `${i ? 'L' : 'M'}${toCss(p.x, p.y).join(' ')}`).join(' ') + ' Z'
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const spot = editor.spots[d.index]
    const [px, py] = toPrint(e.clientX, e.clientY)
    if (d.handle === 'point' && spot.outline) {
      const outline = spot.outline.map((p, i) => (i === d.point ? { x: px / print.width, y: py / print.height } : p))
      update(d.index, { outline })
      return
    }
    if (d.handle === 'body') {
      const dx = (px - d.startX) / print.width
      const dy = (py - d.startY) / print.height
      update(d.index, { outline: d.outline.map((p) => ({ x: p.x + dx, y: p.y + dy })) })
      return
    }
    const cx = spot.x * print.width
    const cy = spot.y * print.height
    if (d.handle === 'centre') {
      update(d.index, { x: (px - d.dx) / print.width, y: (py - d.dy) / print.height })
    } else if (d.handle === 'long') {
      const len = Math.hypot(px - cx, py - cy)
      update(d.index, {
        angle: Math.round((Math.atan2(py - cy, px - cx) * 180) / Math.PI),
        stretch: Math.max(0.3, Math.min(5, len / (spot.size * short))),
      })
    } else {
      update(d.index, { size: Math.max(0.02, Math.min(2, Math.hypot(px - cx, py - cy) / short)) })
    }
  }

  const begin = (e: React.PointerEvent, next: Drag) => {
    e.stopPropagation()
    drag.current = next
    editor.onSelect(next.index)
    capturePointer(e.target, e.pointerId)
  }

  const start = (e: React.PointerEvent, index: number, handle: 'centre' | 'long' | 'short') => {
    const spot = editor.spots[index]
    const [px, py] = toPrint(e.clientX, e.clientY)
    begin(e, { index, handle, dx: px - spot.x * print.width, dy: py - spot.y * print.height })
  }

  /** Insert a control point on the control-polygon edge nearest the click. */
  const insertPoint = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    const outline = editor.spots[index].outline
    if (!outline) return
    const [px, py] = toPrint(e.clientX, e.clientY)
    const q = { x: px / print.width, y: py / print.height }
    let best = 0
    let bestDist = Infinity
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length]
      const abx = (b.x - a.x) * print.width
      const aby = (b.y - a.y) * print.height
      const t = Math.max(
        0,
        Math.min(
          1,
          ((q.x - a.x) * print.width * abx + (q.y - a.y) * print.height * aby) / (abx * abx + aby * aby || 1),
        ),
      )
      const dist = Math.hypot((a.x - q.x) * print.width + abx * t, (a.y - q.y) * print.height + aby * t)
      if (dist < bestDist) {
        bestDist = dist
        best = i
      }
    })
    update(index, { outline: [...outline.slice(0, best + 1), q, ...outline.slice(best + 1)] })
  }

  const draft = editor.draft ?? []
  // The selected spot is drawn last, so its outline and handles sit above any
  // spot overlapping it and can always be grabbed; the rest keep their order.
  // Lights are shaped by their masks, edited with the masks: nothing here.
  const drawOrder = editor.spots
    .map((_, i) => i)
    .filter((i) => i !== editor.selected)
    .concat(editor.selected !== null && editor.selected < editor.spots.length ? [editor.selected] : [])
    // Shapes have the shape editor (the one masks and streaks use).
    .filter((i) => !editor.spots[i].mask && !isShape(editor.spots[i]))

  return (
    <svg
      ref={svg}
      className="leak-overlay"
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {drawOrder.map((i) => {
        const spot = editor.spots[i]
        const on = editor.selected === i
        if (isShape(spot)) {
          const outline = spot.outline!
          return (
            <g key={i} className={`leak-spot shape ${spot.kind} ${on ? 'on' : ''}`}>
              <path
                className="shape-body"
                d={outlinePath(outline)}
                onPointerDown={(e) => {
                  const [px, py] = toPrint(e.clientX, e.clientY)
                  begin(e, { index: i, handle: 'body', startX: px, startY: py, outline })
                }}
                onDoubleClick={(e) => insertPoint(e, i)}
              >
                <title>
                  {spot.kind === 'burn' ? 'Burn' : 'Leak'} shape — drag to move, double-click the edge to add a point
                </title>
              </path>
              {on &&
                outline.map((p, k) => {
                  const [x, y] = fracToCss(p)
                  return (
                    <circle
                      key={k}
                      className="handle"
                      cx={x}
                      cy={y}
                      r={5}
                      onPointerDown={(e) => begin(e, { index: i, handle: 'point', point: k })}
                      onDoubleClick={(e) => {
                        e.stopPropagation()
                        if (outline.length > MIN_OUTLINE_POINTS)
                          update(i, { outline: outline.filter((_, j) => j !== k) })
                      }}
                    >
                      <title>Drag to reshape · double-click to remove</title>
                    </circle>
                  )
                })}
            </g>
          )
        }
        const [cx, cy] = toCss(spot.x * print.width, spot.y * print.height)
        const rx = spot.size * spot.stretch * short * scaleX
        const ry = spot.size * short * scaleY
        const a = (spot.angle * Math.PI) / 180
        const longEnd = [cx + Math.cos(a) * rx, cy + Math.sin(a) * rx]
        const shortEnd = [cx - Math.sin(a) * ry, cy + Math.cos(a) * ry]
        return (
          <g key={i} className={`leak-spot ${spot.kind} ${on ? 'on' : ''}`}>
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={`rotate(${spot.angle} ${cx} ${cy})`} />
            {on && (
              <>
                <line x1={cx} y1={cy} x2={longEnd[0]} y2={longEnd[1]} />
                <circle
                  className="handle"
                  cx={longEnd[0]}
                  cy={longEnd[1]}
                  r={6}
                  onPointerDown={(e) => start(e, i, 'long')}
                >
                  <title>Drag to turn and stretch</title>
                </circle>
                <circle
                  className="handle"
                  cx={shortEnd[0]}
                  cy={shortEnd[1]}
                  r={6}
                  onPointerDown={(e) => start(e, i, 'short')}
                >
                  <title>Drag to resize</title>
                </circle>
              </>
            )}
            <circle className="handle centre" cx={cx} cy={cy} r={8} onPointerDown={(e) => start(e, i, 'centre')}>
              <title>{spot.kind === 'burn' ? 'Burn' : 'Light leak'} — drag to move</title>
            </circle>
          </g>
        )
      })}
      {draft.length > 0 && (
        <g className="leak-draft">
          {draft.length >= MIN_OUTLINE_POINTS && <path d={outlinePath(draft)} />}
          <polyline points={draft.map((p) => fracToCss(p).join(',')).join(' ')} />
          {draft.map((p, k) => {
            const [x, y] = fracToCss(p)
            return <circle key={k} cx={x} cy={y} r={4} />
          })}
        </g>
      )}
    </svg>
  )
}
