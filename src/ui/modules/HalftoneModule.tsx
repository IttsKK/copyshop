import { RISO_INKS } from '../../engine/extras'
import { AngleDial } from '../AngleDial'
import type { BlendParams, EffectParams } from '../../engine/types'
import { Disclosure, Module, SeeAlso, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
}

/** Halftone & riso: halftone dots or lines, or a two-colour riso print. */
export function HalftoneModule({ blend, setExtra }: Props) {
  return (
    <Module
      id="halftone"
      title="Halftone & riso"
      summary={{ dots: 'Dots', lines: 'Lines', riso: 'Riso' }[blend.effects.halftone.style]}
    >
      <div className="segmented">
        {(
          [
            ['dots', 'Dots', 'A newspaper dot screen, one ink'],
            ['lines', 'Lines', 'A line screen, one ink'],
            ['riso', 'Riso', 'Two inks, two screens, slightly out of register'],
          ] as const
        ).map(([id, label, hint]) => (
          <button key={id} title={hint} className={blend.effects.halftone.style === id ? 'on' : ''} onClick={() => setExtra('halftone', { style: id })}>
            {label}
          </button>
        ))}
      </div>
      <Slider label="Amount" value={blend.effects.halftone.amount} def={FACTORY.effects.halftone.amount} min={0} max={1} step={0.01} onChange={(amount) => setExtra('halftone', { amount })} />
      <Slider label={blend.effects.halftone.style === 'lines' ? 'Line spacing' : 'Dot size'} title="The screen's cell, as a share of the photo's short side" value={blend.effects.halftone.cell} def={FACTORY.effects.halftone.cell} min={0.002} max={0.03} step={0.0005} format={(v) => `${(v * 100).toFixed(2)}%`} onChange={(cell) => setExtra('halftone', { cell })} />
      {blend.effects.halftone.style === 'riso' ? (
        <div className="field valued">
          <span>Inks</span>
          <div className="recipe-chips">
            {RISO_INKS.map((p) => (
              <button
                key={p.name}
                title={p.name}
                className={`swatch-btn${blend.effects.halftone.inkA.every((v, i) => Math.abs(v - p.a[i]) < 0.01) && blend.effects.halftone.inkB.every((v, i) => Math.abs(v - p.b[i]) < 0.01) ? ' on' : ''}`}
                onClick={() => setExtra('halftone', { inkA: p.a, inkB: p.b })}
              >
                <i style={{ background: `linear-gradient(90deg, ${`rgb(${p.a.map((v) => Math.round(v * 255)).join(',')})`} 50%, ${`rgb(${p.b.map((v) => Math.round(v * 255)).join(',')})`} 50%)` }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="field valued">
          <span>Ink</span>
          <div className="recipe-chips">
            {RISO_INKS.map((p) => (
              <button
                key={p.name}
                className={`swatch-btn${blend.effects.halftone.inkA.every((v, i) => Math.abs(v - p.a[i]) < 0.01) ? ' on' : ''}`}
                onClick={() => setExtra('halftone', { inkA: p.a })}
              >
                <i style={{ background: `rgb(${p.a.map((v) => Math.round(v * 255)).join(',')})` }} />
                {p.name.split(' & ')[0]}
              </button>
            ))}
          </div>
        </div>
      )}
      <Disclosure id="halftone-more" title="Fine-tune">
        <AngleDial
          look="axis"
          label="Angle"
          title="The way the screen's rows of dots (or its lines) run"
          value={blend.effects.halftone.angle}
          def={FACTORY.effects.halftone.angle}
          min={-90}
          max={90}
          zero={0}
          onChange={(angle) => setExtra('halftone', { angle })}
        />
        {blend.effects.halftone.style === 'riso' && (
          <Slider label="Slip" title="How far the second ink misses the first" value={blend.effects.halftone.slip} def={FACTORY.effects.halftone.slip} min={0} max={0.012} step={0.0002} format={(v) => `${(v * 100).toFixed(2)}%`} onChange={(slip) => setExtra('halftone', { slip })} />
        )}
        <div className="field valued">
          <span>Paper</span>
          <div className="recipe-chips">
            {(
              [
                ['White', [0.97, 0.97, 0.96]],
                ['Cream', [0.96, 0.94, 0.88]],
                ['Newsprint', [0.88, 0.86, 0.8]],
                ['Kraft', [0.78, 0.66, 0.5]],
              ] as const
            ).map(([name, c]) => (
              <button
                key={name}
                className={`swatch-btn${blend.effects.halftone.paper.every((v, i) => Math.abs(v - c[i]) < 0.01) ? ' on' : ''}`}
                onClick={() => setExtra('halftone', { paper: [...c] as [number, number, number] })}
              >
                <i style={{ background: `rgb(${c.map((v) => Math.round(v * 255)).join(',')})` }} />
                {name}
              </button>
            ))}
          </div>
        </div>
      </Disclosure>
      <SeeAlso links={[['Dots in a few colours', 'dither', 'Dither'], ['Square pixels', 'pixel', 'Pixel art']]} />
    </Module>
  )
}
