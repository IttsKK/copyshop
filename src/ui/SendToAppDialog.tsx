import { useEffect, useRef, useState } from 'react'
import appIcon from './assets/app-icon.png'
import { sendToApp } from '../transfer/transfer'

interface Props {
  pairing: { id: string; key: string }
  onClose: () => void
}

/**
 * The browser version, opened by the desktop app's "Bring in edits from the
 * browser": sends what this browser has to the app that's waiting for it.
 */
export function SendToAppDialog({ pairing, onClose }: Props) {
  const [state, setState] = useState<'ask' | 'sending' | 'sent' | 'empty' | 'error'>('ask')
  const [error, setError] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => button.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || state === 'sending') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, state])

  const send = async () => {
    setState('sending')
    try {
      setState((await sendToApp(pairing)) ? 'sent' : 'empty')
    } catch (e) {
      setError((e as Error).message)
      setState('error')
    }
  }

  const text = {
    ask: "This sends the photo that's open here and its edit, every photo's saved edit, your recipes, plates and collage photos. They're encrypted with a key only your computer has, so copyshop's server can't open them.",
    sending: 'Sending…',
    sent: 'Sent. copyshop on your computer is opening them, and you can close this tab.',
    empty:
      "There's nothing saved in this browser to send. If you edited in a different browser, copy this page's address from the bar and open it there.",
    error,
  }[state]

  return (
    <div className="overlay intro-overlay" onClick={state === 'sending' ? undefined : onClose}>
      <div className="intro-card activate-card" role="dialog" aria-label="Send to the desktop app" onClick={(e) => e.stopPropagation()}>
        <img className="intro-icon" src={appIcon} alt="" width={72} height={72} draggable={false} />
        <h2>{state === 'sent' ? 'Sent to the desktop app' : 'Send to the desktop app'}</h2>
        <p className="intro-lede" role={state === 'error' ? 'alert' : undefined}>
          {text}
        </p>
        {state === 'ask' || state === 'sending' || state === 'error' ? (
          <>
            <button ref={button} className="primary intro-go" disabled={state === 'sending'} onClick={() => void send()}>
              {state === 'error' ? 'Try again' : 'Send'}
            </button>
            <div className="intro-links">
              <button className="link" disabled={state === 'sending'} onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        ) : (
          <button ref={button} className="primary intro-go" onClick={onClose}>
            Done
          </button>
        )}
      </div>
    </div>
  )
}
