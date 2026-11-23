import { keyWords } from '../../platform/os'
import { EditBox } from '../EditBox'
import { AngleDial } from '../AngleDial'
import { type BlendParams, type EffectParams, glassOn, type GlassParams, MAX_MASKS } from '../../engine/types'
import { Disclosure, Module, ModuleActions, Slider } from '../controls'
import type { LoadedImage } from '../loadedImage'
import type { NewMaskTarget } from '../maskKinds'
import { FACTORY_GLASS } from '../moduleCatalog'

interface Props {
  glass: GlassParams
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
  maskDrawing: boolean
  newTarget: NewMaskTarget | null
  image: LoadedImage | null
  drawMask: (target: NewMaskTarget | null) => void
}

/** Glass: reeded, faceted or rippled glass laid over the photo. */
export function GlassModule({ glass, blend, setEffects, maskDrawing, newTarget, image, drawMask }: Props) {
  return (
    <Module
      id="glass"
      title="Glass"
    >
      <div className="field valued">
        <span>Type</span>
        <div className="segmented">
          {(
            [
              ['reeded', 'Reeded', 'Ribs of half-cylinders: each squeezes and flips a strip of what is behind'],
              ['facets', 'Facets', 'Flat-cut strips, each shifting what is behind by its own amount'],
              ['ripple', 'Ripple', 'Poured glass: a soft wave'],
            ] as const
          ).map(([kind, label, hint]) => (
            <button
              key={kind}
              title={hint}
              className={glass.kind === kind ? 'on' : ''}
              onClick={() => setEffects({ glass: { ...glass, enabled: true, kind, amount: glassOn(glass) || glass.amount > 0 ? glass.amount : 0.5 } })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Slider
        label="Amount"
        title="How strongly the glass bends what is behind it"
        value={glass.amount} def={FACTORY_GLASS.amount}
        min={0}
        max={1}
        step={0.01}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(amount) => setEffects({ glass: { ...glass, enabled: true, amount } })}
      />
      {glassOn(glass) && (
        <>
          <Slider
            label={glass.kind === 'ripple' ? 'Wave size' : 'Rib width'}
            title="How wide each rib (or wave) is"
            value={glass.width} def={FACTORY_GLASS.width}
            min={0.006}
            max={0.25}
            step={0.001}
            format={(v) => `${(v * 100).toFixed(1)}%`}
            onChange={(width) => setEffects({ glass: { ...glass, width } })}
          />
          <AngleDial
            look="axis"
            label="Angle"
            title="The way the ribs run: 0° upright, 90° level"
            value={glass.angle}
            def={FACTORY_GLASS.angle}
            min={-90}
            max={90}
            zero={-90}
            onChange={(angle) => setEffects({ glass: { ...glass, angle } })}
          />
          <Disclosure id="glass-more" title="Fine-tune">
            <Slider
            label="Dispersion"
            title="Colour fringes where the glass bends most: red and blue bent apart, as a prism splits light"
            value={glass.dispersion} def={FACTORY_GLASS.dispersion}
            min={0}
            max={1}
            step={0.01}
            format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')}
            onChange={(dispersion) => setEffects({ glass: { ...glass, dispersion } })}
          />
            <Slider
            label="Edges"
            title="Light and shade along the ribs' edges"
            value={glass.edges} def={FACTORY_GLASS.edges}
            min={0}
            max={1}
            step={0.01}
            format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Off')}
            onChange={(edges) => setEffects({ glass: { ...glass, edges } })}
          />
          </Disclosure>
        </>
      )}
      <ModuleActions>
        <button
          className={maskDrawing && newTarget?.section === 'glass' ? 'on' : ''}
          disabled={!image || (blend.effects.masks.length >= MAX_MASKS && !(maskDrawing && newTarget?.section === 'glass'))}
          title={
            blend.effects.masks.length >= MAX_MASKS
              ? `Up to ${MAX_MASKS} masks`
              : keyWords('Click points round where the glass should be (Option-drag to trace), double-click to close. It becomes a mask you can change in Masks.')
          }
          onClick={() => {
            // Glass switches on when the area is closed (App), so cancelling leaves it as it was.
            drawMask({ section: 'glass', mode: 'only' })
          }}
        >
          Draw glass area
        </button>
      </ModuleActions>
      <EditBox at="newmask:glass" />
    </Module>
  )
}
