import { nativeFolder } from '../batch/fsAccess'
import { decodePhoto } from '../pipeline/decode'
import { isRawName } from '../pipeline/raw'
import { isMac } from '../platform/os'
import { photoSeed } from '../pipeline/render'
import type { PhotoFile } from '../platform/native'
import { findArchivedOriginal } from '../storage/archive'
import type { ExportState } from '../storage/exports'
import { readPhoto } from '../storage/library'
import { loadEdit } from '../storage/photoEdits'
import { previewKey, readPreview, writePreview } from '../storage/previews'
import { sha256 } from '../storage/recipe'
import { editThumb } from './RecipeThumb'

/** The longest side a photo is shown at in the Library's large view: about a big screen's. */
export const LOUPE_SIDE = 2400

export interface LibraryEdit {
  sha: string
  /**
   * The file's own SHA-256: the original's (sha) when the file is the
   * original, another when it is an export written in its place.
   */
  own: string
  state: ExportState
  /** When the edit was last saved: a newer one is a different picture. */
  updatedAt: number
}

/*
 * The pictures the Library's large view shows, by photo and edit, the newest
 * few kept in memory so stepping back is instant and its neighbours can be
 * made ahead (prefetch).
 */
const KEEP = 24
const made = new Map<string, Promise<{ url: string; owned: boolean } | null>>()

/**
 * A photo as it looks, to show large: the file itself when it is as edited
 * (or has no edit); else its kept preview (storage/previews.ts); else its
 * edit drawn from the original, kept as a preview for next time. `lane`
 * keeps a picture made ahead from replacing the one on show.
 */
export function libraryPicture(file: PhotoFile, edit: LibraryEdit | null, lane: string): Promise<string | null> {
  const id = `${file.path}|${file.modified}|${edit?.sha ?? ''}|${edit?.own ?? ''}|${edit?.state ?? ''}|${edit?.updatedAt ?? 0}`
  let p = made.get(id)
  if (p) {
    made.delete(id)
    made.set(id, p)
    return p.then((r) => r?.url ?? null)
  }
  p = make(file, edit, lane).catch(() => null)
  made.set(id, p)
  void p.then((r) => !r && made.delete(id))
  while (made.size > KEEP) {
    const [old, gone] = made.entries().next().value!
    made.delete(old)
    void gone.then((r) => r?.owned && URL.revokeObjectURL(r.url))
  }
  return p.then((r) => r?.url ?? null)
}

async function make(file: PhotoFile, edit: LibraryEdit | null, lane: string): Promise<{ url: string; owned: boolean } | null> {
  // The file itself when there is no edit, or when it is the export of the
  // latest edit, written in its place. An export saved to another folder
  // leaves the original here: its edit is drawn, as for one not exported.
  if (!edit || (edit.state === 'exported' && edit.own !== edit.sha)) {
    // Shown as the file itself where the webview shows it; else the thumbnail.
    if (isRawName(file.name) || !(isMac() || /\.(jpe?g|png|webp|gif|bmp|avif)$/i.test(file.name))) return null
    const own = await readPhoto(file)
    return own ? { url: URL.createObjectURL(own), owned: true } : null
  }
  const saved = await loadEdit(edit.sha)
  if (!saved) return null
  const key = await previewKey(edit.sha, saved.doc)
  const kept = await readPreview(key)
  if (kept) return { url: kept, owned: false }
  // Drawn from the original: the file itself, or the one in Originals/ beside an export in its place.
  const own = await readPhoto(file)
  if (!own) return null
  const original =
    (await sha256(own)) === edit.sha
      ? own
      : await findArchivedOriginal(nativeFolder(file.path.slice(0, file.path.length - file.name.length - 1)), saved.name, edit.sha)
  if (!original || isRawName(saved.name)) return null
  const bitmap = await decodePhoto(original, saved.name)
  const k = Math.min(1, LOUPE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * k)
  canvas.height = Math.round(bitmap.height * k)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const drawn = await editThumb(canvas, saved.doc.blend.photoSeed ?? photoSeed(edit.sha), saved.doc, saved.doc.blend, LOUPE_SIDE, { lane })
  const blob = await (await fetch(drawn)).blob()
  void writePreview(key, blob)
  return { url: URL.createObjectURL(blob), owned: true }
}
