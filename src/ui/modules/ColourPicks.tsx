import { useContext, useRef } from 'react'
import type { SetStateAction } from 'react'
import { MAX_PICKS, newPick, PICK_ACTIONS, type ColourPick } from '../../engine/colourPicks'
import type { Palette } from '../../engine/palette'
import type { BlendParams, Rgb } from '../../engine/types'
import { ColourField, DropperContext, toCss } from '../ColourField'
import { EditBox } from '../EditBox'
import { percent, Slider } from '../controls'

interface Props {
  picks: ColourPick[]
  palette: Palette
  setBlend: (next: SetStateAction<BlendParams>) => void
}

const NEW = 'colour-pick:new'

/**
 * Colours picked from the photo, each kept as it is in the photo, changed to
 * another colour, or greyed (engine/colourPicks.ts). Picked from the original
 * photo, which shows while picking: what the colour really is, not what the
 * look made of it.
 */
export function ColourPicks({ picks, palette, setBlend }: Props) {
  const dropper = useContext(DropperContext)
  // The newest list, for the dropper's answers (they arrive after this render).
  const now = useRef(picks)
  now.current = picks
  const setPicks = (next: ColourPick[]) =>
    // Picked colours are Colour's: it comes on with the first.
    setBlend((b) => ({ ...b, modules: { ...b.modules, colour: true }, effects: { ...b.effects, grade: { ...b.effects.grade, picks: next } } }))
  const change = (id: string, patch: Partial<ColourPick>) => setPicks(now.current.map((p) => (p.id === id ? { ...p, ...patch } : p)))

  const pickNew = () => {
    if (!dropper) return
    if (dropper.activeId === NEW) return dropper.cancel()
    let made: string | null = null
    dropper.start(
      NEW,
      (colour) => {
        if (!colour) {
          // Put back: the one being made goes.
          if (made) setPicks(now.current.filter((p) => p.id !== made))
          made = null
          return
        }
        if (made) return change(made, { colour })
        const p = newPick(colour, now.current.length)
        made = p.id
        setPicks([...now.current, p])
      },
      undefined,
      'original',
    )
  }
  const pickAgain = (p: ColourPick) => {
    if (!dropper) return
    const id = `colour-pick:${p.id}`
    if (dropper.activeId === id) return dropper.cancel()
    const before = p.colour
    dropper.start(id, (colour) => change(p.id, { colour: colour ?? before }), undefined, 'original')
  }

  const adding = dropper?.activeId === NEW
  return (
    <div className="colour-group colour-picks">
      <h3 title="Colours picked from the photo: each kept as it is, changed to another, or greyed, whatever the rest of the look does">
        Picked colours
      </h3>
      {picks.map((p, i) => {
        const again = dropper?.activeId === `colour-pick:${p.id}`
        return (
          <div key={p.id} className="colour-pick">
            <div className="colour-pick-head">
              <button
                className={`colour-pick-swatch${again ? ' on' : ''}`}
                style={{ background: toCss(p.colour) }}
                title={again ? 'Click the colour on the photo (Esc stops)' : 'Pick this colour again from the photo'}
                aria-label={`Colour ${i + 1}: pick it again`}
                onClick={() => pickAgain(p)}
              />
              <span className="segmented" role="radiogroup" aria-label={`What colour ${i + 1} does`}>
                {PICK_ACTIONS.map((a) => (
                  <button key={a.id} role="radio" aria-checked={p.action === a.id} className={p.action === a.id ? 'on' : ''} title={a.hint} onClick={() => change(p.id, { action: a.id })}>
                    {a.label}
                  </button>
                ))}
              </span>
              <button className="icon" title="Remove this colour" aria-label={`Remove colour ${i + 1}`} onClick={() => setPicks(picks.filter((x) => x.id !== p.id))}>
                ×
              </button>
            </div>
            {p.action === 'change' && (
              <ColourField
                label="Becomes"
                title="The colour it turns into; its light and shade are kept"
                value={{ source: 'manual', colour: p.to }}
                palette={palette}
                photoSources={false}
                onChange={(c) => change(p.id, { to: c.colour as Rgb })}
              />
            )}
            <Slider
              label="Range"
              title="Only this colour, or the colours near it too"
              value={p.range}
              def={0.45}
              min={0}
              max={1}
              step={0.01}
              format={percent}
              onChange={(range) => change(p.id, { range })}
            />
            {again && <EditBox at={`dropper:colour-pick:${p.id}`} />}
            <Slider label="Strength" value={p.amount} def={1} min={0} max={1} step={0.01} format={percent} onChange={(amount) => change(p.id, { amount })} />
          </div>
        )
      })}
      <button
        className={`colour-pick-add${adding ? ' on' : ''}`}
        disabled={!dropper || (picks.length >= MAX_PICKS && !adding)}
        title={picks.length >= MAX_PICKS ? `Up to ${MAX_PICKS} colours` : 'Click a colour on the original photo, then choose what it does'}
        onClick={pickNew}
      >
        {adding ? 'Click a colour on the photo…' : picks.length ? 'Pick another colour' : 'Pick a colour'}
      </button>
      {adding && <EditBox at={`dropper:${NEW}`} />}
    </div>
  )
}
