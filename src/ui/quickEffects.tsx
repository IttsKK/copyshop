import type { RepeatParams } from '../engine/repeatParams'

/**
 * Effects that need something from you (a subject clicked, a path drawn),
 * ready-made: picking one sets everything up and then asks for just that,
 * step by step, so a first try comes out well without knowing how the
 * module works. Everything stays adjustable afterwards.
 */
export interface QuickEffect<P> {
  id: string
  name: string
  /** What it makes. */
  hint: string
  /** What it will ask you to do. */
  steps: string
  patch: P
  /** After the subject, a path to draw. */
  path?: boolean
}

export const REPEAT_QUICK: QuickEffect<Partial<RepeatParams>>[] = [
  {
    id: 'stack-up',
    name: 'Stack up',
    hint: 'Copies rising above it, fading',
    steps: 'Click the subject',
    patch: { layout: 'grid', across: 0, up: 4, spacing: [1, 1], fitPending: 'reach', stagger: 0, size: [1, 1], turn: [0, 0], opacity: [1, 0.3], behind: true, blend: 'normal' },
  },
  {
    id: 'sideways',
    name: 'Echo sideways',
    hint: 'Overlapping copies trailing off to the side with more room',
    steps: 'Click the subject',
    patch: { layout: 'grid', across: 5, up: 0, spacing: [0.4, 0.4], fitPending: 'within', stagger: 0, size: [1, 1], turn: [0, 0], opacity: [0.85, 0.12], behind: true, blend: 'normal' },
  },
  {
    id: 'shrink',
    name: 'Shrink away',
    hint: 'Smaller copies into the distance',
    steps: 'Click the subject',
    patch: { layout: 'grid', across: 0, up: 5, spacing: [0.8, 0.3], fitPending: 'reach', stagger: 0, size: [0.85, 0.3], turn: [0, 0], opacity: [1, 0.45], behind: true, blend: 'normal' },
  },
  {
    id: 'path',
    name: 'Along a path',
    hint: 'Copies along a line you draw',
    steps: 'Click the subject, then draw the path',
    patch: { layout: 'path', path: [], count: 8, spacing: [1, 1], followPath: true, pieceOnPath: 'start', size: [1, 0.6], turn: [0, 0], opacity: [1, 0.4], behind: true, blend: 'normal' },
    path: true,
  },
]

/**
 * Ready-made starts, as one quiet row: a starting point, not the way the
 * module is meant to be used. Picking one sets it up and asks only for what
 * it needs (the subject, a path); everything stays adjustable.
 */
export function QuickEffects<P>({ title, effects, disabled, onPick }: { title: string; effects: QuickEffect<P>[]; disabled?: boolean; onPick: (e: QuickEffect<P>) => void }) {
  return (
    <div className="field valued quick-effects">
      <span title="Sets the module up for one of these, then asks for the subject">{title}</span>
      <select
        value=""
        disabled={disabled}
        aria-label={title}
        onChange={(e) => {
          const picked = effects.find((x) => x.id === e.target.value)
          if (picked) onPick(picked)
        }}
      >
        <option value="" disabled>
          Choose…
        </option>
        {effects.map((e) => (
          <option key={e.id} value={e.id} title={`${e.steps}.`}>
            {e.name}: {e.hint.charAt(0).toLowerCase() + e.hint.slice(1)}
          </option>
        ))}
      </select>
    </div>
  )
}
