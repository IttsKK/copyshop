import { showInFilesLabel } from '../platform/os'
import { photoAccept } from '../pipeline/formats'
import { useEffect, useRef, useState } from 'react'
import type { PhotoFile } from '../platform/native'
import { RECENT, folderChanged, loadRecent, removeRecent, type Library } from '../storage/library'
import { confirmWith, revealInFinder } from '../platform/native'
import { useLingering } from './useLingering'
import { PhotoThumb } from './Filmstrip'
import { inTextField } from './shortcuts'
import { useFolderPhotos } from './useFolderPhotos'
import { useLocalStorage } from './useLocalStorage'
import { LibraryLoupe } from './LibraryLoupe'
import { libraryPicture, type LibraryEdit } from './libraryPictures'
import type { ExportState } from '../storage/exports'
import { EXPORT_STATE_LABEL } from './exportState'
import { useDragOrder } from './useDragOrder'
import { SORT_LABEL, sortsFor, type SetSort } from '../storage/setOrder'
import { LibrarySide, REPLACE_HINT } from './LibrarySide'
import type { ClipPart, EditClip } from './editClip'

interface Props {
  library: Library
  onLibrary: (lib: Library) => void
  onAddFolder: () => void
  /** Open photos with the system's dialog (they go into Recent). */
  onOpenPhotos: () => void
  /** The folders list, shown or folded away with the left panel. */
  sidebar: boolean
  openPath: string | null
  openSha: string | null
  /** Open a photo in the editor. */
  onOpen: (f: PhotoFile) => void
  /** Export these photos with the export settings, each where Export puts it. */
  onExportPhotos: (files: PhotoFile[]) => void
  /** An export of several is running. */
  exporting: boolean
  /** A photo's finished picture from the editor, if one is kept (by path). */
  pictureFor?: (path: string) => string | undefined
  /** Back to the editor as it was. */
  onClose: () => void
  /** Give the chosen photos a recipe (App, editPhotos). */
  onRecipe: (files: PhotoFile[], id: string) => void
  /** The recipes there are to apply: the built-in ones and yours. */
  recipes: { id: string; label: string }[]
  /** The copied edit (App's clipboard, the editor's too), its parts chosen; copying a photo's, and pasting onto photos. */
  clip: EditClip | null
  onClipParts: (parts: ClipPart[]) => void
  onCopy: (f: PhotoFile) => void
  /** Submit to Gallery…: the photo opened, then the form (App). */
  onSubmitGallery?: (f: PhotoFile) => void
  onPaste: (files: PhotoFile[]) => void
  /** Show a photo in the Finder; and, for an export saved in its place, the original it was made from (in Originals/ beside it). */
  onReveal: (f: PhotoFile) => void
  onRevealOriginal: (f: PhotoFile, sha: string) => void
  /** A better copy of an edited photo (larger, less compressed, the RAW) put under its edit: opened with the edit on it. */
  onReplace?: (f: PhotoFile, better: File) => void
  /** The last change made here, to take back on every photo it changed; and doing that. */
  undoLabel: string | null
  onUndo: () => void
  /** The tour's sample folder in place of the real ones (DEMO_PHOTOS): photos to point at, one with each mark. */
  demo?: boolean
}

const BASE = import.meta.env.BASE_URL
/**
 * The walk round's Library: a folder of sample photos, the second, third and
 * fourth with each kind of mark (edited, changed since its export,
 * exported), so the tour has photos to show before any of yours are in.
 */
const DEMO_FOLDER = 'sample:'
const DEMO_PHOTOS: { name: string; src: string; state?: ExportState }[] = [
  { name: 'IMG_2041.jpg', src: 'samples/sample-street.jpg' },
  { name: 'IMG_2042.jpg', src: 'guide/showcase/streaks-1-finished.jpg', state: 'unexported' },
  { name: 'IMG_2043.jpg', src: 'guide/showcase/repeat-1-finished.jpg', state: 'changed' },
  { name: 'IMG_2044.jpg', src: 'guide/showcase/streaks-2-finished.jpg', state: 'exported' },
  { name: 'IMG_2045.jpg', src: 'samples/sample-lake.jpg' },
  { name: 'IMG_2046.jpg', src: 'samples/sample-moon.jpg' },
]
const demoFiles: PhotoFile[] = DEMO_PHOTOS.map((d, i) => ({ name: d.name, path: `${DEMO_FOLDER}${d.name}`, size: 0, modified: i }))
const demoEdit = (path: string) => {
  const d = DEMO_PHOTOS.find((x) => `${DEMO_FOLDER}${x.name}` === path)
  return d?.state ? { sha: path, own: path, mark: { thumb: `${BASE}${d.src}`, updatedAt: 0 }, state: d.state } : null
}
const demoThumb = (path: string) => {
  const d = DEMO_PHOTOS.find((x) => `${DEMO_FOLDER}${x.name}` === path)
  return d ? `${BASE}${d.src}` : null
}


/**
 * The Library: Recent's photos or a folder's in a grid, over the editor
 * (which stays as it was underneath, so going back is instant). Recent and
 * the folders are down the side.
 *
 * Choosing photos is as in Finder: a click chooses one, Cmd-click adds or
 * takes one away, Shift-click a run, Cmd+A all, Esc none. The sidebar acts
 * on those chosen (LibrarySide): see or edit one, copy one's edit and paste
 * parts of it onto the rest (⌘C, ⌘V), a recipe, export.
 *
 * Seeing one large: double-click it (or Space). Seen large, the arrow keys
 * step through, F fills the screen with it, Esc goes back. Editing: Enter,
 * or Edit. The photos are in the set's order, as in the filmstrip
 * (storage/setOrder.ts); drag one in the grid to put them in your own order.
 */
export function LibraryView({ library: realLibrary, onLibrary, onAddFolder, onOpenPhotos, sidebar, openPath, openSha, onOpen, onExportPhotos, exporting, pictureFor, onClose, onRecipe, recipes, clip, onClipParts, onCopy, onPaste, onReveal, onRevealOriginal, onReplace, onSubmitGallery, undoLabel, onUndo, demo }: Props) {
  // Replace photo…: the better copy is chosen first (the click opens the picker), then the photo opens with its edit on it.
  const replaceInput = useRef<HTMLInputElement>(null)
  const replacing = useRef<PhotoFile | null>(null)
  const replace = (f: PhotoFile) => {
    replacing.current = f
    replaceInput.current?.click()
  }
  const library = demo ? { folders: [{ path: DEMO_FOLDER, name: 'Sample photos' }], current: DEMO_FOLDER } : realLibrary
  const folder = library.current
  // The tour's samples read nothing from disk: Recent is read underneath, unused.
  const real = useFolderPhotos(demo ? RECENT : folder)
  const { shas, sort, setSort, move } = real
  const photos = demo ? demoFiles : real.photos
  const missing = demo ? false : real.missing
  const editOf = demo ? demoEdit : real.editOf
  const list = photos ?? []
  const [columns, setColumns] = useLocalStorage('ui.library.columns', 5)
  /** The photo seen large (LibraryLoupe), by path; null: the grid. */
  const [viewing, setViewing] = useState<string | null>(null)
  /** Seen large with nothing else round it: the window filled with the photo. */
  const [full, setFull] = useState(false)
  // The photos chosen, by path, and the one last clicked (where Shift-click
  // and the arrow keys go from; what Space shows and Enter edits).
  const [chosen, setChosen] = useState<string[]>([])
  const [picked, setPicked] = useState<string | null>(null)
  const clickPhoto = (f: PhotoFile, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) => {
    const i = list.indexOf(f)
    if (e.shiftKey) {
      const from = Math.max(0, list.findIndex((x) => x.path === picked))
      const run = list.slice(Math.min(from, i), Math.max(from, i) + 1).map((x) => x.path)
      setChosen((c) => (e.metaKey || e.ctrlKey ? [...c, ...run.filter((p) => !c.includes(p))] : run))
      return
    }
    if (e.metaKey || e.ctrlKey) setChosen((c) => (c.includes(f.path) ? c.filter((p) => p !== f.path) : [...c, f.path]))
    else setChosen([f.path])
    setPicked(f.path)
  }
  // Another folder: back to its grid, nothing chosen.
  useEffect(() => {
    setViewing(null)
    setFull(false)
    setChosen([])
    setPicked(null)
  }, [folder])
  const isOpen = (f: PhotoFile) => f.path === openPath || (!!openSha && (editOf(f.path)?.sha ?? shas.get(f.path)) === openSha)
  const pickedAt = list.findIndex((f) => f.path === picked)
  const at = pickedAt >= 0 ? pickedAt : list.findIndex(isOpen)
  const chosenFiles = list.filter((f) => chosen.includes(f.path))
  // Seen large is seen full screen (F or Space, and back the same way or Esc), as darktable's preview.
  const show = (f: PhotoFile) => {
    setFull(true)
    setViewing(f.path)
    setPicked(f.path)
    setChosen([f.path])
  }
  const grid = useRef<HTMLDivElement>(null)
  const { dragging, startAt, dragClass } = useDragOrder(grid, 'y', folder && folder !== RECENT ? move : null)
  const edited = list.filter((f) => editOf(f.path)).length
  // Edited, and the edit not in its file yet (never exported, or changed since): Select changed.
  const toExport = list.filter((f) => {
    const e = editOf(f.path)
    return !!e && e.state !== 'exported'
  })

  useEffect(() => {
    if (at >= 0) grid.current?.children[at]?.scrollIntoView({ block: 'nearest' })
  }, [at])

  const side = useLingering(sidebar)
  /** A folder's menu (its ⋯ button or a right-click), where it was asked for. */
  const [menu, setMenu] = useState<{ path: string; x: number; y: number } | null>(null)
  const openMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu(menu?.path === path ? null : { path, x: e.clientX, y: e.clientY + 4 })
  }
  const menuDo = (action: () => unknown) => {
    setMenu(null)
    void action()
  }
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopImmediatePropagation(), close())
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [menu])
  /**
   * A photo's menu, where it was right-clicked: as in the Finder, the
   * photo is selected first if it was not already, and the menu acts on
   * the selection.
   */
  const [photoMenu, setPhotoMenu] = useState<{ file: PhotoFile; x: number; y: number } | null>(null)
  const photoMenuAt = (e: React.MouseEvent, f: PhotoFile) => {
    e.preventDefault()
    if (!chosen.includes(f.path)) setChosen([f.path])
    setPicked(f.path)
    setPhotoMenu({ file: f, x: e.clientX, y: e.clientY })
  }
  useEffect(() => {
    if (!photoMenu) return
    const close = () => setPhotoMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (e.stopImmediatePropagation(), close())
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [photoMenu])
  /** An export saved in the photo's place: its original is another file (in Originals/ beside it). */
  const originalElsewhere = (f: PhotoFile) => {
    const e = editOf(f.path)
    return !!e && e.sha !== e.own
  }
  const viewAt = viewing ? list.findIndex((f) => f.path === viewing) : -1
  const loupeEdit = (f: PhotoFile): LibraryEdit | null => {
    const e = editOf(f.path)
    return e ? { sha: e.sha, own: e.own, state: e.state, updatedAt: e.mark.updatedAt } : null
  }
  // The photos nearest this one made ready, one at a time, nearest first,
  // while it is looked at: stepping through them is instant. Each made is
  // kept on disk too (libraryPicture), so it is instant next time as well.
  useEffect(() => {
    if (viewAt < 0) return
    let live = true
    const near: PhotoFile[] = []
    for (let d = 1; d <= 4; d++) for (const i of [viewAt + d, viewAt - d]) if (list[i]) near.push(list[i])
    const t = setTimeout(async () => {
      for (const f of near) {
        if (!live) return
        if (!pictureFor?.(f.path)) await libraryPicture(f, loupeEdit(f), 'library-ahead')
      }
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewAt, list])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e.target) || e.metaKey || e.ctrlKey || e.altKey || menu) return
      // A window over the Library (Settings, shortcuts, the palette) has the keys: Esc closes it, not the Library.
      if (document.querySelector('[role="dialog"]')) return
      if (viewAt >= 0) {
        // Seen large: step through, fill the screen, back to the grid, or edit.
        if (e.key === 'Escape' || e.key === ' ' || e.key === 'f' || e.key === 'F') {
          setFull(false)
          setViewing(null)
        }
        else if (e.key === 'Enter' || e.key === 'e' || e.key === 'E' || e.key === 'd' || e.key === 'D') onOpen(list[viewAt])
        else if ((e.key === 'ArrowRight' || e.key === 'ArrowDown') && viewAt < list.length - 1) show(list[viewAt + 1])
        else if ((e.key === 'ArrowLeft' || e.key === 'ArrowUp') && viewAt > 0) show(list[viewAt - 1])
        else return
        e.preventDefault()
        e.stopImmediatePropagation()
        return
      }
      if (e.key === 'Escape') {
        if (chosen.length || picked) {
          setChosen([])
          setPicked(null)
        } else onClose()
      } else if ((e.key === 'Enter' || e.key === 'e' || e.key === 'E' || e.key === 'd' || e.key === 'D') && at >= 0) onOpen(list[at])
      // F or Space: the photo last clicked (else the one in the editor, else the first) full screen.
      else if ((e.key === ' ' || e.key === 'f' || e.key === 'F') && list.length) show(list[at >= 0 ? at : 0])
      else if (e.key.startsWith('Arrow') && list.length) {
        const items = [...(grid.current?.children ?? [])] as HTMLElement[]
        const top = items[0]?.offsetTop ?? 0
        const across = Math.max(1, items.filter((el) => el.offsetTop === top).length)
        const by = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -across, ArrowDown: across }[e.key] ?? 0
        const next = Math.min(list.length - 1, Math.max(0, (at < 0 ? 0 : at) + by))
        // Shift and an arrow: the run from where it started to here, as Shift-click.
        if (e.shiftKey) {
          const from = at < 0 ? next : at
          setChosen((c) => [...new Set([...c, ...list.slice(Math.min(from, next), Math.max(from, next) + 1).map((f) => f.path)])])
        } else setChosen([list[next].path])
        setPicked(list[next].path)
      } else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list, at, viewAt, picked, chosen, menu, full, onOpen, onClose])
  // ⌘C copies the selected photo's edit, ⌘V pastes the chosen parts onto those selected (and the Edit menu's Copy and Paste).
  const clipKeys = useRef({ copy: () => {}, paste: () => {} })
  clipKeys.current = {
    copy: () => chosenFiles.length === 1 && editOf(chosenFiles[0].path) && onCopy(chosenFiles[0]),
    paste: () => chosenFiles.length > 0 && onPaste(chosenFiles),
  }
  useEffect(() => {
    const textual = (e: Event) => inTextField(e.target) || !!window.getSelection()?.toString() || !!document.querySelector('[role="dialog"]')
    const copy = (e: ClipboardEvent) => {
      if (textual(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      clipKeys.current.copy()
    }
    const paste = (e: ClipboardEvent) => {
      if (textual(e)) return
      e.preventDefault()
      e.stopImmediatePropagation()
      clipKeys.current.paste()
    }
    document.addEventListener('copy', copy, true)
    document.addEventListener('paste', paste, true)
    return () => {
      document.removeEventListener('copy', copy, true)
      document.removeEventListener('paste', paste, true)
    }
  }, [])
  // Cmd+A chooses every photo here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'a' || inTextField(e.target) || viewAt >= 0 || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setChosen(list.map((f) => f.path))
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [list, viewAt])
  // Seen large and back: the grid scrolled to where it was, nothing left picked.
  const lastViewed = useRef<string | null>(null)
  useEffect(() => {
    if (viewing) lastViewed.current = viewing
    else if (lastViewed.current) {
      const i = list.findIndex((f) => f.path === lastViewed.current)
      lastViewed.current = null
      if (i >= 0) requestAnimationFrame(() => grid.current?.children[i]?.scrollIntoView({ block: 'nearest' }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewing])

  const remove = (path: string) => {
    const folders = library.folders.filter((f) => f.path !== path)
    onLibrary({ folders, current: path === folder ? (folders[0]?.path ?? RECENT) : folder })
  }
  const recent = folder === RECENT
  const name = recent ? 'Recent' : (library.folders.find((f) => f.path === folder)?.name ?? '')

  return (
    <section className={`library-view${full && viewAt >= 0 ? ' full' : ''}`} aria-label="Library">
      {side.shown && (
        <aside className={`library-side${side.closing ? ' closing' : ''}`}>
          <div className="library-folders">
            <div
              className={`library-folder${recent ? ' on' : ''}${menu?.path === RECENT ? ' menu-open' : ''}`}
              onContextMenu={(e) => openMenu(e, RECENT)}
            >
              <button title="Every photo you opened, newest first, wherever it is" onClick={() => onLibrary({ ...library, current: RECENT })}>
                Recent
              </button>
              <button className="library-folder-more" title="More" aria-label="More for Recent" onClick={(e) => openMenu(e, RECENT)}>
                ⋯
              </button>
            </div>
          </div>
          <h3>Folders</h3>
          <div className="library-folders">
            {library.folders.map((f) => (
              <div
                key={f.path}
                className={`library-folder${f.path === folder ? ' on' : ''}${menu?.path === f.path ? ' menu-open' : ''}`}
                onContextMenu={(e) => openMenu(e, f.path)}
              >
                <button title={f.path} onClick={() => onLibrary({ ...library, current: f.path })}>
                  {f.name}
                </button>
                <button className="library-folder-more" title="More" aria-label={`More for ${f.name}`} onClick={(e) => openMenu(e, f.path)}>
                  ⋯
                </button>
              </div>
            ))}
          </div>
          <button className="link library-add" onClick={onAddFolder}>
            Add folder
          </button>
        </aside>
      )}
      <input
        ref={replaceInput}
        type="file"
        accept={photoAccept()}
        hidden
        onChange={(e) => {
          const better = e.target.files?.[0]
          const f = replacing.current
          e.target.value = ''
          replacing.current = null
          if (better && f) onReplace?.(f, better)
        }}
      />
      {photoMenu && (() => {
        const f = photoMenu.file
        const sel = chosen.includes(f.path) ? chosenFiles : [f]
        const many = sel.length > 1
        const ed = editOf(f.path)
        const item = (label: string, act: () => void, title?: string) => (
          <button
            className="menu-item"
            role="menuitem"
            title={title}
            onClick={() => {
              setPhotoMenu(null)
              act()
            }}
          >
            {label}
          </button>
        )
        return (
          <div className="menu library-menu" style={{ left: photoMenu.x, top: photoMenu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
            {!many && item('Edit', () => onOpen(f), 'Enter, or double-click it')}
            {!many && item('Full screen', () => show(f), 'F or Space')}
            {!many && <div className="menu-rule" />}
            {item(many ? `Show ${sel.length} in Finder` : 'Show in Finder', () => sel.forEach(onReveal))}
            {!many && ed && originalElsewhere(f) && item('Show original in Finder', () => onRevealOriginal(f, ed.sha), 'This file is an export of it; the original is in Originals beside it')}
            {!many && ed && onReplace && item('Replace photo…', () => replace(f), REPLACE_HINT)}
            {(!many && ed) || clip ? <div className="menu-rule" /> : null}
            {!many && ed && item('Copy edit', () => onCopy(f), 'Choose what to paste in the sidebar')}
            {!many && onSubmitGallery && item('Submit to Gallery…', () => onSubmitGallery(f), 'Send it with its edit for the gallery on getcopyshop.com, credited to you')}
            {clip && item(many ? `Paste onto ${sel.length} photos` : 'Paste', () => onPaste(sel), `The parts chosen of the edit of ${clip.from}`)}
            {recent && <div className="menu-rule" />}
            {recent && item(many ? `Take ${sel.length} out of Recent` : 'Take out of Recent', () => sel.forEach((x) => void removeRecent(x.path)), 'The photos and their edits stay')}
          </div>
        )
      })()}
      {menu && (
        <div className="menu library-menu" style={{ left: menu.x, top: menu.y }} role="menu" onPointerDown={(e) => e.stopPropagation()}>
          {menu.path === RECENT ? (
            <button className="menu-item" role="menuitem" onClick={() => menuDo(async () => {
              if (!(await confirmWith('Clear Recent? The photos and their edits stay where they are.'))) return
              for (const p of await loadRecent()) await removeRecent(p.path)
            })}>
              Clear Recent…
            </button>
          ) : (
            <>
              <button className="menu-item" role="menuitem" onClick={() => menuDo(() => revealInFinder(menu.path))}>
                {showInFilesLabel()}
              </button>
              <button className="menu-item" role="menuitem" title="Look in the folder again for photos added or taken out" onClick={() => menuDo(() => folderChanged())}>
                Read again
              </button>
              <div className="menu-rule" />
              <button className="menu-item danger" role="menuitem" title="The photos and their edits stay where they are" onClick={() => menuDo(() => remove(menu.path))}>
                Remove from Library
              </button>
            </>
          )}
        </div>
      )}
      <div className="library-main">
        <div className="library-bar">
          <b title={folder ?? undefined}>{name}</b>
          <small>
            {missing ? 'Folder not found' : photos ? `${list.length} photo${list.length === 1 ? '' : 's'}${edited ? `, ${edited} edited` : ''}` : 'Reading…'}
          </small>
          {viewAt >= 0 ? (
            <div className="library-loupe-bar">
              <small>
                {list[viewAt].name} · {viewAt + 1} of {list.length}
              </small>
              <button
                title="Back to all the photos (Esc)"
                onClick={() => {
                  setFull(false)
                  setViewing(null)
                }}
              >
                Grid
              </button>
              <button className="primary" title="Edit this photo (Enter, or double-click it)" onClick={() => onOpen(list[viewAt])}>
                Edit
              </button>
            </div>
          ) : (
            <>
            {folder && (
              <select
                className="library-sort"
                value={sort}
                aria-label="Order"
                title={folder === RECENT ? 'The order of the photos here' : 'The order of the photos here, in the filmstrip too. Drag a photo to put them in your own order.'}
                onChange={(e) => setSort(e.target.value as SetSort)}
              >
                {sortsFor(folder).map((s) => (
                  <option key={s} value={s}>
                    {SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            )}
            <label className="library-size" title="How many photos to a row">
              <span>Per row</span>
              <input type="range" min={3} max={10} step={1} value={columns} onChange={(e) => setColumns(Number(e.target.value))} />
              <output>{columns}</output>
            </label>
            </>
          )}
        </div>
        {viewAt >= 0 && (
          <div className={`library-loupe-wrap${full ? ' full' : ''}`}>
            {full && (
              <button className="library-full-exit" title="Out of full screen (Esc)" onClick={() => setFull(false)}>
                Exit full screen
              </button>
            )}
            <LibraryLoupe file={list[viewAt]} edit={loupeEdit(list[viewAt])} picture={pictureFor?.(list[viewAt].path)} onEdit={() => onOpen(list[viewAt])} />
            {viewAt > 0 && (
              <button className="library-loupe-step prev" aria-label="Previous photo" title="Previous photo (←)" onClick={() => show(list[viewAt - 1])}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M10 3.5 5.5 8l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {viewAt < list.length - 1 && (
              <button className="library-loupe-step next" aria-label="Next photo" title="Next photo (→)" onClick={() => show(list[viewAt + 1])}>
                <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
                  <path d="M6 3.5 10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        )}
        <div
          className={`library-grid${dragging ? ' reordering' : ''}${chosen.length > 1 ? ' multi' : ''}`}
          ref={grid}
          hidden={(!!photos && !list.length) || viewAt >= 0}
          style={{ ['--cols' as string]: String(columns) }}
          // A click between the photos chooses none.
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setChosen([])
              setPicked(null)
            }
          }}
        >
          {list.map((f, i) => {
            const ed = editOf(f.path)
            const mark = ed?.mark
            return (
              <button
                key={f.path}
                style={demo ? { ['--i' as string]: String(i) } : undefined}
                className={`library-item${demo ? ' demo' : ''}${chosen.includes(f.path) ? ' chosen' : ''}${i === pickedAt && chosen.length > 1 ? ' picked' : ''}${isOpen(f) ? ' open' : ''}${dragClass(i, list.length)}`}
                title={`${recent ? f.path : f.name}${ed ? ` · ${EXPORT_STATE_LABEL[ed.state]}` : ''} · double-click to edit, F to see it full screen`}
                aria-pressed={chosen.includes(f.path)}
                onClick={(e) => clickPhoto(f, e)}
                data-drag=""
                onPointerDown={startAt(i)}
                onDoubleClick={() => onOpen(f)}
                onContextMenu={(e) => photoMenuAt(e, f)}
              >
                <PhotoThumb file={f} edited={mark?.thumb || (demo ? demoThumb(f.path) : null)} kind="library" />
                <span className="library-name">
                  {ed && <i className={`library-dot ${ed.state}`} aria-label={EXPORT_STATE_LABEL[ed.state]} />}
                  <span className="library-file">{f.name}</span>
                  {isOpen(f) && <span className="library-open-tag">In editor</span>}
                </span>
                {recent && (
                  <span
                    role="button"
                    className="library-item-remove"
                    title="Take it out of Recent. The photo and its edit stay."
                    aria-label={`Remove ${f.name} from Recent`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeRecent(f.path)
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                  >
                    ×
                  </span>
                )}
              </button>
            )
          })}
        </div>
        {photos && !list.length && (recent && !library.folders.length ? (
          <div className="library-empty">
            <p>Add a folder, or open photos one at a time.</p>
            <div className="row">
              <button className="primary" title="A folder of photos: each keeps its own edit, and exports save into the folder" onClick={onAddFolder}>
                Add a folder…
              </button>
              <button title="Photos one at a time: their exports ask where to save" onClick={onOpenPhotos}>
                Open photos…
              </button>
            </div>
          </div>
        ) : (
          <p className="library-empty">
            {recent ? 'Photos you open show here.' : missing ? `${name} is not where it was.` : 'No JPEG, PNG or RAW photos in this folder.'}
          </p>
        ))}
      </div>
      {!(full && viewAt >= 0) && (
        <LibrarySide
          chosen={chosenFiles}
          total={list.length}
          changed={toExport}
          onSelectAll={() => setChosen(list.map((f) => f.path))}
          onSelectNone={() => {
            setChosen([])
            setPicked(null)
          }}
          onSelectChanged={() => setChosen(toExport.map((f) => f.path))}
          onView={() => chosenFiles[0] && show(pickedAt >= 0 && chosen.includes(list[pickedAt].path) ? list[pickedAt] : chosenFiles[0])}
          onEdit={() => chosenFiles.length === 1 && onOpen(chosenFiles[0])}
          edited={(f) => !!editOf(f.path)}
          stateOf={(f) => editOf(f.path)?.state ?? null}
          onReveal={() => chosenFiles.forEach(onReveal)}
          onRevealOriginal={chosenFiles.length === 1 && originalElsewhere(chosenFiles[0]) ? () => onRevealOriginal(chosenFiles[0], editOf(chosenFiles[0].path)!.sha) : null}
          onReplace={onReplace && chosenFiles.length === 1 && editOf(chosenFiles[0].path) ? () => replace(chosenFiles[0]) : null}
          clip={clip}
          onClipParts={onClipParts}
          onCopy={() => chosenFiles.length === 1 && onCopy(chosenFiles[0])}
          onPaste={() => onPaste(chosenFiles)}
          recipes={recipes}
          onRecipe={(id) => onRecipe(chosenFiles, id)}
          onExport={() => onExportPhotos(chosenFiles.filter((f) => editOf(f.path)))}
          exporting={exporting}
          undoLabel={undoLabel}
          onUndo={onUndo}
        />
      )}
    </section>
  )
}
