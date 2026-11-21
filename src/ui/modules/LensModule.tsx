import type { BlendParams, EffectParams } from '../../engine/types'
import { Disclosure, Module, percent, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'
import { signed } from './shared'

interface Props {
  blend: BlendParams
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
}

/** Lens: distortion, fringing, soft corners, diffusion and tilt-shift. */
export function LensModule({ blend, setExtra }: Props) {
  return (
    <Module
      id="lens"
      title="Lens"
    >
      <Slider label="Distortion" title="Up: a barrel or fisheye bulge. Down: pinched in toward the middle." value={blend.effects.lens.distortion} def={FACTORY.effects.lens.distortion} min={-1} max={1} step={0.01} format={signed} onChange={(distortion) => setExtra('lens', { distortion })} />
      <Slider label="Fringes" title="Red and blue split apart toward the edges, as a cheap lens does" value={blend.effects.lens.fringe} def={FACTORY.effects.lens.fringe} min={0} max={1} step={0.01} onChange={(fringe) => setExtra('lens', { fringe })} />
      <Slider label="Diffusion" title="A diffusion filter: highlights spread into a soft glow and a little haze lifts the blacks" value={blend.effects.lens.diffusion} def={FACTORY.effects.lens.diffusion} min={0} max={1} step={0.01} onChange={(diffusion) => setExtra('lens', { diffusion })} />
      <Slider label="Soft corners" title="Sharp in the middle, softer toward the corners" value={blend.effects.lens.softEdges} def={FACTORY.effects.lens.softEdges} min={0} max={1} step={0.01} onChange={(softEdges) => setExtra('lens', { softEdges })} />
      <Disclosure id="lens-tilt" title="Tilt-shift" summary={blend.effects.lens.tilt > 0 ? percent(blend.effects.lens.tilt) : 'Off'}>
        <Slider label="Blur" title="How soft above and below the sharp band: the miniature look" value={blend.effects.lens.tilt} def={FACTORY.effects.lens.tilt} min={0} max={1} step={0.01} onChange={(tilt) => setExtra('lens', { tilt })} />
        <Slider label="Sharp at" title="Where the sharp band sits, top to bottom" value={blend.effects.lens.focus} def={FACTORY.effects.lens.focus} min={0} max={1} step={0.01} onChange={(focus) => setExtra('lens', { focus })} />
        <Slider label="Band" title="How tall the sharp band is" value={blend.effects.lens.focusWidth} def={FACTORY.effects.lens.focusWidth} min={0.02} max={0.8} step={0.01} onChange={(focusWidth) => setExtra('lens', { focusWidth })} />
      </Disclosure>
    </Module>
  )
}
