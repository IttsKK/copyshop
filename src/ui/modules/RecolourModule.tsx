import type { ReactNode } from 'react'
import { EditBox } from '../EditBox'
import { ColourField } from '../ColourField'
import { ItemList } from '../ItemList'
import { Module, Slider } from '../controls'
import { PickPanel, type PickingState } from '../MasksPanel'
import { moduleSummary } from '../moduleSummary'
import { MAX_RECOLOURS, type RecolourItem } from '../../engine/recolour'
import type { Palette } from '../../engine/palette'
import { type BlendParams, MAX_MASKS } from '../../engine/types'
import type { LoadedImage } from '../loadedImage'

interface Props {
  blend: BlendParams
  items: RecolourItem[]
  open: number | null
  onOpen: (i: number | null) => void
  image: LoadedImage | null
  palette: Palette
  /** A part selected (or the open one selected again). */
  onSelect: (again: boolean) => void
  /** A part drawn round (or the open one drawn again). */
  onDraw: (again: boolean) => void
  drawing: { again: boolean } | null
  pickingView: PickingState | null
  choosePickReading: (reading: number) => void
  finishPicking: (keep: boolean) => void
  setItem: (i: number, patch: Partial<RecolourItem>, step?: string | null) => void
  onRemove: (i: number) => void
  onToggle: (i: number) => void
  onDuplicate: (i: number) => void
  onMove: (from: number, to: number) => void
  /** The open part's own mask settings (brush it in or out, its edge), as Repeat's piece has them. */
  partSettings: ReactNode
  /** Something on the photo has Esc and Delete for now. */
  keysOff: boolean
}

const MODES: [RecolourItem['mode'], string, string][] = [
  ['colour', 'Colour', 'The part takes the new colour, keeping its own light and shade'],
  ['hue', 'Hue only', 'Only the hue changes: the part keeps its own strength of colour'],
  ['asShot', 'As shot', 'The part keeps the colours it was taken with: Colour and Black & white leave it'],
]

const css = (c: [number, number, number]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`

/**
 * Recolour: parts of the photo in new colours. Select or draw a part and it
 * takes the next colour at once; open it to change the colour, how strongly,
 * or to keep it as shot instead.
 */
export function RecolourModule({ blend, items, open, onOpen, image, palette, onSelect, onDraw, drawing, pickingView, choosePickReading, finishPicking, setItem, onRemove, onToggle, onDuplicate, onMove, partSettings, keysOff }: Props) {
  const masks = blend.effects.masks
  const full = items.length >= MAX_RECOLOURS
  const masksFull = masks.length >= MAX_MASKS
  const cannot = !image ? 'Open a photo first' : full ? `Up to ${MAX_RECOLOURS} parts` : masksFull ? 'No room for another mask' : null
  const selecting = pickingView?.owner === 'recolour'
  const openOne = open !== null && open < items.length ? open : null
  const openItem = openOne !== null ? items[openOne] : undefined
  const openMaskAt = openItem ? masks.findIndex((m) => m.id === openItem.source) : -1
  // Selecting a new part (not the open one again).
  const selectingNew = selecting && !(pickingView!.index !== null && pickingView!.index === openMaskAt)
  const drawingNew = !!drawing && !drawing.again
  const nameOf = (it: RecolourItem, i: number) => masks.find((m) => m.id === it.source)?.name ?? `Part ${i + 1}`
  const sampleWithout = (b: BlendParams): BlendParams => (b.effects.recolour ? { ...b, effects: { ...b.effects, recolour: { ...b.effects.recolour, enabled: false } } } : b)
  return (
    <Module id="recolour" title="Recolour" summary={moduleSummary('recolour', blend)}>
      <div className="module-actions-row">
        <button
          className={selectingNew ? 'on' : ''}
          disabled={!!cannot && !selectingNew}
          title={cannot && !selectingNew ? cannot : 'Select a part to recolour: click it, or drag a box round it'}
          onClick={() => onSelect(false)}
        >
          Select
        </button>
        <button
          className={drawingNew ? 'on' : ''}
          disabled={!!cannot && !drawingNew}
          title={cannot && !drawingNew ? cannot : 'Click points round a part to recolour, then Done'}
          onClick={() => onDraw(false)}
        >
          Draw
        </button>
      </div>
      {selectingNew && pickingView && <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />}
      <EditBox at="recolour" />
      <ItemList
        open={openOne}
        onOpen={onOpen}
        onMove={onMove}
        keysOff={keysOff}
        items={items.map((it, i) => ({
          key: it.id,
          name: nameOf(it, i),
          icon: it.mode === 'asShot' ? <i className="recolour-chip as-shot" /> : <i className="recolour-chip" style={{ background: css(it.colour.source === 'manual' ? it.colour.colour : palette[it.colour.source]) }} />,
          summary: MODES.find(([m]) => m === it.mode)?.[1],
          label: nameOf(it, i).toLowerCase(),
          on: it.enabled,
          onToggle: () => onToggle(i),
          onRemove: () => onRemove(i),
          onDuplicate: () => onDuplicate(i),
          full: full ? `Up to ${MAX_RECOLOURS} parts` : masksFull ? 'No room for another mask' : undefined,
        }))}
      >
        {openItem && openOne !== null && (
          <div className="recolour-item">
            <EditBox at={`recolour/${openOne}`} />
            {selecting && !selectingNew && pickingView && <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />}
            <div className="segmented recolour-mode" role="tablist">
              {MODES.map(([mode, label, hint]) => (
                <button key={mode} role="tab" aria-selected={openItem.mode === mode} className={openItem.mode === mode ? 'on' : ''} title={hint} onClick={() => setItem(openOne, { mode }, `${nameOf(openItem, openOne)}: ${label.toLowerCase()}`)}>
                  {label}
                </button>
              ))}
            </div>
            {openItem.mode !== 'asShot' && (
              <>
                <ColourField
                  label="New colour"
                  value={openItem.colour}
                  palette={palette}
                  onChange={(colour) => setItem(openOne, { colour }, `${nameOf(openItem, openOne)}: colour`)}
                  sampleWithout={sampleWithout}
                />
                <Slider
                  label="Strength"
                  title="How much of the new colour: less lets the part's own colour through"
                  value={openItem.strength}
                  def={1}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => `${Math.round(v * 100)}%`}
                  onChange={(strength) => setItem(openOne, { strength })}
                />
                <label className="check-row" title="Colour and Black & white leave this part, so it keeps its new colour in a graded or black and white photo">
                  <input type="checkbox" checked={!!openItem.keep} onChange={(e) => setItem(openOne, { keep: e.target.checked }, `${nameOf(openItem, openOne)}: ${e.target.checked ? 'kept out of the look' : 'in the look'}`)} />
                  Keep it out of Colour and B&amp;W
                </label>
              </>
            )}
            {/* Select again is in the part's own settings below, with its brush. */}
            <div className="module-actions-row">
              <button className={drawing?.again ? 'on' : ''} disabled={!image} title="Click points round this part again, then Done" onClick={() => onDraw(true)}>
                Draw again
              </button>
            </div>
            {partSettings}
          </div>
        )}
      </ItemList>
    </Module>
  )
}
