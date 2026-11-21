import { browserFolder, ensureWritePermission, nativeFolder, pickDirectory, type Folder } from '../batch/fsAccess'
import { findOriginal, isNative } from '../platform/native'
import { SESSION_STORE, idbGet, idbPut, idbRemove, get, put, remove } from './db'
import { diskAvailable } from './disk'
import { readRecipe, sha256 } from './recipe'
import { loadExports, originalOf } from './exports'

/**
 * The export folder, with an archive of originals inside it.
 *
 * Exporting writes the final under the original's own name — it becomes the
 * photo — and keeps the original in `Originals/` beside it, so the folder
 * holds one file per photo and nothing is lost. The archived original is
 * never overwritten: re-exporting after a re-edit replaces the final only.
 *
 * Chosen once. In the desktop app it is remembered as a path, with the rest
 * of the session; in a browser its handle is kept in IndexedDB and the
 * browser asks to confirm access again after a restart, on the next export.
 */
export const ARCHIVE_DIR = 'Originals'

interface FolderRecord {
  id: 'exportFolder'
  handle: FileSystemDirectoryHandle
}
interface PathRecord {
  id: 'exportFolderPath'
  path: string
}

export async function getExportFolder(): Promise<Folder | null> {
  if (isNative()) {
    const rec = await get<PathRecord>(SESSION_STORE, 'exportFolderPath')
    return rec?.path ? nativeFolder(rec.path) : null
  }
  const handle = (await idbGet<FolderRecord>(SESSION_STORE, 'exportFolder'))?.handle
  return handle ? browserFolder(handle) : null
}

export async function chooseExportFolder(): Promise<Folder> {
  const folder = await pickDirectory('readwrite', 'grain-export')
  if (folder.path) await put<PathRecord>(SESSION_STORE, { id: 'exportFolderPath', path: folder.path })
  else if (folder.handle) await idbPut<FolderRecord>(SESSION_STORE, { id: 'exportFolder', handle: folder.handle })
  return folder
}

export async function forgetExportFolder(): Promise<void> {
  if (isNative()) await remove(SESSION_STORE, 'exportFolderPath')
  else await idbRemove(SESSION_STORE, 'exportFolder')
}

export interface ArchiveResult {
  finalName: string
  /** What happened to the original. */
  original: 'archived' | 'already archived'
  /**
   * A file that was where the export goes and was neither the photo nor an
   * export of it (a new version from another app, say): kept in Originals/
   * under this name rather than written over.
   */
  kept?: string
}

/**
 * Write `final` as `<original stem>.<final ext>` and make sure the original
 * is safe in Originals/ first. Order matters: the original is copied and
 * checked before anything with its name is overwritten.
 */
export async function exportToFolder(
  dir: Folder,
  original: Blob,
  originalName: string,
  originalHash: string,
  final: Blob,
  finalExt: string,
): Promise<ArchiveResult> {
  if (!(await ensureWritePermission(dir))) throw new Error('No permission to write to the export folder.')
  const archive = (await dir.folder(ARCHIVE_DIR, true))!
  const existing = await archive.file(originalName)
  let state: ArchiveResult['original'] = 'already archived'
  if (!existing || (await sha256(existing)) !== originalHash) {
    // A different file under the same name is kept, not overwritten.
    const name = existing ? uniqueName(originalName, originalHash) : originalName
    await archive.write(name, original)
    const copied = await archive.file(name)
    if (!copied || copied.size !== original.size)
      throw new Error('Could not archive the original; nothing was overwritten.')
    state = 'archived'
  }
  const stem = originalName.replace(/\.[^.]+$/, '')
  const finalName = `${stem}.${finalExt}`
  // What is there now is written over only if it is the photo or an export of it.
  let kept: string | undefined
  const there = await dir.file(finalName).catch(() => null)
  if (there) {
    const sha = await sha256(there)
    const ours =
      sha === originalHash ||
      originalOf((await loadExports()).finals, sha) === originalHash ||
      (await readRecipe(there).catch(() => null))?.original.sha256 === originalHash
    if (!ours) {
      kept = uniqueName(finalName, sha)
      if (!(await archive.file(kept))) {
        await archive.write(kept, there)
        const copied = await archive.file(kept)
        if (!copied || copied.size !== there.size) throw new Error(`Could not keep the ${finalName} that was there; nothing was overwritten.`)
      }
    }
  }
  await dir.write(finalName, final)
  return { finalName, original: state, ...(kept ? { kept } : {}) }
}

function uniqueName(name: string, hash: string): string {
  const dot = name.lastIndexOf('.')
  const tag = hash.slice(0, 8)
  return dot > 0 ? `${name.slice(0, dot)}-${tag}${name.slice(dot)}` : `${name}-${tag}`
}

/** Whether the folder can be read now, without asking. */
export async function canReadFolder(dir: Folder): Promise<boolean> {
  return dir.canRead()
}

/**
 * Find an archived original by its hash, trying its name first.
 *
 * A browser only shows a permission prompt in answer to a click, and after a
 * restart the folder needs one again. So it is asked for only when `ask` is
 * set (call it from a click); otherwise an unreadable folder finds nothing,
 * and the caller offers a button that asks. The desktop app can always read.
 */
export async function findArchivedOriginal(
  dir: Folder,
  name: string,
  hash: string,
  ask = false,
): Promise<File | null> {
  if (!(await dir.canRead()) && !(ask && (await dir.requestAccess('read')))) return null
  const archive = await dir.folder(ARCHIVE_DIR, false)
  if (!archive) return null
  const named = await archive.file(name)
  if (named && (await sha256(named)) === hash) return named
  for (const entry of await archive.files(() => true)) {
    const file = await entry.getFile()
    if (file.size > 0 && (await sha256(file)) === hash) return file
  }
  return null
}

/**
 * Find an archived original anywhere on disk: Spotlight, by name, Originals/
 * first, checked by size and hash — so an export opened from wherever it was
 * moved to still finds its original. The desktop app asks the system
 * directly; in a browser the launcher does it (the browser can only read the
 * export folder after asking, from a click). Without either, nothing.
 */
export async function findOriginalOnDisk(name: string, size: number, hash: string): Promise<File | null> {
  if (isNative()) {
    const bytes = await findOriginal(name, size, hash)
    if (!bytes) return null
    const file = new File([bytes], name)
    return (await sha256(file)) === hash ? file : null
  }
  if (!diskAvailable()) return null
  try {
    const query = new URLSearchParams({ name, size: String(size), sha256: hash })
    const res = await fetch(`/__grain_find_original?${query}`, { cache: 'no-store' })
    if (!res.ok) return null
    const file = new File([await res.blob()], name)
    return (await sha256(file)) === hash ? file : null
  } catch {
    return null
  }
}
