import { createContext, useContext } from 'react'
import { keyWords } from '../platform/os'
import { EditBox } from './EditBox'
import type { MaskOwner, MaskSection } from '../engine/types'

/** The kinds of mask, as the Masks panel and a module's Mask menu offer them. */
export type AddKind = 'subject' | 'outline' | 'paint' | 'gradient' | 'radial'

/** What a new mask is made for: a module (its Mask row), or one streak (its Mask tab, where it is the streak's own), on this side of it. */
export type NewMaskTarget = { section?: MaskSection; streak?: number; mode: 'only' | 'exclude' }

/** The kinds of mask, as offered in Add and the empty list. */
export const ADD_KINDS: { kind: AddKind; name: string; line: string; title: string }[] = [
  { kind: 'subject', name: 'Select subject', line: 'Drag a box round it or click it', title: 'A model on this computer finds the subject and its edge (Settings → Selection has a precise one)' },
  { kind: 'outline', name: 'Draw outline', line: 'Click points round it', title: keyWords("Click points round the subject; drag to place each one, Option-drag to trace freehand. Double-click or Enter closes it.") },
  { kind: 'paint', name: 'Paint', line: 'Brush it on by hand', title: 'A mask you paint on the photo with a brush' },
  { kind: 'gradient', name: 'Gradient', line: 'Fades across the photo', title: 'Full at one end, fading away towards the other, like a graduated filter' },
  { kind: 'radial', name: 'Radial', line: 'A soft circle or oval', title: 'A soft circle: just the subject, or everything round it' },
]

/** A small drawing of each kind of mask. */
export function MaskGlyph({ kind }: { kind: AddKind }) {
  const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  return (
    <svg className="mask-glyph" width="16" height="16" viewBox="0 0 16 16" aria-hidden>
      {kind === 'subject' && (
        <>
          <path d="M2.5 5V2.5H5M11 2.5h2.5V5M13.5 11v2.5H11M5 13.5H2.5V11" {...p} />
          <path d="M8 4.6c1.3 0 2 .9 2 2s-.7 2-2 2-2-.9-2-2 .7-2 2-2ZM4.9 12c.4-1.6 1.6-2.4 3.1-2.4s2.7.8 3.1 2.4" fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
        </>
      )}
      {kind === 'outline' && (
        <>
          <path d="M3 11.5 4.5 4 11 2.5l2.5 6-5 5Z" {...p} />
          <circle cx="4.5" cy="4" r="1.3" fill="currentColor" />
          <circle cx="13.5" cy="8.5" r="1.3" fill="currentColor" />
          <circle cx="3" cy="11.5" r="1.3" fill="currentColor" />
        </>
      )}
      {kind === 'paint' && (
        <>
          <path d="M2.5 12.5c1.5 0 2.5-.8 2.6-2.2.1-1.1 1-1.8 2-1.5" {...p} />
          <path d="m7.2 8.6 5.6-6 1 1-6 5.6Z" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinejoin="round" />
        </>
      )}
      {kind === 'gradient' && (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" {...p} />
          <path d="M5 5.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M5 8h6" stroke="currentColor" strokeOpacity="0.6" strokeWidth="1.4" strokeLinecap="round" />
          <path d="M5 10.5h6" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.2" strokeLinecap="round" />
        </>
      )}
      {kind === 'radial' && (
        <>
          <circle cx="8" cy="8" r="5.5" {...p} strokeDasharray="2 1.6" />
          <circle cx="8" cy="8" r="2.6" fill="currentColor" fillOpacity="0.45" stroke="currentColor" strokeWidth="1.2" />
        </>
      )}
    </svg>
  )
}

export interface PickingState {
  index: number | null
  clicks: number
  /** The reading shown, smallest (0) to largest (2). */
  shown: number
  busy: boolean
  /** How much of the photo each reading takes, 0..1. */
  areas?: number[]
  /** Clicks leave parts out (Option flips it for one click). */
  leaveOut: boolean
  onLeaveOut: (on: boolean) => void
  /** For a module's own piece (Repeat's) or a subject to streak, shown there rather than here. */
  owner?: MaskOwner
  /** A new mask for a module or a streak, started from its Mask row or Mask tab: shown there too, rather than here. */
  forTarget?: boolean
}

const READINGS = [
  ['Part', 'The smallest thing the clicks could mean: a part of it'],
  ['More', 'In between'],
  ['Whole', 'The largest thing the clicks could mean: the whole subject'],
] as const


/** Selecting a subject, in its edit box (EditBox, with Cancel and Done): what the clicks found, and which reading to keep. */
export function PickPanel({ p, onPickReading }: { p: PickingState; onPickReading: (reading: number) => void; onPickDone?: (keep: boolean) => void }) {
  return (
    <EditBox at="pick">
      <div className="pick-panel">
        <p className="edit-box-hint">
          {p.clicks === 0
            ? 'Click the subject, or box it'
            : p.busy
              ? 'Finding it…'
              : p.leaveOut
                ? 'Click what to leave out'
                : 'Click to add a part'}
        </p>
        <div className="segmented pick-mode">
          <button className={!p.leaveOut ? 'on' : ''} title="Clicks add to the selection" onClick={() => p.onLeaveOut(false)}>
            Add
          </button>
          <button
            className={p.leaveOut ? 'on' : ''}
            disabled={p.clicks === 0}
            title={p.clicks === 0 ? 'Select something first, then click what should not be in it' : keyWords('Clicks take parts out of the selection (or Option-click)')}
            onClick={() => p.onLeaveOut(true)}
          >
            Leave out
          </button>
        </div>
        {p.clicks > 0 && (
          <div className="segmented pick-readings">
            {READINGS.map(([label, hint], r) => (
              <button key={label} className={p.shown === r ? 'on' : ''} title={hint} onClick={() => onPickReading(r)}>
                {label}
                {p.areas?.[r] !== undefined && <small className="pick-area"> {Math.max(1, Math.round(p.areas[r] * 100))}%</small>}
              </button>
            ))}
          </div>
        )}
      </div>
    </EditBox>
  )
}

/**
 * Whether masks show on the photo while they are worked on (a red wash over
 * what each covers): one switch for the whole app, O on the keyboard.
 */
export const MaskOverlayContext = createContext<{ on: boolean; set: (on: boolean) => void }>({ on: true, set: () => undefined })

/** The overlay's switch, where masks are chosen and made. */
export function OverlayToggle() {
  const { on, set } = useContext(MaskOverlayContext)
  return (
    <button
      className={`overlay-toggle${on ? ' on' : ''}`}
      aria-pressed={on}
      title={on ? 'Hide the mask on the photo (O)' : 'Show the mask on the photo (O)'}
      onClick={() => set(!on)}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
        <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="8" cy="8" r="2.2" fill="currentColor" />
        {!on && <path d="M2.5 13.5l11-11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
      </svg>
      Overlay
    </button>
  )
}
