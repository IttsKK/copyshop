import { createContext, useContext, useState } from 'react'
import { EditBox } from './EditBox'
import { ColourPicker } from './ColourPicker'
import type { Palette } from '../engine/palette'
import type { BlendParams, ColourChoice, ColourSource, Rgb } from '../engine/types'

interface Props {
  label: string
  value: ColourChoice
  /** The open photo's palette; without a photo, the photo sources show their fallbacks. */
  palette: Palette
  onChange: (value: ColourChoice) => void
  /** Extra one-click manual colours, e.g. the classic leak tints. */
  swatches?: { label: string; colour: Rgb }[]
  title?: string
  /** Offer the photo's raw colours (Light, Shadow…). Off where those suit badly, e.g. paper. */
  photoSources?: boolean
  /**
   * For dropping from the edited picture: the edit to sample, minus this
   * field's own effect — so a gradient map or isolate being picked for is not
   * already painted over the picture it is picked from.
   */
  sampleWithout?: (blend: BlendParams) => BlendParams
}

const SOURCES: { id: Exclude<ColourSource, 'manual'>; label: string; hint: string }[] = [
  { id: 'light', label: 'Light', hint: 'The colour of the brightest light in the photo' },
  { id: 'shadow', label: 'Shadow', hint: 'The colour of the photo’s shadows' },
  { id: 'accent', label: 'Accent', hint: 'The photo’s most widespread saturated colour' },
  { id: 'vivid', label: 'Vivid', hint: 'The photo’s most vivid colour — the one that stands out' },
]

/**
 * The eyedropper is app-wide — the click that answers it lands on the preview,
 * far from the field that asked — so fields reach it through context.
 */
export interface Dropper {
  /** Which field is waiting for a sample, if any. */
  activeId: string | null
  /**
   * Begin sampling for a field. `apply` is called with each colour while the
   * user holds on the photo (a live preview), with the final one on release,
   * and with null to put back the colour the field had when sampling began.
   */
  start: (id: string, apply: (colour: Rgb | null) => void, without?: (blend: BlendParams) => BlendParams) => void
  cancel: () => void
  /**
   * What the dropper reads: the picture as edited (what you see), or the
   * original photo (the colour that is really there, before the look).
   */
  from: DropFrom
  setFrom: (from: DropFrom) => void
}

export type DropFrom = 'edited' | 'original'

export const DropperContext = createContext<Dropper | null>(null)

const DropperIcon = () => (
  <svg
    viewBox="0 0 16 16"
    width="12"
    height="12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d="M11.5 1.8l2.7 2.7-2 2-2.7-2.7z" fill="currentColor" />
    <path d="M9.3 4l2.7 2.7L5.4 13.3 2.5 14l.7-2.9z" />
  </svg>
)

const PickIcon = () => (
  <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
    <circle cx="8" cy="8" r="5.5" />
    <path d="M8 2.5v11M2.5 8h11" strokeOpacity="0.5" />
  </svg>
)

export const toCss = (c: Rgb) => `rgb(${c.map((v) => Math.round(v * 255)).join(' ')})`

const same = (a: Rgb, b: Rgb) => a.every((v, i) => Math.abs(v - b[i]) < 0.004)

/**
 * A colour that is either read from the photo or picked by hand. Photo colours
 * are shown as they come out of the open image, so what you click is what the
 * look will use; a batch reads each photo's own.
 */
export function ColourField({
  label,
  value,
  palette,
  onChange,
  swatches = [],
  title,
  photoSources = true,
  sampleWithout,
}: Props) {
  const [open, setOpen] = useState(false)
  const dropper = useContext(DropperContext)
  const [fieldId] = useState(() => `colour-${Math.random().toString(36).slice(2)}`)
  const sampling = dropper?.activeId === fieldId
  const manual = value.source === 'manual'
  const customActive = manual && !swatches.some((s) => same(s.colour, value.colour))
  return (
    <div className="field colour-field">
      <span title={title ?? label}>{label}</span>
      <div className="colour-options">
        {photoSources && (
          <div className="colour-sources">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                className={value.source === s.id ? 'swatch-btn on' : 'swatch-btn'}
                title={`${s.label} — ${s.hint}`}
                onClick={() => onChange({ ...value, source: s.id })}
              >
                <i style={{ background: toCss(palette[s.id]) }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
        {swatches.length > 0 && (
          <div className="colour-swatches">
            {swatches.map((s) => (
              <button
                key={s.label}
                className={manual && same(s.colour, value.colour) ? 'swatch-btn on' : 'swatch-btn'}
                title={s.label}
                onClick={() => onChange({ source: 'manual', colour: s.colour })}
              >
                <i style={{ background: toCss(s.colour) }} />
                {s.label}
              </button>
            ))}
          </div>
        )}
        <span className="colour-tools">
          <button
            className={customActive || open || sampling ? 'tool-btn on' : 'tool-btn'}
            title="Pick any colour, or take one from the photo"
            aria-expanded={open}
            onClick={() => {
              // Opening the picker on a photo colour starts from that colour.
              if (value.source !== 'manual') onChange({ source: 'manual', colour: palette[value.source] })
              if (open && sampling) dropper?.cancel()
              setOpen(!open)
            }}
          >
            {customActive ? <i className="tool-swatch" style={{ background: toCss(value.colour) }} /> : <PickIcon />}
            Pick
          </button>
          {dropper && (
            <button
              className={sampling ? 'tool-btn on' : 'tool-btn'}
              title="Take a colour from the photo: click on it, or hold and drag to try colours (Esc cancels). As you see it, or from the original: choose on the photo."
              aria-pressed={sampling}
              onClick={() => {
                if (sampling) return dropper.cancel()
                const before = value
                dropper.start(fieldId, (colour) => onChange(colour ? { source: 'manual', colour } : before), sampleWithout)
              }}
            >
              <DropperIcon />
              From photo
            </button>
          )}
        </span>
      </div>
      {open && (
        <div className="picker-slot">
          <ColourPicker value={value.colour} onChange={(colour) => onChange({ source: 'manual', colour })} />
        </div>
      )}
      {sampling && <EditBox at={`dropper:${fieldId}`} />}
    </div>
  )
}
