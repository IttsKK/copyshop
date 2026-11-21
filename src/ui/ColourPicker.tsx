import { useEffect, useRef, useState } from 'react'
import { useBaseline } from './controls'
import { hsvToRgb, rgbToHsv } from '../engine/harmony'
import type { Rgb } from '../engine/types'
import { capturePointer } from './pointer'

interface Props {
  value: Rgb
  onChange: (value: Rgb) => void
}

type Hsv = [number, number, number]

const toHex = (c: Rgb) => `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`
const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/**
 * Hue, saturation and brightness, in the panel. Hue is held in local state
 * because a grey or black colour has no hue of its own: dragging brightness to
 * zero and back must not throw away the hue you picked.
 */
export function ColourPicker({ value, onChange }: Props) {
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(value))
  const [hex, setHex] = useState(toHex(value))
  const area = useRef<HTMLDivElement>(null)
  const strip = useRef<HTMLDivElement>(null)
  const drag = useRef<'area' | 'strip' | null>(null)
  // The colour as it was when the picker opened (or the look was applied).
  const base = useBaseline(value)
  const reset = () => {
    drag.current = null
    setHsv(rgbToHsv(base))
    setHex(toHex(base))
    onChange(base)
  }

  // Follow outside changes (a swatch clicked, a preset loaded) without
  // clobbering the hue while the colour is grey.
  useEffect(() => {
    const current = toHex(hsvToRgb(hsv))
    if (current === toHex(value)) return
    const next = rgbToHsv(value)
    setHsv((prev) => (next[1] === 0 || next[2] === 0 ? [prev[0], next[1], next[2]] : next))
    setHex(toHex(value))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  const commit = (next: Hsv) => {
    setHsv(next)
    const rgb = hsvToRgb(next)
    setHex(toHex(rgb))
    onChange(rgb)
  }

  const fromPointer = (e: React.PointerEvent) => {
    if (drag.current === 'area' && area.current) {
      const r = area.current.getBoundingClientRect()
      commit([hsv[0], clamp01((e.clientX - r.left) / r.width), clamp01(1 - (e.clientY - r.top) / r.height)])
    } else if (drag.current === 'strip' && strip.current) {
      const r = strip.current.getBoundingClientRect()
      commit([clamp01((e.clientX - r.left) / r.width) * 0.9999, hsv[1], hsv[2]])
    }
  }

  const start = (which: 'area' | 'strip') => (e: React.PointerEvent) => {
    drag.current = which
    capturePointer(e.target, e.pointerId)
    fromPointer(e)
  }

  const hueColour = `rgb(${hsvToRgb([hsv[0], 1, 1]).map((v) => Math.round(v * 255)).join(' ')})`

  return (
    <div className="colour-picker" onPointerMove={(e) => drag.current && fromPointer(e)} onPointerUp={() => (drag.current = null)}>
      <div
        ref={area}
        className="picker-area"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${hueColour})` }}
        onPointerDown={start('area')}
        onDoubleClick={reset}
      >
        <i style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%`, background: toHex(hsvToRgb(hsv)) }} />
      </div>
      <div ref={strip} className="picker-hue" onPointerDown={start('strip')} onDoubleClick={reset}>
        <i style={{ left: `${hsv[0] * 100}%` }} />
      </div>
      <div className="picker-row">
        <span className="picker-swatch" style={{ background: toHex(hsvToRgb(hsv)) }} />
        <input
          type="text"
          value={hex}
          spellCheck={false}
          onChange={(e) => {
            setHex(e.target.value)
            const m = /^#?([0-9a-f]{6})$/i.exec(e.target.value.trim())
            if (m) {
              const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255) as Rgb
              setHsv(rgbToHsv(rgb))
              onChange(rgb)
            }
          }}
        />
      </div>
    </div>
  )
}
