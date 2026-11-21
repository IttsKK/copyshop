import { FIXED_PALETTES } from '../../engine/pixelPalettes'
import type { BlendParams, EffectParams, PaletteId } from '../../engine/types'
import { Module, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

const PALETTE_CHOICES: { id: PaletteId; label: string; hint: string }[] = [
  { id: 'off', label: 'Off', hint: 'Keep the photo’s full colour' },
  { id: 'photo', label: 'From photo', hint: 'The photo’s own colours, as edited, limited to a few' },
  ...(Object.entries(FIXED_PALETTES) as [Exclude<PaletteId, 'off' | 'photo'>, { label: string; hint: string }][]).map(
    ([id, p]) => ({ id, label: p.label, hint: p.hint }),
  ),
]

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
}

/** Pixel art: pixelation and limited colour palettes. */
export function PixelModule({ blend, setEffects }: Props) {
  return (
    <Module
      id="pixel"
      title="Pixel art"
      summary={
        blend.effects.pixelArt.palette !== 'off'
          ? blend.effects.pixelArt.palette === 'photo'
            ? `${blend.effects.pixelArt.colours} colours`
            : PALETTE_CHOICES.find((c) => c.id === blend.effects.pixelArt.palette)?.label
          : blend.effects.pixelArt.pixelate > 1
            ? `${blend.effects.pixelArt.pixelate} px`
            : 'None'
      }
    >
      <Slider
        label="Pixelate"
        title="Block size: the photo, grain and dither are all drawn in blocks this many pixels across"
        value={blend.effects.pixelArt.pixelate} def={FACTORY.effects.pixelArt.pixelate}
        min={1}
        max={24}
        step={1}
        format={(v) => (v <= 1 ? 'off' : `${v} px`)}
        onChange={(pixelate) => setEffects({ pixelArt: { ...blend.effects.pixelArt, pixelate } })}
      />
      <Slider
        idle={blend.effects.pixelArt.pixelate <= 1 && 'Waits on Pixelate'}
        label="Keep lines"
        title="Wires, branches and edges kept sharp through the blocks: a pixel unlike its block keeps its own colour, so flat areas like the sky go to blocks and fine lines stay as they are. Higher keeps fainter lines too."
        value={blend.effects.pixelArt.keepLines ?? 0}
        def={0}
        min={0}
        max={1}
        step={0.01}
        format={(v) => (v <= 0 ? 'Off' : `${Math.round(v * 100)}%`)}
        onChange={(keepLines) => setEffects({ pixelArt: { ...blend.effects.pixelArt, keepLines } })}
      />
      <div className="chips">
        {PALETTE_CHOICES.map((c) => (
          <button
            key={c.id}
            className={blend.effects.pixelArt.palette === c.id ? 'on' : ''}
            title={c.hint}
            onClick={() => setEffects({ pixelArt: { ...blend.effects.pixelArt, palette: c.id } })}
          >
            {c.label}
          </button>
        ))}
      </div>
      {blend.effects.pixelArt.palette === 'photo' && (
        <Slider
          label="Colours"
          title="How many colours are taken from the photo as edited"
          value={blend.effects.pixelArt.colours} def={FACTORY.effects.pixelArt.colours}
          min={2}
          max={16}
          step={1}
          format={String}
          onChange={(colours) => setEffects({ pixelArt: { ...blend.effects.pixelArt, colours } })}
        />
      )}
      {blend.effects.pixelArt.palette !== 'off' && (
        <>
          <Slider
            label="Palette"
            title="How fully the palette replaces the photo's colour"
            value={blend.effects.pixelArt.amount} def={FACTORY.effects.pixelArt.amount}
            min={0}
            max={1}
            step={0.01}
            onChange={(amount) => setEffects({ pixelArt: { ...blend.effects.pixelArt, amount } })}
          />
          <Slider
            label="Blend dither"
            title="Checker dither between palette colours, so gradients become pixel-art blends"
            value={blend.effects.pixelArt.dither} def={FACTORY.effects.pixelArt.dither}
            min={0}
            max={1}
            step={0.01}
            onChange={(dither) => setEffects({ pixelArt: { ...blend.effects.pixelArt, dither } })}
          />
        </>
      )}
    </Module>
  )
}
