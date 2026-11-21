import { printSize, type BorderParams, type Rect, type Size } from '../engine/types'
import { IG_WIDTH } from './instagram'

/**
 * How big an export is. It never crops: framing is the Crop module's (engine/
 * crop.ts). 'instagram' is exactly 1080 wide, borders included, so Instagram
 * shows it without resizing it; otherwise a long edge, or the photo's own
 * resolution. Both scale the whole picture, never stretch it.
 */
export type ExportShape = 'original' | 'instagram'
/** 'match' keeps the photo's own format where it can be written (pipeline/render.ts encodeAs). */
export type ExportFormat = 'match' | 'jpeg' | 'png' | 'tiff' | 'webp'

/** A format an export is written in. */
export type WrittenFormat = Exclude<ExportFormat, 'match'>

/** The format 'match' writes a photo of this extension in: its own, or JPEG (RAW, HEIC, AVIF, GIF, BMP), as a camera's or phone's own export would be. */
export function matchedFormat(ext: string): WrittenFormat {
  if (ext === 'png') return 'png'
  if (ext === 'tif' || ext === 'tiff') return 'tiff'
  if (ext === 'webp') return 'webp'
  return 'jpeg'
}

export interface ExportSizing {
  shape: ExportShape
  /** The print's long edge in pixels; null keeps the photo's own resolution. Never enlarged. */
  longEdge: number | null
}

/** Whether an export is the photo as it is: not resized. */
export const isFullSize = (s: ExportSizing) => s.shape === 'original' && s.longEdge === null

/** The whole photo: an export no longer crops, but callers still take a rect. */
export function exportCrop(photo: Size, _border: BorderParams, _s: ExportSizing): Rect {
  return { x: 0, y: 0, ...photo }
}

/** The photo at a width, its height in proportion. */
const atWidth = (photo: Size, width: number): Size => ({ width, height: Math.max(1, Math.round((photo.height * width) / photo.width)) })

/**
 * The size the photo is brought to before the edit is rendered on it, so
 * grain is drawn at the output's own pixels rather than resampled after; null
 * when the export is the photo at its own size.
 */
export function exportPhotoSize(photo: Size, border: BorderParams, s: ExportSizing): Size | null {
  if (isFullSize(s)) return null
  if (s.shape === 'instagram') {
    // The widest photo whose print, paper and all, is no wider than 1080.
    let w = Math.round(IG_WIDTH / (1 + 2 * border.width))
    while (w > 1 && printSize(atWidth(photo, w), border).width > IG_WIDTH) w--
    while (printSize(atWidth(photo, w + 1), border).width <= IG_WIDTH) w++
    return atWidth(photo, w)
  }
  const print = printSize(photo, border)
  const long = s.longEdge!
  if (Math.max(print.width, print.height) <= long) return { ...photo }
  const k = long / Math.max(print.width, print.height)
  const at = (k: number): Size => ({ width: Math.max(1, Math.round(photo.width * k)), height: Math.max(1, Math.round(photo.height * k)) })
  // The paper's rounding can tip the print a pixel over: step down until it fits.
  let size = at(k)
  for (let i = 0; i < 8; i++) {
    const p = printSize(size, border)
    if (Math.max(p.width, p.height) <= long) break
    size = at(k * (1 - (i + 1) * 0.0005))
  }
  // Or a pixel under: step up while it still fits, so the long edge is the one asked for.
  for (let i = 1; i <= 8; i++) {
    const up = at(k * (1 + i * 0.0005))
    const p = printSize(up, border)
    if (Math.max(p.width, p.height) > long) break
    size = up
  }
  return size
}

/** The canvas the rendered print comes out as: the print itself. */
export function exportCanvas(print: Size, _s: ExportSizing): Size {
  return print
}

/**
 * Whether Instagram's feed will crop this print itself: it shows 3:4 at the
 * tallest and 1.91:1 at the widest. Which way it is out, or null.
 */
export function instagramOverflow(print: Size): 'tall' | 'wide' | null {
  const r = print.height / print.width
  return r > 4 / 3 + 0.005 ? 'tall' : r < 1 / 1.91 - 0.005 ? 'wide' : null
}

/** Crop `src` and resize it to `target` with an averaging filter: halved while more than twice the size, then one high-quality step. */
export async function cropAndResize(src: ImageBitmap, crop: Rect, target: Size): Promise<ImageBitmap> {
  let canvas = document.createElement('canvas')
  canvas.width = crop.width
  canvas.height = crop.height
  canvas.getContext('2d')!.drawImage(src, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height)
  if (target.width === crop.width && target.height === crop.height) return createImageBitmap(canvas)
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

/** The photo prepared for an export of this sizing; null when it is used as it is. */
export async function prepareForExport(src: ImageBitmap, border: BorderParams, s: ExportSizing): Promise<ImageBitmap | null> {
  const photo = { width: src.width, height: src.height }
  const target = exportPhotoSize(photo, border, s)
  return target ? cropAndResize(src, exportCrop(photo, border, s), target) : null
}

/** A sizing in words. */
export function describeSizing(s: ExportSizing): string {
  if (s.shape === 'instagram') return '1080 px wide'
  return s.longEdge === null ? 'full size' : `${s.longEdge} px long edge`
}
