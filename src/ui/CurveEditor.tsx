import { useCallback, useEffect, useRef, useState } from 'react'
import { useBaseline } from './controls'
import { capturePointer } from './pointer'
import {
  CURVE_PRESETS,
  MAX_STRENGTH,
  blendSensitivity,
  evaluateCurve,
  normaliseCurve,
  peakBlendSensitivity,
  type GrainCurve,
} from '../engine/curve'

interface Props {
  curve: GrainCurve
  onChange: (curve: GrainCurve) => void
  /** Normalised luminance histogram of the current image, drawn behind. */
  histogram: number[] | null
  /** Changes whenever the panel layout does, prompting a re-measure. */
  layoutVersion: number
  /** Used to draw what the blend mode does to the response on its own. */
  blendMode: string
  colorSpace: string
}

const HEIGHT = 132
const PAD = 10
const HIT_RADIUS = 9

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/**
 * Draggable grain-strength curve.
 *
 * Horizontal is base-image luminance, vertical is how much of the Amount
 * slider lands there. The image's own histogram sits behind it, because
 * "less grain in the highlights" only means something once you can see where
 * this picture's highlights actually are.
 */
export function CurveEditor({ curve, onChange, histogram, layoutVersion, blendMode, colorSpace }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ width: 240, height: HEIGHT })
  const [dragging, setDragging] = useState<number | null>(null)
  const [hover, setHover] = useState<number | null>(null)

  // Never write an inline width: the CSS keeps the canvas at 100% of the panel,
  // so measuring layout is what tracks a panel resize. Driving the CSS width
  // from state instead pinned it at whatever it measured first.
  const measure = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const width = canvas.getBoundingClientRect().width
    setSize((prev) => (Math.abs(prev.width - width) < 0.5 ? prev : { width: Math.max(80, width), height: HEIGHT }))
  }, [])

  // Re-measure on the three things that can change our width: a panel resize
  // (signalled by layoutVersion), a window resize, and anything else the
  // observer catches. Measuring on every render instead risks a feedback loop
  // between the measurement and the layout it feeds.
  useEffect(() => {
    measure()
    const ro = new ResizeObserver(measure)
    if (canvasRef.current) ro.observe(canvasRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, layoutVersion])

  const plot = useCallback(
    (p: { x: number; y: number }) => ({
      px: PAD + p.x * (size.width - PAD * 2),
      py: PAD + (1 - p.y / MAX_STRENGTH) * (size.height - PAD * 2),
    }),
    [size],
  )

  const unplot = useCallback(
    (px: number, py: number) => ({
      x: clamp((px - PAD) / (size.width - PAD * 2), 0, 1),
      y: clamp((1 - (py - PAD) / (size.height - PAD * 2)) * MAX_STRENGTH, 0, MAX_STRENGTH),
    }),
    [size],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(size.width * dpr)
    canvas.height = Math.round(size.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const left = PAD
    const right = size.width - PAD
    const top = PAD
    const bottom = size.height - PAD

    // Histogram of the image being worked on.
    if (histogram?.length) {
      ctx.fillStyle = 'rgba(255,255,255,0.09)'
      const w = (right - left) / histogram.length
      histogram.forEach((v, i) => {
        const h = v * (bottom - top)
        ctx.fillRect(left + i * w, bottom - h, Math.max(1, w - 0.5), h)
      })
    }

    // Grid: the horizontal line is strength 1, "grain as the slider says".
    ctx.strokeStyle = 'rgba(255,255,255,0.08)'
    ctx.lineWidth = 1
    for (let i = 1; i < 4; i++) {
      const x = left + ((right - left) * i) / 4
      ctx.beginPath()
      ctx.moveTo(x, top)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    }
    const unityY = plot({ x: 0, y: 1 }).py
    ctx.strokeStyle = 'rgba(255,255,255,0.22)'
    ctx.setLineDash([3, 3])
    ctx.beginPath()
    ctx.moveTo(left, unityY)
    ctx.lineTo(right, unityY)
    ctx.stroke()
    ctx.setLineDash([])

    // What the grain actually ends up doing: the curve multiplied by the blend
    // mode's own sensitivity. With Overlay this sags hard at both ends even
    // when the drawn curve is flat, which is otherwise invisible.
    const peakSensitivity = peakBlendSensitivity(blendMode, colorSpace)
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.85)'
    ctx.lineWidth = 1.2
    ctx.setLineDash([4, 3])
    ctx.beginPath()
    for (let px = left; px <= right; px++) {
      const x = (px - left) / (right - left)
      const effective = clamp(evaluateCurve(curve, x), 0, MAX_STRENGTH) *
        (blendSensitivity(blendMode, colorSpace, x) / peakSensitivity)
      const { py } = plot({ x, y: effective })
      px === left ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()
    ctx.setLineDash([])

    // The curve itself, sampled the same way the shader's LUT is.
    ctx.strokeStyle = '#cf9a4f'
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let px = left; px <= right; px++) {
      const x = (px - left) / (right - left)
      const { py } = plot({ x, y: clamp(evaluateCurve(curve, x), 0, MAX_STRENGTH) })
      px === left ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
    }
    ctx.stroke()

    curve.forEach((p, i) => {
      const { px, py } = plot(p)
      const active = dragging === i || hover === i
      ctx.beginPath()
      ctx.arc(px, py, active ? 5 : 3.5, 0, Math.PI * 2)
      ctx.fillStyle = active ? '#f0d3a4' : '#cf9a4f'
      ctx.fill()
      ctx.strokeStyle = '#16171a'
      ctx.lineWidth = 1.5
      ctx.stroke()
    })
  }, [blendMode, colorSpace, curve, dragging, histogram, hover, plot, size])

  const pointAt = (px: number, py: number): number | null => {
    for (let i = 0; i < curve.length; i++) {
      const { px: cx, py: cy } = plot(curve[i])
      if (Math.hypot(cx - px, cy - py) <= HIT_RADIUS) return i
    }
    return null
  }

  const localPos = (e: React.PointerEvent | React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { px: e.clientX - rect.left, py: e.clientY - rect.top }
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const { px, py } = localPos(e)
    const hit = pointAt(px, py)
    if (hit !== null) {
      setDragging(hit)
      capturePointer(e.target, e.pointerId)
      return
    }
    // Clicking empty space adds a point there and starts dragging it.
    const p = unplot(px, py)
    const next = normaliseCurve([...curve, p])
    const index = next.findIndex((q) => q.x === p.x && q.y === p.y)
    onChange(next)
    setDragging(index === -1 ? null : index)
    capturePointer(e.target, e.pointerId)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const { px, py } = localPos(e)
    if (dragging === null) {
      setHover(pointAt(px, py))
      return
    }
    const p = unplot(px, py)
    const next = curve.map((q, i) => (i === dragging ? q : q))
    // End points stay anchored at 0 and 1 so the curve always spans the range.
    const isEnd = dragging === 0 || dragging === curve.length - 1
    next[dragging] = { x: isEnd ? curve[dragging].x : p.x, y: p.y }
    // Keep the order stable while dragging rather than re-sorting under the cursor.
    const lo = dragging > 0 ? next[dragging - 1].x + 0.005 : 0
    const hi = dragging < next.length - 1 ? next[dragging + 1].x - 0.005 : 1
    next[dragging] = { ...next[dragging], x: clamp(next[dragging].x, lo, hi) }
    onChange(next)
  }

  const onPointerUp = () => setDragging(null)

  // Double-click a point to remove it; anywhere else puts the whole curve back
  // as the look set it.
  const baseCurve = useBaseline(curve)
  const onDoubleClick = (e: React.MouseEvent) => {
    const { px, py } = localPos(e)
    const hit = pointAt(px, py)
    if (hit === null) {
      onChange(baseCurve)
      return
    }
    if (hit === 0 || hit === curve.length - 1) return
    onChange(curve.filter((_, i) => i !== hit))
  }

  const readout = hover !== null || dragging !== null ? curve[(dragging ?? hover)!] : null

  return (
    <div className="curve">
      <canvas
        ref={canvasRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          setHover(null)
          onPointerUp()
        }}
        onDoubleClick={onDoubleClick}
      />
      <div className="curve-axis">
        <span>Shadows</span>
        <span>{readout ? `${Math.round(readout.x * 100)}% → ${Math.round(readout.y * 100)}` : 'Midtones'}</span>
        <span>Highlights</span>
      </div>
      <div className="curve-presets">
        {CURVE_PRESETS.map((preset) => (
          <button key={preset.name} title={preset.name} onClick={() => onChange(preset.curve.map((p) => ({ ...p })))}>
            {preset.name}
          </button>
        ))}
      </div>
      <p className="muted status-line">
        <span className="swatch curve-line" /> what you draw
        <span className="swatch effective-line" /> what lands, after {blendMode === 'linearLight' ? 'Linear Light' : blendMode === 'overlay' ? 'Overlay' : 'Soft Light'}
      </p>
      <p className="muted status-line">Click to add a point, double-click one to remove it.</p>
    </div>
  )
}
