import { keyWords } from '../platform/os'
import { useContext, useState } from 'react'
import { DEFAULT_STREAK_FIX, MAX_FIX_COLOURS, MAX_STREAK_FIXES, type Rgb, type StreakFix, type StreakShape } from '../engine/types'
import { ColourPicker } from './ColourPicker'
import { DropperContext, toCss } from './ColourField'
import { Slider } from './controls'
import { ItemList } from './ItemList'

/**
 * What the photo is doing for the fixes: waiting for a drag across the streak
 * for a new fix, showing the fixes to drag their ends, or waiting for a
 * drag across the part the selected fix's colours come from.
 */
export type FixEditing = 'add' | 'edit' | 'source' | null

interface Props {
  shape: StreakShape
  onChange: (patch: Partial<StreakShape>) => void
  selected: number | null
  onSelect: (index: number | null) => void
  editing: FixEditing
  onEditing: (editing: FixEditing) => void
  /** A mask holds the streaks back (or a streak mask exists): masked colours are a thing here. */
  holds: boolean
}

const newSeed = () => Math.floor(Math.random() * 99991)

/**
 * The two sides of a streak's bars, in words: the side a fix borrows from
 * before its span is where the across coordinate is smaller.
 */
function sideNames(shape: StreakShape): [string, string] {
  let a = (shape.angle * Math.PI) / 180
  if (shape.path && shape.path.length >= 2) a = Math.atan2(shape.path[1].y - shape.path[0].y, shape.path[1].x - shape.path[0].x)
  // Across, increasing: (-sin, cos) of the flow.
  const nx = -Math.sin(a)
  const ny = Math.cos(a)
  if (Math.abs(nx) >= Math.abs(ny)) return nx > 0 ? ['Left', 'Right'] : ['Right', 'Left']
  return ny > 0 ? ['Above', 'Below'] : ['Below', 'Above']
}

/** A fix in a few words: what it does. */
export function fixSummary(f: StreakFix): string {
  const parts: string[] = [f.mode === 'borrow' ? (f.source ? 'from a part you picked' : 'from beside it') : f.mode === 'colours' ? 'your colours' : 'tone only']
  if (Math.abs(f.brightness) >= 0.005) parts.push(`${f.brightness > 0 ? '+' : ''}${f.brightness.toFixed(2)} st`)
  if (Math.abs(f.contrast) >= 0.005) parts.push(`contrast ${f.contrast > 0 ? '+' : ''}${Math.round(f.contrast * 100)}`)
  if (f.opacity < 0.995) parts.push(`${Math.round(f.opacity * 100)}%`)
  if (f.carry === 'repeat') parts.push('copies the subject')
  if (f.carry === 'colour') parts.push('plain colour')
  return parts.join(' · ')
}

const stops = (v: number) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : ''}${v.toFixed(2)} st`)

/**
 * A streak's fixes: runs of its bars, chosen side to side across them, each
 * with what it changes on them — tone (brightness, contrast, opacity) and
 * colours (kept, copied from another part of the streak so they keep its
 * character, or that character in colours you choose).
 */
export function StreakFixes({ shape, onChange, selected, onSelect, editing, onEditing, holds }: Props) {
  const fixes = shape.fixes
  const fix = selected !== null && selected < fixes.length ? fixes[selected] : null
  const setFix = (patch: Partial<StreakFix>) =>
    selected !== null && onChange({ fixes: fixes.map((f, k) => (k === selected ? { ...f, ...patch } : f)) })
  const [picking, setPicking] = useState<number | null>(null)
  const dropper = useContext(DropperContext)
  const names = sideNames(shape)
  const dropId = `streak-fix-${selected}`
  const look = !fix ? 'beside' : fix.mode === 'keep' ? 'own' : fix.mode === 'colours' ? 'colours' : fix.source || editing === 'source' ? 'picked' : 'beside'
  const adding = editing === 'add'

  const addColour = (colour: Rgb) => {
    if (!fix || fix.colours.length >= MAX_FIX_COLOURS) return
    setFix({ colours: [...fix.colours, colour] })
    setPicking(fix.colours.length)
  }

  return (
    <>
      <div className="row">
        <button
          className={adding ? 'on' : ''}
          disabled={!adding && fixes.length >= MAX_STREAK_FIXES}
          title={fixes.length >= MAX_STREAK_FIXES ? `Up to ${MAX_STREAK_FIXES}` : "A part of the streak in a colour you don't want (from a pole, a sign, the subject's edge): drag across it on the photo, side to side, and it takes the colours beside it"}
          onClick={() => onEditing(adding ? null : 'add')}
        >
          Fix a part
        </button>
      </div>
      {/* What to do on the photo while adding one is in its edit box, under the fixes. */}
      <ItemList
        open={adding ? null : selected}
        onOpen={(k) => {
          // Open: its settings. Editing on the photo is the pencil's.
          onSelect(k)
          setPicking(null)
          if (k === null) onEditing(null)
        }}
        items={fixes.map((f, k) => ({
          key: String(k),
          name: `Fix ${k + 1}`,
          summary: fixSummary(f),
          label: `fix ${k + 1}`,
          editing: editing === 'edit' && selected === k,
          onEdit: () => {
            const on = !(editing === 'edit' && selected === k)
            onSelect(k)
            onEditing(on ? 'edit' : null)
          },
          onDuplicate: () => {
            onChange({ fixes: [...fixes.slice(0, k + 1), structuredClone(fixes[k]), ...fixes.slice(k + 1)] })
            onSelect(k + 1)
          },
          full: fixes.length >= MAX_STREAK_FIXES ? `Up to ${MAX_STREAK_FIXES} fixes` : undefined,
          onRemove: () => {
            onChange({ fixes: fixes.filter((_, j) => j !== k) })
            onSelect(null)
            onEditing(null)
          },
        }))}
      >
        {fix && selected !== null && !adding && (
          <>
            <div className="field valued">
              <span title="Where this part's colours come from: the streak beside it, another part you pick, its own light and dark in your colours, or its own colours with only the tone below changed">Colours</span>
              <select
                value={look}
                onChange={(e) => {
                  const next = e.target.value as typeof look
                  if (next === 'beside') {
                    setFix({ mode: 'borrow', source: null })
                    if (editing === 'source') onEditing('edit')
                  } else if (next === 'picked') {
                    setFix({ mode: 'borrow' })
                    if (!fix.source) onEditing('source')
                  } else {
                    setFix({ mode: next === 'colours' ? 'colours' : 'keep' })
                    if (editing === 'source') onEditing('edit')
                  }
                }}
              >
                <option value="beside">From beside it</option>
                <option value="picked">From a part you pick</option>
                <option value="colours">Your colours</option>
                <option value="own">Its own (tone only)</option>
              </select>
            </div>
            {fix.mode !== 'keep' && (
              <>
                {look === 'picked' &&
                  (editing === 'source' ? null : (
                    <div className="row">
                      <button title="Drag across another part of the streak on the photo to copy it" onClick={() => onEditing('source')}>
                        {fix.source ? 'Pick another part' : 'Pick the part to copy'}
                      </button>
                    </div>
                  ))}
                {look === 'beside' && (
                  <>
                    <div className="field valued">
                      <span title="Which side of it the colours are copied from, mirrored in">Side</span>
                      <div className="segmented">
                        {(
                          [
                            ['both', 'Both sides'],
                            ['before', names[0]],
                            ['after', names[1]],
                          ] as const
                        ).map(([side, label]) => (
                          <button key={side} className={fix.side === side ? 'on' : ''} onClick={() => setFix({ side })}>
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                  </>
                )}
              {fix.mode === 'colours' && (
                <div className="field">
                  <div className="fix-colours">
                    {fix.colours.map((c, k) => (
                      <button
                        key={k}
                        className={picking === k ? 'fix-colour on' : 'fix-colour'}
                        style={{ background: toCss(c) }}
                        title={keyWords("Click to change; Option-click to remove")}
                        onClick={(e) => {
                          if (e.altKey) {
                            setFix({ colours: fix.colours.filter((_, j) => j !== k) })
                            setPicking(null)
                          } else setPicking(picking === k ? null : k)
                        }}
                      />
                    ))}
                    {fix.colours.length < MAX_FIX_COLOURS && (
                      <>
                        <button
                          className="tool-btn"
                          title="Add a colour"
                          onClick={() => addColour(fix.colours[fix.colours.length - 1] ?? [0.6, 0.6, 0.6])}
                        >
                          + Add
                        </button>
                        {dropper && (
                          <button
                            className={dropper.activeId === dropId ? 'tool-btn on' : 'tool-btn'}
                            title="Take a colour from the photo as it was before the look: click here, then on the photo (Esc cancels)"
                            onClick={() => {
                              if (dropper.activeId === dropId) return dropper.cancel()
                              const before = fix.colours
                              dropper.setFrom('original')
                              dropper.start(dropId, (colour) =>
                                setFix({ colours: colour ? [...before, colour].slice(0, MAX_FIX_COLOURS) : before }),
                              )
                            }}
                          >
                            Dropper
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {fix.colours.length === 0 && (
                    <p className="hint-line" title="The source's light and dark pick among them, darkest to lightest">Add two or more colours</p>
                  )}
                  {picking !== null && picking < fix.colours.length && (
                    <div className="picker-slot">
                      <ColourPicker
                        value={fix.colours[picking]}
                        onChange={(colour) => setFix({ colours: fix.colours.map((c, j) => (j === picking ? colour : c)) })}
                      />
                    </div>
                  )}
                </div>
              )}
              {holds && (
                <label
                  className="check-row"
                  title="On: the source's parts under a mask that holds the streaks back give their own colours. Off: they give the colour a clear bar lends them."
                >
                  <input type="checkbox" checked={fix.masked} onChange={(e) => setFix({ masked: e.target.checked })} />
                  Include masked colours
                </label>
              )}

            </>
          )}
          <h3 className="streak-group">Tone</h3>
          <Slider
            label="Brightness"
            title="Lighten or darken these bars, in stops"
            value={fix.brightness}
            min={-2}
            max={2}
            step={0.05}
            format={stops}
            onChange={(brightness) => setFix({ brightness })}
          />
          <Slider
            label="Contrast"
            title="Spread these bars' tones apart (more) or together (less)"
            value={fix.contrast}
            min={-1}
            max={1}
            step={0.01}
            format={(v) => (Math.abs(v) < 0.005 ? '0' : `${v > 0 ? '+' : ''}${Math.round(v * 100)}`)}
            onChange={(contrast) => setFix({ contrast })}
          />
          <Slider
            label="Opacity"
            title="How much of these bars shows: lower lets the photo through"
            value={fix.opacity}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(opacity) => setFix({ opacity })}
          />
          <Slider
            label="Soft sides"
            title="How softly the fix's sides fade into the bars beside it: its tone eases in, and its colours mix in bar by bar"
            value={fix.feather}
            min={0}
            max={0.1}
            step={0.001}
            format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'Hard')}
            onChange={(feather) => setFix({ feather })}
          />
          <div className="field valued">
            <span title="What these bars carry out from their edge, over the streak's own Carry">Along the bars</span>
            <div className="segmented">
              {(
                [
                  ['streak', 'As the streak', "Whatever the streak's Carry is"],
                  ['repeat', 'Copy', 'The subject carried on: its own stretch behind the edge, copied (Repeat settings in Shape)'],
                  ['colour', 'Plain colour', "The bar's colour, held along it"],
                ] as const
              ).map(([carry, label, hint]) => (
                <button key={carry} title={hint} className={(fix.carry ?? 'streak') === carry ? 'on' : ''} onClick={() => setFix({ carry })}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          </>
        )}
      </ItemList>
    </>
  )
}

/**
 * A new fix across the streak from a to b on this shape: that stretch of
 * it takes its colours from beside it, which is what a fix is mostly for; copying, it takes its source as
 * the streak shows it, so masked colours count only where the shape does
 * not skip them.
 */
export function newFix(a: { x: number; y: number }, b: { x: number; y: number }, shape: StreakShape): StreakFix {
  return { ...DEFAULT_STREAK_FIX, mode: 'borrow', colours: [], masked: !shape.skipMasked, a, b, seed: newSeed() }
}
