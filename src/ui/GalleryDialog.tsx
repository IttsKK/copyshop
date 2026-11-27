import { useEffect, useRef, useState } from 'react'
import { openUrl } from '../platform/native'
import { track } from '../platform/usage'
import { keptGalleryDetails, submitToGallery, type GalleryDetails } from './gallery'
import { CloseIcon } from './icons'

interface Props {
  /** The photo as it will be sent (gallery.ts galleryJpeg), made while the form is filled in. */
  photo: Promise<Blob>
  /** The built-in parts of its edit (galleryTools). */
  tools: string[]
  onClose: () => void
}

/**
 * Submit to Gallery (File menu, and the Library's menu on a photo): the photo
 * with its edit, how to be credited, an optional link and email, and the box
 * that says it's theirs to share. Sent, it gives the link that takes it down.
 * The playground's form says the same (src/web/Playground.tsx ShareForm).
 */
export function GalleryDialog({ photo, tools, onClose }: Props) {
  const [details, setDetails] = useState<GalleryDetails>(keptGalleryDetails)
  const [rights, setRights] = useState(false)
  const [blob, setBlob] = useState<Blob | null>(null)
  const [url, setUrl] = useState<string | null>(null)
  const [state, setState] = useState<'idle' | 'sending' | { sent: string } | { error: string }>('idle')
  const [copied, setCopied] = useState(false)
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.querySelector('input')?.focus(), [])
  useEffect(() => {
    let live = true
    let made: string | null = null
    photo.then(
      (b) => {
        if (!live) return
        made = URL.createObjectURL(b)
        setBlob(b)
        setUrl(made)
      },
      (err: Error) => live && setState({ error: `Could not make the photo: ${err.message}` }),
    )
    return () => {
      live = false
      if (made) URL.revokeObjectURL(made)
    }
  }, [photo])
  const ready = !!blob && details.credit.trim().length > 0 && rights && state !== 'sending'
  const send = async () => {
    if (!ready || !blob) return
    setState('sending')
    try {
      const remove = await submitToGallery(blob, details, tools)
      setState({ sent: remove })
      track('share_sent', 'desktop')
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }
  const sent = typeof state === 'object' && 'sent' in state ? state.sent : null
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="overlay-card settings-card feedback-card gallery-card"
        role="dialog"
        aria-label="Submit to Gallery"
        tabIndex={-1}
        ref={card}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <header>
          <h2>Submit to Gallery</h2>
          <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        <div className="settings-body feedback-body">
          <div className="gallery-photo">{url ? <img src={url} alt="The photo to submit" /> : <span className="hint-line">Making the photo…</span>}</div>
          {sent ? (
            <>
              <p>Sent. It shows in the gallery once it has been looked at.</p>
              <label className="feedback-field">
                <span>To take it down later, keep this link</span>
                <input readOnly value={sent} onFocus={(e) => e.currentTarget.select()} />
              </label>
              <div className="feedback-actions">
                <button
                  onClick={() =>
                    void navigator.clipboard?.writeText(sent).then(
                      () => setCopied(true),
                      () => setCopied(false),
                    )
                  }
                >
                  {copied ? 'Copied' : 'Copy link'}
                </button>
                <button className="primary" onClick={onClose}>
                  Done
                </button>
              </div>
            </>
          ) : (
            <>
              <label className="feedback-field">
                <span>Credit</span>
                <input value={details.credit} maxLength={60} placeholder="@instagram or your name" autoComplete="nickname" onChange={(e) => setDetails({ ...details, credit: e.target.value })} />
              </label>
              <label className="feedback-field">
                <span>Link</span>
                <input value={details.link} maxLength={300} placeholder="Optional" inputMode="url" onChange={(e) => setDetails({ ...details, link: e.target.value })} />
              </label>
              <label className="feedback-field">
                <span>Email</span>
                <input type="email" value={details.contact} maxLength={200} placeholder="Optional, not shown" autoComplete="email" onChange={(e) => setDetails({ ...details, contact: e.target.value })} />
              </label>
              <label className="check-row">
                <input type="checkbox" checked={rights} onChange={(e) => setRights(e.target.checked)} />I took this photo, and anyone in it is OK with it being shown
              </label>
              {typeof state === 'object' && 'error' in state && <p className="feedback-error">{state.error}</p>}
              <div className="feedback-actions">
                <button className="link" onClick={() => void openUrl('https://getcopyshop.com/gallery')}>
                  See the gallery
                </button>
                <button className="primary" disabled={!ready} onClick={() => void send()}>
                  {state === 'sending' ? 'Sending…' : 'Send'}
                </button>
              </div>
              <p className="hint-line">
                Each photo is looked at first, then may be shown in the gallery on getcopyshop.com and on copyshop's Instagram, credited to you. Its metadata is taken out.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
