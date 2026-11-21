import { turnPx } from '../engine/crop'
import { maskOnCrop } from '../engine/maskShapes'
import { photoFrameOf, printSize, printSizeOf, shapeFrame, type BlendParams, type BorderParams, type Rect, type Size } from '../engine/types'

/**
 * Sizing for Instagram. Anything uploaded at another size is resized by
 * Instagram with its own filter, which smears pixel-sized grain before its
 * compression even starts. So the photo is cropped and resized *first*, to
 * the size Instagram shows, and the edit is rendered on that at one image
 * pixel per output pixel — the grain is drawn at its final size and never
 * resampled.
 */
export const IG_WIDTH = 1080
/**
 * Instagram's feed accepts height/width from 1/1.91 (landscape) to 4/3 —
 * 3:4 portrait, 1080 × 1440, since the 2025 change to a taller grid (it was
 * 4:5, 1080 × 1350, before). Wider than 1080 is resized down, so width stays
 * 1080 and the extra resolution is in height.
 */
const TALLEST = 4 / 3
const WIDEST = 1 / 1.91

/**
 * The photo size that, with this border around it, gives a print exactly
 * 1080 px wide at the photo's own aspect ratio clamped to Instagram's limits.
 */
export function instagramPhotoSize(photo: Size, border: BorderParams): Size {
  const b = border.width
  const e = border.bottomExtra
  const ratio = Math.min(TALLEST, Math.max(WIDEST, photo.height / photo.width))
  const printH = IG_WIDTH * ratio
  // The border is a fraction of the photo's short side: try portrait first.
  let w = IG_WIDTH / (1 + 2 * b)
  let h = printH - w * (2 * b + e)
  if (h < w) {
    h = printH / (1 + 2 * b + e)
    w = IG_WIDTH - 2 * b * h
  }
  // The border is rounded to whole pixels per side, so the estimate can land a
  // pixel off 1080 — and for some widths no photo size gives exactly 1080,
  // the total stepping from 1079 to 1081. Search around the estimate: exactly
  // 1080 if possible, otherwise just over, which the export trims to size
  // (a pixel of paper; see fitToInstagram).
  const w0 = Math.round(w)
  const h0 = Math.round(h)
  let best: Size | null = null
  let bestScore = Infinity
  for (let dw = -4; dw <= 4; dw++)
    for (let dh = -4; dh <= 4; dh++) {
      const size = { width: w0 + dw, height: h0 + dh }
      if (size.width < 1 || size.height < 1) continue
      const print = printSize(size, border)
      const overW = print.width - IG_WIDTH
      if (overW < 0 || overW > 2) continue
      const score = overW * 100 + Math.abs(print.height - Math.round(printH))
      if (score < bestScore) {
        bestScore = score
        best = size
      }
    }
  return best ?? { width: Math.max(1, w0), height: Math.max(1, h0) }
}

/**
 * The part of the photo the Instagram export keeps: a centre crop to the
 * aspect instagramPhotoSize gives — which depends on the border, as the
 * border is part of the 1080-wide print. In the photo's pixels.
 */
export function instagramCrop(photo: Size, border: BorderParams): Rect {
  const target = instagramPhotoSize(photo, border)
  const aspect = target.height / target.width
  let cw = photo.width
  let ch = Math.round(cw * aspect)
  if (ch > photo.height) {
    ch = photo.height
    cw = Math.round(ch / aspect)
  }
  return { x: Math.round((photo.width - cw) / 2), y: Math.round((photo.height - ch) / 2), width: cw, height: ch }
}

/**
 * The settings with their streak shapes and masks moved onto a crop of the
 * photo. They are fractions of the photo they were drawn on; rendered on the
 * Instagram crop, they must be fractions of that instead, or they land off
 * their subject — and move whenever the border (and so the crop) changes.
 */
export function shapesOnCrop(params: BlendParams, photo: Size, crop: Rect, deg = 0): BlendParams {
  if (!deg && crop.x === 0 && crop.y === 0 && crop.width === photo.width && crop.height === photo.height) return params
  // Shapes saved as fractions of the print are brought onto the photo first:
  // a point's place in the print, less where the photo sits in it; on a
  // turned crop (engine/crop.ts, cropAngle), turned with the photo.
  const frame = shapeFrame(photo, params)
  const at = photoFrameOf(photo, params)
  const move = (p: { x: number; y: number }) => {
    const q = turnPx({ x: frame.x + p.x * frame.width - at.x, y: frame.y + p.y * frame.height - at.y }, photo, deg)
    return { x: (q.x - crop.x) / crop.width, y: (q.y - crop.y) / crop.height }
  }
  // And back, from the crop to the frame the shapes were in.
  const back = (p: { x: number; y: number }) => {
    const q = turnPx({ x: crop.x + p.x * crop.width, y: crop.y + p.y * crop.height }, photo, -deg)
    return { x: (q.x + at.x - frame.x) / frame.width, y: (q.y + at.y - frame.y) / frame.height }
  }
  const fx = params.effects
  // Where the whole photo is on the crop (EffectParams.cropFrame), so streaks
  // and mask edges are measured on it: its corner, middle, short side and
  // half-diagonal. A crop of a crop (an Instagram crop of a cropped photo)
  // carries the first on.
  const short = Math.min(crop.width, crop.height)
  const was = fx.cropFrame ?? { x: 0, y: 0, unit: 1, cx: 0.5, cy: 0.5, r: Math.hypot(photo.width, photo.height) / 2 / Math.min(photo.width, photo.height) }
  const onCrop = (fx_: number, fy: number) => {
    const q = turnPx({ x: fx_ * photo.width, y: fy * photo.height }, photo, deg)
    return { x: (q.x - crop.x) / crop.width, y: (q.y - crop.y) / crop.height }
  }
  const corner = onCrop(was.x, was.y)
  const middle = onCrop(was.cx, was.cy)
  const scale = Math.min(photo.width, photo.height) / short
  const cropFrame = { x: corner.x, y: corner.y, unit: was.unit * scale, cx: middle.x, cy: middle.y, r: was.r * scale }
  // Lights are placed in fractions of the print: onto the photo, moved with it, and into the cropped print.
  const printWas = printSizeOf(photo, params)
  const atWas = photoFrameOf(photo, params)
  const cropSize = { width: crop.width, height: crop.height }
  const printNow = printSizeOf(cropSize, params)
  const atNow = photoFrameOf(cropSize, params)
  const movePrint = (p: { x: number; y: number }) => {
    const q = turnPx({ x: p.x * printWas.width - atWas.x, y: p.y * printWas.height - atWas.y }, photo, deg)
    return { x: (q.x - crop.x + atNow.x) / printNow.width, y: (q.y - crop.y + atNow.y) / printNow.height }
  }
  const printScale = Math.min(printWas.width, printWas.height) / Math.min(printNow.width, printNow.height)
  return {
    ...params,
    effects: {
      ...fx,
      cropFrame,
      ...(fx.lighting
        ? {
            lighting: {
              ...fx.lighting,
              lights: fx.lighting.lights.map((l) => ({ ...l, outline: l.outline.map(movePrint), angle: l.angle + deg, edge: l.edge * printScale, ...(l.soft ? { soft: l.soft * printScale } : {}) })),
            },
          }
        : {}),
      streaks: {
        ...fx.streaks,
        // Every point placed on the photo moves with it: the outline and
        // path, a trail's drawn end line, each fix's span and source, a
        // radial streak's middle. Left behind, they sat where they were in
        // the uncropped photo and the export's bars ended and were fixed in
        // the wrong places.
        shapes: fx.streaks.shapes.map((s) => ({
          ...s,
          angle: s.angle + deg,
          outline: s.outline.map(move),
          path: s.path ? s.path.map(move) : null,
          ends: s.ends ? s.ends.map(move) : null,
          fixes: (s.fixes ?? []).map((f) => ({
            ...f,
            a: move(f.a),
            b: move(f.b),
            source: f.source ? { a: move(f.source.a), b: move(f.source.b) } : null,
          })),
          radialCentre: s.radialCentre ? move(s.radialCentre) : null,
          ...(s.guides ? { guides: s.guides.map((g) => ({ ...g, a: move(g.a), b: move(g.b), ...(g.points ? { points: g.points.map(move) } : {}) })) } : {}),
        })),
      },
      // Radii are shares of the frame's short side: rescaled to the crop's.
      masks: (fx.masks ?? []).map((m) => maskOnCrop(m, move, Math.min(frame.width, frame.height) / Math.min(crop.width, crop.height), deg ? { deg, back } : undefined)),
      // Repeat's path and placed copies are points on the photo too.
      ...(fx.repeat ? { repeat: { ...fx.repeat, items: fx.repeat.items.map((r) => ({ ...r, path: r.path.map(move), placed: r.placed.map(move), ...(r.vanish ? { vanish: move(r.vanish) } : {}) })) } } : {}),
      shapeSpace: 'photo',
    },
  }
}

/** Centre-crop `src` to the target's aspect and resize it with an averaging filter. */
export async function prepareForInstagram(
  src: ImageBitmap,
  border: BorderParams,
): Promise<ImageBitmap> {
  const target = instagramPhotoSize({ width: src.width, height: src.height }, border)
  const { x: cx, y: cy, width: cw, height: ch } = instagramCrop({ width: src.width, height: src.height }, border)
  // Halve while more than twice the target, then one high-quality step.
  let canvas = document.createElement('canvas')
  canvas.width = cw
  canvas.height = ch
  canvas.getContext('2d')!.drawImage(src, cx, cy, cw, ch, 0, 0, cw, ch)
  while (canvas.width / 2 >= target.width) {
    const half = document.createElement('canvas')
    half.width = Math.round(canvas.width / 2)
    half.height = Math.round(canvas.height / 2)
    const h = half.getContext('2d')!
    h.imageSmoothingQuality = 'high'
    h.drawImage(canvas, 0, 0, half.width, half.height)
    canvas = half
  }
  const out = document.createElement('canvas')
  out.width = target.width
  out.height = target.height
  const ctx = out.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(canvas, 0, 0, target.width, target.height)
  return createImageBitmap(out)
}

/**
 * The Instagram canvas size for a rendered print: 1080 wide and no taller
 * than 3:4. A print can be a pixel or two over (see instagramPhotoSize);
 * those are paper, trimmed evenly from the sides (and from the bottom).
 */
export function fitToInstagram(print: Size): Size {
  const width = Math.min(print.width, IG_WIDTH)
  return { width, height: Math.min(print.height, Math.floor(width * TALLEST)) }
}

/** A crop in fractions of the photo, as RenderRequest.photoCrop takes it. */
export function cropFraction(photo: Size, crop: Rect): Rect {
  return { x: crop.x / photo.width, y: crop.y / photo.height, width: crop.width / photo.width, height: crop.height / photo.height }
}
