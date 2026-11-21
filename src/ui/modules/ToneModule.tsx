import type { BlendParams, EffectParams } from '../../engine/types'
import { Module, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
}

/** Tone: film exposure, fade, highlight roll-off, vignette and clarity. */
export function ToneModule({ blend, setEffects }: Props) {
  return (
    <Module id="tone" title="Tone">
      <Slider
        label="Film exposure"
        title="Push the picture up into the film's roll-off, as overexposed film is: pale and washed. Down, it sits deeper in the film's toe. For correcting a photo's brightness, use Base photo → Exposure."
        value={blend.effects.exposure} def={FACTORY.effects.exposure}
        min={-2}
        max={2}
        step={0.05}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`}
        onChange={(exposure) => setEffects({ exposure })}
      />
      <Slider
        label="Fade"
        title="Lifts the blacks the way film's toe does, so the grain has somewhere to live in the shadows"
        value={blend.effects.fade} def={FACTORY.effects.fade}
        min={0}
        max={0.3}
        step={0.005}
        format={(v) => `${Math.round((v / 0.3) * 100)}`}
        onChange={(fade) => setEffects({ fade })}
      />
      <Slider
        label="Soft highlights"
        title="Highlights saturate gradually, the way film does, instead of clipping"
        value={blend.effects.shoulder} def={FACTORY.effects.shoulder}
        min={0}
        max={1}
        step={0.01}
        onChange={(shoulder) => setEffects({ shoulder })}
      />
      <Slider
        label="Vignette"
        title="Darkens toward the corners"
        value={blend.effects.vignette} def={FACTORY.effects.vignette}
        min={0}
        max={1}
        step={0.01}
        onChange={(vignette) => setEffects({ vignette })}
      />
      <Slider
        label="Clarity"
        title="Local contrast at texture scale: water ripples, bark, cloud detail. Brightness only, mostly in the midtones and shadows."
        value={blend.effects.structure} def={FACTORY.effects.structure}
        min={0}
        max={1}
        step={0.01}
        onChange={(structure) => setEffects({ structure })}
      />
      <Slider idle={blend.effects.structure === 0 && 'Turn up Clarity first'}
        label="Detail size"
        title="The size of detail Clarity brings out: small for fine ripples and needles, larger for waves and clouds"
        value={blend.effects.structureRadius} def={FACTORY.effects.structureRadius}
        min={0.002}
        max={0.04}
        step={0.001}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(structureRadius) => setEffects({ structureRadius })}
      />
    </Module>
  )
}
