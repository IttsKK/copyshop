import type { BlendParams, EffectParams } from '../../engine/types'
import { AngleDial } from '../AngleDial'
import type { PrismParams } from '../../engine/extras'
import { Disclosure, Module, percent, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
}

const degrees = (v: number) => (Math.round(v) === 0 ? 'Across' : `${v > 0 ? '+' : ''}${Math.round(v)}°`)

/** Prism: the photo's colours split apart, red and blue or a rainbow, straight or out from the middle. */
export function PrismModule({ blend, setExtra }: Props) {
  const p = blend.effects.prism
  const f = FACTORY.effects.prism
  const set = (patch: Partial<PrismParams>) => setExtra('prism', patch)
  const choice = <K extends keyof PrismParams>(label: string, title: string, key: K, options: readonly (readonly [PrismParams[K], string, string])[]) => (
    <div className="field valued">
      <span title={title}>{label}</span>
      <div className="segmented">
        {options.map(([value, name, hint]) => (
          <button key={String(value)} className={p[key] === value ? 'on' : ''} title={hint} onClick={() => set({ [key]: value } as Partial<PrismParams>)}>
            {name}
          </button>
        ))}
      </div>
    </div>
  )
  return (
    <Module id="prism" title="Prism">
      <Slider label="Split" title="How far apart the colours go: up to 3% of the photo's short side" value={p.split} def={f.split} min={0} max={1} step={0.01} onChange={(split) => set({ split })} />
      {choice('Colours', 'Which colours come apart', 'colours', [
        ['rgb', 'Red & blue', 'Red one way, blue the other, green between: sharp coloured edges'],
        ['spectrum', 'Rainbow', 'A smooth rainbow across the split, as light through a prism'],
      ] as const)}
      {choice('Direction', 'Which way the colours split', 'shape', [
        ['straight', 'Straight', 'The same split across the whole photo, the way the angle sets'],
        ['radial', 'Radial', 'Out from the middle of the photo: none there, most at the corners'],
      ] as const)}
      {p.shape === 'straight' && (
        <AngleDial
          look="split"
          label="Angle"
          title="The way red goes; blue goes the other way"
          value={p.angle}
          def={f.angle}
          min={-180}
          max={180}
          zero={0}
          format={degrees}
          onChange={(angle) => set({ angle })}
        />
      )}
      <Slider
        label="Only the light"
        title="Split only what is bright, and the fringes round it, as light through glass: the rest stays as it is. 0 splits everything."
        value={p.light}
        def={f.light}
        min={0}
        max={1}
        step={0.01}
        format={(v) => (v <= 0.005 ? 'All' : percent(v))}
        onChange={(light) => set({ light })}
      />
      <Disclosure id="prism-fine" title="Fine-tune" summary={p.amount < 1 ? percent(p.amount) : undefined}>
        <Slider label="Amount" title="How much of the split shows over the photo" value={p.amount} def={f.amount} min={0} max={1} step={0.01} onChange={(amount) => set({ amount })} />
      </Disclosure>
    </Module>
  )
}
