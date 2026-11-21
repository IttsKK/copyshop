import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CollageArrange } from '../engine/types'
import { listCollageImages, onCollageImage, type CollageImage } from '../storage/collageImages'
import { Disclosure, Slider } from './controls'
import { CollageKeepOut } from './CollageKeepOut'

interface Props {
  arrange: CollageArrange
  /** The open photo (its seed): the images kept for it. */
  photo: number
  /** The region chosen on the photo (its group), if one is. */
  region: number | null
  /** New settings, gaps or images; `run` fills the gaps with them again. */
  onArrange: (arrange: CollageArrange, run: boolean, step?: string | null) => void
  /** Done: what it filled stays, as ordinary pieces. */
  onClose: () => void
  /** Cancel: what it filled goes, back to before it opened. */
  onCancel: () => void
  /** A line for the status bar: what closing Parts not to use did. */
  onStatus?: (text: string) => void
}

const FLOWS: [CollageArrange['flow'], string][] = [
  ['down', 'Top to bottom'],
  ['up', 'Bottom to top'],
  ['right', 'Left to right'],
  ['left', 'Right to left'],
  ['out', 'Middle outward'],
  ['in', 'Edges inward'],
  ['none', 'No order'],
]

const BY: [CollageArrange['by'], string, string][] = [
  ['warmth', 'Warmth', 'Cool blues to warm golds and pinks'],
  ['tone', 'Tone', 'Light to dark (shows most with Match light lowered)'],
  ['hue', 'Hue', 'Round the colour wheel: blue, teal, green, gold, orange, red, magenta'],
]

/** A gap's region: its group, or one of its own. */
export const regionOf = (c: CollageArrange['cells'][number], i: number) => c.group ?? -(i + 1)

/**
 * Filling many gaps at once, in a small window over the photo: gaps are
 * chosen on the photo (Shift joins one to the region chosen, so one image
 * runs across them), and each change fills them again at once. A region
 * can be given an image of its own; the rest are chosen in order of
 * warmth, tone or hue, their light and colour evened out. Closing it (or
 * Esc) leaves what it filled as ordinary pieces.
 */
export function CollageFillWindow({ arrange: a, photo, region, onArrange, onClose, onCancel, onStatus }: Props) {
  // Moved by its title, off the gaps it covers.
  const [at, setAt] = useState({ x: 0, y: 0 })
  const dragFrom = useRef<{ x: number; y: number; at: { x: number; y: number } } | null>(null)
  const onHeadDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, select, input')) return
    dragFrom.current = { x: e.clientX, y: e.clientY, at }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onHeadMove = (e: React.PointerEvent) => {
    const d = dragFrom.current
    if (d) setAt({ x: d.at.x + e.clientX - d.x, y: d.at.y + e.clientY - d.y })
  }
  const onHeadUp = () => (dragFrom.current = null)
  // Small: only its title, Cancel and Done, so the photo can be judged.
  const [small, setSmall] = useState(false)
  const [images, setImages] = useState<CollageImage[]>([])
  /** Marking parts of the images not to use: open, at this image. */
  const [marking, setMarking] = useState<string | null | false>(false)
  useEffect(() => {
    let live = true
    const read = () => void listCollageImages(photo).then((list) => live && setImages(list))
    read()
    const off = onCollageImage(read)
    return () => {
      live = false
      off()
    }
  }, [photo])
  // Settings change: filled again a moment after the last change, so a slider can be dragged.
  const latest = useRef(onArrange)
  latest.current = onArrange
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  const set = (patch: Partial<CollageArrange>) => {
    const next = { ...a, ...patch }
    latest.current(next, false, 'arrange-settings')
    if (!next.cells.length) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => latest.current(next, true, 'arrange-settings'), 220)
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Esc is Cancel and Enter Done, as when placing pieces by hand.
      if ((e.key !== 'Escape' && e.key !== 'Enter') || marking !== false) return
      const t = e.target as HTMLElement | null
      if (t?.closest?.('input, select, textarea, button')) return
      e.preventDefault()
      if (e.key === 'Escape') onCancel()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onCancel, marking])
  const marked = images.filter((img) => img.keepOut && img.keepOut.data.some((v) => v))

  const regions = new Set(a.cells.map(regionOf)).size
  const inRegion = region === null ? [] : a.cells.filter((c, i) => regionOf(c, i) === region)
  const regionImage = inRegion.find((c) => c.image)?.image ?? ''
  const regionNumber = region === null ? 0 : [...new Set(a.cells.map(regionOf))].indexOf(region) + 1
  const setRegionImage = (id: string) =>
    onArrange(
      { ...a, cells: a.cells.map((c, i) => (regionOf(c, i) === region ? { x: c.x, y: c.y, group: region!, ...(id ? { image: id } : {}) } : c)) },
      true,
      null,
    )
  const used = (id: string) => a.images.includes(id)
  const pct = (v: number) => `${Math.round(v * 100)}%`
  return (
    <div className="fill-window" role="dialog" aria-label="Fill gaps" style={{ transform: `translate(${at.x}px, ${at.y}px)` }}>
      <header className="fill-head" title="Drag to move this window" onPointerDown={onHeadDown} onPointerMove={onHeadMove} onPointerUp={onHeadUp} onPointerCancel={onHeadUp}>
        <span className="fill-grip" aria-hidden="true" />
        <b>Fill gaps</b>
        <span className="fill-count">
          {a.cells.length ? `${a.cells.length} ${a.cells.length === 1 ? 'gap' : 'gaps'} · ${regions} ${regions === 1 ? 'region' : 'regions'}` : 'Click gaps on the photo'}
        </span>
        <button
          className="fill-close"
          aria-expanded={!small}
          title={small ? 'Show the settings again' : 'Make this window small, off the photo: only Cancel and Done'}
          aria-label={small ? 'Show settings' : 'Make small'}
          onClick={() => setSmall(!small)}
        >
          {small ? '+' : '−'}
        </button>
      </header>

      {!small && (
      <>
      {region !== null && inRegion.length > 0 && (
        <div className="field valued fill-region">
          <span title={`Region ${regionNumber}: ${inRegion.length === 1 ? '1 gap' : `${inRegion.length} gaps`}, one image across them`}>Region {regionNumber}</span>
          <select value={regionImage} aria-label={`Image for region ${regionNumber}`} onChange={(e) => setRegionImage(e.target.value)}>
            <option value="">Automatic</option>
            {images.map((img) => (
              <option key={img.id} value={img.id}>
                {img.name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="fill-images" role="list" aria-label="Images it chooses from">
        {images.map((img) => (
          <button
            key={img.id}
            role="listitem"
            className={`fill-image${used(img.id) ? '' : ' left-out'}${img.keepOut ? ' marked' : ''}`}
            title={`${img.name}: ${used(img.id) ? 'chosen from. Click to leave it out.' : 'left out. Click to choose from it.'}${img.keepOut ? ' Parts of it are marked not to use.' : ''}`}
            aria-pressed={used(img.id)}
            onClick={() => set({ images: used(img.id) ? a.images.filter((id) => id !== img.id) : [...a.images, img.id] })}
          >
            <img src={img.thumb} alt="" draggable={false} />
          </button>
        ))}
      </div>

      {images.length > 0 && (
        <button className="fill-mark" title="Mark parts of the images the fill should never show: a bird, a lamp post, a building against the sky" onClick={() => setMarking(null)}>
          Mark parts not to use…
        </button>
      )}
      {marked.length > 0 && (
        <p className="fill-marked">
          {marked.length === 1 ? `Marked parts of ${marked[0].name} are left out` : `Marked parts of ${marked.length} images are left out`}
        </p>
      )}
      {/* Over the whole window, not inside this one: drawn here, the small window's own scrolling and its
          moving (a transform) cut it to the window's size. */}
      {marking !== false && images.length > 0 && createPortal(
        <CollageKeepOut
          images={images}
          start={marking}
          onClose={() => {
            setMarking(false)
            // Filled again, keeping to what was marked, and saying so.
            if (!a.cells.length) return
            onArrange(a, true, null)
            onStatus?.(images.some((i) => i.keepOut) ? 'Filled the gaps again without the marked parts' : 'Filled the gaps again')
          }}
        />,
        document.body,
      )}

      <Slider
        label="Image size"
        title="How big the images are, as a share of the photo's width, alike so their clouds match. A region bigger than that gets its image grown to cover it."
        value={Math.log2(a.size)}
        min={-3}
        max={2}
        step={0.01}
        format={(v) => `${Math.round(2 ** v * 100)}%`}
        onChange={(v) => set({ size: 2 ** v })}
      />
      {/* Order and colour: there to change, after the images and their size. */}
      <Disclosure id="fill-more" title="Order and colour">
        <div className="field valued">
          <span title="Which way the images run across the photo, and what they are put in order by">Order</span>
          <select value={a.flow} aria-label="Order runs" onChange={(e) => set({ flow: e.target.value as CollageArrange['flow'] })}>
            {FLOWS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        {a.flow !== 'none' && (
          <div className="segmented fill-by">
            {BY.map(([v, label, title]) => (
              <button key={v} className={a.by === v ? 'on' : ''} title={title} onClick={() => set({ by: v })}>
                {label}
              </button>
            ))}
          </div>
        )}
        <Slider
          label="Match light"
          title="How far each image's brightness is matched to the sky it replaces. Full keeps the photo's own light; lower lets the images' own brightness show."
          value={a.match}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(match) => set({ match })}
        />
        <Slider
          label="Harmony"
          title="Pulls every image's colour toward the colour they share, so none jumps out"
          value={a.harmony}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(harmony) => set({ harmony })}
        />
        <Slider
          label="Keep to order"
          title="How closely the images keep to the order: low mixes them evenly, high lays them out strictly in sequence"
          value={a.follow}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (v < 0.03 ? 'Mixed' : pct(v))}
          onChange={(follow) => set({ follow })}
        />
        <Slider
          label="Neighbours"
          title="Regions that touch: alike, so colours run into each other, or different, so each stands apart"
          value={a.neighbours}
          min={-1}
          max={1}
          step={0.01}
          format={(v) => (v < -0.03 ? `Alike ${Math.round(-v * 100)}` : v > 0.03 ? `Apart ${Math.round(v * 100)}` : 'Either')}
          onChange={(neighbours) => set({ neighbours })}
        />
        <Slider
          label="Even tone"
          title="Pulls bright and dark images toward the same brightness, for what Match light leaves of their own"
          value={a.evenTone}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(evenTone) => set({ evenTone })}
        />
        <label className="check-row" title="An image used more than once shows a different part of itself each time, some mirrored, so repeats do not read as copies">
          <input type="checkbox" checked={a.vary} onChange={(e) => set({ vary: e.target.checked })} />
          Vary repeated images
        </label>
      </Disclosure>

      </>
      )}

      <div className="row fill-done">
        <button title="Take off what this window filled: back to before it opened (Esc)" onClick={onCancel}>
          Cancel
        </button>
        <button className="primary" title="Keep what it filled, as ordinary pieces (Enter)" onClick={onClose}>
          Done
        </button>
      </div>
      {!small && <div className="row fill-actions">
        <button
          disabled={!a.cells.length}
          title="The same gaps and images, laid out another way"
          onClick={() => onArrange({ ...a, seed: (a.seed % 100000) + 1 + Math.floor(Math.random() * 1000) }, true, null)}
        >
          Shuffle
        </button>
        <button disabled={!a.cells.length} title="Take every gap off: what it filled goes" onClick={() => onArrange({ ...a, cells: [] }, true, null)}>
          Clear
        </button>
      </div>}
    </div>
  )
}
