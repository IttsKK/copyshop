import { useRef, useState } from 'react'
import { toScene, toView } from './lensView'
import { DEFAULT_GRADIENT, maskKind, radialFrom } from '../engine/maskShapes'
import type { GradientMask, MaskShape, RadialMask, Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

export interface ShapeMaskEditor {
  masks: MaskShape[]
  /** Which of `masks` to show: every radial and gradient one, or one alone. */
  shown: number[]
  selected: number | null
  onSelect: (index: number | null) => void
  onChange: (index: number, patch: Partial<MaskShape>, step: string) => void
  /** A new one being placed: drag on the photo to make it. */
  placing: 'radial' | 'gradient' | null
  onPlace: (kind: 'radial' | 'gradient', shape: { radial?: RadialMask; gradient?: GradientMask }) => void
}

interface Props {
  editor: ShapeMaskEditor
  /** Where masks are measured, in print pixels (see shapeFrame). */
  frame: Rect
  region: Rect
  css: Size
}

type Point = { x: number; y: number }

/**
 * The resize cursor nearest a direction on screen, so a handle shows which
 * way it drags rather than the photo's own pan hand.
 */
function sizeCursor(dx: number, dy: number): string {
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 180) % 180
  return a < 22.5 || a >= 157.5 ? 'ew-resize' : a < 67.5 ? 'nwse-resize' : a < 112.5 ? 'ns-resize' : 'nesw-resize'
}
type Drag =
  | { kind: 'radial'; index: number; handle: 'centre' | 'long' | 'short' | 'soft'; dx: number; dy: number }
  | { kind: 'gradient'; index: number; handle: 'start' | 'end' | 'body'; from: Point; was: GradientMask }
  | { kind: 'place'; from: Point; to: Point }

/**
 * Radial and gradient masks on the photo, edited as the leak spots are.
 *
 * A radial is drawn as its edge, with a dashed ring where it is still at
 * full strength. Drag its middle to move it, the handle on its long axis to
 * turn and stretch it, the one on its side to size it across, and the one on
 * the dashed ring to soften or harden it.
 *
 * A gradient is drawn as the fade itself, an arrow from where it is full to
 * where it has gone, and a line across each end. Drag either end to turn and
 * lengthen it, the middle to move it.
 *
 * Placing a new one: press where it starts (a radial's middle, a gradient's
 * full end) and drag out to its edge or end.
 */
export function ShapeMaskOverlay({ editor, frame, region, css }: Props) {
  const drag = useRef<Drag | null>(null)
  const [placing, setPlacing] = useState<{ from: Point; to: Point } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const scaleX = css.width / region.width
  const scaleY = css.height / region.height
  const short = Math.min(frame.width, frame.height)
  // Frame fractions to the overlay's pixels, and back.
  // Through the lens: where a point of the photo is seen, and back (lensView.ts).
  const toCss = (p: Point): [number, number] => {
    const v = toView({ x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height })
    return [(v.x - region.x) * scaleX, (v.y - region.y) * scaleY]
  }
  const fromEvent = (e: React.PointerEvent): Point => {
    const r = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - r.left) / scaleX + region.x, y: (e.clientY - r.top) / scaleY + region.y })
    return { x: (q.x - frame.x) / frame.width, y: (q.y - frame.y) / frame.height }
  }
  /** A length along the photo, in pixels of the frame. */
  const px = (a: Point, b: Point) => Math.hypot((b.x - a.x) * frame.width, (b.y - a.y) * frame.height)

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation()
    e.preventDefault()
    drag.current = d
    if (d.kind !== 'place') editor.onSelect(d.index)
    capturePointer(e.target, e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = fromEvent(e)
    if (d.kind === 'place') {
      d.to = p
      setPlacing({ from: d.from, to: p })
      return
    }
    const m = editor.masks[d.index]
    if (d.kind === 'radial' && m.radial) {
      const r = m.radial
      const c = { x: r.x, y: r.y }
      const dist = px(c, p) / short
      const ang = (Math.atan2((p.y - c.y) * frame.height, (p.x - c.x) * frame.width) * 180) / Math.PI
      const next: RadialMask =
        d.handle === 'centre'
          ? { ...r, x: p.x - d.dx, y: p.y - d.dy }
          : d.handle === 'long'
            ? { ...r, angle: Math.round(ang), rx: Math.max(0.02, dist) }
            : d.handle === 'short'
              ? { ...r, ry: Math.max(0.02, dist) }
              : { ...r, soft: Math.min(1, Math.max(0, 1 - dist / r.rx)) }
      editor.onChange(d.index, { radial: next }, `mask${d.index}:${d.handle}`)
      return
    }
    if (d.kind === 'gradient' && m.gradient) {
      const g = d.was
      const ox = p.x - d.from.x
      const oy = p.y - d.from.y
      const next: GradientMask =
        d.handle === 'start'
          ? { ...g, x0: g.x0 + ox, y0: g.y0 + oy }
          : d.handle === 'end'
            ? { ...g, x1: g.x1 + ox, y1: g.y1 + oy }
            : { x0: g.x0 + ox, y0: g.y0 + oy, x1: g.x1 + ox, y1: g.y1 + oy }
      editor.onChange(d.index, { gradient: next }, `mask${d.index}:${d.handle}`)
    }
  }

  const onUp = () => {
    const d = drag.current
    drag.current = null
    if (d?.kind !== 'place' || !editor.placing) return
    setPlacing(null)
    const fw = { width: frame.width, height: frame.height }
    if (editor.placing === 'radial') {
      // A click without a drag makes one of a sensible size.
      const edge = px(d.from, d.to) < 8 ? { x: d.from.x + (0.25 * short) / frame.width, y: d.from.y } : d.to
      editor.onPlace('radial', { radial: radialFrom(d.from, edge, fw) })
    } else {
      const len = DEFAULT_GRADIENT.y1 - DEFAULT_GRADIENT.y0
      const to = px(d.from, d.to) < 8 ? { x: d.from.x, y: d.from.y + len } : d.to
      editor.onPlace('gradient', { gradient: { x0: d.from.x, y0: d.from.y, x1: to.x, y1: to.y } })
    }
  }

  const frameCss = { x: (frame.x - region.x) * scaleX, y: (frame.y - region.y) * scaleY, w: frame.width * scaleX, h: frame.height * scaleY }

  const radial = (i: number, r: RadialMask, on: boolean, ghost = false) => {
    const [cx, cy] = toCss({ x: r.x, y: r.y })
    const rx = r.rx * short * scaleX
    const ry = r.ry * short * scaleY
    const a = (r.angle * Math.PI) / 180
    const inner = Math.max(0, 1 - r.soft)
    const longEnd = [cx + Math.cos(a) * rx, cy + Math.sin(a) * rx]
    const shortEnd = [cx - Math.sin(a) * ry, cy + Math.cos(a) * ry]
    const softAt = [cx + Math.cos(a) * rx * inner, cy + Math.sin(a) * rx * inner]
    const id = `rg${i}`
    return (
      <g key={`r${i}`} className={`shape-mask radial${on ? ' on' : ''}${ghost ? ' ghost' : ''}`}>
        <defs>
          <radialGradient id={id}>
            <stop offset={`${inner * 100}%`} style={{ stopColor: '#7fd3ff', stopOpacity: 0.4 }} />
            <stop offset="100%" style={{ stopColor: '#7fd3ff', stopOpacity: 0 }} />
          </radialGradient>
        </defs>
        <ellipse
          className="shape-mask-body"
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          style={{ fill: on ? `url(#${id})` : 'transparent' }}
          transform={`rotate(${r.angle} ${cx} ${cy})`}
          onPointerDown={ghost ? undefined : (e) => begin(e, { kind: 'radial', index: i, handle: 'centre', dx: fromEvent(e).x - r.x, dy: fromEvent(e).y - r.y })}
        />
        {on && (
          <>
            <ellipse className="shape-mask-inner" cx={cx} cy={cy} rx={rx * inner} ry={ry * inner} transform={`rotate(${r.angle} ${cx} ${cy})`} />
            <line className="shape-mask-axis" x1={cx} y1={cy} x2={longEnd[0]} y2={longEnd[1]} />
            <circle className="handle" style={{ cursor: sizeCursor(longEnd[0] - cx, longEnd[1] - cy) }} cx={longEnd[0]} cy={longEnd[1]} r={6} onPointerDown={(e) => begin(e, { kind: 'radial', index: i, handle: 'long', dx: 0, dy: 0 })}>
              <title>Drag to turn and stretch</title>
            </circle>
            <circle className="handle" style={{ cursor: sizeCursor(shortEnd[0] - cx, shortEnd[1] - cy) }} cx={shortEnd[0]} cy={shortEnd[1]} r={6} onPointerDown={(e) => begin(e, { kind: 'radial', index: i, handle: 'short', dx: 0, dy: 0 })}>
              <title>Drag to size it across</title>
            </circle>
            <circle className="handle soft" style={{ cursor: sizeCursor(longEnd[0] - cx, longEnd[1] - cy) }} cx={softAt[0]} cy={softAt[1]} r={5} onPointerDown={(e) => begin(e, { kind: 'radial', index: i, handle: 'soft', dx: 0, dy: 0 })}>
              <title>Drag in for a softer edge, out for a harder one</title>
            </circle>
            <circle
              className="handle centre"
              cx={cx}
              cy={cy}
              r={7}
              onPointerDown={(e) => begin(e, { kind: 'radial', index: i, handle: 'centre', dx: fromEvent(e).x - r.x, dy: fromEvent(e).y - r.y })}
            >
              <title>Drag to move</title>
            </circle>
          </>
        )}
      </g>
    )
  }

  const gradient = (i: number, g: GradientMask, on: boolean, ghost = false) => {
    const [x0, y0] = toCss({ x: g.x0, y: g.y0 })
    const [x1, y1] = toCss({ x: g.x1, y: g.y1 })
    const len = Math.hypot(x1 - x0, y1 - y0) || 1
    const ux = (x1 - x0) / len
    const uy = (y1 - y0) / len
    // Lines across each end, long enough to cross the photo.
    const reach = Math.hypot(frameCss.w, frameCss.h)
    const across = (x: number, y: number) => `M${x - uy * reach} ${y + ux * reach} L${x + uy * reach} ${y - ux * reach}`
    const head = 11
    const tip = [x1, y1]
    const wing = (s: number) => [x1 - ux * head + -uy * head * 0.55 * s, y1 - uy * head + ux * head * 0.55 * s]
    const id = `lg${i}`
    const mid = [(x0 + x1) / 2, (y0 + y1) / 2]
    const along = sizeCursor(ux, uy)
    const startDrag = (handle: 'start' | 'end' | 'body') => (e: React.PointerEvent) =>
      begin(e, { kind: 'gradient', index: i, handle, from: fromEvent(e), was: { ...g } })
    return (
      <g key={`g${i}`} className={`shape-mask gradient${on ? ' on' : ''}${ghost ? ' ghost' : ''}`}>
        <defs>
          <linearGradient id={id} gradientUnits="userSpaceOnUse" x1={x0} y1={y0} x2={x1} y2={y1}>
            <stop offset="0%" style={{ stopColor: '#7fd3ff', stopOpacity: 0.5 }} />
            <stop offset="100%" style={{ stopColor: '#7fd3ff', stopOpacity: 0 }} />
          </linearGradient>
          <clipPath id={`${id}c`}>
            <rect x={frameCss.x} y={frameCss.y} width={frameCss.w} height={frameCss.h} />
          </clipPath>
        </defs>
        <g clipPath={`url(#${id}c)`}>
          {on && <rect x={frameCss.x} y={frameCss.y} width={frameCss.w} height={frameCss.h} fill={`url(#${id})`} style={{ pointerEvents: 'none' }} />}
          <path className="shape-mask-edge" d={across(x0, y0)} />
          <path className="shape-mask-edge end" d={across(x1, y1)} />
          {on && (
            <>
              {/* The lines across each end take a drag too, wide enough to find. */}
              <path className="shape-mask-edge-hit" style={{ cursor: along }} d={across(x0, y0)} onPointerDown={startDrag('start')}>
                <title>Where it is full: drag to move this end</title>
              </path>
              <path className="shape-mask-edge-hit" style={{ cursor: along }} d={across(x1, y1)} onPointerDown={startDrag('end')}>
                <title>Where it has faded away: drag to turn and lengthen</title>
              </path>
            </>
          )}
        </g>
        <line className="shape-mask-arrow" x1={x0} y1={y0} x2={x1 - ux * head * 0.6} y2={y1 - uy * head * 0.6} onPointerDown={ghost ? undefined : startDrag('body')} />
        <path className="shape-mask-arrowhead" d={`M${tip[0]} ${tip[1]} L${wing(1).join(' ')} L${wing(-1).join(' ')} Z`} />
        {on && (
          <>
            <circle className="handle" style={{ cursor: along }} cx={x0} cy={y0} r={7} onPointerDown={startDrag('start')}>
              <title>Where it is full: drag to move this end</title>
            </circle>
            <circle className="handle" style={{ cursor: along }} cx={x1} cy={y1} r={7} onPointerDown={startDrag('end')}>
              <title>Where it has faded away: drag to turn and lengthen</title>
            </circle>
            <rect className="handle centre" x={mid[0] - 6} y={mid[1] - 6} width={12} height={12} rx={3} onPointerDown={startDrag('body')}>
              <title>Drag to move the whole gradient</title>
            </rect>
          </>
        )}
        {!on && !ghost && <circle className="handle centre faint" cx={mid[0]} cy={mid[1]} r={6} onPointerDown={startDrag('body')} />}
      </g>
    )
  }

  // The selected one last, so its handles sit on top.
  const order = editor.shown.filter((i) => i !== editor.selected).concat(editor.selected !== null && editor.shown.includes(editor.selected) ? [editor.selected] : [])
  const draft = placing
    ? editor.placing === 'radial'
      ? radial(-1, radialFrom(placing.from, placing.to, frame), true, true)
      : gradient(-1, { x0: placing.from.x, y0: placing.from.y, x1: placing.to.x, y1: placing.to.y }, true, true)
    : null

  return (
    <svg
      ref={svg}
      className={`shape-mask-overlay${editor.placing ? ' placing' : ''}`}
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null
        setPlacing(null)
      }}
    >
      {editor.placing && (
        <rect
          className="shape-mask-catch"
          x={0}
          y={0}
          width={css.width}
          height={css.height}
          onPointerDown={(e) => {
            const p = fromEvent(e)
            setPlacing({ from: p, to: p })
            begin(e, { kind: 'place', from: p, to: p })
          }}
        />
      )}
      {order.map((i) => {
        const m = editor.masks[i]
        const on = editor.selected === i && !editor.placing
        const kind = maskKind(m)
        if (kind === 'radial') return radial(i, m.radial!, on)
        if (kind === 'gradient') return gradient(i, m.gradient!, on)
        return null
      })}
      {draft}
    </svg>
  )
}
