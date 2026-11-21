import { setBypass, setIgSim, setSmall, setZoom, useBypass, useIgSim, useSmall, useZoom } from './state/view'
import { keyLabel } from './shortcuts'

interface Props {
  /** The snapshot being compared, by name, or null. */
  comparing: string | null
  onStopComparing: () => void
}

/** The bar over the photo: Fit, 100%, the phone preview and the original. */
export function ViewBar({ comparing, onStopComparing }: Props) {
  const zoom = useZoom()
  const small = useSmall()
  const igSim = useIgSim()
  const bypass = useBypass()

  return (
    <div className="viewbar">
      <div className="segmented">
        <button className={!small && zoom === 'fit' ? 'on' : ''} title={`Fit (${keyLabel('cmd+0')})`} onClick={() => setZoom('fit')}>
          Fit
        </button>
        <button className={!small && zoom === 1 ? 'on' : ''} title={`100% (${keyLabel('cmd+1')}, or Z to switch with Fit)`} onClick={() => setZoom(1)}>
          100%
        </button>
      </div>
      {/* Its room is kept when there's nothing to say, so the buttons after it don't shift while zooming. */}
      <span className="zoom-readout" aria-hidden={small || typeof zoom !== 'number' || zoom === 1}>
        {!small && typeof zoom === 'number' && zoom !== 1 ? `${Math.round(zoom * 100)}%` : ''}
      </span>
      <button
        className={small ? 'on' : ''}
        title="The export downsized to 1080 px and shown small, about as it looks on a phone"
        onClick={() => setSmall(!small)}
      >
        Phone preview
      </button>
      <button
        className={small && igSim ? 'on' : ''}
        disabled={!small}
        title={small ? 'Also compress it the way Instagram does, which smears fine grain' : 'With Phone preview on: compress it the way Instagram does'}
        onClick={() => setIgSim(!igSim)}
      >
        Instagram compression
      </button>
      <button
        className={bypass ? 'on' : ''}
        title={`Hold to see the photo without the edit (or hold ${keyLabel('\\')})`}
        onPointerDown={() => setBypass(true)}
        onPointerUp={() => setBypass(false)}
        onPointerLeave={() => setBypass(false)}
      >
        Show original
      </button>
      {comparing && (
        <button className="on" onClick={onStopComparing}>
          Comparing: {comparing} ×
        </button>
      )}
    </div>
  )
}
