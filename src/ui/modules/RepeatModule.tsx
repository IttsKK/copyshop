import type { ReactNode } from 'react'
import { EditBox } from '../EditBox'
import type { Dispatch, SetStateAction } from 'react'
import { maskKind } from '../../engine/maskShapes'
import { MAX_REPEATS, repeatCopyCount, type RepeatParams } from '../../engine/repeatParams'
import { type BlendParams, type MaskShape, MAX_MASKS } from '../../engine/types'
import { MaskSettings, type Picking, type PickingState, PickPanel } from '../MasksPanel'
import { RepeatPanel } from '../RepeatPanel'
import { ItemList } from '../ItemList'
import { MaskGlyph, type AddKind } from '../maskKinds'
import type { TraceOutline } from '../TraceToKey'
import { Module } from '../controls'
import type { LoadedImage } from '../loadedImage'
import type { MaskView } from '../maskKey'
import type { NewMaskTarget } from '../maskKinds'
import { moduleSummary } from '../moduleSummary'

interface Props {
  /** Ready-made effects to start the first repeat from (QuickEffects). */
  quick?: ReactNode
  blend: BlendParams
  /** The repeat open (or the one about to be made: see App's repeatOpen). */
  repeat: RepeatParams
  /** The list, and the one open in it (null: none). */
  items: RepeatParams[]
  open: number | null
  onOpen: (index: number | null) => void
  /** A new repeat, its piece selected, drawn round or painted (again while under way stops it). */
  onMake: (kind: 'subject' | 'outline' | 'paint') => void
  onRemove: (index: number) => void
  onToggle: (index: number) => void
  onDuplicate: (index: number) => void
  /** Copy settings and Paste settings, in each repeat's … menu; `clip` names the one copied. */
  copySettings: (index: number) => void
  pasteSettings: (index: number) => void
  clip: string | null
  onMove: (from: number, to: number) => void
  pickingView: PickingState | null
  choosePickReading: (reading: number) => void
  finishPicking: (keep: boolean) => void
  maskEditing: boolean
  maskSolo: boolean
  maskDrawing: boolean
  selectedMask: number | null
  listedMasks: MaskShape[]
  image: LoadedImage | null
  editingRepeat: boolean
  setRepeat: (patch: Partial<RepeatParams>, step?: string | null) => void
  /** Its own piece, a selection, made into points (App, maskToPoints). */
  onPieceToPoints: () => void
  /** Space the copies to reach the photo's edge (App, fitRepeat). */
  onFit: () => void
  /** The copies' perspective from the subject's own edges, and perspective on or off (App). */
  onLineUp: () => void
  onPerspective: (on: boolean) => void
  setEditingRepeat: Dispatch<SetStateAction<boolean>>
  setBrushing: Dispatch<SetStateAction<{ index: number; mode: 'add' | 'remove' } | null>>
  editMaskShape: (i: number) => void
  drawingPiece: boolean
  startPicking: (index: number | null, owner?: 'repeat', target?: NewMaskTarget) => void
  drawPiece: () => void
  newPainted: (owner?: 'repeat', target?: NewMaskTarget) => void
  brushing: { index: number; mode: 'add' | 'remove' } | null
  setRepeatPieceShown: Dispatch<SetStateAction<boolean>>
  picking: Picking | null
  brushSize: number
  setBrushSize: (value: number) => void
  setMaskDrawing: Dispatch<SetStateAction<boolean>>
  setMaskPlacing: Dispatch<SetStateAction<'radial' | 'gradient' | null>>
  matchMask: (i: number, to: 'off' | 'edge' | 'all' | 'again') => void
  setMasks: (masks: MaskShape[], step?: string | null) => void
  traceOutline: TraceOutline | undefined
  maskView: MaskView
  setMaskView: (value: MaskView) => void
  brushByColour: boolean
  setBrushByColour: (value: boolean) => void
}

/**
 * Repeat: copies of parts of the photo, as Streaks lays out streaks. Over
 * the list, the ways to start a new one (select what to copy, draw round
 * it, paint it); in the list, each repeat; opened, its settings in tabs,
 * its piece in the Piece tab as a streak's subject is in its Subject tab.
 */
export function RepeatModule({ items, open, onOpen, onMake, onRemove, onToggle, onDuplicate, copySettings, pasteSettings, clip, onMove, onPieceToPoints, onFit, onLineUp, onPerspective, quick, blend, repeat, pickingView, choosePickReading, finishPicking, maskEditing, maskSolo, maskDrawing, selectedMask, image, editingRepeat, setRepeat, setEditingRepeat, setBrushing, editMaskShape, drawingPiece, startPicking, drawPiece, newPainted, brushing, setRepeatPieceShown, picking, brushSize, setBrushSize, setMaskDrawing, setMaskPlacing, matchMask, setMasks, traceOutline, maskView, setMaskView, brushByColour, setBrushByColour, listedMasks }: Props) {
  const full = items.length >= MAX_REPEATS
  const masksFull = blend.effects.masks.length >= MAX_MASKS
  const openOne = open !== null && open < items.length ? open : null
  const pickingNew = pickingView?.owner === 'repeat' && pickingView.index === null && openOne === null
  const drawingNew = maskDrawing && drawingPiece && openOne === null
  const pieceIdx = blend.effects.masks.findIndex((m) => m.id === repeat.source)
  const piece = pieceIdx >= 0 ? blend.effects.masks[pieceIdx] : null
  const pickHere = pickingView?.owner === 'repeat' && !pickingNew ? <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} /> : null
  const editingPiece = maskEditing && maskSolo && !maskDrawing && selectedMask === pieceIdx
  const glyphOf = (r: RepeatParams): AddKind => {
    const m = blend.effects.masks.find((x) => x.id === r.source)
    return !m ? 'subject' : maskKind(m) === 'outline' ? 'outline' : /^Painted\b/.test(m.name) ? 'paint' : 'subject'
  }
  const summaryOf = (r: RepeatParams) => {
    if (!r.source || !blend.effects.masks.some((m) => m.id === r.source)) return 'Nothing to copy'
    const n = repeatCopyCount(r)
    return `${n} ${n === 1 ? 'copy' : 'copies'} ${r.layout === 'grid' ? 'on a grid' : r.layout === 'path' ? 'along a path' : 'placed'}`
  }
  const cannot = !image ? 'Open a photo first' : full ? `Up to ${MAX_REPEATS} repeats` : masksFull ? 'No room for another mask' : null
  return (
    <Module id="repeat" title="Repeat" summary={moduleSummary('repeat', blend)}>
      <div className="module-actions-row repeat-make">
        <button
          className={pickingNew ? 'on' : ''}
          disabled={!!cannot && !pickingNew}
          title={cannot && !pickingNew ? cannot : 'Select subject: a new repeat. Click what to copy, or drag a box round it'}
          onClick={() => onMake('subject')}
        >
          Select
        </button>
        <button
          className={drawingNew ? 'on' : ''}
          disabled={!!cannot && !drawingNew}
          title={cannot && !drawingNew ? cannot : 'Draw outline: a new repeat. Click points round what to copy, then Done'}
          onClick={() => onMake('outline')}
        >
          Draw
        </button>
        <button disabled={!!cannot} title={cannot ?? 'Paint: a new repeat. Brush over what to copy'} onClick={() => onMake('paint')}>
          Paint
        </button>
      </div>
      {pickingNew && pickingView && <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />}
      <EditBox at="repeat" />
      {quick}
      {items.length > 0 && (
        <span className="module-group-head streak-list-head" title="Each repeat has its own settings: click one to open them. Where they overlap, the one higher in the list is in front: drag one by its name to move it.">
          Your repeats
        </span>
      )}
      <ItemList
        open={openOne}
        onOpen={onOpen}
        onMove={onMove}
        keysOff={!!pickingView || maskDrawing || !!brushing || editingPiece}
        items={items.map((r, i) => ({
          key: r.id ?? `repeat-${i}`,
          name: `Repeat ${i + 1}`,
          icon: <MaskGlyph kind={glyphOf(r)} />,
          summary: summaryOf(r),
          label: `repeat ${i + 1}`,
          on: r.enabled,
          onToggle: () => onToggle(i),
          onRemove: () => onRemove(i),
          onDuplicate: () => onDuplicate(i),
          full: full ? `Up to ${MAX_REPEATS} repeats` : masksFull ? 'No room for another mask' : undefined,
          actions: [
            { label: 'Copy settings', title: 'Copy its layout, spacing, sizes, turn, opacity and blend to paste onto another repeat', onClick: () => copySettings(i), apart: true },
            {
              label: clip ? `Paste settings from ${clip}` : 'Paste settings',
              title: clip ? `Give it ${clip}'s layout and look; its piece, path and placed copies stay its own` : 'Copy another repeat’s settings first',
              disabled: !clip,
              onClick: () => pasteSettings(i),
            },
          ],
          // Its path, placed copies or perspective lines, set on the photo.
          ...(r.layout !== 'grid' || r.vanish
            ? {
                editing: openOne === i && editingRepeat,
                onEdit: () => {
                  if (openOne !== i) onOpen(i)
                  setEditingRepeat(!(openOne === i && editingRepeat))
                  setBrushing(null)
                },
              }
            : {}),
        }))}
      >
        {openOne !== null && (
          <RepeatPanel
            editBox={<EditBox at={`repeat/${openOne}`} />}
            repeat={repeat}
            piece={piece}
            masks={listedMasks}
            hasImage={!!image}
            full={masksFull}
            editing={editingRepeat}
            onEdit={() => {
              if (!repeat.enabled) setRepeat({ enabled: true })
              setEditingRepeat(!editingRepeat)
              setBrushing(null)
              if (editingPiece) editMaskShape(pieceIdx)
            }}
            onChange={(patch, step) => setRepeat(repeat.enabled || 'enabled' in patch ? patch : { ...patch, enabled: true }, step)}
            onFit={onFit}
            onLineUp={onLineUp}
            onPerspective={onPerspective}
            onSelectSubject={() => startPicking(null, 'repeat')}
            onDraw={drawPiece}
            onPaint={() => newPainted('repeat')}
            pieceEditing={editingPiece}
            brushingPiece={brushing?.index === pieceIdx}
            onStopPiece={() => {
              if (brushing?.index === pieceIdx) setBrushing(null)
              if (editingPiece) editMaskShape(pieceIdx)
            }}
            onEditPiece={piece?.owner && maskKind(piece) === 'outline' ? () => editMaskShape(pieceIdx) : null}
            onPieceToPoints={piece?.owner && piece.raster ? onPieceToPoints : null}
            onPieceShown={setRepeatPieceShown}
            pieceBody={
              pickHere ??
              (piece?.owner ? (
                <MaskSettings
                  mask={piece}
                  index={pieceIdx}
                  hasImage={!!image}
                  picking={!!picking}
                  brushing={brushing}
                  brushSize={brushSize}
                  onBrushSize={setBrushSize}
                  onByColour={setBrushByColour}
                  onBrush={(i, mode) => {
                    setBrushing(brushing?.index === i && brushing.mode === mode ? null : { index: i, mode })
                    setEditingRepeat(false)
                    setMaskDrawing(false)
                    setMaskPlacing(null)
                    if (editingPiece) editMaskShape(pieceIdx)
                  }}
                  onPick={(i) => startPicking(i, 'repeat')}
                  editing={editingPiece}
                  onMatch={matchMask}
                  onChange={(i, patch, step) => setMasks(blend.effects.masks.map((m, j) => (j === i ? { ...m, ...patch } : m)), step)}
                  trace={traceOutline}
                  cleanEdges={false}
                  named={false}
                  view={maskView}
                  onView={setMaskView}
                  byColour={brushByColour}
                />
              ) : piece ? (
                <p className="hint-line">From the Masks list</p>
              ) : null)
            }
          />
        )}
      </ItemList>
    </Module>
  )
}
