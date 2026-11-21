import { EDIT_STORE, get, getAll, put, remove } from './db'
import { parsePreset, presetToJson, type PresetDoc } from './presets'

/**
 * Each photo's own edit, kept under the photo's SHA-256: opening a photo
 * again, from anywhere and under any name, brings back where it was left.
 * Saved as it is edited (App), so switching photos never asks to save.
 *
 * Only the edit itself: its settings, grain, and which recipe it came from.
 * Export settings are the user's, and snapshots carry across photos, so
 * neither is kept here.
 */
export interface PhotoEdit {
  /** The photo's SHA-256. */
  id: string
  name: string
  doc: PresetDoc
  lookId: string | null
  presetId: string
  /** The edit small, as a JPEG data URL, for the filmstrip; '' until made. */
  thumb: string
  /** What the thumbnail was drawn for (thumbKey): this edit, by this build. Else it is drawn again when shown. */
  thumbFor?: string
  updatedAt: number
}

/** What the filmstrip needs of an edit: its thumbnail, what it was drawn for, and when the edit changed. */
export interface EditMark {
  thumb: string
  thumbFor?: string
  updatedAt: number
}

const BUILD = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'

/**
 * What a thumbnail drawn now shows: the edit as it was at `updatedAt`, as
 * this build of the app draws it. A build that draws photos differently
 * (a change to the renderer) draws its thumbnails again.
 */
export const thumbKey = (updatedAt: number): string => `${updatedAt}@${BUILD}`

/** Whether a thumbnail shows its edit as it is, as this build draws it. */
export const thumbCurrent = (m: EditMark): boolean => !!m.thumb && m.thumbFor === thumbKey(m.updatedAt)

export async function loadEdit(sha: string): Promise<PhotoEdit | null> {
  const r = await get<Record<string, unknown>>(EDIT_STORE, sha)
  if (!r) return null
  try {
    return {
      id: sha,
      name: String(r.name ?? ''),
      doc: parsePreset(r.doc),
      lookId: typeof r.lookId === 'string' ? r.lookId : null,
      presetId: typeof r.presetId === 'string' ? r.presetId : '',
      thumb: typeof r.thumb === 'string' ? r.thumb : '',
      ...(typeof r.thumbFor === 'string' ? { thumbFor: r.thumbFor } : {}),
      updatedAt: Number(r.updatedAt) || 0,
    }
  } catch {
    // Unreadable (from a newer version, or damaged): the photo opens fresh.
    return null
  }
}

const listeners = new Set<(sha: string, mark: EditMark | null) => void>()

/** Hear about every edit saved, to show its new thumbnail (null: the edit was taken away). */
export function onEditSaved(listener: (sha: string, mark: EditMark | null) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Tell whoever listens that an edit's thumbnail changed, when it was written another way (a send to the phone). */
export function noteEditMark(sha: string, mark: EditMark): void {
  for (const l of listeners) l(sha, mark)
}

/** A photo's edit taken away: it shows and opens as it is again (a bulk change undone). */
export async function removeEdit(sha: string): Promise<void> {
  await remove(EDIT_STORE, sha)
  for (const l of listeners) l(sha, null)
}

export async function saveEdit(edit: PhotoEdit): Promise<void> {
  await put(EDIT_STORE, { ...edit, doc: JSON.parse(presetToJson(edit.doc)) })
  for (const l of listeners) l(edit.id, { thumb: edit.thumb, thumbFor: edit.thumbFor, updatedAt: edit.updatedAt })
}

/** Every photo with an edit, and its thumbnail. */
export async function editMarks(): Promise<Map<string, EditMark>> {
  const all = await getAll<{ id: string; thumb?: unknown; thumbFor?: unknown; updatedAt?: unknown }>(EDIT_STORE)
  return new Map(
    all.map((r) => [
      r.id,
      { thumb: typeof r.thumb === 'string' ? r.thumb : '', ...(typeof r.thumbFor === 'string' ? { thumbFor: r.thumbFor } : {}), updatedAt: Number(r.updatedAt) || 0 },
    ]),
  )
}
