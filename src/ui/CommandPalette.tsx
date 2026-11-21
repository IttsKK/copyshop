import { useEffect, useMemo, useRef, useState } from 'react'
import { setPanelPage } from './state/layout'
import { track } from '../platform/usage'

export interface Command {
  id: string
  label: string
  /** Where it lives or what kind of thing it is, shown beside it. */
  group: string
  run: () => void
}

interface Props {
  open: boolean
  onClose: () => void
  /** Actions the app offers (looks, export, views…); settings are found on the page. */
  actions: Command[]
}

/** Open a folded section by its id (see Module). */
export const openModule = (id: string) => window.dispatchEvent(new CustomEvent('grain:open-module', { detail: id }))

/** Bring an element into view and flash it, so the eye finds it. */
function reveal(el: Element | null) {
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.remove('found')
  void (el as HTMLElement).offsetWidth
  el.classList.add('found')
  setTimeout(() => el.classList.remove('found'), 1600)
}

/** The settings on the page right now: sections, their groups and every labelled control. */
function settingsOnPage(): Command[] {
  const out: Command[] = []
  for (const section of document.querySelectorAll<HTMLElement>('section.module[id^="module-"], section.export-page[id^="module-"]')) {
    const id = section.id.slice('module-'.length)
    const exportPage = section.classList.contains('export-page')
    const title = (exportPage ? section.querySelector('.stack-title b') : section.querySelector('h2'))?.textContent ?? id
    // The Export page is a page of its own: going there first, then to the setting.
    const show = () => (exportPage ? setPanelPage('export') : openModule(id))
    out.push({
      id: `module:${id}`,
      label: title,
      group: 'Section',
      run: () => {
        show()
        requestAnimationFrame(() => reveal(section))
      },
    })
    for (const head of section.querySelectorAll<HTMLButtonElement>('.disclosure-head')) {
      const name = head.querySelector('span:nth-child(2)')?.textContent
      if (!name) continue
      out.push({
        id: `group:${id}:${name}`,
        label: name,
        group: title,
        run: () => {
          if (head.getAttribute('aria-expanded') !== 'true') head.click()
          requestAnimationFrame(() => reveal(head.closest('.disclosure')))
        },
      })
    }
    for (const field of section.querySelectorAll<HTMLElement>('.field')) {
      const name = field.querySelector(':scope > span')?.textContent?.trim()
      if (!name) continue
      const group = field.closest('.disclosure')?.querySelector('.disclosure-head span:nth-child(2)')?.textContent
      out.push({
        id: `field:${id}:${group ?? ''}:${name}`,
        label: name,
        group: group ? `${title} › ${group}` : title,
        run: () => {
          if (exportPage) setPanelPage('export')
          reveal(field)
          field.querySelector<HTMLElement>('input, select, button')?.focus({ preventScroll: true })
        },
      })
    }
  }
  return out
}

/** How well `query` matches `text`: letters in order, earlier and closer is better; -1 for no match. */
function score(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  const at = t.indexOf(q)
  if (at >= 0) return 1000 - at * 2 - t.length * 0.1
  let s = 0
  let from = 0
  for (const ch of q) {
    const i = t.indexOf(ch, from)
    if (i < 0) return -1
    s += i === from ? 6 : 1
    from = i + 1
  }
  return s - t.length * 0.1
}

/**
 * Cmd+K: find any setting or action by name and go to it. Settings are read
 * from the page as it is, so the list is always what the panels hold; a
 * folded section is opened when you pick it.
 */
export function CommandPalette({ open, onClose, actions }: Props) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const [page, setPage] = useState<Command[]>([])
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    setPage(settingsOnPage())
  }, [open])
  const results = useMemo(() => {
    const all = [...actions, ...page]
    if (!query.trim()) return all.slice(0, 40)
    return all
      .map((c) => ({ c, s: Math.max(score(query, c.label), score(query, `${c.group} ${c.label}`) - 50) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 40)
      .map((x) => x.c)
  }, [actions, page, query])
  useEffect(() => {
    list.current?.querySelector('.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])
  if (!open) return null
  const run = (c: Command | undefined) => {
    if (!c) return
    // The kind of command and what it is (module, setting, built-in recipe); a recipe of yours is "own".
    const [kind, ...rest] = c.id.split(':')
    track('command', kind, kind === 'preset' ? 'own' : rest.join(':') || null)
    onClose()
    // After the palette is gone, so focus lands where the command puts it.
    requestAnimationFrame(c.run)
  }
  return (
    <div className="palette-backdrop" onPointerDown={onClose}>
      <div className="command-palette" role="dialog" aria-label="Find a setting" onPointerDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          placeholder="Find a setting or action…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            // Esc, or the key that opened it, closes it.
            if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k')) {
              e.preventDefault()
              onClose()
            }
            else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(results.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') run(results[index])
          }}
        />
        <div className="command-list" ref={list} role="listbox">
          {results.length === 0 && <p className="hint-line">Nothing found</p>}
          {results.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === index}
              className={i === index ? 'on' : ''}
              onPointerEnter={() => setIndex(i)}
              onClick={() => run(c)}
            >
              <span>{c.label}</span>
              <em>{c.group}</em>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
