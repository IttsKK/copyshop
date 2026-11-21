import type { Dispatch, RefObject, SetStateAction } from 'react'
import { DOUBLE_MODES } from '../../engine/extras'
import type { BlendParams, EffectParams } from '../../engine/types'
import { imageAccept } from '../../pipeline/formats'
import { addCollageImage, type CollageImage } from '../../storage/collageImages'
import { Disclosure, Module, Slider } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'

interface Props {
  second: CollageImage | null
  secondInput: RefObject<HTMLInputElement>
  image: LoadedImage | null
  history: EditHistory
  setExtra: <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) => void
  setError: Dispatch<SetStateAction<string | null>>
  blend: BlendParams
}

/** Double exposure: a second photo blended over this one. */
export function DoubleModule({ second, secondInput, image, history, setExtra, setError, blend }: Props) {
  return (
    <Module
      id="double"
      title="Double exposure"
      summary={second?.name}
    >
      <input
        ref={secondInput}
        type="file"
        accept={imageAccept()}
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f || !image) return
          try {
            const img = await addCollageImage(f, f.name, image.seed)
            history.hint(`${WHOLE_STEP}a second exposure`)
            setExtra('double', { image: img.id, enabled: true })
          } catch (err) {
            setError(`Could not add ${f.name}: ${(err as Error).message}`)
          }
        }}
      />
      {second ? (
        <div className="double-pick">
          <img src={second.thumb} alt="" />
          <span>{second.name}</span>
          <button onClick={() => secondInput.current?.click()}>Change…</button>
        </div>
      ) : (
        <button disabled={!image} onClick={() => secondInput.current?.click()} title="Pick the photo to expose onto this one">
          Choose the second photo…
        </button>
      )}
      <div className="segmented">
        {DOUBLE_MODES.map((m) => (
          <button key={m.id} title={m.hint} className={blend.effects.double.mode === m.id ? 'on' : ''} onClick={() => setExtra('double', { mode: m.id })}>
            {m.label}
          </button>
        ))}
      </div>
      <Slider label="Amount" title="How strong the second exposure is" value={blend.effects.double.amount} def={FACTORY.effects.double.amount} min={0} max={1} step={0.01} onChange={(amount) => setExtra('double', { amount })} />
      <Slider label="Colour" title="Its own colours, or only its light" value={1 - blend.effects.double.mono} def={1 - FACTORY.effects.double.mono} min={0} max={1} step={0.01} onChange={(v) => setExtra('double', { mono: 1 - v })} />
      <Disclosure id="double-place" title="Placing">
        <Slider label="Size" title="1 fills the frame; larger zooms in" value={blend.effects.double.scale} def={FACTORY.effects.double.scale} min={1} max={4} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(scale) => setExtra('double', { scale })} />
        <Slider label="Across" value={blend.effects.double.x} def={FACTORY.effects.double.x} min={0} max={1} step={0.005} onChange={(x) => setExtra('double', { x })} />
        <Slider label="Down" value={blend.effects.double.y} def={FACTORY.effects.double.y} min={0} max={1} step={0.005} onChange={(y) => setExtra('double', { y })} />
        <label className="check-row">
          <input type="checkbox" checked={blend.effects.double.flip} onChange={(e) => setExtra('double', { flip: e.target.checked })} />
          Mirror it
        </label>
      </Disclosure>
    </Module>
  )
}
