import { keyWords } from '../platform/os'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ModuleSwitch } from './controls'
import { useDragOrder } from './useDragOrder'

/** One thing a row's … menu does. */
export interface ItemAction {
  label: string
  onClick: () => void
  disabled?: boolean
  title?: string
  /** A line above it, apart from those before. */
  apart?: boolean
}

/** One thing in a list of things placed on the photo: a streak, a mask, a light, a fix. */
export interface Item {
  key: string
  name: ReactNode
  /** A small mark before the name: its kind or colour. */
  icon?: ReactNode
  /** What it is doing, briefly. */
  summary?: ReactNode
  /** On or off, if it can be switched off and kept. */
  on?: boolean
  onToggle?: () => void
  onRemove: () => void
  /** What × says it removes, for its tooltip. */
  label: string
  /** Being edited on the photo (its handles showing), and the pencil that turns that on and off. */
  editing?: boolean
  onEdit?: () => void
  /** What the pencil does, when it is more than editing it on the photo ("Select its subject again"). */
  editTitle?: string
  /** A copy of it, after it in the list (Duplicate, in its … menu); `full` says why not, when the list can take no more. */
  onDuplicate?: () => void
  full?: string
  /** More it can do, less often: in its … menu, after Duplicate. */
  actions?: ItemAction[]
  /** Small buttons after its name, outside the row's own button: a mask's modules. */
  badges?: ReactNode
}

/** Key presses a list has acted on: with two lists open, only one acts. */
const actedOn = new WeakSet<Event>()

interface Props {
  items: Item[]
  /** The one open: selected, its handles on the photo, its settings below it. */
  open: number | null
  onOpen: (index: number | null) => void
  /** The open one's settings. */
  children?: ReactNode
  /** Nothing in the list yet: what to say. */
  empty?: ReactNode
  /**
   * Something else has Esc and Delete for now (drawing or reshaping on the
   * photo, with its own keys): the list leaves them alone until it ends.
   */
  keysOff?: boolean
  /** Rows put in another order by dragging them (their names): row `from` moved to `to`. */
  onMove?: (from: number, to: number) => void
}

/** A row's … menu: Duplicate and the rest, closed by a click away or Esc. */
function RowMenu({ label, actions }: { label: string; actions: ItemAction[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Esc closes the menu, not the row too.
      actedOn.add(e)
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])
  return (
    <span className="menu-anchor item-more-anchor" ref={ref}>
      <button className={`item-more${open ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open} title={`More for ${label}`} aria-label={`More for ${label}`} onClick={() => setOpen(!open)}>
        <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
          <circle cx="3" cy="8" r="1.5" fill="currentColor" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
          <circle cx="13" cy="8" r="1.5" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu item-menu" role="menu">
          {actions.map((a, k) => (
            <div key={a.label} className="item-menu-entry">
              {a.apart && k > 0 && <div className="menu-rule" />}
              <button
                className="menu-item"
                role="menuitem"
                disabled={a.disabled}
                title={a.title}
                onClick={() => {
                  setOpen(false)
                  a.onClick()
                }}
              >
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </span>
  )
}

/**
 * The one way a module lists the things placed on the photo. A row each:
 * open it to see its settings under it. The pencil edits it on the photo
 * (its handles show) and stays lit while it does; again, or Esc, stops.
 * The … menu has Duplicate (a copy, next in the list) and what else it can
 * do. × removes it (Cmd+Z puts it back), and the switch, where there is
 * one, keeps it but turns it off. Esc closes the open one; Delete removes
 * it. Where the order matters, rows are dragged by their names.
 */
export function ItemList({ items, open, onOpen, children, empty, keysOff = false, onMove }: Props) {
  const listRef = useRef<HTMLDivElement>(null)
  const { dragging, startAt, dragClass } = useDragOrder(listRef, 'y', onMove && items.length > 1 ? onMove : null, 'y')
  // Esc closes the open one; Delete or Backspace removes it, when not typing.
  useEffect(() => {
    if (open === null || keysOff) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      // One list acts on each press; a key with Cmd, Ctrl or Option is something else.
      if (actedOn.has(e) || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key === 'Escape') {
        // The app's own Esc shortcut marks every Esc handled (it closes a window,
        // or stops comparing), so that cannot stop this one; a window open over
        // everything does. What has Esc for itself stops it from going on.
        if (document.querySelector('[role="dialog"]')) return
        // Editing on the photo stops first; then the row closes.
        const it = items[open]
        if (it?.editing && it.onEdit) it.onEdit()
        else onOpen(null)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (e.defaultPrevented || !items[open]) return
        items[open].onRemove()
      } else return
      actedOn.add(e)
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, items, onOpen, keysOff])

  if (!items.length) return empty ? <p className="hint-line">{empty}</p> : null
  return (
    <div className={`item-list${dragging ? ' reordering' : ''}`} ref={listRef}>
      {items.map((it, i) => {
        const isOpen = open === i
        const actions: ItemAction[] = [
          ...(it.onDuplicate ? [{ label: 'Duplicate', onClick: it.onDuplicate, disabled: !!it.full, title: it.full ?? `A copy of ${it.label}, next after it` }] : []),
          ...(it.actions ?? []),
        ]
        return (
          <div key={it.key} data-drag className={`item${isOpen ? ' open' : ''}${it.on === false ? ' off' : ''}${dragClass(i, items.length)}`}>
            <div className="item-row">
              <button
                className={`item-head${onMove && items.length > 1 ? ' draggable' : ''}`}
                aria-expanded={isOpen}
                title={onMove && items.length > 1 ? 'Click to open it; drag to move it up or down the list' : undefined}
                onPointerDown={startAt(i)}
                onClick={() => onOpen(isOpen ? null : i)}
              >
                <span className="disclosure-caret" aria-hidden />
                {it.icon}
                <span className="item-name">{it.name}</span>
                {it.summary && <span className="item-summary">{it.summary}</span>}
              </button>
              {it.badges}
              {it.onEdit && (
                <button
                  className={`item-edit${it.editing ? ' on' : ''}`}
                  aria-pressed={!!it.editing}
                  title={it.editing ? 'Stop editing on the photo (Esc)' : (it.editTitle ?? `Edit ${it.label} on the photo`)}
                  aria-label={it.editing ? 'Stop editing on the photo' : (it.editTitle ?? `Edit ${it.label} on the photo`)}
                  onClick={it.onEdit}
                >
                  <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
                    <path d="M3 13 L3 10 L10 3 L13 6 L6 13 Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
                  </svg>
                </button>
              )}
              {actions.length > 0 && <RowMenu label={it.label} actions={actions} />}
              <button className="item-remove" title={`Remove ${it.label} (${keyWords('Cmd+Z')} puts it back)`} aria-label={`Remove ${it.label}`} onClick={it.onRemove}>
                ×
              </button>
              {it.onToggle && <ModuleSwitch on={it.on !== false} onToggle={it.onToggle} label={it.label} />}
            </div>
            {isOpen && children && <div className="item-body">{children}</div>}
          </div>
        )
      })}
    </div>
  )
}
