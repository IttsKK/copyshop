import { shortcutDisplay, type Shortcut } from './shortcuts'
import { CloseIcon } from './icons'

interface Props {
  shortcuts: Shortcut[]
  onClose: () => void
  /** Show how the app works (the intro). */
  onIntro?: () => void
  /** Report a problem or send feedback. */
  onReport?: () => void
  /** The walk round the app. */
  onTour?: () => void
  /** The Guide: how everything works, a page for every module. */
  onGuide?: () => void
}

export function ShortcutsOverlay({ shortcuts, onClose, onIntro, onReport, onTour, onGuide }: Props) {
  const groups = new Map<string, Shortcut[]>()
  for (const s of shortcuts.filter((x) => !x.unlisted)) {
    const list = groups.get(s.group) ?? []
    list.push(s)
    groups.set(s.group, list)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card shortcuts-card" role="dialog" aria-label="Keyboard shortcuts" onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Keyboard shortcuts</h2>
          {onGuide && (
            <button className="link shortcuts-intro" onClick={onGuide}>
              Guide
            </button>
          )}
          {onIntro && (
            <button className="link shortcuts-intro" onClick={onIntro}>
              How copyshop works
            </button>
          )}
          {onTour && (
            <button className="link shortcuts-intro" onClick={onTour}>
              Show me around
            </button>
          )}
          {onReport && (
            <button className="link shortcuts-intro" onClick={onReport}>
              Report a problem
            </button>
          )}
          <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="overlay-groups">
          {[...groups].map(([group, items]) => (
            <section key={group}>
              <h3>{group}</h3>
              {items.map((s) => (
                <div className="shortcut-row" key={s.key}>
                  <kbd>{shortcutDisplay(s)}</kbd>
                  <span>
                    {s.label}
                    {s.onUp && <em> — hold</em>}
                  </span>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
