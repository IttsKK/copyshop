import { useRef } from 'react'
import { useBaseline } from './controls'
import { capturePointer } from './pointer'

interface Props {
  /** 0..1 across the pad (on the control's own curve). */
  x: number
  /** 0..1 up the pad. */
  y: number
  onChange: (x: number, y: number) => void
  /** What the two directions are: Size and Clumps unless given. */
  across?: string
  up?: string
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Size and Clumps on one pad: across, finer to bigger grain; up, smoother
 * to lumpier. The two shape grain's character together, so finding the
 * texture is one drag instead of two sliders walked in turn. The grain tile
 * beside it shows the result as the plate regenerates.
 */
export function GrainPad({ x, y, onChange, across = 'Size', up = 'Clumps' }: Props) {
  const pad = useRef<HTMLDivElement>(null)
  const base = useBaseline({ x, y })
  const dragging = useRef(false)
  const at = (e: React.PointerEvent) => {
    const r = pad.current!.getBoundingClientRect()
    onChange(clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height))
  }
  const key = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.02
    const d =
      e.key === 'ArrowLeft' ? [-step, 0] : e.key === 'ArrowRight' ? [step, 0] : e.key === 'ArrowUp' ? [0, step] : e.key === 'ArrowDown' ? [0, -step] : null
    if (!d) return
    e.preventDefault()
    onChange(clamp01(x + d[0]), clamp01(y + d[1]))
  }
  return (
    <div className="grain-pad-wrap">
      <div
        ref={pad}
        className="grain-pad"
        role="slider"
        tabIndex={0}
        aria-label={`Grain ${across.toLowerCase()} and ${up.toLowerCase()}`}
        aria-valuetext={`${across.toLowerCase()} ${Math.round(x * 100)}%, ${up.toLowerCase()} ${Math.round(y * 100)}%`}
        title={`Across: ${across.toLowerCase()}. Up: ${up.toLowerCase()}. Drag to find the texture; arrow keys nudge; double-click to go back.`}
        onDoubleClick={() => onChange(base.x, base.y)}
        onPointerDown={(e) => {
          dragging.current = true
          capturePointer(e.currentTarget, e.pointerId)
          at(e)
        }}
        onPointerMove={(e) => dragging.current && at(e)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        onKeyDown={key}
      >
        <span className="grain-pad-dot" style={{ left: `${x * 100}%`, top: `${(1 - y) * 100}%` }} />
      </div>
      <div className="grain-pad-axes">
        <span>{across} →</span>
        <span>{up} ↑</span>
      </div>
    </div>
  )
}
