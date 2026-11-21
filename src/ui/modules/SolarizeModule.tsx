import type { BlendParams, EffectParams } from '../../engine/types'
import { Module, Slider, ToneGauge, toneTrack } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
}

/** Solarize: the brightest tones reversed, with lines along edges. */
export function SolarizeModule({ blend, setEffects }: Props) {
  return (
    <Module id="solarize" title="Solarize">
      <Slider
        label="Reverse"
        title="The brightest tones partly reverse: whites go darker in the middle and take on the glow colour (the Sabattier effect)"
        value={blend.effects.solarize} def={FACTORY.effects.solarize}
        min={0}
        max={1}
        step={0.01}
        onChange={(solarize) => setEffects({ solarize })}
      />
      {blend.effects.solarize > 0 && (
        <>
          <ToneGauge range={{ lo: blend.effects.solarizeFrom, hi: 1.01, soft: 0.04, label: 'Reverses' }} />
          <Slider
            track={toneTrack(0.3, 0.95)}
            label="From"
            title="Brightness where the reversal starts"
            touches={(lo) => ({ lo, hi: 1.01, soft: 0.04, label: 'Reverses' })}
            value={blend.effects.solarizeFrom} def={FACTORY.effects.solarizeFrom}
            min={0.3}
            max={0.95}
            step={0.01}
            onChange={(solarizeFrom) => setEffects({ solarizeFrom })}
          />
        </>
      )}
      <Slider
        label="Lines"
        title="Pale rims where light meets dark, and darker middles in big bright areas: the Mackie lines that come with solarizing"
        value={blend.effects.halo} def={FACTORY.effects.halo}
        min={0}
        max={1}
        step={0.01}
        onChange={(halo) => setEffects({ halo })}
      />
      <Slider idle={blend.effects.halo === 0 && 'Turn up Lines first'}
        label="Line width"
        title="How far the lines spread from an edge"
        value={blend.effects.haloRadius} def={FACTORY.effects.haloRadius}
        min={0.005}
        max={0.1}
        step={0.001}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(haloRadius) => setEffects({ haloRadius })}
      />
    </Module>
  )
}
