import { joinPath, readFile, removeFile, writeFile } from '../platform/native'
import { LIBRARY_STORE, get, put } from './db'
import { diskFolder } from './disk'
import { DEFAULT_OUTPUT, PRESET_SCHEMA_VERSION, parsePreset, presetToJson, type PresetDoc } from './presets'
import { sha256 } from './recipe'

/**
 * Finished previews of edited photos, on disk in the app's data folder: the
 * whole print at about a screen's size, as the editor or the Library drew
 * it. Kept under the photo and its edit together, so an edit changed since
 * finds none and is drawn again; the Library shows one at once rather than
 * working the edit out from the original every time (darktable keeps its
 * previews the same way). The newest few hundred are kept.
 */

const KEEP = 400
const urls = new Map<string, string>()
let index: Promise<string[]> | null = null

/** JSON with sorted keys, so equal settings read alike whatever order they were built in. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_k, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  )
}

/**
 * The key for a photo (its SHA-256) under an edit. The edit is put through
 * saving and reading first, as a saved edit is, so the editor's settings and
 * the same edit read back from disk give the same key.
 */
export async function previewKey(photoSha: string, doc: Pick<PresetDoc, 'blend' | 'grainSource'>): Promise<string> {
  const full: PresetDoc = { schemaVersion: PRESET_SCHEMA_VERSION, name: '', blend: doc.blend, grainSource: doc.grainSource, output: DEFAULT_OUTPUT }
  let norm: unknown = { blend: doc.blend, grain: doc.grainSource }
  try {
    const back = parsePreset(JSON.parse(presetToJson(full)))
    norm = { blend: back.blend, grain: back.grainSource }
  } catch {
    /* as it is */
  }
  const h = await sha256(new Blob([stable(norm)]))
  return `${photoSha.slice(0, 16)}-${h.slice(0, 16)}`
}

const pathOf = (key: string) => joinPath(diskFolder() ?? '', 'previews', `${key}.jpg`)

function loadIndex(): Promise<string[]> {
  index ??= get<{ keys?: unknown }>(LIBRARY_STORE, 'previews').then((r) => (Array.isArray(r?.keys) ? (r.keys as string[]) : []))
  return index
}

async function touch(key: string) {
  const keys = (await loadIndex()).filter((k) => k !== key)
  keys.push(key)
  for (const old of keys.splice(0, Math.max(0, keys.length - KEEP))) {
    void removeFile(pathOf(old))
    const u = urls.get(old)
    if (u) URL.revokeObjectURL(u)
    urls.delete(old)
  }
  index = Promise.resolve(keys)
  await put(LIBRARY_STORE, { id: 'previews', keys })
}

/** The preview kept under this key, as a URL to show; null if there is none. */
export async function readPreview(key: string): Promise<string | null> {
  const have = urls.get(key)
  if (have) return have
  if (!diskFolder()) return null
  const bytes = await readFile(pathOf(key))
  if (!bytes) return null
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }))
  urls.set(key, url)
  void touch(key)
  return url
}

/** Keep a preview under this key. */
export async function writePreview(key: string, picture: Blob): Promise<void> {
  if (!diskFolder()) return
  await writeFile(pathOf(key), picture)
  void touch(key)
}
