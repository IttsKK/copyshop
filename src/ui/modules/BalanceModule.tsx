import type { BaseParams } from '../../engine/base'
import type { Dropper } from '../ColourField'
import { Module, ModuleActions, Slider, TRACKS } from '../controls'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'
import { signed } from './shared'

interface Props {
  baseFx: BaseParams
  setBase: (patch: Partial<BaseParams>) => void
  dropper: Dropper
  image: LoadedImage | null
  pickGrey: () => void
  autoBalance: () => void
}

/** White balance: temperature, tint and saturation. */
export function BalanceModule({ baseFx, setBase, dropper, image, pickGrey, autoBalance }: Props) {
  return (
    <Module
      id="balance"
      title="White balance"
    >
      <Slider track={TRACKS.warmth} label="Temperature" title="Cooler (blue) or warmer (amber) light: a correction of the photo's own light" value={baseFx.temperature} def={FACTORY.effects.base.temperature} min={-1} max={1} step={0.01} format={signed} onChange={(temperature) => setBase({ temperature })} />
      <Slider track={TRACKS.tint} label="Tint" title="Greener or more magenta" value={baseFx.tint} def={FACTORY.effects.base.tint} min={-1} max={1} step={0.01} format={signed} onChange={(tint) => setBase({ tint })} />
      <Slider track={TRACKS.colour} label="Saturation" title="All colour, less or more" value={baseFx.saturation} def={FACTORY.effects.base.saturation} min={-1} max={1} step={0.01} format={signed} onChange={(saturation) => setBase({ saturation })} />
      <ModuleActions>
        <button
          className={dropper.activeId === 'base-grey' ? 'on' : ''}
          disabled={!image}
          title="Click something on the photo that should be grey or white: the light is balanced to make it so. Hold to preview."
          onClick={() => (dropper.activeId === 'base-grey' ? dropper.cancel() : pickGrey())}
        >
          {dropper.activeId === 'base-grey' ? 'Click something grey…' : 'Pick a grey'}
        </button>
        <button disabled={!image} title="White balance worked out from the photo's neutral midtones" onClick={autoBalance}>
          Auto
        </button>
      </ModuleActions>
    </Module>
  )
}
