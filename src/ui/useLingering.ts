import { useLayoutEffect, useRef, useState } from 'react'

/** How long a panel takes to leave, ms (its closing animation in styles.css). */
export const LEAVE_MS = 110

const reduced = () =>
  document.documentElement.classList.contains('reduce-motion') || (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

/**
 * A panel shown while `open`, and for a moment after it closes so it can
 * animate out: `shown` keeps it (and its space) until then, `closing` marks
 * the moment. With Reduce motion it goes at once.
 */
export function useLingering(open: boolean, ms = LEAVE_MS): { shown: boolean; closing: boolean } {
  const [closing, setClosing] = useState(false)
  const was = useRef(open)
  // Just closed, before the effect below has run: still shown, so it never
  // leaves for a frame and comes back.
  const justClosed = was.current && !open && !reduced()
  useLayoutEffect(() => {
    const closed = was.current && !open
    was.current = open
    if (!closed || reduced()) {
      setClosing(false)
      return
    }
    setClosing(true)
    const t = setTimeout(() => setClosing(false), ms)
    return () => clearTimeout(t)
  }, [open, ms])
  const lingering = !open && (closing || justClosed)
  return { shown: open || lingering, closing: lingering }
}
