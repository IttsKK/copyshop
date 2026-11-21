import { useEffect, useRef, useState } from 'react'
import { toScene, toView } from './lensView'
import { meetingPoint } from '../engine/perspective'
import type { Rect, Size, StreakGuide } from '../engine/types'
import { capturePointer } from './pointer'

type Pt = { x: number; y: number }

export interface StreakGuideEditor {
  guides: StreakGuide[]
  /** `step` names the edit, so a drag is one step to undo. */
  onChange: (guides: StreakGuide[], step: string) => void
  /** Guiding finished: by Enter (keep), or Esc (keep false). */
  onDone: (keep: boolean) => void
  /** A point moved onto the photo's edge nearest it (frame fractions). */
  snap?: (p: Pt) => Pt
  /** What is going on, for the bar over the photo: a line being laid, or one chosen. */
  onState?: (state: GuideState) => void
}

/** Laying: a line being placed, click by click (Enter finishes it). Chosen: one picked to change or remove. */
export type GuideState = 'idle' | 'laying' | 'chosen'

interface Props {
  editor: StreakGuideEditor
  /** The frame the guides are kept in (the streak's outline's), in print pixels. */
  frame: Rect
  region: Rect
  css: Size
}

/** Most guides a streak keeps: more only crowd the photo. */
const MAX_GUIDES = 6

const pointsOf = (g: StreakGuide) => (g.points && g.points.length >= 2 ? g.points : [g.a, g.b])
const guideOf = (pts: Pt[]): StreakGuide => ({ a: pts[0], b: pts[pts.length - 1], ...(pts.length > 2 ? { points: pts } : {}) })

/**
 * A streak's guides on the photo: lines laid along its own edges. Click
 * points along an edge, each moved onto the edge itself; Enter (or Finish
 * line) finishes that guide, and the next click starts another. Three or
 * more points on a guide show how the lens bends it. Or drag along an edge
 * for a straight one. Click a guide to choose it: drag its points, click
 * its line to add a point there, Delete (or Remove line) takes it away.
 * Option-click a point takes just that point away.
 */
export function StreakGuideOverlay({ editor, frame, region, css }: Props) {
  const svg = useRef<SVGSVGElement>(null)
  const [draft, setDraft] = useState<Pt | null>(null)
  const [active, setActive] = useState<number | null>(null)
  // The active guide is being laid (clicks add to its end), or only chosen.
  const [laying, setLaying] = useState(false)
  const down = useRef<{ at: Pt; client: Pt; laying: number | null } | null>(null)
  const drag = useRef<{ guide: number; point: number; client: Pt; moved: boolean } | null>(null)
  const state: GuideState = draft || (active !== null && laying) ? 'laying' : active !== null ? 'chosen' : 'idle'
  const onState = editor.onState
  useEffect(() => {
    onState?.(state)
  }, [state, onState])
  useEffect(() => () => onState?.('idle'), [onState])
  const choose = (i: number | null, lay = false) => {
    setActive(i)
    setLaying(i !== null && lay)
    setDraft(null)
  }
  const sx = css.width / region.width
  const sy = css.height / region.height
  // Through the lens: where a point of the photo is seen, and back (lensView.ts).
  const toCss = (p: Pt) => {
    const v = toView({ x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height })
    return { x: (v.x - region.x) * sx, y: (v.y - region.y) * sy }
  }
  const fromEvent = (e: { clientX: number; clientY: number }): Pt => {
    const b = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (e.clientX - b.left) / sx + region.x, y: (e.clientY - b.top) / sy + region.y })
    return { x: (q.x - frame.x) / frame.width, y: (q.y - frame.y) / frame.height }
  }
  const snap = (p: Pt) => (editor.snap ? editor.snap(p) : p)
  const guides = editor.guides
  const set = (next: StreakGuide[], step: string) => editor.onChange(next, step)

  // Enter or Esc: finish the guide being placed; with none, finish guiding.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (e.key === 'Enter' || e.key === 'Escape') {
        // A line being laid or chosen is finished (or let go) first; then guiding.
        if (active !== null || draft) choose(null)
        else editor.onDone(e.key === 'Enter')
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && active !== null && guides[active]) {
        const pts = pointsOf(guides[active])
        // Laying: its last point back. Chosen: the whole line.
        if (laying && pts.length > 2) set(guides.map((g, i) => (i === active ? guideOf(pts.slice(0, -1)) : g)), 'guides:back')
        else {
          set(guides.filter((_, i) => i !== active), 'guides:remove')
          choose(null)
        }
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && draft) setDraft(null)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const onDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    e.preventDefault()
    down.current = { at: fromEvent(e), client: { x: e.clientX, y: e.clientY }, laying: null }
    capturePointer(e.target, e.pointerId)
  }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (d) {
      if (!d.moved && Math.hypot(e.clientX - d.client.x, e.clientY - d.client.y) < 4) return
      d.moved = true
      const p = fromEvent(e)
      set(
        guides.map((g, i) => (i === d.guide ? guideOf(pointsOf(g).map((q, k) => (k === d.point ? p : q))) : g)),
        `guides:move${d.guide}.${d.point}`,
      )
      return
    }
    const c = down.current
    if (!c) return
    // Dragged far enough: a straight guide from where it began.
    if (c.laying === null && Math.hypot(e.clientX - c.client.x, e.clientY - c.client.y) < 6) return
    const p = fromEvent(e)
    if (c.laying === null) {
      const kept = guides.length >= MAX_GUIDES ? guides.slice(1) : guides
      c.laying = kept.length
      set([...kept, guideOf([c.at, p])], 'guides:add')
      choose(null)
    } else set(guides.map((g, i) => (i === c.laying ? guideOf([c.at, p]) : g)), 'guides:add')
  }
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (d) {
      // A click on a point chooses its guide (one being laid stays so).
      if (!d.moved) {
        if (!(laying && active === d.guide)) choose(d.guide)
        return
      }
      // Settled onto the edge where it was let go.
      const g = guides[d.guide]
      if (g) set(guides.map((x, i) => (i === d.guide ? guideOf(pointsOf(x).map((q, k) => (k === d.point ? snap(q) : q))) : x)), `guides:move${d.guide}.${d.point}`)
      return
    }
    const c = down.current
    down.current = null
    if (!c) return
    if (c.laying !== null) {
      const g = guides[c.laying]
      if (g) set(guides.map((x, i) => (i === c.laying ? guideOf(pointsOf(x).map(snap)) : x)), 'guides:add')
      // Dragged out whole: chosen, to change or remove.
      choose(c.laying)
      return
    }
    // A click: a point on the guide being laid, or the start of a new one
    // (a chosen one is let go).
    const p = snap(fromEvent(e))
    if (laying && active !== null && guides[active]) {
      set(guides.map((g, i) => (i === active ? guideOf([...pointsOf(g), p]) : g)), `guides:point${active}`)
    } else if (draft) {
      const kept = guides.length >= MAX_GUIDES ? guides.slice(1) : guides
      set([...kept, guideOf([draft, p])], 'guides:add')
      choose(kept.length, true)
    } else {
      choose(null)
      setDraft(p)
    }
  }
  const grabPoint = (e: React.PointerEvent, guide: number, point: number) => {
    e.stopPropagation()
    e.preventDefault()
    const pts = pointsOf(guides[guide])
    if (e.altKey) {
      if (pts.length > 2) set(guides.map((g, i) => (i === guide ? guideOf(pts.filter((_, k) => k !== point)) : g)), 'guides:remove-point')
      else set(guides.filter((_, i) => i !== guide), 'guides:remove')
      if (active === guide) setActive(null)
      return
    }
    drag.current = { guide, point, client: { x: e.clientX, y: e.clientY }, moved: false }
    capturePointer(e.target, e.pointerId)
  }
  /**
   * A guide's line: clicked, it is chosen; clicked again once chosen, a
   * point goes in there (on the photo's edge), to bend it to the lens.
   * Option-click takes the line away. While another line is being laid,
   * the click is a point of that one.
   */
  const grabLine = (e: React.PointerEvent, guide: number) => {
    if (laying && active !== guide) return
    e.stopPropagation()
    e.preventDefault()
    if (e.altKey) {
      set(guides.filter((_, i) => i !== guide), 'guides:remove')
      if (active === guide) choose(null)
      return
    }
    if (active !== guide) return choose(guide)
    const at = fromEvent(e)
    const c = toCss(at)
    const pts = pointsOf(guides[guide])
    // Into the segment nearest the click.
    let best = 0
    let far = Infinity
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = toCss(pts[k])
      const b = toCss(pts[k + 1])
      const dx = b.x - a.x
      const dy = b.y - a.y
      const t = Math.max(0, Math.min(1, ((c.x - a.x) * dx + (c.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-6)))
      const d = Math.hypot(a.x + dx * t - c.x, a.y + dy * t - c.y)
      if (d < far) {
        far = d
        best = k
      }
    }
    const next = [...pts.slice(0, best + 1), snap(at), ...pts.slice(best + 1)]
    set(guides.map((g, i) => (i === guide ? guideOf(next) : g)), `guides:insert${guide}`)
  }

  // Where they meet, roughly, for the dashed lines on to it.
  const lines = guides.map((g) => pointsOf(g).map(toCss))
  const ends = lines.filter((l) => Math.hypot(l[0].x - l[l.length - 1].x, l[0].y - l[l.length - 1].y) > 6).map((l) => ({ a: l[0], b: l[l.length - 1] }))
  const meet = ends.length >= 2 ? meetingPoint(ends) : null
  const far = Math.hypot(css.width, css.height) * 4
  return (
    <svg ref={svg} className="sguide-overlay" width={css.width} height={css.height} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => ((down.current = null), (drag.current = null))}>
      <rect className="sguide-catch" x={0} y={0} width={css.width} height={css.height} onPointerDown={onDown} />
      {lines.map((l, i) => {
        const first = l[0]
        const last = l[l.length - 1]
        let from: Pt = first
        let to: Pt | null = null
        if (meet && Math.hypot(meet.x - first.x, meet.y - first.y) < far) {
          from = Math.hypot(meet.x - first.x, meet.y - first.y) < Math.hypot(meet.x - last.x, meet.y - last.y) ? first : last
          to = meet
        }
        const pts = l.map((p) => `${p.x},${p.y}`).join(' ')
        return (
          <g key={i} className={`sguide${active === i ? ' hot' : ''}${active === i && !laying ? ' chosen' : ''}`}>
            {to && <line className="sguide-on" x1={from.x} y1={from.y} x2={to.x} y2={to.y} />}
            <polyline className="sguide-hit" points={pts} onPointerDown={(e) => grabLine(e, i)} />
            <polyline className="sguide-line" points={pts} />
            {l.map((p, k) => (
              <circle key={k} className="sguide-end" cx={p.x} cy={p.y} r={l.length > 2 ? 4 : 5} onPointerDown={(e) => grabPoint(e, i, k)} />
            ))}
          </g>
        )
      })}
      {draft && (() => {
        const p = toCss(draft)
        return <circle className="sguide-end draft" cx={p.x} cy={p.y} r={5} />
      })()}
      {meet && meet.x > -20 && meet.y > -20 && meet.x < css.width + 20 && meet.y < css.height + 20 && <circle className="sguide-meet" cx={meet.x} cy={meet.y} r={4} />}
    </svg>
  )
}
