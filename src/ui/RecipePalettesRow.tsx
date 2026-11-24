import type { Palette } from '../engine/palette'
import { NEUTRAL_PALETTE } from '../engine/palette'
import type { BlendParams, Rgb } from '../engine/types'
import { track } from '../platform/usage'
import { paletteOf, swatchOf, withPalette, type RecipePalette } from './recipePalettes'

interface Props {
  /** The recipe in use, for usage counts. */
  lookId: string
  palettes: RecipePalette[]
  blend: BlendParams
  setBlend: (blend: BlendParams) => void
  /** The open photo's own colours: palettes built from it show them. */
  palette?: Palette
  /** Pointing at a palette shows the edit in it; null when the pointer leaves. */
  onPreview: (p: { id: string; name: string; blend: BlendParams } | null) => void
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`

/**
 * Under the recipe in use: the palettes picked for it, one across each. Each
 * changes only the recipe's colours (its gradient map or its inks), so its
 * texture, glow and tone stay.
 */
export function RecipePalettesRow({ lookId, palettes, blend, setBlend, palette, onPreview }: Props) {
  const on = paletteOf(blend, palettes)
  return (
    <div className="field recipe-colours">
      <span title="The colours this recipe comes in. Only the colours change; point at one to see it on the photo.">Palette</span>
      <div className="recipe-colour-grid" style={{ gridTemplateColumns: `repeat(${palettes.length}, minmax(0, 1fr))` }} onPointerLeave={() => onPreview(null)}>
        {palettes.map((p) => {
          const [s, m, h] = swatchOf(p, palette ?? NEUTRAL_PALETTE)
          return (
            <button
              key={p.id}
              className={on?.id === p.id ? 'on' : ''}
              title={`${p.hint}${p.map?.rule || p.map?.choices?.some((c) => c.source !== 'manual') ? ', from this photo' : ''}. Changes only the colours.`}
              onPointerEnter={() => onPreview({ id: p.id, name: p.name, blend: withPalette(blend, p) })}
              onClick={() => {
                onPreview(null)
                track('recipe_palette', lookId, p.id)
                setBlend(withPalette(blend, p))
              }}
            >
              <span className="recipe-colour-swatch" style={{ background: `linear-gradient(90deg, ${css(s)} 0 33%, ${css(m)} 33% 66%, ${css(h)} 66%)` }} aria-hidden />
              {p.name}
            </button>
          )
        })}
      </div>
    </div>
  )
}
