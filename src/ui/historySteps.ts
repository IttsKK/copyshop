/**
 * The undo history as plain data, for useEditHistory and the History panel.
 *
 * `past` holds, for each step taken, the state before it; `future` holds,
 * for each step undone, the state after it, the next redo last. A step's
 * row in the list is the state after it: row 0 is the photo as opened, row
 * `past.length` is where the edit is now.
 */

export interface StepEntry<S> {
  state: S
  /** What the step changed, for the status line: "Undid …". */
  label: string
  /** The step's name in the History list. */
  title: string
  /** When the step was taken (ms since the epoch). */
  at: number
  /** Named when it was made (WHOLE_STEP), not from what it changed. */
  named: boolean
}

/**
 * Where `past` and `future` stand after moving to row `target`, as that many
 * undos or redos one after another would leave them, and the state to put
 * back. `now` is the state at the current row. Null if `target` is the
 * current row or out of range.
 */
export function travel<S, E extends { state: S }>(
  past: readonly E[],
  future: readonly E[],
  now: S,
  target: number,
): { past: E[]; future: E[]; state: S; moved: E[] } | null {
  if (!Number.isInteger(target) || target < 0 || target > past.length + future.length || target === past.length) return null
  const p = past.slice()
  const f = future.slice()
  const moved: E[] = []
  let cur = now
  while (p.length > target) {
    const e = p.pop()!
    f.push({ ...e, state: cur })
    moved.push(e)
    cur = e.state
  }
  while (p.length < target) {
    const e = f.pop()!
    p.push({ ...e, state: cur })
    moved.push(e)
    cur = e.state
  }
  return { past: p, future: f, state: cur, moved }
}

export interface HistoryStep {
  title: string
  at: number
}

export interface HistoryView {
  /** Oldest first: the photo as opened, then each step, undone ones included. */
  steps: HistoryStep[]
  /** The row the edit is at now; rows after it are undone and can be redone. */
  current: number
}

/** The first row: the photo as opened, or, once the oldest steps were dropped (HISTORY_LIMIT), as far back as undo goes. */
export const OPENED = 'Opened'
/** The first row for a photo that opened with the edit it was left with: undo stops there, not at the photo as it is. */
export const OPENED_EDITED = 'Opened with its edit'
export const OLDEST = 'Earlier steps'

export function historyView<S>(
  past: readonly StepEntry<S>[],
  future: readonly StepEntry<S>[],
  openedAt: number,
  trimmed: boolean,
  opened: string = OPENED,
): HistoryView {
  const steps: HistoryStep[] = [{ title: trimmed ? OLDEST : opened, at: openedAt }]
  for (const e of past) steps.push({ title: e.title, at: e.at })
  for (let i = future.length - 1; i >= 0; i--) steps.push({ title: future[i].title, at: future[i].at })
  return { steps, current: past.length }
}

export interface StepGroup {
  /** The row a click goes to: the newest in the group. */
  index: number
  /** The oldest row in the group. */
  first: number
  title: string
  count: number
  /** When the newest in the group was taken. */
  at: number
  /** Done and behind the current row, the current row, or undone. */
  when: 'past' | 'current' | 'future'
}

/**
 * Rows in runs of the same title, one group each (Grain: strength ×4), oldest
 * first. A run never crosses the current row: the current row ends its
 * group, so the group it heads is the one shown as current, and undone steps
 * group on their own.
 */
export function groupSteps(view: HistoryView): StepGroup[] {
  const out: StepGroup[] = []
  view.steps.forEach((s, i) => {
    const when = i < view.current ? 'past' : i === view.current ? 'current' : 'future'
    const last = out[out.length - 1]
    // The first row (Opened) is never part of a run.
    const joins = last && i > 1 && last.title === s.title && last.when !== 'current' && (last.when === when || (last.when === 'past' && when === 'current'))
    if (joins) {
      last.index = i
      last.count++
      last.at = s.at
      last.when = when
    } else out.push({ index: i, first: i, title: s.title, count: 1, at: s.at, when })
  })
  return out
}
