import { useEffect, useRef, useState } from 'react'
import type { PhotoFile } from '../platform/native'
import { RECENT, photoThumb, type Library } from '../storage/library'
import { cannotOpenMessage, extOf } from '../pipeline/formats'
import { useFolderPhotos } from './useFolderPhotos'
import { EXPORT_STATE_LABEL } from './exportState'
import { useDragOrder } from './useDragOrder'
import { SORT_LABEL, sortsFor, type SetSort } from '../storage/setOrder'

interface Props {
  library: Library
  onLibrary: (lib: Library) => void
  onAddFolder: () => void
  /** The open photo: where it was opened from in the strip, and its SHA-256. */
  openPath: string | null
  openSha: string | null
  onOpen: (f: PhotoFile) => void
  /** Animating out (useLingering). */
  closing?: boolean
}

/** Cmd+[ and Cmd+] step through the strip: App sends this, the strip opens the neighbour. */
export const STRIP_STEP = 'grain:strip-step'
export const stepStrip = (by: -1 | 1) => window.dispatchEvent(new CustomEvent(STRIP_STEP, { detail: by }))

/**
 * The filmstrip under the photo: Recent or one folder from the library
 * (storage/library.ts), each photo as it is edited, or as it is if it has no
 * edit yet, in the set's order (storage/setOrder.ts). Click one to open it,
 * drag one to put the set in your own order. Only there once the library
 * has photos.
 */
export function Filmstrip({ library, onLibrary, onAddFolder, openPath, openSha, onOpen, closing = false }: Props) {
  const folder = library.current
  const { photos, missing, shas, editOf, sort, setSort, move } = useFolderPhotos(folder)
  const strip = useRef<HTMLDivElement>(null)
  const { dragging, startAt, dragClass } = useDragOrder(strip, 'x', folder && folder !== RECENT ? move : null)

  const list = photos ?? []
  const at = list.findIndex((f) => f.path === openPath || (!!openSha && (editOf(f.path)?.sha ?? shas.get(f.path)) === openSha))

  useEffect(() => {
    const step = (e: Event) => {
      if (!list.length) return
      const by = (e as CustomEvent<number>).detail
      const next = at < 0 ? (by > 0 ? 0 : list.length - 1) : at + by
      if (next >= 0 && next < list.length) onOpen(list[next])
    }
    window.addEventListener(STRIP_STEP, step)
    return () => window.removeEventListener(STRIP_STEP, step)
  }, [list, at, onOpen])

  // The open photo kept in view.
  useEffect(() => {
    if (at < 0) return
    strip.current?.children[at]?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [at])

  const choose = (path: string) => onLibrary({ ...library, current: path })
  const name = folder === RECENT ? 'Recent' : (library.folders.find((f) => f.path === folder)?.name ?? '')

  return (
    <section className={`filmstrip${closing ? ' closing' : ''}`} aria-label="Filmstrip">
      <div className="filmstrip-head">
        {library.folders.length > 0 ? (
          <select value={folder ?? ''} title={folder === RECENT ? 'The photos you opened last' : (folder ?? undefined)} onChange={(e) => choose(e.target.value)}>
            <option value={RECENT}>Recent</option>
            {library.folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
              </option>
            ))}
          </select>
        ) : (
          <b title={folder ?? undefined}>{name}</b>
        )}
        {folder && (
          <select
            className="filmstrip-sort"
            value={sort}
            aria-label="Order"
            title={folder === RECENT ? 'The order of the photos here' : 'The order of the photos here, in the Library too. Drag a photo to put them in your own order.'}
            onChange={(e) => setSort(e.target.value as SetSort)}
          >
            {sortsFor(folder).map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <div className="filmstrip-actions">
          <small>{missing ? 'Folder not found' : photos ? `${list.length} photo${list.length === 1 ? '' : 's'}` : 'Reading…'}</small>
          <button className="link" title="Add a folder of photos to the library" onClick={onAddFolder}>
            Add folder
          </button>
        </div>
      </div>
      <div className={`filmstrip-list${dragging ? ' reordering' : ''}`} ref={strip}>
        {list.map((f, i) => {
          const ed = editOf(f.path)
          const mark = ed?.mark
          return (
            <button
              key={f.path}
              className={`filmstrip-item${i === at ? ' on' : ''}${dragClass(i, list.length)}`}
              title={`${f.name}${ed ? ` · ${EXPORT_STATE_LABEL[ed.state]}` : ''}`}
              data-drag=""
              onPointerDown={startAt(i)}
              onClick={() => i !== at && onOpen(f)}
            >
              <PhotoThumb file={f} edited={mark?.thumb || null} kind="filmstrip" />
              {ed && <i className={`filmstrip-dot ${ed.state}`} aria-label={EXPORT_STATE_LABEL[ed.state]} />}
            </button>
          )
        })}
        {photos && !list.length && <p className="hint-line">{missing ? `${name} is not where it was.` : 'No JPEG, PNG or RAW photos in this folder.'}</p>}
      </div>
    </section>
  )
}

/** The thumbnail last shown for each photo (by path): what opening it shows until it is in. */
const shownThumbs = new Map<string, string>()
export const shownThumb = (path: string): string | null => shownThumbs.get(path) ?? null

/** A photo's thumbnail: its edit if it has one, else the photo, made when it first scrolls into view. */
export function PhotoThumb({ file, edited, kind }: { file: PhotoFile; edited: string | null; kind: 'filmstrip' | 'library' }) {
  // Kept with the file it was made from: the same path written over (a new
  // version, an export in its place) is a different picture.
  const fileKey = `${file.path}|${file.size}|${file.modified}`
  const [plainOf, setPlainOf] = useState<{ key: string; url: string } | null>(null)
  const plain = plainOf?.key === fileKey ? plainOf.url : ''
  const [failed, setFailed] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (edited || plain) return
    const el = box.current
    if (!el) return
    let live = true
    const seen = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return
        seen.disconnect()
        photoThumb(file)
          .then((url) => live && setPlainOf({ key: fileKey, url }))
          .catch(() => live && setFailed(true))
      },
      { rootMargin: '0px 400px' },
    )
    seen.observe(el)
    return () => {
      live = false
      seen.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileKey, edited, plain])
  const src = edited || plain
  if (src) shownThumbs.set(file.path, src)
  return (
    <span className={`${kind}-thumb`} ref={box}>
      {src ? (
        <img src={src} alt="" draggable={false} />
      ) : (
        // One this computer can't read (a HEIC off the Mac): its kind, and why, rather than a question mark.
        <span className={`${kind}-blank${failed ? ' failed' : ''}`} title={failed ? cannotOpenMessage(file.name) : undefined}>
          {failed ? extOf(file.name).toUpperCase() : ''}
        </span>
      )}
    </span>
  )
}
