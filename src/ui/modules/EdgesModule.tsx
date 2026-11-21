import type { BlendParams, EffectParams } from '../../engine/types'
import { Module, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
}

/** Edges: glow and contrast along edges. */
export function EdgesModule({ blend, setEffects }: Props) {
  return (
    <Module id="edges" title="Edges">
      <Slider
        label="Edge glow"
        title="Bright areas burn an outline into dark shapes next to them"
        value={blend.effects.rim} def={FACTORY.effects.rim}
        min={0}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(v * 50)}`}
        onChange={(rim) => setEffects({ rim })}
      />
      <Slider
        label="Crunch"
        title="Punchy local contrast with bright outlines on edges"
        value={blend.effects.crunch} def={FACTORY.effects.crunch}
        min={0}
        max={1}
        step={0.01}
        onChange={(crunch) => setEffects({ crunch })}
      />
      <Slider
        label="Reach"
        title="How far edge glow and crunch reach from an edge"
        value={blend.effects.rimRadius} def={FACTORY.effects.rimRadius}
        min={0.001}
        max={0.012}
        step={0.0005}
        format={(v) => `${(v * 100).toFixed(2)}%`}
        onChange={(rimRadius) => setEffects({ rimRadius })}
      />
    </Module>
  )
}
