import { useEffect, useMemo, useState } from 'react'
import type { PhotoFile } from '../platform/native'
import { RECENT, earlierShas, folderChanged, knownSha, listPhotos, onFolderChanged, onRecent, shaOf } from '../storage/library'
import { copyOf, loadSeen } from '../storage/versions'
import { exportState, loadExports, onExports, originalOf, type ExportState } from '../storage/exports'
import { editMarks, onEditSaved, thumbCurrent, type EditMark } from '../storage/photoEdits'
import { redrawThumb } from './libraryEdits'
import { loadSetOrder, moved, onSetOrder, ordered, saveSetOrder, takenAt, type SetOrder, type SetSort } from '../storage/setOrder'

export interface FolderPhotos {
  /** The folder's photos in the set's order (storage/setOrder.ts); null while it is read. */
  photos: PhotoFile[] | null
  /** How the set is in order. */
  sort: SetSort
  setSort: (sort: SetSort) => void
  /** Put the photo at `from` (in `photos`) at `to`: the set is in your own order from then on. */
  move: (from: number, to: number) => void
  /** The folder is not where it was. */
  missing: boolean
  /** Each photo's SHA-256 by path, as it is found: what its edit is kept under. */
  shas: Map<string, string>
  /** Every edited photo's thumbnail, by SHA-256. */
  marks: Map<string, EditMark>
  /**
   * A photo's edit, if it has one: the photo itself, or the original an
   * export in its place was made from. Its SHA-256 (what the edit is kept
   * under), its thumbnail, and whether its file is up to date with it.
   */
  editOf: (path: string) => { sha: string; own: string; mark: EditMark; state: ExportState } | null
}

/**
 * A photo written over with a new version of itself (darktable exporting it
 * again, larger): its file, its SHA-256 now, and the edit it had (the SHA
 * it is kept under), and whether that was exported (the file written over
 * was copyshop's export, its original in Originals/). App moves the edit
 * over (pipeline/betterCopy.ts) and, exported, exports it again.
 */
export interface NewVersion {
  file: PhotoFile
  sha: string
  editSha: string
  exported: boolean
}

/**
 * A new copy of a photo beside it, under a name of its own (darktable's
 * PB065305_01 when the name is taken; storage/versions.ts copyOf): the copy,
 * the photo, and the photo's edit if it has one (exported: the photo is
 * copyshop's export of it). App asks whether to use the copy in its place.
 */
export interface NewCopy {
  file: PhotoFile
  sha: string
  of: PhotoFile
  ofSha: string
  editSha: string | null
  exported: boolean
}

/** New versions and copies already passed on, by SHA-256, so each is handled once. */
const passedOn = new Set<string>()
let checking: Promise<void> = Promise.resolve()

/**
 * Which of a folder's photos (`shas`, by path) are new versions of others:
 * files with no edit of their own that are not copyshop's exports and were
 * not dealt with before (storage/versions.ts), either where a photo with an
 * edit was (said one at a time, 'grain:new-version') or beside a photo
 * named as a copy of it (said together, 'grain:new-copies'). One just
 * written (the other app may still be writing it) is looked at again in a
 * moment. One look at a time: the filmstrip and the Library both ask.
 */
function checkNewVersions(photos: PhotoFile[], shas: Map<string, string>, copies: boolean): void {
  checking = checking.then(() => lookForNewVersions(photos, shas, copies)).catch(() => undefined)
}

async function lookForNewVersions(photos: PhotoFile[], shas: Map<string, string>, besides: boolean): Promise<void> {
  const now = Date.now()
  const [marks, exports, seen] = await Promise.all([editMarks(), loadExports(), loadSeen()])
  const names = photos.map((f) => f.name)
  const byName = new Map(photos.map((f) => [f.name, f]))
  const editFor = (sha: string) => {
    const e = originalOf(exports.finals, sha)
    return marks.has(e) ? e : null
  }
  const copies: NewCopy[] = []
  let writing = false
  for (const f of photos) {
    const sha = shas.get(f.path)
    if (!sha || marks.has(sha) || exports.finals.has(sha) || seen.has(sha) || passedOn.has(sha)) continue
    if (now - f.modified < 4000) {
      writing = true
      continue
    }
    // Written over a photo with an edit, or over its export.
    let over: NewVersion | null = null
    for (const before of await earlierShas(f)) {
      const editSha = editFor(before)
      if (editSha) {
        over = { file: f, sha, editSha, exported: exports.finals.has(before) }
        break
      }
    }
    if (over) {
      passedOn.add(sha)
      window.dispatchEvent(new CustomEvent<NewVersion>('grain:new-version', { detail: over }))
      continue
    }
    // Beside one, named as a copy of it (in a folder: Recent's photos are from anywhere).
    const c = besides ? copyOf(f.name, names) : null
    const of = c && byName.get(c.of)
    const ofSha = of && shas.get(of.path)
    if (!c || !of || !ofSha || (!c.renamed && f.modified <= of.modified)) continue
    passedOn.add(sha)
    copies.push({ file: f, sha, of, ofSha, editSha: editFor(ofSha), exported: exports.finals.has(ofSha) })
  }
  if (copies.length) window.dispatchEvent(new CustomEvent<NewCopy[]>('grain:new-copies', { detail: copies }))
  if (writing) setTimeout(folderChanged, 5000)
}

const same = (a: PhotoFile[], b: PhotoFile[]) =>
  a.length === b.length && a.every((f, i) => f.path === b[i].path && f.size === b[i].size && f.modified === b[i].modified)

/*
 * Thumbnails that are out of date (drawn for an older edit, by a build that
 * drew photos differently, or never drawn) drawn again, one at a time, in
 * the order the photos are listed. Shared by the filmstrip and the Library,
 * so a photo is drawn once.
 */
const redrawing = new Set<string>()
let redraws: Promise<void> = Promise.resolve()
function redrawLater(f: PhotoFile, sha: string, own: string) {
  if (redrawing.has(sha)) return
  redrawing.add(sha)
  // One that could not be drawn is not tried again this time the app is open.
  redraws = redraws.then(() =>
    redrawThumb(f, sha, own)
      .catch(() => false)
      .then((drawn) => void (drawn && setTimeout(() => redrawing.delete(sha), 2000))),
  )
}

/**
 * A library folder's photos, for the filmstrip and the Library grid: read
 * again whenever the app comes back to the front, hashed one at a time on
 * the app's side (known ones first) so edits show on their photos.
 */
export function useFolderPhotos(folder: string | null): FolderPhotos {
  const [photos, setPhotos] = useState<PhotoFile[] | null>(null)
  const [missing, setMissing] = useState(false)
  const [shas, setShas] = useState<Map<string, string>>(new Map())
  /** Every photo here is hashed (or could not be read): copies beside photos are looked for then, all at once. */
  const [hashed, setHashed] = useState(false)
  const [marks, setMarks] = useState<Map<string, EditMark>>(new Map())

  const [readAt, setReadAt] = useState(0)
  useEffect(() => {
    const again = () => setReadAt(Date.now())
    window.addEventListener('focus', again)
    // Recent changes as photos are opened.
    const off = folder === RECENT ? onRecent(again) : () => {}
    const offWrites = onFolderChanged(again)
    return () => {
      window.removeEventListener('focus', again)
      off()
      offWrites()
    }
  }, [folder])
  useEffect(() => {
    if (!folder) {
      setPhotos([])
      return
    }
    let live = true
    listPhotos(folder)
      .then((list) => {
        if (!live) return
        setMissing(false)
        setPhotos((was) => (was && same(was, list) ? was : list))
      })
      .catch(() => {
        if (!live) return
        setMissing(true)
        setPhotos([])
      })
    return () => {
      live = false
    }
  }, [folder, readAt])

  useEffect(() => {
    if (!photos) return
    let live = true
    setHashed(false)
    void (async () => {
      const found = new Map<string, string>()
      const todo: PhotoFile[] = []
      for (const f of photos) {
        const sha = await knownSha(f)
        if (sha) found.set(f.path, sha)
        else todo.push(f)
      }
      if (!live) return
      setHashed(!todo.length)
      setShas(new Map(found))
      for (const f of todo) {
        if (!live) return
        try {
          found.set(f.path, await shaOf(f))
          setShas(new Map(found))
        } catch {
          /* unreadable: it shows as it is */
        }
      }
      if (live) setHashed(true)
    })()
    return () => {
      live = false
    }
  }, [photos])

  // Each look at the folder (and as its photos are hashed): any written over
  // with a new version of an edited photo.
  useEffect(() => {
    if (photos && shas.size) checkNewVersions(photos, shas, hashed && folder !== RECENT)
  }, [photos, shas, readAt, folder, hashed])

  useEffect(() => {
    void editMarks().then((m) => setMarks((was) => new Map([...m, ...was])))
    return onEditSaved((sha, mark) =>
      setMarks((was) => {
        const next = new Map(was)
        if (mark) next.set(sha, mark)
        else next.delete(sha)
        return next
      }),
    )
  }, [])

  const [exports, setExports] = useState<Awaited<ReturnType<typeof loadExports>> | null>(null)
  useEffect(() => {
    const read = () => void loadExports().then((e) => setExports({ at: new Map(e.at), finals: new Map(e.finals) }))
    read()
    return onExports(read)
  }, [])

  // The set's order, the same in the filmstrip and the Library.
  const [order, setOrder] = useState<SetOrder | null>(null)
  useEffect(() => {
    setOrder(null)
    if (!folder) return
    let live = true
    void loadSetOrder(folder).then((o) => live && setOrder(o))
    const off = onSetOrder((f, o) => f === folder && setOrder(o))
    return () => {
      live = false
      off()
    }
  }, [folder])
  // When each was taken, read as it is needed (by date taken).
  const [taken, setTaken] = useState<Map<string, number>>(new Map())
  useEffect(() => {
    if (!photos || order?.sort !== 'taken') return
    let live = true
    void (async () => {
      const found = new Map<string, number>()
      for (const f of photos) {
        if (!live) return
        found.set(f.path, await takenAt(f).catch(() => f.modified))
      }
      if (live) setTaken(found)
    })()
    return () => {
      live = false
    }
  }, [photos, order?.sort])
  const shown = useMemo(
    () => (!folder || !photos ? photos : order ? ordered(folder, photos, order, taken) : null),
    [photos, folder, order, taken],
  )
  const setSort = (sort: SetSort) => folder && order && void saveSetOrder(folder, { ...order, sort })
  const move = (from: number, to: number) => folder && shown && from !== to && void saveSetOrder(folder, moved(folder, shown, from, to))

  const editOf = (path: string) => {
    const own = shas.get(path)
    if (!own) return null
    const sha = exports ? originalOf(exports.finals, own) : own
    const mark = marks.get(sha)
    if (!mark) return null
    return { sha, own, mark, state: exportState(mark.updatedAt, exports?.at.get(sha)) }
  }

  // Out-of-date thumbnails here drawn again (redrawLater).
  useEffect(() => {
    if (!shown || !exports) return
    for (const f of shown) {
      const e = editOf(f.path)
      if (e && !thumbCurrent(e.mark)) redrawLater(f, e.sha, e.own)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, shas, marks, exports])

  return { photos: shown, sort: order?.sort ?? 'name', setSort, move, missing, shas, marks, editOf }
}
