import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { EditBox } from './EditBox'
import { singleModuleStore } from './state/settings'
import { inTextField } from './shortcuts'
import { isMac } from '../platform/os'
import type { MaskShape, SectionMask } from '../engine/types'
import { useLocalStorage } from './useLocalStorage'
import { ModuleGlyph } from './ModuleGlyph'
import { ADD_KINDS, MaskGlyph, OverlayToggle, PickPanel, type AddKind, type PickingState } from './maskKinds'
import { CATEGORY_BY_ID, MASKABLE, MODULE_BY_ID, moduleOrder, presetKind, type StackModuleId } from './moduleCatalog'
import { StackContext } from './StackNav'
import { seenModule, useIsNew } from './whatsNew'
import { NewTag } from './WhatsNewDialog'
import { HistogramContext, ToneHighlightContext, pointedTone, type ToneRange } from './toneHighlight'

/**
 * Bumped whenever a look or preset is applied. Each slider remembers the
 * value it showed at that moment and resets to it on double-click, so "reset"
 * means "as this look set it" without every slider having to know its look.
 */
export const BaselineContext = createContext(0)

/**
 * What a control showed when the current look or preset was applied (or
 * when it first appeared since): double-clicking any control puts this back.
 * Every kind of control uses it — sliders, pads, wheels, curves —
 * so "double-click to reset" means the same thing everywhere.
 */
export function useBaseline<T>(value: T): T {
  const generation = useContext(BaselineContext)
  const baseline = useRef<{ generation: number; value: T } | null>(null)
  if (!baseline.current || baseline.current.generation !== generation) baseline.current = { generation, value }
  return baseline.current.value
}

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  onChange: (value: number) => void
  format?: (value: number) => string
  title?: string
  /**
   * Optional slider curve. `toSlider` maps the stored value onto the track and
   * `fromSlider` maps it back, so a control whose useful range is crowded into
   * one end (grain strength, grain size) can spread it across the travel
   * without changing what gets stored.
   */
  toSlider?: (value: number) => number
  fromSlider?: (position: number) => number
  /**
   * For a brightness setting: the part of the photo it touches at a value,
   * tinted on the photo while the slider is held (see toneHighlight.ts).
   */
  touches?: (value: number) => ToneRange
  /**
   * The value the module starts at when added (moduleCatalog FACTORY). Given,
   * the track fills from it to the value rather than from the left end, so
   * an untouched control shows a bare track and a changed one shows how far
   * it has moved, and which way; its name brightens.
   */
  def?: number
  /**
   * Waiting on another setting (a glow's size while there is no glow): shown
   * greyed with what it waits for, rather than taken away, so the rows under
   * it don't jump as that setting crosses zero.
   */
  idle?: string | false
  /**
   * The track drawn as what it sets (TRACKS: cool to warm, dark to light,
   * grey to colour), in place of the accent fill: the knob's place on it
   * says what the value is.
   */
  track?: string
  /**
   * A mark drawn over the knob, moving with it (AngleDial's arrow, turned
   * to the angle). Laid over the knob rather than drawn into it, so turning
   * it repaints nothing and it never flickers.
   */
  thumb?: ReactNode
}

/** Tracks that show what a slider sets, for Slider's track: low end on the left. */
export const TRACKS = {
  /** Cooler (blue) to warmer (amber). */
  warmth: 'linear-gradient(90deg, #3f6fc4, #8f949c 50%, #d79a35)',
  /** Greener to more magenta. */
  tint: 'linear-gradient(90deg, #4f9a4a, #8f949c 50%, #b25aa6)',
  /** No colour to rich colour. */
  colour: 'linear-gradient(90deg, #8f949c, #c96a8a 40%, #d99b3a 65%, #4fa1b5)',
  /** Dark to light: a brightness level. */
  brightness: 'linear-gradient(90deg, #08090a, #eceef0)',
  /** Darker to brighter, about the middle: an exposure. */
  exposure: 'linear-gradient(90deg, #121314, #6d7076 50%, #f2f3f5)',
  /** Round the colour wheel. */
  hue: 'linear-gradient(90deg, #d8584e, #d9a23a 17%, #b9c447 33%, #4fae6d 50%, #4f9bd0 67%, #8a6ad0 83%, #d8584e)',
} as const

/** A dark-to-light track for a brightness setting, from its min to its max, in its space (ToneRange's: a blue key's is dark to blue). */
export function toneTrack(min: number, max: number, space?: ToneRange['space']): string {
  const grey = (v: number) => {
    const g = Math.round(255 * Math.min(1, Math.max(0, space === 'linear' ? encode(v) : v)))
    return space === 'blue' ? `rgb(${Math.round(g * 0.25)}, ${Math.round(g * 0.45)}, ${g})` : `rgb(${g}, ${g}, ${g})`
  }
  return `linear-gradient(90deg, ${grey(min)}, ${grey((min + max) / 2)}, ${grey(max)})`
}

export const percent = (v: number) => `${Math.round(v * 100)}`

const numberIn = (text: string) => parseFloat(text.replace(/[^0-9.+-]/g, ''))

/**
 * The value a slider takes for a number typed into its box, in the units it
 * shows. Every format here is monotonic in the slider position (percent,
 * square-root strength, degrees, signed), so the track is searched for the
 * positions that show `typed`, without each slider needing its own parser.
 * The middle of those positions is taken, on the step grid: the edge of
 * them is where the reading rounds over to the next number, and a step
 * snapped from there could land on that next number (-90 typed, -91 set).
 * Null for something that is not a number.
 */
export function valueForTyped(
  typed: number,
  { min, max, step, format, fromSlider }: { min: number; max: number; step: number; format: (v: number) => string; fromSlider?: (p: number) => number },
): number | null {
  if (!Number.isFinite(typed)) return null
  const valueAt = (p: number) => (fromSlider ? fromSlider(p) : p)
  // Word readings at the end of a range ("fine") stand for zero.
  const shown = (p: number) => {
    const n = numberIn(format(valueAt(p)))
    return Number.isFinite(n) ? n : 0
  }
  const rising = shown(max) >= shown(min)
  // Where along the track the reading stops being `below` (searched in halves).
  const edge = (below: (n: number) => boolean) => {
    let lo = min
    let hi = max
    for (let i = 0; i < 48; i++) {
      const mid = (lo + hi) / 2
      if (below(shown(mid)) === rising) lo = mid
      else hi = mid
    }
    return (lo + hi) / 2
  }
  const from = edge((n) => n < typed)
  const to = edge((n) => n <= typed)
  const snap = (p: number) => Math.min(max, Math.max(min, Math.round((p - min) / step) * step + min))
  let position = snap((from + to) / 2)
  // A grid coarser than the reading: the nearest step that still shows it, if one does.
  if (shown(position) !== typed)
    for (const q of [snap(position - step), snap(position + step)])
      if (shown(q) === typed) {
        position = q
        break
      }
  return valueAt(position)
}

/**
 * The one labelled range control both panels use. Double-click the label or
 * the track to reset it to the current look's value; click the number to type
 * one, in the units shown.
 */
export function Slider({ label, value, min, max, step, onChange, format = percent, title, toSlider, fromSlider, touches, def, idle, track, thumb }: SliderProps) {
  const baseValue = useBaseline(value)
  const highlight = useContext(ToneHighlightContext)
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!touches) return
    highlight(held ? touches(value) : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held, value])
  useEffect(() => () => void (touches && highlight(null)), [])
  // Let go anywhere: a range input does not always hear its own pointerup.
  useEffect(() => {
    if (!held) return
    const up = () => setHeld(false)
    window.addEventListener('pointerup', up)
    return () => window.removeEventListener('pointerup', up)
  }, [held])
  const [editing, setEditing] = useState<string | null>(null)

  const valueAt = (position: number) => (fromSlider ? fromSlider(position) : position)

  const fromTyped = (typed: number) => valueForTyped(typed, { min, max, step, format, fromSlider })

  const commit = () => {
    if (editing !== null) {
      const next = fromTyped(numberIn(editing))
      if (next !== null) onChange(next)
    }
    setEditing(null)
  }

  // Back to the look's value. Already there (the control was shown again, a
  // tab switched, after a change), or a module's main amount first seen while
  // the module was off (0): back to where the module starts instead.
  const reset = () =>
    onChange(def !== undefined && (Math.abs(value - baseValue) <= step / 2 || (baseValue === 0 && def !== 0)) ? def : baseValue)
  const at = (v: number) => (((toSlider ? toSlider(v) : v) - min) / (max - min || 1)) * 100
  const p = at(value)
  const d = def === undefined ? null : Math.min(100, Math.max(0, at(def)))
  // Changed from the module's start: by more than a step, so rounding is not a change.
  const changed = def !== undefined && Math.abs(value - def) > step / 2
  // Changed since the recipe was applied (or the control appeared): yours.
  const yours = Math.abs(value - baseValue) > step / 2

  return (
    <label className={`field${changed ? ' changed' : ''}${def !== undefined ? ' from-default' : ''}${idle ? ' is-idle' : ''}`} title={idle || undefined}>
      <span title={idle ? undefined : `${title ?? label} — double-click to reset`} onDoubleClick={reset}>
        {label}
      </span>
      {/* The knob's own mark, over it where it is on the track (an 18px knob). */}
      {thumb ? (
        <span className="range-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          className={[track ? 'tinted' : '', thumb ? 'pictured' : ''].filter(Boolean).join(' ') || undefined}
          style={{
            ['--lo' as string]: `${d === null ? 0 : Math.min(d, p)}%`,
            ['--p' as string]: `${d === null ? p : Math.max(d, p)}%`,
            ...(track ? { ['--track' as string]: track } : {}),
          }}
          value={toSlider ? toSlider(value) : value}
          onDoubleClick={reset}
          onChange={(e) => onChange(valueAt(Number(e.target.value)))}
          onPointerDown={touches ? () => setHeld(true) : undefined}
          onPointerUp={touches ? () => setHeld(false) : undefined}
          onPointerCancel={touches ? () => setHeld(false) : undefined}
          onKeyDown={touches ? () => setHeld(true) : undefined}
          onBlur={touches ? () => setHeld(false) : undefined}
        />
          <span className="thumb-mark" style={{ left: `calc(9px + (100% - 18px) * ${Math.min(100, Math.max(0, p)) / 100})` }}>
            {thumb}
          </span>
        </span>
      ) : (
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          className={[track ? 'tinted' : '', thumb ? 'pictured' : ''].filter(Boolean).join(' ') || undefined}
          style={{
            ['--lo' as string]: `${d === null ? 0 : Math.min(d, p)}%`,
            ['--p' as string]: `${d === null ? p : Math.max(d, p)}%`,
            ...(track ? { ['--track' as string]: track } : {}),
          }}
          value={toSlider ? toSlider(value) : value}
          onDoubleClick={reset}
          onChange={(e) => onChange(valueAt(Number(e.target.value)))}
          onPointerDown={touches ? () => setHeld(true) : undefined}
          onPointerUp={touches ? () => setHeld(false) : undefined}
          onPointerCancel={touches ? () => setHeld(false) : undefined}
          onKeyDown={touches ? () => setHeld(true) : undefined}
          onBlur={touches ? () => setHeld(false) : undefined}
        />
      )}
      {editing !== null ? (
        <input
          className="value-edit"
          autoFocus
          value={editing}
          onFocus={(e) => e.target.select()}
          onChange={(e) => setEditing(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(null)
            e.stopPropagation()
          }}
        />
      ) : (
        <output
          className={`value-click${yours ? ' yours' : ''}`}
          title="Click to type a value"
          onClick={(e) => {
            e.preventDefault()
            setEditing(format(value).replace(/[^0-9.+-]/g, ''))
          }}
        >
          {format(value)}
        </output>
      )}
    </label>
  )
}

interface RangeSliderProps {
  label: string
  /** The value at the start (the first copy, say) and at the end. */
  value: [number, number]
  min: number
  max: number
  step: number
  format?: (v: number) => string
  title?: string
  /** What double-clicking the label puts back. */
  def?: [number, number]
  /** Names for the two ends, for their tooltips and screen readers. */
  ends?: [string, string]
  onChange: (value: [number, number]) => void
}

/**
 * Two values on one track, a start and an end, for a setting that changes
 * across something (Repeat's copies, first to last). Either handle can be
 * on either side: the start above the end is a setting that falls. Drag a
 * handle, or press the track to bring the nearer one there; arrow keys move
 * a focused one (Shift: ten steps). Double-click the label to reset.
 */
export function RangeSlider({ label, value, min, max, step, format = percent, title, def, ends = ['First', 'Last'], onChange }: RangeSliderProps) {
  const track = useRef<HTMLDivElement>(null)
  const drag = useRef<0 | 1 | null>(null)
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min))
  const at = (v: number) => ((v - min) / (max - min || 1)) * 100
  const valueAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect()
    return snap(min + ((clientX - r.left) / Math.max(r.width, 1)) * (max - min))
  }
  const set = (which: 0 | 1, v: number) => onChange(which === 0 ? [v, value[1]] : [value[0], v])
  const down = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    e.preventDefault()
    const v = valueAt(e.clientX)
    const handle = (e.target as HTMLElement).closest('[data-end]')
    // The handle pressed, or the nearer one; level, the one on the side pressed.
    const which: 0 | 1 = handle
      ? (Number(handle.getAttribute('data-end')) as 0 | 1)
      : Math.abs(v - value[0]) < Math.abs(v - value[1]) || (value[0] === value[1] && v < value[0] === value[0] <= value[1])
        ? 0
        : 1
    drag.current = which
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    ;(track.current?.querySelector(`[data-end="${which}"]`) as HTMLElement | null)?.focus()
    if (!handle) set(which, v)
  }
  const move = (e: React.PointerEvent) => {
    if (drag.current === null) return
    set(drag.current, valueAt(e.clientX))
  }
  const up = () => (drag.current = null)
  const key = (which: 0 | 1) => (e: React.KeyboardEvent) => {
    const by = (e.shiftKey ? 10 : 1) * step
    const d = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? by : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -by : 0
    if (!d) return
    e.preventDefault()
    set(which, snap(value[which] + d))
  }
  const reset = () => def && onChange(def)
  const changed = !!def && (Math.abs(value[0] - def[0]) > step / 2 || Math.abs(value[1] - def[1]) > step / 2)
  const lo = Math.min(at(value[0]), at(value[1]))
  const hi = Math.max(at(value[0]), at(value[1]))
  return (
    <div className={`field range2-field${changed ? ' changed' : ''}`}>
      <span title={`${title ?? label} — double-click to reset`} onDoubleClick={reset}>
        {label}
      </span>
      <div className="range2" ref={track} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onDoubleClick={reset} title={title}>
        <div className="range2-track" />
        <div className="range2-fill" style={{ left: `${lo}%`, width: `${hi - lo}%` }} />
        {([0, 1] as const).map((k) => (
          <div
            key={k}
            data-end={k}
            className={`range2-thumb${k === 0 ? ' first' : ' last'}`}
            style={{ left: `${at(value[k])}%` }}
            role="slider"
            tabIndex={0}
            aria-label={`${label}: ${ends[k].toLowerCase()}`}
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={value[k]}
            aria-valuetext={format(value[k])}
            title={`${ends[k]}: ${format(value[k])}`}
            onKeyDown={key(k)}
          />
        ))}
      </div>
      <output className="range2-value" title={`${ends[0]} → ${ends[1].toLowerCase()}`}>
        {value[0] === value[1] ? format(value[0]) : `${format(value[0])}→${format(value[1])}`}
      </output>
    </div>
  )
}

const encode = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055)

/**
 * A brightness setting's range, shown, not set: the photo's brightness from
 * dark to light with the part the setting touches shaded. It sits above the
 * slider (or the pair of sliders) it belongs to and follows them as they
 * move. Pointing at the photo marks that pixel's brightness on it.
 */
export function ToneGauge({ range }: { range: ToneRange }) {
  const histogram = useContext(HistogramContext)
  const pointed = useSyncExternalStore(pointedTone.subscribe, pointedTone.get)
  if (!histogram) return null
  const linear = range.space === 'linear'
  const x = (v: number) => Math.min(1, Math.max(0, linear ? encode(v) : v))
  const peak = Math.max(1, ...histogram)
  const n = histogram.length
  const path = `M0,1 ${histogram.map((v, i) => `L${(i + 0.5) / n},${1 - Math.sqrt(v / peak) * 0.9}`).join(' ')} L1,1 Z`
  const soft = range.soft ?? 0
  const lo = x(range.lo)
  const hi = x(range.hi)
  const loSoft = x(range.lo - soft)
  const hiSoft = x(range.hi + soft)
  // Drawn as an image, not inline SVG: stretched to the bar, WebKit lost
  // pieces of an inline drawing whenever the pointed line moved over it and
  // left black marks where the line had been; an image repaints whole.
  const rect = (x0: number, w: number, fill: string) =>
    `<rect x='${x0}' y='0' width='${Math.max(0, w)}' height='1' fill='${fill}'/>`
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1' preserveAspectRatio='none'>` +
    `<defs><linearGradient id='r'><stop offset='0' stop-color='#0b0b0c'/><stop offset='1' stop-color='#e9e9e9'/></linearGradient></defs>` +
    `<rect x='0' y='0' width='1' height='1' fill='url(#r)' opacity='0.18'/>` +
    `<path d='${path}' fill='rgba(255,255,255,0.16)'/>` +
    (loSoft < lo ? rect(loSoft, lo - loSoft, 'rgba(255,40,190,0.16)') : '') +
    rect(lo, hi - lo, 'rgba(255,40,190,0.38)') +
    (hiSoft > hi ? rect(hi, hiSoft - hi, 'rgba(255,40,190,0.16)') : '') +
    `</svg>`
  return (
    <div
      className="tone-gauge"
      style={{ backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(svg)}")` }}
      title={range.label ? `${range.label}: the shaded part of the photo's brightness` : undefined}
    >
      {/* The line on a layer of its own, moved by transform: moving it never
          repaints the bar, which WebKit did in pieces, leaving black marks. */}
      <i className="pointed" style={{ transform: `translateX(${(pointed ?? 0) * 100}%)`, opacity: pointed === null ? 0 : 1 }} />
      {range.label && <span>{range.label}</span>}
    </div>
  )
}

interface SwitchProps {
  on: boolean
  onToggle: () => void
  label: string
}

/** On/off for a module. Off keeps every setting; it just stops rendering. */
export function ModuleSwitch({ on, onToggle, label }: SwitchProps) {
  return (
    <button
      className={on ? 'module-switch on' : 'module-switch'}
      role="switch"
      aria-checked={on}
      title={`${on ? 'Turn off' : 'Turn on'} ${label}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggle()
      }}
    >
      <span />
    </button>
  )
}

interface ModuleProps {
  /** Which module: its header (switch, reset, mask, presets) follows from it (moduleCatalog). */
  id: StackModuleId
  title: string
  /** What it is doing, shown in the header while folded ("35%", "3 shapes"). */
  summary?: string
  children: ReactNode
}

export interface SectionMaskProps {
  masks: MaskShape[]
  use: SectionMask | undefined
  onChange: (use: SectionMask | undefined) => void
  /** A new mask being made for this module, if one is: its kind. */
  making: AddKind | null
  /** Room for another mask, and a photo to make it on. */
  canMake: boolean
  /** Make a new mask of this kind, used by this module (on this side) once it is made; again stops. */
  onNew: (kind: AddKind, mode: 'only' | 'exclude') => void
  /** A subject being selected for this module: what it found, and keeping it. */
  pick?: MaskPick | null
  /** That mask opened in the Masks list, its settings showing. */
  onOpenMask?: (id: string) => void
  /** Show this mask on the photo while the menu is open (null: none). */
  onPeek?: (id: string | null) => void
}

/** A subject being selected for something, shown where it was started. */
export interface MaskPick {
  view: PickingState
  onReading: (reading: number) => void
  onDone: (keep: boolean) => void
}

/**
 * A module's masks: which masks it uses, and whether it works only inside
 * them or everywhere but them. A new mask of any kind (selected, drawn,
 * painted, a gradient, a radial) can be made from here, and this module uses
 * it at once; the Masks panel on the left lists them all, and one mask can
 * serve any number of modules.
 */
function SectionMaskMenu({ masks, use, onChange, making, canMake, onNew, pick, onOpenMask, onPeek, title, section, onClose }: SectionMaskProps & { title: string; section: string; onClose: () => void }) {
  // Esc closes it (not while a mask is being made on the photo: Esc stops that first).
  useEffect(() => {
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || making || pick || inTextField(e.target) || document.querySelector('[role="dialog"]')) return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [making, pick, onClose])
  const lower = title.toLowerCase()
  const ids = use?.ids.filter((id) => masks.some((m) => m.id === id)) ?? []
  const mode = use?.mode ?? 'only'
  return (
    <div className="section-mask" role="group" aria-label={`Where ${lower} applies`}>
      <div className="section-mask-head">
        <b>Where it applies</b>
        {masks.length > 0 && <OverlayToggle />}
        <button className="icon" title="Close (Esc)" aria-label="Close" onClick={onClose}>
          ×
        </button>
      </div>
      <MaskUse
        title={title}
        masks={masks}
        ids={ids}
        mode={mode}
        // Kept with no masks ticked too, so the side chosen stays when they are ticked again (an empty list is no mask to the engine).
        onSet={(next, nextMode) => onChange({ ids: next, mode: nextMode })}
        making={making}
        canMake={canMake}
        onNew={onNew}
        pick={pick}
        onOpenMask={onOpenMask}
        onPeek={onPeek}
        newMaskAt={`newmask:${section}`}
      />
    </div>
  )
}

export interface MaskUseProps {
  /** What it is, for its tooltips ("Grain", "Streak 2"). */
  title: string
  /** The masks to choose from: the Masks list's, and any of its own. */
  masks: { id: string; name: string }[]
  ids: string[]
  mode: 'only' | 'exclude'
  onSet: (ids: string[], mode: 'only' | 'exclude') => void
  making: AddKind | null
  canMake: boolean
  onNew: (kind: AddKind, mode: 'only' | 'exclude') => void
  pick?: MaskPick | null
  /** A mask's Edit: open it (in the Masks list, or its own settings where it is kept). */
  onOpenMask?: (id: string) => void
  /** Which masks' Edit is open here (its settings shown under its row). */
  openMask?: string | null
  /** The settings of the mask whose Edit is open here, shown under its row. */
  maskBody?: ReactNode
  onPeek?: (id: string | null) => void
  /** Where the edit box of a mask being made goes (EditBox at). */
  newMaskAt: string
  /** Side choices that can't be had now, and why (a streak's subject kept in front can't be Inside too). */
  sideDisabled?: { only?: string; exclude?: string }
}

/**
 * Where something applies, as every module and every streak has it: the
 * masks ticked, Inside them or Outside them, and + New mask (selected,
 * drawn, painted, a gradient, a radial), used here at once. One pattern
 * for all of them.
 */
export function MaskUse({ title, masks, ids, mode, onSet, making, canMake, onNew, pick, onOpenMask, openMask, maskBody, onPeek, newMaskAt, sideDisabled }: MaskUseProps) {
  const set = (next: string[], nextMode = mode) => onSet(next, nextMode)
  const [choosing, setChoosing] = useState(false)
  const making_ = making ? ADD_KINDS.find((k) => k.kind === making) : null
  // While shown, the photo shows the mask pointed at in the list, else the
  // one it uses last (the one just made): which mask is where, at a glance.
  const [pointed, setPointed] = useState<string | null>(null)
  const peek = making_ || pick ? null : (pointed ?? ids[ids.length - 1] ?? null)
  useEffect(() => {
    onPeek?.(peek)
  }, [peek, onPeek])
  useEffect(() => () => onPeek?.(null), [onPeek])
  const add = (
    <div className="section-mask-new">
      {pick ? (
        <PickPanel p={pick.view} onPickReading={pick.onReading} onPickDone={pick.onDone} />
      ) : making_ ? (
        // Its Cancel and Done, with what to do, in the edit's box (EditBox).
        <EditBox at={newMaskAt} />
      ) : (
        <button className={`link${choosing ? ' on' : ''}`} disabled={!canMake} aria-expanded={choosing} title={canMake ? `Make a new mask for ${title.toLowerCase()}` : 'No room for another mask'} onClick={() => setChoosing(!choosing)}>
          + New mask
        </button>
      )}
      {choosing && !making_ && !pick && (
        <div className="mask-choices compact">
          {ADD_KINDS.map((k) => (
            <button
              key={k.kind}
              className="mask-choice"
              title={k.title}
              onClick={() => {
                setChoosing(false)
                onNew(k.kind, mode)
              }}
            >
              <MaskGlyph kind={k.kind} />
              <span>
                <b>{k.name}</b>
                <small>{k.line}</small>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
  const them = ids.length > 1 ? 'them' : 'it'
  const sideButtons = (
    <div className="segmented">
      <button
        className={mode === 'only' ? 'on' : ''}
        disabled={!!sideDisabled?.only}
        title={sideDisabled?.only || `${title} only inside the ticked ${ids.length > 1 ? 'masks' : 'mask'}`}
        onClick={() => set(ids, 'only')}
      >
        Inside {them}
      </button>
      <button
        className={mode === 'exclude' ? 'on' : ''}
        disabled={!!sideDisabled?.exclude}
        title={sideDisabled?.exclude || `${title} everywhere but the ticked ${ids.length > 1 ? 'masks' : 'mask'}`}
        onClick={() => set(ids, 'exclude')}
      >
        Outside {them}
      </button>
    </div>
  )
  if (!masks.length)
    return making_ || pick ? (
      add
    ) : (
      <>
        {/* Nothing to choose yet: the ways to make one, straight away. */}
        <p className="hint-line">Whole photo</p>
        <div className="mask-choices compact">
          {ADD_KINDS.map((k) => (
            <button key={k.kind} className="mask-choice" title={k.title} disabled={!canMake} onClick={() => onNew(k.kind, mode)}>
              <MaskGlyph kind={k.kind} />
              <span>
                <b>{k.name}</b>
                <small>{k.line}</small>
              </span>
            </button>
          ))}
        </div>
      </>
    )
  return (
    <>
      {/* Nothing ticked: said, as nothing else shows it. Ticked, the boxes and Inside it / Outside it say it. */}
      {!ids.length && <p className="hint-line mask-applies-now">Whole photo</p>}
      <div className="mask-applies-list" onPointerLeave={() => setPointed(null)}>
        {masks.map((m) => (
          <div key={m.id}>
            <div className={`mask-applies-row${ids.includes(m.id) ? ' on' : ''}`} onPointerEnter={() => setPointed(m.id)}>
              <label className="mask-applies-item">
                <input type="checkbox" checked={ids.includes(m.id)} onChange={(e) => set(e.target.checked ? [...ids, m.id] : ids.filter((id) => id !== m.id))} />
                <span>{m.name}</span>
              </label>
              {onOpenMask && (
                <button className={`link quiet mask-open${openMask === m.id ? ' on' : ''}`} title={`${openMask === m.id ? 'Close' : 'Open'} ${m.name}'s settings`} onClick={() => onOpenMask(m.id)}>
                  {openMask === m.id ? 'Close' : 'Edit'}
                </button>
              )}
            </div>
            {openMask === m.id && maskBody && <div className="mask-applies-body">{maskBody}</div>}
          </div>
        ))}
      </div>
      {ids.length > 0 && sideButtons}
      {add}
    </>
  )
}

/**
 * Inside a module's ⋯ menu: what is drawn there (its presets) draws itself as
 * items of that menu, and closes it once it has done something.
 */
export const ModuleMenuContext = createContext<{ close: () => void } | null>(null)

/** The nearest box that scrolls up and down, round el. */
function scrollerOf(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return null
}

/**
 * Something just opened in the panel (a module unfolded, its mask panel, a
 * group of settings): scrolled into view, as much of it as fits, its top
 * never pushed out of sight. Nothing moves when it already shows.
 */
export function reveal(el: HTMLElement | null) {
  if (!el) return
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const box = scrollerOf(el)
      if (!box || !el.isConnected) return
      const b = box.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const pad = 8
      let dy = 0
      if (r.bottom > b.bottom - pad) dy = r.bottom - b.bottom + pad
      // Taller than the panel: its top at the top.
      if (r.top - dy < b.top + pad || r.top < b.top) dy = r.top - b.top - pad
      if (Math.abs(dy) < 2) return
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      box.scrollBy({ top: dy, behavior: still ? 'auto' : 'smooth' })
    }),
  )
}

/**
 * A panel section whose header folds it away. Folding is only about space: a
 * folded module still renders, and says "Off" in its header when it is off.
 */
export function Module({ id, title, summary, children }: ModuleProps) {
  // The header's ⋯ menu: its presets, and its page in the Guide.
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [menuOpen])
  const [maskOpen, setMaskOpen] = useState(false)
  const closeMask = useCallback(() => setMaskOpen(false), [])
  const stack = useContext(StackContext)
  const def = MODULE_BY_ID[id]
  // Every module's header is the same: its mask if it can have one, reset, a
  // ⋯ menu (its presets if it keeps them, how it works), and a switch
  // (whether it is doing anything, as darktable's is: off, it is still all
  // there to use, and using it switches it on). moduleCatalog's MASKABLE,
  // WITH_PRESETS.
  const active = stack ? stack.isOn(id) : undefined
  const mask = stack && MASKABLE.has(id) ? stack.maskFor(id) : undefined
  const presets = stack && presetKind(id) ? stack.presetsFor(id) : null
  const settings = stack?.settings(id) ?? null
  const onReset = stack ? () => stack.reset(id) : undefined
  // One never used starts folded, so a whole category reads as a list. On In
  // use (or a group), every one starts folded: a list of what each is doing.
  const listView = stack?.listView
  const shownSummary = summary ?? stack?.summaryOf?.(id)
  const [collapsed, setCollapsed] = useLocalStorage(listView ? `ui.module.${listView}.${id}` : `ui.module.${id}`, listView ? true : active === false)
  // New in this version (whatsNew.ts): tagged until it is opened.
  const isNew = useIsNew(id)
  useEffect(() => {
    if (isNew && !collapsed) seenModule(id)
  }, [isNew, collapsed, id])
  const tint = CATEGORY_BY_ID[def.category].tint
  const off = active === false
  const sectionRef = useRef<HTMLElement>(null)
  const maskPanelRef = useRef<HTMLDivElement>(null)
  /** Unfolded: open, and brought into view. */
  const unfold = () => {
    setCollapsed(false)
    reveal(sectionRef.current)
  }
  // Switching a module off leaves it where it is, open or folded, greyed: the
  // panel does not jump, and touching any of its controls switches it back on
  // (StackApi.wake). Cmd+K and Add open a folded module they find.
  useEffect(() => {
    const open = (e: Event) => (e as CustomEvent<string>).detail === id && setCollapsed(false)
    // From a mask's row in the Masks list: open, with its mask panel showing.
    const openMask = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== id) return
      setCollapsed(false)
      setMaskOpen(true)
    }
    // Fold all, over the modules.
    const foldAll = () => {
      window.dispatchEvent(new CustomEvent('grain:module-folded', { detail: id }))
      setCollapsed(true)
    }
    // Another module opened on its own (Option-click on its header): this one folds.
    const foldOthers = (e: Event) => {
      if ((e as CustomEvent<string>).detail === id) return
      window.dispatchEvent(new CustomEvent('grain:module-folded', { detail: id }))
      setCollapsed(true)
    }
    window.addEventListener('grain:open-module', open)
    window.addEventListener('grain:open-module-mask', openMask)
    window.addEventListener('grain:fold-all', foldAll)
    window.addEventListener('grain:fold-others', foldOthers)
    return () => {
      window.removeEventListener('grain:fold-others', foldOthers)
      window.removeEventListener('grain:open-module', open)
      window.removeEventListener('grain:open-module-mask', openMask)
      window.removeEventListener('grain:fold-all', foldAll)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, listView, setCollapsed])
  const masked = !!mask?.use?.ids.some((mid) => mask.masks.some((m) => m.id === mid))
  // What the Mask button says: which side of which masks ("Inside Sky").
  const usedNames = masked ? mask!.masks.filter((m) => mask!.use!.ids.includes(m.id)).map((m) => m.name) : []
  const maskWords = !masked
    ? 'Whole photo'
    : `${mask!.use!.mode === 'only' ? 'Inside' : 'Outside'} ${usedNames.join(', ')}`
  // Inside, just the mask's name (lit, so it reads as in use); outside says so.
  const maskNames = usedNames.length > 1 ? `${usedNames.length} masks` : usedNames[0]
  const maskLabel = !masked ? '' : mask!.use!.mode === 'only' ? maskNames : `Outside ${maskNames}`
  const lower = title.toLowerCase()
  // The Mask button's words ("Mask", "Inside Sky") only while the module's
  // name fits whole beside them: short of room, the button is its mark alone.
  const headRef = useRef<HTMLDivElement>(null)
  const [maskWordsShown, setMaskWordsShown] = useState(true)
  const wordsWidth = useRef(0)
  useLayoutEffect(() => {
    const head = headRef.current
    if (!head || !mask) return
    const check = () => {
      const name = head.querySelector('.section-toggle h2') as HTMLElement | null
      const toggle = head.querySelector('.section-toggle') as HTMLElement | null
      const words = head.querySelector('.section-mask-button .mask-label') as HTMLElement | null
      if (!name || !toggle) return
      if (words) wordsWidth.current = words.getBoundingClientRect().width
      if (maskWordsShown) {
        if (name.scrollWidth > name.clientWidth + 1) setMaskWordsShown(false)
      } else {
        const last = toggle.lastElementChild?.getBoundingClientRect().right ?? toggle.getBoundingClientRect().right
        if (toggle.getBoundingClientRect().right - last >= wordsWidth.current + 10) setMaskWordsShown(true)
      }
    }
    check()
    const watch = new ResizeObserver(check)
    watch.observe(head)
    return () => watch.disconnect()
  }, [maskWordsShown, maskLabel, title, collapsed, !!mask])
  return (
    <section
      ref={sectionRef}
      id={`module-${id}`}
      className={`module${off ? ' module-off' : ''}${collapsed ? ' collapsed' : ''}`}
      style={{ order: moduleOrder(id), ['--tint' as string]: tint }}
    >
      <div className="section-head" ref={headRef}>
        <button
          className="section-toggle"
          aria-expanded={!collapsed}
          title={singleModuleStore.get() ? `${isMac() ? '⌥' : 'Alt'}-click: open ${lower} beside the others` : `${isMac() ? '⌥' : 'Alt'}-click: open only ${lower}`}
          onClick={(e) => {
            // Opening one: the others fold (Settings: Open one module at a time), or with Option-click when that
            // is off. Option-click with it on opens this one beside the rest.
            const single = singleModuleStore.get()
            if ((collapsed && single !== e.altKey) || (!collapsed && e.altKey && !single)) {
              window.dispatchEvent(new CustomEvent('grain:fold-others', { detail: id }))
              if (collapsed) unfold()
              return
            }
            // Folded, whatever it had going on the photo ends (App's one-thing-on-the-photo rule).
            if (!collapsed) window.dispatchEvent(new CustomEvent('grain:module-folded', { detail: id }))
            if (collapsed) unfold()
            else setCollapsed(true)
          }}
        >
          <span className="disclosure-caret" aria-hidden />
          <ModuleGlyph id={id} tint={tint} size={14} />
          <h2>{title}</h2>
          <NewTag id={id} dot />
        </button>
        {/* Its mask, as darktable's modules have it: a button in the header,
            always there, that opens the mask panel right under it. Masked,
            it is lit and says which side, folded too. */}
        {mask && (
          <button
            className={`section-mask-button${masked ? ' on' : ''}${maskOpen ? ' open' : ''}`}
            aria-expanded={maskOpen}
            aria-label={masked ? `${title}: ${mask.use!.mode === 'only' ? 'only inside' : 'only outside'} its masks` : `Mask ${lower}`}
            title={masked ? `${title}: ${maskWords}` : `Mask: keep ${lower} to part of the photo`}
            onClick={() => {
              if (collapsed) setCollapsed(false)
              const opening = collapsed || !maskOpen
              setMaskOpen(opening)
              if (opening) reveal(maskPanelRef.current ?? sectionRef.current)
            }}
          >
            <ModuleMaskGlyph />
            {/* Says what it is until something is masked, then which mask. */}
            {/* Folded, the room goes to what it is doing: the word only when masked. */}
            {maskWordsShown && (masked || !collapsed) && <span className="mask-label">{masked ? maskLabel : 'Mask'}</span>}
          </button>
        )}
        {/* Reset, always there, as darktable and Capture One have it: used often while trying things. */}
        {onReset && (
          <button className="section-reset" title={`Reset ${lower} to its defaults`} aria-label={`Reset ${lower}`} onClick={onReset}>
            ↺
          </button>
        )}
        {/* Less used, in one menu: presets and how it works. Last before the
            switch, so the mask's label appearing to its left never moves it. */}
        <div className="menu-anchor preset-anchor" ref={menuRef}>
          <button
            className={`section-more${menuOpen ? ' open' : ''}`}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            aria-label={`More for ${lower}`}
            title={presets ? `Presets, copy and paste, and how ${lower} works` : settings ? `Copy and paste, and how ${lower} works` : `How ${lower} works`}
            onClick={() => setMenuOpen(!menuOpen)}
          >
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
              <circle cx="3" cy="8" r="1.5" fill="currentColor" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
              <circle cx="13" cy="8" r="1.5" fill="currentColor" />
            </svg>
          </button>
          {menuOpen && (
            <div className="menu preset-menu module-menu" role="menu">
              {presets && (
                <>
                  <ModuleMenuContext.Provider value={{ close: closeMenu }}>{presets}</ModuleMenuContext.Provider>
                  <div className="menu-rule" />
                </>
              )}
              {settings && (
                <>
                  <button
                    role="menuitem"
                    className="menu-item"
                    title={`Copy ${lower}'s settings, to paste onto ${lower} on another photo`}
                    onClick={() => {
                      closeMenu()
                      settings.copy()
                    }}
                  >
                    Copy settings
                  </button>
                  <button
                    role="menuitem"
                    className="menu-item"
                    disabled={!settings.copied}
                    title={settings.copied ? `Give ${lower} the settings copied from ${settings.copied}` : `Copy ${lower}'s settings first, on this photo or another`}
                    onClick={() => {
                      closeMenu()
                      settings.paste()
                    }}
                  >
                    {settings.copied ? `Paste settings from ${settings.copied}` : 'Paste settings'}
                  </button>
                  <div className="menu-rule" />
                </>
              )}
              <button
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  closeMenu()
                  // Its page in the Guide (App opens it).
                  window.dispatchEvent(new CustomEvent('grain:open-guide', { detail: id }))
                }}
              >
                How {lower} works
              </button>
            </div>
          )}
        </div>
        {stack && (
          <ModuleSwitch
            on={!off}
            onToggle={() => {
              // On with something still to do first (a streak to draw, a
              // second photo to choose): opened, to show what.
              if (stack.toggle(id) === 'setup' && collapsed) unfold()
            }}
            label={lower}
          />
        )}
        {/* What it is doing, while folded: a line of its own under the name, so neither is cut short. */}
        {collapsed && shownSummary && !off && (
          <span className="section-summary" title={shownSummary} onClick={unfold} aria-hidden>
            {shownSummary}
          </span>
        )}
      </div>
      {/* The mask panel, opened by the header's mask button, right under it. */}
      {mask && !collapsed && maskOpen && (
        <div className="module-mask open" ref={maskPanelRef}>
          <SectionMaskMenu {...mask} title={title} section={id} onClose={closeMask} />
        </div>
      )}
      {!collapsed && (
        <div
          className="module-body"
          // Off: the next change made in here switches it back on with it.
          onPointerDownCapture={() => {
            if (!def || !stack) return
            stack.touch(def.id)
            if (off) stack.wake(def.id)
            window.addEventListener(
              'pointerup',
              () =>
                setTimeout(() => {
                  stack.sleep()
                  stack.touch(null)
                }, 0),
              { once: true },
            )
          }}
          onKeyDownCapture={() => {
            if (!def || !stack) return
            stack.touch(def.id)
            if (off) stack.wake(def.id)
            window.addEventListener(
              'keyup',
              () =>
                setTimeout(() => {
                  stack.sleep()
                  stack.touch(null)
                }, 0),
              { once: true },
            )
          }}
          // Off, its action buttons (Draw…, Place…) switch it on too, even when
          // they change nothing yet: after the click, so a button that does
          // change something switches it on with that change instead.
          onClickCapture={(e) => {
            if (!off || !def || !stack) return
            if (!(e.target as Element).closest?.('.module-actions-row button:not(:disabled)')) return
            setTimeout(() => stack.startFrom(def.id), 0)
          }}
        >
          {/* What is being edited on the photo for it, if its own place is not showing (EditBox). */}
          <EditBox home={id} />
          {children}
        </div>
      )}
    </section>
  )
}

/** A module's mask button's mark: a frame with a soft-edged shape kept inside it. */
export function ModuleMaskGlyph() {
  return (
    <svg className="mask-glyph" width="15" height="15" viewBox="0 0 16 16" aria-hidden>
      <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="8" cy="8" r="3.6" fill="currentColor" />
    </svg>
  )
}

interface DisclosureProps {
  /** Persists the open state, so the panel reopens the way it was left. */
  id: string
  title: string
  /** Short state shown while closed — "Off", "5%" — so a closed group still says whether it is doing anything. */
  summary?: string
  children: ReactNode
  /** When given, the group is a module with its own on/off switch. */
  enabled?: boolean
  onToggle?: () => void
  /** Open the first time it is seen; after that it remembers. */
  defaultOpen?: boolean
  /** Held by the caller instead, when it needs to know whether it is open. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Collapsible group for the controls most looks never need to touch. */
export function Disclosure({ id, title, summary, children, enabled, onToggle, defaultOpen = false, open: held, onOpenChange }: DisclosureProps) {
  const [kept, setKept] = useLocalStorage(`ui.disclosure.${id}`, defaultOpen)
  const open = held ?? kept
  const setOpen = (o: boolean) => (onOpenChange ? onOpenChange(o) : setKept(o))
  const off = enabled === false
  const ref = useRef<HTMLDivElement>(null)
  return (
    <div ref={ref} className={`disclosure${open ? ' open' : ''}${off ? ' module-off' : ''}`}>
      <div className="disclosure-row">
        <button
          className="disclosure-head"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open)
            if (!open) reveal(ref.current)
          }}
        >
          <span className="disclosure-caret" aria-hidden />
          <span className="disclosure-title">{title}</span>
          {summary && <span className="disclosure-summary">{summary}</span>}
        </button>
        {enabled !== undefined && onToggle && <ModuleSwitch on={enabled} onToggle={onToggle} label={title.toLowerCase()} />}
      </div>
      {open && <div className="disclosure-body">{children}</div>}
    </div>
  )
}

/**
 * A fresh random arrangement of a module's random parts (where the dust
 * falls, how a leak's edge breaks up), the same in every module: settings
 * stay as they are.
 */
export function Shuffle({ onShuffle, what }: { onShuffle: () => void; what: string }) {
  return (
    <button className="shuffle" title={`A different random ${what}; the settings stay as they are`} onClick={onShuffle}>
      <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
        <path d="M1.5 4.5h3c2 0 3 1 4 3.5s2 3.5 4 3.5h2M1.5 11.5h3c1.2 0 2-.4 2.7-1.2M10 5.7c.6-.8 1.4-1.2 2.5-1.2h2" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M12.8 2.6 14.5 4.5l-1.7 1.9M12.8 9.6l1.7 1.9-1.7 1.9" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Shuffle
    </button>
  )
}

/** The row under a module's controls: its on-photo tools and Shuffle, in one place. */
/** Show another module where it lives, open (App: showModuleNow). */
export const showModule = (id: string) => window.dispatchEvent(new CustomEvent('grain:show-module', { detail: id }))

export function ModuleActions({ children }: { children: ReactNode }) {
  return <div className="module-actions-row">{children}</div>
}
