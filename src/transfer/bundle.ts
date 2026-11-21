import {
  COLLAGE_STORE,
  EDIT_STORE,
  PART_STORE,
  PLATE_STORE,
  PRESET_STORE,
  SESSION_STORE,
  get,
  getAll,
  mirrorLocal,
  put,
} from '../storage/db'
import { loadPhoto } from '../storage/session'

/**
 * Everything the browser version has that the desktop app should open with: the
 * photo that's open and its edit, every photo's saved edit, saved recipes and
 * section presets, imported grain plates, and the collage library (which also
 * holds double-exposure photos).
 *
 * The browser and the app keep the same records in the same stores, so a
 * bundle is those records as they are, with each Blob field moved out into a
 * binary section and put back on the way in.
 *
 * Layout: "CSB1", the manifest's length (u32, little-endian), the manifest
 * (JSON), then the blobs back to back.
 */

const MAGIC = 'CSB1'
const LOCAL_KEYS = ['grainemulator.session', 'grainemulator.snapshots']
/** Under the server's upload limit, after encryption adds its 28 bytes. */
export const MAX_BUNDLE_BYTES = 94 * 1024 * 1024

type Rec = { id: string } & Record<string, unknown>

export interface BundleContents {
  local: Record<string, string>
  stores: Record<string, Rec[]>
}

interface BlobRef {
  $blob: number
}
interface Manifest {
  version: 1
  createdAt: number
  local: Record<string, string>
  stores: Record<string, unknown[]>
  blobs: { offset: number; size: number; type: string }[]
}

const isBlobRef = (v: unknown): v is BlobRef =>
  typeof v === 'object' && v !== null && typeof (v as BlobRef).$blob === 'number' && Object.keys(v).length === 1

export async function pack(contents: BundleContents): Promise<Uint8Array<ArrayBuffer>> {
  const blobs: Blob[] = []
  const strip = (v: unknown): unknown => {
    if (v instanceof Blob) return { $blob: blobs.push(v) - 1 }
    if (Array.isArray(v)) return v.map(strip)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]))
    return v
  }
  const stores = Object.fromEntries(Object.entries(contents.stores).map(([s, recs]) => [s, recs.map(strip)]))
  let offset = 0
  const refs = blobs.map((b) => {
    const r = { offset, size: b.size, type: b.type }
    offset += b.size
    return r
  })
  const manifest: Manifest = { version: 1, createdAt: Date.now(), local: contents.local, stores, blobs: refs }
  const head = new TextEncoder().encode(JSON.stringify(manifest))
  const out = new Uint8Array(8 + head.length + offset)
  out.set(new TextEncoder().encode(MAGIC), 0)
  new DataView(out.buffer).setUint32(4, head.length, true)
  out.set(head, 8)
  let at = 8 + head.length
  for (const b of blobs) {
    out.set(new Uint8Array(await b.arrayBuffer()), at)
    at += b.size
  }
  return out
}

export function unpack(bytes: Uint8Array): BundleContents {
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== MAGIC) throw new Error('This is not a copyshop transfer.')
  const len = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true)
  const manifest = JSON.parse(new TextDecoder().decode(bytes.subarray(8, 8 + len))) as Manifest
  if (manifest.version !== 1) throw new Error('This transfer is from a newer copyshop. Update the app and try again.')
  const base = 8 + len
  const blobs = manifest.blobs.map((b) => new Blob([bytes.slice(base + b.offset, base + b.offset + b.size)], { type: b.type }))
  const restore = (v: unknown): unknown => {
    if (isBlobRef(v)) return blobs[v.$blob]
    if (Array.isArray(v)) return v.map(restore)
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restore(x)]))
    return v
  }
  const stores = Object.fromEntries(
    Object.entries(manifest.stores).map(([s, recs]) => [s, recs.map(restore).filter((r): r is Rec => typeof (r as Rec)?.id === 'string')]),
  )
  return { local: manifest.local ?? {}, stores }
}

/** Reads what the browser version has into a bundle's contents. */
export async function collect(): Promise<BundleContents> {
  const local: Record<string, string> = {}
  for (const key of LOCAL_KEYS) {
    const value = localStorage.getItem(key)
    if (value !== null) local[key] = value
  }
  // Through the session's own loader, which also finds a photo a private
  // window could only keep in localStorage.
  const photo = await loadPhoto()
  const stores: Record<string, Rec[]> = { [SESSION_STORE]: photo && !photo.path ? [{ id: 'photo', name: photo.name, blob: photo.blob }] : [] }
  for (const store of [PRESET_STORE, PART_STORE, PLATE_STORE, EDIT_STORE, COLLAGE_STORE]) {
    stores[store] = (await getAll<Rec>(store)).filter((r) => r.builtIn !== true)
  }
  return { local, stores }
}

/** Whether there's anything worth carrying over. */
export const hasContent = (c: BundleContents): boolean =>
  Object.values(c.stores).some((recs) => recs.length > 0) || 'grainemulator.session' in c.local

/**
 * Writes a bundle's contents into this copy of copyshop. The open photo and
 * its edit replace whatever was open; everything else is added beside what's
 * there (records keep their ids, so the same recipe isn't doubled), except a
 * photo's edit made here more recently, which is kept.
 */
export async function restore(contents: BundleContents): Promise<void> {
  for (const [store, recs] of Object.entries(contents.stores)) {
    for (const rec of recs) {
      // A photo's edit made here since is newer: kept, not replaced by the one brought over.
      if (store === EDIT_STORE) {
        const here = await get<Rec>(store, String(rec.id))
        if (here && Number(here.updatedAt) > Number(rec.updatedAt)) continue
      }
      await put(store, rec)
    }
  }
  for (const [key, value] of Object.entries(contents.local)) {
    if (!LOCAL_KEYS.includes(key)) continue
    try {
      localStorage.setItem(key, value)
    } catch {
      /* the disk copy below still has it */
    }
    mirrorLocal(key, value)
  }
}
