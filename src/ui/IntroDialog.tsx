import { useEffect, useRef } from 'react'
import { ModuleGlyph } from './ModuleGlyph'
import appIcon from './assets/app-icon.png'

interface Props {
  /** The desktop app (a library); the browser has none. */
  app: boolean
  /** A photo is open already: no need to offer the tour on a sample. */
  hasImage: boolean
  onOpen: () => void
  /** The walk round: the editor on a sample photo, the Library, then opening their own. */
  onTour: () => void
  onClose: () => void
}

/** What you can make with it, each with its module's glyph in its page's colour. */
const FEATURES: { glyph: string; tint: string; text: string }[] = [
  { glyph: 'grain', tint: '#d6c6a2', text: 'Make a photo look like it was shot on film' },
  { glyph: 'streaks', tint: '#7fcdc4', text: 'Stretch a building, a person or a car into streaks' },
  { glyph: 'repeat', tint: '#7fcdc4', text: 'Repeat part of a photo, or mix in other photos' },
  { glyph: 'halftone', tint: '#b9b2a6', text: 'Turn a photo into a zine page, a print or pixel art' },
]

/**
 * A welcome sheet, as Mac apps show on first launch: the app's icon, a short
 * list of what you can make with it, and one button to begin (and a sample photo for
 * trying it without one). How it works is the walk round the app, in Help.
 * Shown the first time, and again from Help.
 */
export function IntroDialog({ app, hasImage, onOpen, onTour, onClose }: Props) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div className="overlay intro-overlay" onClick={onClose}>
      <div className="intro-card" role="dialog" aria-label="Welcome to copyshop" tabIndex={-1} ref={card} onClick={(e) => e.stopPropagation()}>
        <button className="intro-close" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
        <img className="intro-icon" src={appIcon} alt="" width={72} height={72} draggable={false} />
        <h2>Welcome to copyshop</h2>
        <p className="intro-lede">A workspace for playing with effects on your photos.</p>
        <ul className="intro-steps">
          {FEATURES.map((f) => (
            <li key={f.glyph}>
              <span className="intro-glyph" style={{ ['--tint' as string]: f.tint }}>
                <ModuleGlyph id={f.glyph} tint={f.tint} size={20} />
              </span>
              <p>{f.text}</p>
            </li>
          ))}
        </ul>
        <p className="intro-after">Save a look as a recipe and use it on a whole set.</p>
        <button
          className="primary intro-go"
          title={hasImage ? undefined : 'A walk round the editor on a sample photo, then where your photos go'}
          onClick={() => {
            onClose()
            onTour()
          }}
        >
          Show me around
        </button>
        <div className="intro-links">
          <button
            className="link"
            onClick={() => {
              onClose()
              // The browser: straight to opening one. The app: the Library, with its own Add a folder and Open photos.
              if (!hasImage && !app) onOpen()
            }}
          >
            {hasImage || app ? 'Skip' : 'Skip, and open a photo'}
          </button>
        </div>
      </div>
    </div>
  )
}
