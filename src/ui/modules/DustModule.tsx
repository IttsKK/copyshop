import type { BlendParams } from '../../engine/types'
import type { DefectParams } from '../../sources/defects'
import { Disclosure, Module, ModuleActions, percent, Shuffle, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setDefects: (patch: Partial<DefectParams>) => void
}

/** Dust & scratches: dust, hairs and scratches. */
export function DustModule({ blend, setDefects }: Props) {
  return (
    <Module
      id="dust"
      title="Dust & scratches"
      summary={blend.effects.defects.strength > 0 ? percent(blend.effects.defects.strength) : 'None'}
    >
      <Slider
        label="Amount"
        value={blend.effects.defects.strength} def={FACTORY.effects.defects.strength}
        min={0}
        max={1}
        step={0.01}
        onChange={(strength) => setDefects({ strength })}
      />
      <Slider
        label="Dust"
        title="Specks per megapixel"
        value={blend.effects.defects.dust} def={FACTORY.effects.defects.dust}
        min={0}
        max={300}
        step={5}
        format={String}
        onChange={(dust) => setDefects({ dust })}
      />
      <Slider
        label="Scratches"
        value={blend.effects.defects.scratches} def={FACTORY.effects.defects.scratches}
        min={0}
        max={6}
        step={1}
        format={String}
        onChange={(scratches) => setDefects({ scratches })}
      />
      <Disclosure id="dust-scanner" title="Scanner marks">
        <Slider
        label="Scan lines"
        title="Faint horizontal banding from a line scanner"
        value={blend.effects.defects.scanLines} def={FACTORY.effects.defects.scanLines}
        min={0}
        max={1}
        step={0.01}
        onChange={(scanLines) => setDefects({ scanLines })}
      />
        <Slider
        label="Streaks"
        title="Vertical streaks from dirt on the scanner's sensor"
        value={blend.effects.defects.scanStreaks} def={FACTORY.effects.defects.scanStreaks}
        min={0}
        max={1}
        step={0.01}
        onChange={(scanStreaks) => setDefects({ scanStreaks })}
      />
      </Disclosure>
      <ModuleActions>
        <Shuffle what="placing of the dust and scratches" onShuffle={() => setDefects({ seed: Math.floor(Math.random() * 2 ** 31) })} />
      </ModuleActions>
    </Module>
  )
}
