import type { Dispatch, SetStateAction } from 'react'
import { AngleDial } from '../AngleDial'
import { BLEND_MODES } from '../../engine/blendModes'
import type { GrainCurve } from '../../engine/curve'
import type { BlendMode, BlendParams, PlateNormalise, PlateSampling, ResponseMode, TilingMode } from '../../engine/types'
import type { GrainSource, GrainTexture } from '../../sources/GrainSource'
import type { ProceduralGrainParams } from '../../sources/generateGrain'
import { CurveEditor } from '../CurveEditor'
import { GrainLoupe } from '../GrainLoupe'
import { type GrainGenerator, GrainSourcePanel, GrainTile, MAX_GRAIN_SIZE } from '../GrainSourcePanel'
import { Disclosure, Module, Slider } from '../controls'
import type { LoadedImage } from '../loadedImage'
import type { MaskView } from '../maskKey'
import { FACTORY } from '../moduleCatalog'

/** Grain Scale, 0.25× to 4×, spread evenly by doubling along a track or pad. */
const scaleToPad = (v: number) => Math.min(1, Math.max(0, (Math.log2(v) + 2) / 4))
const padToScale = (p: number) => Math.round(2 ** (p * 4 - 2) * 100) / 100

const NORMALISE: { id: PlateNormalise; label: string }[] = [
  { id: 'centre', label: 'Centre on mid-grey' },
  { id: 'match', label: 'Centre + match contrast' },
  { id: 'off', label: 'Use raw values' },
]

const TILINGS: { id: TilingMode; label: string }[] = [
  { id: 'stochastic', label: 'Stochastic (seamless)' },
  { id: 'mirror', label: 'Mirrored' },
  { id: 'repeat', label: 'Repeat' },
]

interface Props {
  generator: GrainGenerator
  image: LoadedImage | null
  grain: GrainTexture | null
  layer: { showMask?: { id: string; view: MaskView } | undefined; grain: GrainTexture; params: BlendParams } | null
  setError: Dispatch<SetStateAction<string | null>>
  blend: BlendParams
  setBlend: (next: SetStateAction<BlendParams>) => void
  setGen: (patch: Partial<ProceduralGrainParams>) => void
  histogram: number[] | null
  layoutVersion: number
  source: GrainSource | null
  setSource: Dispatch<SetStateAction<GrainSource | null>>
}

/** Grain: generated or from a scanned plate, its size, strength and how it sits on the photo. */
export function GrainModule({ generator, image, grain, layer, setError, blend, setBlend, setGen, histogram, layoutVersion, source, setSource }: Props) {
  return (
    <Module
      id="grain"
      title="Grain"
      summary={generator.mode === 'plate' ? 'Scanned plate' : undefined}
    >
      {image && grain && layer ? (
        <GrainLoupe
          base={image.bitmap}
          baseSize={image.size}
          imageSeed={image.seed}
          grain={grain}
          params={layer.params}
          onError={setError}
        />
      ) : (
        <GrainTile texture={grain} />
      )}
      <Slider
        label="Strength"
        title="How hard the grain is printed in"
        value={blend.amount} def={FACTORY.amount}
        min={0}
        max={1}
        step={0.005}
        toSlider={Math.sqrt}
        fromSlider={(s) => s * s}
        format={(v) => `${Math.round(Math.sqrt(v) * 100)}`}
        onChange={(amount) => setBlend({ ...blend, amount })}
      />
      {generator.mode === 'generate' ? (
        <>
          <Slider
            label="Size"
            title="Clump size in plate pixels"
            value={generator.params.grainSize}
            min={0}
            max={1}
            step={0.005}
            toSlider={(v) => Math.sqrt(v / MAX_GRAIN_SIZE)}
            fromSlider={(s) => Number((s * s * MAX_GRAIN_SIZE).toFixed(2))}
            format={(v) => (v < 0.05 ? 'fine' : v.toFixed(2))}
            onChange={(grainSize) => setGen({ grainSize })}
          />
          <Slider
            label="Roughness"
            title="Coarse mottling laid over the fine grain: from a clean, even screen to a rough, blotchy one"
            value={generator.params.roughness}
            min={0}
            max={1}
            step={0.01}
            onChange={(roughness) => setGen({ roughness })}
          />
          <Slider
            label="Colour"
            title="0 = monochrome grain; higher gives each dye layer its own grain"
            value={generator.params.chroma}
            min={0}
            max={1}
            step={0.01}
            onChange={(chroma) => setGen({ chroma })}
          />
        </>
      ) : (
        <>
          <Slider
        label="Scale"
        title="Stretches the whole grain pattern bigger or smaller. Size grows the grains themselves and keeps them sharper; Scale enlarges them softer."
        value={blend.grainScale} def={FACTORY.grainScale}
        min={0}
        max={1}
        step={0.0025}
        toSlider={scaleToPad}
        fromSlider={padToScale}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(grainScale) => setBlend({ ...blend, grainScale })}
      />
          <Slider
            label="Colour"
            title="0 = monochrome grain, 100 = the plate's own colour"
            value={blend.chroma} def={FACTORY.chroma}
            min={0}
            max={1}
            step={0.01}
            onChange={(chroma) => setBlend({ ...blend, chroma })}
          />
        </>
      )}
      <Disclosure id="grain-more" title="Fine-tune">
        {generator.mode === 'generate' && (
          <>
            <Slider
        label="Scale"
        title="Stretches the whole grain pattern bigger or smaller. Size grows the grains themselves and keeps them sharper; Scale enlarges them softer."
        value={blend.grainScale} def={FACTORY.grainScale}
        min={0}
        max={1}
        step={0.0025}
        toSlider={scaleToPad}
        fromSlider={padToScale}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(grainScale) => setBlend({ ...blend, grainScale })}
      />
            <Slider
            label="Clumps"
            title="Sparse larger grains riding on the fine ones: a coarser, lumpier texture"
            value={generator.params.clumps}
            min={0}
            max={1}
            step={0.01}
            onChange={(clumps) => setGen({ clumps })}
          />
            <Slider
            label="Hardness"
            title="How crisp each grain's edge is: soft clouds at 0, hard-edged specks up high. Raise it with Size or Scale so bigger grain stays sharp."
            value={generator.params.hardness}
            min={0}
            max={1}
            step={0.01}
            onChange={(hardness) => setGen({ hardness })}
          />
            <Slider
            label="Definition"
            title="Keeps bigger grain crisp: each grain keeps a clean edge as Size grows, instead of turning to soft mush. Raise it with Size and Strength."
            value={generator.params.definition ?? 0}
            min={0}
            max={1}
            step={0.01}
            onChange={(definition) => setGen({ definition })}
          />
            <Slider
            label="Unevenness"
            title="Slow variation in how dense and strong the grain is across the picture. Identical everywhere is what reads as digital; too much reads as blotches on a smooth sky."
            value={generator.params.unevenness}
            min={0}
            max={1}
            step={0.01}
            onChange={(unevenness) => setGen({ unevenness })}
          />
          </>
        )}
        <Slider
          label="Softness"
          title="Softens the grain as if slightly out of focus"
          value={blend.softness} def={FACTORY.softness}
          min={0}
          max={1}
          step={0.01}
          onChange={(softness) => setBlend({ ...blend, softness })}
        />
        <AngleDial
          look="turn"
          label="Rotation"
          title="Turn the grain pattern"
          value={blend.grainRotation}
          def={FACTORY.grainRotation}
          min={-180}
          max={180}
          zero={0}
          onChange={(grainRotation) => setBlend({ ...blend, grainRotation })}
        />
        <Slider
        label="Follows colour"
        title="Grain gathers where the colour is — where the recipe changed it, and where it is rich — and goes quiet over neutral, untouched areas"
        value={blend.grainFollowsColour} def={FACTORY.grainFollowsColour}
        min={0}
        max={1}
        step={0.01}
        onChange={(grainFollowsColour) => setBlend({ ...blend, grainFollowsColour })}
      />
      </Disclosure>
      <Disclosure
        id="grain-response"
        title="Grain by brightness"
        summary={blend.responseMode === 'channel' ? 'By brightness, per colour' : 'By brightness'}
      >
        <label className="field">
          <span title="What the curve is read against">Read against</span>
          <select
            value={blend.responseMode}
            onChange={(e) =>
              setBlend({
                ...blend,
                responseMode: e.target.value as ResponseMode,
              })
            }
          >
            <option value="channel">Each colour channel</option>
            <option value="luminance">Overall brightness</option>
          </select>
        </label>
        {blend.responseMode === 'channel' && (
          <Slider
            label="Layer spread"
            title="How far apart the three dye layers respond"
            value={blend.layerSpread} def={FACTORY.layerSpread}
            min={0}
            max={1}
            step={0.01}
            onChange={(layerSpread) => setBlend({ ...blend, layerSpread })}
          />
        )}
        <p className="muted status-line">
          {blend.responseMode === 'channel'
            ? 'Grain follows the picture’s colour, the way three dye layers do.'
            : 'One curve for all channels — grain reads as a layer on top.'}
        </p>
        <CurveEditor
          curve={blend.response}
          histogram={histogram}
          layoutVersion={layoutVersion}
          blendMode={blend.blendMode}
          colorSpace={blend.colorSpace}
          onChange={(response: GrainCurve) => setBlend({ ...blend, response })}
        />
      </Disclosure>
      <Disclosure
        id="grain-blend"
        title="Grain source and blend mode"
        summary={`${generator.mode === 'plate' ? 'Plate' : 'Generated'} · ${BLEND_MODES.find((m) => m.id === blend.blendMode)?.label ?? ''}`}
      >
        <GrainSourcePanel
          source={source}
          onSourceChange={setSource}
          onError={setError}
          generator={generator}
        />
        <label className="field">
          <span>Mode</span>
          <select
            value={blend.blendMode}
            onChange={(e) =>
              setBlend({
                ...blend,
                blendMode: e.target.value as BlendMode,
              })
            }
          >
            {BLEND_MODES.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Space</span>
          <select
            value={blend.colorSpace}
            onChange={(e) =>
              setBlend({
                ...blend,
                colorSpace: e.target.value as BlendParams['colorSpace'],
              })
            }
          >
            <option value="linear">Linear light</option>
            <option value="srgb">sRGB (Photoshop-style)</option>
          </select>
        </label>
        <label className="field">
          <span>Tiling</span>
          <select
            value={blend.tiling}
            onChange={(e) =>
              setBlend({
                ...blend,
                tiling: e.target.value as TilingMode,
              })
            }
          >
            {TILINGS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {generator.mode === 'plate' && (
          <>
            <label className="field">
              <span title="Scanned plates are rarely centred on mid-grey, and every blend mode here is neutral there">
                Levels
              </span>
              <select
                value={blend.plateNormalise}
                onChange={(e) =>
                  setBlend({
                    ...blend,
                    plateNormalise: e.target.value as PlateNormalise,
                  })
                }
              >
                {NORMALISE.map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span title="Crisp reads whole plate texels, so changing scale changes grain size without changing its strength">
                Sampling
              </span>
              <select
                value={blend.plateSampling}
                onChange={(e) =>
                  setBlend({
                    ...blend,
                    plateSampling: e.target.value as PlateSampling,
                  })
                }
              >
                <option value="crisp">Crisp (keeps contrast)</option>
                <option value="smooth">Smooth (interpolated)</option>
              </select>
            </label>
            <Slider
              label="Flatten"
              title="Removes the plate's own uneven density, which otherwise tiles as blotches"
              value={blend.plateFlatten} def={FACTORY.plateFlatten}
              min={0}
              max={1}
              step={0.01}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(plateFlatten) => setBlend({ ...blend, plateFlatten })}
            />
            {grain && (
              <p className="muted status-line">
                Plate averages {Math.round((grain.mean ?? 0.5) * 255)} of 255
                {blend.plateNormalise === 'off' && (grain.mean ?? 0.5) < 0.45
                  ? ' — will darken the picture'
                  : ''}
              </p>
            )}
          </>
        )}
      </Disclosure>
    </Module>
  )
}
