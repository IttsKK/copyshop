import { useEffect, useRef, useState } from 'react'
import { openUrl } from '../platform/native'
import { sendReport, telemetryOn } from '../platform/telemetry'
import { CONTACT, FEEDBACK_MAIL } from '../transfer/transfer'
import { track } from '../platform/usage'

interface Props {
  onClose: () => void
  /** The open edit's settings, to send along if they choose (never the photo). */
  edit?: () => unknown
  /** Shown above the form, e.g. after a crash. */
  lead?: string
  /** The crash this is about (its Sentry event), so what they write is kept with its report. */
  crash?: string
}

/**
 * Report a problem or send feedback, from inside the app: what happened, an
 * email if they want a reply, and the edit's settings if they agree. Goes to
 * Sentry with the app's version and platform. Email is offered as well.
 */
export function FeedbackDialog({ onClose, edit, lead, crash }: Props) {
  const [message, setMessage] = useState('')
  const [email, setEmail] = useState('')
  const [withEdit, setWithEdit] = useState(!!edit)
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | { error: string }>('idle')
  const card = useRef<HTMLDivElement>(null)
  useEffect(() => card.current?.querySelector('textarea')?.focus(), [])
  const canSend = telemetryOn()
  const send = async () => {
    if (!message.trim() || state === 'sending') return
    setState('sending')
    try {
      await sendReport({ message: message.trim(), email: email.trim() || undefined, edit: withEdit && edit ? edit() : undefined, crash })
      setState('sent')
      track('report_sent', crash ? 'crash' : null)
    } catch (e) {
      setState({ error: (e as Error).message })
    }
  }
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="overlay-card settings-card feedback-card"
        role="dialog"
        aria-label="Report a problem"
        tabIndex={-1}
        ref={card}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void send()
        }}
      >
        <header>
          <h2>Report a problem</h2>
          <button className="icon" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </header>
        {state === 'sent' ? (
          <div className="settings-body feedback-body">
            <p>Sent. Thanks for taking the time.</p>
            <div className="feedback-actions">
              <button className="primary" onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="settings-body feedback-body">
            {lead && <p className="feedback-lead">{lead}</p>}
            <label className="feedback-field">
              <span>What happened?</span>
              <textarea
                rows={5}
                maxLength={4000}
                value={message}
                placeholder="What you did, what you expected, and what happened instead. Ideas and requests are welcome too."
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <label className="feedback-field">
              <span>Your email, if you'd like a reply</span>
              <input type="email" value={email} placeholder="Optional" autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
            </label>
            {edit && (
              <label className="check-row">
                <input type="checkbox" checked={withEdit} onChange={(e) => setWithEdit(e.target.checked)} />
                Include this edit's settings (not the photo)
              </label>
            )}
            {typeof state === 'object' && <p className="feedback-error">{state.error}</p>}
            <div className="feedback-actions">
              <button className="link" onClick={() => void openUrl(FEEDBACK_MAIL)} title={`Write to ${CONTACT} instead`}>
                Email instead
              </button>
              <button className="primary" disabled={!message.trim() || state === 'sending' || !canSend} title={canSend ? undefined : 'Reports are sent from the released app'} onClick={() => void send()}>
                {state === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
            <p className="hint-line">Sent with the app version. Never your photos.</p>
          </div>
        )}
      </div>
    </div>
  )
}
