import { RAW_EXTENSIONS } from '../pipeline/raw'
import { IMAGE_EXTENSIONS, mimeOf } from '../pipeline/formats'
import { decodePhoto } from '../pipeline/decode'
import { baseName, fileSha, isNative, joinPath, makeThumbnail, photoFiles, photoStats, readFile, writeFile, type PhotoFile } from '../platform/native'
import { LIBRARY_STORE, get, put } from './db'
import { diskFolder } from './disk'

/**
 * The library (desktop app only): the folders you added, and Recent, every photo
 * opened, from a folder or on its own. Photos stay where they are: a folder
 * is remembered as its path and read again whenever it is shown, a recent
 * photo by its own path, and nothing is copied or written beside the photos.
 * Each photo's edit is kept by its contents (storage/photoEdits.ts), so a
 * photo renamed or moved keeps its edit.
 *
 * In a browser there is no library: one photo at a time.
 */
export interface LibraryFolder {
  path: string
  name: string
}

export interface Library {
  folders: LibraryFolder[]
  /** What the Library and the filmstrip show: a folder's path, or RECENT. */
  current: string | null
}

/** Library.current for Recent, which no folder path can be. */
export const RECENT = ':recent'

const EMPTY: Library = { folders: [], current: ':recent' }

/** Whether there is a filmstrip here: folders are read by path, in the desktop app. */
export const libraryAvailable = (): boolean => isNative()

export async function loadLibrary(): Promise<Library> {
  if (!libraryAvailable()) return EMPTY
  const r = await get<{ folders?: unknown; current?: unknown }>(LIBRARY_STORE, 'folders')
  if (!r || !Array.isArray(r.folders)) return EMPTY
  const folders = r.folders
    .filter((f): f is LibraryFolder => !!f && typeof f.path === 'string')
    .map((f) => ({ path: f.path, name: typeof f.name === 'string' ? f.name : baseName(f.path) }))
  const current =
    r.current === RECENT || (typeof r.current === 'string' && folders.some((f) => f.path === r.current)) ? (r.current as string) : (folders[0]?.path ?? RECENT)
  return { folders, current }
}

/*
 * Recent: the photos opened, newest first, kept by path. A photo opened on
 * its own (not from a folder in the library) is found again here.
 */
export interface RecentPhoto {
  path: string
  name: string
  /** When it was last opened, ms. */
  at: number
}
const KEEP_RECENT = 300
let recent: RecentPhoto[] | null = null
const recentWatchers = new Set<(list: RecentPhoto[]) => void>()

export async function loadRecent(): Promise<RecentPhoto[]> {
  if (recent) return recent
  if (!libraryAvailable()) return (recent = [])
  const r = await get<{ list?: unknown }>(LIBRARY_STORE, 'recent')
  recent = (Array.isArray(r?.list) ? r.list : [])
    .filter((p): p is RecentPhoto => !!p && typeof p.path === 'string')
    .map((p) => ({ path: p.path, name: typeof p.name === 'string' ? p.name : baseName(p.path), at: typeof p.at === 'number' ? p.at : 0 }))
  return recent
}

async function setRecent(list: RecentPhoto[]) {
  recent = list.slice(0, KEEP_RECENT)
  await put(LIBRARY_STORE, { id: 'recent', list: recent })
  for (const w of recentWatchers) w(recent)
}

/** A photo opened: first in Recent. */
export async function addRecent(path: string, name: string): Promise<void> {
  if (!libraryAvailable()) return
  const list = await loadRecent()
  await setRecent([{ path, name, at: Date.now() }, ...list.filter((p) => p.path !== path)])
}

/** Out of Recent; the photo and its edit stay. */
export async function removeRecent(path: string): Promise<void> {
  await setRecent((await loadRecent()).filter((p) => p.path !== path))
}

const folderWatchers = new Set<() => void>()
/** Files in the library's folders were written (an export): read them again. */
export function folderChanged(): void {
  for (const w of folderWatchers) w()
}
export function onFolderChanged(watch: () => void): () => void {
  folderWatchers.add(watch)
  return () => folderWatchers.delete(watch)
}

/** Called with Recent whenever it changes. */
export function onRecent(watch: (list: RecentPhoto[]) => void): () => void {
  recentWatchers.add(watch)
  return () => recentWatchers.delete(watch)
}

export async function saveLibrary(lib: Library): Promise<void> {
  await put(LIBRARY_STORE, { id: 'folders', folders: lib.folders, current: lib.current })
}

/** What the filmstrip shows and opens: every photo format (pipeline/formats.ts) and camera RAW. */
const EXTENSIONS = [...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS]

/** A folder's photos by name, or Recent's newest first (those still where they were). */
export async function listPhotos(folder: string): Promise<PhotoFile[]> {
  if (folder === RECENT) return photoStats((await loadRecent()).map((p) => p.path))
  return photoFiles(folder, EXTENSIONS)
}

/** The extensions the library shows and opens, for the Open dialog. */
export const PHOTO_EXTENSIONS = EXTENSIONS

/** A photo as it was when last seen: a changed file is hashed and thumbnailed again. */
const fileKey = (f: PhotoFile) => `${f.path}|${f.size}|${f.modified}`

/*
 * Each photo's SHA-256, kept by path, size and time, so a folder's photos
 * are hashed once (on the app's side, one at a time) and then known.
 */
let index: Map<string, string> | null = null
let indexLoad: Promise<Map<string, string>> | null = null
let indexTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Before 1.0.8 an export opened as its original was kept here under the
 * original's SHA-256 (App's rememberSha), so the library took the export for
 * the original: exporting it again drew the edit over the old export. Once,
 * every file still as it was kept is hashed again and put right.
 */
const INDEX_CHECKED = 2

function loadIndex(): Promise<Map<string, string>> {
  indexLoad ??= get<{ map?: Record<string, string>; checked?: number }>(LIBRARY_STORE, 'index').then(async (r) => {
    index = new Map(Object.entries(r?.map ?? {}))
    if (r?.map && r.checked !== INDEX_CHECKED && isNative()) {
      const paths = [...new Set([...index.keys()].map((k) => k.slice(0, k.indexOf('|'))))]
      for (const f of await photoStats(paths).catch(() => [])) {
        const key = fileKey(f)
        const was = index.get(key)
        if (!was) continue
        const sha = await fileSha(f.path).catch(() => was)
        if (sha !== was) index.set(key, sha)
      }
      indexChecked = true
      saveIndexSoon()
    } else indexChecked = r?.checked === INDEX_CHECKED || !r?.map
    return index
  })
  return indexLoad
}
let indexChecked = false

function saveIndexSoon() {
  if (indexTimer) clearTimeout(indexTimer)
  indexTimer = setTimeout(() => {
    if (index) void put(LIBRARY_STORE, { id: 'index', map: Object.fromEntries(index), ...(indexChecked ? { checked: INDEX_CHECKED } : {}) })
  }, 1500)
}

/** The photo's SHA-256 if it is already known; no work. */
export async function knownSha(f: PhotoFile): Promise<string | null> {
  return (await loadIndex()).get(fileKey(f)) ?? null
}

/** The photo's SHA-256, hashed now if it is not known yet. */
export async function shaOf(f: PhotoFile): Promise<string> {
  const map = await loadIndex()
  const known = map.get(fileKey(f))
  if (known) return known
  const sha = await fileSha(f.path)
  map.set(fileKey(f), sha)
  saveIndexSoon()
  return sha
}

/**
 * The SHA-256s the file at f's path had before (another size or time),
 * newest first: what was there before it was written over.
 */
export async function earlierShas(f: PhotoFile): Promise<string[]> {
  const map = await loadIndex()
  const prefix = `${f.path}|`
  const now = fileKey(f)
  return [...map.entries()]
    .filter(([k]) => k.startsWith(prefix) && k !== now)
    .map(([k, sha]) => ({ at: Number(k.slice(k.lastIndexOf('|') + 1)) || 0, sha }))
    .sort((a, b) => b.at - a.at)
    .map((e) => e.sha)
}

/** Remember a photo's hash found another way (it was opened). */
export async function rememberSha(f: PhotoFile, sha: string): Promise<void> {
  const map = await loadIndex()
  if (map.get(fileKey(f)) === sha) return
  map.set(fileKey(f), sha)
  saveIndexSoon()
}

/*
 * The photo itself small, for a photo with no edit yet: made by macOS (RAW
 * files too) into the app's data folder, named for the file as it is now,
 * and read back as an object URL. A few at a time.
 */
// Sharp at a few photos to a row in the Library, on a high-density screen too.
const THUMB_SIZE = 640
const thumbs = new Map<string, Promise<string>>()
let running = 0
const waiting: (() => void)[] = []
const slot = () =>
  running < 3
    ? (running++, Promise.resolve())
    : new Promise<void>((resolve) => waiting.push(() => (running++, resolve())))
const release = () => {
  running--
  waiting.shift()?.()
}

async function keyHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function photoThumb(f: PhotoFile): Promise<string> {
  const key = fileKey(f)
  let made = thumbs.get(key)
  if (made) return made
  made = (async () => {
    const dir = diskFolder()
    if (!dir) throw new Error('no data folder')
    // The size in the name: thumbnails made smaller before are made again.
    const out = joinPath(dir, 'thumbs', `${await keyHash(`${key}@${THUMB_SIZE}`)}.jpg`)
    let bytes = await readFile(out)
    if (!bytes) {
      await slot()
      try {
        await makeThumbnail(f.path, out, THUMB_SIZE)
      } catch (err) {
        // Off the Mac, Rust reads no HEIC or AVIF: the webview may (AVIF in Windows' own), so it draws the thumbnail.
        const made = await webviewThumb(f).catch(() => null)
        if (!made) throw err
        await writeFile(out, made)
      } finally {
        release()
      }
      bytes = await readFile(out)
    }
    if (!bytes) throw new Error(`no thumbnail for ${f.name}`)
    return URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  })()
  made.catch(() => thumbs.delete(key))
  thumbs.set(key, made)
  return made
}

/** A thumbnail JPEG drawn by the webview, for a photo the app's own reader can't read. */
async function webviewThumb(f: PhotoFile): Promise<Uint8Array | null> {
  if (RAW_EXTENSIONS.includes(f.name.split('.').pop()?.toLowerCase() ?? '')) return null
  const own = await readPhoto(f)
  if (!own) return null
  const bitmap = await decodePhoto(own, f.name)
  const k = Math.min(1, THUMB_SIZE / Math.max(bitmap.width, bitmap.height))
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(bitmap.width * k)), Math.max(1, Math.round(bitmap.height * k)))
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Uint8Array(await (await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })).arrayBuffer())
}

/** The photo's bytes, to open it. */
export async function readPhoto(f: PhotoFile): Promise<Blob | null> {
  const bytes = await readFile(f.path)
  if (!bytes) return null
  return new Blob([bytes], { type: mimeOf(f.name) })
}
