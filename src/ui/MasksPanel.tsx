import { setBrushRange, useBrushRange } from './maskBrush'
import './lists.css'
import { EditBox } from './EditBox'
import { KEY_BAND } from '../engine/maskCover'
import { ColourField } from './ColourField'
import { originalOf } from '../engine/original'
import { NEUTRAL_PALETTE } from '../engine/palette'
import { DEFAULT_KEY_COLOUR } from '../engine/keyValue'
import { MAX_MASKS, MASK_SECTIONS, type EffectParams, type MaskOwner, type MaskSection, type MaskShape, type SectionMask } from '../engine/types'
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ADD_KINDS, MaskGlyph, MaskOverlayContext, PickPanel, type AddKind, type NewMaskTarget, type PickingState } from './maskKinds'

export { PickPanel, type PickingState }
import type { Pick, PickBox } from '../ml/segment'
import type { MaskView } from './maskKey'
import { Slider, ToneGauge, toneTrack } from './controls'
import { ItemList } from './ItemList'
import { ModuleGlyph } from './ModuleGlyph'
import { CATEGORY_BY_ID, MODULE_BY_ID, type StackModuleId } from './moduleCatalog'
import { maskKind, maskOn } from '../engine/maskShapes'
import { TraceToKey, type TraceOutline } from './TraceToKey'
import { track } from '../platform/usage'

const SECTION_NAMES: Record<MaskSection, string> = {
  grain: 'Grain',
  colour: 'Colour',
  tone: 'Tone',
  light: 'Glow',
  edges: 'Edges',
  solarize: 'Solarize',
  leaks: 'Leaks & burns',
  streaks: 'Streaks',
  glass: 'Glass',
  lighting: 'Lighting',
  mono: 'Black & white',
  dither: 'Dither',
  pixel: 'Pixel art',
  halftone: 'Halftone & riso',
  dust: 'Dust & scratches',
  surge: 'Surge marks',
  repeat: 'Repeat',
  kaleido: 'Kaleidoscope',
}

interface Props {
  masks: MaskShape[]
  maskUse: EffectParams['maskUse']
  hasImage: boolean
  /** Drawing a new mask on the photo. */
  drawing: boolean
  selected: number | null
  onDraw: () => void
  /** Place a radial or gradient mask: dragged out on the photo. */
  onAddShape: (kind: 'gradient' | 'radial') => void
  /** One being placed, if any. */
  placing: 'gradient' | 'radial' | null
  /** Switch a mask off (kept, used by nothing) or back on. */
  onToggle: (index: number) => void
  onSelect: (index: number | null) => void
  /** `step` names the edit, so a slider's whole drag is one step to undo. */
  onChange: (index: number, patch: Partial<MaskShape>, step: string) => void
  onRemove: (index: number) => void
  /** A copy of mask `index`, next after it; `full` when no more fit. */
  onDuplicate?: (index: number) => void
  /** A selected subject made into points round its edge (its … menu). */
  onToPoints?: (index: number) => void
  masksFull?: boolean
  /** Which streaks keep off (or to) each mask on their own, by mask id. */
  streakUsers: (id: string) => string[]
  /** A module this mask applies to, shown in the modules with its mask panel open. */
  onGoToModule?: (id: StackModuleId) => void
  /** Traces an outline to a key on the photo (see TraceToKey). */
  trace?: TraceOutline
  /** Selecting a subject by clicking it, when under way. */
  picking: PickingState | null
  /** Start selecting: for a mask (its outline replaced), or null for a new one. */
  onPick: (index: number | null) => void
  onPickReading: (reading: number) => void
  onPickDone: (keep: boolean) => void
  /** Set which masks modules use, and whether they work inside or outside them: several at once. */
  onUse: (changes: [MaskSection, SectionMask | undefined][]) => void
  /** Whether a module is on the photo, so the ones in use are listed first. */
  sectionInUse: (section: MaskSection) => boolean
  /** Painting a subject mask by hand, if under way. */
  brushing: { index: number; mode: 'add' | 'remove' } | null
  brushSize: number
  onBrushSize: (size: number) => void
  /** Start painting a mask in or out (the same again, or null, stops). */
  onBrush: (index: number | null, mode: 'add' | 'remove') => void
  /** A new mask painted by hand from nothing. */
  onNewPainted: () => void
  /** The mask being reshaped on the photo, if one is, and the pencil that starts or stops it. */
  editingIndex: number | null
  onEditShape: (index: number) => void
  /**
   * Match a mask to the photo's own colours: not at all, along its edge, or
   * all over it; `again` reads the photo again for its settings.
   */
  onMatch: (index: number, to: 'off' | 'edge' | 'all' | 'again') => void
  /** How an open selected or painted mask shows on the photo. */
  maskView: MaskView
  onMaskView: (view: MaskView) => void
  brushByColour: boolean
  onBrushByColour: (on: boolean) => void
}

/** The clicks and box at one moment of selecting a subject. */
export type PickStep = { picks: Pick[]; box: PickBox | null }

/** Selecting a subject, as App keeps it while the clicks and box change. */
export interface Picking {
  index: number | null
  picks: Pick[]
  /** A box dragged round the subject, if any. */
  box: PickBox | null
  /** Which of the model's three readings (smallest to largest); null: its choice. */
  reading: number | null
  shown: number
  busy: boolean
  /** Clicks leave parts out rather than add them (Option flips it for one click). */
  leaveOut?: boolean
  /** Earlier clicks and boxes, for Cmd+Z while selecting, and those taken back. */
  past: PickStep[]
  future: PickStep[]
  /** The masks as they were, for Cancel. */
  before: MaskShape[]
  beforeUse: EffectParams['maskUse']
  /**
   * Selecting Repeat's own piece, not a mask for the Masks list; or a subject
   * to streak (Streak a subject), shown in Streaks while it is picked.
   */
  owner?: MaskOwner
  /** Streak a subject: the streak whose subject is picked again; missing, a new one. */
  streak?: number
  /** Started from a module's Mask menu: the new mask is used there. */
  target?: NewMaskTarget
}

const block = (title: string, children: ReactNode) => (
  <div className="mask-block">
    <div className="mask-block-head">
      <span>{title}</span>
    </div>
    {children}
  </div>
)

interface MaskSettingsProps {
  mask: MaskShape
  index: number
  hasImage: boolean
  /** A subject being selected somewhere: Select again waits. */
  picking: boolean
  brushing: { index: number; mode: 'add' | 'remove' } | null
  brushSize: number
  onBrushSize: (size: number) => void
  onBrush: (index: number, mode: 'add' | 'remove') => void
  onPick: (index: number) => void
  /** Being edited on the photo (its edit box says how). */
  editing?: boolean
  onMatch: Props['onMatch']
  onChange: Props['onChange']
  trace?: TraceOutline
  /** Used by Streaks, so its edge can be cleaned for them. */
  cleanEdges: boolean
  /** Between its tools and its edge: the Masks list's Applies to. */
  middle?: ReactNode
  /** Its name field; a module's own piece goes without. */
  named?: boolean
  /** How it shows on the photo, for a selected or painted one. */
  view?: MaskView
  onView?: (view: MaskView) => void
  /** The brush paints only over similar colours (its Brush in says so). */
  byColour?: boolean
  /** The brush's size and Only similar colours are set in the edit's box (BrushBox) while brushing; kept here for callers that pass them. */
  onByColour?: (on: boolean) => void
}

/**
 * A mask's own settings: brushing it in and out, selecting it again, how its
 * edge meets the photo, its feather and reach. The same wherever a mask is
 * worked on: the Masks list, or a module's own piece (Repeat's).
 */
export function MaskSettings({ mask: m, index: i, hasImage, picking, brushing, onBrush, onPick, onMatch, onChange, trace, cleanEdges, middle, named = true, view, onView, byColour = false }: MaskSettingsProps) {
  const kind = maskKind(m)
  const glyph: AddKind = kind === 'subject' && /^Painted\b/.test(m.name) ? 'paint' : kind
  const overlay = useContext(MaskOverlayContext)
  return (
    <>
                  {kind === 'subject' && view && onView && (
                    <div className="field valued">
                      <span title="How the mask shows on the photo while it is open">Show</span>
                      <div className="segmented">
                        <button className={!overlay.on ? 'on' : ''} title="The photo alone, no mask over it (O)" onClick={() => overlay.set(false)}>
                          Off
                        </button>
                        {(
                          [
                            ['red', 'Red', 'A red wash over what it covers, its edge in white'],
                            ['green', 'Green', 'A green wash over what it covers, its edge in white'],
                            ['matte', 'Mask only', 'The mask alone: white where it covers, black where it does not'],
                          ] as const
                        ).map(([v, label, hint]) => (
                          <button
                            key={v}
                            className={overlay.on && view === v ? 'on' : ''}
                            title={hint}
                            onClick={() => {
                              onView(v)
                              if (!overlay.on) overlay.set(true)
                            }}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {kind === 'subject' && (
                    <div className="mask-tools">
                      <div className="segmented mask-brush">
                        <button className={brushing?.index === i && brushing.mode === 'add' ? 'on' : ''} disabled={!hasImage} title={byColour ? 'Paint more into the mask, only over colours like the one you start the stroke on' : 'Paint more into the mask, on the photo'} onClick={() => onBrush(i, 'add')}>
                          Brush in
                        </button>
                        <button className={brushing?.index === i && brushing.mode === 'remove' ? 'on' : ''} disabled={!hasImage} title="Paint part of the mask away, on the photo. Always wins, even over Match the photo." onClick={() => onBrush(i, 'remove')}>
                          Brush out
                        </button>
                      </div>
                      {glyph !== 'paint' && (
                        <button disabled={!hasImage || picking} title="Click parts of the photo to add them, or Option-click to leave them out; the rest of the selection stays" onClick={() => onPick(i)}>
                          Select parts
                        </button>
                      )}
                    </div>
                  )}
                  {/* While brushing, its brush (in or out, size, similar colours) is in the edit's box (BrushBox). */}
                  {kind === 'outline' && (
                    <div className="mask-tools">
                      <button disabled={!hasImage || picking} title="Replace the outline with a selection: a small model on this computer finds the subject's edge" onClick={() => onPick(i)}>
                        Select subject instead
                      </button>
                    </div>
                  )}
                  {middle}
                  {block(
                    'Edge',
                    <>
                  {(() => {
                    const shaped = kind === 'outline' || kind === 'subject'
                    const mode: 'off' | 'edge' | 'all' = m.key === 'off' ? 'off' : shaped && m.keyAt === 'edge' ? 'edge' : 'all'
                    const range = (level: number, soft: number) =>
                      m.key === 'darker'
                        ? { lo: -0.5, hi: level, soft: Math.max(0.01, soft), label: 'Kept' }
                        : { lo: level, hi: 1.5, soft: Math.max(0.01, soft), label: 'Kept' }
                    const space = m.keyOn === 'blue' ? ('blue' as const) : ('encoded' as const)
                    const modes: ['off' | 'edge' | 'all', string, string][] = shaped
                      ? [
                          ['off', 'Off', kind === 'subject' ? 'The selection exactly as it was made' : 'The outline exactly as drawn'],
                          ['edge', 'At the edge', "Along the edge, each pixel goes with whichever it looks more like: the colours just inside or just outside. The edge follows the photo; the rest stays solid."],
                          ['all', 'Everywhere', 'Only the parts of the photo inside the mask that are darker (or lighter) than a level'],
                        ]
                      : [
                          ['off', 'Off', 'The mask as it is'],
                          ['all', 'On', 'Only the parts of the photo inside the mask that are darker (or lighter) than a level'],
                        ]
                    return (
                      <>
                        <div className="field valued" title={modes.find(([to]) => to === mode)?.[2]}>
                          <span title="Whether the photo's own colours decide where the mask ends">Follow photo</span>
                          <div className="segmented" role="radiogroup" aria-label="Follow the photo">
                            {modes.map(([to, label, hint]) => (
                              <button key={to} className={mode === to ? 'on' : ''} title={hint} disabled={!hasImage && to !== 'off'} onClick={() => mode !== to && onMatch(i, to)}>
                                {label}
                              </button>
                            ))}
                          </div>
                        </div>
                        {mode === 'edge' && (
                          <Slider
                            label="Width"
                            title="How far either side of the edge the photo's colours decide. Narrow for thin parts (a mast, branches); wider when the selection is rough."
                            value={m.keyBand ?? KEY_BAND}
                            min={0}
                            max={1}
                            step={0.001}
                            toSlider={(v) => Math.sqrt(v / 0.2)}
                            fromSlider={(s) => Math.max(0.002, Math.round(s * s * 0.2 * 1000) / 1000)}
                            format={(v) => `${(v * 100).toFixed(1)}%`}
                            onChange={(keyBand) => onChange(i, { keyBand }, `mask${i}:keyBand`)}
                          />
                        )}
                        {mode === 'all' && (
                          <>
                            <div className="field valued">
                              <span title="What is compared: how bright each pixel is, how blue, or how like a colour">Compare</span>
                              <div className="segmented">
                                <button className={m.keyOn === 'brightness' || !m.keyOn ? 'on' : ''} title="How bright each pixel is: a dark subject against a light sky" onClick={() => onChange(i, { keyOn: 'brightness' }, `mask${i}:keyOn`)}>
                                  Brightness
                                </button>
                                <button
                                  className={m.keyOn === 'blue' ? 'on' : ''}
                                  title="How blue each pixel is: trees, land or buildings against sky, even where the sky is as bright as they are"
                                  onClick={() => onChange(i, { keyOn: 'blue' }, `mask${i}:keyOn`)}
                                >
                                  Blue
                                </button>
                                <button
                                  className={m.keyOn === 'colour' ? 'on' : ''}
                                  title="How like a colour each pixel is: a green tree, a red car, a teal sign. Pick the colour, or take it from the photo"
                                  onClick={() =>
                                    m.keyOn !== 'colour' &&
                                    onChange(i, { keyOn: 'colour', keyColour: m.keyColour ?? DEFAULT_KEY_COLOUR, key: 'lighter', keyLevel: 0.82, keySoftness: Math.min(Math.max(m.keySoftness, 0.04), 0.08) }, `mask${i}:keyOn`)
                                  }
                                >
                                  Colour
                                </button>
                              </div>
                            </div>
                            {m.keyOn === 'colour' && (
                              <ColourField
                                label="Colour"
                                title="The colour the mask keeps (or leaves out): pick it, or take it from the photo"
                                value={{ source: 'manual', colour: m.keyColour ?? DEFAULT_KEY_COLOUR }}
                                palette={NEUTRAL_PALETTE}
                                photoSources={false}
                                // The key reads the photo as it was taken: so does the dropper.
                                sampleWithout={originalOf}
                                onChange={(c) => onChange(i, { keyColour: c.source === 'manual' ? c.colour : NEUTRAL_PALETTE[c.source] }, `mask${i}:keyColour`)}
                              />
                            )}
                            <div className="field valued">
                              <span title="Which side of the level the mask keeps">Keep</span>
                              <div className="segmented">
                                {(['lighter', 'darker'] as const).map((key) => (
                                  <button key={key} className={m.key === key ? 'on' : ''} onClick={() => onChange(i, { key }, `mask${i}:key`)}>
                                    {m.keyOn === 'colour'
                                      ? key === 'lighter'
                                        ? 'Like it'
                                        : 'Not like it'
                                      : m.keyOn === 'blue'
                                        ? key === 'darker'
                                          ? 'Less blue'
                                          : 'More blue'
                                        : key === 'darker'
                                          ? 'Darker'
                                          : 'Lighter'}
                                  </button>
                                ))}
                              </div>
                            </div>
                            {m.keyOn === 'colour' ? (
                              <Slider
                                label="Range"
                                title="How different a colour can be and still count as like it: more takes in its lighter, darker and nearby shades"
                                value={1 - m.keyLevel}
                                min={0}
                                max={1}
                                step={0.01}
                                onChange={(range) => onChange(i, { keyLevel: 1 - range }, `mask${i}:keyLevel`)}
                              />
                            ) : (
                              <>
                                <ToneGauge range={range(m.keyLevel, m.keySoftness)} />
                                <Slider
                                  track={toneTrack(0, 1, space)}
                                  label="Level"
                                  title="Where the photo is cut between kept and not"
                                  value={m.keyLevel}
                                  min={0}
                                  max={1}
                                  step={0.01}
                                  onChange={(keyLevel) => onChange(i, { keyLevel }, `mask${i}:keyLevel`)}
                                  touches={(level) => ({ ...range(level, m.keySoftness), space })}
                                />
                              </>
                            )}
                            <Slider
                              label="Fade"
                              title="How gradually it cuts between kept and not"
                              value={m.keySoftness}
                              min={0}
                              max={0.3}
                              step={0.005}
                              onChange={(keySoftness) => onChange(i, { keySoftness }, `mask${i}:keySoftness`)}
                              {...(m.keyOn === 'colour' ? {} : { touches: (soft: number) => ({ ...range(m.keyLevel, soft), space }) })}
                            />
                            {shaped && m.keyOn !== 'colour' && (
                              <button disabled={!hasImage} title="Read the photo along the mask's edge again and set these to fit it" onClick={() => onMatch(i, 'again')}>
                                Set from the photo
                              </button>
                            )}
                            {kind === 'outline' && mode === 'all' && (
                              <TraceToKey
                                outline={m.outline}
                                keyed={{ key: m.key as 'darker' | 'lighter', keyOn: m.keyOn ?? 'brightness', keyColour: m.keyColour, keyLevel: m.keyLevel }}
                                trace={trace}
                                onTrace={(outline) => onChange(i, { outline, key: 'off' }, `mask${i}:trace`)}
                              />
                            )}
                          </>
                        )}
                        {cleanEdges && mode !== 'off' && (
                          <Slider
                            label="Clean edges"
                            title="Edge pixels are part subject, part what's behind it, like the sky between needles. Kept in front of the streaks, that part shows as a pale ring. Cleaning swaps it for the streak."
                            value={m.cleanEdges ?? 1}
                            min={0}
                            max={1}
                            step={0.01}
                            format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')}
                            onChange={(cleanEdges) => onChange(i, { cleanEdges }, `mask${i}:cleanEdges`)}
                          />
                        )}
                      </>
                    )
                  })()}
                      {kind === 'radial' && m.radial && (
                        <Slider
                          label="Softness"
                          title="How far in from its edge it fades: a hard circle at 0, a gentle glow at 100"
                          value={m.radial.soft}
                          min={0}
                          max={1}
                          step={0.01}
                          onChange={(soft) => onChange(i, { radial: { ...m.radial!, soft } }, `mask${i}:soft`)}
                        />
                      )}
                      {(kind === 'outline' || kind === 'subject') && !(m.keyAt === 'edge' && m.key !== 'off') && (
                        <Slider
                          label="Feather"
                          title="How softly the mask's edge fades"
                          value={m.feather}
                          min={0}
                          max={1}
                          step={0.001}
                          toSlider={(v) => Math.sqrt(v / 0.5)}
                          fromSlider={(s) => Math.round(s * s * 0.5 * 1000) / 1000}
                          format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Hard')}
                          onChange={(feather) => onChange(i, { feather }, `mask${i}:feather`)}
                        />
                      )}
                      {kind !== 'gradient' && (
                        <Slider
                          label="Grow"
                          title="Reach out past what the mask covers by this much: a band of empty space round the subject (the streaks kept that far off it), further than a feather softens"
                          value={m.grow ?? 0}
                          min={0}
                          max={0.3}
                          step={0.001}
                          format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Off')}
                          onChange={(grow) => onChange(i, { grow }, `mask${i}:grow`)}
                        />
                      )}
                      {(kind === 'outline' || kind === 'subject') && m.feather > 0 && !(m.keyAt === 'edge' && m.key !== 'off') && (
                        <div className="field valued">
                          <span title="Where the soft edge sits against the outline">Position</span>
                          <div className="segmented">
                            {(['inside', 'centre', 'outside'] as const).map((at) => (
                              <button key={at} className={m.featherAt === at ? 'on' : ''} onClick={() => onChange(i, { featherAt: at }, `mask${i}:featherAt`)}>
                                {at === 'inside' ? 'Inside' : at === 'centre' ? 'Centre' : 'Outside'}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>,
                  )}
                  {named && (
                  <label className="field valued wide mask-name-field">
                    <span>Name</span>
                    <input type="text" aria-label="Name" value={m.name} maxLength={60} onChange={(e) => onChange(i, { name: e.target.value }, `mask${i}:name`)} />
                  </label>
                  )}
    </>
  )
}

/**
 * Masks: shapes drawn once — round a bird, a tree — that any section can be
 * kept off (or kept to) from the Mask button in its header. Here they are
 * drawn, named, softened and keyed; the sections choose which they use.
 */
export function MasksPanel({
  masks,
  maskUse,
  hasImage,
  drawing,
  selected,
  onDraw,
  onAddShape,
  placing,
  onToggle,
  onSelect,
  onChange,
  onRemove,
  onDuplicate,
  onToPoints,
  masksFull,
  streakUsers,
  onGoToModule,
  trace,
  picking,
  onPick,
  onPickReading,
  onPickDone,
  onUse,
  sectionInUse,
  brushing,
  brushSize,
  onBrushSize,
  onBrush,
  onNewPainted,
  onMatch,
  editingIndex,
  onEditShape,
  maskView,
  onMaskView,
  brushByColour,
  onBrushByColour,
}: Props) {
  const [allSections, setAllSections] = useState(false)
  // The Applies to popover: which mask's is open, and the side a mask with
  // no modules yet starts on.
  const [usesOpen, setUsesOpen] = useState<string | null>(null)
  const [sideWanted, setSideWanted] = useState<'only' | 'exclude'>('only')
  const usesRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!usesOpen) return
    const away = (e: MouseEvent) => !usesRef.current?.contains(e.target as Node) && setUsesOpen(null)
    // Esc closes the popover only, not the open mask's row as well (ItemList listens on window).
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setUsesOpen(null)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [usesOpen])
  const [addOpen, setAddOpen] = useState(false)
  const addRef = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!addOpen) return
    const away = (e: MouseEvent) => !addRef.current?.contains(e.target as Node) && setAddOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setAddOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [addOpen])
  /** This mask in a module: not used, the module only inside it, or the module everywhere but it. */
  const useIn = (id: string, s: MaskSection): 'none' | 'only' | 'exclude' => {
    const u = maskUse[s]
    return u?.ids.includes(id) ? u.mode : 'none'
  }
  const useChange = (id: string, s: MaskSection, to: 'none' | 'only' | 'exclude'): [MaskSection, SectionMask | undefined] => {
    const u = maskUse[s]
    const others = (u?.ids ?? []).filter((x) => x !== id)
    // Kept with no masks, so its side stays for when one is ticked again.
    if (to === 'none') return [s, u ? { ...u, ids: others } : undefined]
    return [s, { ids: [...others, id], mode: to }]
  }
  const setUseIn = (id: string, s: MaskSection, to: 'none' | 'only' | 'exclude') => onUse([useChange(id, s, to)])
  const usedBy = (id: string) => [
    ...MASK_SECTIONS.filter((s) => maskUse[s]?.ids.includes(id)).map((s) => SECTION_NAMES[s]),
    ...streakUsers(id),
  ]
  // A mask just made here, used by nothing yet: its Applies to opens, the
  // step that makes it do anything. Not while it is being painted.
  const known = useRef<Set<string> | null>(null)
  useEffect(() => {
    const ids = masks.filter((m) => !m.owner).map((m) => m.id)
    const before = known.current
    known.current = new Set(ids)
    if (!before) return
    const fresh = ids.find((id) => !before.has(id))
    if (fresh && !usedBy(fresh).length && brushing?.index !== masks.findIndex((m) => m.id === fresh)) setUsesOpen(fresh)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masks])
  /**
   * The modules a mask applies to, as their marks after its name: each one
   * says which side, and goes to that module with its mask panel open.
   */
  const userMarks = (id: string) => {
    const sections = MASK_SECTIONS.filter((s) => maskUse[s]?.ids.includes(id))
    const streaks = streakUsers(id)
    if (!sections.length && !streaks.length) return null
    const mark = (key: string, module: StackModuleId, title: string) => {
      const def = MODULE_BY_ID[module]
      return (
        <button key={key} className="mask-user" title={title} aria-label={title} onClick={() => onGoToModule?.(module)}>
          <ModuleGlyph id={module} tint={def ? CATEGORY_BY_ID[def.category].tint : 'currentColor'} size={13} />
        </button>
      )
    }
    const marks = [
      ...sections.map((s) => ({ key: s, module: s as StackModuleId, name: SECTION_NAMES[s], title: `${SECTION_NAMES[s]}, ${maskUse[s]!.mode === 'only' ? 'inside' : 'outside'} it: go to ${SECTION_NAMES[s].toLowerCase()}` })),
      ...(streaks.length ? [{ key: 'streaks', module: 'streaks' as StackModuleId, name: 'Streaks', title: `${streaks.join(', ')}: go to streaks` }] : []),
    ]
    // Two marks at most, the second … for the rest when there are more: the row keeps its name in view however many modules use the mask.
    const shownMarks = marks.length > 2 ? marks.slice(0, 1) : marks
    const rest = marks.slice(shownMarks.length)
    return (
      <span className="mask-users">
        {shownMarks.map((k) => mark(k.key, k.module, k.title))}
        {rest.length > 0 && (
          <button
            className="mask-user more"
            title={`Also ${rest.map((k) => k.name).join(', ')}: choose in Applies to`}
            aria-label={`And ${rest.length} more`}
            onClick={() => {
              const at = masks.findIndex((m) => m.id === id)
              if (at >= 0 && selected !== at) onSelect(at)
              setUsesOpen(id)
            }}
          >
            …
          </button>
        )}
      </span>
    )
  }
  // The open mask removed (×, Delete), then brought back by Cmd+Z: open again,
  // as it was. Only when that one mask went and came back, nothing else changed.
  const seen = useRef<{ ids: string[]; open: string | null; removed: string | null }>({ ids: masks.map((m) => m.id), open: null, removed: null })
  useEffect(() => {
    const ids = masks.map((m) => m.id)
    const was = seen.current
    const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, k) => x === b[k])
    let removed = was.removed
    if (was.open && ids.length === was.ids.length - 1 && same(was.ids.filter((x) => x !== was.open), ids)) removed = was.open
    else if (removed && ids.length === was.ids.length + 1 && same(ids.filter((x) => x !== removed), was.ids)) {
      const back = ids.indexOf(removed)
      removed = null
      if (back >= 0 && !masks[back].owner && selected !== back) onSelect(back)
    } else if (!same(ids, was.ids)) removed = null
    seen.current = { ids, open: selected !== null ? (masks[selected]?.id ?? null) : null, removed }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [masks, selected])
  const full = masks.length >= MAX_MASKS
  // A module's own pieces (Repeat's) are worked on in that module.
  const listed = masks.filter((m) => !m.owner).length
  const pickingHere = picking && !picking.owner && !picking.forTarget ? picking : null
  const add = (kind: AddKind) => {
    setAddOpen(false)
    track('mask_add', kind, 'list')
    if (kind === 'subject') onPick(null)
    else if (kind === 'outline') onDraw()
    else if (kind === 'paint') onNewPainted()
    else onAddShape(kind)
  }
  const addActive = (kind: AddKind) =>
    (kind === 'subject' && pickingHere?.index === null) || (kind === 'outline' && drawing) || (kind === 'gradient' && placing === 'gradient') || (kind === 'radial' && placing === 'radial')

  /**
   * Which modules work inside or outside the mask: one line saying so, and a
   * popover to choose. One side for all of them, the usual case; a module
   * set the other way elsewhere keeps its own until changed here.
   */
  const appliesTo = (m: MaskShape) => {
    const anyInUse = MASK_SECTIONS.some(sectionInUse)
    const shown = MASK_SECTIONS.filter((sec) => allSections || !anyInUse || sectionInUse(sec) || useIn(m.id, sec) !== 'none')
    const used = MASK_SECTIONS.filter((sec) => useIn(m.id, sec) !== 'none')
    const modes = new Set(used.map((sec) => useIn(m.id, sec)))
    const side: 'only' | 'exclude' = used.length ? (modes.has('only') ? 'only' : 'exclude') : sideWanted
    const names = used.map((sec) => SECTION_NAMES[sec])
    // Which side first, so it is never what gets cut off; then the names that
    // fit the line whole, and … for the rest (all of them are in its tooltip).
    const sideWord = modes.size > 1 ? 'Mixed' : side === 'only' ? 'Inside' : 'Outside'
    let fitted = names.slice(0, 1)
    for (const n of names.slice(1)) {
      if (`${sideWord}: ${[...fitted, n].join(', ')}`.length > 18) break
      fitted = [...fitted, n]
    }
    const summary = !used.length ? 'Choose effects' : `${sideWord}: ${fitted.join(', ')}${fitted.length < names.length ? ' …' : ''}`
    const open = usesOpen === m.id
    return (
      <div className="field valued mask-applies">
        <span title="The modules this mask keeps to part of the photo">Applies to</span>
        <span className="menu-anchor" ref={open ? usesRef : undefined}>
          <button
            className={`mask-applies-button${used.length ? '' : ' empty'}${open ? ' open' : ''}`}
            aria-expanded={open}
            title={used.length ? `${side === 'only' && modes.size <= 1 ? 'Inside' : modes.size > 1 ? 'Inside or outside' : 'Outside'} it: ${names.join(', ')}` : undefined}
            onClick={() => setUsesOpen(open ? null : m.id)}
          >
            <span>{summary}</span>
            <span className="mask-applies-caret" aria-hidden />
          </button>
          {open && (
            <div className="menu mask-applies-menu">
              <div className="segmented">
                {(['only', 'exclude'] as const).map((to) => (
                  <button
                    key={to}
                    className={side === to && modes.size <= 1 ? 'on' : ''}
                    title={to === 'only' ? 'The modules work only inside the mask' : 'The modules work everywhere but the mask'}
                    onClick={() => {
                      setSideWanted(to)
                      if (used.length) onUse(used.map((sec) => useChange(m.id, sec, to)))
                    }}
                  >
                    {to === 'only' ? 'Inside' : 'Outside'}
                  </button>
                ))}
              </div>
              <div className="mask-applies-list">
                {shown.map((sec) => {
                  const on = useIn(m.id, sec) !== 'none'
                  return (
                    <label key={sec} className="mask-applies-item">
                      <input type="checkbox" checked={on} onChange={() => setUseIn(m.id, sec, on ? 'none' : side)} />
                      <span>{SECTION_NAMES[sec]}</span>
                    </label>
                  )
                })}
              </div>
              {anyInUse && (
                <button className="link mask-use-more" onClick={() => setAllSections(!allSections)}>
                  {allSections ? 'Only modules in use' : 'All modules'}
                </button>
              )}
            </div>
          )}
        </span>
      </div>
    )
  }

  // The listed masks (not a module's own piece), each with its place in `masks`.
  const rows = masks.flatMap((m, i) => (m.owner ? [] : [{ m, i }]))
  // A subject being selected again for one of them, from here: that row is open, showing the selecting.
  const pickingIndex = pickingHere && pickingHere.index !== null ? pickingHere.index : null
  const openIndex = pickingIndex ?? selected
  const openRow = openIndex === null ? -1 : rows.findIndex((r) => r.i === openIndex)
  const openMask = openRow >= 0 ? rows[openRow] : null

  return (
    <section className="masks-panel">
      <div className="section-head masks-head">
        <h2>Masks</h2>
        {listed > 0 && (
          <span className="menu-anchor" ref={addRef}>
            <button className={`masks-add${addOpen ? ' open' : ''}`} disabled={!hasImage || full} title={full ? `Up to ${MAX_MASKS} masks` : 'Add a mask'} onClick={() => setAddOpen(!addOpen)}>
              + Add
            </button>
            {addOpen && (
              <div className="menu mask-menu">
                {ADD_KINDS.map((k) => (
                  <button key={k.kind} className="menu-item mask-choice" title={k.title} onClick={() => add(k.kind)}>
                    <MaskGlyph kind={k.kind} />
                    <span>
                      <b>{k.name}</b>
                      <small>{k.line}</small>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </span>
        )}
      </div>
      {listed === 0 && !pickingHere && (
        <>
          <div className="mask-choices">
            {ADD_KINDS.map((k) => (
              <button key={k.kind} className={`mask-choice${addActive(k.kind) ? ' on' : ''}`} disabled={!hasImage} title={k.title} onClick={() => add(k.kind)}>
                <MaskGlyph kind={k.kind} />
                <span>
                  <b>{k.name}</b>
                  <small>{k.line}</small>
                </span>
              </button>
            ))}
          </div>
        </>
      )}
      {(listed > 0 || pickingHere) && (
        <>
          <ItemList
            open={openRow >= 0 ? openRow : null}
            onOpen={(k) => {
              const i = k === null ? null : rows[k].i
              if (pickingIndex !== null) {
                // The row being selected again stays open until Done or Cancel;
                // opening another lets the selecting go, as Cancel would.
                if (i === pickingIndex || i === null) return
                onPickDone(false)
              }
              onSelect(i)
            }}
            // Drawing, placing or reshaping on the photo has its own Esc and Delete (App).
            keysOff={drawing || !!placing || editingIndex !== null}
            items={rows.map(({ m, i }) => {
              const kind = maskKind(m)
              const glyph: AddKind = kind === 'subject' && /^Painted\b/.test(m.name) ? 'paint' : kind
              const on = maskOn(m)
              const brushingThis = brushing?.index === i
              return {
                key: m.id,
                name: m.name,
                icon: <MaskGlyph kind={glyph} />,
                // Used by nothing yet: its Applies to says so, open.
                summary: !on ? 'Off' : undefined,
                // Open, its Applies to line says the same: the row keeps the room for its name.
                badges: on && selected !== i ? userMarks(m.id) : null,
                on,
                onToggle: () => onToggle(i),
                label: m.name || 'mask',
                // Editing on the photo: a selected or painted mask is brushed; the rest are reshaped.
                editing: kind === 'subject' ? brushingThis : editingIndex === i,
                onEdit:
                  kind === 'subject'
                    ? hasImage
                      ? () => onBrush(brushingThis ? null : i, 'add')
                      : undefined
                    : () => onEditShape(i),
                ...(onDuplicate ? { onDuplicate: () => onDuplicate(i), full: masksFull ? `Up to ${MAX_MASKS} masks` : undefined } : {}),
                ...(kind === 'subject' && onToPoints
                  ? { actions: [{ label: 'Turn into points', onClick: () => onToPoints(i), title: 'Make the selection into points round its edge, to reshape by dragging them like a drawn outline' }] }
                  : {}),
                onRemove: () => onRemove(i),
              }
            })}
          >
            {openMask && <EditBox at={`masks/${openMask.m.id}`} />}
            {openMask &&
              (pickingIndex === openMask.i && pickingHere ? (
                <PickPanel p={pickingHere} onPickReading={onPickReading} onPickDone={onPickDone} />
              ) : (
                <MaskSettings
                  mask={openMask.m}
                  index={openMask.i}
                  hasImage={hasImage}
                  picking={!!picking}
                  brushing={brushing}
                  brushSize={brushSize}
                  onBrushSize={onBrushSize}
                  onByColour={onBrushByColour}
                  onBrush={onBrush}
                  onPick={onPick}
                  editing={editingIndex === openMask.i}
                  onMatch={onMatch}
                  onChange={onChange}
                  trace={trace}
                  cleanEdges={!!maskUse.streaks?.ids.includes(openMask.m.id)}
                  middle={appliesTo(openMask.m)}
                  view={maskView}
                  onView={onMaskView}
                  byColour={brushByColour}
                />
              ))}
          </ItemList>
          {pickingHere && pickingHere.index === null && (
            // A new subject being selected: a row of its own until Done makes it a mask.
            <div className="item-list">
              <div className="item open">
                <div className="item-row">
                  <div className="item-head">
                    <span className="disclosure-caret" aria-hidden />
                    <MaskGlyph kind="subject" />
                    <span className="item-name">New subject</span>
                  </div>
                </div>
                <div className="item-body">
                  <PickPanel p={pickingHere} onPickReading={onPickReading} onPickDone={onPickDone} />
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {/* A new mask being drawn or placed, or one edited whose row is not showing: its edit box. */}
      <EditBox at="masks" />
      <EditBox home="masks" />
    </section>
  )
}

/**
 * Painting a selected mask in or out on the photo, as its edit box shows it:
 * which way, what painting does, only over similar colours (and how close),
 * the brush's size, and selecting it again from nothing.
 */
export function BrushBox({
  mode,
  onMode,
  what,
  size,
  onSize,
  similar,
  onSimilar,
  onSelectAgain,
}: {
  mode: 'add' | 'remove'
  onMode: (mode: 'add' | 'remove') => void
  /** What is painted: "subject", "piece", "mask". */
  what: string
  size: number
  onSize: (size: number) => void
  similar: boolean
  onSimilar: (on: boolean) => void
  onSelectAgain?: () => void
}) {
  const range = useBrushRange()
  return (
    <div className="brush-box">
      <div className="segmented mask-brush">
        <button className={mode === 'add' ? 'on' : ''} title={`Paint more into the ${what}`} onClick={() => onMode('add')}>
          Brush in
        </button>
        <button className={mode === 'remove' ? 'on' : ''} title={`Paint part of the ${what} away`} onClick={() => onMode('remove')}>
          Brush out
        </button>
      </div>
      <Slider
        label="Brush size"
        title="How wide the brush paints, as a share of the photo's short side. [ and ] change it too."
        value={size}
        // Track units: the square roots of 0.4% and 25%.
        min={Math.sqrt(0.004)}
        max={0.5}
        step={(0.5 - Math.sqrt(0.004)) / 400}
        toSlider={(v) => Math.sqrt(v)}
        fromSlider={(v) => Math.round(v * v * 1000) / 1000}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={onSize}
      />
      <label
        className="check-row"
        title="The brush paints only over colours like the one under it where you start each stroke, as an auto mask does: start on a branch and the sky between stays out; start on the sky and the branches stay out"
      >
        <input type="checkbox" checked={similar} onChange={(e) => onSimilar(e.target.checked)} />
        Only similar colours
      </label>
      {similar && (
        <Slider
          label="Range"
          title="How far from the colour you start on the brush still paints: less keeps to that colour closely, more takes in its shades and neighbours"
          value={range}
          def={0.08}
          min={0.02}
          max={0.3}
          step={0.005}
          format={(v) => `${Math.round(v * 100)}`}
          onChange={setBrushRange}
        />
      )}
      {onSelectAgain && (
        <button className="link" title={`Click parts of the photo to add them to the ${what}, or Option-click to leave them out; the rest stays`} onClick={onSelectAgain}>
          Select parts instead
        </button>
      )}
    </div>
  )
}
