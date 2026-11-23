import { useRef } from 'react'
import type { KaleidoParams } from '../engine/kaleido'
import type { RepeatPoint } from '../engine/repeatParams'
import type { Rect, Size } from '../engine/types'
import { toScene, toView } from './lensView'
import { capturePointer } from './pointer'

export interface KaleidoEditor {
  kaleido: KaleidoParams
  /** Copying a slice of the photo round (no part of its own): its edges are drawn. */
  slice: boolean
  /** `step` names the edit, so a drag is one step to undo. */
  onChange: (patch: Partial<KaleidoParams>, step: string) => void
  onDone: () => void
}

interface Props {
  editor: KaleidoEditor
  /** The frame masks (and the centre) are kept in, in print pixels. */
  frame: Rect
  /** Where the photo is in the print: its middle is the centre while none is set. */
  photo: Rect
  region: Rect
  css: Size
}

/**
 * The Kaleidoscope's centre on the photo: drag it, or click anywhere to put
 * it there. With a slice, the lines it is cut along go out from it, the
 * slice that is copied drawn brighter.
 */
export function KaleidoOverlay({ editor, frame, photo, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const dragging = useRef(false)
  const k = editor.kaleido
  const sx = css.width / region.width
  const sy = css.height / region.height
  const toCss = (p: { x: number; y: number }) => {
    const v = toView({ x: frame.x + p.x, y: frame.y + p.y })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: React.PointerEvent): RepeatPoint => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: (q.x - frame.x) / frame.width, y: (q.y - frame.y) / frame.height }
  }
  const move = (e: React.PointerEvent) => {
    const p = fromEvent(e)
    // Kept on the photo (or its border): off it, nothing would be copied.
    editor.onChange({ centre: { x: Math.min(1, Math.max(0, p.x)), y: Math.min(1, Math.max(0, p.y)) } }, 'kaleido:centre')
  }
  const grab = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    dragging.current = true
    move(e)
    capturePointer(e.target, e.pointerId)
  }
  const end = () => (dragging.current = false)

  // In frame pixels, so the slices' angles are as they are on the photo.
  const c = k.centre ? { x: k.centre.x * frame.width, y: k.centre.y * frame.height } : { x: photo.x + photo.width / 2 - frame.x, y: photo.y + photo.height / 2 - frame.y }
  const C = toCss(c)
  const reach = Math.hypot(frame.width, frame.height)
  const n = Math.max(2, Math.round(k.copies))
  const step = (2 * Math.PI) / n
  const a = (k.angle * Math.PI) / 180
  const out = (t: number) => toCss({ x: c.x + Math.sin(t) * reach, y: c.y - Math.cos(t) * reach })
  const edges = editor.slice ? Array.from({ length: n }, (_, i) => a + step / 2 + i * step) : []
  const s0 = out(a - step / 2)
  const s1 = out(a + step / 2)
  // The lines only over the photo, not out across the canvas round it.
  const p0 = toCss({ x: photo.x - frame.x, y: photo.y - frame.y })
  const p1 = toCss({ x: photo.x + photo.width - frame.x, y: photo.y + photo.height - frame.y })
  return (
    <svg
      ref={svg}
      className="repeat-overlay kaleido-overlay"
      width={css.width}
      height={css.height}
      onPointerMove={(e) => dragging.current && move(e)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <defs>
        <clipPath id="kaleido-photo">
          <rect x={p0.x} y={p0.y} width={p1.x - p0.x} height={p1.y - p0.y} />
        </clipPath>
      </defs>
      <rect className="repeat-catch" x={0} y={0} width={css.width} height={css.height} onPointerDown={grab} onDoubleClick={editor.onDone} />
      <g clipPath="url(#kaleido-photo)">
        {editor.slice && <path className="kaleido-slice" d={`M${C.x} ${C.y} L${s0.x} ${s0.y} L${s1.x} ${s1.y} Z`} />}
        {edges.map((t, i) => {
          const p = out(t)
          return <line key={i} className="kaleido-edge" x1={C.x} y1={C.y} x2={p.x} y2={p.y} />
        })}
      </g>
      <g className="kaleido-centre" transform={`translate(${C.x} ${C.y})`} onPointerDown={grab}>
        <circle r={9} />
        <path d="M-5 0 H5 M0 -5 V5" />
        <title>Drag to move the centre the copies go round</title>
      </g>
    </svg>
  )
}
