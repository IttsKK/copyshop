import { EditBox } from './EditBox'
import { AngleDial } from './AngleDial'
import type { ReactNode } from 'react'
import { MAX_LIGHTS, type LightShape, type LightingParams } from '../engine/lighting'
import type { ColourChoice, MaskShape } from '../engine/types'
import { ModuleActions, Slider } from './controls'
import { ItemList } from './ItemList'

interface Props {
  lighting: LightingParams
  hasImage: boolean
  /** Drawing a new light on the photo. */
  drawing: boolean
  onDraw: () => void
  /** The lights shown on the photo, to select, move and reshape. */
  editing: boolean
  onEdit: () => void
  selected: number | null
  onSelect: (index: number | null) => void
  /** `step` names the edit, so a slider's drag is one step to undo. */
  onChange: (index: number, patch: Partial<LightShape>, step: string) => void
  onRemove: (index: number) => void
  /** A copy of light `index`, next after it. */
  onDuplicate?: (index: number) => void
  /** A colour picker for a light's colour (the app's, with its palette and dropper). */
  colourField: (value: ColourChoice, onChange: (colour: ColourChoice) => void) => ReactNode
  /** The photo's masks, for a light to stay behind or glow round. */
  masks: MaskShape[]
  /** A new glow round a mask: light from behind it. */
  onAddGlow: () => void
}

const css = (c: ColourChoice) => `rgb(${c.colour.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`

/**
 * Lighting: lights drawn onto parts of the photo. Each is a shape where the
 * light falls, its colour, how strong it is, how soft its edge, and the side
 * it comes from; it adds light, or only tints what is there.
 */
export function LightingPanel({ lighting, hasImage, drawing, onDraw, editing, onEdit, selected, onSelect, onChange, onRemove, onDuplicate, colourField, masks, onAddGlow }: Props) {
  const lights = lighting.lights
  const full = lights.length >= MAX_LIGHTS
  return (
    <>
      <ModuleActions>
        <button className={drawing ? 'on' : ''} disabled={!hasImage || (!drawing && full)} title={full ? `Up to ${MAX_LIGHTS} lights` : 'Click round where the light falls on the photo'} onClick={onDraw}>
          Draw a light
        </button>
        <button
          disabled={!hasImage || drawing || full || !masks.length}
          title={!masks.length ? 'Make a mask of the subject first, in Masks: the glow comes from its edge' : 'Light from behind a mask: brightest at its edge, fading out, and none on what it covers'}
          onClick={onAddGlow}
        >
          Glow round a mask
        </button>
      </ModuleActions>
      <EditBox at="lighting" />
      <ItemList
        open={selected}
        onOpen={(i) => {
          // Open: its settings. Editing on the photo is the pencil's; closing stops it.
          onSelect(i)
          if (i === null && editing && !drawing) onEdit()
        }}
        empty={drawing ? undefined : 'No lights yet'}
        items={lights.map((l, i) => ({
          key: l.id,
          name: l.name,
          icon: <span className="light-swatch" style={{ background: css(l.colour) }} aria-hidden />,
          summary: l.mask && l.glow ? `Round ${masks.find((m) => m.id === l.mask)?.name ?? 'a mask'}` : l.mask ? 'From a mask' : l.mode === 'tint' ? 'Colour only' : `+${l.strength.toFixed(1)}`,
          on: l.enabled !== false,
          onToggle: () => onChange(i, { enabled: l.enabled === false }, `light${i}:enabled`),
          label: l.name,
          editing: editing && !drawing && selected === i,
          // A light from a mask has no shape of its own to edit on the photo.
          onEdit: l.mask ? undefined : () => {
            if (editing && !drawing && selected === i) onEdit()
            else {
              onSelect(i)
              if (!editing || drawing) onEdit()
            }
          },
          ...(onDuplicate ? { onDuplicate: () => onDuplicate(i), full: lights.length >= MAX_LIGHTS ? `Up to ${MAX_LIGHTS} lights` : undefined } : {}),
          onRemove: () => onRemove(i),
        }))}
      >
        {selected !== null && lights[selected] && (() => {
          const i = selected
          const l = lights[i]
          const set = (patch: Partial<LightShape>, key = Object.keys(patch).join(',')) => onChange(i, patch, `light${i}:${key}`)
          return (
                  <>
                    <EditBox at={`lighting/${l.id}`} />
                    {l.mask && l.glow !== undefined && (
                      <>
                        <label className="field valued wide" title="The mask the light comes from behind: it glows out from its edge">
                          <span>Round</span>
                          <select value={l.mask} onChange={(e) => set({ mask: e.target.value }, 'mask')}>
                            {!masks.some((m) => m.id === l.mask) && <option value={l.mask}>A removed mask</option>}
                            {masks.map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <Slider
                          label="Reach"
                          title="How far out from the mask's edge the glow fades to nothing"
                          value={l.glow}
                          // Track units: 0.2% to 50% on a square-root curve.
                          min={Math.sqrt(0.002 / 0.5)}
                          max={1}
                          step={(1 - Math.sqrt(0.002 / 0.5)) / 400}
                          toSlider={(v) => Math.sqrt(v / 0.5)}
                          fromSlider={(p) => Math.max(0.002, Math.round(p * p * 0.5 * 1000) / 1000)}
                          format={(v) => `${(v * 100).toFixed(1)}%`}
                          onChange={(glow) => set({ glow })}
                        />
                      </>
                    )}
                    {colourField(l.colour, (colour) => set({ colour }))}
                    <div className="field valued">
                      <span title="Whether it adds light, or only colours what is there">Light</span>
                      <div className="segmented">
                        <button className={l.mode === 'add' ? 'on' : ''} title="Adds light in its colour, brightening what it falls on" onClick={() => set({ mode: 'add' })}>
                          Adds light
                        </button>
                        <button className={l.mode === 'tint' ? 'on' : ''} title="Only colours what it falls on, as bright as it was" onClick={() => set({ mode: 'tint' })}>
                          Colour only
                        </button>
                      </div>
                    </div>
                    <Slider
                      label="Strength"
                      title={l.mode === 'tint' ? 'How much it colours what it falls on' : 'How much light it adds'}
                      value={l.strength}
                      min={0}
                      max={l.mode === 'tint' ? 1 : 3}
                      step={0.01}
                      format={(v) => (l.mode === 'tint' ? `${Math.round(v * 100)}%` : v.toFixed(2))}
                      onChange={(strength) => set({ strength })}
                    />
                    {l.mask && !l.glow && (
                      <Slider
                        label="Softness"
                        title="How softly its edge fades in and out, as a drawn light's does. Its mask stays as it is for anything else that uses it."
                        value={l.soft ?? 0}
                        def={0}
                        min={0}
                        max={1}
                        step={0.001}
                        toSlider={(v) => Math.sqrt(v / 0.3)}
                        fromSlider={(p) => Math.round(p * p * 0.3 * 1000) / 1000}
                        format={(v) => (v > 0 ? `${(v * 100).toFixed(1)}%` : 'As the mask')}
                        onChange={(soft) => set({ soft })}
                      />
                    )}
                    {!l.mask && (
                    <Slider
                      label="Softness"
                      title="How softly its edge fades"
                      value={l.edge}
                      min={0}
                      max={1}
                      step={0.001}
                      toSlider={(v) => Math.sqrt(v / 0.3)}
                      fromSlider={(p) => Math.round(p * p * 0.3 * 1000) / 1000}
                      format={(v) => `${(v * 100).toFixed(1)}%`}
                      onChange={(edge) => set({ edge })}
                    />
                    )}
                    <Slider
                      label="Fades"
                      title="Even all over, or fading across the shape away from the side the light comes from"
                      value={l.falloff}
                      min={0}
                      max={1}
                      step={0.01}
                      format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'Even')}
                      onChange={(falloff) => set({ falloff })}
                    />
                    {l.falloff > 0 && (
                      <AngleDial
                        look="from"
                        label="Comes from"
                        title="The side the light comes from: brightest there, fading across the shape"
                        value={l.angle}
                        min={-180}
                        max={180}
                        zero={0}
                        onChange={(angle) => set({ angle })}
                      />
                    )}
                    {!l.mask && (
                      <div className="field valued">
                        <span title="A smooth curve through its points, or straight lines between them">Shape</span>
                        <div className="segmented">
                          <button className={l.rounded ? 'on' : ''} onClick={() => set({ rounded: true })}>
                            Smooth
                          </button>
                          <button className={!l.rounded ? 'on' : ''} onClick={() => set({ rounded: false })}>
                            Straight
                          </button>
                        </div>
                      </div>
                    )}
                    <label className="field valued wide" title="A mask the light stays behind, so what it covers (the building) is in front of it; or the only place it shows">
                      <span>Mask</span>
                      <select value={l.holdMask ?? ''} onChange={(e) => set({ holdMask: e.target.value || null }, 'holdMask')}>
                        <option value="">None</option>
                        {masks.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    {l.holdMask && (
                      <div className="field valued">
                        <span />
                        <div className="segmented">
                          <button className={!l.holdInside ? 'on' : ''} title="The light stays behind what the mask covers" onClick={() => set({ holdInside: false })}>
                            Behind it
                          </button>
                          <button className={l.holdInside ? 'on' : ''} title="The light shows only inside the mask" onClick={() => set({ holdInside: true })}>
                            Only in it
                          </button>
                        </div>
                      </div>
                    )}
                    <label className="check-row" title="The light shows only where there are no streaks, so the streaks are in front of it">
                      <input type="checkbox" checked={!!l.behindStreaks} onChange={(e) => set({ behindStreaks: e.target.checked })} />
                      Behind the streaks
                    </label>
                    <label className="field valued wide">
                      <span>Name</span>
                      <input type="text" aria-label="Name" value={l.name} maxLength={60} onChange={(e) => set({ name: e.target.value }, 'name')} />
                    </label>
                  </>
          )
        })()}
      </ItemList>
    </>
  )
}
