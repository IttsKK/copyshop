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
        <SetMenu
          library={library}
          folder={folder}
          name={name}
          sort={sort}
          onChoose={choose}
          onSort={setSort}
          onAddFolder={onAddFolder}
        />
        <small className="filmstrip-count" title={folder ? `${SORT_LABEL[sort]}. Drag a photo to put them in your own order.` : undefined}>
          {missing ? 'Folder not found' : photos ? `${list.length} photo${list.length === 1 ? '' : 's'} · ${SORT_LABEL[sort].replace(/^By /, '').replace(/^\w/, (c) => c.toUpperCase())}` : 'Reading…'}
        </small>
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

/**
 * The strip's one control: which set it shows (Recent or a folder) and in
 * what order, and adding a folder, in a single menu that opens upward.
 */
function SetMenu({
  library,
  folder,
  name,
  sort,
  onChoose,
  onSort,
  onAddFolder,
}: {
  library: Library
  folder: string | null
  name: string
  sort: SetSort
  onChoose: (path: string) => void
  onSort: (s: SetSort) => void
  onAddFolder: () => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc, true)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc, true)
    }
  }, [open])
  const pick = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  return (
    <div className="menu-anchor filmstrip-set" ref={ref}>
      <button className={`filmstrip-set-button${open ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={open} title={folder ?? undefined} onClick={() => setOpen(!open)}>
        <span>{name || 'Photos'}</span>
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden>
          <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="menu preset-menu filmstrip-menu" role="menu">
          <div className="menu-label">Show</div>
          {[{ path: RECENT, name: 'Recent' }, ...library.folders].map((f) => (
            <button key={f.path} role="menuitemradio" aria-checked={folder === f.path} className={`menu-item${folder === f.path ? ' current' : ''}`} title={f.path === RECENT ? 'The photos you opened last' : f.path} onClick={pick(() => onChoose(f.path))}>
              {f.name}
            </button>
          ))}
          <button role="menuitem" className="menu-item" onClick={pick(onAddFolder)}>
            Add folder…
          </button>
          {folder && (
            <>
              <div className="menu-rule" />
              <div className="menu-label">Order</div>
              {sortsFor(folder).map((o) => (
                <button key={o} role="menuitemradio" aria-checked={sort === o} className={`menu-item${sort === o ? ' current' : ''}`} onClick={pick(() => onSort(o))}>
                  {SORT_LABEL[o]}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
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
