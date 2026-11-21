import { useEffect, useRef } from 'react'
import type { Rect, Size } from '../engine/types'
import type { ToneRange } from './toneHighlight'

interface Props {
  base: ImageBitmap
  range: ToneRange
  /** Where the photo sits in the print, print pixels. */
  frame: Rect
  /** The part of the print on screen, print pixels. */
  region: Rect
  css: Size
}

interface Luma {
  w: number
  h: number
  encoded: Float32Array
  linear: Float32Array
  /** The blue channel, encoded: what a mask key set to Blue measures. */
  blue: Float32Array
}

/** Long side the brightness map is worked out at: plenty to see where a threshold falls. */
const SIDE = 1024
const maps = new WeakMap<ImageBitmap, Luma>()

export function lumaOf(base: ImageBitmap): Luma {
  const hit = maps.get(base)
  if (hit) return hit
  const k = Math.min(1, SIDE / Math.max(base.width, base.height))
  const w = Math.max(1, Math.round(base.width * k))
  const h = Math.max(1, Math.round(base.height * k))
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(base, 0, 0, w, h)
  const px = ctx.getImageData(0, 0, w, h).data
  const lin = (v: number) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  const encoded = new Float32Array(w * h)
  const linear = new Float32Array(w * h)
  const blue = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    const r = px[i * 4]
    const g = px[i * 4 + 1]
    const b = px[i * 4 + 2]
    encoded[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    linear[i] = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    blue[i] = b / 255
  }
  const luma = { w, h, encoded, linear, blue }
  maps.set(base, luma)
  return luma
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * The parts of the photo a brightness setting touches, tinted while it is
 * being set (see toneHighlight.ts). Worked out from the photo's own
 * brightness, so it shows where a threshold falls in the picture, before any
 * of the look is applied.
 */
export function ToneOverlay({ base, range, frame, region, css }: Props) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current
    if (!c) return
    const luma = lumaOf(base)
    if (c.width !== luma.w || c.height !== luma.h) {
      c.width = luma.w
      c.height = luma.h
    }
    const ctx = c.getContext('2d')!
    const img = ctx.createImageData(luma.w, luma.h)
    const src = range.space === 'linear' ? luma.linear : range.space === 'blue' ? luma.blue : luma.encoded
    const soft = Math.max(1e-3, range.soft ?? 0.02)
    for (let i = 0; i < src.length; i++) {
      const l = src[i]
      const w = smooth(range.lo - soft, range.lo + soft, l) * (1 - smooth(range.hi - soft, range.hi + soft, l))
      if (w <= 0.01) continue
      img.data[i * 4] = 255
      img.data[i * 4 + 1] = 40
      img.data[i * 4 + 2] = 190
      img.data[i * 4 + 3] = Math.round(w * 170)
    }
    ctx.putImageData(img, 0, 0)
  }, [base, range.lo, range.hi, range.soft, range.space])
  const sx = css.width / region.width
  const sy = css.height / region.height
  return (
    <div className="tone-overlay">
      <canvas
        ref={ref}
        style={{
          left: (frame.x - region.x) * sx,
          top: (frame.y - region.y) * sy,
          width: frame.width * sx,
          height: frame.height * sy,
        }}
      />
      {range.label && <span className="tone-overlay-label">{range.label}</span>}
    </div>
  )
}
