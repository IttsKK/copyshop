import type { GrainEngine } from '../engine/GrainEngine'
import { surfaceImageFor } from '../sources/surfaceTextures'
import { developRaw, isRawName } from './raw'
import { encodeTiff } from './tiff'
import { encodeWebp } from './webp'
import { isPhotoName } from './formats'
import { readPhotoDate } from './photoDate'
import { activeBorder, printSizeOf, type BlendParams } from '../engine/types'
import { cropFraction, shapesOnCrop } from './instagram'
import { exportCanvas, exportCrop, isFullSize, matchedFormat, prepareForExport, type ExportFormat, type WrittenFormat } from './exportSize'
import { setCollagePhoto } from '../engine/collage'
import type { GrainSource } from '../sources/GrainSource'
import { PRESET_SCHEMA_VERSION, type OutputSettings, type PresetDoc } from '../storage/presets'
import { embedRecipe, sha256 } from '../storage/recipe'
import { decodePhoto } from './decode'
import { composeCrop, cropActive, cropAngle, cropBitmap, cropRect } from '../engine/crop'
import { collageImageRefs } from '../storage/collageImages'

/**
 * The photo's own number for its random detail (grain position, paper, dust),
 * from the SHA-256 of its file: the same photo always gets the same pattern,
 * renamed or not, and different photos get different ones.
 */
export function photoSeed(sha256Hex: string): number {
  return parseInt(sha256Hex.slice(0, 8), 16) >>> 0 || 1
}

export interface RenderedFile {
  blob: Blob
  filename: string
  /** Extension the final is encoded as (matches the input format). */
  ext: string
  /** SHA-256 of the original, as recorded in the embedded recipe. */
  originalHash: string
  width: number
  height: number
}

function splitName(filename: string): { stem: string; ext: string } {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) return { stem: filename, ext: '' }
  return { stem: filename.slice(0, dot), ext: filename.slice(dot + 1).toLowerCase() }
}

export function encodeAs(ext: string, format: ExportFormat = 'match'): { mime: string; ext: string; format: WrittenFormat } {
  const f = format === 'match' ? matchedFormat(ext) : format
  // The photo's own spelling of the extension where it is the same format.
  if (f === 'jpeg') return { mime: 'image/jpeg', ext: ext === 'jpeg' ? 'jpeg' : 'jpg', format: f }
  if (f === 'tiff') return { mime: 'image/tiff', ext: ext === 'tiff' ? 'tiff' : 'tif', format: f }
  if (f === 'webp') return { mime: 'image/webp', ext: 'webp', format: f }
  return { mime: 'image/png', ext: 'png', format: f }
}

/** The rendered canvas as a 2D one, to read its pixels (8 bits a channel: the render's own). */
function readable(canvas: HTMLCanvasElement | OffscreenCanvas): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
  const { width, height } = canvas
  const copy = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = copy.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true }) as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Could not read the render back.')
  ctx.drawImage(canvas, 0, 0)
  return ctx
}

/** The render encoded as `target`: JPEG and PNG by the webview, TIFF and WebP here (pipeline/tiff.ts, webp.ts). */
async function encodeRender(canvas: HTMLCanvasElement | OffscreenCanvas, target: ReturnType<typeof encodeAs>, quality: number): Promise<Blob> {
  const { width, height } = canvas
  if (target.format === 'tiff') {
    const ctx = readable(canvas)
    const tiff = await encodeTiff({ width, height, rows: (y, n) => ctx.getImageData(0, y, width, n).data })
    return new Blob([tiff], { type: target.mime })
  }
  if (target.format === 'webp') {
    const pixels = readable(canvas).getImageData(0, 0, width, height).data
    return new Blob([await encodeWebp(pixels, width, height, quality)], { type: target.mime })
  }
  return canvasToBlob(canvas, target.mime, quality)
}

function canvasToBlob(canvas: HTMLCanvasElement | OffscreenCanvas, mime: string, quality: number): Promise<Blob> {
  if ('convertToBlob' in canvas) {
    return canvas.convertToBlob({ type: mime, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Canvas encoding failed.'))), mime, quality)
  })
}

/**
 * Full-resolution render of one file. Preview, single export and batch all go
 * through GrainEngine.render — this function only handles decode, filename and
 * encode around it.
 */
export async function renderFile(
  engine: GrainEngine,
  file: Blob,
  filename: string,
  source: GrainSource,
  blend: BlendParams,
  output: OutputSettings,
): Promise<RenderedFile> {
  // In sRGB, with the photo's own colour profile applied (see decodePhoto);
  // a RAW file developed first, as the camera set it (pipeline/raw.ts).
  const decoded = await decodePhoto(isRawName(filename) ? await developRaw(file, filename) : file, filename)
  // The date stamp prints this photo's own date, in a batch too.
  if (blend.effects.stamp.enabled) {
    const date = await readPhotoDate(file)
    if (date && date !== blend.effects.stamp.date) blend = { ...blend, effects: { ...blend.effects, stamp: { ...blend.effects.stamp, date } } }
  }
  const decodedSize = { width: decoded.width, height: decoded.height }
  const originalHash = await sha256(file)
  // Collage pieces are found on the whole original, the same way the preview
  // finds them; only for the photo they were made on (see CollageParams.photo).
  // A photo replaced under its edit keeps the seed of the one it was made on.
  const seed = blend.photoSeed ?? photoSeed(originalHash)
  if (blend.effects.collage.pieces.length && blend.effects.collage.photo === seed)
    setCollagePhoto(seed, decoded, decodedSize)
  // The photo's own crop first (engine/crop.ts): the edit is rendered on the
  // picture, placed things moved onto it; the whole photo stays in `blend`
  // for the recipe embedded below.
  // A turned crop (cropAngle) is cut from the photo turned about its middle.
  const own = cropActive(blend.effects.crop) ? cropRect(decodedSize, blend.effects.crop) : null
  const deg = cropAngle(blend.effects.crop)
  const photo = own ? await cropBitmap(decoded, decodedSize, blend.effects.crop) : decoded
  if (photo !== decoded) decoded.close()
  const photoSize = { width: photo.width, height: photo.height }
  const params = own ? shapesOnCrop(blend, decodedSize, own, deg) : blend
  // Then the export's: cropped or resized, the picture is brought to its final
  // size before the edit, so grain is drawn at the output's own pixels.
  const sized = !isFullSize(output)
  const crop = sized ? exportCrop(photoSize, activeBorder(params), output) : null
  const base = (sized ? await prepareForExport(photo, activeBorder(params), output) : null) ?? photo
  // Resized for the export, its grain is at the output's own pixels: so
  // for a photo replaced under its edit (BlendParams.pixelScale) too, as
  // the same export of the photo it was made on had it.
  const atOutput = base !== photo && params.pixelScale !== undefined ? { ...params, pixelScale: undefined } : params
  if (base !== photo) photo.close()
  // Where the base sits in the original, for the collage pieces found on it.
  const whole = { x: 0, y: 0, width: 1, height: 1 }
  const inPhoto = crop ? cropFraction(photoSize, crop) : whole
  const photoCrop = own ? composeCrop({ ...cropFraction(decodedSize, own), ...(deg ? { angle: deg } : {}) }, inPhoto) : inPhoto
  try {
    const grain = await source.getTexture({ targetSize: { width: base.width, height: base.height } })
    // Surface's own image, read before drawing: an export never goes out without it.
    await surfaceImageFor(params)
    const full = printSizeOf({ width: base.width, height: base.height }, params)
    // Instagram's canvas, trimming the odd pixel of paper; otherwise the whole print.
    const print = exportCanvas(full, output)
    const canvas = engine.render({
      base,
      baseSize: { width: base.width, height: base.height },
      grain: grain.source,
      grainSize: grain.size,
      grainMean: grain.mean,
      grainSd: grain.sd,
      // On a crop, shapes are moved onto it (see shapesOnCrop).
      params: crop ? shapesOnCrop(atOutput, photoSize, crop) : atOutput,
      imageSeed: seed,
      ...(own || crop ? { photoCrop } : {}),
      ...(print.width !== full.width || print.height !== full.height
        ? { region: { x: Math.floor((full.width - print.width) / 2), y: 0, ...print }, outputSize: print }
        : {}),
    })
    const { stem, ext } = splitName(filename)
    const target = encodeAs(ext, output.format)
    const encoded = await encodeRender(canvas, target, output.jpegQuality)
    // The edit travels inside the export, so the export is enough to re-edit from.
    const doc: PresetDoc = {
      schemaVersion: PRESET_SCHEMA_VERSION,
      // The whole edit, placed things too: opening the export re-edits it.
      placed: true,
      name: stem,
      grainSource: source.serialize(),
      blend,
      output,
    }
    const blob = await embedRecipe(encoded, {
      v: 1,
      doc,
      original: { name: filename, size: file.size, sha256: originalHash },
      collage: await collageImageRefs(blend.effects.collage.pieces.map((p) => p.image)).catch(() => []),
    })
    return {
      blob,
      filename: `${stem}${output.suffix}.${target.ext}`,
      ext: target.ext,
      originalHash,
      width: print.width,
      height: print.height,
    }
  } finally {
    base.close()
  }
}

/** What a batch takes: every photo that opens here (pipeline/formats.ts), RAW files too where they can be developed. */
export const isSupportedImageName = isPhotoName
