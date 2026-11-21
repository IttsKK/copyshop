/**
 * New versions of photos in the library: a photo exported again from the
 * app it was developed in (darktable, Lightroom), larger or better, either
 * written over the old file or beside it under a name of its own. Written
 * over, copyshop moves the edit onto it and tells you; beside it, it asks
 * whether to use it in the old one's place (App's handleNewVersion and
 * handleDuplicates, ui/useFolderPhotos.ts finds them).
 *
 * Here: how a file beside a photo is named when it is another copy of it,
 * and the new files already dealt with (used, or kept as they were), so
 * each is handled once.
 */
import { RAW_EXTENSIONS } from '../pipeline/raw'
import { LIBRARY_STORE, get, put } from './db'

const extOf = (name: string) => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '')
const stemOf = (name: string) => (name.includes('.') ? name.slice(0, name.lastIndexOf('.')) : name)
const isRaw = (name: string) => RAW_EXTENSIONS.includes(extOf(name))

/**
 * What another copy of a photo is named, as apps and systems make one when
 * the name is taken: darktable's PB065305_01, the Finder's "PB065305 copy"
 * and "copy 2", Windows' "PB065305 (1)" and "- Copy", Lightroom's
 * PB065305-2 and PB065305-Edit.
 */
const COPY = /^(.+?)(?:_\d{1,3}| copy(?: \d+)?| - copy(?: \(\d+\))?| \(\d+\)|-\d{1,2}|-edit(?:-\d+)?)$/i

/**
 * The photo in `names` that `name` is another copy of, if any: its name
 * with a copy's ending (`renamed`), or the same name as another kind of file
 * (a TIFF beside a JPEG: which is the new one is up to the caller). A RAW
 * file and its JPEG are a pair, not copies.
 */
export function copyOf(name: string, names: string[]): { of: string; renamed: boolean } | null {
  if (isRaw(name)) return null
  const stem = stemOf(name)
  const m = COPY.exec(stem)
  const others = names.filter((n) => n !== name && !isRaw(n))
  if (m) {
    const base = m[1].toLowerCase()
    const found = others.find((n) => stemOf(n).toLowerCase() === base)
    if (found) return { of: found, renamed: true }
  }
  const same = others.find((n) => stemOf(n).toLowerCase() === stem.toLowerCase())
  return same ? { of: same, renamed: false } : null
}

/*
 * New files already dealt with, by SHA-256.
 */
let seen: Promise<Set<string>> | null = null

export function loadSeen(): Promise<Set<string>> {
  seen ??= get<{ list?: string[] }>(LIBRARY_STORE, 'versions-seen')
    .then((r) => new Set(Array.isArray(r?.list) ? r.list : []))
    .catch(() => new Set<string>())
  return seen
}

export async function markSeen(...shas: string[]): Promise<void> {
  const set = await loadSeen()
  for (const s of shas) set.add(s)
  await put(LIBRARY_STORE, { id: 'versions-seen', list: [...set] }).catch(() => undefined)
}
