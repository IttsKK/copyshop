import { useRef } from 'react'

export interface BarTone {
  brightness: number
  contrast: number
  opacity: number
}

interface Props {
  start: BarTone
  end: BarTone
  /** Where along each bar the change begins, a share of the bar (changeAt). */
  at: number
  /** How much of the bar the change takes (changeLength): 0 all at once. */
  over: number
  onChange: (patch: { changeAt?: number; changeLength?: number }) => void
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const smooth = (a: number, b: number, t: number) => {
  const x = clamp01((t - a) / (b - a))
  return x * x * (3 - 2 * x)
}
/** How far from the start's tone to the end's at `t` along the bar, as the streak shader has it. */
export const changeAt = (at: number, over: number, t: number) => (over > 0 ? smooth(at, at + over, t) : t >= at ? 1 : 0)
const pct = (v: number) => `${Math.round(v * 100)}%`

/** A light and a dark tone of the photo, as the streak's tone makes them (brightness in stops, then contrast about the middle). */
const shade = (v: number, tone: BarTone) => {
  const lit = v * 2 ** tone.brightness
  return clamp01(0.5 + (lit - 0.5) * (1 + tone.contrast))
}

/**
 * The streak's tone along one bar, start to end: a light and a dark tone of
 * the photo as the bar shows them (brighter, darker, nearer together or
 * further apart, fading out over the checks), and two handles for where the
 * change begins and where it is complete. Double-click it for the whole bar
 * again.
 */
export function ToneAlong({ start, end, at, over, onChange }: Props) {
  const strip = useRef<HTMLDivElement>(null)
  const finish = Math.min(1, at + over)
  const N = 32
  const stops = (v: number) =>
    Array.from({ length: N + 1 }, (_, k) => {
      const t = k / N
      const c = changeAt(at, over, t)
      const tone = {
        brightness: start.brightness + (end.brightness - start.brightness) * c,
        contrast: start.contrast + (end.contrast - start.contrast) * c,
        opacity: clamp01(start.opacity + (end.opacity - start.opacity) * c),
      }
      const g = Math.round(shade(v, tone) * 255)
      return `rgba(${g},${g},${g},${tone.opacity.toFixed(3)}) ${(t * 100).toFixed(1)}%`
    }).join(', ')
  // The end tone not reached by the end of the bar: how much of it is.
  const reached = changeAt(at, over, 1)
  const words =
    over < 0.005
      ? `Changes at ${pct(at)} along each bar, all at once`
      : reached < 0.98
        ? `Changes from ${pct(at)} along each bar, ${pct(reached)} of the way there by its end`
        : `Changes from ${pct(at)} to ${pct(finish)} along each bar`

  const drag = (which: 'from' | 'to') => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const box = strip.current?.getBoundingClientRect()
    if (!box) return
    const target = e.currentTarget as HTMLElement
    try {
      target.setPointerCapture(e.pointerId)
    } catch {
      // A pointer the browser no longer has: the moves still come to the handle while over it.
    }
    const fixedEnd = finish
    const move = (ev: PointerEvent) => {
      const t = Math.round(clamp01((ev.clientX - box.left) / box.width) * 100) / 100
      if (which === 'from') {
        const a = Math.min(t, fixedEnd)
        onChange({ changeAt: a, changeLength: Math.max(0, fixedEnd - a) })
      } else onChange({ changeLength: Math.max(0, t - at) })
    }
    const up = () => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
      target.removeEventListener('pointercancel', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
    target.addEventListener('pointercancel', up)
  }
  const keys = (which: 'from' | 'to') => (e: React.KeyboardEvent) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.01 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.01 : 0
    if (!d) return
    e.preventDefault()
    e.stopPropagation()
    if (which === 'from') {
      const a = clamp01(Math.min(at + d, finish))
      onChange({ changeAt: a, changeLength: Math.max(0, finish - a) })
    } else onChange({ changeLength: Math.max(0, Math.min(1, finish + d) - at) })
  }

  return (
    <div className="tone-along">
      <div
        className="tone-along-strip"
        ref={strip}
        title="One bar, from where it starts to where it ends. Drag the handles to set where the tone changes; double-click for the whole bar."
        onDoubleClick={() => onChange({ changeAt: 0, changeLength: 1 })}
      >
        <div
          className="tone-along-fill"
          style={{
            backgroundImage: `linear-gradient(90deg, ${stops(0.78)}), linear-gradient(90deg, ${stops(0.28)})`,
          }}
        />
        <div className="tone-along-span" style={{ left: pct(at), width: pct(finish - at) }} />
        <button
          type="button"
          className="tone-along-handle"
          style={{ left: pct(at) }}
          role="slider"
          aria-label="Where the change begins"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(at * 100)}
          title={`The change begins ${pct(at)} along each bar`}
          onPointerDown={drag('from')}
          onKeyDown={keys('from')}
        />
        {/* Always there, over the first when they meet (a sudden change), so dragging it out makes the change gradual. */}
        <button
          type="button"
          className="tone-along-handle end"
          style={{ left: pct(finish) }}
          role="slider"
          aria-label="Where the change is complete"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(finish * 100)}
          title={`The change is complete ${pct(finish)} along each bar`}
          onPointerDown={drag('to')}
          onKeyDown={keys('to')}
        />
      </div>
      <div className="tone-along-ends" aria-hidden>
        <span>Start</span>
        <span>End</span>
      </div>
      <p className="tone-along-words">{words}</p>
    </div>
  )
}
