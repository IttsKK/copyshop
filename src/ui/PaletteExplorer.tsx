import { useEffect, useMemo, useRef, useState } from 'react'
import { toneColours, type Trio, type WheelPoint } from '../engine/harmony'
import type { ColourChoice, GradeParams, Rgb } from '../engine/types'

/** A palette from a place on the pad: hue across, gentle to bold going up. */
export function wanderPalette(x: number, y: number): Partial<GradeParams> {
  const hue = (x + 0.12 * Math.sin(y * Math.PI * 2)) % 1
  const sat = 0.55 + 0.35 * y
  // Partner offset from the light: opposite at the bottom, a near neighbour at the top.
  const off = 0.5 - 0.32 * y
  const points: Trio<WheelPoint> = [
    { hue: (hue + off + 0.04 + 1) % 1, sat: Math.min(0.95, sat + 0.05) },
    { hue: (hue + off * 0.85 + 1) % 1, sat: sat * 0.88 },
    { hue, sat: sat * 0.94 },
  ]
  const [s, m, l] = toneColours(points)
  const manual = (colour: Rgb): ColourChoice => ({ source: 'manual', colour })
  return {
    mapShadow: manual(s),
    mapMid: manual(m),
    mapHigh: manual(l),
    mapAmount: 0.45 + 0.5 * y,
    mapContrast: 0.25 * y,
    mapHarmony: 'free',
  }
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`

interface Props {
  onPreview: (patch: Partial<GradeParams> | null) => void
  onUse: (patch: Partial<GradeParams>) => void
  onClose: () => void
}

/**
 * Explore: wander over a pad of palettes and see each on the photo, without
 * changing anything. Click to hold one; Use this puts it into the palette,
 * where Light & shade and the Wheel both pick it up to fine-tune.
 */
export function PaletteExplorer({ onPreview, onUse, onClose }: Props) {
  const pad = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null)
  const cells = useMemo(() => {
    const out: { light: string; shadow: string }[] = []
    const n = 10
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const p = wanderPalette((i + 0.5) / n, 1 - (j + 0.5) / n)
        out.push({ light: css(p.mapHigh!.colour), shadow: css(p.mapShadow!.colour) })
      }
    return out
  }, [])
  const cancel = () => {
    onPreview(null)
    onClose()
  }
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && cancel()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const pointAt = (e: React.MouseEvent) => {
    const r = pad.current!.getBoundingClientRect()
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height)) }
  }
  const shown = held ?? at
  return (
    <div className="explorer" role="dialog" aria-label="Explore palettes">
      <div className="explorer-head">
        <strong>Explore palettes</strong>
        <button className="icon" aria-label="Close" onClick={cancel}>
          ×
        </button>
      </div>
      <div
        ref={pad}
        title="Move over it to see each palette on the photo: hue across, gentle to bold going up. Click to hold one"
        className={`lab-pad${held ? ' held' : ''}`}
        onPointerMove={(e) => {
          const p = pointAt(e)
          setAt(p)
          if (!held) onPreview(wanderPalette(p.x, p.y))
        }}
        onPointerLeave={() => {
          setAt(null)
          onPreview(held ? wanderPalette(held.x, held.y) : null)
        }}
        onClick={(e) => {
          const p = pointAt(e)
          setHeld(held ? null : p)
          onPreview(wanderPalette(p.x, p.y))
        }}
      >
        {cells.map((c, k) => (
          <i key={k} style={{ background: `linear-gradient(135deg, ${c.light} 0 45%, ${c.shadow} 55% 100%)` }} />
        ))}
        {shown && <b style={{ left: `${shown.x * 100}%`, top: `${(1 - shown.y) * 100}%` }} />}
      </div>
      <div className="row">
        <button onClick={cancel}>Cancel</button>
        <button
          className="primary"
          disabled={!shown}
          onClick={() => {
            if (!shown) return
            onPreview(null)
            onUse(wanderPalette(shown.x, shown.y))
            onClose()
          }}
        >
          Use this
        </button>
      </div>
    </div>
  )
}
