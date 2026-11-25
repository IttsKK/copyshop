import { setSurfaceImage, surfaceImageOf } from '../engine/surfaceImages'
import type { BlendParams } from '../engine/types'
import { PLATE_STORE, get, getAll, newId, put, remove, type PlateRecord } from '../storage/db'

/**
 * Surface's own images (engine/surface.ts kind 'image'): kept in the plate
 * store, marked as surfaces, so they travel with the edits that use them
 * (transfer/bundle.ts takes the whole store) and the grain list leaves them
 * out. Kept no bigger than SURFACE_LONG on the long side: a texture is
 * repeated, and more pixels would only cost memory.
 */
const SURFACE_LONG = 2048

/** Images being read, by id, so each is read once. */
const loading = new Map<string, Promise<ImageBitmap | null>>()

/** An image file as a surface: made smaller if it is big, kept, and its id and name returned. */
export async function importSurfaceTexture(file: File): Promise<{ id: string; name: string }> {
  const bitmap = await createImageBitmap(file)
  const k = Math.min(1, SURFACE_LONG / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * k))
  const height = Math.max(1, Math.round(bitmap.height * k))
  let blob: Blob = file
  let image: ImageBitmap = bitmap
  if (k < 1) {
    const c = new OffscreenCanvas(width, height)
    const ctx = c.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 })
    image = await createImageBitmap(blob)
  }
  const name = file.name.replace(/\.[^.]+$/, '') || 'Image'
  const record: PlateRecord = { id: newId('surface'), name, blob, width, height, createdAt: Date.now(), use: 'surface' }
  // With storage unavailable it still works for this session.
  await put(PLATE_STORE, record)
  setSurfaceImage(record.id, image)
  loading.set(record.id, Promise.resolve(image))
  return { id: record.id, name }
}

/** The surface images kept, newest first. */
export async function listSurfaceTextures(): Promise<{ id: string; name: string }[]> {
  try {
    const all = await getAll<PlateRecord>(PLATE_STORE)
    return all.filter((r) => r.use === 'surface').sort((a, b) => b.createdAt - a.createdAt).map((r) => ({ id: r.id, name: r.name }))
  } catch {
    return []
  }
}

export async function deleteSurfaceTexture(id: string): Promise<void> {
  await remove(PLATE_STORE, id)
}

/** A kept image, read from storage and put where the engine finds it (engine/surfaceImages.ts); null if it isn't kept here. */
export function loadSurfaceTexture(id: string): Promise<ImageBitmap | null> {
  const ready = surfaceImageOf(id)
  if (ready) return Promise.resolve(ready as ImageBitmap)
  let job = loading.get(id)
  if (!job) {
    job = (async () => {
      try {
        const record = await get<PlateRecord>(PLATE_STORE, id)
        if (!record) return null
        const image = await createImageBitmap(record.blob)
        setSurfaceImage(id, image)
        return image
      } catch {
        return null
      }
    })()
    loading.set(id, job)
    // A failed read may work next time (storage was busy).
    void job.then((img) => !img && loading.delete(id))
  }
  return job
}

/** The image an edit's surface needs, read first, so a render (an export) has it. */
export async function surfaceImageFor(params: BlendParams): Promise<ImageBitmap | null> {
  const s = params.effects.surface
  return s?.enabled && s.kind === 'image' && s.image ? loadSurfaceTexture(s.image) : null
}
