import type { BlendParams, SurgeParams } from '../../engine/types'
import { AngleDial } from '../AngleDial'
import { Module, ModuleActions, percent, Shuffle, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setSurge: (patch: Partial<SurgeParams>) => void
}

/** Surge marks: bands from uneven development. */
export function SurgeModule({ blend, setSurge }: Props) {
  return (
    <Module
      id="surge"
      title="Surge marks"
      summary={blend.effects.surge.strength > 0 ? percent(blend.effects.surge.strength) : 'None'}
    >
      <Slider
        label="Strength"
        value={blend.effects.surge.strength} def={FACTORY.effects.surge.strength}
        min={0}
        max={1}
        step={0.01}
        onChange={(strength) => setSurge({ strength })}
      />
      <Slider
        label="Bands"
        value={blend.effects.surge.count} def={FACTORY.effects.surge.count}
        min={0}
        max={8}
        step={1}
        format={String}
        onChange={(count) => setSurge({ count })}
      />
      <Slider
        label="Width"
        value={blend.effects.surge.width} def={FACTORY.effects.surge.width}
        min={0.01}
        max={0.25}
        step={0.005}
        format={(v) => `${(v * 100).toFixed(1)}%`}
        onChange={(width) => setSurge({ width })}
      />
      <AngleDial
        look="arrow"
        label="Angle"
        title="The way the bands run, building up as they go, as developer surging across the film"
        value={blend.effects.surge.angle}
        def={FACTORY.effects.surge.angle}
        min={-180}
        max={180}
        zero={0}
        onChange={(angle) => setSurge({ angle })}
      />
      <ModuleActions>
        <Shuffle what="placing of the bands" onShuffle={() => setSurge({ seed: Math.floor(Math.random() * 2 ** 31) })} />
      </ModuleActions>
    </Module>
  )
}
