import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import controls, { examples, showcase } from 'virtual:guide-controls'
import { CATEGORIES, CATEGORY_BY_ID, MODULES, MODULE_BY_ID, type StackModuleId } from './moduleCatalog'
import { MODULE_HELP } from './moduleHelp'
import { ModuleGlyph } from './ModuleGlyph'
import { GUIDE_TOPICS, type GuideTopic } from './guideTopics'
import { Example, GUIDE_PAGES, Showcase } from './guidePages'
import { CloseIcon } from './icons'

/** A page of the Guide: a Getting started topic, or a module. */
export type GuidePage = `topic:${GuideTopic['id']}` | StackModuleId

interface Props {
  page: GuidePage
  onPage: (page: GuidePage) => void
  onClose: () => void
  /** The module in the panel, open. */
  onShow: (id: StackModuleId) => void
}

/** Categories in the rail's order, the base photo's corrections last. */
const ORDER = [...CATEGORIES.filter((c) => c.id !== 'base'), CATEGORY_BY_ID.base]

/** Everything a module's page says, for search: its name, what it does, its help and its controls. */
const words = (id: StackModuleId) => {
  const m = MODULE_BY_ID[id]
  const cs = (controls[id] ?? []).map((e) => (e.kind === 'group' ? e.text : `${e.name} ${e.text ?? ''} ${(e.options ?? []).map((o) => o.name).join(' ')}`))
  return `${m.title} ${m.blurb} ${m.keywords} ${MODULE_HELP[id].join(' ')} ${cs.join(' ')}`.toLowerCase()
}

/**
 * The Guide: how copyshop works, a page at a time. Getting started (the walk
 * round's own words, with a little more), then a page for every module: what
 * it does, what it does to this photo, and every control in it with what it
 * does, read from the module's own code so it is never out of date. A search
 * finds a page by anything on it. Opened from Help, ⌘K, and a module's ⋯ menu.
 */
export function Guide({ page, onPage, onClose, onShow }: Props) {
  const [query, setQuery] = useState('')
  const article = useRef<HTMLElement>(null)
  const q = query.trim().toLowerCase()
  const index = useMemo(() => new Map(MODULES.map((m) => [m.id, words(m.id)])), [])
  const topics = GUIDE_TOPICS.filter((t) => !q || t.title.toLowerCase().includes(q))
  const found = (id: StackModuleId) => !q || index.get(id)!.includes(q)

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (query) setQuery('')
      else onClose()
    }
    window.addEventListener('keydown', key, true)
    return () => window.removeEventListener('keydown', key, true)
  }, [query, onClose])
  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    article.current?.scrollTo(0, 0)
    // The page's own entry in the list, in view (opened on a module far down it).
    nav.current?.querySelector('.guide-nav-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [page])

  const navItem = (p: GuidePage, label: ReactNode, key: string) => (
    <button key={key} className={`guide-nav-item${page === p ? ' on' : ''}`} aria-current={page === p ? 'page' : undefined} onClick={() => onPage(p)}>
      {label}
    </button>
  )

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card guide-card" role="dialog" aria-label="Guide" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Guide</h2>
          <label className="search-field guide-search">
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
              <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input type="text" placeholder="Search the guide" aria-label="Search the guide" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="guide-body">
          <nav className="guide-nav" aria-label="Pages" ref={nav}>
            {topics.length > 0 && (
              <section>
                <h3>Getting started</h3>
                {topics.map((t) => navItem(`topic:${t.id}`, t.title, t.id))}
              </section>
            )}
            {ORDER.map((c) => {
              const mods = MODULES.filter((m) => m.category === c.id && found(m.id))
              if (!mods.length) return null
              return (
                <section key={c.id}>
                  <h3>
                    <i style={{ background: c.tint }} />
                    {c.label}
                  </h3>
                  {mods.map((m) =>
                    navItem(
                      m.id,
                      <>
                        <ModuleGlyph id={m.id} tint={c.tint} size={13} />
                        {m.title}
                      </>,
                      m.id,
                    ),
                  )}
                </section>
              )
            })}
            {q && !topics.length && !MODULES.some((m) => found(m.id)) && <p className="hint-line">Nothing in the guide mentions that.</p>}
          </nav>
          <article className="guide-page" ref={article} tabIndex={-1}>
            {page.startsWith('topic:') ? <TopicPage t={GUIDE_TOPICS.find((t) => `topic:${t.id}` === page) ?? GUIDE_TOPICS[0]} /> : <ModulePage id={page as StackModuleId} onShow={onShow} />}
          </article>
        </div>
      </div>
    </div>
  )
}

function TopicPage({ t }: { t: GuideTopic }) {
  return (
    <>
      <h1>{t.title}</h1>
      {GUIDE_PAGES[t.id]()}
    </>
  )
}

function ModulePage({ id, onShow }: { id: StackModuleId; onShow: (id: StackModuleId) => void }) {
  const m = MODULE_BY_ID[id]
  const c = CATEGORY_BY_ID[m.category]
  const entries = controls[id] ?? []
  return (
    <>
      <div className="guide-head" style={{ ['--tint' as string]: c.tint }}>
        <ModuleGlyph id={id} tint={c.tint} size={20} />
        <div>
          <h1>{m.title}</h1>
          <span className="guide-cat">{c.label}</span>
        </div>
        <button className="guide-show" onClick={() => onShow(id)}>
          Show {m.title}
        </button>
      </div>
      {MODULE_HELP[id].map((p) => (
        <p key={p}>{p}</p>
      ))}
      {/* Finished photos where it is used well, or else an example made ahead on a sample photo (scripts/guide/examples.sh). */}
      {showcase[id] ? showcase[id].map((n) => <Showcase key={n} id={id} n={n} />) : examples[id] && <Example id={id} photo={examples[id]} />}
      {entries.length > 0 && (
        <>
          <h2>Controls</h2>
          <dl className="guide-controls">
            {entries.map((e, i) =>
              e.kind === 'group' ? (
                <h3 key={i}>{e.text}</h3>
              ) : (
                <div key={i} className="guide-control">
                  <dt>{e.name}</dt>
                  <dd>
                    {e.text}
                    {e.options && (
                      <ul>
                        {e.options.map((o) => (
                          <li key={o.name}>
                            <b>{o.name}</b>
                            {o.text ? `: ${o.text}` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </dd>
                </div>
              ),
            )}
          </dl>
        </>
      )}
    </>
  )
}
