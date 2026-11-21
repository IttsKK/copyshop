import { nativeFolder } from '../batch/fsAccess'
import type { BlendParams } from '../engine/types'
import type { SerializedGrainSource } from '../sources/GrainSource'
import { decodePhoto } from '../pipeline/decode'
import { isRawName } from '../pipeline/raw'
import { photoSeed } from '../pipeline/render'
import type { PhotoFile } from '../platform/native'
import { findArchivedOriginal } from '../storage/archive'
import { photoThumb } from '../storage/library'
import { loadEdit, removeEdit, saveEdit, thumbKey, type PhotoEdit } from '../storage/photoEdits'
import { PRESET_SCHEMA_VERSION, DEFAULT_OUTPUT, type PresetDoc } from '../storage/presets'
import { editThumb } from './RecipeThumb'
import type { Look } from './looks'

/** A change to an edit's settings and grain, the same for every photo it is made to. */
export type EditChange = (was: { blend: BlendParams; grainSource: SerializedGrainSource }) => { blend: BlendParams; grainSource: SerializedGrainSource }

/** The thumbnails are drawn from a picture about this long. */
const SMALL_SIDE = 640

/**
 * The photo small, as it was before any edit, to draw its edit's thumbnail
 * on: the Library's own thumbnail of the file, or, where an export was
 * written in its place, the original kept beside it. Null for a RAW whose
 * original only the app's developer reads.
 */
async function smallOriginal(f: PhotoFile, sha: string, own: string, name: string): Promise<HTMLCanvasElement | null> {
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  if (own === sha) {
    const img = new Image()
    img.src = await photoThumb(f)
    await img.decode()
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    ctx.drawImage(img, 0, 0)
    return canvas
  }
  if (isRawName(name)) return null
  const dir = f.path.slice(0, f.path.length - f.name.length - 1)
  const original = await findArchivedOriginal(nativeFolder(dir), name, sha)
  if (!original) return null
  const bitmap = await decodePhoto(original, name)
  const k = Math.min(1, SMALL_SIDE / Math.max(bitmap.width, bitmap.height))
  canvas.width = Math.round(bitmap.width * k)
  canvas.height = Math.round(bitmap.height * k)
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas
}

/**
 * A change made to a photo's saved edit from the Library, without opening
 * it: its edit (or, with none yet, the recipe a new photo starts with)
 * changed, its thumbnail drawn again so the grid shows it, and saved. `sha`
 * is the original's (what the edit is kept under); `own` the file's.
 */
export async function changeSavedEdit(f: PhotoFile, sha: string, own: string, change: EditChange, start: Look): Promise<PhotoEdit | null> {
  const saved = await loadEdit(sha)
  const base: PresetDoc = saved?.doc ?? { ...start.doc, schemaVersion: PRESET_SCHEMA_VERSION, name: f.name, output: DEFAULT_OUTPUT }
  const next = change({ blend: base.blend, grainSource: base.grainSource })
  const doc: PresetDoc = { ...base, blend: next.blend, grainSource: next.grainSource }
  const name = saved?.name || f.name
  const small = await smallOriginal(f, sha, own, name).catch(() => null)
  const thumb = small ? await editThumb(small, doc.blend.photoSeed ?? photoSeed(sha), doc, doc.blend).catch(() => '') : ''
  const at = Date.now()
  // Not drawn (the picture could not be made): the old one shows meanwhile, marked out of date, so it is drawn again when shown.
  await saveEdit({
    id: sha,
    name,
    doc,
    lookId: saved ? saved.lookId : start.id,
    presetId: saved?.presetId ?? '',
    thumb: thumb || saved?.thumb || '',
    ...(thumb ? { thumbFor: thumbKey(at) } : {}),
    updatedAt: at,
  })
  return saved
}

/**
 * A photo's thumbnail drawn again from its edit as it is, by this build,
 * without changing the edit: one drawn for an older edit, or by a build
 * that drew photos differently, or never drawn. Left as it is if the edit
 * changes meanwhile (the change draws its own).
 */
export async function redrawThumb(f: PhotoFile, sha: string, own: string): Promise<boolean> {
  const saved = await loadEdit(sha)
  if (!saved) return false
  const small = await smallOriginal(f, sha, own, saved.name || f.name).catch(() => null)
  if (!small) return false
  const thumb = await editThumb(small, saved.doc.blend.photoSeed ?? photoSeed(sha), saved.doc, saved.doc.blend).catch(() => '')
  if (!thumb) return false
  const now = await loadEdit(sha)
  // Changed meanwhile: that change draws its own.
  if (!now || now.updatedAt !== saved.updatedAt) return true
  await saveEdit({ ...now, thumb, thumbFor: thumbKey(now.updatedAt) })
  return true
}

/** A saved edit put back as it was before a change from the Library: none, if it had none. */
export async function restoreSavedEdit(sha: string, was: PhotoEdit | null): Promise<void> {
  if (was) await saveEdit({ ...was, updatedAt: Date.now() })
  else await removeEdit(sha)
}
