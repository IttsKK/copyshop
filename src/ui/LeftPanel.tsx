import type { ComponentProps } from 'react'
import type { BlendParams } from '../engine/types'
import type { HistorySource } from './history'
import { HistoryPanel } from './HistoryPanel'
import { MasksPanel } from './MasksPanel'
import { Resizer } from './Resizer'
import { SnapshotsPanel } from './SnapshotsPanel'
import { DEFAULT_LEFT, setLeftWidth, useLeftWidth } from './state/layout'

interface Props {
  hasImage: boolean
  /** The edit, to say when its shapes sit on the whole print. */
  blend: BlendParams
  /** Pin the streaks and masks to the photo: the border no longer moves them. */
  onPinShapes: () => void
  masks: ComponentProps<typeof MasksPanel>
  snapshots: ComponentProps<typeof SnapshotsPanel>
  history: HistorySource
  /** Animating out (useLingering): shown a moment longer. */
  closing?: boolean
}

/** The left panel: masks, snapshots and the history, once a photo is open. */
export function LeftPanel({ hasImage, blend, onPinShapes, masks, snapshots, history, closing = false }: Props) {
  const leftWidth = useLeftWidth()
  return (
    <aside className={`panel left${closing ? ' closing' : ''}`}>
      <div className="panel-body">
        {!hasImage ? (
          <p className="muted panel-empty">Open a photo to use masks, snapshots and history.</p>
        ) : (
        <>
        {blend.effects.shapeSpace === 'print' && (blend.effects.streaks.shapes.length > 0 || blend.effects.masks.length > 0) && (
          <div className="note-box">
            <p>
              This edit places its streaks and masks on the whole print, border included, so changing the border
              moves them off what they were drawn on.
            </p>
            <button
              title="Pin streaks and masks to the photo, where they sit without a border: the border no longer moves them"
              onClick={onPinShapes}
            >
              Pin shapes to the photo
            </button>
          </div>
        )}
        <MasksPanel {...masks} />
        <SnapshotsPanel {...snapshots} />
        <HistoryPanel history={history} />
        </>
        )}
      </div>
      <Resizer
        side="left"
        width={leftWidth}
        min={200}
        max={460}
        onResize={setLeftWidth}
        onReset={() => setLeftWidth(DEFAULT_LEFT)}
      />
    </aside>
  )
}
