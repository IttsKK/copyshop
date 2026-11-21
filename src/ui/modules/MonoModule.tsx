import { MONO_FILTERS, MONO_TONES } from '../../engine/extras'
import type { BlendParams, EffectParams } from '../../engine/types'
import { Module, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'
import { signed } from './shared'

interface Props {
  blend: BlendParams
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
}

/** Black & white: with a colour filter and toning. */
export function MonoModule({ blend, setExtra }: Props) {
  return (
    <Module
      id="mono"
      title="Black & white"
      summary={blend.effects.mono.filter !== 'none' ? `${MONO_FILTERS.find((f) => f.id === blend.effects.mono.filter)?.label} filter` : undefined}
    >
      <div className="field valued">
        <span title="A coloured filter on the lens decides which colours print light and which dark">Filter</span>
        <div className="recipe-chips">
          {MONO_FILTERS.map((f) => (
            <button key={f.id} title={f.hint} className={`chip${blend.effects.mono.filter === f.id ? ' on' : ''}`} onClick={() => setExtra('mono', { filter: f.id })}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <Slider label="Amount" title="All the way to black and white, or some colour left" value={blend.effects.mono.amount} def={FACTORY.effects.mono.amount} min={0} max={1} step={0.01} onChange={(amount) => setExtra('mono', { amount })} />
      <Slider label="Contrast" title="Flatter or punchier film" value={blend.effects.mono.contrast} def={FACTORY.effects.mono.contrast} min={-1} max={1} step={0.01} format={signed} onChange={(contrast) => setExtra('mono', { contrast })} />
      <div className="field valued">
        <span title="A toner on the print">Toned</span>
        <div className="recipe-chips">
          {MONO_TONES.map((t) => (
            <button
              key={t.id}
              title={t.hint}
              className={`swatch-btn${blend.effects.mono.tone === t.id ? ' on' : ''}`}
              onClick={() => setExtra('mono', { tone: t.id })}
            >
              <i style={{ background: `rgb(${t.colour.map((v) => Math.round(v * 255)).join(',')})` }} />
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <Slider idle={blend.effects.mono.tone === 'none' && 'Pick a toner first'} label="Toning" title="How strong the toner is" value={blend.effects.mono.toneAmount} def={FACTORY.effects.mono.toneAmount} min={0} max={1} step={0.01} onChange={(toneAmount) => setExtra('mono', { toneAmount })} />
    </Module>
  )
}
