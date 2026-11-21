import { useEffect, useRef, useState } from 'react'
import { imageInfo } from '../engine/arrange'
import { defaultReading, segment } from '../ml/segment'
import { setCollageKeepOut, type CollageImage, type KeepOut } from '../storage/collageImages'
import { keyWords } from '../platform/os'
import { Slider } from './controls'
import { capturePointer } from './pointer'

/** The marks' grid: this many cells on the image's long side. */
const SIDE = 256
/** The image on screen at most this big. */
const VIEW_W = 640
const VIEW_H = 440
/** What the card's other parts take: its padding across, and its title, images, tools and margins down. */
const CARD_SIDES = 40 + 34
const CARD_REST = 300
const roomFor = () => ({
  w: Math.max(200, Math.min(VIEW_W, window.innerWidth - CARD_SIDES)),
  h: Math.max(140, Math.min(VIEW_H, window.innerHeight * 0.9 - CARD_REST)),
})

type Tool = 'select' | 'brush' | 'erase'

const gridOf = (img: CollageImage): { w: number; h: number } => {
  const k = SIDE / Math.max(img.bitmap.width, img.bitmap.height)
  return { w: Math.max(1, Math.round(img.bitmap.width * k)), h: Math.max(1, Math.round(img.bitmap.height * k)) }
}

/**
 * Parts of the collage images marked not to use: a bird, a lamp post, a
 * building against the sky. Click one to select it (Option: take a part
 * back out), or brush and erase by hand. What the fill already leaves out
 * by itself (the ground, a ridge and what is under it) shows dimmed.
 * Kept with each image, for every photo's collage, as it is marked.
 */
export function CollageKeepOut({ images, start, onClose }: { images: CollageImage[]; start: string | null; onClose: () => void }) {
  const [id, setId] = useState(start ?? images[0]?.id ?? '')
  const img = images.find((i) => i.id === id) ?? images[0]
  const [tool, setTool] = useState<Tool>('select')
  const [brush, setBrush] = useState(0.05)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The marks being edited, for the image shown.
  const [marks, setMarks] = useState<KeepOut | null>(null)
  useEffect(() => {
    if (!img) return
    const g = gridOf(img)
    setMarks(img.keepOut && img.keepOut.w === g.w && img.keepOut.h === g.h ? { ...img.keepOut, data: img.keepOut.data.slice() } : { ...g, data: new Uint8Array(g.w * g.h), at: 0 })
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])
  const save = (next: KeepOut) => {
    setMarks(next)
    if (!img) return
    const any = next.data.some((v) => v)
    void setCollageKeepOut(img.id, any ? { ...next, at: Date.now() } : null)
  }

  // The image as big as the window has room for, up to VIEW_W by VIEW_H: in a small window the whole
  // card (its images, the tools, Done) fits on screen, not cut off at its foot.
  const [room, setRoom] = useState(() => roomFor())
  useEffect(() => {
    const on = () => setRoom(roomFor())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  const k = img ? Math.min(room.w / img.bitmap.width, room.h / img.bitmap.height) : 1
  const vw = img ? Math.round(img.bitmap.width * k) : VIEW_W
  const vh = img ? Math.round(img.bitmap.height * k) : VIEW_H
  const photo = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = photo.current
    if (!c || !img) return
    c.getContext('2d')!.drawImage(img.bitmap, 0, 0, c.width, c.height)
  }, [img, vw, vh])
  // The marks in red, what the fill leaves out by itself dimmed.
  useEffect(() => {
    const c = over.current
    if (!c || !img || !marks) return
    const ctx = c.getContext('2d')!
    ctx.clearRect(0, 0, c.width, c.height)
    const auto = imageInfo(img.id, img.bitmap).usable
    if (auto) {
      const a = document.createElement('canvas')
      a.width = auto.w
      a.height = auto.h
      const ad = a.getContext('2d')!.createImageData(auto.w, auto.h)
      for (let i = 0; i < auto.data.length; i++) if (!auto.data[i]) ad.data.set([10, 10, 12, 150], i * 4)
      a.getContext('2d')!.putImageData(ad, 0, 0)
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(a, 0, 0, c.width, c.height)
    }
    const m = document.createElement('canvas')
    m.width = marks.w
    m.height = marks.h
    const md = m.getContext('2d')!.createImageData(marks.w, marks.h)
    for (let i = 0; i < marks.data.length; i++) if (marks.data[i]) md.data.set([235, 70, 60, 150], i * 4)
    m.getContext('2d')!.putImageData(md, 0, 0)
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(m, 0, 0, c.width, c.height)
  }, [img, marks, vw, vh])

  const at = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) }
  }
  const painting = useRef<{ on: boolean; data: Uint8Array } | null>(null)
  const paint = (p: { x: number; y: number }) => {
    const d = painting.current
    if (!d || !marks) return
    const r = (brush * Math.max(marks.w, marks.h)) / 2
    const cx = p.x * marks.w
    const cy = p.y * marks.h
    for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(marks.h - 1, Math.ceil(cy + r)); y++)
      for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(marks.w - 1, Math.ceil(cx + r)); x++)
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) d.data[y * marks.w + x] = d.on ? 1 : 0
    setMarks({ ...marks, data: d.data })
  }
  const select = async (p: { x: number; y: number }, out: boolean) => {
    if (!img || !marks || busy) return
    setBusy(true)
    setError(null)
    try {
      const sel = await segment(img.bitmap, [{ x: p.x, y: p.y, on: true }])
      if (!sel) return
      const m = sel.masks[defaultReading(sel, 1)]
      const data = marks.data.slice()
      for (let y = 0; y < marks.h; y++)
        for (let x = 0; x < marks.w; x++) {
          const sx = Math.min(sel.width - 1, Math.floor(((x + 0.5) * sel.width) / marks.w))
          const sy = Math.min(sel.height - 1, Math.floor(((y + 0.5) * sel.height) / marks.h))
          if (m[sy * sel.width + sx]) data[y * marks.w + x] = out ? 0 : 1
        }
      save({ ...marks, data })
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const any = !!marks?.data.some((v) => v)

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="overlay-card keepout-card"
        role="dialog"
        aria-label="Parts not to use"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape') onClose()
        }}
      >
        <header>
          <h2 title="Fill gaps keeps these parts out of the gaps it fills, and fills them again when you close this. Images you placed in a gap by hand stay as they are.">
            Parts not to use
          </h2>
          <button className="icon" title="Close (Esc)" onClick={onClose}>
            ×
          </button>
        </header>
        <p className="keepout-hint">Fill gaps leaves these out</p>
        <div className="keepout-body">
          <div className="keepout-images" role="tablist" aria-label="Images">
            {images.map((i) => (
              <button key={i.id} role="tab" aria-selected={i.id === img?.id} className={`keepout-thumb${i.id === img?.id ? ' on' : ''}${i.keepOut ? ' marked' : ''}`} title={i.name} onClick={() => setId(i.id)}>
                <img src={i.thumb} alt="" draggable={false} />
              </button>
            ))}
          </div>
          {img && (
            <div className={`keepout-stage${busy ? ' busy' : ''}`} style={{ width: vw, height: vh }}>
              <canvas ref={photo} width={vw} height={vh} />
              <canvas
                ref={over}
                width={vw}
                height={vh}
                className={`keepout-marks ${tool}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return
                  const p = at(e)
                  if (tool === 'select') return void select(p, e.altKey)
                  capturePointer(e.currentTarget, e.pointerId)
                  painting.current = { on: tool === 'brush', data: marks!.data.slice() }
                  paint(p)
                }}
                onPointerMove={(e) => painting.current && paint(at(e))}
                onPointerUp={() => {
                  const d = painting.current
                  painting.current = null
                  if (d && marks) save({ ...marks, data: d.data })
                }}
              />
            </div>
          )}
          <div className="keepout-tools">
            <div className="segmented">
              <button className={tool === 'select' ? 'on' : ''} title={keyWords('Click a thing to mark it (Option-click takes a part of it back out)')} onClick={() => setTool('select')}>
                Select
              </button>
              <button className={tool === 'brush' ? 'on' : ''} title="Paint over what not to use" onClick={() => setTool('brush')}>
                Brush
              </button>
              <button className={tool === 'erase' ? 'on' : ''} title="Paint marks away" onClick={() => setTool('erase')}>
                Erase
              </button>
            </div>
            {tool !== 'select' && (
              <Slider label="Size" value={brush} min={0.01} max={0.25} step={0.005} format={(v) => `${Math.round(v * 100)}%`} onChange={setBrush} />
            )}
            <span className="keepout-status">{busy ? 'Finding it…' : error ?? ''}</span>
            <button disabled={!any} onClick={() => marks && save({ ...marks, data: new Uint8Array(marks.w * marks.h) })}>
              Clear marks
            </button>
            <button className="primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
