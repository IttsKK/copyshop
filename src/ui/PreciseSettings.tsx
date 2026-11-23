import { useEffect, useState } from 'react'
import { track } from '../platform/usage'
import { isNative } from '../platform/native'
import { persistedStore, useStore } from './state/store'
import { bytesFor, checkPrecise, downloadPrecise, mlInfo, partsHere, preciseWantedStore, removePrecise, sizeLabel, stopPreciseDownload, usePrecise } from '../ml/precise/models'
import { closePrecise } from '../ml/precise/precise'

/**
 * Precise selection's models (src/ml/precise): download them, see how far
 * along, or remove them. Selecting uses them as soon as they are here.
 */
export function PreciseSettings({ onStatus }: { onStatus: (message: string) => void }) {
  const state = usePrecise()
  const [bytes, setBytes] = useState(() => bytesFor(['find', 'edge']))
  const [edgeHere, setEdgeHere] = useState(true)
  const [offered, setOffered] = useState(true)
  useEffect(() => {
    void checkPrecise()
    void partsHere().then((parts) => {
      setBytes(bytesFor(parts))
      setEdgeHere(parts.includes('edge'))
      setOffered(parts.length > 0)
    })
    void mlInfo()
  }, [])
  // Not offered where it would be slower than the small model (no native runtime, no WebGPU: Linux).
  if (!offered && state.kind !== 'installed') return null
  const note =
    state.kind === 'downloading'
      ? `Downloading… ${Math.floor((100 * state.done) / Math.max(1, state.total))}% of ${sizeLabel(state.total)}`
      : state.kind === 'installed'
        ? 'Downloaded'
        : state.kind === 'failed'
          ? state.message
          : `Not downloaded · ${sizeLabel(bytes)}`
  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3>Selection</h3>
      </div>
      <div className="settings-row">
        <span
          title={
            'Selects buildings, people and cars with a cleaner edge: Segment Anything 2.1 finds what you click, then looks again closer' +
            (edgeHere ? ', and BiRefNet traces its edge.' : '. (Tracing its edge as well needs a Mac with Apple silicon, or Windows.)') +
            ' The first answer shows at once; the sharper one a few seconds later. Runs on this computer; nothing is sent anywhere.'
          }
        >
          Precise subject selection
          <small className="settings-row-note"> · {note}</small>
        </span>
        {state.kind === 'downloading' ? (
          <button
            onClick={() => {
              stopPreciseDownload()
              preciseWantedStore.set(false)
              onStatus('Download stopped. What was finished is kept for next time.')
            }}
          >
            Stop
          </button>
        ) : state.kind === 'installed' ? (
          <button
            title="Delete the models. Selecting goes back to the small model the app comes with."
            onClick={async () => {
              closePrecise()
              await removePrecise()
              onStatus('Precise selection removed')
            }}
          >
            Remove
          </button>
        ) : (
          <button
            className={state.kind === 'failed' ? '' : 'primary'}
            onClick={async () => {
              preciseWantedStore.set(true)
              if (await downloadPrecise()) onStatus('Precise selection is ready')
            }}
          >
            {state.kind === 'failed' ? 'Try again' : 'Download'}
          </button>
        )}
      </div>
    </section>
  )
}

/** "No thanks" on the selection panel's offer: it is not offered there again (Settings and What's new still have it). */
const offerDismissedStore = persistedStore<boolean>('settings.preciseOfferDismissed', false)

/** The parts offered here and their size, once known; null where it isn't offered (partsHere: Linux). */
function useOffer(): { bytes: number } | null | undefined {
  const [offer, setOffer] = useState<{ bytes: number } | null | undefined>(undefined)
  useEffect(() => {
    if (!isNative()) return setOffer(null)
    void checkPrecise()
    void partsHere().then((parts) => setOffer(parts.length ? { bytes: bytesFor(parts) } : null))
  }, [])
  return offer
}

/** Download, or how far along it is, or that it's done: one button's worth (What's new). */
export function PreciseDownloadButton() {
  const state = usePrecise()
  const offer = useOffer()
  if (!offer) return null
  if (state.kind === 'installed') return <span className="hint-line">Downloaded</span>
  if (state.kind === 'downloading')
    return (
      <span className="hint-line">
        Downloading… {Math.floor((100 * state.done) / Math.max(1, state.total))}%{' '}
        <button className="link" onClick={() => stopPreciseDownload()}>
          Stop
        </button>
      </span>
    )
  return (
    <button
      className="link"
      title="Downloads in the background; Settings › Selection can remove it"
      onClick={() => {
        preciseWantedStore.set(true)
        track('precise_offer', 'whats_new')
        void downloadPrecise()
      }}
    >
      {state.kind === 'failed' ? 'Try the download again' : `Download (${sizeLabel(offer.bytes)})`}
    </button>
  )
}

/**
 * Offered where it matters: selecting a subject with the small model, a line
 * under the selection panel with Download and Not now (Not now hides it for
 * good; Settings › Selection still has it).
 */
export function PreciseOffer() {
  const state = usePrecise()
  const offer = useOffer()
  const dismissed = useStore(offerDismissedStore)
  if (!offer || dismissed || state.kind === 'installed' || state.kind === 'unknown') return null
  if (state.kind === 'downloading')
    return <p className="hint-line precise-offer">Downloading sharper selection… {Math.floor((100 * state.done) / Math.max(1, state.total))}%</p>
  return (
    <p className="hint-line precise-offer" title="Two larger models that select with a cleaner edge, run on this computer. Settings › Selection can remove them.">
      Sharper selection ({sizeLabel(offer.bytes)}):{' '}
      <button
        className="link"
        onClick={() => {
          preciseWantedStore.set(true)
          track('precise_offer', 'pick')
          void downloadPrecise()
        }}
      >
        Download
      </button>{' '}
      <button
        className="link"
        onClick={() => {
          track('precise_offer', 'dismissed')
          offerDismissedStore.set(true)
        }}
      >
        Not now
      </button>
    </p>
  )
}
