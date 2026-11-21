import { diskAvailable, diskGet, diskGetAll, diskPut, diskRemove, probeDisk } from './disk'
const DB_NAME = 'grainemulator'
// 4 briefly added a store that is gone again; the number stays, since a
// browser already on 4 cannot open the database as 3. 5 adds the collage
// image library, 6 the timelapses, 7 each photo's own edit.
const DB_VERSION = 7

export const PLATE_STORE = 'plates'
export const PRESET_STORE = 'presets'
/** What is open right now — the photo — so a reload picks up where you were. */
export const SESSION_STORE = 'session'
/** Section presets: a saved border, grain, colour… on its own (storage/parts.ts). */
export const PART_STORE = 'parts'
/** Images for the Collage section (storage/collageImages.ts). */
export const COLLAGE_STORE = 'collage'
/** Timelapse recordings: what each is (storage/timelapses.ts)... */
export const TIMELAPSE_STORE = 'timelapses'
/** ...and its changes, compressed, apart so listing them reads none. */
export const TIMELAPSE_DATA_STORE = 'timelapse-data'
/** Each photo's edit, under its SHA-256 (storage/photoEdits.ts). */
export const EDIT_STORE = 'edits'
/** The folders in the filmstrip, and what is known of their photos (storage/library.ts). */
export const LIBRARY_STORE = 'library'

export interface PlateRecord {
  id: string
  name: string
  blob: Blob
  width: number
  height: number
  createdAt: number
}

export interface PresetRecord {
  id: string
  name: string
  /** Serialised preset document, see storage/presets.ts */
  data: unknown
  updatedAt: number
}

let dbPromise: Promise<IDBDatabase> | null = null
let unavailableReason: string | null = null
let blockedListener: ((reason: string | null) => void) | null = null

/** Hear when storage is blocked by another tab, and when it clears. */
export function onStorageBlocked(listener: (reason: string | null) => void): void {
  blockedListener = listener
}

/**
 * Why storage is not working, if it is not. Opaque origins — a page opened
 * from a file:// URL, or a sandboxed frame — refuse IndexedDB outright, and
 * private windows can too. The app has to keep working without it: the plate
 * and preset libraries go away, but loading an image and exporting one do not
 * depend on them.
 */
export function storageUnavailableReason(): string | null {
  return unavailableReason
}

export function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      let req: IDBOpenDBRequest
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION)
      } catch (error) {
        unavailableReason = (error as Error).name === 'SecurityError'
          ? 'Browser storage is blocked here, so saved plates and presets are unavailable. Serve the app over http rather than opening the file directly.'
          : `Browser storage is unavailable: ${(error as Error).message}`
        reject(error)
        return
      }
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(PLATE_STORE)) {
          db.createObjectStore(PLATE_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(PRESET_STORE)) {
          db.createObjectStore(PRESET_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          db.createObjectStore(SESSION_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(PART_STORE)) {
          db.createObjectStore(PART_STORE, { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains(COLLAGE_STORE)) {
          db.createObjectStore(COLLAGE_STORE, { keyPath: 'id' })
        }
        for (const store of [TIMELAPSE_STORE, TIMELAPSE_DATA_STORE, EDIT_STORE, LIBRARY_STORE])
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath: 'id' })
      }
      // Another tab holding an older version open blocks the upgrade until it
      // lets go; say so rather than leaving saves hanging silently.
      req.onblocked = () => {
        unavailableReason = 'copyshop is open in another tab on an older version. Close or reload it so your photo and settings can be saved.'
        blockedListener?.(unavailableReason)
      }
      req.onsuccess = () => {
        const db = req.result
        if (unavailableReason?.startsWith('copyshop is open in another tab')) {
          unavailableReason = null
          blockedListener?.(null)
        }
        // And never be that tab: when a newer version wants to upgrade, close
        // this connection so it can. The next access reopens it.
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
        resolve(db)
      }
      req.onerror = () => {
        unavailableReason = 'Browser storage could not be opened, so saved plates and presets are unavailable.'
        reject(req.error)
      }
    })
  }
  return dbPromise
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const req = fn(tx.objectStore(store))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

/**
 * Reads fall back to nothing and writes to no-ops when storage is unavailable,
 * rather than rejecting. A missing library should cost the user their saved
 * plates, not the whole application.
 */
export const idbPut = <T>(store: string, value: T) =>
  run<IDBValidKey>(store, 'readwrite', (s) => s.put(value)).catch(() => undefined)
export const idbGet = <T>(store: string, id: string) =>
  run<T | undefined>(store, 'readonly', (s) => s.get(id)).catch(() => undefined)
export const idbGetAll = <T>(store: string) =>
  run<T[]>(store, 'readonly', (s) => s.getAll()).catch(() => [] as T[])
export const idbRemove = (store: string, id: string) =>
  run<undefined>(store, 'readwrite', (s) => s.delete(id)).catch(() => undefined)

// The library and session go to disk when the launcher offers it (see
// disk.ts), to the browser otherwise. Things only a browser can hold — a
// folder handle — use the idb* functions directly.
/**
 * A save that didn't go through (the browser's storage full, a private
 * window, the disk): heard by the app, which says so, so nothing is lost
 * without anyone knowing. Saving still doesn't throw, so a missing store
 * costs that save, not the application.
 */
const saveFailures = new EventTarget()
export function onSaveFailed(listener: (store: string, reason: string) => void): () => void {
  const fn = (e: Event) => {
    const { store, reason } = (e as CustomEvent<{ store: string; reason: string }>).detail
    listener(store, reason)
  }
  saveFailures.addEventListener('failed', fn)
  return () => saveFailures.removeEventListener('failed', fn)
}
const failed = (store: string) => (err: unknown) => {
  const reason = err instanceof Error ? err.message : String(err)
  saveFailures.dispatchEvent(new CustomEvent('failed', { detail: { store, reason } }))
  return undefined
}

export const put = <T>(store: string, value: T): Promise<IDBValidKey | undefined> =>
  diskAvailable()
    ? diskPut(store, value as { id: string } & Record<string, unknown>).catch(failed(store))
    : run<IDBValidKey>(store, 'readwrite', (s) => s.put(value)).catch(failed(store))
export const get = <T>(store: string, id: string): Promise<T | undefined> =>
  diskAvailable() ? diskGet<T>(store, id).catch(() => undefined) : idbGet<T>(store, id)
export const getAll = <T>(store: string): Promise<T[]> =>
  diskAvailable() ? diskGetAll<T>(store).catch(() => [] as T[]) : idbGetAll<T>(store)
export const remove = (store: string, id: string): Promise<undefined> =>
  diskAvailable() ? diskRemove(store, id).then(() => undefined) : idbRemove(store, id)

/** localStorage values kept on disk as well, so the session survives too. */
const MIRRORED_KEYS = ['grainemulator.session', 'grainemulator.snapshots']
const LOCAL_STORE = 'local'

export function mirrorLocal(key: string, value: string): void {
  if (diskAvailable()) void diskPut(LOCAL_STORE, { id: key, value }).catch(() => undefined)
}

/**
 * Interface preferences (panel widths, open sections, toggles: the `ui.*`
 * keys) go to disk as one record, so they survive clearing the browser too.
 * Written a moment after the last change, since dragging a panel edge or
 * opening sections sets them in bursts.
 */
const UI_PREFS_ID = 'grainemulator.ui'
const UI_PREFIX = 'ui.'
let uiPrefsTimer: ReturnType<typeof setTimeout> | null = null

export function mirrorUiPref(): void {
  if (!diskAvailable()) return
  if (uiPrefsTimer) clearTimeout(uiPrefsTimer)
  uiPrefsTimer = setTimeout(() => {
    const prefs: Record<string, string> = {}
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (key?.startsWith(UI_PREFIX)) prefs[key] = localStorage.getItem(key) ?? ''
    }
    void diskPut(LOCAL_STORE, { id: UI_PREFS_ID, value: JSON.stringify(prefs) }).catch(() => undefined)
  }, 400)
}

/**
 * Before the app renders: find out whether disk storage is available and, if
 * so, seed the browser's synchronous copy of the session from disk (disk
 * wins), and move anything still only in the browser onto disk, once.
 */
export async function initStorage(): Promise<void> {
  if (!(await probeDisk())) {
    // In the browser: ask it to keep the app's storage, so recipes and edits
    // aren't cleared after a while without a visit (Safari does, unless asked).
    void navigator.storage?.persist?.().catch(() => false)
    return
  }
  for (const key of MIRRORED_KEYS) {
    const rec = await diskGet<{ value: string }>(LOCAL_STORE, key).catch(() => undefined)
    if (rec?.value) {
      try {
        localStorage.setItem(key, rec.value)
      } catch {
        /* the app will read from its own state */
      }
    } else {
      const local = localStorage.getItem(key)
      if (local) mirrorLocal(key, local)
    }
  }
  const prefs = await diskGet<{ value: string }>(LOCAL_STORE, UI_PREFS_ID).catch(() => undefined)
  if (prefs?.value) {
    try {
      for (const [key, value] of Object.entries(JSON.parse(prefs.value) as Record<string, string>))
        if (key.startsWith(UI_PREFIX)) localStorage.setItem(key, value)
    } catch {
      /* defaults it is */
    }
  } else mirrorUiPref()
  if (await diskGet('meta', 'migrated').catch(() => undefined)) return
  try {
    for (const store of [PRESET_STORE, PLATE_STORE]) {
      for (const rec of await idbGetAll<{ id: string } & Record<string, unknown>>(store)) await diskPut(store, rec)
    }
    const photo = await idbGet<{ id: string } & Record<string, unknown>>(SESSION_STORE, 'photo')
    if (photo) await diskPut(SESSION_STORE, photo)
    await diskPut('meta', { id: 'migrated', at: Date.now() })
  } catch {
    /* try again next launch */
  }
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`
}
