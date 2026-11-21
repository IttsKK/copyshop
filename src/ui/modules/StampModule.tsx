import { STAMP_COLOURS, STAMP_FORMATS, STAMP_THEMES, stampLabel, stampText } from '../../engine/extras'
import type { BlendParams, EffectParams } from '../../engine/types'
import { Module, Slider } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import { FACTORY } from '../moduleCatalog'
import { track } from '../../platform/usage'

interface Props {
  blend: BlendParams
  history: EditHistory
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
}

/** Date stamp: a date printed in the corner, like a point-and-shoot camera. */
export function StampModule({ blend, history, setExtra }: Props) {
  return (
    <Module
      id="stamp"
      title="Date stamp"
      summary={STAMP_THEMES.find((t) => t.id === blend.effects.stamp.theme)?.label}
    >
      <div className="stamp-themes">
        {STAMP_THEMES.map((t) => (
          <button
            key={t.id}
            title={t.hint}
            className={`stamp-theme stamp-theme-${t.id}${blend.effects.stamp.theme === t.id ? ' on' : ''}`}
            onClick={() => {
              track('stamp', t.id)
              history.hint(`${WHOLE_STEP}the ${t.label.toLowerCase()} stamp`)
              setExtra('stamp', { theme: t.id, ...t.look, enabled: true })
            }}
          >
            <span className="stamp-sample" style={{ color: `rgb(${t.look.colour.map((v) => Math.round(v * 255)).join(',')})` }}>
              {stampLabel(stampText({ ...blend.effects.stamp, ...t.look }))}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <div className="chips">
        {STAMP_FORMATS.filter((f) => f.theme === blend.effects.stamp.theme || f.theme === 'both').map((f) => (
          <button key={f.id} className={blend.effects.stamp.format === f.id ? 'on' : ''} onClick={() => setExtra('stamp', { format: f.id })}>
            {f.id === 'custom' ? f.label : stampLabel(stampText({ ...blend.effects.stamp, format: f.id }))}
          </button>
        ))}
      </div>
      {blend.effects.stamp.format === 'custom' ? (
        <label className="field">
          <span>Text</span>
          <input
            type="text"
            value={blend.effects.stamp.custom}
            placeholder="'98 6 22"
            title="Digits, spaces and ' . - : /: what a camera's date can show"
            onChange={(e) => setExtra('stamp', { custom: e.target.value })}
          />
        </label>
      ) : (
        <p className="hint-line">
          {blend.effects.stamp.date
            ? `Taken ${blend.effects.stamp.date.replace(' ', ', ')}`
            : 'No date in the photo: today’s is used'}
        </p>
      )}
      <div className="field valued">
        <span>Corner</span>
        <div className="segmented">
          {(
            [
              ['tl', '↖'],
              ['tr', '↗'],
              ['bl', '↙'],
              ['br', '↘'],
            ] as const
          ).map(([c, label]) => (
            <button key={c} title={{ tl: 'Top left', tr: 'Top right', bl: 'Bottom left', br: 'Bottom right' }[c]} className={blend.effects.stamp.corner === c ? 'on' : ''} onClick={() => setExtra('stamp', { corner: c })}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field valued">
        <span>Colour</span>
        <div className="recipe-chips">
          {STAMP_COLOURS.map((c) => (
            <button
              key={c.name}
              className={`swatch-btn${blend.effects.stamp.colour.every((v, i) => Math.abs(v - c.colour[i]) < 0.01) ? ' on' : ''}`}
              onClick={() => setExtra('stamp', { colour: c.colour })}
            >
              <i style={{ background: `rgb(${c.colour.map((v) => Math.round(v * 255)).join(',')})` }} />
              {c.name}
            </button>
          ))}
        </div>
      </div>
      <Slider label="Size" value={blend.effects.stamp.size} def={FACTORY.effects.stamp.size} min={0.015} max={0.08} step={0.001} format={(v) => `${(v * 100).toFixed(1)}%`} onChange={(size) => setExtra('stamp', { size })} />
      <Slider label="Glow" title="How much the digits bloom into the film" value={blend.effects.stamp.glow} def={FACTORY.effects.stamp.glow} min={0} max={1} step={0.01} onChange={(glow) => setExtra('stamp', { glow })} />
    </Module>
  )
}
