import { dataDir, isNative, joinPath, listDir, readFile, removeFile, writeFile } from '../platform/native'

/**
 * Storage on disk: written directly by the desktop app, or through a local
 * server that offers /__grain_store (an older way of running copyshop in the
 * browser). There, presets, plates, the open photo, the session and snapshots
 * are plain files in a folder instead of browser storage. Without that route
 * (npm run dev) everything stays in the browser.
 *
 * Records are JSON; any Blob field is stored as its own file beside it and
 * restored on read, so a plate or a photo round-trips byte for byte. The app
 * and the launcher use the same folder and the same layout — <store>/<id>.json
 * and <store>/<id>.<field>.bin — so either finds what the other saved.
 */

const BASE = '/__grain_store'
let available = false
let folder: string | null = null

export const diskAvailable = () => available
export const diskFolder = () => folder

/** Ask the launcher whether disk storage is on offer; the app always has it. */
export async function probeDisk(): Promise<boolean> {
  if (isNative()) {
    try {
      folder = await dataDir()
      available = true
    } catch {
      available = false
    }
    return available
  }
  try {
    const res = await fetch(`${BASE}/`, { cache: 'no-store' })
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false
    const info = (await res.json()) as { ok?: boolean; dir?: string }
    available = !!info.ok
    folder = info.dir ?? null
  } catch {
    available = false
  }
  return available
}

const url = (...parts: string[]) => `${BASE}/${parts.map(encodeURIComponent).join('/')}`

interface BlobRef {
  $blob: string
  type: string
}
const isBlobRef = (v: unknown): v is BlobRef => !!v && typeof v === 'object' && '$blob' in (v as object)

/** Ids and store names become file names: keep them to safe characters, as the launcher does. */
const safe = (part: string) => /^[\w.@-]+$/.test(part) && part !== '.' && part !== '..'
const nativePath = (...parts: string[]) => {
  if (!parts.every(safe)) throw new Error('bad storage path')
  return joinPath(folder!, ...parts)
}

/**
 * A record's id as a file name. Most ids are file-safe already and are their
 * own name. Some are not: a folder's photo order is kept as
 * "order:/Users/…/Photos", a photo's reference as "ref:<sha>". Those get a
 * name of safe characters with a hash of the whole id, so they save in the app
 * as in the browser (the record keeps its real id inside it, which is what
 * listing reads). Before this they were refused ("bad storage path").
 */
export function fileId(id: string): string {
  if (safe(id)) return id
  // FNV-1a, 64 bits as two 32-bit halves: the same id is always the same name.
  let h1 = 0x811c9dc5
  let h2 = 0x01000193
  for (let i = 0; i < id.length; i++) {
    const c = id.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 ^ c, 0x811c9dc5 ^ 0x5bd1e995) >>> 0
  }
  const readable = id.replace(/[^\w.@-]+/g, '_').replace(/^[._]+/, '').slice(0, 48)
  return `x-${readable}-${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`
}

export async function diskPut(store: string, value: { id: string } & Record<string, unknown>): Promise<string> {
  const json: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) {
    if (v instanceof Blob) {
      if (isNative()) await writeFile(nativePath(store, `${fileId(value.id)}.${k}.bin`), v)
      else {
        const res = await fetch(url(store, value.id, k), { method: 'PUT', body: v })
        if (!res.ok) throw new Error(`Could not save ${store}/${value.id} to disk.`)
      }
      json[k] = { $blob: k, type: v.type } satisfies BlobRef
    } else {
      json[k] = v
    }
  }
  if (isNative()) {
    await writeFile(nativePath(store, `${fileId(value.id)}.json`), JSON.stringify(json))
    return value.id
  }
  const res = await fetch(url(store, value.id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(json),
  })
  if (!res.ok) throw new Error(`Could not save ${store}/${value.id} to disk.`)
  return value.id
}

async function hydrate<T>(store: string, raw: Record<string, unknown>): Promise<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(raw)) {
    if (isBlobRef(v)) {
      if (isNative()) {
        const bytes = await readFile(nativePath(store, `${fileId(String(raw.id))}.${v.$blob}.bin`))
        out[k] = new Blob(bytes ? [bytes] : [], { type: v.type })
      } else {
        const res = await fetch(url(store, String(raw.id), v.$blob))
        out[k] = new Blob([await res.arrayBuffer()], { type: v.type })
      }
    } else {
      out[k] = v
    }
  }
  return out as T
}

const parseJson = (bytes: Uint8Array) => JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>

export async function diskGet<T>(store: string, id: string): Promise<T | undefined> {
  if (isNative()) {
    const bytes = await readFile(nativePath(store, `${fileId(id)}.json`))
    return bytes ? hydrate<T>(store, parseJson(bytes)) : undefined
  }
  const res = await fetch(url(store, id), { cache: 'no-store' })
  if (!res.ok) return undefined
  return hydrate<T>(store, await res.json())
}

export async function diskGetAll<T>(store: string): Promise<T[]> {
  if (isNative()) {
    // Each file on its own: one damaged file is left out, not the whole list with it.
    const out: T[] = []
    for (const entry of await listDir(nativePath(store))) {
      if (!entry.isFile || !entry.name.endsWith('.json')) continue
      try {
        const bytes = await readFile(nativePath(store, entry.name))
        if (bytes) out.push(await hydrate<T>(store, parseJson(bytes)))
      } catch {
        /* unreadable: the rest still load */
      }
    }
    return out
  }
  const res = await fetch(url(store), { cache: 'no-store' })
  if (!res.ok) return []
  const list = (await res.json()) as Record<string, unknown>[]
  return Promise.all(list.map((r) => hydrate<T>(store, r)))
}

export async function diskRemove(store: string, id: string): Promise<void> {
  if (isNative()) {
    const name = fileId(id)
    for (const entry of await listDir(nativePath(store)))
      if (entry.name === `${name}.json` || entry.name.startsWith(`${name}.`)) await removeFile(nativePath(store, entry.name))
    return
  }
  await fetch(url(store, id), { method: 'DELETE' })
}
