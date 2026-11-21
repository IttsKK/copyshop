import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'

/**
 * A walk round the app: one step at a time, the part of the window it is
 * about lit and the rest dimmed, a short card beside it. Back, Next, Esc to
 * stop. Shown from the welcome card, Help (?) and Settings.
 */
export interface TourStep {
  /**
   * What to light: a CSS selector, or several lit together as one (History
   * and Snapshots); none, or not on screen, and the card sits in the middle.
   */
  target?: string | string[]
  /** A control within it to point out as well, ringed: the Mask button in a module's header. */
  also?: string
  title: string
  text: ReactNode
  /** Done before the step shows: going to the panel page it's about. */
  before?: () => void
  /**
   * The step's own buttons in place of Next and Done (the last step's
   * "Your turn": open a photo, add a folder). Skip earlier on comes here.
   */
  actions?: ReactNode
}

interface Props {
  steps: TourStep[]
  onClose: () => void
}

const PAD = 6
const CARD_W = 320

const elementsOf = (target: TourStep['target']) =>
  (Array.isArray(target) ? target : target ? [target] : []).map((sel) => document.querySelector(sel)).filter((el): el is Element => !!el)

/** The box round the step's parts, as one; null if none is on screen. */
function boxOf(target: TourStep['target']): DOMRect | null {
  const rects = elementsOf(target)
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 0 && r.height > 0)
  if (!rects.length) return null
  const left = Math.min(...rects.map((r) => r.left))
  const top = Math.min(...rects.map((r) => r.top))
  return new DOMRect(left, top, Math.max(...rects.map((r) => r.right)) - left, Math.max(...rects.map((r) => r.bottom)) - top)
}

export function Tour({ steps, onClose }: Props) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [alsoRect, setAlsoRect] = useState<DOMRect | null>(null)
  const step = steps[i]
  const measure = () => {
    setRect(boxOf(step.target))
    setAlsoRect(step.also ? boxOf(step.also) : null)
  }

  // Each step: its page first, then its part of the window scrolled into view
  // (History sits low in its panel, often out of sight), then where it is
  // (a frame later, once the page has drawn and scrolled). Once per step: the
  // steps are made anew on every render, and going to a page renders.
  useLayoutEffect(() => {
    step.before?.()
    let raf = requestAnimationFrame(() => {
      for (const el of elementsOf(step.target)) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      if (step.also) elementsOf(step.also)[0]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      raf = requestAnimationFrame(measure)
    })
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  // Kept on its part as the window resizes or a panel scrolls.
  useEffect(() => {
    const onMove = () => measure()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') i < steps.length - 1 ? setI(i + 1) : onClose()
      else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [i, steps.length, onClose])

  // The card: beside the lit part, on whichever side has room; in the middle with nothing lit.
  const vw = window.innerWidth
  const vh = window.innerHeight
  let cardStyle: React.CSSProperties
  if (!rect) cardStyle = { left: (vw - CARD_W) / 2, top: vh / 2 - 90 }
  else {
    const roomLeft = rect.left - PAD
    const roomRight = vw - rect.right - PAD
    const top = Math.min(Math.max(12, rect.top), vh - 220)
    if (roomLeft >= CARD_W + 24) cardStyle = { left: rect.left - PAD - CARD_W - 14, top }
    else if (roomRight >= CARD_W + 24) cardStyle = { left: rect.right + PAD + 14, top }
    else cardStyle = { left: Math.min(Math.max(12, rect.left), vw - CARD_W - 12), top: rect.bottom + PAD + 14 > vh - 200 ? Math.max(12, rect.top - 200) : rect.bottom + PAD + 14 }
  }

  return (
    <div className="tour" role="dialog" aria-label="A walk round copyshop" aria-modal="true">
      {rect ? (
        <div
          className="tour-light"
          // Kept inside the window, so its edge shows on parts that reach the window's edge.
          style={{
            left: Math.max(2, rect.left - PAD),
            top: Math.max(2, rect.top - PAD),
            width: Math.min(vw - 2, rect.right + PAD) - Math.max(2, rect.left - PAD),
            height: Math.min(vh - 2, rect.bottom + PAD) - Math.max(2, rect.top - PAD),
          }}
        />
      ) : (
        <div className="tour-dim" />
      )}
      {alsoRect && (
        <div className="tour-also" style={{ left: alsoRect.left - 4, top: alsoRect.top - 4, width: alsoRect.width + 8, height: alsoRect.height + 8 }} />
      )}
      <div className="tour-card" style={{ ...cardStyle, width: CARD_W }}>
        <div className="tour-count">
          {i + 1} of {steps.length}
        </div>
        <h3>{step.title}</h3>
        <p>{step.text}</p>
        {step.actions ? (
          <div className="tour-own-actions">{step.actions}</div>
        ) : (
          <div className="tour-actions">
            {i < steps.length - 1 ? (
              // To the end: its own buttons (Your turn), when it has them.
              <button className="link" onClick={() => (steps[steps.length - 1].actions ? setI(steps.length - 1) : onClose())}>
                Skip
              </button>
            ) : (
              <span />
            )}
            <span>
              {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
              <button className="primary" autoFocus onClick={() => (i < steps.length - 1 ? setI(i + 1) : onClose())}>
                {i < steps.length - 1 ? 'Next' : 'Done'}
              </button>
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
