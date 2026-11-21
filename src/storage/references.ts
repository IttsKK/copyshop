/**
 * A small copy of each edited photo as it was when it was edited (2048 px
 * on its long side, kept in the app's own data, never in your folders), with
 * its full size: what a new version of the photo is matched against when
 * the file is written over (darktable exporting it again, larger) and the
 * old pixels are gone (pipeline/betterCopy.ts). Made once per photo.
 */
import { LIBRARY_STORE, get, put } from './db'

const LONG = 2048
const made = new Set<string>()

interface ReferenceRecord {
  id: string
  blob: Blob
  width: number
  height: number
}

/** Keep `bitmap` (the photo with this SHA-256) as its reference, unless it is kept already. */
export async function keepReference(sha: string, bitmap: ImageBitmap): Promise<void> {
  if (made.has(sha)) return
  made.add(sha)
  if (await get<ReferenceRecord>(LIBRARY_STORE, `ref:${sha}`).catch(() => null)) return
  const k = Math.min(1, LONG / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
  await put(LIBRARY_STORE, { id: `ref:${sha}`, blob, width: bitmap.width, height: bitmap.height } satisfies ReferenceRecord)
}

/** The photo's reference and its full size, if one was kept. */
export async function loadReference(sha: string): Promise<{ blob: Blob; width: number; height: number } | null> {
  const r = await get<ReferenceRecord>(LIBRARY_STORE, `ref:${sha}`).catch(() => undefined)
  return r?.blob ? { blob: r.blob, width: r.width, height: r.height } : null
}
