import { keyWords } from '../platform/os'
import { useEffect, useRef, useState } from 'react'
import { toScene, toView } from './lensView'
import { roundedOutline } from '../engine/leaks'
import type { LightShape } from '../engine/lighting'
import type { Rect, Size } from '../engine/types'
import { capturePointer } from './pointer'

type Pt = { x: number; y: number }

/** Index of the side of a closed outline nearest to a point. */
function nearestSide(pts: Pt[], p: Pt): number {
  let best = Infinity
  let index = 0
  for (let j = 0; j < pts.length; j++) {
    const a = pts[j]
    const b = pts[(j + 1) % pts.length]
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

export interface LightEditor {
  lights: LightShape[]
  selected: number | null
  /** Drawing a new light: click round where it falls. */
  drawing: boolean
  onSelect: (index: number | null) => void
  /** A new light's outline, drawn (fractions of the print). */
  onAdd: (outline: Pt[]) => void
  onCancel: () => void
  /** `step` names the edit, so a drag is one step to undo. */
  onChange: (index: number, patch: Partial<LightShape>, step: string) => void
}

interface Props {
  editor: LightEditor
  print: Size
  region: Rect
  css: Size
}

/**
 * Lighting's lights on the photo. Drawing: click round where the light
 * falls; Enter, a double-click or a click on the first point closes it, Esc
 * cancels. Otherwise: click a light to select it, drag it to move it, drag a
 * point to reshape it, click its outline to add a point there (and drag to
 * place it), Option-click or double-click a point to take it away.
 */
export function LightOverlay({ editor, print, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Pt[]>([])
  const [hover, setHover] = useState<Pt | null>(null)
  const drag = useRef<{ index: number; point: number | null; from: Pt; was: Pt[]; step?: string } | null>(null)
  const sx = css.width / region.width
  const sy = css.height / region.height
  // Through the lens: where a point of the photo is seen, and back (lensView.ts).
  const toCss = (p: Pt) => {
    const v = toView({ x: p.x * print.width, y: p.y * print.height })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: { clientX: number; clientY: number }): Pt => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: q.x / print.width, y: q.y / print.height }
  }

  // Drawing: Enter closes, Esc cancels.
  const finish = () => {
    if (draft.length >= 3) editor.onAdd(draft)
    setDraft([])
  }
  useEffect(() => {
    if (!editor.drawing) {
      setDraft([])
      return
    }
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter') finish()
      else if (e.key === 'Escape') {
        setDraft([])
        editor.onCancel()
      } else if (e.key === 'Backspace' && draft.length) setDraft(draft.slice(0, -1))
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const clickDraw = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    const p = fromEvent(e)
    if (draft.length >= 3) {
      const a = toCss(draft[0])
      const b = toCss(p)
      if (Math.hypot(a.x - b.x, a.y - b.y) < 9) {
        finish()
        return
      }
    }
    setDraft([...draft, p])
  }

  const grab = (e: React.PointerEvent, index: number, point: number | null) => {
    e.stopPropagation()
    e.preventDefault()
    const l = editor.lights[index]
    if (point !== null && e.altKey) {
      removePoint(index, point)
      return
    }
    editor.onSelect(index)
    drag.current = { index, point, from: fromEvent(e), was: l.outline }
    capturePointer(e.target, e.pointerId)
  }
  // A click on the selected light's outline adds a point between the two
  // nearest, and the same press drags it into place (one step to undo).
  const insert = (e: React.PointerEvent, index: number) => {
    e.stopPropagation()
    e.preventDefault()
    const l = editor.lights[index]
    const p = fromEvent(e)
    // Measured on screen, so a stretched print still picks the side you see.
    const k = nearestSide(l.outline.map(toCss), toCss(p)) + 1
    const outline = [...l.outline.slice(0, k), p, ...l.outline.slice(k)]
    const step = `light${index}:point${k}:add${l.outline.length}`
    editor.onChange(index, { outline }, step)
    drag.current = { index, point: k, from: p, was: outline, step }
    capturePointer(e.target, e.pointerId)
  }
  const removePoint = (index: number, point: number) => {
    const l = editor.lights[index]
    if (l.outline.length > 3) editor.onChange(index, { outline: l.outline.filter((_, k) => k !== point) }, `light${index}:remove`)
  }
  const onMove = (e: React.PointerEvent) => {
    if (editor.drawing) {
      setHover(fromEvent(e))
      return
    }
    const d = drag.current
    if (!d) return
    const p = fromEvent(e)
    const dx = p.x - d.from.x
    const dy = p.y - d.from.y
    const outline = d.point === null ? d.was.map((q) => ({ x: q.x + dx, y: q.y + dy })) : d.was.map((q, k) => (k === d.point ? p : q))
    editor.onChange(d.index, { outline }, d.step ?? `light${d.index}:${d.point === null ? 'move' : `point${d.point}`}`)
  }
  const end = () => (drag.current = null)

  const shapeOf = (l: LightShape) => (l.rounded ? roundedOutline(l.outline, print) : l.outline).map(toCss)
  const path = (pts: Pt[]) => pts.map((p, k) => `${k ? 'L' : 'M'}${p.x} ${p.y}`).join(' ') + 'Z'
  const dCss = draft.map(toCss)
  const hCss = hover ? toCss(hover) : null
  return (
    <svg ref={svg} className={`light-overlay${editor.drawing ? ' drawing' : ''}`} width={css.width} height={css.height} onPointerMove={onMove} onPointerUp={end} onPointerCancel={end}>
      {editor.drawing && <rect className="light-catch" x={0} y={0} width={css.width} height={css.height} onPointerDown={clickDraw} onDoubleClick={finish} />}
      {editor.lights.map((l, i) => {
        if (l.mask || l.outline.length < 3) return null
        const on = editor.selected === i
        return (
          <g key={l.id} className={`light-shape${on ? ' on' : ''}${l.enabled === false ? ' off' : ''}`}>
            <path className="light-body" d={path(shapeOf(l))} onPointerDown={editor.drawing ? undefined : (e) => grab(e, i, null)} />
            {on && !editor.drawing && (
              <path className="light-edge" d={path(shapeOf(l))} onPointerDown={(e) => insert(e, i)}>
                <title>Click the outline to add a point there; drag to place it</title>
              </path>
            )}
            {on &&
              !editor.drawing &&
              l.outline.map(toCss).map((p, k) => (
                <circle key={k} className="light-point" cx={p.x} cy={p.y} r={5} onPointerDown={(e) => grab(e, i, k)} onDoubleClick={() => removePoint(i, k)}>
                  <title>{keyWords("Drag to move; Option-click or double-click to remove")}</title>
                </circle>
              ))}
          </g>
        )
      })}
      {editor.drawing && dCss.length > 0 && (
        <g className="light-draft">
          <polyline points={[...dCss, ...(hCss ? [hCss] : [])].map((p) => `${p.x},${p.y}`).join(' ')} />
          {dCss.map((p, k) => (
            <circle key={k} className={k === 0 ? 'first' : ''} cx={p.x} cy={p.y} r={k === 0 ? 6 : 4} />
          ))}
        </g>
      )}
    </svg>
  )
}
