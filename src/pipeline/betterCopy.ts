/**
 * An edit moved onto a better copy of its photo (larger, less compressed,
 * the RAW): App's Replace photo, and the library finding a new version of
 * an edited photo (darktable writing over it). The old photo is found in
 * the new one (engine/alignPhoto.ts); every placed thing is moved onto it
 * and, for a crop of it, the crop set to where the old photo was; what is
 * sized in pixels and what varies per photo are kept as they were
 * (BlendParams.pixelScale, photoSeed). Everything else is as it was.
 */
import { locatePhoto, type Gray, type Located } from '../engine/alignPhoto'
import { DEFAULT_CROP, cropActive, cropAngle, cropFrameSize, keepInside, type CropParams } from '../engine/crop'
import type { BlendParams, Size } from '../engine/types'
import { shapesOnCrop } from './instagram'

export interface MovedEdit {
  blend: BlendParams
  found: Located
  /** How much of the old photo the new one does not show at its edges (0..1 of its side): the crop keeps to the new photo. */
  lost: number
}

/**
 * `blend`, the edit on the old photo (its full size `oldSize`, its seed
 * `oldSeed`, `old` a grey copy of it at any size), moved onto the new photo
 * (`neu` a grey copy of it, its full size `newSize`).
 */
export function moveEditOnto(blend: BlendParams, old: Gray, oldSize: Size, oldSeed: number, neu: Gray, newSize: Size): MovedEdit {
  const found = locatePhoto(old, neu)
  const R = found.rect
  // Its pixels per pixel of the photo the edit was made on.
  const k = (R.width * newSize.width) / oldSize.width
  let b: BlendParams = { ...blend, pixelScale: (blend.pixelScale ?? 1) * k, photoSeed: blend.photoSeed ?? oldSeed }
  let lost = 0
  if (!found.whole) {
    // Placed things from fractions of the old photo to fractions of the new:
    // shapesOnCrop with the crop that is the old photo's place in the new
    // one turned inside out (an affine map, so it inverts).
    const W = oldSize.width
    const H = oldSize.height
    b = shapesOnCrop(b, oldSize, { x: (-R.x * W) / R.width, y: (-R.y * H) / R.height, width: W / R.width, height: H / R.height })
    // The crop: the old one's place in the new photo, or the old photo's,
    // kept within the new photo (a copy developed with other lens
    // correction can show a sliver less at its edges). Turned (a quarter,
    // straightened), it is upright in the turned photo, and stays so: the
    // old photo sits in the new one scaled and moved, so its turned frame
    // sits in the new turned frame the same way.
    const c = blend.effects.crop
    const on = cropActive(c)
    const C: CropParams = on ? c : { ...DEFAULT_CROP, ...(c as CropParams), x: 0, y: 0, width: 1, height: 1, quarter: 0, angle: 0 }
    const deg = cropAngle({ ...C, enabled: true })
    const a = (deg * Math.PI) / 180
    const turn = (v: { x: number; y: number }) => ({ x: v.x * Math.cos(a) - v.y * Math.sin(a), y: v.x * Math.sin(a) + v.y * Math.cos(a) })
    const oldFrame = cropFrameSize(oldSize, C)
    const newFrame = cropFrameSize(newSize, C)
    const s = (R.width * newSize.width) / oldSize.width
    // The old photo's middle, in the new photo and then turned about the new one's middle.
    const midOld = { x: R.x * newSize.width + (s * oldSize.width) / 2, y: R.y * newSize.height + (s * oldSize.height) / 2 }
    const off = turn({ x: midOld.x - newSize.width / 2, y: midOld.y - newSize.height / 2 })
    // A corner of the old crop, from the old frame's middle, in old pixels; then in the new frame's fractions.
    const at = (fx: number, fy: number) => ({
      x: (newFrame.width / 2 + off.x + s * (fx - 0.5) * oldFrame.width) / newFrame.width,
      y: (newFrame.height / 2 + off.y + s * (fy - 0.5) * oldFrame.height) / newFrame.height,
    })
    const A = at(C.x, C.y)
    const B = at(C.x + C.width, C.y + C.height)
    const x0 = Math.max(0, A.x)
    const y0 = Math.max(0, A.y)
    const x1 = Math.min(1, B.x)
    const y1 = Math.min(1, B.y)
    lost = Math.max(x0 - A.x, y0 - A.y, B.x - x1, B.y - y1)
    const placed: CropParams = { ...C, enabled: true, aspect: 'free', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
    b = { ...b, effects: { ...b.effects, crop: deg ? keepInside(placed, newSize) : placed } }
  }
  return { blend: b, found, lost }
}
