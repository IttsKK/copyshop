import type { Palette } from '../engine/palette'
import { NEUTRAL_PALETTE } from '../engine/palette'
import type { BlendParams, Rgb } from '../engine/types'
import { track } from '../platform/usage'
import { RECIPE_COLOURS, coloursOf, coloursOn, withColours, type RecipeColours } from './recipeColours'

interface Props {
  blend: BlendParams
  setBlend: (blend: BlendParams) => void
  /** The open photo's own colours: the sets built from it show them. */
  palette?: Palette
  /** Pointing at a set shows the edit in it; null when the pointer leaves. */
  onPreview: (c: { id: string; name: string; blend: BlendParams } | null) => void
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`

/**
 * Under the recipe in use: the same recipe in other colours. Each set swaps
 * the gradient map and nothing else, so the recipe's texture, glow and tone
 * stay. The first row builds its colours from the photo; the rest are fixed.
 */
export function RecipeColoursRow({ blend, setBlend, palette, onPreview }: Props) {
  const on = coloursOf(blend)
  const chip = (c: RecipeColours) => {
    const [s, m, h] = coloursOn(c, palette ?? NEUTRAL_PALETTE)
    return (
      <button
        key={c.id}
        className={on === c.id ? 'on' : ''}
        title={`${c.hint}${c.rule ? ', from this photo' : ''}. Changes only the colours.`}
        onPointerEnter={() => onPreview({ id: c.id, name: c.name, blend: withColours(blend, c) })}
        onClick={() => {
          onPreview(null)
          track('recipe_colour', c.id)
          setBlend(withColours(blend, c))
        }}
      >
        <span className="recipe-colour-swatch" style={{ background: `linear-gradient(90deg, ${css(s)} 0 33%, ${css(m)} 33% 66%, ${css(h)} 66%)` }} aria-hidden />
        {c.name}
      </button>
    )
  }
  return (
    <div className="field recipe-colours">
      <span title="The recipe in other colours. Only the colours change; point at a set to see it on the photo.">Colours</span>
      <div className="recipe-colour-grid" onPointerLeave={() => onPreview(null)}>
        {RECIPE_COLOURS.map(chip)}
      </div>
    </div>
  )
}
