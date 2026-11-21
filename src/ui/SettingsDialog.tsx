import { useEffect, useRef } from 'react'

interface Props {
  onClose: () => void
  children: React.ReactNode
}

/** The app's settings (Cmd+,): things set once, not part of an edit. */
export function SettingsDialog({ onClose, children }: Props) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.focus(), [])
  return (
    <div className="overlay" onClick={onClose}>
      <div className="overlay-card settings-card" role="dialog" aria-label="Settings" tabIndex={-1} ref={card} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Settings</h2>
          <button className="icon" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settings-body">{children}</div>
      </div>
    </div>
  )
}
