import { useEffect, useRef, useState, type ReactNode } from 'react'
import appIcon from './assets/app-icon.png'
import { openUrl } from '../platform/native'
import { activate } from '../transfer/license'
import { DESKTOP_CHECKOUT, WEB_APP, emailLostKey, receiveTransfers } from '../transfer/transfer'

interface Props {
  /** 'start': first launch; 'invalid': the license stopped working. Nothing else until a key is in. 'change': from Settings, and can be closed. */
  mode: 'start' | 'invalid' | 'change'
  onDone: () => void
  onClose?: () => void
}

type Tab = 'license' | 'buy' | 'browser'

const TABS: { id: Tab; label: string; tint: string; glyph: ReactNode }[] = [
  {
    id: 'license',
    label: 'License',
    tint: '#6fc7a4',
    glyph: (
      <>
        <circle cx="7" cy="10" r="3.2" />
        <path d="M10.2 10H16.5M14.2 10v2.4M16.5 10v1.8" />
      </>
    ),
  },
  {
    id: 'buy',
    label: 'Buy',
    tint: '#e3b469',
    glyph: (
      <>
        <path d="M4.5 7.5h11l-.8 8.5H5.3z" />
        <path d="M7.5 7.5V6a2.5 2.5 0 0 1 5 0v1.5" />
      </>
    ),
  },
  {
    id: 'browser',
    label: 'Free version',
    tint: '#86a9e6',
    glyph: (
      <>
        <rect x="3" y="4.5" width="14" height="11" rx="2" />
        <path d="M3 8h14" />
      </>
    ),
  },
]

/**
 * The desktop app's license sheet, as small Mac apps ask on first launch: enter a
 * key, buy one, or use the free browser version. Activating also brings in an
 * edit sent from the browser version with the purchase.
 */
export function ActivateDialog({ mode, onDone, onClose }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<Tab>('license')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [bought, setBought] = useState(false)
  /** "Lost your key?": the field takes the email it was bought with, and the key is emailed there. */
  const [lost, setLost] = useState(false)
  const [email, setEmail] = useState('')
  const [note, setNote] = useState<string | null>(null)
  const closable = mode === 'change' && !!onClose

  useEffect(() => {
    if (tab === 'license') input.current?.focus()
  }, [tab, lost])
  useEffect(() => {
    if (!closable) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      e.stopImmediatePropagation()
      onClose?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [closable, onClose, busy])

  const submit = async () => {
    setError(null)
    setBusy('Activating…')
    let license
    try {
      license = await activate(key)
    } catch (e) {
      setError((e as Error).message)
      setBusy(null)
      return
    }
    // Bought from the browser version: its edit is waiting for this key.
    setBusy('Opening your edit from the browser…')
    try {
      if ((await receiveTransfers(license.key)) > 0) {
        location.reload()
        return
      }
    } catch {
      /* activated all the same; it can be brought in from Settings */
    }
    onDone()
  }

  const sendKey = async () => {
    setError(null)
    setBusy('Sending…')
    try {
      await emailLostKey(email.trim())
      setNote('If that email bought copyshop, the key is on its way.')
      setLost(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const primary = () => {
    if (busy) return
    if (tab === 'license' && lost) {
      if (email.trim()) void sendKey()
    } else if (tab === 'license') {
      if (key.trim()) void submit()
    } else if (tab === 'buy') {
      void openUrl(DESKTOP_CHECKOUT)
      setBought(true)
      setLost(false)
      setTab('license')
    } else {
      void openUrl(WEB_APP)
    }
  }

  const title = mode === 'change' ? 'Change license key' : 'Activate copyshop'
  const lede =
    mode === 'change'
      ? 'This computer moves over to the new key.'
      : mode === 'invalid'
        ? "The license on this computer isn't valid any more."
        : 'Enter your license key, or buy one.'

  const status = busy ?? error
  return (
    <div className="overlay intro-overlay" onClick={closable && !busy ? onClose : undefined}>
      <div className="intro-card activate-card" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        {closable && (
          <button className="intro-close" title="Close (Esc)" aria-label="Close" disabled={!!busy} onClick={onClose}>
            ×
          </button>
        )}
        <img className="intro-icon" src={appIcon} alt="" width={64} height={64} draggable={false} />
        <h2>{title}</h2>
        <p className="intro-lede">{lede}</p>

        <form
          className="activate-panel"
          onSubmit={(e) => {
            e.preventDefault()
            primary()
          }}
        >
          {mode !== 'change' && (
            <div className="activate-tabs" role="tablist">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`activate-tab${tab === t.id ? ' on' : ''}`}
                  style={{ ['--tint' as string]: t.tint }}
                  disabled={!!busy}
                  onClick={() => {
                    setTab(t.id)
                    setError(null)
                    setNote(null)
                  }}
                >
                  <span className="activate-glyph">
                    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden>
                      {t.glyph}
                    </svg>
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
          )}

          {/* Every tab's content in the same place, the others hidden: the panel
              is as tall as the tallest, so switching tabs never resizes it. */}
          <div className="activate-body">
            <div className={`activate-pane${tab === 'license' ? ' on' : ''}`} aria-hidden={tab !== 'license'}>
            {lost && (
              <label className="activate-key">
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
                  <rect x="3" y="5" width="14" height="10" rx="2" />
                  <path d="M3.5 6l6.5 5 6.5-5" />
                </svg>
                <input
                  ref={input}
                  type="email"
                  value={email}
                  placeholder="The email you bought it with"
                  aria-label="Email address"
                  spellCheck={false}
                  autoCapitalize="off"
                  disabled={!!busy}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                />
              </label>
            )}
            {!lost && (
              <label className="activate-key">
                <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden>
                  {TABS[0].glyph}
                </svg>
                <input
                  ref={input}
                  type="text"
                  value={key}
                  placeholder="License key"
                  aria-label="License key"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoComplete="off"
                  disabled={!!busy}
                  onChange={(e) => {
                    setKey(e.target.value)
                    setError(null)
                  }}
                />
              </label>
            )}
            </div>
            <div className={`activate-pane${tab === 'buy' ? ' on' : ''}`} aria-hidden={tab !== 'buy'}>
              <p>$19 one time, updates included, on up to three devices. Your key comes by email.</p>
            </div>
            <div className={`activate-pane${tab === 'browser' ? ' on' : ''}`} aria-hidden={tab !== 'browser'}>
              <p>Free in your browser. The desktop app adds RAW files, whole folders and a photo library.</p>
            </div>
          </div>
        </form>

        <div className={`activate-status${error ? ' error' : ''}`} role={error ? 'alert' : undefined}>
          {status ?? (
            <>
              <span className={`activate-pane${tab === 'license' ? ' on' : ''}`} aria-hidden={tab !== 'license'}>
              {lost ? (
                <button type="button" className="link inline-link" onClick={() => setLost(false)}>
                  Enter a key instead
                </button>
              ) : (
                <>
                  {note ?? (bought ? 'Paste the key from your email.' : 'Lost your key?')}{' '}
                  {!note && (
                    <button
                      type="button"
                      className="link inline-link"
                      onClick={() => {
                        setLost(true)
                        setError(null)
                      }}
                    >
                      Email it to me
                    </button>
                  )}
                </>
              )}
              </span>
              <span className={`activate-pane${tab === 'buy' ? ' on' : ''}`} aria-hidden={tab !== 'buy'}>
                Checkout opens in your browser.
              </span>
              <span className={`activate-pane${tab === 'browser' ? ' on' : ''}`} aria-hidden={tab !== 'browser'}>
                Edits made there can be brought into the desktop app later.
              </span>
            </>
          )}
        </div>

        <button
          type="button"
          className="primary intro-go"
          disabled={!!busy || (tab === 'license' && !(lost ? email : key).trim())}
          onClick={primary}
        >
          {tab === 'license' ? (lost ? 'Email my key' : 'Activate') : tab === 'buy' ? 'Buy for $19' : 'Open in your browser'}
        </button>
      </div>
    </div>
  )
}
