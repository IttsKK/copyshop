import { useRef } from 'react'
import type { BandGuide, Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

export interface GuideEditor {
  guides: BandGuide[]
  selected: number | null
  onChange: (guides: BandGuide[]) => void
  onSelect: (index: number | null) => void
}

interface Props {
  editor: GuideEditor
  print: Size
  region: Rect
  css: Size
}

/**
 * Band guides on the photo: a soft circle each, drawn where its influence
 * fades. Drag the dot to move one, drag the ring to resize it; Lift guides
 * are drawn warm, Lower guides cool. Clicking elsewhere on the photo adds one
 * (handled by the preview, which knows the click was not a drag).
 */
export function GuideOverlay({ editor, print, region, css }: Props) {
  const drag = useRef<{ index: number; mode: 'move' | 'size'; dx: number; dy: number } | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const short = Math.min(print.width, print.height)
  const sx = css.width / region.width
  const sy = css.height / region.height
  const toPrint = (clientX: number, clientY: number) => {
    const r = svg.current!.getBoundingClientRect()
    return [(clientX - r.left) / sx + region.x, (clientY - r.top) / sy + region.y]
  }
  const update = (i: number, patch: Partial<BandGuide>) =>
    editor.onChange(editor.guides.map((g, j) => (j === i ? { ...g, ...patch } : g)))

  const begin = (e: React.PointerEvent, index: number, mode: 'move' | 'size') => {
    e.stopPropagation()
    const g = editor.guides[index]
    const [px, py] = toPrint(e.clientX, e.clientY)
    drag.current = { index, mode, dx: px - g.x * print.width, dy: py - g.y * print.height }
    editor.onSelect(index)
    capturePointer(e.target, e.pointerId)
  }

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const g = editor.guides[d.index]
    const [px, py] = toPrint(e.clientX, e.clientY)
    if (d.mode === 'move') update(d.index, { x: (px - d.dx) / print.width, y: (py - d.dy) / print.height })
    else {
      const r = Math.hypot(px - g.x * print.width, py - g.y * print.height) / short
      update(d.index, { radius: Math.min(2, Math.max(0.03, r)) })
    }
  }

  // Draw the selected guide last so its handles are never under another's ring.
  const order = editor.guides
    .map((_, i) => i)
    .filter((i) => i !== editor.selected)
    .concat(editor.selected !== null && editor.selected < editor.guides.length ? [editor.selected] : [])

  return (
    <svg
      ref={svg}
      className="guide-overlay"
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {order.map((i) => {
        const g = editor.guides[i]
        const cx = (g.x * print.width - region.x) * sx
        const cy = (g.y * print.height - region.y) * sy
        const r = g.radius * short * sx
        const on = editor.selected === i
        return (
          <g key={i} className={`guide ${g.strength >= 0 ? 'lift' : 'lower'} ${on ? 'on' : ''}`}>
            <circle className="guide-ring" cx={cx} cy={cy} r={r} onPointerDown={(e) => begin(e, i, 'size')}>
              <title>Drag the ring to resize</title>
            </circle>
            <circle className="guide-dot" cx={cx} cy={cy} r={8} onPointerDown={(e) => begin(e, i, 'move')}>
              <title>{g.strength >= 0 ? 'Lift' : 'Lower'} — drag to move</title>
            </circle>
          </g>
        )
      })}
    </svg>
  )
}
