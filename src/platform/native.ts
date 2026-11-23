import { invoke } from '@tauri-apps/api/core'
import { ask as nativeAsk, open, save } from '@tauri-apps/plugin-dialog'

/**
 * The desktop app (Tauri). In a browser none of this is used: the browser
 * keeps its own folder handles and storage, and the launcher serves files.
 *
 * In the app the page talks to the disk directly, through the commands in
 * src-tauri/src/lib.rs: files by path, so a chosen folder is remembered as a
 * path and never needs its permission asked for again.
 */
export const isNative = (): boolean => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

/** A web page in the default browser (the app), or a new tab (a browser). A mailto: link opens the mail app. */
export async function openUrl(url: string): Promise<void> {
  if (isNative()) await invoke('open_url', { url })
  else if (url.startsWith('mailto:')) window.location.href = url
  else window.open(url, '_blank', 'noopener')
}

/** A folder opened in the Finder, or with `select`, a file shown selected in its folder. */
export async function revealInFinder(path: string, select = false): Promise<void> {
  await invoke('reveal', { path, select })
}

/** The bytes of a file, or null if there is none. */
export async function readFile(path: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('read_file', { path }))
  } catch {
    return null
  }
}

/** Move (rename) a file on the same disk; refuses to go over a file at `to`. */
export async function moveFile(from: string, to: string): Promise<void> {
  await invoke('move_file', { from, to })
}

/** Put a file in the Trash, from where it can be put back. */
export async function trashFile(path: string): Promise<void> {
  await invoke('trash_file', { path })
}

/** The first `len` bytes of a file, or null if it cannot be read. */
export async function readHead(path: string, len: number): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('read_head', { path, len }))
  } catch {
    return null
  }
}

/** Write a file whole, making its folder if needed; never left half-written. */
export async function writeFile(path: string, data: Blob | Uint8Array | string): Promise<void> {
  const bytes =
    typeof data === 'string'
      ? new TextEncoder().encode(data)
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : data
  await invoke('write_file', bytes, { headers: { 'x-path': encodeURIComponent(path) } })
}

export interface DirEntry {
  name: string
  isFile: boolean
}

/** What a folder holds; empty if it does not exist. */
export async function listDir(path: string): Promise<DirEntry[]> {
  try {
    return await invoke<DirEntry[]>('list_dir', { path })
  } catch {
    return []
  }
}

/** A photo in a folder of the library (see storage/library.ts). */
export interface PhotoFile {
  name: string
  path: string
  size: number
  /** Last changed, in milliseconds. */
  modified: number
}

/** The photos in a folder, by name: files with one of these extensions (lower case, no dot). */
export async function photoFiles(dir: string, extensions: string[]): Promise<PhotoFile[]> {
  return invoke<PhotoFile[]>('photo_files', { dir, extensions })
}

/** Photos by path (those still there), as photoFiles reads them. */
export async function photoStats(paths: string[]): Promise<PhotoFile[]> {
  return paths.length ? invoke<PhotoFile[]>('photo_stats', { paths }) : []
}

/** A small JPEG of a photo (RAW too) written to `out`, `size` px on its long side. */
export async function makeThumbnail(path: string, out: string, size: number): Promise<void> {
  await invoke('thumbnail', { path, out, size })
}

/** A file's SHA-256 in hex, read on the app's side so the page never loads it. */
export async function fileSha(path: string): Promise<string> {
  return invoke<string>('file_sha', { path })
}

export async function removeFile(path: string): Promise<void> {
  await invoke('remove_file', { path }).catch(() => {})
}

export async function makeDir(path: string): Promise<void> {
  await invoke('make_dir', { path })
}

/** Where presets, plates and the session are kept: the folder the launcher uses too. */
export async function dataDir(): Promise<string> {
  return invoke<string>('data_dir')
}

/**
 * An archived original found by Spotlight: by name (or the name Originals/
 * gives a clashing one), in an Originals folder first, and only a file of
 * this size and SHA-256. Null if none.
 */
export async function findOriginal(name: string, size: number, sha256: string): Promise<Uint8Array<ArrayBuffer> | null> {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>('find_original', { name, size, sha256 }))
  } catch {
    return null
  }
}

/**
 * Images whose SHA-256 starts with one of `prefixes`, found by walking
 * `roots` in order (~ is the home folder), until all are found. Empty
 * outside the app.
 */
export async function findByHash(roots: string[], prefixes: string[]): Promise<{ prefix: string; path: string }[]> {
  try {
    return await invoke<{ prefix: string; path: string }[]>('find_by_hash', { roots, prefixes })
  } catch {
    return []
  }
}

/** Photos chosen in the system's Open dialog, by path; none if cancelled. */
export async function pickPhotos(title: string, extensions: string[]): Promise<string[]> {
  const picked = await open({ multiple: true, directory: false, title, filters: [{ name: 'Photos', extensions }] })
  return Array.isArray(picked) ? picked : typeof picked === 'string' ? [picked] : []
}

export async function pickFolder(title: string): Promise<string | null> {
  const picked = await open({ directory: true, multiple: false, title })
  return typeof picked === 'string' ? picked : null
}

/** Save a file where the user says; false if they cancel. */
export async function saveAs(blob: Blob, defaultName: string): Promise<boolean> {
  return (await saveFileAs(blob, defaultName)) !== null
}

const FILE_KINDS: Record<string, { name: string; extensions: string[] }> = {
  jpg: { name: 'JPEG image', extensions: ['jpg', 'jpeg'] },
  jpeg: { name: 'JPEG image', extensions: ['jpeg', 'jpg'] },
  png: { name: 'PNG image', extensions: ['png'] },
  tif: { name: 'TIFF image', extensions: ['tif', 'tiff'] },
  tiff: { name: 'TIFF image', extensions: ['tiff', 'tif'] },
  webp: { name: 'WebP image', extensions: ['webp'] },
  mp4: { name: 'MP4 video', extensions: ['mp4'] },
  json: { name: 'Recipe', extensions: ['json'] },
}

/** The extension of a file name or path ('jpg'), lower case, or '' when it has none. */
export const extensionOf = (path: string): string => /\.([^./\\]+)$/.exec(path)?.[1]?.toLowerCase() ?? ''

/**
 * Where the Save dialog's answer is written. A name typed without an
 * extension gets the one it was offered with: a file with none shows on
 * Windows as a plain "File" that photo pickers (Instagram's) leave out.
 */
export function withExtension(path: string, offered: string): string {
  const ext = extensionOf(offered)
  return ext && !extensionOf(path) ? `${path}.${ext}` : path
}

/** The Save dialog, starting at `defaultPath` (a name, or a whole path for its folder too): where it was saved, or null if cancelled. */
export async function saveFileAs(blob: Blob, defaultPath: string): Promise<string | null> {
  // The file's type as the dialog's filter: Windows then adds the extension
  // to a name typed without one, and the Mac keeps it on.
  const kind = FILE_KINDS[extensionOf(defaultPath)]
  const chosen = await save({ defaultPath, ...(kind ? { filters: [kind] } : {}) })
  if (!chosen) return null
  // Linux's dialog doesn't add it.
  const path = withExtension(chosen, defaultPath)
  await writeFile(path, blob)
  return path
}

export function ask(message: string, labels?: { ok: string; cancel: string }): Promise<boolean> {
  return nativeAsk(message, { title: 'copyshop', kind: labels ? 'info' : 'warning', ...(labels ? { okLabel: labels.ok, cancelLabel: labels.cancel } : {}) })
}

export const joinPath = (...parts: string[]) => parts.join('/').replace(/\/+/g, '/')
export const baseName = (path: string) => path.replace(/\/+$/, '').split('/').pop() ?? path

/** A yes/no question: the app's own dialog, or the browser's (window.confirm does nothing in the app). */
export const confirmWith = (message: string, labels?: { ok: string; cancel: string }): Promise<boolean> =>
  isNative() ? ask(message, labels) : Promise.resolve(window.confirm(message))
