import type { BaseParams } from '../../engine/base'
import { Disclosure, Module, ModuleActions, Slider, TRACKS } from '../controls'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'
import { signed } from './shared'

interface Props {
  baseFx: BaseParams
  setBase: (patch: Partial<BaseParams>) => void
  image: LoadedImage | null
  autoExposure: () => void
}

/** Exposure: the photo's exposure, contrast, highlights and shadows. */
export function ExposureModule({ baseFx, setBase, image, autoExposure }: Props) {
  return (
    <Module
      id="exposure"
      title="Exposure"
      summary={baseFx.exposure !== 0 ? `${baseFx.exposure > 0 ? '+' : ''}${baseFx.exposure.toFixed(1)} EV` : undefined}
    >
      <Slider
        track={TRACKS.exposure}
        label="Exposure"
        title="Brighter or darker, in stops"
        value={baseFx.exposure} def={FACTORY.effects.base.exposure}
        min={-3}
        max={3}
        step={0.05}
        format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`}
        onChange={(exposure) => setBase({ exposure })}
      />
      <Slider label="Contrast" title="Flatter or punchier, around the midtones" value={baseFx.contrast} def={FACTORY.effects.base.contrast} min={-1} max={1} step={0.01} format={signed} onChange={(contrast) => setBase({ contrast })} />
      <Slider label="Highlights" title="Bring bright areas down to see into them (or lift them)" value={baseFx.highlights} def={FACTORY.effects.base.highlights} min={-1} max={1} step={0.01} format={signed} onChange={(highlights) => setBase({ highlights })} />
      <Slider label="Shadows" title="Open dark areas up (or deepen them)" value={baseFx.shadows} def={FACTORY.effects.base.shadows} min={-1} max={1} step={0.01} format={signed} onChange={(shadows) => setBase({ shadows })} />
      <Disclosure id="exposure-more" title="Fine-tune">
        <Slider label="Whites" title="The brightest whites, brighter or softer" value={baseFx.whites} def={FACTORY.effects.base.whites} min={-1} max={1} step={0.01} format={signed} onChange={(whites) => setBase({ whites })} />
        <Slider label="Blacks" title="The darkest blacks, deeper or lifted" value={baseFx.blacks} def={FACTORY.effects.base.blacks} min={-1} max={1} step={0.01} format={signed} onChange={(blacks) => setBase({ blacks })} />
      </Disclosure>
      <ModuleActions>
        <button disabled={!image} title="Exposure, contrast, highlights and shadows worked out from the photo" onClick={autoExposure}>
          Auto
        </button>
      </ModuleActions>
    </Module>
  )
}
