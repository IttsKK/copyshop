import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

/** A photo being dragged to another place: where it is (`from`), and the gap it would go in (`to`, before the photo there; the length for the end). */
export interface Dragging {
  from: number
  to: number
}

const START = 5
const EDGE = 48

/**
 * Esc while a photo is dragged leaves it. Listened for from the start, so
 * before every other Esc (the editor's and the Library's take it for
 * themselves).
 */
let escape: ((e: KeyboardEvent) => void) | null = null
if (typeof window !== 'undefined') window.addEventListener('keydown', (e) => escape?.(e), true)

/**
 * Photos put in order by dragging them (the filmstrip and the Library
 * grid): press on one and move, a line shows where it will go, let go to
 * put it there (Esc leaves it). A press that does not move is a click as
 * ever. Done with the pointer rather than the browser's drag and drop,
 * which the desktop app's own file dropping takes over on Windows. Near the
 * list's ends it scrolls.
 *
 * The items are the children of `list` with a data-drag attribute, in order.
 * `axis` is the way the list scrolls; `side`, the way its items follow one
 * another (a grid's go across, though it scrolls down).
 */
export function useDragOrder(list: RefObject<HTMLElement | null>, axis: 'x' | 'y', onMove: ((from: number, to: number) => void) | null, side: 'x' | 'y' = 'x') {
  const [drag, setDrag] = useState<Dragging | null>(null)
  const state = useRef<{ from: number; x: number; y: number; on: boolean; to: number } | null>(null)
  const move = useRef(onMove)
  move.current = onMove

  const items = () => [...(list.current?.querySelectorAll<HTMLElement>(':scope > [data-drag]') ?? [])]

  /** The gap nearest the pointer: beside the photo it is nearest, on the side it is on. */
  const gapAt = useRef<(x: number, y: number) => number>(() => 0)
  gapAt.current = (x: number, y: number): number => {
    let best = -1
    let far = Infinity
    const all = items()
    all.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      const dx = Math.max(r.left - x, 0, x - r.right)
      const dy = Math.max(r.top - y, 0, y - r.bottom)
      const d = dx * dx + dy * dy
      if (d < far) {
        far = d
        best = i
      }
    })
    if (best < 0) return 0
    const r = all[best].getBoundingClientRect()
    return best + ((side === 'y' ? y > r.top + r.height / 2 : x > r.left + r.width / 2) ? 1 : 0)
  }

  useEffect(() => {
    if (!drag) return
    let frame = 0
    // Scrolled while the pointer is held near an end.
    const scroll = () => {
      const s = state.current
      const el = list.current
      if (s?.on && el) {
        const r = el.getBoundingClientRect()
        const [p, lo, hi] = axis === 'x' ? [s.x, r.left, r.right] : [s.y, r.top, r.bottom]
        const by = p < lo + EDGE ? -(lo + EDGE - p) : p > hi - EDGE ? p - (hi - EDGE) : 0
        if (by) {
          const step = Math.sign(by) * Math.min(24, Math.abs(by) / 2 + 2)
          if (axis === 'x') el.scrollLeft += step
          else el.scrollTop += step
          const to = gapAt.current(s.x, s.y)
          if (to !== s.to) {
            s.to = to
            setDrag({ from: s.from, to })
          }
        }
      }
      frame = requestAnimationFrame(scroll)
    }
    frame = requestAnimationFrame(scroll)
    return () => cancelAnimationFrame(frame)
  }, [!!drag, axis])

  // The window's listeners while a photo is held: made once, so each comes off again.
  const on = useMemo(() => {
    const end = (put: boolean) => {
      const s = state.current
      state.current = null
      window.removeEventListener('pointermove', pointerMove)
      window.removeEventListener('pointerup', pointerUp)
      window.removeEventListener('pointercancel', cancel)
      if (escape === key) escape = null
      if (!s?.on) return
      setDrag(null)
      // The click that ends a drag is not a click on a photo.
      const swallow = (e: MouseEvent) => {
        e.stopPropagation()
        e.preventDefault()
      }
      window.addEventListener('click', swallow, true)
      setTimeout(() => window.removeEventListener('click', swallow, true), 0)
      if (!put) return
      const to = s.to > s.from ? s.to - 1 : s.to
      if (to !== s.from) move.current?.(s.from, to)
    }
    const pointerMove = (e: PointerEvent) => {
      const s = state.current
      if (!s) return
      if (!s.on && Math.hypot(e.clientX - s.x, e.clientY - s.y) < START) return
      const was = s.on
      s.on = true
      s.x = e.clientX
      s.y = e.clientY
      const to = gapAt.current(e.clientX, e.clientY)
      if (to !== s.to || !was) {
        s.to = to
        setDrag({ from: s.from, to })
      }
    }
    const pointerUp = () => end(true)
    const cancel = () => end(false)
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !state.current?.on) return
      e.preventDefault()
      e.stopImmediatePropagation()
      end(false)
    }
    const start = () => {
      window.addEventListener('pointermove', pointerMove)
      window.addEventListener('pointerup', pointerUp)
      window.addEventListener('pointercancel', cancel)
      escape = key
    }
    return { start, end }
  }, [])

  useEffect(() => () => on.end(false), [on])

  /** On each item: where a drag starts. Not with a modifier key held (choosing photos). */
  const startAt = (i: number) => (e: ReactPointerEvent) => {
    if (!move.current || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || state.current) return
    state.current = { from: i, x: e.clientX, y: e.clientY, on: false, to: i }
    on.start()
  }

  /** An item's classes while dragging: the one dragged, and where the line is. */
  const dragClass = (i: number, count: number): string => {
    if (!drag) return ''
    const lands = drag.to !== drag.from && drag.to !== drag.from + 1
    return `${i === drag.from ? ' drag-from' : ''}${lands && drag.to === i ? ' drop-before' : ''}${lands && drag.to === count && i === count - 1 ? ' drop-after' : ''}`
  }

  return { dragging: drag, startAt, dragClass }
}
