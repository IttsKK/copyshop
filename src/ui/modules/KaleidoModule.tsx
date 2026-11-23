import { EditBox } from '../EditBox'
import { AngleDial } from '../AngleDial'
import { DEFAULT_KALEIDO, KALEIDO_COPIES, KALEIDO_RINGS, type KaleidoParams } from '../../engine/kaleido'
import { maskKind } from '../../engine/maskShapes'
import { type BlendParams, MAX_MASKS } from '../../engine/types'
import { Module, Slider } from '../controls'
import type { LoadedImage } from '../loadedImage'
import { PickPanel, type PickingState } from '../MasksPanel'
import { moduleSummary } from '../moduleSummary'

interface Props {
  blend: BlendParams
  kaleido: KaleidoParams
  image: LoadedImage | null
  setKaleido: (patch: Partial<KaleidoParams>, step?: string | null) => void
  /** Copy a slice of the photo round (its own part, if any, goes). */
  onSlice: () => void
  /** Select the part to copy round (again, if it has one). */
  onSelect: () => void
  /** Draw round the part to copy round (again: its outline is replaced). */
  onDraw: () => void
  drawing: boolean
  pickingView: PickingState | null
  choosePickReading: (reading: number) => void
  finishPicking: (keep: boolean) => void
  /** Its centre being moved on the photo. */
  editingCentre: boolean
  onEditCentre: () => void
}

/**
 * Kaleidoscope: the photo, or a part of it, copied round a point. It starts
 * at once on a slice from the middle; Select or Draw copies a part instead.
 */
export function KaleidoModule({ blend, kaleido: k, image, setKaleido, onSlice, onSelect, onDraw, drawing, pickingView, choosePickReading, finishPicking, editingCentre, onEditCentre }: Props) {
  const piece = k.source ? blend.effects.masks.find((m) => m.id === k.source) : undefined
  const selecting = pickingView?.owner === 'kaleido'
  const from: 'slice' | 'select' | 'draw' = selecting ? 'select' : drawing ? 'draw' : !piece ? 'slice' : maskKind(piece) === 'outline' ? 'draw' : 'select'
  const masksFull = !piece && blend.effects.masks.length >= MAX_MASKS
  const cannot = !image ? 'Open a photo first' : masksFull ? `Up to ${MAX_MASKS} masks` : null
  const d = DEFAULT_KALEIDO
  // Mirrored, an odd number would leave one seam where two copies don't meet.
  const evenOnly = k.mirror
  const set = (patch: Partial<KaleidoParams>, step?: string | null) => setKaleido(k.enabled || 'enabled' in patch ? patch : { ...patch, enabled: true }, step)
  return (
    <Module id="kaleido" title="Kaleidoscope" summary={moduleSummary('kaleido', blend)}>
      <div className="field valued">
        <span title="What is copied round the centre">Copy</span>
        <div className="segmented">
          <button className={from === 'slice' ? 'on' : ''} title="A slice of the photo from the centre out, copied all the way round" onClick={onSlice}>
            Slice
          </button>
          <button
            className={from === 'select' ? 'on' : ''}
            disabled={!!cannot && !selecting}
            title={cannot && !selecting ? cannot : piece ? 'Select the part to copy round again: click it, or drag a box round it' : 'Select a part of the photo to copy round: click it, or drag a box round it'}
            onClick={onSelect}
          >
            Select
          </button>
          <button
            className={from === 'draw' ? 'on' : ''}
            disabled={!!cannot && !drawing}
            title={cannot && !drawing ? cannot : 'Click points round the part to copy round, then Done'}
            onClick={onDraw}
          >
            Draw
          </button>
        </div>
      </div>
      {selecting && pickingView && <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />}
      <EditBox at="kaleido/piece" />
      <Slider
        label="Copies"
        title={evenOnly ? 'How many there are all the way round, the original among them. Mirrored, always an even number, so every copy meets its neighbour.' : 'How many there are all the way round, the original among them'}
        value={k.copies}
        def={d.copies}
        min={KALEIDO_COPIES.min}
        max={KALEIDO_COPIES.max}
        step={evenOnly ? 2 : 1}
        format={(v) => `${Math.round(v)}`}
        onChange={(copies) => set({ copies: Math.round(copies) })}
      />
      <label className="check-row" title="Every other copy flipped, so the copies meet edge to edge, as a kaleidoscope's mirrors show it">
        <input
          type="checkbox"
          checked={k.mirror}
          onChange={(e) => set(e.target.checked ? { mirror: true, copies: Math.min(KALEIDO_COPIES.max, k.copies + (k.copies % 2)) } : { mirror: false }, `${e.target.checked ? 'mirroring' : 'not mirroring'} the Kaleidoscope's copies`)}
        />
        Mirror every other copy
      </label>
      <AngleDial
        look="turn"
        label="Angle"
        title="Which part of the photo the slice is cut from: the way it points from the centre"
        value={k.angle}
        def={d.angle}
        min={-180}
        max={180}
        zero={-90}
        idle={piece ? 'Only for Slice: a part is copied round from where it is' : false}
        onChange={(angle) => set({ angle })}
      />
      <Slider
        label="Rings"
        title="The whole of it again inside itself, smaller, toward the centre: how many rings there are, the outer one among them"
        value={k.rings}
        def={d.rings}
        min={KALEIDO_RINGS.min}
        max={KALEIDO_RINGS.max}
        step={1}
        format={(v) => (v <= 1 ? 'One' : `${Math.round(v)}`)}
        onChange={(rings) => set({ rings: Math.round(rings) })}
      />
      <Slider
        label="Ring size"
        title="Each ring's size against the one round it"
        value={k.ringSize}
        def={d.ringSize}
        min={0.2}
        max={0.95}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        idle={k.rings <= 1 ? 'With two rings or more' : false}
        onChange={(ringSize) => set({ ringSize })}
      />
      <AngleDial
        look="turn"
        label="Twist"
        title="How far each ring is turned from the one round it"
        value={k.twist}
        def={d.twist}
        min={-180}
        max={180}
        zero={-90}
        idle={k.rings <= 1 ? 'With two rings or more' : false}
        onChange={(twist) => set({ twist })}
      />
      <div className="module-actions-row">
        <button className={editingCentre ? 'on' : ''} disabled={!image} title="Drag the centre the copies go round, or click where it goes" onClick={onEditCentre}>
          Move centre
        </button>
        <button disabled={!k.centre} title="The centre back in the middle of the picture" onClick={() => set({ centre: null }, "the Kaleidoscope's centre back in the middle")}>
          Centre in middle
        </button>
      </div>
      <EditBox at="kaleido/centre" />
    </Module>
  )
}
