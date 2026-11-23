import { useEffect, useRef } from 'react'
import { ModuleGlyph } from './ModuleGlyph'
import { PreciseDownloadButton } from './PreciseSettings'
import { CATEGORY_BY_ID, MODULE_BY_ID } from './moduleCatalog'
import { KIND_ORDER, RELEASES, type ChangeKind, type NewThing, type Release, useIsNew, whereIs } from './whatsNew'
import type { StackModuleId } from './moduleCatalog'
import { CloseIcon, FixedIcon, ImprovedIcon, NewIcon } from './icons'

interface Props {
  /** The releases to show (since the version updated from); missing, every release. */
  releases?: Release[]
  onClose: () => void
  /** A new module shown where it lives in the panel, open. */
  onShowModule: (id: string) => void
}

/** Each kind's mark and its name on the tag. */
const KINDS: Record<ChangeKind, { label: string; Icon: () => React.JSX.Element }> = {
  new: { label: 'New', Icon: NewIcon },
  improved: { label: 'Improved', Icon: ImprovedIcon },
  fixed: { label: 'Fixed', Icon: FixedIcon },
}

/** A release's things in the order they're listed: new (modules first), then improved, then fixed. */
const inOrder = (things: NewThing[]) =>
  KIND_ORDER.flatMap((k) => things.filter((t) => t.kind === k).sort((a, b) => Number(!!b.module) - Number(!!a.module)))

const when = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

/**
 * What's new: each release's things, newest release first, each marked as
 * new, improved or fixed (whatsNew.ts). A module is named and pictured as the
 * panel has it, with where it is and Show me; anything else, with where it
 * is found.
 */
export function WhatsNewDialog({ releases = RELEASES, onClose, onShowModule }: Props) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.focus(), [])
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="overlay-card settings-card whats-new" role="dialog" aria-label="What's new" tabIndex={-1} ref={card} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>What’s new</h2>
          <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="settings-body">
          {releases.map((r) => (
            <section key={r.version} className="whats-new-release">
              <h3>
                copyshop {r.version} <small>{when(r.date)}</small>
              </h3>
              <ul>
                {inOrder(r.things).map((t, i) => {
                  const def = t.module ? MODULE_BY_ID[t.module] : undefined
                  const kind = KINDS[t.kind]
                  return (
                    <li key={i} className={`whats-new-thing kind-${t.kind}`}>
                      <span className="whats-new-mark">{def ? <ModuleGlyph id={def.id} tint={CATEGORY_BY_ID[def.category].tint} size={16} /> : <kind.Icon />}</span>
                      <div>
                        <b>
                          {def ? def.title : t.title}
                          <span className="whats-new-kind">{def && t.kind === 'new' ? 'New module' : kind.label}</span>
                        </b>
                        <p>{t.line}</p>
                        {(def || t.where) && (
                          <p className="whats-new-where">
                            {def ? whereIs(def.id) : t.where}
                            {def && (
                              <button
                                className="link"
                                title={`Show ${def.title} in the panel, open`}
                                onClick={() => {
                                  onShowModule(def.id)
                                  onClose()
                                }}
                              >
                                Show me
                              </button>
                            )}
                          </p>
                        )}
                        {t.download === 'precise' && (
                          <p className="whats-new-where">
                            <PreciseDownloadButton />
                          </p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * A module's New tag, while it is new in this version and not yet opened
 * (whatsNew.ts). `dot`: a dot alone, where its name has no room to spare (a
 * module's header).
 */
export function NewTag({ id, dot = false }: { id: StackModuleId; dot?: boolean }) {
  if (!useIsNew(id)) return null
  const title = "New in this version: it goes once you've opened it"
  return dot ? <span className="new-dot" title={title} aria-label="New" /> : <span className="new-tag" title={title}>New</span>
}
