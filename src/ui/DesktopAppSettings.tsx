import { useEffect, useRef, useState } from 'react'
import { ask, isNative, openUrl } from '../platform/native'
import { BUY_URL, OFFICIAL } from '../platform/build'
import { deactivate, loadLicense, onLicense, requestLicenseChange, type License } from '../transfer/license'
import { DESKTOP_CHECKOUT, checkoutWithEdit, newPairing, receivePairing, type Pairing } from '../transfer/transfer'

interface Props {
  onStatus: (message: string) => void
}

/**
 * In the browser: buying the desktop app, with the open photo, its edit and the
 * libraries sent along so the app opens on them. In the app: the license once
 * it's in (the key itself is asked for by ActivateDialog), and bringing in the
 * browser version's edits at any time.
 */
export function DesktopAppSettings({ onStatus }: Props) {
  return isNative() ? <LicenseSection onStatus={onStatus} /> : <BuySection />
}

/** Buying the desktop app from the browser: also shown by Export when a setting needs the app (GetDesktopDialog). */
export function BuySection() {
  const [bring, setBring] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const buy = async () => {
    setError(null)
    if (!bring) return void (location.href = DESKTOP_CHECKOUT)
    setBusy(true)
    try {
      location.href = await checkoutWithEdit()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3>Desktop app</h3>
      </div>
      <div className="settings-row">
        <span>
          copyshop Desktop <small className="muted">$19, one time</small>
        </span>
        <button onClick={buy} disabled={busy}>
          {busy ? 'Sending your edit…' : 'Buy'}
        </button>
      </div>
      <p className="settings-note">Adds full-size and PNG exports, RAW files, an export folder that keeps your originals, editing a whole folder at once, and a photo library.</p>
      <label className="check-row">
        <input type="checkbox" checked={bring} disabled={busy} onChange={(e) => setBring(e.target.checked)} />
        Open this photo and its edit in the desktop app, with your other photos' edits, recipes, plates and collage photos
      </label>
      {bring && (
        <p className="settings-note">
          They're encrypted and sent to copyshop's server, which keeps the key apart from them so it can hand both to the desktop app once you enter your license there. They're deleted when the app picks them up, or after 7 days.
        </p>
      )}
      {error && (
        <div className="settings-row">
          <span className="settings-note">{error}</span>
          <button onClick={() => (location.href = DESKTOP_CHECKOUT)}>Buy without them</button>
        </div>
      )}
    </section>
  )
}

function LicenseSection({ onStatus }: Props) {
  const [license, setLicense] = useState<License | null | undefined>(undefined)
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const waiting = useRef<AbortController | null>(null)

  useEffect(() => {
    const load = () => void loadLicense().then((l) => setLicense(l ?? null))
    load()
    const off = onLicense(load)
    return () => {
      off()
      waiting.current?.abort()
    }
  }, [])

  const bringIn = async () => {
    const p = newPairing()
    const ctrl = new AbortController()
    waiting.current?.abort()
    waiting.current = ctrl
    setPairing(p)
    await openUrl(p.url)
    try {
      await receivePairing(p, ctrl.signal)
      onStatus('Opening your edits from the browser.')
      setTimeout(() => location.reload(), 600)
    } catch (e) {
      if (!ctrl.signal.aborted) onStatus(`Your edits from the browser didn't come across: ${(e as Error).message}`)
    } finally {
      if (waiting.current === ctrl) {
        waiting.current = null
        setPairing(null)
      }
    }
  }

  if (license === undefined) return null
  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3>License</h3>
      </div>
      {/* A build from the source: no key, no updates; where to buy it, quietly (platform/build.ts). */}
      {!OFFICIAL ? (
        <div className="settings-row">
          <span>
            Built from source <small className="muted">no updates</small>
          </span>
          <button onClick={() => void openUrl(BUY_URL)}>Buy copyshop</button>
        </div>
      ) : license ? (
        <div className="settings-row">
          <span>
            Activated <small className="muted">{license.displayKey}</small>
          </span>
          <div className="settings-buttons">
            <button onClick={requestLicenseChange}>Change…</button>
            <button
              title="Free this computer's activation, so the key can be used on another one"
              onClick={async () => {
                if (!(await ask('Remove the license from this computer? copyshop asks for a key again until one is entered.'))) return
                await deactivate()
              }}
            >
              Remove
            </button>
          </div>
        </div>
      ) : (
        <div className="settings-row">
          <span className="muted">Not activated</span>
          <button onClick={requestLicenseChange}>Enter key…</button>
        </div>
      )}
      <div className="settings-row">
        <span>Edits from the browser version</span>
        {pairing ? (
          <button onClick={() => waiting.current?.abort()}>Stop waiting</button>
        ) : (
          <button title="Open the browser version, which sends its photo, edits, recipes and plates here" onClick={() => void bringIn()}>
            Bring in…
          </button>
        )}
      </div>
      {pairing ? (
        <p className="settings-note">
          Waiting for the browser. Press Send there. If your edits are in a different browser, open this link in it:{' '}
          <button className="link inline-link" onClick={() => void navigator.clipboard.writeText(pairing.url).then(() => onStatus('Link copied.'))}>
            Copy link
          </button>
        </p>
      ) : (
        <p className="settings-note">Brings in the photo open in the browser version, every photo's edit, and your recipes, plates and collage photos.</p>
      )}
    </section>
  )
}
