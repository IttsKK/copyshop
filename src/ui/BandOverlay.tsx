import { useRef } from 'react'
import type { Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

type Point = { x: number; y: number }

export interface BandEditor {
  from: Point
  to: Point
  /** Number of bands, for the guide lines. */
  steps: number
  shape: 'line' | 'oval'
  /** Oval width across its axis, relative to its reach. */
  stretch: number
  onChange: (from: Point, to: Point) => void
  onStretch: (stretch: number) => void
}

interface Props {
  editor: BandEditor
  print: Size
  /** Print-space region shown by the canvas, and the canvas's CSS size. */
  region: Rect
  css: Size
}

/**
 * The line the dither bands run along, drawn on the photo like a linear
 * gradient tool: drag the start handle where the banding begins and the end
 * handle where it should stop; drag the line itself to move both. Guide lines
 * across it mark where each band falls. Points are fractions of the print, so
 * they hold at any zoom and in the export.
 */
export function BandOverlay({ editor, print, region, css }: Props) {
  const drag = useRef<{ which: 'from' | 'to' | 'both' | 'stretch'; start: Point; from: Point; to: Point } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const sx = css.width / region.width
  const sy = css.height / region.height
  const toCss = (p: Point) => [(p.x * print.width - region.x) * sx, (p.y * print.height - region.y) * sy]
  const toFrac = (clientX: number, clientY: number): Point => {
    const r = svg.current!.getBoundingClientRect()
    return {
      x: ((clientX - r.left) / sx + region.x) / print.width,
      y: ((clientY - r.top) / sy + region.y) / print.height,
    }
  }

  const begin = (e: React.PointerEvent, which: 'from' | 'to' | 'both' | 'stretch') => {
    e.stopPropagation()
    drag.current = { which, start: toFrac(e.clientX, e.clientY), from: editor.from, to: editor.to }
    capturePointer(e.target, e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const p = toFrac(e.clientX, e.clientY)
    if (d.which === 'stretch') {
      // Distance from the centre, across the axis, over the reach.
      const [cx, cy] = toCss(editor.from)
      const [ex, ey] = toCss(editor.to)
      const [qx, qy] = toCss(p)
      const reach = Math.hypot(ex - cx, ey - cy) || 1
      const across = Math.abs(((qx - cx) * -(ey - cy) + (qy - cy) * (ex - cx)) / reach)
      editor.onStretch(Math.min(5, Math.max(0.2, across / reach)))
      return
    }
    if (d.which === 'from') editor.onChange(p, d.to)
    else if (d.which === 'to') editor.onChange(d.from, p)
    else {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      editor.onChange({ x: d.from.x + dx, y: d.from.y + dy }, { x: d.to.x + dx, y: d.to.y + dy })
    }
  }

  const [ax, ay] = toCss(editor.from)
  const [bx, by] = toCss(editor.to)
  const len = Math.hypot(bx - ax, by - ay) || 1
  // Perpendicular, long enough to cross the view, for the band guides.
  const px = (-(by - ay) / len) * (css.width + css.height)
  const py = ((bx - ax) / len) * (css.width + css.height)
  const levels = Math.max(1, editor.steps - 1)
  const guides = Array.from({ length: levels }, (_, i) => (i + 0.5) / levels)
  const oval = editor.shape === 'oval'
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI
  // The stretch handle sits on the oval's edge, straight across from the centre.
  const sxh = ax + (-(by - ay) / len) * len * editor.stretch
  const syh = ay + ((bx - ax) / len) * len * editor.stretch

  return (
    <svg
      ref={svg}
      className="band-overlay"
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      <defs>
        <clipPath id="band-clip">
          <rect width={css.width} height={css.height} />
        </clipPath>
      </defs>
      <g clipPath="url(#band-clip)">
        {oval
          ? [...guides, 1].map((t) => (
              <ellipse
                key={t}
                className={t === 1 ? 'band-guide edge' : 'band-guide'}
                cx={ax}
                cy={ay}
                rx={len * t}
                ry={len * editor.stretch * t}
                transform={`rotate(${angle} ${ax} ${ay})`}
              />
            ))
          : guides.map((t) => {
              const cx = ax + (bx - ax) * t
              const cy = ay + (by - ay) * t
              return <line key={t} className="band-guide" x1={cx - px} y1={cy - py} x2={cx + px} y2={cy + py} />
            })}
      </g>
      <line className="band-axis" x1={ax} y1={ay} x2={bx} y2={by} onPointerDown={(e) => begin(e, 'both')}>
        <title>Drag to move the band line</title>
      </line>
      {oval && (
        <circle className="band-handle" cx={sxh} cy={syh} r={6} onPointerDown={(e) => begin(e, 'stretch')}>
          <title>Drag to make the oval wider or narrower</title>
        </circle>
      )}
      <circle className="band-handle start" cx={ax} cy={ay} r={8} onPointerDown={(e) => begin(e, 'from')}>
        <title>{oval ? 'The centre of the rings' : 'Where the banding starts'}</title>
      </circle>
      <circle className="band-handle end" cx={bx} cy={by} r={8} onPointerDown={(e) => begin(e, 'to')}>
        <title>Where the banding stops</title>
      </circle>
    </svg>
  )
}
