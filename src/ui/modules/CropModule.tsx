import { CROP_ASPECTS, cropActive, type CropParams, cropRect } from '../../engine/crop'
import type { BlendParams } from '../../engine/types'
import { Module, ModuleActions, Slider } from '../controls'
import type { LoadedImage } from '../loadedImage'
import { moduleSummary } from '../moduleSummary'

interface Props {
  blend: BlendParams
  cropTo: (aspect: CropParams['aspect'], turned?: boolean, step?: string) => void
  /** Turn the photo under the crop (CropParams.angle). */
  onAngle: (angle: number) => void
  /** Turn the photo a quarter, the crop's frame with it (CropParams.quarter). */
  onQuarter: (by: 1 | -1) => void
  editingCrop: boolean
  image: LoadedImage | null
  setEditingCrop: (on: boolean) => void
}

/** Crop: to an aspect ratio, set on the photo, and straightened (turned). */
export function CropModule({ blend, cropTo, onAngle, onQuarter, editingCrop, image, setEditingCrop }: Props) {
  return (
    <Module
      id="crop"
      title="Crop"
      summary={moduleSummary('crop', blend)}
    >
      <div className="chips crop-aspects">
        {CROP_ASPECTS.map((a) => (
          <button key={a.id} className={blend.effects.crop.aspect === a.id ? 'on' : ''} onClick={() => cropTo(a.id)}>
            {a.id !== 'free' && a.id !== 'original' && blend.effects.crop.aspect === a.id && blend.effects.crop.turned ? a.label.split(':').reverse().join(':') : a.label}
          </button>
        ))}
        <button
          className="icon-text"
          disabled={blend.effects.crop.aspect === 'free' || blend.effects.crop.aspect === '1:1'}
          title="Swap the aspect ratio: landscape to portrait, or back"
          onClick={() => cropTo(blend.effects.crop.aspect, !blend.effects.crop.turned)}
        >
          ⇄ Swap
        </button>
      </div>
      <div className="row crop-turns">
        <button disabled={!image} title="Turn the photo a quarter to the left: a landscape photo stands up" onClick={() => onQuarter(-1)}>
          ↺ Turn left
        </button>
        <button disabled={!image} title="Turn the photo a quarter to the right: a landscape photo stands up" onClick={() => onQuarter(1)}>
          ↻ Turn right
        </button>
      </div>
      <Slider
        label="Straighten"
        title="Turn the photo under the crop to straighten it; the crop keeps inside the turned photo. Or drag outside the crop on the photo."
        value={blend.effects.crop.angle ?? 0}
        def={0}
        min={-45}
        max={45}
        step={0.1}
        format={(v) => (Math.abs(v) < 0.05 ? 'Straight' : `${v > 0 ? '+' : ''}${v.toFixed(1)}°`)}
        onChange={onAngle}
      />
      <ModuleActions>
        <button
          data-crop-done
          className={editingCrop ? 'on' : ''}
          disabled={!image}
          title={editingCrop ? 'Show the cropped picture (Enter)' : 'Show the whole photo with the crop on it'}
          onClick={() => setEditingCrop(!editingCrop)}
        >
          {editingCrop ? 'Done' : 'Set crop on photo'}
        </button>
      </ModuleActions>
      {image && cropActive(blend.effects.crop) && (
        <p className="hint-line">
          {(() => {
            const r = cropRect(image.size, blend.effects.crop)
            return `${r.width} × ${r.height} of ${image.size.width} × ${image.size.height}`
          })()}
        </p>
      )}
    </Module>
  )
}
