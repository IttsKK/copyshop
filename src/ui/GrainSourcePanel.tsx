import { useCallback, useEffect, useRef, useState } from 'react'
import type { GrainSource, GrainTexture } from '../sources/GrainSource'
import { PlateSource, deletePlate, importPlateFile, listPlates } from '../sources/PlateSource'
import { imageAccept } from '../pipeline/formats'
import { PROCEDURAL_KIND, ProceduralSource, createProceduralSource } from '../sources/ProceduralSource'
import type { ProceduralGrainParams } from '../sources/generateGrain'
import { DEFAULT_PROCEDURAL_PARAMS, GRAIN_PRESETS } from '../sources/generateGrain'
import { Slider } from './controls'
import { confirmWith } from '../platform/native'

export type SourceMode = 'plate' | 'generate'

export interface GrainGenerator {
  mode: SourceMode
  setMode: (mode: SourceMode) => void
  params: ProceduralGrainParams
  setParams: (params: ProceduralGrainParams) => void
  generating: boolean
}

interface Props {
  source: GrainSource | null
  onSourceChange: (source: GrainSource) => void
  onError: (message: string) => void
  generator: GrainGenerator
}

const PLATE_SIZES = [512, 1024, 2048]
export const MAX_GRAIN_SIZE = 6

/** Shows the grain itself at 1:1, which is the only honest way to judge it. */
export function GrainTile({ texture }: { texture: GrainTexture | null }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !texture) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const src = texture.source
    if (src instanceof ImageData) {
      // Draw a 1:1 crop of the top-left corner.
      const tmp = document.createElement('canvas')
      tmp.width = src.width
      tmp.height = src.height
      tmp.getContext('2d')!.putImageData(src, 0, 0)
      ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    } else {
      ctx.drawImage(src as CanvasImageSource, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    }
  }, [texture])
  return <canvas className="grain-tile" ref={ref} width={248} height={72} />
}

/**
 * Generator state, lifted out of the panel so the main Grain controls (size,
 * character, colour) and the advanced ones edit the same parameters.
 */
export function useGrainGenerator(
  source: GrainSource | null,
  onSourceChange: (source: GrainSource) => void,
): GrainGenerator {
  const isProcedural = source?.kind === PROCEDURAL_KIND
  const [mode, setModeState] = useState<SourceMode>(isProcedural || !source ? 'generate' : 'plate')
  const [params, setShown] = useState<ProceduralGrainParams>(
    isProcedural ? (source as ProceduralSource).params : DEFAULT_PROCEDURAL_PARAMS,
  )
  // Only edits made here regenerate. Comparing the shown parameters with the
  // source's instead raced a look loading at startup: a debounce armed with
  // the defaults could fire after the look arrived and replace its grain.
  const [pending, setPending] = useState<ProceduralGrainParams | null>(null)
  const [generating, setGenerating] = useState(false)
  const ours = useRef<GrainSource | null>(null)
  const latest = useRef(params)
  latest.current = params

  const setParams = useCallback((next: ProceduralGrainParams) => {
    setShown(next)
    setPending(next)
  }, [])

  // Follow the source when a look, preset or snapshot loads one, so the
  // controls show what is actually rendering. A source we did not make also
  // cancels any edit still waiting to regenerate.
  useEffect(() => {
    if (source !== ours.current) setPending(null)
    if (source?.kind === PROCEDURAL_KIND) {
      setModeState('generate')
      setShown((source as ProceduralSource).params)
    } else if (source) {
      setModeState('plate')
    }
  }, [source])

  // Debounced regeneration: synthesis is CPU work, so dragging a slider must
  // not queue a plate per frame.
  useEffect(() => {
    if (!pending || mode !== 'generate') return
    setGenerating(true)
    const timer = setTimeout(() => {
      const next = createProceduralSource(pending)
      ours.current = next
      setPending(null)
      onSourceChange(next)
    }, 160)
    return () => {
      clearTimeout(timer)
      setGenerating(false)
    }
  }, [pending, mode, onSourceChange])

  const setMode = useCallback(
    (next: SourceMode) => {
      setModeState(next)
      if (next === 'generate' && source?.kind !== PROCEDURAL_KIND) {
        const created = createProceduralSource(params)
        ours.current = created
        onSourceChange(created)
      }
    },
    [onSourceChange, params, source],
  )

  return { mode, setMode, params, setParams, generating }
}

/** Where the grain comes from, and the generator controls most looks leave alone. */
export function GrainSourcePanel({ source, onSourceChange, onError, generator }: Props) {
  const { mode, setMode, params, setParams, generating } = generator
  const [plates, setPlates] = useState<PlateSource[]>([])
  const plateInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    listPlates().then(setPlates)
  }, [])

  const addPlates = async (files: FileList | null) => {
    if (!files?.length) return
    let last: PlateSource | null = null
    for (const file of Array.from(files)) {
      try {
        last = await importPlateFile(file, file.name.replace(/\.[^.]+$/, ''), file.name)
      } catch {
        onError(`Could not read grain plate ${file.name}.`)
      }
    }
    setPlates(await listPlates())
    if (last) onSourceChange(last)
  }

  const removePlate = async (plate: PlateSource) => {
    // Edits that use it go back to the generated grain, so it is asked first.
    if (!(await confirmWith(`Remove the grain plate “${plate.name}”? Photos and recipes that use it go back to the generated grain.`))) return
    await deletePlate(plate.id)
    const list = await listPlates()
    setPlates(list)
    if (source?.id === plate.id && list[0]) onSourceChange(list[0])
  }

  const slider = (
    label: string,
    key: keyof ProceduralGrainParams,
    min: number,
    max: number,
    step: number,
    format: (v: number) => string,
    title?: string,
  ) => (
    <Slider
      key={label}
      label={label}
      title={title}
      value={params[key] as number}
      min={min}
      max={max}
      step={step}
      format={format}
      onChange={(v) => setParams({ ...params, [key]: v })}
    />
  )

  return (
    <>
      <div className="segmented full">
        <button className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>
          Generated
        </button>
        <button className={mode === 'plate' ? 'on' : ''} onClick={() => setMode('plate')}>
          Scanned plate
        </button>
      </div>

      {mode === 'plate' ? (
        <>
          <div className="plate-list">
            {plates.length === 0 && <p className="muted">No plates yet. Import a scan, or generate grain instead.</p>}
            {plates.map((plate) => (
              <div key={plate.id} className={source?.id === plate.id ? 'plate on' : 'plate'}>
                <button className="plate-name" onClick={() => onSourceChange(plate)}>
                  {plate.name}
                </button>
                <button className="icon" title="Remove plate" onClick={() => removePlate(plate)}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <button onClick={() => plateInput.current?.click()}>Import plate…</button>
          <input
            ref={plateInput}
            type="file"
            accept={imageAccept()}
            multiple
            hidden
            onChange={(e) => addPlates(e.target.files)}
          />
        </>
      ) : (
        <>
          <div className="chips">
            {GRAIN_PRESETS.map((preset) => {
              const active = (Object.keys(preset.params) as (keyof typeof preset.params)[]).every(
                (k) => params[k] === preset.params[k],
              )
              return (
                <button
                  key={preset.name}
                  className={active ? 'on' : ''}
                  title={preset.hint}
                  onClick={() => setParams({ ...params, ...preset.params })}
                >
                  {preset.name}
                </button>
              )
            })}
          </div>
          {slider('Contrast', 'contrast', 0, 1, 0.01, (v) => `${Math.round(v * 100)}`)}
          <label className="field">
            <span>Plate size</span>
            <select value={params.size} onChange={(e) => setParams({ ...params, size: Number(e.target.value) })}>
              {PLATE_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}px
                </option>
              ))}
            </select>
          </label>
          <div className="field valued">
            <span>Seed</span>
            <button onClick={() => setParams({ ...params, seed: Math.floor(Math.random() * 2 ** 31) })}>
              Shuffle
            </button>
            <output className="seed">{params.seed % 100000}</output>
          </div>
          <p className="muted status-line">{generating ? 'Synthesising…' : `${params.size}px plate, tiles seamlessly`}</p>
        </>
      )}
    </>
  )
}
