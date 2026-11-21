import type { Rect, Size } from './types'

/**
 * The photo's crop: which part of it is the picture. It is taken before the
 * edit, as the export's own crop is (pipeline/exportSize.ts), so vignettes,
 * borders and grain fit the cropped picture. What is placed on the photo
 * (streaks, masks, collage pieces) stays measured on the whole photo and is
 * moved onto the crop when it renders (shapesOnCrop), so changing the crop
 * never moves them off what they were drawn round.
 */
export type CropAspect = 'free' | 'original' | '1:1' | '4:5' | '4:3' | '3:2' | '16:9'

export interface CropParams {
  enabled: boolean
  /** In fractions of the photo. */
  x: number
  y: number
  width: number
  height: number
  aspect: CropAspect
  /** The aspect turned on its side: 4:5 becomes 5:4, a landscape original portrait. */
  turned: boolean
  /**
   * Straightened: the photo turned this many degrees (clockwise, -45 to 45)
   * about its middle, in its frame (cropFrameSize), before the crop is taken
   * from it; x, y, width and height are fractions of that frame. The crop
   * keeps inside the turned photo (keepInside), so no empty corner shows.
   */
  angle?: number
  /**
   * Quarter turns clockwise (0 to 3), before the straightening: one or
   * three stand a landscape photo up. The frame turns with it, so the
   * whole photo is still there to crop.
   */
  quarter?: number
}

export const DEFAULT_CROP: CropParams = { enabled: false, x: 0, y: 0, width: 1, height: 1, aspect: 'free', turned: false }

export const CROP_ASPECTS: { id: CropAspect; label: string }[] = [
  { id: 'free', label: 'Free' },
  { id: 'original', label: 'Original' },
  { id: '1:1', label: '1:1' },
  { id: '4:5', label: '4:5' },
  { id: '4:3', label: '4:3' },
  { id: '3:2', label: '3:2' },
  { id: '16:9', label: '16:9' },
]

const FIXED: Partial<Record<CropAspect, number>> = { '1:1': 1, '4:5': 4 / 5, '4:3': 4 / 3, '3:2': 3 / 2, '16:9': 16 / 9 }

/** The crop's quarter turns, 0 to 3. */
export const quarterOf = (c: Pick<CropParams, 'quarter'> | undefined): number => ((Math.round(c?.quarter ?? 0) % 4) + 4) % 4

/** Whether the crop takes anything away, or turns the photo. */
export const cropActive = (c: CropParams | undefined): c is CropParams =>
  !!c && c.enabled && (c.x > 0.0005 || c.y > 0.0005 || c.width < 0.9995 || c.height < 0.9995 || Math.abs(c.angle ?? 0) > 0.005 || quarterOf(c) !== 0)

/** How far the crop turns the photo, degrees clockwise (its quarter turns and straightening together); 0 when it is off. */
export const cropAngle = (c: CropParams | undefined): number => {
  if (!c || !c.enabled) return 0
  const deg = quarterOf(c) * 90 + (Math.abs(c.angle ?? 0) > 0.005 ? (c.angle ?? 0) : 0)
  return deg > 180 ? deg - 360 : deg
}

/**
 * The frame the crop is a fraction of: the photo, stood on its side by an
 * odd number of quarter turns. It has the photo's middle, so a point in it
 * is in the same pixels as the photo, offset (frameAt) where it is larger.
 */
export function cropFrameSize(photo: Size, c: Pick<CropParams, 'quarter'> | undefined): Size {
  return quarterOf(c) % 2 ? { width: photo.height, height: photo.width } : photo
}

/** Where the frame's corner is, in the photo's pixels (its middle on the photo's). */
function frameAt(photo: Size, frame: Size) {
  return { x: (photo.width - frame.width) / 2, y: (photo.height - frame.height) / 2 }
}

type Pt = { x: number; y: number }

/** A point of the photo in its pixels, where it is once the photo is turned `deg` about its middle (in the same frame). */
export function turnPx(p: Pt, photo: Size, deg: number): Pt {
  if (!deg) return p
  const a = (deg * Math.PI) / 180
  const dx = p.x - photo.width / 2
  const dy = p.y - photo.height / 2
  return { x: photo.width / 2 + dx * Math.cos(a) - dy * Math.sin(a), y: photo.height / 2 + dx * Math.sin(a) + dy * Math.cos(a) }
}

/** Whether a box (fractions of the turned frame) shows only the photo, no empty corner of the frame. */
export function insideTurned(b: { x: number; y: number; width: number; height: number }, photo: Size, deg: number, quarter = 0): boolean {
  if (b.x < -1e-6 || b.y < -1e-6 || b.x + b.width > 1 + 1e-6 || b.y + b.height > 1 + 1e-6) return false
  if (!deg) return true
  const frame = cropFrameSize(photo, { quarter })
  const at = frameAt(photo, frame)
  const corners = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ]
  // Back through the turn, each corner must be on the photo.
  return corners.every(([x, y]) => {
    const q = turnPx({ x: at.x + x * frame.width, y: at.y + y * frame.height }, photo, -deg)
    return q.x >= -0.5 && q.y >= -0.5 && q.x <= photo.width + 0.5 && q.y <= photo.height + 0.5
  })
}

/**
 * The crop moved and sized to keep inside the turned photo: slid toward
 * the middle as far as that does it, then made smaller about its middle,
 * its shape kept.
 */
export function keepInside(c: CropParams, photo: Size): CropParams {
  const deg = quarterOf(c) * 90 + (c.angle ?? 0)
  const q = quarterOf(c)
  const inside = (b: typeof box) => insideTurned(b, photo, deg, q)
  const box = { x: c.x, y: c.y, width: c.width, height: c.height }
  if (inside(box)) return c
  const at = (t: number, s: number) => {
    const cx = (box.x + box.width / 2) * (1 - t) + 0.5 * t
    const cy = (box.y + box.height / 2) * (1 - t) + 0.5 * t
    const w = box.width * s
    const h = box.height * s
    return { x: cx - w / 2, y: cy - h / 2, width: w, height: h }
  }
  // As little slide toward the middle as fits, at this size.
  if (inside(at(1, 1))) {
    let lo = 0
    let hi = 1
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2
      if (inside(at(m, 1))) hi = m
      else lo = m
    }
    return { ...c, ...at(hi, 1) }
  }
  // Too big turned: in the middle, as large as fits.
  let lo = 0
  let hi = 1
  for (let k = 0; k < 24; k++) {
    const m = (lo + hi) / 2
    if (inside(at(1, m))) lo = m
    else hi = m
  }
  return { ...c, ...at(1, lo) }
}

/**
 * The picture the crop shows, cut from `src` (the photo, `photo` its size):
 * the photo turned by the crop's angle about its middle, then the crop's
 * rectangle (cropRect) taken from that.
 */
export async function cropBitmap(src: ImageBitmap, photo: Size, c: CropParams): Promise<ImageBitmap> {
  const r = cropRect(photo, c)
  const deg = cropAngle(c)
  if (!deg) return createImageBitmap(src, r.x, r.y, r.width, r.height)
  const canvas = new OffscreenCanvas(r.width, r.height)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.translate(-r.x + photo.width / 2, -r.y + photo.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(src, -photo.width / 2, -photo.height / 2, photo.width, photo.height)
  return createImageBitmap(canvas)
}

/** Width over height in pixels the aspect asks for; null when free. */
export function cropRatio(c: Pick<CropParams, 'aspect' | 'turned' | 'quarter'>, photo: Size): number | null {
  const frame = cropFrameSize(photo, c)
  const r = c.aspect === 'original' ? frame.width / frame.height : (FIXED[c.aspect] ?? null)
  if (r === null) return null
  // A fixed aspect is landscape or square as listed; turned, it stands up.
  const listed = c.aspect === 'original' ? r : r
  return c.turned ? 1 / listed : listed
}

/**
 * The crop in the photo's pixels, whole pixels, never empty. Turned a
 * quarter, its frame stands out past the photo's sides (cropFrameSize), so
 * x or y can be below 0: it is still where it is with the photo turned
 * about its middle (turnPx).
 */
export function cropRect(photo: Size, c: CropParams): Rect {
  const frame = cropFrameSize(photo, c)
  const at = frameAt(photo, frame)
  const fx = Math.max(0, Math.min(frame.width - 16, Math.round(c.x * frame.width)))
  const fy = Math.max(0, Math.min(frame.height - 16, Math.round(c.y * frame.height)))
  const width = Math.max(16, Math.min(frame.width - fx, Math.round(c.width * frame.width)))
  const height = Math.max(16, Math.min(frame.height - fy, Math.round(c.height * frame.height)))
  return { x: fx + Math.round(at.x), y: fy + Math.round(at.y), width, height }
}

/**
 * The crop turned a quarter more (`by` +1 clockwise, -1 back): the frame
 * turns with the photo, and the crop with it, so it keeps what it shows.
 */
export function turnQuarter(c: CropParams, by: 1 | -1): CropParams {
  const q = (quarterOf(c) + by + 4) % 4
  const box =
    by === 1
      ? { x: 1 - (c.y + c.height), y: c.x, width: c.height, height: c.width }
      : { x: c.y, y: 1 - (c.x + c.width), width: c.height, height: c.width }
  // A fixed aspect turns with it; Original and Free follow the frame.
  const fixed = c.aspect !== 'free' && c.aspect !== 'original' && c.aspect !== '1:1'
  return { ...c, ...box, enabled: true, quarter: q, turned: fixed ? !c.turned : c.turned }
}

/**
 * The largest rectangle of a width/height ratio that fits the photo, centred
 * on where the crop is now: what choosing an aspect does.
 */
export function fitRatio(c: CropParams, whole: Size, ratio: number): Pick<CropParams, 'x' | 'y' | 'width' | 'height'> {
  const photo = cropFrameSize(whole, c)
  const cx = c.x + c.width / 2
  const cy = c.y + c.height / 2
  // In pixels: as large as the current crop's larger side allows, within the photo.
  let w = Math.max(c.width * photo.width, c.height * photo.height * ratio)
  let h = w / ratio
  const k = Math.min(1, photo.width / w, photo.height / h)
  w *= k
  h *= k
  const width = w / photo.width
  const height = h / photo.height
  return {
    width,
    height,
    x: Math.min(1 - width, Math.max(0, cx - width / 2)),
    y: Math.min(1 - height, Math.max(0, cy - height / 2)),
  }
}

/** A crop of a crop, in fractions of the whole: the export's crop taken from the module's. */
export function composeCrop(outer: Rect & { angle?: number }, inner: Rect): Rect & { angle?: number } {
  return {
    x: outer.x + inner.x * outer.width,
    y: outer.y + inner.y * outer.height,
    width: inner.width * outer.width,
    height: inner.height * outer.height,
    ...(outer.angle ? { angle: outer.angle } : {}),
  }
}
