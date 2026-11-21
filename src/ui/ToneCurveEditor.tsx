import { useRef, useState } from 'react'
import { evaluateToneCurve, type ToneCurvePoint } from '../engine/base'
import { capturePointer } from './pointer'

interface Props {
  curve: ToneCurvePoint[]
  onChange: (curve: ToneCurvePoint[]) => void
  /** The photo's brightness, drawn faintly behind. */
  histogram: number[] | null
}

const W = 240
const H = 160
const MAX_POINTS = 8

/**
 * One brightness curve: drag a point, click the line to add one,
 * double-click a point to take it away. The two ends stay, and can be moved
 * up and down (a matte black, a softer white).
 */
export function ToneCurveEditor({ curve, onChange, histogram }: Props) {
  const box = useRef<SVGSVGElement>(null)
  const drag = useRef<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const pts = [...curve].sort((a, b) => a.x - b.x)

  const at = (e: React.PointerEvent) => {
    const r = box.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) }
  }
  const nearest = (p: { x: number; y: number }) => {
    let best = -1
    let d = 0.06
    pts.forEach((q, i) => {
      const dist = Math.hypot(q.x - p.x, (q.y - p.y) * (H / W))
      if (dist < d) {
        d = dist
        best = i
      }
    })
    return best
  }
  const move = (i: number, p: { x: number; y: number }) => {
    const next = pts.map((q) => ({ ...q }))
    const lo = i === 0 ? 0 : next[i - 1].x + 0.02
    const hi = i === next.length - 1 ? 1 : next[i + 1].x - 0.02
    // The ends keep their place across, and move only up and down.
    next[i] = { x: i === 0 ? 0 : i === next.length - 1 ? 1 : Math.min(hi, Math.max(lo, p.x)), y: p.y }
    onChange(next)
  }

  const path = Array.from({ length: 65 }, (_, k) => {
    const x = k / 64
    return `${k ? 'L' : 'M'}${(x * W).toFixed(1)},${((1 - evaluateToneCurve(pts, x)) * H).toFixed(1)}`
  }).join(' ')
  const hist = histogram?.length
    ? `M0,${H} ` +
      histogram.map((v, i) => `L${((i / (histogram.length - 1)) * W).toFixed(1)},${(H - Math.min(1, v) * H * 0.8).toFixed(1)}`).join(' ') +
      ` L${W},${H} Z`
    : null

  return (
    <svg
      ref={box}
      className="tone-curve"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Brightness curve"
      onPointerDown={(e) => {
        const p = at(e)
        let i = nearest(p)
        if (i < 0) {
          if (pts.length >= MAX_POINTS) return
          const next = [...pts, p].sort((a, b) => a.x - b.x)
          i = next.indexOf(p)
          onChange(next)
        }
        drag.current = i
        capturePointer(e.currentTarget, e.pointerId)
      }}
      onPointerMove={(e) => {
        const p = at(e)
        if (drag.current !== null) move(drag.current, p)
        else setHover(nearest(p))
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerLeave={() => setHover(null)}
      onDoubleClick={(e) => {
        const i = nearest(at(e as unknown as React.PointerEvent))
        if (i > 0 && i < pts.length - 1) onChange(pts.filter((_, j) => j !== i))
      }}
    >
      {hist && <path d={hist} className="tone-curve-hist" />}
      {[0.25, 0.5, 0.75].map((g) => (
        <g key={g} className="tone-curve-grid">
          <line x1={g * W} y1={0} x2={g * W} y2={H} />
          <line x1={0} y1={g * H} x2={W} y2={g * H} />
        </g>
      ))}
      <line x1={0} y1={H} x2={W} y2={0} className="tone-curve-straight" />
      <path d={path} className="tone-curve-line" />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x * W} cy={(1 - p.y) * H} r={hover === i || drag.current === i ? 5.5 : 4.5} className="tone-curve-point" />
      ))}
    </svg>
  )
}
