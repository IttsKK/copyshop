import { useEffect, useRef, useState, type ReactNode } from 'react'
import { RepeatCopiesPicture } from './SettingPictures'
import { AngleDial } from './AngleDial'
import { DEFAULT_REPEAT, repeatCopyCount, type RepeatParams } from '../engine/repeatParams'
import type { MaskShape } from '../engine/types'
import { ModuleActions, RangeSlider, Slider } from './controls'
import { MaskGlyph, type AddKind } from './maskKinds'

interface Props {
  /** The box of an edit going on in this repeat (its pencil, EditBox), shown over its tabs, as a streak's is. */
  editBox?: ReactNode
  /** The box for setting its path or placed copies on the photo, where its button is (EditBox). */
  pathBox?: ReactNode
  repeat: RepeatParams
  /** What it copies: its own piece (or, from an older edit, a mask from the Masks list). */
  piece: MaskShape | null
  /** The Masks list's masks. */
  masks: MaskShape[]
  hasImage: boolean
  /** No room for another mask. */
  full: boolean
  /** Its points being set on the photo (path or placed). */
  editing: boolean
  onEdit: () => void
  /** `step` names the edit, so a slider's drag is one step to undo. */
  onChange: (patch: Partial<RepeatParams>, step: string) => void
  /** Space the grid's copies so the last reaches the photo's edge. */
  onFit?: () => void
  /** The copies' perspective from the subject's own edges (vanish); perspective on or off. */
  onLineUp?: () => void
  onPerspective?: (on: boolean) => void
  /** No piece (it was lost): make one for this repeat. */
  onSelectSubject: () => void
  onDraw: () => void
  onPaint: () => void
  /** Its piece's outline being reshaped on the photo, and starting or stopping that. */
  pieceEditing: boolean
  onEditPiece: (() => void) | null
  /** Its own piece, a selection, made into points to reshape by hand. */
  onPieceToPoints?: (() => void) | null
  /** Its own piece's settings (brush, select again, edge), or the selection under way. */
  pieceBody: ReactNode
  /** Its piece being brushed in or out on the photo. */
  brushingPiece: boolean
  /** The Piece tab left: stop brushing or reshaping it. */
  onStopPiece: () => void
  /** While the Piece tab shows (or the piece is brushed or reshaped), the piece shows on the photo. */
  onPieceShown?: (shown: boolean) => void
}

type RepeatTab = 'layout' | 'copies' | 'blend' | 'piece'

/** Most copies along a path (its Copies slider's end). */
const PATH_MOST = 40

/**
 * Switching between Grid and Path keeps how many copies there are: a grid's
 * copies become as many along the path, and a path's as many in the grid's
 * one row or column. A grid of rows and columns at once is left as it is.
 */
function sameCopies(r: RepeatParams, to: RepeatParams['layout']): Partial<RepeatParams> {
  // A path not drawn yet is given one to start from (fitRepeat), so the copies show at once.
  if (r.layout === 'grid' && to === 'path') return { count: Math.max(1, Math.min(PATH_MOST, repeatCopyCount(r))), ...(r.path.length ? {} : { fitPending: 'reach' as const }) }
  if (to === 'path' && !r.path.length) return { fitPending: 'reach' }
  if (r.layout === 'path' && to === 'grid') {
    // One row or column only: there the count reads straight across.
    if (r.across !== 0 && r.up !== 0) return {}
    const n = Math.max(1, Math.min(20, Math.round(r.both ? r.count / 2 : r.count)))
    return r.across !== 0 ? { across: Math.sign(r.across) * n } : { up: (Math.sign(r.up) || 1) * n }
  }
  return {}
}

const pct = (v: number) => `${Math.round(v * 100)}%`
const signedPct = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}%`
const count = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`

const MAKE: { kind: AddKind; name: string; line: string; title: string }[] = [
  { kind: 'subject', name: 'Select subject', line: 'Drag a box round it or click it', title: 'A model on this computer finds the subject and its edge (Settings → Selection has a precise one)' },
  { kind: 'outline', name: 'Draw outline', line: 'Click points round it', title: 'Click points round what to copy. Double-click or Enter closes it.' },
  { kind: 'paint', name: 'Paint', line: 'Brush it on by hand', title: 'Paint over what to copy, on the photo' },
]

/**
 * Repeat: copies of a piece of the photo. The piece is its own, picked out
 * here as a mask is (selected, drawn round or painted) but kept in Repeat,
 * not the Masks list; or it copies a mask from the list. The copies go on a
 * grid, along a drawn path, or where they are placed, each a step on from
 * the one before in size, turn and opacity.
 */
export function RepeatPanel({
  editBox,
  pathBox,
  repeat: r,
  piece,
  hasImage,
  full,
  editing,
  onEdit,
  onChange,
  onFit,
  onLineUp,
  onPerspective,
  onSelectSubject,
  onDraw,
  onPaint,
  pieceEditing,
  onEditPiece,
  onPieceToPoints,
  pieceBody,
  brushingPiece,
  onStopPiece,
  onPieceShown,
}: Props) {
  const [tab, setTab] = useState<RepeatTab>('layout')
  // A piece just made: its tab, to brush it, match it to the photo, soften
  // it; not one that comes back with a photo reopened.
  const hadPiece = useRef(!!piece)
  useEffect(() => {
    if (piece && !hadPiece.current) setTab('piece')
    hadPiece.current = !!piece
  }, [piece])
  // Brushing or reshaping the piece (from elsewhere): its tab.
  useEffect(() => {
    if (brushingPiece || pieceEditing) setTab('piece')
  }, [brushingPiece, pieceEditing])
  // Setting the path on the photo: the layout's tab, the copies untinted.
  useEffect(() => {
    if (editing) setTab('layout')
  }, [editing])
  const pieceShown = !!piece && (tab === 'piece' || pieceEditing || brushingPiece)
  useEffect(() => {
    onPieceShown?.(pieceShown)
    return () => onPieceShown?.(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieceShown])
  const choose = (next: RepeatTab) => {
    if (tab === 'piece' && next !== 'piece') onStopPiece()
    setTab(next)
  }
  const set = (patch: Partial<RepeatParams>, step = Object.keys(patch).join(',')) => onChange(patch, `repeat:${step}`)
  const tabs: [RepeatTab, string][] = [
    ['layout', 'Layout'],
    ['copies', 'Copies'],
    ['blend', 'Blend'],
    ['piece', 'Original'],
  ]
  return (
    <>
      {editBox}
      <div className="segmented streak-tabs repeat-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? 'on' : ''} onClick={() => choose(id)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'piece' &&
        (piece ? (
          <>
            {piece.owner && (onEditPiece || onPieceToPoints) && (
              <div className="row">
                {onEditPiece && (
                  <button className={pieceEditing ? 'on' : ''} disabled={!hasImage} title="Drag its points on the photo" onClick={onEditPiece}>
                    Reshape on the photo
                  </button>
                )}
                {onPieceToPoints && (
                  <button title="Make the selection into points round its edge, to reshape by dragging them" onClick={onPieceToPoints}>
                    Turn into points
                  </button>
                )}
              </div>
            )}
            {pieceBody}
          </>
        ) : (
          <>
            <p className="hint-line">Nothing to copy yet</p>
            {pieceBody ?? <RepeatMakers hasImage={hasImage} full={full} onSelectSubject={onSelectSubject} onDraw={onDraw} onPaint={onPaint} />}
          </>
        ))}
      {tab === 'layout' && (
      <>
      <div className="field valued">
        <span>Layout</span>
        <div className="segmented">
          {(
            [
              ['path', 'Path', 'Copies spread along a line or curve you draw'],
              ['placed', 'Placed', 'A copy wherever you click'],
              ['grid', 'Grid', 'Rows and columns of copies, out from the original'],
            ] as const
          ).map(([id, label, hint]) => (
            <button key={id} className={r.layout === id ? 'on' : ''} title={hint} onClick={() => r.layout !== id && set({ layout: id, ...sameCopies(r, id) })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* Path and Placed: set on the photo, right under the layout; while it is, its Cancel and Done are here. */}
      {r.layout !== 'grid' &&
        (editing && pathBox ? (
          pathBox
        ) : (
          <ModuleActions>
            <button className={editing ? 'on' : ''} disabled={!hasImage} onClick={onEdit}>
              {r.layout === 'path' ? (r.path.length ? 'Edit path on photo' : 'Draw path on photo') : 'Place on photo'}
            </button>
            {(r.layout === 'path' ? r.path.length : r.placed.length) > 0 && (
              <button onClick={() => set(r.layout === 'path' ? { path: [] } : { placed: [] }, 'clear')}>Clear</button>
            )}
          </ModuleActions>
        ))}
      {r.layout === 'grid' && (
        <>
          <Slider label="Across" title={r.both ? 'Copies each side, left and right' : 'Copies to the right (or, below 0, the left)'} value={r.across} min={r.both ? 0 : -20} max={20} step={1} format={r.both ? (v) => `${Math.round(v)} each side` : count} onChange={(across) => set({ across })} />
          <Slider label="Up" title={r.both ? 'Copies each side, above and below' : 'Copies above (or, below 0, below)'} value={r.up} min={r.both ? 0 : -20} max={20} step={1} format={r.both ? (v) => `${Math.round(v)} each side` : count} onChange={(up) => set({ up })} />
          <label className="check-row" title="Copies on both sides of the subject, which stays in the middle">
            <input type="checkbox" checked={!!r.both} onChange={(e) => set(e.target.checked ? { both: true, across: Math.abs(r.across), up: Math.abs(r.up) } : { both: false })} />
            Both sides
          </label>
          {r.both && (
            <label className="check-row" title="The copies on the other side (left, below) mirrored, as a reflection">
              <input type="checkbox" checked={!!r.mirror} onChange={(e) => set({ mirror: e.target.checked })} />
              Mirror the other side
            </label>
          )}
          {/* How far apart the copies are, beside how many there are. */}
          <RangeSlider
            label="Spacing"
            title="How far each copy is from the one before, first to last, as a share of the original: 100% side by side, less overlapping. Their size does not change it."
            // An edit from before Spacing shows its gap, and takes up Spacing when this is moved.
            value={r.spacing ?? [1 + (r.up !== 0 ? r.gapY : r.gapX), 1 + (r.up !== 0 ? r.gapY : r.gapX)]}
            def={[1, 1]}
            min={0.05}
            max={3}
            step={0.01}
            format={pct}
            onChange={(spacing) => set({ spacing })}
          />
          {!r.vanish && (
            <>
              <AngleDial
                look="arrow"
                label="Angle"
                title="Turn the line (or rows and columns) the copies run along"
                value={r.angle ?? 0}
                def={0}
                min={-180}
                max={180}
                zero={r.across !== 0 ? (r.across < 0 ? 180 : 0) : r.up < 0 ? 90 : -90}
                format={(v) => (Math.round(v) === 0 ? 'Straight' : `${v > 0 ? '+' : ''}${Math.round(v)}°`)}
                onChange={(angle) => set({ angle })}
              />
              <Slider label="Stagger" title="Every other row moved along by this share of a step, like bricks" value={r.stagger} min={-1} max={1} step={0.01} format={signedPct} onChange={(stagger) => set({ stagger })} />
            </>
          )}
          {/* Perspective: one line of copies, toward where the subject's own edges meet. */}
          {(r.across === 0) !== (r.up === 0) && (onLineUp || onPerspective) && (
            <>
              <h3 className="streak-group" title="The copies carry the subject on in its own perspective, its edges meeting far off">
                Perspective
              </h3>
              <div className="row">
                {onLineUp && (
                  <button disabled={!piece || !hasImage} title="Find the subject's own straight edges and run the copies toward where they meet: a building going on up for ever" onClick={onLineUp}>
                    Line up with the photo
                  </button>
                )}
                {onPerspective && r.vanish && (
                  <button className={editing ? 'on' : ''} disabled={!hasImage} title="Drag the two lines onto the subject's edges" onClick={onEdit}>
                    Adjust on photo
                  </button>
                )}
                {onPerspective && (
                  <button disabled={!piece} title={r.vanish ? 'The copies in a straight line again' : 'Drag two lines onto the subject’s edges yourself'} onClick={() => onPerspective(!r.vanish)}>
                    {r.vanish ? 'Off' : 'Set on photo'}
                  </button>
                )}
              </div>
            </>
          )}
          {onFit && !r.vanish && Math.abs(r.angle ?? 0) < 0.5 && (
            <div className="row">
              <button title="Space the copies so the last one reaches the edge of the photo, the way they go now" disabled={!piece || (r.across === 0 && r.up === 0)} onClick={onFit}>
                Fit to the photo
              </button>
            </div>
          )}
        </>
      )}
      {r.layout === 'path' && (
        <>
          <div className="field valued">
            <span title="Where the original is on the path">Original</span>
            <div className="segmented">
              {(
                [
                  ['start', 'At the start', 'The path starts at the original, and the copies run on from it to the end'],
                  ['middle', 'In the middle', 'The path runs through the original, and the copies go both ways from it, toward each end. Draw the path across the original.'],
                  ['off', 'Not on it', 'The path is apart from the original: the first copy is at its first point'],
                ] as const
              ).map(([id, label, hint]) => (
                <button key={id} className={r.pieceOnPath === id ? 'on' : ''} title={hint} onClick={() => set({ pieceOnPath: id })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <Slider
            label="Copies"
            title={r.pieceOnPath === 'middle' ? 'How many copies along the path, shared between the two sides by their lengths' : 'How many copies along the path, from its start to its end'}
            value={r.count}
            min={1}
            max={40}
            step={1}
            format={(v) => `${Math.round(v)}`}
            onChange={(count) => set({ count })}
          />
          <RangeSlider
            label="Spacing"
            title="How the copies are spread along the path, first to last: a bigger share puts them further apart there"
            // An edit from before Spacing shows its gap, and takes up Spacing when this is moved.
            value={r.spacing ?? [1 + (r.up !== 0 ? r.gapY : r.gapX), 1 + (r.up !== 0 ? r.gapY : r.gapX)]}
            def={[1, 1]}
            min={0.05}
            max={3}
            step={0.01}
            format={pct}
            onChange={(spacing) => set({ spacing })}
          />
          <label className="check-row" title="Straight lines between the points, corners and all, instead of a smooth curve. Hold Shift while placing a point to keep its line to a straight direction.">
            <input type="checkbox" checked={!!r.straight} onChange={(e) => set({ straight: e.target.checked })} />
            Straight lines
          </label>
          <label className="check-row" title="Each copy turns as the path does">
            <input type="checkbox" checked={r.followPath} onChange={(e) => set({ followPath: e.target.checked })} />
            Turn with the path
          </label>
        </>
      )}
      </>
      )}
      {tab === 'copies' && (
      <div className="colour-group">
        <h3 title="How the copies change from the first to the last; the ones between go evenly from one to the other">First to last copy</h3>
        <RepeatCopiesPicture r={r} />
        {r.layout === 'path' && r.pieceOnPath === 'middle' && (
          <div className="field valued">
            <span title="Which way first to last goes, with the original in the middle of the path">Runs</span>
            <div className="segmented">
              {(
                [
                  ['out', 'Out', 'Out from the original both ways: a copy one step out is the same on either side, and the shorter side stops sooner'],
                  ['along', 'Start to end', 'Along the whole path, from its first point to its last, through the original'],
                  ['back', 'End to start', 'Along the whole path, from its last point to its first, through the original'],
                ] as const
              ).map(([id, label, hint]) => (
                <button key={id} className={(r.firstToLast ?? 'out') === id ? 'on' : ''} title={hint} onClick={() => set({ firstToLast: id })}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
        <RangeSlider
          label="Size"
          title="The first copy's size and the last's, against the original's own: both under 100% and the copies shrink away"
          value={r.size}
          def={DEFAULT_REPEAT.size}
          min={0.1}
          max={2}
          step={0.01}
          format={pct}
          onChange={(size) => set({ size })}
        />
        <RangeSlider
          label="Turn"
          title="How far the first copy is turned, and the last: past 360° they spin round more than once"
          value={r.turn}
          def={DEFAULT_REPEAT.turn}
          min={-720}
          max={720}
          step={1}
          format={(v) => `${v > 0 ? '+' : ''}${Math.round(v)}°`}
          onChange={(turn) => set({ turn })}
        />
        {r.turn[0] !== r.turn[1] && (
          <Slider
            label="Twist"
            title="How the turn goes from the first copy to the last: evenly, faster and faster toward the end (twisting in on itself), or most of it at the start"
            value={r.turnEase ?? 0}
            def={0}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => (Math.abs(v) < 0.005 ? 'Even' : v > 0 ? `Faster at the end ${Math.round(v * 100)}%` : `Faster at the start ${Math.round(-v * 100)}%`)}
            onChange={(turnEase) => set({ turnEase })}
          />
        )}
        <RangeSlider
          label="Opacity"
          title="The first copy's opacity and the last's: 100% to 0% fades them out along the copies"
          value={r.opacity}
          def={DEFAULT_REPEAT.opacity}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(opacity) => set({ opacity })}
        />
      </div>
      )}
      {tab === 'blend' && (
      <div className="colour-group">
        <div className="field valued">
          <span title="Whether the copies go behind the original itself or over it">Copies</span>
          <div className="segmented">
            <button className={r.behind ? 'on' : ''} title="The original itself stays in front of its copies" onClick={() => set({ behind: true })}>
              Behind
            </button>
            <button className={!r.behind ? 'on' : ''} title="Copies over everything, the original included" onClick={() => set({ behind: false })}>
              In front
            </button>
          </div>
        </div>
        <label className="field valued wide">
          <span title="How the copies mix with what is under them">Mode</span>
          <select value={r.blend} onChange={(e) => set({ blend: e.target.value as RepeatParams['blend'] })}>
            <option value="normal">Normal</option>
            <option value="lighten">Lighten</option>
            <option value="darken">Darken</option>
            <option value="screen">Screen</option>
            <option value="multiply">Multiply</option>
          </select>
        </label>
      </div>
      )}
    </>
  )
}

/** Making a repeat's piece: select it, draw round it, or paint it. */
export function RepeatMakers({ hasImage, full, onSelectSubject, onDraw, onPaint }: { hasImage: boolean; full: boolean; onSelectSubject: () => void; onDraw: () => void; onPaint: () => void }) {
  return (
    <div className="mask-choices">
      {MAKE.map((k) => (
        <button
          key={k.kind}
          className="mask-choice"
          disabled={!hasImage || full}
          title={full ? 'No room for another mask' : k.title}
          onClick={k.kind === 'subject' ? onSelectSubject : k.kind === 'outline' ? onDraw : onPaint}
        >
          <MaskGlyph kind={k.kind} />
          <span>
            <b>{k.name}</b>
            <small>{k.line}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
