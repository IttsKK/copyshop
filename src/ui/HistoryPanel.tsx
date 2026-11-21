import { useLayoutEffect, useRef, type KeyboardEvent } from 'react'
import { useHistoryView, type HistorySource } from './history'
import { groupSteps, type StepGroup } from './historySteps'

interface Props {
  /** useEditHistory's result (only subscribe, view and jumpTo are used). */
  history: HistorySource
  /** The edit went to another step from here: its title, for the status line. */
  onJump?: (title: string, back: boolean) => void
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/**
 * History: the edit's steps, newest at the top. Click one (or move with the
 * arrow keys while the list has focus) to go back to it; the steps after it
 * stay, greyed, and come back as redo does until a new change drops them.
 * Runs of the same change show once, with how many (×3); a click goes to the
 * newest of them. Only this panel renders when the steps change.
 */
export function HistoryPanel({ history, onJump }: Props) {
  const view = useHistoryView(history)
  const groups = groupSteps(view)
  const at = groups.findIndex((g) => g.when === 'current')
  const list = useRef<HTMLDivElement>(null)

  const go = (g: StepGroup | undefined) => {
    if (!g || g.when === 'current') return
    const title = history.jumpTo(g.index)
    if (title !== null) onJump?.(title, g.when === 'past')
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return
    // Newest at the top: up is later, down is earlier.
    const to =
      e.key === 'ArrowUp' ? groups[at + 1] : e.key === 'ArrowDown' ? groups[at - 1] : e.key === 'Home' ? groups[groups.length - 1] : e.key === 'End' ? groups[0] : null
    if (to === null) return
    e.preventDefault()
    e.stopPropagation()
    go(to)
  }

  // Keep the current step in view inside the list, without scrolling the panel around it.
  useLayoutEffect(() => {
    const box = list.current
    const row = box?.querySelector<HTMLElement>('.history-row.current')
    if (!box || !row) return
    // The list is positioned, so a row's offsetTop is measured from it.
    const top = row.offsetTop
    if (top < box.scrollTop) box.scrollTop = top
    else if (top + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = top + row.offsetHeight - box.clientHeight
  }, [view])

  const undone = groups.some((g) => g.when === 'future')
  return (
    <section className="history-panel">
      <h2>History</h2>
      <div
        ref={list}
        className="history-list"
        role="listbox"
        aria-label="Edit history, newest first"
        aria-activedescendant={at >= 0 ? `history-step-${groups[at].index}` : undefined}
        tabIndex={0}
        onKeyDown={onKey}
      >
        {groups
          .map((g) => (
            <div
              key={g.first}
              id={`history-step-${g.index}`}
              role="option"
              aria-selected={g.when === 'current'}
              className={`history-row ${g.when}${g.index === 0 ? ' opened' : ''}`}
              title={g.count > 1 ? `${g.count} steps, the last at ${time(g.at)}` : time(g.at)}
              onClick={() => go(g)}
            >
              <span className="history-title">{g.title}</span>
              {g.count > 1 && <span className="history-count">×{g.count}</span>}
            </div>
          ))
          .reverse()}
      </div>
      {groups.length === 1 && <p className="muted history-note">No changes yet.</p>}
      {undone && <p className="muted history-note">Greyed steps come back with redo until you make a change.</p>}
    </section>
  )
}
