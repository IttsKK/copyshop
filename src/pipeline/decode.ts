import { invoke } from '@tauri-apps/api/core'
import { isNative } from '../platform/native'
import { cannotOpenMessage } from './formats'

/**
 * Decode a photo into sRGB pixels, honouring its embedded colour profile.
 *
 * A photo can carry an ICC profile — Display P3 from a phone, Adobe RGB from
 * a camera, or anything a raw editor was set to export (darktable's "BRG"
 * test profile stores the channels swapped). Every viewer applies it, so the
 * renderer must too, or the picture comes out in different colours from the
 * same file everywhere else. WebGL does not: Safari uploads an image's raw
 * values whatever createImageBitmap was asked, and Chrome does with
 * colorSpaceConversion 'none'. A 2D canvas draw does apply the profile in
 * both, so the photo is drawn through one once, here, and the renderer gets
 * those sRGB pixels. Exports carry no profile, which reads as sRGB: right.
 *
 * A format the webview can't decode (TIFF and HEIC in Windows' and Linux's
 * webviews) is converted by the app first: see decodable. `name` is for
 * that, and for the error.
 *
 * Grain plates are not photos and keep their raw values (decodeValues).
 */
export async function decodePhoto(file: Blob, name = ''): Promise<ImageBitmap> {
  const decoded = await decodable(file, name, 'default')
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(decoded.width, decoded.height)
      : Object.assign(document.createElement('canvas'), { width: decoded.width, height: decoded.height })
  const ctx = (canvas as HTMLCanvasElement).getContext('2d', { colorSpace: 'srgb' }) as CanvasRenderingContext2D | null
  if (!ctx) return decoded
  ctx.drawImage(decoded, 0, 0)
  decoded.close()
  return createImageBitmap(canvas as HTMLCanvasElement, { colorSpaceConversion: 'none' })
}

/** An image's own values, no colour profile applied: for grain plates. Converted by the app where the webview can't decode it. */
export function decodeValues(file: Blob, name = ''): Promise<ImageBitmap> {
  return decodable(file, name, 'none')
}

/**
 * The file decoded by the webview, or, where it can't (and this is the
 * desktop app), converted by the app into a PNG it can, upright, keeping the
 * colour profile unless the raw values are wanted. Throws a message for
 * people when neither can read it.
 */
async function decodable(file: Blob, name: string, colorSpaceConversion: ColorSpaceConversion): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { colorSpaceConversion })
  } catch (err) {
    if (!isNative()) throw new Error(cannotOpenMessage(name))
    const png = await convertImage(file, name, colorSpaceConversion === 'none').catch((e: unknown) => {
      throw new Error(cannotOpenMessage(name, typeof e === 'string' ? e : (e as Error)?.message))
    })
    try {
      return await createImageBitmap(png, { colorSpaceConversion })
    } catch {
      throw new Error(cannotOpenMessage(name, (err as Error)?.message))
    }
  }
}

/** A photo converted by the app (src-tauri: convert_image) into a PNG the webview decodes. */
async function convertImage(file: Blob, name: string, keepValues: boolean): Promise<Blob> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const out = await invoke<ArrayBuffer>('convert_image', bytes, {
    headers: { 'x-name': encodeURIComponent(name), 'x-keep-values': keepValues ? '1' : '0' },
  })
  return new Blob([out], { type: 'image/png' })
}
