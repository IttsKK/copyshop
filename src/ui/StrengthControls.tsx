import type { BlendParams, KeyControls } from '../engine/types'
import { Disclosure, Slider } from './controls'
import { FACTORY } from './moduleCatalog'

const KEY_CONTROLS: { id: keyof KeyControls; label: string; hint: string }[] = [
  { id: 'look', label: 'Overall', hint: 'The whole edit, stronger or gentler' },
  { id: 'grain', label: 'Grain', hint: 'Grain strength' },
  {
    id: 'colour',
    label: 'Colour',
    hint: 'How coloured the edit is: its glow and leak colours, film stock and grade. Above 100% it also saturates the photo.',
  },
  { id: 'glow', label: 'Glow', hint: 'Halation, bloom, edge glow, crunch and halo' },
  { id: 'leaks', label: 'Leaks', hint: 'Light leaks and burns' },
  { id: 'wash', label: 'Wash', hint: 'Exposure, fade, vignette, solarize and structure' },
]

/** How much of each part of the whole edit there is: at the top of In use, folded away until wanted. */
export function StrengthControls({ blend, setBlend }: { blend: BlendParams; setBlend: (b: BlendParams) => void }) {
  const changed = KEY_CONTROLS.filter((k) => Math.abs(blend.keys[k.id] - FACTORY.keys[k.id]) > 0.005).length
  return (
    <div className="strength-controls">
      <Disclosure id="edit-strength" title="Strength" summary={changed ? `${changed} changed` : 'How much of each part'}>
        <div className="keys">
          {KEY_CONTROLS.map((k) => (
            <Slider
              key={k.id}
              label={k.label}
              title={k.hint}
              value={blend.keys[k.id]}
              def={FACTORY.keys[k.id]}
              min={0}
              max={k.id === 'look' ? 1.5 : 2}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => setBlend({ ...blend, keys: { ...blend.keys, [k.id]: v } })}
            />
          ))}
        </div>
      </Disclosure>
    </div>
  )
}
