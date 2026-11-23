import { useEffect, useState } from 'react'
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
  useEffect(() => {
    void checkPrecise()
    void partsHere().then((parts) => {
      setBytes(bytesFor(parts))
      setEdgeHere(parts.includes('edge'))
    })
    void mlInfo()
  }, [])
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
            (edgeHere ? ', and BiRefNet traces its edge.' : '. (Tracing the edge needs a Mac with Apple silicon.)') +
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
