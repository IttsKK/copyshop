import type { Dispatch, SetStateAction } from 'react'
import { EditBox } from '../EditBox'
import { AngleDial } from '../AngleDial'
import { LEAK_STYLES, leakStyle, type LeakStyle as LeakStyleDef } from '../../engine/leakStyles'
import { isRounded } from '../../engine/leaks'
import type { Palette } from '../../engine/palette'
import { type BlendParams, LEAK_COLOURS, type LeakKind, type LeakParams, type LeakSpot, MAX_LEAK_SPOTS } from '../../engine/types'
import { ColourField } from '../ColourField'
import { ItemList } from '../ItemList'
import { Module, ModuleActions, Shuffle, Slider, toneTrack } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'
import { SAMPLE_FOR } from './shared'

interface Props {
  blend: BlendParams
  applyLeakStyle: (style: LeakStyleDef) => void
  setLeaks: (patch: Partial<LeakParams>) => void
  palette: Palette
  spots: LeakSpot[]
  selectedSpot: number | null
  setSelectedSpot: Dispatch<SetStateAction<number | null>>
  editingLeaks: boolean
  image: LoadedImage | null
  setEditingLeaks: Dispatch<SetStateAction<boolean>>
  setEditingBands: Dispatch<SetStateAction<boolean>>
  placeKind: LeakKind
  setPlaceKind: Dispatch<SetStateAction<LeakKind>>
  history: EditHistory
  selected: LeakSpot | undefined
  setSpot: (index: number, patch: Partial<LeakSpot>) => void
}

/** Leaks & burns: light leaks and burns placed round the frame, by style or by hand. */
export function LeaksModule({ blend, applyLeakStyle, setLeaks, palette, spots, selectedSpot, setSelectedSpot, editingLeaks, image, setEditingLeaks, setEditingBands, placeKind, setPlaceKind, history, selected, setSpot }: Props) {
  return (
    <Module
      id="leaks"
      title="Leaks & burns"
    >
      <div className="chips">
        {LEAK_STYLES.map((style) => (
          <button
            key={style.id}
            className={blend.effects.leaks.style === style.id && blend.effects.leaks.amount > 0 ? 'on' : ''}
            title={`${style.hint}. Shuffle lays them out another way.`}
            onClick={() => applyLeakStyle(style)}
          >
            {style.label}
          </button>
        ))}
      </div>
      <Slider
        label="Amount"
        title="Light getting in at the frame edges, and dark burns. The grain runs harder inside both."
        value={blend.effects.leaks.amount} def={FACTORY.effects.leaks.amount}
        min={0}
        max={1}
        step={0.01}
        onChange={(amount) => setLeaks({ amount })}
      />
      <ColourField
        label="Leak colour"
        value={blend.effects.leaks.colour}
        palette={palette}
        swatches={LEAK_COLOURS}
        onChange={(colour) => setLeaks({ colour })}
        sampleWithout={SAMPLE_FOR.leaks}
      />
      {spots.some((s) => s.colour && s.kind === 'light') && (
        <p className="hint-line">
          {spots.filter((s) => s.colour && s.kind === 'light').length} of these leaks have their own colour.{' '}
          <button
            className="link"
            onClick={() =>
              setLeaks({
                spots: spots.map(({ colour: _own, ...rest }) => rest),
              })
            }
          >
            Use the leak colour for all
          </button>
        </p>
      )}
      <Slider
        label="Count"
        title="How many leaks and burns. Adding keeps the ones you have; new ones follow the style."
        value={spots.length}
        min={0}
        max={MAX_LEAK_SPOTS}
        step={1}
        format={String}
        onChange={(count) => {
          if (count < spots.length) {
            setLeaks({ spots: spots.slice(0, count) })
            if (selectedSpot !== null && selectedSpot >= count) setSelectedSpot(null)
          } else if (count > spots.length) {
            const { layoutSeed, style } = blend.effects.leaks
            const own = spots.filter((s) => !s.mask).length
            const extra = leakStyle(style).generate(layoutSeed, own + count - spots.length).slice(own)
            setLeaks({
              amount: blend.effects.leaks.amount || leakStyle(style).amount,
              spots: [...spots, ...extra],
            })
          }
        }}
      />
      <ModuleActions>
        <button
          className={editingLeaks ? 'on' : ''}
          disabled={!image}
          title="Show the spots on the photo: drag to move, handles to turn and resize, click the photo to add"
          onClick={() => {
            setEditingLeaks(!editingLeaks)
            setEditingBands(false)
          }}
        >
          Place spots on photo
        </button>
        <Shuffle
          what="set of leaks in the same style, with fresh edges"
          onShuffle={() => {
            const layoutSeed = Math.floor(Math.random() * 2 ** 31)
            const style = leakStyle(blend.effects.leaks.style)
            // Lights stay: they were drawn on purpose.
            const lights = spots.filter((s) => s.mask)
            setLeaks({
              layoutSeed,
              seed: Math.floor(Math.random() * 2 ** 31),
              spots: [...lights, ...style.generate(layoutSeed, Math.max(1, spots.length - lights.length))].slice(0, MAX_LEAK_SPOTS),
            })
            setSelectedSpot(null)
          }}
        />
      </ModuleActions>
      <EditBox at="leaks" />
      {editingLeaks && (
        <>
          <div className="field valued">
            <span>Click adds</span>
            <div className="segmented">
              <button className={placeKind === 'light' ? 'on' : ''} onClick={() => setPlaceKind('light')}>
                Leak
              </button>
              <button className={placeKind === 'burn' ? 'on' : ''} onClick={() => setPlaceKind('burn')}>
                Burn
              </button>
            </div>
          </div>
          {spots.length >= MAX_LEAK_SPOTS && <p className="hint-line">{`At most ${MAX_LEAK_SPOTS} leaks: remove one to add another.`}</p>}
        </>
      )}
      <ItemList
        open={selectedSpot}
        onOpen={(i) => {
          // Open: its settings. Editing on the photo is the pencil's.
          setSelectedSpot(i)
          if (i === null) setEditingLeaks(false)
        }}
        items={spots.map((spot, i) => ({
          key: String(i),
          name: spot.mask
            ? `${spot.kind === 'burn' ? 'Burn' : 'Light'}: ${blend.effects.masks.find((m) => m.id === spot.mask)?.name ?? 'mask gone'}`
            : `${spot.kind === 'burn' ? 'Burn' : 'Leak'} ${i + 1}`,
          summary: spot.outline ? 'Shape' : undefined,
          label: `${spot.kind === 'burn' ? 'burn' : 'leak'} ${i + 1}`,
          editing: editingLeaks && selectedSpot === i,
          onEdit: () => {
            const on = !(editingLeaks && selectedSpot === i)
            setSelectedSpot(i)
            setEditingLeaks(on && !!image)
            setEditingBands(false)
          },
          onDuplicate: () => {
            history.hint(`${WHOLE_STEP}copying a leak`)
            setLeaks({ spots: [...spots.slice(0, i + 1), structuredClone(spots[i]), ...spots.slice(i + 1)] })
            setSelectedSpot(i + 1)
          },
          full: spots.length >= MAX_LEAK_SPOTS ? `Up to ${MAX_LEAK_SPOTS} leaks` : undefined,
          onRemove: () => {
            history.hint(`${WHOLE_STEP}removing a leak`)
            setLeaks({ spots: spots.filter((_, j) => j !== i) })
            setSelectedSpot(null)
          },
        }))}
      >
        {selected && selectedSpot !== null && (
        <>
          <div className="field valued">
            <span>Kind</span>
            <div className="segmented">
              <button
                className={selected.kind === 'light' ? 'on' : ''}
                onClick={() => setSpot(selectedSpot, { kind: 'light' })}
              >
                Leak
              </button>
              <button
                className={selected.kind === 'burn' ? 'on' : ''}
                onClick={() => setSpot(selectedSpot, { kind: 'burn' })}
              >
                Burn
              </button>
            </div>
          </div>
          {selected.kind === 'light' && (
            <>
              <div className="field valued">
                <span>Colour</span>
                <div className="segmented">
                  <button
                    className={!selected.colour ? 'on' : ''}
                    onClick={() => setSpot(selectedSpot, { colour: undefined })}
                  >
                    Leak colour
                  </button>
                  <button
                    className={selected.colour ? 'on' : ''}
                    onClick={() =>
                      setSpot(selectedSpot, {
                        colour: selected.colour ?? blend.effects.leaks.colour,
                      })
                    }
                  >
                    Its own
                  </button>
                </div>
              </div>
              {selected.colour && (
                <ColourField
                  label="Its colour"
                  value={selected.colour}
                  palette={palette}
                  swatches={LEAK_COLOURS}
                  onChange={(colour) => setSpot(selectedSpot, { colour })}
                  sampleWithout={SAMPLE_FOR.leaks}
                />
              )}
            </>
          )}
          <Slider
            label="Strength"
            value={selected.strength}
            min={0}
            max={2}
            step={0.01}
            onChange={(strength) => setSpot(selectedSpot, { strength })}
          />
          {selected.outline ? (
            <>
              <label
                className="check-row"
                title="A smooth curve through its points, or straight lines between them (for sharp corners and outlines traced round things)"
              >
                <input
                  type="checkbox"
                  checked={isRounded(selected)}
                  onChange={(e) => setSpot(selectedSpot, { polygon: true, rounded: e.target.checked })}
                />
                Rounded
              </label>
              <Slider
                label="Texture"
                title="Even: a smooth glow filling exactly the shape you drew, soft only at its edge. Up from there, the broken-up edge, hot patches and streaks of a real leak, so the shape only says roughly where."
                value={selected.texture ?? 1}
                min={0}
                max={1}
                step={0.01}
                format={(v) => (v < 0.01 ? 'Even' : `${Math.round(v * 100)}%`)}
                onChange={(texture) => setSpot(selectedSpot, { texture })}
              />
              <Slider
                label="Edge"
                title="How soft the shape's edge is, either side of the outline"
                value={selected.edge ?? 0.03}
                min={0.002}
                max={0.25}
                step={0.001}
                format={(v) => `${(v * 100).toFixed(1)}%`}
                onChange={(edge) => setSpot(selectedSpot, { edge })}
              />
              <Slider
                label="Falls off"
                title="Even all over the shape, or fading away from the side the light comes from"
                value={selected.falloff ?? 0}
                min={0}
                max={1}
                step={0.01}
                format={(v) => (v < 0.01 ? 'Even' : `${Math.round(v * 100)}%`)}
                onChange={(falloff) => setSpot(selectedSpot, { falloff })}
              />
              <AngleDial
                  idle={(selected.falloff ?? 0) === 0 && 'Even all over: turn up Falls off to set a side'}
                  look="from"
                  label="Light from"
                  title="The side the light comes from: brightest there, fading across the shape"
                  value={selected.angle}
                  min={-180}
                  max={180}
                  zero={0}
                  onChange={(angle) => setSpot(selectedSpot, { angle })}
                />
              <div className="field valued">
                <span title="Light only the photo's darker or lighter pixels inside the shape, as a mask's key does: a loose outline then lights just the leaves, or just the sky between them">
                  Only
                </span>
                <div className="segmented">
                  {(
                    [
                      ['off', 'All of it'],
                      ['darker', 'Darker'],
                      ['lighter', 'Lighter'],
                    ] as const
                  ).map(([k, label]) => (
                    <button
                      key={k}
                      className={(selected.key ?? 'off') === k ? 'on' : ''}
                      onClick={() => setSpot(selectedSpot, { key: k })}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {selected.key && selected.key !== 'off' && (
                <>
                  <Slider
                    track={toneTrack(0, 1)}
                    label="Than"
                    title="The brightness the key splits at"
                    value={selected.keyLevel ?? 0.4}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(keyLevel) => setSpot(selectedSpot, { keyLevel })}
                  />
                  <Slider
                    label="Softness"
                    title="How gradually the key goes from lit to not"
                    value={selected.keySoftness ?? 0.08}
                    min={0.002}
                    max={0.3}
                    step={0.002}
                    onChange={(keySoftness) => setSpot(selectedSpot, { keySoftness })}
                  />
                </>
              )}
              {(selected.texture ?? 1) > 0 && (
                <div className="field valued">
                  <span>Shape</span>
                  <button
                    title="A different take on the same area: its edge and hot patches shift"
                    onClick={() => setSpot(selectedSpot, { seed: Math.floor(Math.random() * 99991) })}
                  >
                    Shuffle
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <Slider
                label="Size"
                value={selected.size}
                min={0.05}
                max={1.2}
                step={0.01}
                onChange={(size) => setSpot(selectedSpot, { size })}
              />
              <Slider
                label="Stretch"
                value={selected.stretch}
                min={0.3}
                max={5}
                step={0.05}
                format={(v) => `${v.toFixed(1)}×`}
                onChange={(stretch) => setSpot(selectedSpot, { stretch })}
              />
              <AngleDial
                look="turn"
                label="Angle"
                title="Turn the spot"
                value={selected.angle}
                min={-180}
                max={180}
                zero={0}
                onChange={(angle) => setSpot(selectedSpot, { angle })}
              />
            </>
          )}
        </>
        )}
      </ItemList>
    </Module>
  )
}
