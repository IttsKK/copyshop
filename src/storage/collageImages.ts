import { decodePhoto } from '../pipeline/decode'
import { COLLAGE_STORE, get, getAll, put, remove } from './db'
import { sha256, type CollageImageRef } from './recipe'

/**
 * The images Collage lays into photos: skies, mostly. Kept in a library of
 * their own (on disk with the app, in the browser otherwise), named by their
 * contents, so a piece in a saved edit or an export's recipe finds its image
 * again on this machine, and adding the same file twice keeps one copy.
 *
 * A collage belongs to its photo, so each image remembers the photos it was
 * added for and Collage lists only the open photo's. One file added for two
 * photos is still kept once.
 */
export interface CollageImageRecord {
  id: string
  name: string
  blob: Blob
  width: number
  height: number
  createdAt: number
  /** The photos (see photoSeed) this image was added for. Missing on images added before. */
  photos?: number[]
  /** Parts marked not to use: Collage's fill never shows them. Kept as text (packKeepOut); read with readKeepOut. */
  keepOut?: StoredKeepOut
}

/**
 * Parts of a collage image marked not to use (a bird, a lamp post, a
 * building against the sky): 1 marked, on a small grid over the image
 * (w by h, row by row). `at`: when it was marked, so what is worked out
 * from it is worked out again.
 */
export interface KeepOut {
  w: number
  h: number
  data: Uint8Array
  at: number
}

/**
 * A KeepOut as stored: its marks as base64 text. The desktop app keeps
 * records as JSON, where a Uint8Array came back as a plain object
 * ({"0":1,"1":0,…}) and opening the marks again crashed the app. Records
 * saved that way (and the browser's, which kept the Uint8Array) still read.
 */
export type StoredKeepOut = Omit<KeepOut, 'data'> & { data: string | Uint8Array | number[] | Record<string, number> }

export function packKeepOut(k: KeepOut): StoredKeepOut {
  let text = ''
  for (let i = 0; i < k.data.length; i += 0x8000) text += String.fromCharCode(...k.data.subarray(i, i + 0x8000))
  return { ...k, data: btoa(text) }
}

export function readKeepOut(k: StoredKeepOut | undefined | null): KeepOut | undefined {
  if (!k || !(k.w > 0) || !(k.h > 0)) return undefined
  const n = k.w * k.h
  let data: Uint8Array
  if (k.data instanceof Uint8Array) data = k.data
  else if (typeof k.data === 'string') {
    try {
      const text = atob(k.data)
      data = new Uint8Array(text.length)
      for (let i = 0; i < text.length; i++) data[i] = text.charCodeAt(i)
    } catch {
      return undefined
    }
  } else if (Array.isArray(k.data)) data = Uint8Array.from(k.data)
  else if (k.data && typeof k.data === 'object') {
    data = new Uint8Array(n)
    for (const [i, v] of Object.entries(k.data)) if (Number(i) < n) data[Number(i)] = v ? 1 : 0
  } else return undefined
  if (data.length !== n) {
    const fit = new Uint8Array(n)
    fit.set(data.subarray(0, n))
    data = fit
  }
  return { w: k.w, h: k.h, at: k.at ?? 0, data }
}

export interface CollageImage {
  id: string
  name: string
  /** Decoded in sRGB, no larger than MAX_SIDE on its long side. */
  bitmap: ImageBitmap
  /** A small copy for the list and for brightness matching. */
  thumb: string
  /** Linear-light luminance, 64 px on the long side, for matching brightness. */
  luma: { width: number; height: number; data: Float32Array }
  /** Parts marked not to use, if any. */
  keepOut?: KeepOut
}

/** Big enough for any sky at full export size, small enough to keep a few in memory. */
const MAX_SIDE = 4096
const LUMA_SIDE = 64

const decoded = new Map<string, Promise<CollageImage | null>>()
/** Images the browser couldn't store (a private window), kept for this visit only. */
const sessionOnly = new Map<string, CollageImageRecord>()
/** Whether any collage image is only kept until the page closes (the browser wouldn't store it). */
export const collageImagesSessionOnly = (): boolean => sessionOnly.size > 0
const ready = new Map<string, CollageImage>()
const listeners = new Set<() => void>()

/** Hear when an image finishes loading, so a render can pick it up. */
export function onCollageImage(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** An image if it is loaded already; otherwise starts loading it and returns null. */
export function collageImageNow(id: string): CollageImage | null {
  const done = ready.get(id)
  if (done) return done
  void loadCollageImage(id)
  return null
}

export function loadCollageImage(id: string): Promise<CollageImage | null> {
  let pending = decoded.get(id)
  if (!pending) {
    pending = get<CollageImageRecord>(COLLAGE_STORE, id)
      .then((rec) => (rec ? decodeRecord(rec) : null))
      .catch(() => null)
      .then((img) => {
        if (img) {
          ready.set(id, img)
          listeners.forEach((l) => l())
        } else decoded.delete(id)
        return img
      })
    decoded.set(id, pending)
  }
  return pending
}

async function decodeRecord(rec: CollageImageRecord): Promise<CollageImage> {
  const full = await decodePhoto(rec.blob, rec.name)
  let bitmap = full
  const long = Math.max(full.width, full.height)
  if (long > MAX_SIDE) {
    const k = MAX_SIDE / long
    bitmap = await createImageBitmap(full, {
      resizeWidth: Math.round(full.width * k),
      resizeHeight: Math.round(full.height * k),
      resizeQuality: 'high',
    })
    full.close()
  }
  const small = (side: number) => {
    const k = side / Math.max(bitmap.width, bitmap.height)
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(bitmap.width * k))
    c.height = Math.max(1, Math.round(bitmap.height * k))
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height)
    return c
  }
  const thumb = small(96).toDataURL('image/jpeg', 0.8)
  const lc = small(LUMA_SIDE)
  const px = lc.getContext('2d')!.getImageData(0, 0, lc.width, lc.height).data
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const data = new Float32Array(lc.width * lc.height)
  for (let i = 0; i < data.length; i++)
    data[i] = 0.2126 * lin(px[i * 4]) + 0.7152 * lin(px[i * 4 + 1]) + 0.0722 * lin(px[i * 4 + 2])
  return { id: rec.id, name: rec.name, bitmap, thumb, luma: { width: lc.width, height: lc.height, data }, ...(readKeepOut(rec.keepOut) ? { keepOut: readKeepOut(rec.keepOut) } : {}) }
}

/** An image's parts not to use, kept with it (null: none), for every photo's collage. */
export async function setCollageKeepOut(id: string, keepOut: KeepOut | null): Promise<void> {
  const rec = sessionOnly.get(id) ?? (await get<CollageImageRecord>(COLLAGE_STORE, id).catch(() => undefined))
  if (!rec) return
  const next: CollageImageRecord = { ...rec }
  if (keepOut) next.keepOut = packKeepOut(keepOut)
  else delete next.keepOut
  if (sessionOnly.has(id)) sessionOnly.set(id, next)
  else await put(COLLAGE_STORE, next)
  const img = ready.get(id)
  if (img) {
    const updated: CollageImage = { ...img }
    if (keepOut) updated.keepOut = keepOut
    else delete updated.keepOut
    ready.set(id, updated)
    decoded.set(id, Promise.resolve(updated))
  }
  listeners.forEach((l) => l())
}

/** Mark a stored image as one of this photo's. */
async function tagPhoto(rec: CollageImageRecord, photo: number): Promise<void> {
  if (rec.photos?.includes(photo)) return
  await put(COLLAGE_STORE, { ...rec, photos: [...(rec.photos ?? []), photo] })
}

/** Add an image to the library for a photo (or find it there already). */
export async function addCollageImage(file: File | Blob, name: string, photo: number | null): Promise<CollageImage> {
  const id = `img_${(await sha256(file)).slice(0, 24)}`
  const stored = await get<CollageImageRecord>(COLLAGE_STORE, id).catch(() => undefined)
  if (stored) {
    if (photo !== null) await tagPhoto(stored, photo)
    const existing = await loadCollageImage(id)
    if (existing) return existing
  }
  // Decoded once to be sure it opens here (converted by the app if the webview can't), and for its size.
  const probe = await decodePhoto(file, name)
  const rec: CollageImageRecord = {
    id,
    name,
    blob: file,
    width: probe.width,
    height: probe.height,
    createdAt: Date.now(),
    photos: photo !== null ? [photo] : [],
  }
  probe.close()
  await put(COLLAGE_STORE, rec).catch(() => undefined)
  decoded.delete(id)
  const img = await loadCollageImage(id)
  if (img) return img
  // The browser wouldn't keep it (a private window can't store images): kept
  // in memory instead, for as long as this page is open.
  const kept = await decodeRecord(rec)
  sessionOnly.set(id, rec)
  ready.set(id, kept)
  decoded.set(id, Promise.resolve(kept))
  listeners.forEach((l) => l())
  return kept
}

/**
 * A photo's images, newest first, loaded: those added for it, and any its
 * pieces use (which become its own, for images stored before photos were
 * kept). No photo, no images.
 */
export async function listCollageImages(photo: number | null, used: string[] = []): Promise<CollageImage[]> {
  if (photo === null) return []
  const stored = await getAll<CollageImageRecord>(COLLAGE_STORE).catch(() => [] as CollageImageRecord[])
  const recs = [...stored, ...[...sessionOnly.values()].filter((m) => !stored.some((r) => r.id === m.id))].filter(
    (r) => r.photos?.includes(photo) || used.includes(r.id),
  )
  await Promise.all(recs.filter((r) => !r.photos?.includes(photo) && !sessionOnly.has(r.id)).map((r) => tagPhoto(r, photo).catch(() => undefined)))
  recs.sort((a, b) => b.createdAt - a.createdAt)
  const imgs = await Promise.all(recs.map((r) => loadCollageImage(r.id)))
  return imgs.filter((i): i is CollageImage => !!i)
}

/**
 * Take an image out of a photo's images. It is deleted once no photo has it,
 * so other photos' collages keep theirs.
 */
export async function removeCollageImage(id: string, photo: number): Promise<void> {
  const rec = await get<CollageImageRecord>(COLLAGE_STORE, id).catch(() => undefined)
  const rest = (rec?.photos ?? []).filter((p) => p !== photo)
  if (rec && rest.length) {
    await put(COLLAGE_STORE, { ...rec, photos: rest })
    return
  }
  await remove(COLLAGE_STORE, id)
  ready.get(id)?.bitmap.close()
  ready.delete(id)
  decoded.delete(id)
}

/** Put an image straight into the loaded set: for the self-test, which has no library. */
export function registerCollageImage(img: CollageImage): void {
  ready.set(img.id, img)
  decoded.set(img.id, Promise.resolve(img))
}

/** Whether the library holds this image (loaded or not). */
export async function hasCollageImage(id: string): Promise<boolean> {
  if (ready.has(id)) return true
  return !!(await get<CollageImageRecord>(COLLAGE_STORE, id).catch(() => undefined))
}

/**
 * What an export records of the collage's images (name, size, SHA-256), so
 * it can find them again on disk; images not in the library are left out.
 */
export async function collageImageRefs(ids: string[]): Promise<CollageImageRef[]> {
  const refs: CollageImageRef[] = []
  for (const id of new Set(ids)) {
    const rec = await get<CollageImageRecord>(COLLAGE_STORE, id).catch(() => undefined)
    if (rec) refs.push({ id, name: rec.name, size: rec.blob.size, sha256: await sha256(rec.blob) })
  }
  return refs
}
