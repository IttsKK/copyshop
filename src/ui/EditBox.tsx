import { createContext, useContext, useLayoutEffect, useSyncExternalStore, type ReactNode } from 'react'

/**
 * Editing on the photo, one thing at a time, as the panel shows it: what
 * is being edited, its tools (only the chosen one's handles are on the
 * photo), what to do now, and Cancel (back to how it was when it began)
 * and Done (what was done, one step to undo). App works out the one edit
 * there is (or none); the box shows it in the panel where it was started,
 * at the thing being edited, or at the top of its module when that thing
 * is not showing. Enter and Esc press Done and Cancel.
 */
export interface EditView {
  /** Where its box goes: the thing edited ('streaks/2', 'masks/m3', 'pick'). */
  at: string
  /** Where it goes when nothing at `at` is showing: its module (or list). */
  home: string
  /** What is edited: "Streak 1", "New mask", "Selecting a subject". */
  name: string
  tools?: { id: string; name: string }[]
  tool?: string
  onTool?: (id: string) => void
  /**
   * What to do now, in a few words ("Click round it"), and only where
   * nothing on the photo shows it yet. Never sentences: how each handle
   * works is its own tooltip.
   */
  hint?: ReactNode
  /** The tool's own few extras: Snap to edges, Finish line, Draw again. */
  extras?: ReactNode
  /** Missing: no Cancel (nothing to go back to). */
  onCancel?: () => void
  cancelTitle?: string
  /** Missing: no Done (it finishes by itself, as the dropper does). */
  onDone?: () => void
  doneTitle?: string
  doneDisabled?: boolean
}

export const EditViewContext = createContext<EditView | null>(null)

// Which boxes are showing, by `at`, so a module's own box knows to stand in.
const showing = new Map<string, number>()
let version = 0
const listeners = new Set<() => void>()
const changed = () => {
  version++
  listeners.forEach((l) => l())
}
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/**
 * The edit's box, if it belongs here: `at`, the place for the thing it is
 * for; or `home`, a module's (or list's) own place at its top, which shows
 * it only when its own place is not showing (folded away, say).
 * `children` go between the hint and the buttons (Part, More, Whole).
 */
export function EditBox({ at, home, children }: { at?: string; home?: string; children?: ReactNode }) {
  const view = useContext(EditViewContext)
  useSyncExternalStore(subscribe, () => version)
  useLayoutEffect(() => {
    if (!at) return
    showing.set(at, (showing.get(at) ?? 0) + 1)
    changed()
    return () => {
      const n = (showing.get(at) ?? 1) - 1
      if (n > 0) showing.set(at, n)
      else showing.delete(at)
      changed()
    }
  }, [at])
  if (!view) return null
  const mine = at !== undefined ? view.at === at : home !== undefined && view.home === home && !showing.has(view.at)
  if (!mine) return null
  if (import.meta.env.DEV && typeof view.hint === 'string' && view.hint.split(' ').length > 6) console.warn(`Edit box hint over six words: "${view.hint}"`)
  return (
    <div className="edit-box" role="group" aria-label={`${view.name}, on the photo`}>
      <div className="edit-box-head">{view.name}</div>
      {view.tools && view.tools.length > 1 && (
        <div className="segmented edit-box-tools" role="tablist">
          {view.tools.map((t) => (
            <button key={t.id} role="tab" aria-selected={view.tool === t.id} className={view.tool === t.id ? 'on' : ''} onClick={() => view.onTool?.(t.id)}>
              {t.name}
            </button>
          ))}
        </div>
      )}
      {view.hint && <p className="edit-box-hint">{view.hint}</p>}
      {view.extras && <div className="edit-box-extras">{view.extras}</div>}
      {children}
      {(view.onCancel || view.onDone) && (
        <div className="edit-box-actions">
          {view.onCancel && (
            <button title={view.cancelTitle ?? 'Put it back as it was when you started (Esc)'} onClick={view.onCancel}>
              Cancel
            </button>
          )}
          {view.onDone && (
            <button className="primary" disabled={view.doneDisabled} title={view.doneTitle ?? 'Keep the changes (Enter)'} onClick={view.onDone}>
              Done
            </button>
          )}
        </div>
      )}
    </div>
  )
}
