import { useEffect, useRef, useState } from 'react'
import type { PhotoFile } from '../platform/native'
import type { Size } from '../engine/types'
import { photoThumb } from '../storage/library'

/** One photo with a new version beside it (App's handleNewCopies). */
export interface NewVersionChoice {
  /** The new version's SHA-256: what the answer is given by. */
  id: string
  photo: PhotoFile
  photoSize: Size
  copy: PhotoFile
  copySize: Size
  edited: boolean
  exported: boolean
  /** The photo as it looks now with its edit (the edit's own thumbnail), if it has one. */
  thumb?: string
}

const sizeText = (s: Size) => `${s.width}×${s.height}`

function Thumb({ file, edited }: { file: PhotoFile; edited?: string }) {
  const [src, setSrc] = useState(edited ?? '')
  useEffect(() => {
    if (edited) return
    let live = true
    photoThumb(file)
      .then((url) => live && setSrc(url))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [file, edited])
  return <span className="new-version-thumb">{src && <img src={src} alt="" draggable={false} />}</span>
}

/**
 * New versions found beside photos in a library folder (darktable's
 * PB065305_01 and the like): each photo as it looks now, and what using
 * its new version does, said in words (two pictures side by side read as
 * the edit being taken off, the new file having none yet), ticked to use
 * the new one in its place. `onDone` gets the ids of those
 * ticked, or an empty list to keep both of every one.
 */
export function NewVersionsDialog({ items, onDone }: { items: NewVersionChoice[]; onDone: (use: string[]) => void }) {
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(items.map((i) => i.id)))
  const go = useRef<HTMLButtonElement>(null)
  useEffect(() => go.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onDone([])
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone])
  const one = items.length === 1
  const n = ticked.size
  return (
    <div className="overlay">
      <div className="overlay-card new-versions" role="dialog" aria-label="New versions of photos">
        <header>
          <h2>{one ? 'A new version of a photo' : `New versions of ${items.length} photos`}</h2>
        </header>
        <p className="new-versions-lede">
          Each ticked one takes its photo’s place, and the old files go to the Trash.
        </p>
        <ul className="new-versions-list">
          {items.map((i) => {
            const on = ticked.has(i.id)
            const bigger = i.copySize.width * i.copySize.height > i.photoSize.width * i.photoSize.height
            return (
              <li key={i.id}>
                <label className={on ? 'on' : ''}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setTicked((t) => {
                        const next = new Set(t)
                        if (next.has(i.id)) next.delete(i.id)
                        else next.add(i.id)
                        return next
                      })
                    }
                  />
                  <Thumb file={i.photo} edited={i.thumb} />
                  <span className="new-version-text">
                    <b>{i.photo.name}</b>
                    <small>
                      {bigger ? 'A larger copy' : 'Another copy'} beside it: {i.copy.name}, {sizeText(i.copySize)} (now {sizeText(i.photoSize)})
                    </small>
                    <small>
                      {i.edited
                        ? i.exported
                          ? 'Your edit moves onto it unchanged, and it is exported again'
                          : 'Your edit moves onto it unchanged'
                        : 'Not edited: the new copy simply replaces it'}
                    </small>
                  </span>
                </label>
              </li>
            )
          })}
        </ul>
        <footer className="new-versions-actions">
          <button onClick={() => onDone([])}>Keep both</button>
          <button ref={go} className="primary" disabled={!n} onClick={() => onDone([...ticked])}>
            {one ? 'Use the new one' : n === items.length ? `Use the ${n} new ones` : `Use ${n} new one${n === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  )
}

/**
 * A new version written over an exported photo (darktable exporting it
 * again, App's handleNewVersion): asked before anything happens to it. Its
 * edit moves onto the new version and it is exported again; Replace sends
 * the old original to the Trash, Keep both keeps it in Originals beside the
 * new one, and Cancel leaves the new file as it is.
 */
export function ReplacedVersionDialog({
  name,
  size,
  thumb,
  onDone,
}: {
  name: string
  size: Size
  thumb?: string
  onDone: (choice: 'replace' | 'keep' | 'cancel') => void
}) {
  const go = useRef<HTMLButtonElement>(null)
  useEffect(() => go.current?.focus(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopImmediatePropagation()
      onDone('cancel')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onDone])
  return (
    <div className="overlay">
      <div className="overlay-card new-versions" role="dialog" aria-label={`A new version of ${name}`}>
        <header>
          <h2>A new version of {name}</h2>
        </header>
        <div className="new-versions-list">
          <div className="new-version-one">
            {thumb && (
              <span className="new-version-thumb">
                <img src={thumb} alt="" draggable={false} />
              </span>
            )}
            <span className="new-version-text">
              <small>
                A new version ({sizeText(size)}) was saved over your export. Your edit can move onto it unchanged, and it is exported again.
              </small>
              <small>Replace sends the old original to the Trash. Keep both keeps it in Originals, beside the new one.</small>
            </span>
          </div>
        </div>
        <footer className="new-versions-actions">
          <button onClick={() => onDone('cancel')}>Cancel</button>
          <button onClick={() => onDone('keep')}>Keep both</button>
          <button ref={go} className="primary" onClick={() => onDone('replace')}>
            Replace
          </button>
        </footer>
      </div>
    </div>
  )
}
