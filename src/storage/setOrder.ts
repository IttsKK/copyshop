/**
 * The order of a set's photos (a library folder, or Recent): by name, by
 * the date each was taken, by its file's date, as last opened (Recent), or
 * in your own order, dragged into place in the filmstrip or the Library.
 * The filmstrip, the Library and what is sent from it all follow it.
 *
 * Kept in the app's own data, by folder; your own order by file name (a
 * photo written over by its export, or by a new version of itself, keeps
 * its place). Photos added to the folder since go at the end, by name.
 */
import { readPhotoDate } from '../pipeline/photoDate'
import { readHead, type PhotoFile } from '../platform/native'
import { RECENT } from './library'
import { LIBRARY_STORE, get, put } from './db'

export type SetSort = 'custom' | 'name' | 'taken' | 'modified' | 'opened'

export interface SetOrder {
  sort: SetSort
  /** Your own order: the photos' names (paths in Recent). */
  order: string[]
}

export const SORT_LABEL: Record<SetSort, string> = {
  custom: 'Your order',
  name: 'By name',
  taken: 'By date taken',
  modified: 'By file date',
  opened: 'Last opened first',
}

/** The sorts a set offers: Recent is as you opened them, not in an order of your own. */
export const sortsFor = (folder: string): SetSort[] => (folder === RECENT ? ['opened', 'name', 'taken', 'modified'] : ['custom', 'name', 'taken', 'modified'])

const fallback = (folder: string): SetOrder => ({ sort: folder === RECENT ? 'opened' : 'name', order: [] })

const orders = new Map<string, SetOrder>()
const watchers = new Set<(folder: string, o: SetOrder) => void>()

export async function loadSetOrder(folder: string): Promise<SetOrder> {
  const known = orders.get(folder)
  if (known) return known
  const r = await get<{ sort?: unknown; order?: unknown }>(LIBRARY_STORE, `order:${folder}`).catch(() => undefined)
  const sorts = sortsFor(folder)
  const o: SetOrder =
    r && sorts.includes(r.sort as SetSort)
      ? { sort: r.sort as SetSort, order: Array.isArray(r.order) ? r.order.filter((n): n is string => typeof n === 'string') : [] }
      : fallback(folder)
  orders.set(folder, o)
  return o
}

export async function saveSetOrder(folder: string, o: SetOrder): Promise<void> {
  orders.set(folder, o)
  for (const w of watchers) w(folder, o)
  await put(LIBRARY_STORE, { id: `order:${folder}`, sort: o.sort, order: o.order })
}

/** Called with a set and its order whenever one changes (from the filmstrip or the Library). */
export function onSetOrder(watch: (folder: string, o: SetOrder) => void): () => void {
  watchers.add(watch)
  return () => watchers.delete(watch)
}

/** What a photo is kept as in your own order: its name in a folder, its path in Recent. */
export const orderKey = (folder: string, f: PhotoFile) => (folder === RECENT ? f.path : f.name)

const byName = (a: PhotoFile, b: PhotoFile) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })

/**
 * `photos` (as the set lists them: a folder's by name, Recent's last opened
 * first) in the set's order. `taken`: when each was taken, by path, as far
 * as it is known; those not known yet go by their file's date.
 */
export function ordered(folder: string, photos: PhotoFile[], o: SetOrder, taken: Map<string, number>): PhotoFile[] {
  const list = [...photos]
  const then = (a: PhotoFile, b: PhotoFile, by: (f: PhotoFile) => number) => by(a) - by(b) || byName(a, b)
  switch (o.sort) {
    case 'opened':
      return list
    case 'name':
      return list.sort(byName)
    case 'modified':
      return list.sort((a, b) => then(a, b, (f) => f.modified))
    case 'taken':
      return list.sort((a, b) => then(a, b, (f) => taken.get(f.path) ?? f.modified))
    case 'custom': {
      const at = new Map(o.order.map((k, i) => [k, i]))
      const placed = list.filter((f) => at.has(orderKey(folder, f))).sort((a, b) => at.get(orderKey(folder, a))! - at.get(orderKey(folder, b))!)
      const added = list.filter((f) => !at.has(orderKey(folder, f))).sort(byName)
      return [...placed, ...added]
    }
  }
}

/** `list` (as shown) with the photo at `from` put at `to` (an index in the list as it will be), as your own order. */
export function moved(folder: string, list: PhotoFile[], from: number, to: number): SetOrder {
  const keys = list.map((f) => orderKey(folder, f))
  const [k] = keys.splice(from, 1)
  keys.splice(Math.max(0, Math.min(keys.length, to)), 0, k)
  return { sort: 'custom', order: keys }
}

/*
 * When each photo was taken, from its EXIF (the head of its file, read
 * without reading it whole), kept by file as it is now. No date in it: its
 * file's date.
 */
const HEAD = 512 * 1024
let takenIndex: Promise<Map<string, number>> | null = null
let saveTimer: ReturnType<typeof setTimeout> | null = null
const takenKey = (f: PhotoFile) => `${f.path}|${f.size}|${f.modified}`

function loadTaken(): Promise<Map<string, number>> {
  takenIndex ??= get<{ map?: [string, number][] }>(LIBRARY_STORE, 'taken')
    .then((r) => new Map(Array.isArray(r?.map) ? r.map : []))
    .catch(() => new Map())
  return takenIndex
}

function saveTakenSoon() {
  if (saveTimer) return
  saveTimer = setTimeout(async () => {
    saveTimer = null
    const map = await loadTaken()
    await put(LIBRARY_STORE, { id: 'taken', map: [...map] }).catch(() => undefined)
  }, 1500)
}

/** "2024-05-01 14:03" (or the day alone), as photoDate.ts reads it, in ms. */
export function takenMs(date: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/.exec(date)
  if (!m) return null
  const t = new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0).getTime()
  return Number.isFinite(t) ? t : null
}

/** When `f` was taken, ms: read from its EXIF the first time. */
export async function takenAt(f: PhotoFile): Promise<number> {
  const map = await loadTaken()
  const key = takenKey(f)
  const known = map.get(key)
  if (known !== undefined) return known
  const head = await readHead(f.path, HEAD)
  const t = (head && takenMs(await readPhotoDate(new Blob([head])))) ?? f.modified
  map.set(key, t)
  saveTakenSoon()
  return t
}
