import { invoke } from '@tauri-apps/api/core'
import { isNative, joinPath, readFile, removeFile, writeFile } from '../platform/native'
import { diskAvailable, diskFolder } from '../storage/disk'

/**
 * Camera RAW files. They are developed once, as the camera set them, by
 * macOS's own RAW engine (sips; see develop_raw in src-tauri/src/lib.rs and
 * the launcher's /__grain_develop_raw), into a full-quality sRGB JPEG that
 * keeps the RAW's EXIF; on Windows and Linux, in Rust (rawler; see
 * src-tauri/src/portable.rs). From there a RAW is like any photo: the Base modules
 * adjust it. This is a starting point, not a RAW developer.
 */
export const RAW_EXTENSIONS = [
  'orf', 'cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'raf', 'rw2', 'rwl', 'dng',
  'pef', 'srw', '3fr', 'fff', 'iiq', 'mos', 'mef', 'mrw', 'erf', 'kdc', 'dcr', 'x3f',
]

export const isRawName = (name: string): boolean => RAW_EXTENSIONS.includes(name.split('.').pop()?.toLowerCase() ?? '')

/** Whether RAW files can be opened here: in the app, or the launcher on a Mac. */
export const canOpenRaw = (): boolean => isNative() || diskAvailable()

/*
 * In the app, the last few RAW files developed are kept in the data folder,
 * by the RAW's SHA-256, so going back to one opens it at once instead of
 * developing it again. Only a few: each is a full-size JPEG.
 */
const KEEP_DEVELOPED = 12
const DEVELOPED_KEY = 'grainemulator.developed'
const developedPath = (sha: string) => joinPath(diskFolder() ?? '', 'developed', `${sha}.jpg`)
function keepDeveloped(sha: string) {
  let list: string[] = []
  try {
    list = JSON.parse(localStorage.getItem(DEVELOPED_KEY) ?? '[]') as string[]
  } catch {
    /* start again */
  }
  list = [sha, ...list.filter((s) => s !== sha)]
  for (const old of list.slice(KEEP_DEVELOPED)) void removeFile(developedPath(old))
  try {
    localStorage.setItem(DEVELOPED_KEY, JSON.stringify(list.slice(0, KEEP_DEVELOPED)))
  } catch {
    /* not kept: it is developed again next time */
  }
}

/** A RAW file developed to a JPEG as the camera set it. `sha` is the RAW's, to keep the result by. */
export async function developRaw(file: Blob, name: string, sha?: string): Promise<Blob> {
  const cache = isNative() && !!sha && !!diskFolder()
  if (cache) {
    const kept = await readFile(developedPath(sha))
    if (kept) {
      keepDeveloped(sha)
      return new Blob([kept], { type: 'image/jpeg' })
    }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (isNative()) {
    const out = await invoke<ArrayBuffer>('develop_raw', bytes, { headers: { 'x-name': encodeURIComponent(name) } })
    if (cache) {
      void writeFile(developedPath(sha), new Uint8Array(out)).then(() => keepDeveloped(sha)).catch(() => undefined)
    }
    return new Blob([out], { type: 'image/jpeg' })
  }
  if (diskAvailable()) {
    const res = await fetch('/__grain_develop_raw', { method: 'POST', body: bytes, headers: { 'x-name': encodeURIComponent(name) } })
    if (!res.ok) throw new Error(await res.text())
    return res.blob()
  }
  throw new Error('RAW files open in the desktop app. Here, export a JPEG from your RAW editor first.')
}
