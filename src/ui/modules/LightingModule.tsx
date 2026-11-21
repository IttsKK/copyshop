import type { Dispatch, SetStateAction } from 'react'
import { DEFAULT_LIGHT, type LightingParams, type LightShape } from '../../engine/lighting'
import { maskKind } from '../../engine/maskShapes'
import type { Palette } from '../../engine/palette'
import { type BlendParams, LEAK_COLOURS, type MaskShape } from '../../engine/types'
import { newId } from '../../storage/db'
import { ColourField } from '../ColourField'
import { LightingPanel } from '../LightingPanel'
import { Module } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import type { LoadedImage } from '../loadedImage'
import { moduleSummary } from '../moduleSummary'
import { SAMPLE_FOR } from './shared'

interface Props {
  blend: BlendParams
  lighting: LightingParams
  image: LoadedImage | null
  lightDrawing: boolean
  setLightDrawing: Dispatch<SetStateAction<boolean>>
  setLightEditing: Dispatch<SetStateAction<boolean>>
  lightEditing: boolean
  setEditingLeaks: Dispatch<SetStateAction<boolean>>
  setEditingStreaks: Dispatch<SetStateAction<boolean>>
  setMaskEditing: Dispatch<SetStateAction<boolean>>
  selectedLight: number | null
  setSelectedLight: Dispatch<SetStateAction<number | null>>
  setLight: (i: number, patch: Partial<LightShape>, step: string) => void
  history: EditHistory
  setLighting: (patch: Partial<LightingParams>, step?: string | null) => void
  listedMasks: MaskShape[]
  palette: Palette
}

/** Lighting: light drawn onto parts of the photo, in any colour. */
export function LightingModule({ blend, lighting, image, lightDrawing, setLightDrawing, setLightEditing, lightEditing, setEditingLeaks, setEditingStreaks, setMaskEditing, selectedLight, setSelectedLight, setLight, history, setLighting, listedMasks, palette }: Props) {
  return (
    <Module
      id="lighting"
      title="Lighting"
      summary={moduleSummary('lighting', blend)}
    >
      <LightingPanel
        lighting={lighting}
        hasImage={!!image}
        drawing={lightDrawing}
        onDraw={() => {
          setLightDrawing(!lightDrawing)
          setLightEditing(!lightDrawing ? true : lightEditing)
          setEditingLeaks(false)
          setEditingStreaks(false)
          setMaskEditing(false)
        }}
        editing={lightEditing}
        onEdit={() => {
          setLightEditing(!lightEditing)
          setLightDrawing(false)
          setEditingLeaks(false)
        }}
        selected={selectedLight}
        onSelect={setSelectedLight}
        onChange={setLight}
        onDuplicate={(i) => {
          const l = lighting.lights[i]
          let n = 1
          while (lighting.lights.some((x) => x.name === `Light ${n}`)) n++
          history.hint(`${WHOLE_STEP}copying ${l.name.toLowerCase()}`)
          setLighting({ lights: [...lighting.lights.slice(0, i + 1), { ...structuredClone(l), id: newId('light'), name: `Light ${n}` }, ...lighting.lights.slice(i + 1)] })
          setSelectedLight(i + 1)
        }}
        onRemove={(i) => {
          // Its edit on the photo is over, kept as it is: left open with nothing to show,
          // the next light edited would carry on in it, and its Cancel would bring this one back.
          setLightEditing(false)
          history.hint(`${WHOLE_STEP}removing a light`)
          setLighting({ lights: lighting.lights.filter((_, j) => j !== i) })
          setSelectedLight(null)
        }}
        masks={listedMasks}
        onAddGlow={() => {
          // Round the newest subject: most often the building, the tree, the person.
          const round = [...listedMasks].reverse().find((m) => maskKind(m) === 'subject') ?? listedMasks[listedMasks.length - 1]
          if (!round) return
          let n = 1
          while (lighting.lights.some((l) => l.name === `Glow ${n}`)) n++
          history.hint(`${WHOLE_STEP}a glow`)
          setLighting({ enabled: true, lights: [...lighting.lights, { ...DEFAULT_LIGHT, id: newId('light'), name: `Glow ${n}`, outline: [], mask: round.id, glow: 0.06, strength: 0.6 }] })
          setSelectedLight(lighting.lights.length)
          setLightDrawing(false)
          setLightEditing(false)
        }}
        colourField={(value, onChange) => (
          <ColourField label="Colour" value={value} palette={palette} swatches={LEAK_COLOURS} onChange={onChange} sampleWithout={SAMPLE_FOR.leaks} />
        )}
      />
    </Module>
  )
}
