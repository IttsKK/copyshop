import { readFile } from '../platform/native'
import { SESSION_STORE, get, mirrorLocal, put, remove } from './db'
import { parsePreset, presetToJson, type PresetDoc } from './presets'

/**
 * The working session, so a reload picks up where you were.
 *
 * Settings live in localStorage, which is synchronous: the app starts on the
 * restored look in its very first render instead of flashing the default look
 * and then swapping. They are stored as a preset document and read back through
 * parsePreset, so a session saved by an older build migrates the same way an
 * old preset file does, and a corrupt one is ignored rather than crashing.
 *
 * The photo is too big for localStorage and lives in IndexedDB.
 */

const KEY = 'grainemulator.session'

export interface Session {
  doc: PresetDoc
  /** Built-in look the settings came from, for "Edited from …" and Reset. */
  lookId: string | null
  presetId: string
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { doc?: unknown; lookId?: unknown; presetId?: unknown }
    return {
      doc: parsePreset(data.doc),
      lookId: typeof data.lookId === 'string' ? data.lookId : null,
      presetId: typeof data.presetId === 'string' ? data.presetId : '',
    }
  } catch {
    return null
  }
}

export function saveSession(session: Session): void {
  try {
    const value = JSON.stringify({
      doc: JSON.parse(presetToJson(session.doc)),
      lookId: session.lookId,
      presetId: session.presetId,
    })
    mirrorLocal(KEY, value)
    localStorage.setItem(KEY, value)
  } catch {
    /* storage full or blocked: losing the session is not worth an error */
  }
}

interface PhotoRecord {
  id: 'photo'
  name: string
  blob?: Blob
  /** In the app, a photo from a library folder is kept as where it is, not a copy. */
  path?: string
}

/** The open photo remembered by its path (the app, a photo from a library folder): nothing is copied. */
export async function savePhotoPath(path: string, name: string): Promise<void> {
  await put<PhotoRecord>(SESSION_STORE, { id: 'photo', name, path })
}

const PHOTO_FALLBACK_KEY = 'grainemulator.photo'
/** localStorage holds a few MB at most, and a data URL costs a third more. */
const FALLBACK_LIMIT = 3.5 * 1024 * 1024

export async function savePhoto(blob: Blob, name: string): Promise<void> {
  const stored = await put<PhotoRecord>(SESSION_STORE, { id: 'photo', name, blob })
  if (stored !== undefined) {
    localStorage.removeItem(PHOTO_FALLBACK_KEY)
    return
  }
  // No IndexedDB here: keep a small enough photo in localStorage instead.
  try {
    localStorage.removeItem(PHOTO_FALLBACK_KEY)
    if (blob.size > FALLBACK_LIMIT) return
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    localStorage.setItem(PHOTO_FALLBACK_KEY, JSON.stringify({ name, dataUrl }))
  } catch {
    /* too big after all, or blocked: the photo just is not remembered */
  }
}

export async function loadPhoto(): Promise<{ blob: Blob; name: string; path?: string } | null> {
  const record = await get<PhotoRecord>(SESSION_STORE, 'photo')
  if (record?.path) {
    const bytes = await readFile(record.path)
    return bytes ? { blob: new Blob([bytes]), name: record.name, path: record.path } : null
  }
  if (record?.blob) return { blob: record.blob, name: record.name }
  try {
    const raw = localStorage.getItem(PHOTO_FALLBACK_KEY)
    if (!raw) return null
    const { name, dataUrl } = JSON.parse(raw) as { name: string; dataUrl: string }
    return { name, blob: await (await fetch(dataUrl)).blob() }
  } catch {
    return null
  }
}

export async function clearPhoto(): Promise<void> {
  await remove(SESSION_STORE, 'photo')
}

const SNAPSHOT_KEY = 'grainemulator.snapshots'

/** A snapshot as stored: its settings and thumbnail, not its grain texture. */
export interface StoredSnapshot {
  id: string
  name: string
  createdAt: number
  doc: PresetDoc
  thumb: string
  /** The photo it was taken on (its SHA-256); missing on ones from before they were kept per photo. */
  photo?: string
  /** That photo's file name, shown on the snapshot on other photos. */
  photoName?: string
}

export function loadSnapshotRecords(): StoredSnapshot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) ?? '[]') as Record<string, unknown>[]
    const out: StoredSnapshot[] = []
    for (const r of raw) {
      try {
        out.push({
          id: String(r.id),
          name: String(r.name),
          createdAt: Number(r.createdAt) || 0,
          doc: parsePreset(r.doc),
          thumb: typeof r.thumb === 'string' ? r.thumb : '',
          ...(typeof r.photo === 'string' ? { photo: r.photo } : {}),
          ...(typeof r.photoName === 'string' ? { photoName: r.photoName } : {}),
        })
      } catch {
        /* one unreadable snapshot should not cost the rest */
      }
    }
    return out
  } catch {
    return []
  }
}

export function saveSnapshotRecords(records: StoredSnapshot[]): void {
  // On disk the thumbnails cost nothing, so they are always kept there.
  mirrorLocal(SNAPSHOT_KEY, JSON.stringify(records.map((r) => ({ ...r, doc: JSON.parse(presetToJson(r.doc)) }))))
  try {
    localStorage.setItem(
      SNAPSHOT_KEY,
      JSON.stringify(records.map((r) => ({ ...r, doc: JSON.parse(presetToJson(r.doc)) }))),
    )
  } catch {
    // Full: thumbnails are the bulk, so keep the settings and drop those.
    try {
      localStorage.setItem(
        SNAPSHOT_KEY,
        JSON.stringify(records.map((r) => ({ ...r, thumb: '', doc: JSON.parse(presetToJson(r.doc)) }))),
      )
    } catch {
      /* give up quietly */
    }
  }
}
