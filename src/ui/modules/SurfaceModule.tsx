import { useEffect, useRef, useState } from 'react'
import { DEFAULT_SURFACE, SURFACE_KINDS, type SurfaceParams } from '../../engine/surface'
import type { BlendParams } from '../../engine/types'
import { importSurfaceTexture, listSurfaceTextures } from '../../sources/surfaceTextures'
import { imageAccept } from '../../pipeline/formats'
import { AngleDial } from '../AngleDial'
import { Disclosure, Module, ModuleActions, Shuffle, Slider } from '../controls'

interface Props {
  blend: BlendParams
  setSurface: (patch: Partial<SurfaceParams>) => void
  /** Something to say in the status line (an image that couldn't be read). */
  say: (text: string) => void
}

/** Surface: what the print is on, over all of it. */
export function SurfaceModule({ blend, setSurface, say }: Props) {
  const s = blend.effects.surface ?? DEFAULT_SURFACE
  const d = DEFAULT_SURFACE
  const file = useRef<HTMLInputElement>(null)
  // The images kept for Surface, to pick again.
  const [kept, setKept] = useState<{ id: string; name: string }[]>([])
  useEffect(() => {
    if (s.kind === 'image') void listSurfaceTextures().then(setKept)
  }, [s.kind, s.image])
  const choose = async (f: File | undefined) => {
    if (!f) return
    try {
      const { id, name } = await importSurfaceTexture(f)
      setSurface({ kind: 'image', image: id, imageName: name })
    } catch {
      say(`Couldn't read ${f.name} as an image`)
    }
  }
  return (
    <Module id="surface" title="Surface" summary={s.kind === 'image' ? (s.imageName ?? 'Image') : SURFACE_KINDS.find((k) => k.id === s.kind)?.label}>
      <div className="segmented surface-kinds">
        {SURFACE_KINDS.map((k) => (
          <button
            key={k.id}
            title={k.hint}
            className={`${s.kind === k.id ? 'on' : ''}${k.id === 'image' ? ' wide' : ''}`}
            // Image with none chosen yet asks for one.
            onClick={() => (k.id === 'image' && !s.image ? file.current?.click() : setSurface({ kind: k.id }))}
          >
            {k.id === 'image' ? 'Your image…' : k.label}
          </button>
        ))}
      </div>
      <input ref={file} type="file" accept={imageAccept()} hidden onChange={(e) => {
        void choose(e.target.files?.[0])
        e.target.value = ''
      }} />
      {s.kind === 'image' && (
        <div className="field">
          <span>Image</span>
          <select
            value={s.image ?? ''}
            title="An image kept for Surface"
            onChange={(e) => {
              if (e.target.value === '+') return file.current?.click()
              const k = kept.find((x) => x.id === e.target.value)
              if (k) setSurface({ image: k.id, imageName: k.name })
            }}
          >
            {!kept.some((k) => k.id === s.image) && s.image && <option value={s.image}>{s.imageName ?? 'Image'}</option>}
            {kept.map((k) => (
              <option key={k.id} value={k.id}>
                {k.name}
              </option>
            ))}
            <option value="+">Choose another…</option>
          </select>
        </div>
      )}
      <Slider label="Strength" value={s.amount} def={d.amount} min={0} max={1} step={0.01} onChange={(amount) => setSurface({ amount })} />
      <Slider
        label="Size"
        title="How big the surface's features are"
        value={s.scale}
        def={d.scale}
        // On the track in doublings, even either side of 1: a quarter to four times.
        min={-2}
        max={2}
        step={0.01}
        toSlider={(v) => Math.log2(v)}
        fromSlider={(v) => 2 ** v}
        format={(v) => `${v.toFixed(2)}×`}
        onChange={(scale) => setSurface({ scale })}
      />
      <Slider label="Relief" title="Flat light and dark, or lit as a raised surface" value={s.relief} def={d.relief} min={0} max={1} step={0.01} onChange={(relief) => setSurface({ relief })} />
      {s.kind === 'image' && (
        <Slider label="Colour" title="The image's own colour on the print, or its light and dark only" value={s.colour} def={d.colour} min={0} max={1} step={0.01} onChange={(colour) => setSurface({ colour })} />
      )}
      <Disclosure id="surface-more" title="Fine-tune">
        <AngleDial look="from" label="Light from" title="Where the light that shows the relief comes from" value={s.light} def={d.light} min={0} max={360} zero={0} onChange={(light) => setSurface({ light })} />
        <AngleDial look="axis" label="Turn" title="Turns the surface" value={s.turn} def={d.turn} min={-90} max={90} zero={0} onChange={(turn) => setSurface({ turn })} />
      </Disclosure>
      {s.kind !== 'image' && (
        <ModuleActions>
          <Shuffle what="surface" onShuffle={() => setSurface({ seed: Math.floor(Math.random() * 99991) })} />
        </ModuleActions>
      )}
    </Module>
  )
}
