import { RestoreIcon } from './icons'
import { describeSnapshot, type Snapshot } from './snapshots'

interface Props {
  snapshots: Snapshot[]
  /** The one pinned for comparing, if any. */
  compareId: string | null
  canTake: boolean
  onTake: () => void
  /** Comparing and restoring use the snapshot's streaks, masks and collage too. */
  includePlaced: boolean
  onIncludePlaced: (on: boolean) => void
  /** Pointing at a snapshot compares it for as long as the pointer stays. */
  onHover: (id: string | null) => void
  onCompare: (id: string | null) => void
  onRestore: (id: string) => void
  onDelete: (id: string) => void
}

/**
 * Snapshots: point at one to see it beside where you are now (the wipe);
 * click to keep comparing; ↺ puts its settings back. Each is rendered once
 * for the current view and kept, and the rest are rendered ahead while the
 * app is idle (PreviewCanvas), so pointing down the list is quick.
 */
export function SnapshotsPanel({ snapshots, compareId, canTake, onTake, includePlaced, onIncludePlaced, onHover, onCompare, onRestore, onDelete }: Props) {
  return (
    <section className="snapshots-panel">
      <h2 title="A snapshot keeps the edit as it is now. Point at one to compare, click to keep comparing, ↺ to go back to it.">Snapshots</h2>
      <button className="primary" disabled={!canTake} onClick={onTake}>
        Take snapshot
      </button>
      <label
        className="check-row"
        title="Off: snapshots compare and restore only the settings, and the streaks, masks and collage stay as they are now. On: they bring back their own."
      >
        <input type="checkbox" checked={includePlaced} onChange={(e) => onIncludePlaced(e.target.checked)} />
        Include streaks, masks &amp; collage
      </label>
      <div className="snapshot-list" onPointerLeave={() => onHover(null)}>
        {snapshots.length === 0 && <p className="muted">No snapshots yet.</p>}
        {snapshots.map((snap) => (
          <div key={snap.id} className={compareId === snap.id ? 'snapshot on' : 'snapshot'}>
            <button
              className="snapshot-main"
              onPointerEnter={() => onHover(snap.id)}
              onFocus={() => onHover(snap.id)}
              onBlur={() => onHover(null)}
              onClick={() => onCompare(compareId === snap.id ? null : snap.id)}
            >
              <img src={snap.thumb} alt="" />
              <span>
                <strong>{snap.name}</strong>
                <em>{describeSnapshot(snap)}</em>
              </span>
            </button>
            <button className="icon-btn flush" title="Go back to this snapshot" onClick={() => onRestore(snap.id)}>
              <RestoreIcon />
            </button>
            <button className="icon" title="Delete snapshot" onClick={() => onDelete(snap.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
