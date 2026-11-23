import { useState, type ReactNode } from 'react'
import { StreakBarsPicture } from './SettingPictures'
import { AngleDial } from './AngleDial'
import { TraceToKey, type TraceOutline } from './TraceToKey'
import { STREAK_DEFAULTS, type MaskShape, type StreakShape } from '../engine/types'
import { MaskUse, Slider, ToneGauge, toneTrack } from './controls'
import { EditBox } from './EditBox'
import { hasColourLine } from '../engine/colourLine'
import { StreakFixes, type FixEditing } from './StreakFixes'
import { ToneAlong } from './ToneAlong'
import { EXTEND_STYLE, FINISHES, STREAK_STYLES, finishOf, finishPatch, stylePatch, styleOf } from './streakStyles'
import type { AddKind } from './maskKinds'
import type { MaskPick } from './controls'
import type { StreakTool } from './StreakOverlay'
import { repeatLayers } from './streakClip'
import { STREAK_KINDS, kindOf, kindPatch, startingCurve, type StreakKind } from './streakKinds'
import { track } from '../platform/usage'

/**
 * A streak's settings, a tab each, named for what it answers: Direction
 * ('way': its kind, which way it goes and the kind's tools on the photo),
 * Bars ('bars': their style, length, ends and tone along each bar), Carries
 * ('colour': what the bars hold, the copies' settings, and where along each
 * line the colour is read), Fixes, and Mask ('where': its subject, kept in
 * front, and its masks). 'subject' is an older name for Mask.
 */
export type StreakTab = 'way' | 'bars' | 'colour' | 'subject' | 'fixes' | 'where'

/** A streak's own masks, made in its Mask tab and kept in it: each one's settings, and taking one away. */
export interface StreakOwnMasks {
  masks: { id: string; name: string; body: ReactNode }[]
  onRemove: (id: string) => void
}

interface Props {
  /** Which streak it is (its place in the list), for where its edit box goes. */
  index: number
  shape: StreakShape
  onChange: (patch: Partial<StreakShape>) => void
  tab: StreakTab
  onTab: (tab: StreakTab) => void
  drawingPath: boolean
  onDrawPath: () => void
  /** Drawing a trail's end line on the photo. */
  drawingEnds: boolean
  onDrawEnds: () => void
  /** The masks this streak can be kept off, or to. */
  masks: MaskShape[]
  /** Make a new mask for this streak, ticked for it once made (see StreakNewMask). */
  newMask?: StreakNewMask
  fixes: {
    selected: number | null
    onSelect: (index: number | null) => void
    editing: FixEditing
    onEditing: (editing: FixEditing) => void
    /** A mask holds the streaks back (or a streak mask exists). */
    holds: boolean
  }
  /** Traces an outline to a key on the photo (see TraceToKey). */
  trace?: TraceOutline
  /** Its guides being laid on the photo. */
  guiding?: boolean
  onGuides?: () => void
  /** Edit the mirror's middle line on the photo. */
  onMirrorMiddle?: () => void
  /**
   * Find the photo's own lines round the streak and set its angle and
   * perspective by them, after `base` (a change of kind) if given; `quiet`:
   * as one step, without opening the guides on the photo.
   */
  onMatchLines?: (base?: Partial<StreakShape>, quiet?: boolean) => void
  /** The photo's width over its height, for a first curve. */
  aspect?: number
  /** Show these settings on the photo for now, without changing it (null: as it is). */
  onPreview?: (patch: Partial<StreakShape> | null) => void
  /** The box of the shape being edited on the photo (its pencil), shown over the tabs. */
  editBox?: ReactNode
  /** The box of an edit on the photo begun from one of its tabs (an end line, guides…), shown under the button that began it. */
  toolBox?: (tool: StreakTool) => ReactNode
  /** The on-photo tool in use on this streak, if any (its buttons are lit while it is). */
  sessionTool?: StreakTool | null
  /** Show (or put away) its arrow, length and side lines on the photo to drag. */
  onAdjust?: () => void
  /** Set Repeat's copy length to the subject's own rhythm (its floors). */
  onFitRepeat?: () => void
  /** Set the streak up to carry the subject on as it is, with no streak to it. */
  onExtend?: (extra?: Partial<StreakShape>) => void
  /** Made from a selected subject whose mask is still there (Streak a subject). */
  subject?: {
    /** Pick the subject again. */
    onReselect: () => void
    /** Its outline taken in from the subject's edge by this much. */
    onInset: (inset: number) => void
    reselecting: boolean
    /** Its own subject's settings, when it owns it (brush in and out, select again, match to the photo). */
    body?: ReactNode
  }
  /** Its own masks (not its subject), in its Mask tab. */
  own?: StreakOwnMasks
  /** Its colour line (StreakShape.colourLine) being edited on the photo, and editing it (made where it reads now, if it has none). */
  colourLine?: { editing: boolean; onEdit: () => void }
}

/** Making a mask of a streak's own, from its Mask tab. */
export interface StreakNewMask {
  /** The kind being made for this streak right now, if one is. */
  making: AddKind | null
  /** Room for another mask, and a photo to make it on. */
  canMake: boolean
  /** Make one of this kind (again: stop), used on this side of the streak. */
  onNew: (kind: AddKind, mode: 'only' | 'exclude') => void
  /** A subject being selected for this streak: what it found, and keeping it. */
  pick?: MaskPick | null
  /** A mask from the Masks list opened there (its Edit). */
  onOpenMask?: (id: string) => void
  /** Show this mask on the photo while its row is pointed at (null: none). */
  onPeek?: (id: string | null) => void
}

const signed = (digits: number, unit = '') => (v: number) =>
  Math.abs(v) < 0.5 * 10 ** -digits ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(digits)}${unit}`
const stops = signed(2, ' st')
const contrastFormat = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`)
const pct = (v: number) => `${Math.round(v * 100)}%`
const softFormat = (v: number) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Hard')

/** One streak's settings, a tab at a time (see StreakTab). */
export function StreakSettings({ index, shape, aspect, onPreview, editBox, toolBox, sessionTool, onAdjust, onChange, tab, onTab, drawingPath, onDrawPath, drawingEnds, onDrawEnds, masks, newMask, fixes, trace, guiding, onGuides, onMirrorMiddle, onMatchLines, onFitRepeat, onExtend, subject, own, colourLine }: Props) {
  const clipped = shape.mode === 'fill' && shape.clip
  const softOutline = shape.mode === 'mask' || clipped
  // A tone that changes along the bar is two sets of values; most streaks
  // have one. Open when the end already differs from the start.
  const differs =
    shape.endBrightness !== shape.brightness || shape.endContrast !== shape.contrast || shape.endOpacity !== shape.opacity
  const [changing, setChanging] = useState(differs)
  const along = changing || differs

  const feather = softOutline && (
    <>
      <Slider
        label="Feather"
        title={
          shape.mode === 'mask'
            ? 'How softly the mask lets the streaks back in at its edge'
            : 'Softens the outline. The bar ends have their own Soft ends (Bars).'
        }
        value={shape.feather} def={STREAK_DEFAULTS.feather}
        min={0}
        max={0.1}
        step={0.001}
        format={softFormat}
        onChange={(feather) => onChange({ feather })}
      />
      {shape.feather > 0 && (
        <div className="field valued">
          <span title="Where the soft edge sits against the outline">Position</span>
          <div className="segmented">
            {(
              [
                ['inside', 'Inside', 'The soft edge is inside the outline: the streak eases in from the line'],
                ['centre', 'Centre', 'The soft edge straddles the outline'],
                ['outside', 'Outside', 'The streak is solid right up to the line and fades out past it'],
              ] as const
            ).map(([at, label, hint]) => (
              <button key={at} title={hint} className={shape.featherAt === at ? 'on' : ''} onClick={() => onChange({ featherAt: at })}>
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  )
  // An old streak mask: just its edge.
  if (shape.mode === 'mask')
    return (
      <>
        {editBox}
        {feather}
      </>
    )

  const across = clipped && shape.measure === 'across'
  const share = across ? 'of the way across the shape' : shape.mode === 'trail' && shape.ends ? 'of the way to the end line' : 'of Length'
  const toneSliders = (b: 'brightness' | 'endBrightness', c: 'contrast' | 'endContrast', o: 'opacity' | 'endOpacity', where: string) => (
    <>
      <Slider
        label="Brightness"
        title={`Lighten or darken the streak${where}, in stops`}
        value={shape[b]}
        min={-2}
        max={2}
        step={0.05}
        format={stops}
        onChange={(v) => onChange(along ? { [b]: v } : { brightness: v, endBrightness: v })}
      />
      <Slider
        label="Contrast"
        title="Spread the streak's tones apart (more) or together (less), about mid-grey"
        value={shape[c]}
        min={-1}
        max={1}
        step={0.01}
        format={contrastFormat}
        onChange={(v) => onChange(along ? { [c]: v } : { contrast: v, endContrast: v })}
      />
      <Slider
        label="Opacity"
        title="How much of the streak shows over the photo"
        value={shape[o]}
        min={0}
        max={1}
        step={0.01}
        format={pct}
        onChange={(v) => onChange(along ? { [o]: v } : { opacity: v, endOpacity: v })}
      />
    </>
  )
  // What the bars carry: the edge's colour, copies of the subject's last
  // stretch, or the subject itself carried on (Extend).
  const extended = styleOf(shape) === EXTEND_STYLE.id
  const carries = extended ? 'subject' : shape.carry === 'repeat' ? 'copies' : 'colour'
  // Leaving Extend gives back what the streak had before it.
  const unextend = (): Partial<StreakShape> =>
    shape.beforeExtend
      ? { ...(shape.beforeExtend as Partial<StreakShape>), beforeExtend: undefined, lengthBeforeExtend: undefined }
      : stylePatch(shape, STREAK_STYLES[0].patch)
  const kind = kindOf(shape)
  // Choosing a kind changes the streak and nothing else: no edit opens on
  // the photo. A kind tried for the first time starts from a guess:
  // Building lined up with the photo's own lines, Curve a gentle bow the
  // way the streak points (its points are dragged with the pencil).
  const chooseKind = (k: StreakKind) => {
    if (k === kind) return
    track('streak_kind', k)
    const { patch, fresh } = kindPatch(shape, k)
    if (k === 'building' && fresh && onMatchLines) return onMatchLines(patch, true)
    if (k === 'curve' && fresh) return onChange({ ...patch, path: startingCurve({ ...shape, ...patch }, aspect ?? 1) })
    onChange(patch)
  }

  // Four tabs, always the same: which way (Direction), the bars themselves
  // (Bars), what they carry (Carries) and putting things right (Clean up:
  // fixes, the subject's edge, where colours are read, masks). Older tab
  // names open the tab they are now in.
  const copying = shape.carry === 'repeat' || shape.fixes.some((f) => f.carry === 'repeat')
  const masked = shape.maskMode !== 'off' && shape.maskIds.some((id) => id !== shape.subject?.mask)
  const hasSubject = !!(subject && shape.subject)
  const shown: StreakTab = tab === 'subject' ? 'where' : tab
  const tabs: [StreakTab, string, string][] = [
    ['way', 'Direction', 'Its kind and which way it goes'],
    ['bars', 'Bars', 'Their style, length, ends and tone along each bar'],
    ['colour', 'Carries', 'What the bars hold, and where along each line it is read'],
    ['fixes', shape.fixes.length ? `Fixes ${shape.fixes.length}` : 'Fixes', 'Bars that picked up the wrong colour, or should change'],
    ['where', masked || shape.key !== 'off' ? 'Mask •' : 'Mask', 'Its subject, kept in front, and masks keeping it off part of the photo (or only on it)'],
  ]
  // A bar style tried: shown on the photo while pointed at, set on click.
  const finish = (st: (typeof STREAK_STYLES)[number]) => finishPatch(shape, st.patch)
  const finishOn = finishOf(shape)

  const box = (t: StreakTool) => toolBox?.(t)
  const adjusting = sessionTool === 'direction'
  return (
    <>
      {editBox}
      <div className="segmented streak-tabs" role="tablist">
        {tabs.map(([id, label, hint]) => (
          <button key={id} role="tab" aria-selected={shown === id} className={shown === id ? 'on' : ''} title={hint} onClick={() => onTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {shown === 'way' && (
        <>
          <div className="segmented streak-kinds" role="radiogroup" aria-label="Kind of streak">
            {STREAK_KINDS.map((k) => (
              <button key={k.id} role="radio" aria-checked={kind === k.id} className={kind === k.id ? 'on' : ''} title={k.title} onClick={() => chooseKind(k.id)}>
                <KindGlyph kind={k.id} />
                <span>{k.name}</span>
              </button>
            ))}
          </div>
          {!shape.subject && (
            <div className="field valued">
              <span>Mode</span>
              <div className="segmented">
                {(
                  [
                    ['fill', 'Fill', 'The shape is filled with colour from the edge each bar enters it by'],
                    ['trail', 'Trail', 'Colour from the edge each bar leaves the shape by, smeared out beyond it; the shape is kept'],
                  ] as const
                ).map(([mode, label, hint]) => (
                  <button key={mode} title={hint} className={shape.mode === mode ? 'on' : ''} onClick={() => onChange({ mode })}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {(kind === 'straight' || kind === 'building') && (
            <AngleDial
              look="arrow"
              label="Direction"
              title="Which way the streak goes: drag the slider, or the arrow on the photo. 0° up, 90° right, 180° down."
              value={shownAngle(shape.angle)}
              min={-180}
              max={180}
              zero={-90}
              onChange={(v) => onChange({ angle: wrapAngle(v - 90) })}
            />
          )}
          {(kind === 'straight' || kind === 'building') && onAdjust && (
            <>
              <div className="row">
                <button
                  className={adjusting ? 'on' : ''}
                  title="Its arrow on the photo: drag it to turn the streak, or its middle to bend it into a curve. The square at the end of the bars sets how far they run, and its side lines set perspective."
                  onClick={onAdjust}
                >
                  Adjust on the photo
                </button>
              </div>
              {box('direction')}
            </>
          )}

          {kind === 'building' && (
            <>
              <div className="row streak-guide-row">
                {onMatchLines && (
                  <button title="Find the photo's straight lines round the streak that run roughly its way (a building's sides) and set its direction and perspective by them. Point the streak the right way first." onClick={() => onMatchLines()}>
                    Line up with the photo
                  </button>
                )}
                {onGuides && (
                  <button className={guiding ? 'on' : ''} title="Lay lines along straight edges in the photo yourself: where they meet sets the direction and perspective" onClick={onGuides}>
                    {shape.guides?.length ? `Guides (${shape.guides.length})` : 'Guides'}
                  </button>
                )}
              </div>
              {box('guides')}
              <Slider
                label="Perspective"
                title="The lines meet at a point, as in perspective. Right: they close in ahead (a building's sides going up). Left: they spread out. Line up with the photo or Guides set it from the photo."
                value={shape.converge} def={STREAK_DEFAULTS.converge}
                min={-1}
                max={1}
                step={0.005}
                toSlider={(v) => Math.sign(v) * Math.sqrt(Math.abs(v) / 2)}
                fromSlider={(p) => Math.round(Math.sign(p) * p * p * 2 * 1000) / 1000}
                format={(v) => (Math.abs(v) < 1e-3 ? 'None' : v > 0 ? 'Closes' : 'Spreads')}
                onChange={(converge) => onChange({ converge })}
              />
              <Slider
                label="Lens bend"
                title="How the lens bends straight lines: the streak's lines bend the same way, so its bars curve as the photo's own edges do. Guides with three or more points measure it."
                value={shape.bend ?? 0} def={0}
                min={-0.2}
                max={0.2}
                step={0.001}
                format={(v) => (Math.abs(v) < 0.0005 ? 'None' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}`)}
                onChange={(bend) => onChange({ bend })}
              />
            </>
          )}

          {kind === 'curve' && (
            <>
              <div className="row streak-guide-row">
                <button className={drawingPath || sessionTool === 'path' ? 'on' : ''} title={shape.path ? 'Drag the curve’s points on the photo, or draw it again' : 'Click points on the photo along the way the streak should bend, from where it starts'} onClick={onDrawPath}>
                  {shape.path ? 'Edit the curve' : 'Draw the curve'}
                </button>
              </div>
              {box('path')}
              {shape.path && shape.path.length >= 2 && (
                <Slider
                  label="Width"
                  title="How far either side of the curve the bars reach: the streak's sides end along its own curved lines instead of being cut across by the outline. Off: out to the outline."
                  value={shape.pathWidth ?? 0} def={STREAK_DEFAULTS.pathWidth}
                  min={0}
                  max={1}
                  step={0.005}
                  format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Off')}
                  onChange={(pathWidth) => onChange({ pathWidth })}
                />
              )}
            </>
          )}

          {kind === 'circle' && (
            <Slider
              label="Reach"
              title="How far out past the edge the rings of arcs go, shown on the photo as the outer dashed ring. Off: out to the edge of the picture."
              value={shape.radialReach ?? 0} def={STREAK_DEFAULTS.radialReach}
              min={0}
              max={1}
              step={0.002}
              format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Off')}
              onChange={(radialReach) => onChange({ radialReach })}
            />
          )}
          {(kind === 'radial' || kind === 'circle') && (
            <>
              {onAdjust && (
                <div className="row">
                  <button className={adjusting ? 'on' : ''} title="Drag the yellow dot on the photo to move the middle" onClick={onAdjust}>
                    Move the middle
                  </button>
                </div>
              )}
              {box('direction')}
            </>
          )}
        </>
      )}

      {shown === 'bars' && (
        <>
          <div className="field streak-finishes">
            <span title="Ready-made bars: how long, ragged and soft they are, and how they change toward their ends. Point at one to see it on the photo; click to use it. Everything can be changed after.">Style</span>
            <div className="chips" onPointerLeave={() => onPreview?.(null)}>
              {STREAK_STYLES.filter((st) => FINISHES.includes(st.id)).map((st) => (
                <button
                  key={st.id}
                  className={finishOn === st.id ? 'on' : ''}
                  title={`${st.hint}. Point to see it on the photo.`}
                  onPointerEnter={() => onPreview?.(finish(st))}
                  onClick={() => {
                    onPreview?.(null)
                    track('streak_style', st.id)
                    onChange(finish(st))
                  }}
                >
                  {st.name}
                </button>
              ))}
            </div>
          </div>
          {clipped && (
            <div className="field valued">
              <span>Measure</span>
              <div className="segmented">
                <button className={across ? 'on' : ''} title="Bar lengths as a share of the way across the shape, each bar measured along its own line" onClick={() => onChange({ measure: 'across' })}>
                  Across shape
                </button>
                <button className={!across ? 'on' : ''} title="Bar lengths as a distance; a bar still stops at the outline" onClick={() => onChange({ measure: 'distance' })}>
                  Distance
                </button>
              </div>
            </div>
          )}
          {shape.mode === 'trail' && shape.ends ? (
            <p className="hint-line" title="The bars run to the end line you drew: Draw where they end shows it on the photo">Length: to the end line</p>
          ) : (
            !across && (
              <Slider
                label="Length"
                title="How far the longest bars run, as a share of the photo's short side"
                value={shape.length} def={STREAK_DEFAULTS.length}
                min={0.02}
                max={1.5}
                step={0.01}
                format={(v) => `${Math.round(v * 100)}%`}
                onChange={(length) => onChange({ length })}
              />
            )
          )}
          {shape.mode === 'trail' && (
            <div className="row">
              <button
                className={drawingEnds || sessionTool === 'ends' ? 'on' : ''}
                title={shape.ends ? 'Drag the end line’s points on the photo, or draw it again' : 'Click points on the photo across the streak where its bars should end'}
                onClick={onDrawEnds}
              >
                {shape.ends ? 'Edit the end line' : 'Draw where they end'}
              </button>
              {shape.ends && !drawingEnds && (
                <button title="Drop the line: the bars end at Length again" onClick={() => onChange({ ends: null })}>
                  Use Length
                </button>
              )}
            </div>
          )}
          {shape.mode === 'trail' && box('ends')}

          <StreakBarsPicture shape={shape} onChange={onChange} />
          <Slider
            label="Shortest"
            title={`The shortest a bar can be, ${share}`}
            value={shape.lengthMin} def={STREAK_DEFAULTS.lengthMin}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(lengthMin) => onChange({ lengthMin, lengthMax: Math.max(lengthMin, shape.lengthMax) })}
          />
          <Slider
            label="Longest"
            title={`The longest a bar can be, ${share}`}
            value={shape.lengthMax} def={STREAK_DEFAULTS.lengthMax}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(lengthMax) => onChange({ lengthMax, lengthMin: Math.min(lengthMax, shape.lengthMin) })}
          />
          <Slider
            label="Variation"
            title="Low: neighbouring bars end at similar lengths, in a smooth wave. High: every bar on its own."
            value={shape.variation} def={STREAK_DEFAULTS.variation}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(variation) => onChange({ variation })}
          />
          <Slider
            label="Soft ends"
            title="How far each bar's end fades out, apart from the outline's feather"
            value={shape.endSoftness} def={STREAK_DEFAULTS.endSoftness}
            min={0}
            max={0.15}
            step={0.001}
            format={softFormat}
            onChange={(endSoftness) => onChange({ endSoftness })}
          />
          <div className="row">
            <button title="A new random pick of bar lengths and angles" onClick={() => onChange({ seed: Math.floor(Math.random() * 99991) })}>
              Shuffle bars
            </button>
          </div>

          <h3 className="streak-group" title="The streak's own tone, start to end of each bar; the photo around it is untouched">
            Along the bar
          </h3>
          <div className="segmented">
            <button className={!along ? 'on' : ''} title="One tone the whole length of each bar" onClick={() => {
              setChanging(false)
              // The end takes the start's tone, so one set is all there is.
              onChange({ endBrightness: shape.brightness, endContrast: shape.contrast, endOpacity: shape.opacity })
            }}>
              Same along it
            </button>
            <button
              className={along ? 'on' : ''}
              title="A different tone where each bar ends (fading out, say), changing along the bar"
              onClick={() => {
                setChanging(true)
                // Something to see straight away: the bars fade out toward their ends.
                if (!differs) onChange({ endOpacity: 0 })
              }}
            >
              Changes along it
            </button>
          </div>
          {along ? (
            <>
              <ToneAlong
                start={{ brightness: shape.brightness, contrast: shape.contrast, opacity: shape.opacity }}
                end={{ brightness: shape.endBrightness, contrast: shape.endContrast, opacity: shape.endOpacity }}
                at={shape.changeAt}
                over={shape.changeLength}
                onChange={onChange}
              />
              <div className="tone-stop">
                <span className="tone-stop-label">At the start of each bar</span>
                {toneSliders('brightness', 'contrast', 'opacity', ' at the start of each bar')}
              </div>
              <div className="tone-stop">
                <span className="tone-stop-label">At the end of each bar</span>
                {toneSliders('endBrightness', 'endContrast', 'endOpacity', ' at the end of each bar')}
              </div>
            </>
          ) : (
            toneSliders('brightness', 'contrast', 'opacity', '')
          )}

          <h3 className="streak-group" title="How thick the bars are and how their ends are cut">
            Bar shape
          </h3>
          <Slider
            label="Bar size"
            title="How thick each bar is"
            value={shape.band} def={STREAK_DEFAULTS.band}
            min={0.002}
            max={0.06}
            step={0.001}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(band) => onChange({ band })}
          />
          <Slider
            label="Tip angle"
            title="The cut across each bar's end: 0° is straight across"
            value={shape.tipAngle} def={STREAK_DEFAULTS.tipAngle}
            min={-75}
            max={75}
            step={1}
            format={(v) => `${Math.round(v)}°`}
            onChange={(tipAngle) => onChange({ tipAngle })}
          />
          <Slider
            label="Angle range"
            title="Each bar's cut turns by up to this much either way"
            value={shape.tipRange} def={STREAK_DEFAULTS.tipRange}
            min={0}
            max={75}
            step={1}
            format={(v) => `±${Math.round(v)}°`}
            onChange={(tipRange) => onChange({ tipRange })}
          />
          {!shape.radial && (
            <>
              <label
                className="check-row"
                title="Either side of a line along the streak the bars are the same the other way round: their widths, lengths and end cuts. Their colours are still the photo's under each bar."
              >
                <input type="checkbox" checked={!!shape.mirror} onChange={(e) => onChange({ mirror: e.target.checked })} />
                Mirror the bars
              </label>
              {shape.mirror && (
                <>
                  <Slider
                    label="Variation"
                    title="How far each side goes its own way: 0, an exact mirror; more, the two sides differ more"
                    value={shape.mirrorVary ?? 0}
                    def={0}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Exact')}
                    onChange={(mirrorVary) => onChange({ mirrorVary })}
                  />
                  <div className="row">
                    {onMirrorMiddle && (
                      <button className={sessionTool === 'middle' ? 'on' : ''} title="Drag the line the bars are mirrored about, on the photo" onClick={onMirrorMiddle}>
                        Move the middle
                      </button>
                    )}
                    {shape.mirrorAt && (
                      <button title="The middle of the streak’s outline again" onClick={() => onChange({ mirrorAt: null })}>
                        Back to the middle
                      </button>
                    )}
                  </div>
                  {box('middle')}
                </>
              )}
            </>
          )}
          {softOutline && <h3 className="streak-group">Edge</h3>}
          {feather}
        </>
      )}

      {shown === 'colour' && (
        <>
          <div className="segmented full streak-carries" role="radiogroup" aria-label="What the bars carry">
            <button role="radio" aria-checked={carries === 'colour'} className={carries === 'colour' ? 'on' : ''} title="The colour at the edge, held along each bar" onClick={() => onChange(extended ? { ...unextend(), carry: 'colour' } : { carry: 'colour' })}>
              Colour
            </button>
            <button
              role="radio"
              aria-checked={carries === 'copies'}
              className={carries === 'copies' ? 'on' : ''}
              title="The edge's colour, with the subject's last stretch behind the edge repeating along it: its windows or floors echo out"
              onClick={() => onChange(extended ? { ...unextend(), carry: 'repeat' } : { carry: 'repeat' })}
            >
              Copies
            </button>
            <button
              role="radio"
              aria-checked={carries === 'subject'}
              className={carries === 'subject' ? 'on' : ''}
              disabled={!onExtend && !extended}
              title={onExtend || extended ? 'The subject itself carried on, as if it kept going, with no streak to it' : 'Only for a streak made from a subject (Streak a subject)'}
              onClick={() => !extended && onExtend?.()}
            >
              Subject
            </button>
          </div>
          {copying && (
            <>
          <Slider
            label="Copy from"
            title="How far in from the edge the copied part starts: past a roof's lip or a cornice, so it is not repeated. It also sets where the first copy meets the subject: a whole number of layers in (Fit to the pattern sets one), the subject carries straight on; anything between starts the copies part way through a layer."
            value={shape.repeatFrom ?? 0} def={0}
            min={0}
            max={1}
            step={0.001}
            toSlider={(v) => Math.sqrt(v / 0.3)}
            fromSlider={(p) => Math.round(p * p * 0.3 * 1000) / 1000}
            format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Edge')}
            onChange={(repeatFrom) => onChange({ repeatFrom })}
          />
          <Slider
            label="Copy length"
            title="How deep a stretch of the subject each copy is, from where it is copied from"
            value={shape.repeatLength ?? 0.08} def={0.08}
            min={0}
            max={1}
            step={0.001}
            toSlider={(v) => Math.sqrt(v / 0.5)}
            fromSlider={(p) => Math.max(0.005, Math.round(p * p * 0.5 * 1000) / 1000)}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(repeatLength) => onChange({ repeatLength })}
          />
          {onFitRepeat && (
            <div className="row">
              <button title="Measure how the subject repeats along the streak (a building's floors) and set Copy length to match, so the joins between copies fall where the subject's own do" onClick={onFitRepeat}>
                Fit to the pattern
              </button>
            </div>
          )}
          {shape.repeatPeriod && (
            <Slider
              label="Layers"
              title="How many of the subject's own repeats (a building's floors) each copy takes, from where it is copied from: 1, only the first floor repeats; more, that many floors repeat together"
              value={repeatLayers(shape)}
              def={1}
              min={1}
              max={Math.max(2, Math.floor(1 / shape.repeatPeriod))}
              step={1}
              format={(v) => {
                const n = Math.round(v)
                const exact = Math.abs((shape.repeatLength ?? 0) - n * shape.repeatPeriod!) < 0.0015
                return `${exact ? '' : '≈'}${n}`
              }}
              onChange={(v) => onChange({ repeatLength: Math.min(1, Math.round(Math.round(v) * shape.repeatPeriod! * 10000) / 10000) })}
            />
          )}
          {Math.abs(shape.converge ?? 0) > 1e-4 && !shape.path && (
            <Slider
              label="Copy perspective"
              title="How fast the copies get smaller going away, against the streak's own perspective. Stronger when the subject's floors shrink faster than its sides close in, as on a building that tapers. Fit to the pattern measures it."
              value={shape.repeatVanish ?? 0}
              def={0}
              // Track: how strong, on a log scale (1 / distance to the copies' point): 0 the streak's own, ⅓× to 5×.
              min={-Math.log2(3)}
              max={Math.log2(5)}
              step={0.01}
              toSlider={(v) => -Math.log2(1 + v)}
              fromSlider={(p) => Math.round((2 ** -p - 1) * 100) / 100}
              format={(v) => (Math.abs(v) < 0.005 ? 'Same' : `${(1 / (1 + v)).toFixed(2)}×`)}
              onChange={(repeatVanish) => onChange({ repeatVanish })}
            />
          )}
          <Slider
            label="Each copy"
            title="Each copy's size against the one before: below 100% they shrink away, as repeats going into the distance would; above, they grow"
            value={shape.repeatScale ?? 1} def={1}
            min={0.5}
            max={1.5}
            step={0.01}
            format={pct}
            onChange={(repeatScale) => onChange({ repeatScale })}
          />
          <Slider
            label="Hold"
            title="How far along each bar the copy stays as it is, the subject carried on, before it eases into the streak's colour with its lines"
            value={shape.repeatHold ?? 0.5} def={0.5}
            min={0}
            max={1}
            step={0.01}
            format={(v) => (v >= 0.999 ? 'All' : v > 0 ? pct(v) : 'Off')}
            onChange={(repeatHold) => onChange({ repeatHold })}
          />
          <Slider
            label="Detail"
            title="Past Hold, how strongly the repeated part's lines and edges show on the streak's colour. Its broad light, like a highlight on a wall, is left out."
            value={shape.repeatDetail ?? 0.8} def={0.8}
            min={0}
            max={2}
            step={0.01}
            format={pct}
            onChange={(repeatDetail) => onChange({ repeatDetail })}
          />
          <label className="check-row" title="Each copy taken from a little further into the subject than the last, four in turn, so the same part is not stacked up again and again">
            <input type="checkbox" checked={shape.repeatVary !== false} onChange={(e) => onChange({ repeatVary: e.target.checked })} />
            Vary the copies
          </label>
          <label className="check-row" title="Every other copy flipped, so the joins between copies meet without a seam">
            <input type="checkbox" checked={!!shape.repeatMirror} onChange={(e) => onChange({ repeatMirror: e.target.checked })} />
            Mirror every other copy
          </label>
          {masks.length > 0 && (
            <label className="field valued wide" title="Repeat only the parts of the subject inside this mask, where bars take their colour. Elsewhere the bars keep the streak's colour.">
              <span>Repeat only on</span>
              <select value={shape.repeatMask ?? ''} onChange={(e) => onChange({ repeatMask: e.target.value || null })}>
                <option value="">Whole streak</option>
                {masks.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </label>
          )}
            </>
          )}

          <h3 className="streak-group" title="Where along each bar's line its colour is read">
            Where the colours come from
          </h3>
          {hasSubject && subject && shape.subject && (
            <Slider
              label="Start inside"
                title="How far inside the subject's edge the streak starts, so its colours are the subject's own and not the soft rim between it and what is behind. More if the bars pick up the background."
                value={shape.subject.inset}
                min={0}
                max={0.04}
                step={0.001}
                format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Edge')}
                onChange={subject.onInset}
              />
          )}
          <div className="field valued">
            <span title="Where along each line its colour is read">Colours from</span>
            <div className="segmented">
              <button className={!hasColourLine(shape.colourLine) ? 'on' : ''} title="Where each line meets the shape's edge (moved by Pull from)" onClick={() => onChange({ colourLine: null })}>
                Edge
              </button>
              <button
                className={hasColourLine(shape.colourLine) ? 'on' : ''}
                title="A line you draw across the streak: each bar reads its colour where its line crosses it. It starts where the colours are read now"
                onClick={() => !hasColourLine(shape.colourLine) && colourLine?.onEdit()}
              >
                Your line
              </button>
            </div>
          </div>
          {hasColourLine(shape.colourLine) && colourLine && (
            <div className="row">
              <button className={colourLine.editing ? 'on' : ''} title="Move its points on the photo, click the line to add one, double-click one to take it away" onClick={colourLine.onEdit}>
                {colourLine.editing ? 'Done' : 'Edit the line on the photo'}
              </button>
            </div>
          )}
          <EditBox at={`streaks/${index}/colours`} />
          <Slider
            idle={hasColourLine(shape.colourLine) ? 'Your line sets where colours are read' : false}
            label="Pull from"
            title={
              shape.mode === 'trail'
                ? 'Read the colour from deeper inside the shape, not right at its edge'
                : 'Read the colour from further back along the streak, before the shape — the shape still decides where the streak shows'
            }
            value={shape.pull} def={STREAK_DEFAULTS.pull}
            min={-0.3}
            max={0.3}
            step={0.002}
            format={(v) => (Math.abs(v) < 0.001 ? 'Edge' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`)}
            onChange={(pull) => onChange({ pull })}
          />
          <label
            className="check-row"
            title="A bar whose colour would come from something a mask keeps in front of the streaks (or from inside a streak mask) takes the colour of a clear bar nearby instead, a different one for each bar"
          >
            <input type="checkbox" checked={shape.skipMasked} onChange={(e) => onChange({ skipMasked: e.target.checked })} />
            Skip masked colours
            {!fixes.holds && <span className="muted-note"> (no mask holds these streaks back)</span>}
          </label>
        </>
      )}

      {shown === 'fixes' && (
        <>
          <StreakFixes
            shape={shape}
            onChange={onChange}
            selected={fixes.selected}
            onSelect={fixes.onSelect}
            editing={fixes.editing}
            onEditing={fixes.onEditing}
            holds={fixes.holds}
          />
          {box('fixes')}
        </>
      )}

      {shown === 'where' && (
        <>
          {hasSubject && subject && shape.subject && (
            <>
              <h3 className="streak-group" title="The subject the streak comes off, and stays behind">
                Subject
              </h3>
              <label
                className="check-row"
                title={
                  shape.maskMode === 'only' && shape.maskIds.some((id) => id !== shape.subject?.mask)
                    ? 'Not while the streak shows only inside its masks: choose Outside them first'
                    : 'The subject stays in front of the streak, as if the streak were behind it'
                }
              >
                <input
                  type="checkbox"
                  disabled={shape.maskMode === 'only' && shape.maskIds.some((id) => id !== shape.subject?.mask)}
                  checked={shape.maskMode === 'exclude' && shape.maskIds.includes(shape.subject.mask)}
                  onChange={(e) =>
                    onChange(
                      e.target.checked
                        ? { maskMode: 'exclude', maskIds: [...new Set([...shape.maskIds, shape.subject!.mask])] }
                        : { maskMode: shape.maskIds.length > 1 ? shape.maskMode : 'off', maskIds: shape.maskIds.filter((id) => id !== shape.subject!.mask) },
                    )
                  }
                />
                Keep it in front
              </label>
              {subject.body ? (
                <>
                  {subject.body}
                </>
              ) : (
                <div className="row">
                  <button className={subject.reselecting ? 'on' : ''} title="Click the subject again, or add and take away parts of it" onClick={subject.onReselect}>
                    Select the subject again
                  </button>
                </div>
              )}
            </>
          )}
          <h3 className="streak-group" title="Masks that keep this streak off part of the photo, or only on it: as every module's Where it applies">
            Where it applies
          </h3>
          <StreakWhere index={index} shape={shape} masks={masks} onChange={onChange} trace={trace} newMask={newMask} own={own} />
        </>
      )}

    </>
  )
}

/** A kind's small picture, drawn the way its bars run. */
function KindGlyph({ kind }: { kind: StreakKind }) {
  const d: Record<StreakKind, ReactNode> = {
    building: <path d="M3.5 13.5 L7.2 2 M14.5 13.5 L10.8 2 M9 13.5 L9 2" />,
    straight: <path d="M4 13.5 V2.5 M9 13.5 V2.5 M14 13.5 V2.5" />,
    radial: <path d="M9 8 V1.5 M9 8 V14.5 M9 8 H2 M9 8 H16 M9 8 L4 3.2 M9 8 L14 3.2 M9 8 L4 12.8 M9 8 L14 12.8" />,
    circle: (
      <>
        <circle cx="9" cy="8" r="6" />
        <circle cx="9" cy="8" r="3" />
      </>
    ),
    curve: <path d="M3 14 C3 7 9 9 9 2 M8 14 C8 7 14 9 14 2" />,
  }
  return (
    <svg width="18" height="16" viewBox="0 0 18 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden>
      {d[kind]}
    </svg>
  )
}

/**
 * Where this one streak shows: kept off its masks (or only on them), and
 * keyed to the photo's darker or lighter pixels under it — over the sky
 * and not the trees, say. Its masks are its own, made here and kept in it;
 * masks from the Masks list can be ticked too.
 */
function StreakWhere({
  index,
  shape,
  masks,
  onChange,
  trace,
  newMask,
  own,
}: {
  index: number
  shape: StreakShape
  masks: MaskShape[]
  onChange: (patch: Partial<StreakShape>) => void
  trace?: TraceOutline
  newMask?: StreakNewMask
  own?: StreakOwnMasks
}) {
  const subjectId = shape.subject?.mask ?? null
  const all = shape.maskIds ?? []
  // The subject kept in front is its Subject (above), not one of these.
  const subjectFront = !!subjectId && shape.maskMode === 'exclude' && all.includes(subjectId)
  const owned = own?.masks ?? []
  const choices = [...owned.map((m) => ({ id: m.id, name: m.name })), ...masks.filter((m) => m.id !== subjectId).map((m) => ({ id: m.id, name: m.name }))]
  const ids = all.filter((id) => id !== subjectId && choices.some((m) => m.id === id))
  const mode: 'only' | 'exclude' = shape.maskMode === 'only' ? 'only' : 'exclude'
  // One of its own masks open here (Edit): just made, it opens, to brush or reshape it.
  const [openOwn, setOpenOwn] = useState<string | null>(null)
  const [ownCount, setOwnCount] = useState(owned.length)
  if (ownCount !== owned.length) {
    setOwnCount(owned.length)
    setOpenOwn(owned.length > ownCount ? (owned[owned.length - 1]?.id ?? null) : null)
  }
  const openOwned = owned.find((m) => m.id === openOwn)
  const range = (level: number, soft: number) => ({
    ...(shape.key === 'darker'
      ? { lo: -0.5, hi: level, soft: Math.max(0.01, soft), label: 'Streaked' }
      : { lo: level, hi: 1.5, soft: Math.max(0.01, soft), label: 'Streaked' }),
    space: shape.keyOn === 'blue' ? ('blue' as const) : ('encoded' as const),
  })
  return (
    <>
      <MaskUse
        title={`Streak ${index + 1}`}
        masks={choices}
        ids={ids}
        mode={mode}
        onSet={(next, nextMode) =>
          onChange(
            nextMode === 'only'
              ? { maskMode: 'only', maskIds: next }
              : // Outside keeps the subject in front with the rest.
                { maskMode: next.length || subjectFront ? 'exclude' : 'off', maskIds: [...(subjectFront ? [subjectId!] : []), ...next] },
          )
        }
        making={newMask?.making ?? null}
        canMake={!!newMask?.canMake}
        onNew={(kind, side) => newMask?.onNew(kind, side)}
        pick={newMask?.pick}
        onOpenMask={(id) => (owned.some((m) => m.id === id) ? setOpenOwn(openOwn === id ? null : id) : newMask?.onOpenMask?.(id))}
        openMask={openOwned ? openOwned.id : null}
        maskBody={
          openOwned && (
            <>
              {openOwned.body}
              <button className="link quiet" title={`Remove ${openOwned.name}: it is this streak's own`} onClick={() => own!.onRemove(openOwned.id)}>
                Remove {openOwned.name}
              </button>
            </>
          )
        }
        onPeek={newMask?.onPeek}
        newMaskAt={`newmask:streak${index}`}
        sideDisabled={subjectFront ? { only: 'Not while its subject is kept in front: untick Keep it in front first' } : undefined}
      />
      <div className="field valued">
        <span title="Keep the streak to the photo's darker (or lighter) pixels under it: over the sky, not the trees in front">Tone key</span>
        <div className="segmented">
          {(['off', 'darker', 'lighter'] as const).map((key) => (
            <button
              key={key}
              className={shape.key === key ? 'on' : ''}
              title={key === 'off' ? 'Wherever the shape is' : `Only over pixels ${key} than the level`}
              onClick={() => onChange({ key })}
            >
              {key === 'off' ? 'Off' : key === 'darker' ? 'Darker' : 'Lighter'}
            </button>
          ))}
        </div>
      </div>
      {shape.key !== 'off' && (
        <>
          <ToneGauge range={range(shape.keyLevel, shape.keySoftness)} />
          <Slider
            track={toneTrack(0, 1)}
            label="Level"
            title={`The streak shows over pixels ${shape.key} than this`}
            value={shape.keyLevel} def={STREAK_DEFAULTS.keyLevel}
            min={0}
            max={1}
            step={0.01}
            onChange={(keyLevel) => onChange({ keyLevel })}
            touches={(level) => range(level, shape.keySoftness)}
          />
          <TraceToKey
            outline={shape.outline}
            keyed={{ key: shape.key, keyOn: shape.keyOn ?? 'brightness', keyLevel: shape.keyLevel }}
            trace={trace}
            onTrace={(outline) => onChange({ outline, key: 'off' })}
          />
        </>
      )}
    </>
  )
}

/** An angle in (-180, 180]. */
const wrapAngle = (a: number) => {
  const w = ((((a + 180) % 360) + 360) % 360) - 180
  return w === -180 ? 180 : w
}
/** A streak's direction as shown: clockwise from straight up (it is kept clockwise from rightward). */
const shownAngle = (angle: number) => wrapAngle(angle + 90)

