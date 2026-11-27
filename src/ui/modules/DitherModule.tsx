import type { Dispatch, SetStateAction } from 'react'
import { EditBox } from '../EditBox'
import type { BlendParams, EffectParams } from '../../engine/types'
import { ItemList } from '../ItemList'
import { Disclosure, Module, Slider, ToneGauge, toneTrack } from '../controls'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'

interface Props {
  blend: BlendParams
  setEffects: (patch: Partial<EffectParams>) => void
  setEditingGuides: Dispatch<SetStateAction<boolean>>
  editingGuides: boolean
  image: LoadedImage | null
  setEditingBands: Dispatch<SetStateAction<boolean>>
  setEditingLeaks: Dispatch<SetStateAction<boolean>>
  guideSign: 1 | -1
  setGuideSign: Dispatch<SetStateAction<1 | -1>>
  selectedGuide: number | null
  setSelectedGuide: Dispatch<SetStateAction<number | null>>
  editingBands: boolean
}

/** Dither: the photo in brightness bands, stippled or ordered, with guides and a band shape that steer them. */
export function DitherModule({ blend, setEffects, setEditingGuides, editingGuides, image, setEditingBands, setEditingLeaks, guideSign, setGuideSign, selectedGuide, setSelectedGuide, editingBands }: Props) {
  const dither = blend.effects.dither
  const dots: 'fine' | 'clumps' | 'pixel' = dither.pixel > 1 ? 'pixel' : (dither.clumps ?? 1) > 1 && dither.pattern === 'grain' ? 'clumps' : 'fine'
  return (
    <Module
      id="dither"
      title="Dither"
      summary={dither.amount > 0 ? `${dither.steps} steps${dots === 'pixel' ? ` · ${dither.pixel} px dots` : dots === 'clumps' ? ' · clumps' : ''}` : 'None'}
    >
      <Slider
        label="Amount"
        value={blend.effects.dither.amount} def={FACTORY.effects.dither.amount}
        min={0}
        max={1}
        step={0.01}
        onChange={(amount) => setEffects({ dither: { ...blend.effects.dither, amount } })}
      />
      <Slider
        label="Steps"
        title="How many brightness bands. Fewer steps, bigger bands."
        value={blend.effects.dither.steps} def={FACTORY.effects.dither.steps}
        min={2}
        max={24}
        step={1}
        format={String}
        onChange={(steps) => setEffects({ dither: { ...blend.effects.dither, steps } })}
      />
      {/* What the dots are, first: the choice that changes the look most. */}
      <div className="field valued">
        <span title="Fine: a fine stipple. Clumps: the dots gathered into soft clumps, as coarse film grain is. Pixel: bigger square dots, as pixel art has">Dots</span>
        <div className="segmented">
          {(
            [
              ['fine', 'Fine', 'A fine stipple'],
              ['clumps', 'Clumps', 'The dots gathered into soft clumps, as coarse film grain is'],
              ['pixel', 'Pixel', 'Square dots several pixels across, as pixel art has'],
            ] as const
          ).map(([id, name, title]) => (
            <button
              key={id}
              title={title}
              className={dots === id ? 'on' : ''}
              onClick={() =>
                setEffects({
                  dither: {
                    ...dither,
                    ...(id === 'fine'
                      ? { pixel: 1, clumps: 1 }
                      : id === 'clumps'
                        ? { pixel: 1, clumps: (dither.clumps ?? 1) > 1 ? dither.clumps : 2.5, pattern: 'grain' as const }
                        : { pixel: dither.pixel > 1 ? dither.pixel : 4 }),
                  },
                })
              }
            >
              {name}
            </button>
          ))}
        </div>
      </div>
      {dots === 'pixel' && (
        <Slider
          label="Pixel size"
          title="Size of each dot. 2–4 px survives a phone screen and Instagram and reads as pixel art."
          value={dither.pixel} def={4}
          min={2}
          max={16}
          step={1}
          format={(v) => `${v} px`}
          onChange={(pixel) => setEffects({ dither: { ...dither, pixel } })}
        />
      )}
      {dots === 'clumps' && (
        <Slider
          label="Clumps"
          title="How large the clumps are, in fine dots"
          value={dither.clumps ?? 1}
          def={2.5}
          min={1.2}
          max={4}
          step={0.1}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(clumps) => setEffects({ dither: { ...dither, clumps } })}
        />
      )}
      {dots === 'pixel' && (
        <label className="check-row" title="Each dot one solid colour, read from the photo in blocks the dots' size, so no dot is split. Off, the photo shows through each dot.">
          {/* On, it starts keeping the photo's detail (Keep detail) unless that was set already. */}
          <input
            type="checkbox"
            checked={!!dither.blocks}
            onChange={(e) => setEffects({ dither: { ...dither, blocks: e.target.checked, ...(e.target.checked && !dither.keepLines ? { keepLines: 0.6 } : {}) } })}
          />
          Whole blocks
        </label>
      )}
      {dots === 'pixel' && (
        <label className="check-row" title="The pattern only where it blends two colours, and never into black; thin strips and areas that only just reach a colour stay solid. Off, it goes everywhere.">
          <input type="checkbox" checked={!!dither.blendOnly} onChange={(e) => setEffects({ dither: { ...dither, blendOnly: e.target.checked } })} />
          Only where it blends
        </label>
      )}
      {dots === 'pixel' && dither.blocks && (
        <Slider
          label="Keep detail"
          title="Blocks only where the photo is smooth, which is where the dither's pattern shows (sky, walls); a block with detail in it (an edge, leaves, a window) keeps its own pixels. Higher keeps more of the photo's detail; Off makes everything blocks."
          value={dither.keepLines ?? 0}
          def={0}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (v <= 0 ? 'Off' : `${Math.round(v * 100)}%`)}
          onChange={(keepLines) => setEffects({ dither: { ...dither, keepLines } })}
        />
      )}
      <div className="field valued">
        <span title="Random: a random stipple. Ordered: the classic retro checker pattern.">
          Pattern
        </span>
        <div className="segmented">
          <button
            className={blend.effects.dither.pattern === 'grain' ? 'on' : ''}
            onClick={() => setEffects({ dither: { ...blend.effects.dither, pattern: 'grain' } })}
          >
            Random
          </button>
          <button
            className={blend.effects.dither.pattern === 'ordered' ? 'on' : ''}
            onClick={() => setEffects({ dither: { ...blend.effects.dither, pattern: 'ordered' } })}
          >
            Ordered
          </button>
        </div>
      </div>
      {dither.pattern === 'grain' && (
        <label className="check-row" title="The dots taken from the grain, at its size, so changing the grain changes them too. Edits made before 26 Nov 2026 have it on.">
          <input type="checkbox" checked={!!dither.followGrain} onChange={(e) => setEffects({ dither: { ...dither, followGrain: e.target.checked } })} />
          Dots from the grain
        </label>
      )}
      <Disclosure id="dither-more" title="Fine-tune">
        <Slider
        label="Spread"
        title="How wide the stippled edge between two bands is"
        value={blend.effects.dither.spread} def={FACTORY.effects.dither.spread}
        min={0}
        max={2}
        step={0.01}
        onChange={(spread) => setEffects({ dither: { ...blend.effects.dither, spread } })}
      />
        <Slider
        label="Transitions only"
        title="Keep the pattern to where colours change. Over an area sitting flat between two bands the pattern is a uniform checker; this turns those into solid bands and leaves the pattern on the transitions."
        value={blend.effects.dither.transitionsOnly} def={FACTORY.effects.dither.transitionsOnly}
        min={0}
        max={1}
        step={0.01}
        onChange={(transitionsOnly) =>
          setEffects({ dither: { ...blend.effects.dither, transitionsOnly } })
        }
      />
        <Slider
        label="Spare pop colour"
        title="Leave the standout colour (Colour → Pop) smooth, so a subject like a red chair keeps its shading instead of breaking into bands"
        value={blend.effects.dither.sparePop} def={FACTORY.effects.dither.sparePop}
        min={0}
        max={1}
        step={0.01}
        onChange={(sparePop) => setEffects({ dither: { ...blend.effects.dither, sparePop } })}
      />
        <ToneGauge range={{ lo: blend.effects.dither.toneLo, hi: blend.effects.dither.toneHi, soft: 0.06, label: 'Dithered' }} />
        <Slider
        track={toneTrack(0, 1)}
        label="Darkest"
        title="Only dither tones at least this bright"
        touches={(lo) => ({ lo, hi: blend.effects.dither.toneHi, soft: 0.06, label: 'Dithered' })}
        value={blend.effects.dither.toneLo} def={FACTORY.effects.dither.toneLo}
        min={0}
        max={1}
        step={0.01}
        onChange={(toneLo) =>
          setEffects({
            dither: { ...blend.effects.dither, toneLo: Math.min(toneLo, blend.effects.dither.toneHi) },
          })
        }
      />
        <Slider
        track={toneTrack(0, 1)}
        label="Brightest"
        title="Only dither tones at most this bright"
        touches={(hi) => ({ lo: blend.effects.dither.toneLo, hi, soft: 0.06, label: 'Dithered' })}
        value={blend.effects.dither.toneHi} def={FACTORY.effects.dither.toneHi}
        min={0}
        max={1}
        step={0.01}
        onChange={(toneHi) =>
          setEffects({
            dither: { ...blend.effects.dither, toneHi: Math.max(toneHi, blend.effects.dither.toneLo) },
          })
        }
      />
      </Disclosure>
      <Disclosure
        id="band-guides"
        title="Band guides"
        summary={blend.effects.dither.guides.length ? `${blend.effects.dither.guides.length}` : 'No guides yet'}
        // On with a guide to use, or while the first is being placed (switching it on with none starts that).
        enabled={blend.effects.dither.guidesOn && (blend.effects.dither.guides.length > 0 || editingGuides)}
        onToggle={() => {
          const on = !(blend.effects.dither.guidesOn && (blend.effects.dither.guides.length > 0 || editingGuides))
          setEffects({ dither: { ...blend.effects.dither, guidesOn: on } })
          // On with none yet: straight to placing the first. Off: placing stops.
          if (!on) setEditingGuides(false)
          else if (!blend.effects.dither.guides.length && image) {
            setEditingGuides(true)
            setEditingBands(false)
          }
        }}
      >
        <div className="row">
          <button
            className={editingGuides ? 'on' : ''}
            disabled={!image}
            title="Steer the picture's own bands: click the photo to add a guide, drag it to move, drag its ring to resize"
            onClick={() => {
              setEditingGuides(!editingGuides)
              setEditingBands(false)
              setEditingLeaks(false)
            }}
          >
            Guide bands on photo
          </button>
        </div>
        <EditBox at="dither/guides" />
        {editingGuides && (
          <div className="field valued">
            <span>Click adds</span>
            <div className="segmented">
              <button
                className={guideSign === 1 ? 'on' : ''}
                title="Bands treat the area as brighter: rings move toward it"
                onClick={() => setGuideSign(1)}
              >
                Lift
              </button>
              <button
                className={guideSign === -1 ? 'on' : ''}
                title="Bands treat the area as darker: rings move away"
                onClick={() => setGuideSign(-1)}
              >
                Lower
              </button>
            </div>
          </div>
        )}
        <ItemList
          open={selectedGuide}
          onOpen={(i) => {
            setSelectedGuide(i)
            if (i === null) setEditingGuides(false)
          }}
          items={blend.effects.dither.guides.map((g, i) => ({
            key: String(i),
            name: `${g.strength >= 0 ? 'Lift' : 'Lower'} ${i + 1}`,
            label: `guide ${i + 1}`,
            editing: editingGuides && selectedGuide === i,
            onEdit: () => {
              const on = !(editingGuides && selectedGuide === i)
              setSelectedGuide(i)
              setEditingGuides(on && !!image)
            },
            onDuplicate: () => {
              const guides = blend.effects.dither.guides
              setEffects({ dither: { ...blend.effects.dither, guides: [...guides.slice(0, i + 1), structuredClone(guides[i]), ...guides.slice(i + 1)] } })
              setSelectedGuide(i + 1)
            },
            onRemove: () => {
              setEffects({ dither: { ...blend.effects.dither, guides: blend.effects.dither.guides.filter((_, j) => j !== i) } })
              setSelectedGuide(null)
            },
          }))}
        >
          {selectedGuide !== null && blend.effects.dither.guides[selectedGuide] && (
          <>
            <Slider
              label="Strength"
              title="Positive lifts, negative lowers"
              value={blend.effects.dither.guides[selectedGuide].strength}
              min={-1}
              max={1}
              step={0.01}
              format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`}
              onChange={(strength) =>
                setEffects({
                  dither: {
                    ...blend.effects.dither,
                    guides: blend.effects.dither.guides.map((g, i) =>
                      i === selectedGuide ? { ...g, strength } : g,
                    ),
                  },
                })
              }
            />
          </>
          )}
        </ItemList>
      </Disclosure>
      <Disclosure
        id="geometric-bands"
        title="Band shape"
        enabled={blend.effects.dither.follow > 0}
        onToggle={() => {
          const on = blend.effects.dither.follow > 0
          setEffects({ dither: { ...blend.effects.dither, follow: on ? 0 : 1 } })
          if (on) setEditingBands(false)
        }}
        summary={
          blend.effects.dither.follow > 0
            ? blend.effects.dither.shape === 'oval'
              ? 'Oval'
              : 'Line'
            : 'Off'
        }
      >
        <Slider
          label="Band by"
          title="0: the bands follow brightness and ring round bright areas. 100: they run straight along the line you set on the photo."
          value={blend.effects.dither.follow} def={FACTORY.effects.dither.follow}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}`}
          onChange={(follow) => setEffects({ dither: { ...blend.effects.dither, follow } })}
        />
        <div className="field valued">
          <span>Shape</span>
          <div className="segmented">
            <button
              className={blend.effects.dither.shape === 'line' ? 'on' : ''}
              title="Straight bands stepping from the start handle to the end"
              onClick={() => setEffects({ dither: { ...blend.effects.dither, shape: 'line' } })}
            >
              Line
            </button>
            <button
              className={blend.effects.dither.shape === 'oval' ? 'on' : ''}
              title="Rings centred on the start handle, reaching the end handle"
              onClick={() => setEffects({ dither: { ...blend.effects.dither, shape: 'oval' } })}
            >
              Oval
            </button>
          </div>
        </div>
        {blend.effects.dither.shape === 'oval' && (
          <Slider
            label="Stretch"
            title="How wide the rings are across, relative to how far they reach"
            value={blend.effects.dither.stretch} def={FACTORY.effects.dither.stretch}
            min={0.2}
            max={5}
            step={0.05}
            format={(v) => `${v.toFixed(1)}×`}
            onChange={(stretch) => setEffects({ dither: { ...blend.effects.dither, stretch } })}
          />
        )}
        <button
          className={editingBands ? 'on' : ''}
          disabled={!image}
          title="Drag the start handle where the banding begins and the end handle where it stops"
          onClick={() => {
            const next = !editingBands
            setEditingBands(next)
            setEditingGuides(false)
            if (next) {
              setEditingLeaks(false)
              // Setting a line only means something when the bands follow it.
              if (blend.effects.dither.follow < 0.5 || blend.effects.dither.amount <= 0)
                setEffects({
                  dither: {
                    ...blend.effects.dither,
                    follow: Math.max(blend.effects.dither.follow, 1),
                    amount: blend.effects.dither.amount || 0.5,
                  },
                })
            }
          }}
        >
          Set bands on photo
        </button>
        <EditBox at="dither/bands" />
      </Disclosure>
    </Module>
  )
}
