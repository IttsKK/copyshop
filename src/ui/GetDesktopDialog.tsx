import { useEffect, useRef } from 'react'
import { BuySection } from './DesktopAppSettings'

/** Export's "Get the desktop app", in the browser: what the app adds and the way to buy it. */
export function GetDesktopDialog({ onClose }: { onClose: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.focus(), [])
  return (
    <div className="overlay" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="overlay-card settings-card get-desktop" role="dialog" aria-label="Desktop app" tabIndex={-1} ref={card} onClick={(e) => e.stopPropagation()}>
        <header>
          <h2>Desktop app</h2>
          <button className="icon" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="settings-body">
          <BuySection />
        </div>
      </div>
    </div>
  )
}
