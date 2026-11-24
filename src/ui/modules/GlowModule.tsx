import type { Palette } from '../../engine/palette'
import type { BlendParams, EffectParams } from '../../engine/types'
import { ColourField } from '../ColourField'
import { Disclosure, Module, Slider, ToneGauge, toneTrack } from '../controls'
import { FACTORY } from '../moduleCatalog'
import { SAMPLE_FOR } from './shared'

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
  palette: Palette
}

/** Glow: halation and bloom around the highlights. */
export function GlowModule({ blend, setEffects, palette }: Props) {
  return (
    <Module id="light" title="Glow">
      <Slider
        label="Halation"
        title="Warm glow bleeding out of highlights, reflected off the film base"
        value={blend.effects.halation} def={FACTORY.effects.halation}
        min={0}
        max={1}
        step={0.01}
        onChange={(halation) => setEffects({ halation })}
      />
      <Slider
        label="Bloom"
        title="Neutral glow: lens flare and veiling glare"
        value={blend.effects.bloom} def={FACTORY.effects.bloom}
        min={0}
        max={1}
        step={0.01}
        onChange={(bloom) => setEffects({ bloom })}
      />
      <Slider
        label="Radius"
        title="How far the glow spreads"
        value={blend.effects.glowRadius} def={FACTORY.effects.glowRadius}
        min={0.004}
        max={0.12}
        step={0.002}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(glowRadius) => setEffects({ glowRadius })}
      />
      <ColourField
        label="Colour"
        title="Colour of the halation. This photo's light colour by default."
        value={blend.effects.glowColour}
        palette={palette}
        onChange={(glowColour) => setEffects({ glowColour })}
        sampleWithout={SAMPLE_FOR.light}
      />
      <label className="check-row" title="Less glow on a photo that is mostly bright, like a white sky or snow, so it doesn't wash out. A few lights in the dark keep it all.">
        <input type="checkbox" checked={blend.effects.glowFit === true} onChange={(e) => setEffects({ glowFit: e.target.checked })} />
        Fit to the photo
      </label>
      <Disclosure id="glow-shape" title="Fine-tune">
        <ToneGauge range={{ lo: blend.effects.glowThreshold + 0.09, hi: 1.5, soft: 0.09, space: 'linear', label: 'Glows' }} />
        <Slider
          track={toneTrack(0.2, 1, 'linear')}
          label="Glow from"
          title="Brightness where the glow starts"
          touches={(lo) => ({ lo: lo + 0.09, hi: 1.5, soft: 0.09, space: 'linear', label: 'Glows' })}
          value={blend.effects.glowThreshold} def={FACTORY.effects.glowThreshold}
          min={0.2}
          max={1}
          step={0.01}
          onChange={(glowThreshold) => setEffects({ glowThreshold })}
        />
      </Disclosure>
    </Module>
  )
}
