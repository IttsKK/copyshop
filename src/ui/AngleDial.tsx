import { useRef } from 'react'
import { Slider } from './controls'

/**
 * The mark on the knob, so it reads as the setting it is:
 * - arrow: a way something goes (a streak, Surge's bands, Repeat's line);
 * - split: both ways from the middle (Prism: red one way, blue the other);
 * - axis: lines that run both ways (glass ribs, a halftone screen);
 * - from: where light comes from (a dot, the light, and the way it shines);
 * - turn: something turned (grain, an image), a turning arrow.
 */
export type DialLook = 'arrow' | 'split' | 'axis' | 'from' | 'turn'

interface Props {
  label: string
  title?: string
  value: number
  /** The value the module starts at: double-click goes back to it, and the track fills from it. */
  def?: number
  /** The values it keeps to, one turn round from min (an axis: half a turn, -90 to 90). */
  min: number
  max: number
  step?: number
  /** Where 0 points on the screen, in degrees clockwise from rightward. */
  zero: number
  /** Which way the value goes up on the screen: 1 clockwise, -1 anticlockwise. */
  turn?: 1 | -1
  look: DialLook
  format?: (v: number) => string
  /** Waiting on another setting: shown greyed with what it waits for (as Slider's idle). */
  idle?: string | false
  onChange: (v: number) => void
}

const INK = '#1b1c1f'

/** The mark drawn for each look, pointing rightward (0°) in a 14-unit box round its middle. */
function Mark({ look }: { look: DialLook }) {
  switch (look) {
    case 'arrow':
      return (
        <>
          <line x1={-5.5} y1={0} x2={2} y2={0} stroke={INK} strokeWidth={1.8} strokeLinecap="round" />
          <path d="M6.2,0 L1.2,-3.6 L1.2,3.6 Z" fill={INK} />
        </>
      )
    case 'split':
      return (
        <>
          <line x1={-2.5} y1={0} x2={2.5} y2={0} stroke={INK} strokeWidth={1.8} />
          <path d="M6.4,0 L2.2,-3.2 L2.2,3.2 Z" fill={INK} />
          <path d="M-6.4,0 L-2.2,-3.2 L-2.2,3.2 Z" fill={INK} />
        </>
      )
    case 'axis':
      return (
        <>
          <line x1={-6} y1={0} x2={6} y2={0} stroke={INK} strokeWidth={1.7} strokeLinecap="round" />
          <line x1={-4.5} y1={-3.6} x2={4.5} y2={-3.6} stroke={INK} strokeWidth={1.1} strokeOpacity={0.5} strokeLinecap="round" />
          <line x1={-4.5} y1={3.6} x2={4.5} y2={3.6} stroke={INK} strokeWidth={1.1} strokeOpacity={0.5} strokeLinecap="round" />
        </>
      )
    case 'from':
      // The light at the side it comes from, shining across.
      return (
        <>
          <circle cx={3.9} cy={0} r={2.9} fill={INK} />
          <line x1={0.6} y1={0} x2={-3.4} y2={0} stroke={INK} strokeWidth={1.5} strokeLinecap="round" />
          <path d="M-6.4,0 L-3,-2.5 L-3,2.5 Z" fill={INK} />
        </>
      )
    case 'turn':
      // A turning arrow, round most of a circle, its head at the angle.
      return (
        <>
          <path d="M4.6,0 A4.6,4.6 0 1 1 1.4,-4.4" fill="none" stroke={INK} strokeWidth={1.6} strokeLinecap="round" />
          <path d="M4.6,1.8 L2.4,-1.6 L6.8,-1.6 Z" fill={INK} />
        </>
      )
  }
}

/**
 * An angle on a slider like every other, a mark on its knob turned the way
 * the angle goes on the photo (where 0 points: `zero`). One end of the
 * track and the other are the same way round (180° and -180°); the knob
 * stays at the end it was dragged to.
 */
export function AngleDial({ label, title, value, def, min, max, step = 1, zero, turn = 1, look, format = (v) => `${Math.round(v)}°`, idle, onChange }: Props) {
  const period = max - min
  const end = useRef<1 | -1>(1)
  // Into the track's values, one turn round from min.
  const wrapped = ((((value - min) % period) + period) % period) + min
  const atEnd = Math.abs(wrapped - min) < step / 2 || Math.abs(wrapped - max) < step / 2
  const shown = atEnd ? (end.current < 0 ? min : max) : wrapped
  return (
    <Slider
      label={label}
      title={title}
      value={shown}
      def={def}
      min={min}
      max={max}
      step={step}
      format={format}
      idle={idle}
      thumb={
        <svg viewBox="-7 -7 14 14" style={{ transform: `rotate(${(zero + turn * value).toFixed(1)}deg)` }} aria-hidden>
          <Mark look={look} />
        </svg>
      }
      onChange={(v) => {
        if (Math.abs(v - min) < step / 2) end.current = -1
        else if (Math.abs(v - max) < step / 2) end.current = 1
        onChange(v)
      }}
    />
  )
}
