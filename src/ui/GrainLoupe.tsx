import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { renderClient } from '../engine/renderClient'
import { photoFrameOf, printSizeOf, type BlendParams, type Size } from '../engine/types'
import type { GrainTexture } from '../sources/GrainSource'
import { capturePointer } from './pointer'
import { lumaOf } from './ToneOverlay'

interface Props {
  base: ImageBitmap
  baseSize: Size
  imageSeed?: number
  grain: GrainTexture
  params: BlendParams
  onError: (message: string) => void
}

const HEIGHT = 150
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Where grain is easiest to judge: the flattest midtone patch of the photo
 * (a sky, a wall), where there is no detail for it to hide in. Fractions of
 * the photo.
 */
function flattestSpot(base: ImageBitmap): { x: number; y: number } {
  const l = lumaOf(base)
  const cell = Math.max(8, Math.round(Math.min(l.w, l.h) / 14))
  let best = { x: 0.5, y: 0.5 }
  let bestScore = Infinity
  for (let cy = 0; cy + cell <= l.h; cy += cell >> 1) {
    for (let cx = 0; cx + cell <= l.w; cx += cell >> 1) {
      let s = 0
      let s2 = 0
      for (let y = cy; y < cy + cell; y += 2) {
        for (let x = cx; x < cx + cell; x += 2) {
          const v = l.encoded[y * l.w + x]
          s += v
          s2 += v * v
        }
      }
      const n = Math.ceil(cell / 2) ** 2
      const mean = s / n
      const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean))
      // Grain shows most in the midtones; flat and mid-grey wins.
      const score = sd + Math.abs(mean - 0.5) * 0.25
      if (score < bestScore) {
        bestScore = score
        best = { x: (cx + cell / 2) / l.w, y: (cy + cell / 2) / l.h }
      }
    }
  }
  return best
}

/**
 * The grain as it will come out: a strip of the photo at 100% of the export
 * (or 200%), with the whole look on it, beside the controls. Grain cannot be
 * judged at Fit, and the bare plate does not show Scale or Softness, so this
 * is what to watch while dialling it in. Drag it to look elsewhere.
 */
export function GrainLoupe({ base, baseSize, imageSeed, grain, params, onError }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [visible, setVisible] = useState(true)
  const [zoom, setZoom] = useState<1 | 2>(1)
  // Centre of the view, fractions of the photo; picked anew for each photo.
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null)
  const drag = useRef<{ x: number; y: number; spot: { x: number; y: number } } | null>(null)
  const dpr = window.devicePixelRatio || 1

  useEffect(() => setSpot(flattestSpot(base)), [base])

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    // Only rendered while it can be seen: it shares the preview's engine.
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting))
    io.observe(el)
    return () => {
      ro.disconnect()
      io.disconnect()
    }
  }, [])

  const frame = photoFrameOf(baseSize, params)
  const print = printSizeOf(baseSize, params)
  // Print pixels across the view.
  const spanW = (width * dpr) / zoom
  const spanH = (HEIGHT * dpr) / zoom

  useEffect(() => {
    const c = canvas.current
    if (!c || !spot || !visible || width <= 0) return
    const cx = frame.x + spot.x * frame.width
    const cy = frame.y + spot.y * frame.height
    const w = Math.min(spanW, print.width)
    const h = Math.min(spanH, print.height)
    const x = clamp(cx - w / 2, 0, Math.max(0, print.width - w))
    const y = clamp(cy - h / 2, 0, Math.max(0, print.height - h))
    let live = true
    renderClient
      .render('grain-loupe', 'main', {
        base,
        baseSize,
        grain: grain.source,
        grainSize: grain.size,
        grainMean: grain.mean,
        grainSd: grain.sd,
        params,
        imageSeed,
        region: { x, y, width: w, height: h },
        outputSize: { width: Math.round(w * zoom), height: Math.round(h * zoom) },
      })
      .then((res) => {
        if (!res) return
        if (live && canvas.current === c) {
          c.width = Math.round(width * dpr)
          c.height = Math.round(HEIGHT * dpr)
          const ctx = c.getContext('2d')!
          ctx.fillStyle = '#18191c'
          ctx.fillRect(0, 0, c.width, c.height)
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(res.bitmap, Math.round((c.width - res.bitmap.width) / 2), Math.round((c.height - res.bitmap.height) / 2))
        }
        res.bitmap.close()
      })
      .catch((err: Error) => onError(err.message))
    return () => {
      live = false
    }
    // frame and print follow from baseSize and params.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, baseSize, grain, params, imageSeed, spot, visible, width, zoom, dpr, onError])

  return (
    <div className="grain-loupe" ref={host}>
      <canvas
        ref={canvas}
        style={{ width: '100%', height: HEIGHT }}
        role="img"
        aria-label={`The photo at ${zoom * 100}% with the grain on it`}
        title="The grain as it will come out, at 100% of the export. Drag to look at another part of the photo; double-click to go back to its flattest midtone, where grain shows most."
        onPointerDown={(e) => {
          if (!spot) return
          capturePointer(e.currentTarget, e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, spot }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const k = dpr / zoom
          setSpot({
            x: clamp(d.spot.x - ((e.clientX - d.x) * k) / frame.width, 0, 1),
            y: clamp(d.spot.y - ((e.clientY - d.y) * k) / frame.height, 0, 1),
          })
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => setSpot(flattestSpot(base))}
      />
      <div className="grain-loupe-zoom segmented">
        {([1, 2] as const).map((z) => (
          <button key={z} className={zoom === z ? 'on' : ''} onClick={() => setZoom(z)} title={z === 1 ? 'Export pixels, one to one' : 'Twice as close'}>
            {z * 100}%
          </button>
        ))}
      </div>
    </div>
  )
}
