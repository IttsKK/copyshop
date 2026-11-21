import { useRef } from 'react'
import {
  HARMONIES,
  fromWheel,
  guidedMove,
  hsvToRgb,
  moveOne,
  toneColours,
  wheelPoint,
  type Harmony,
  type Trio,
  type WheelPoint,
} from '../engine/harmony'
import type { Rgb } from '../engine/types'
import { useBaseline } from './controls'
import { capturePointer } from './pointer'

interface Props {
  /** Shadows, midtones, light, as they are now. */
  colours: Trio<Rgb>
  harmony: Harmony
  balance: number
  contrast: number
  onChange: (colours: Trio<Rgb>, harmony: Harmony) => void
}

const SLOTS = [
  { name: 'Shadows', r: 7, v: 0.35 },
  { name: 'Midtones', r: 8, v: 0.7 },
  { name: 'Light', r: 9.5, v: 1 },
] as const

const SIZE = 200
const C = SIZE / 2
/** Radius of the wheel itself, inside the box: room for a handle at full saturation. */
const R = C - 11

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`
const at = (p: WheelPoint) => ({
  x: C + p.sat * R * Math.sin(p.hue * Math.PI * 2),
  y: C - p.sat * R * Math.cos(p.hue * Math.PI * 2),
})

/**
 * The palette on a colour wheel: hue round it, saturation out from the
 * middle. In a harmony the wheel is guided: drag one colour and the other
 * two are laid out from it as a palette that works (see guidedMove) — the
 * tones' letters move to whichever colour suits them. In Free each colour
 * moves on its own. Pressing the wheel away from the handles takes the
 * nearest one there.
 */
/**
 * Whether three colours sit as a harmony lays them out. A palette saved
 * under a harmony and then set some other way (a preset, exact colours)
 * no longer does, and the wheel shows it as free rather than draw a shape
 * the colours are not in.
 */
function fits(points: Trio<WheelPoint>, harmony: Harmony): boolean {
  if (harmony === 'free') return true
  const near = (a: WheelPoint, b: WheelPoint) => {
    const dh = Math.abs(a.hue - b.hue) % 1
    return Math.min(dh, 1 - dh) * Math.max(a.sat, b.sat) < 0.03 && Math.abs(a.sat - b.sat) < 0.06
  }
  // Laid out from any one of them: which one led is not stored.
  return points.some((p, i) => guidedMove(harmony, i, p).points.every((l) => points.some((q) => near(l, q))))
}

export function PaletteWheel({ colours, harmony: stated, onChange }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<number | null>(null)
  const points = colours.map(wheelPoint) as Trio<WheelPoint>
  const harmony: Harmony = fits(points, stated) ? stated : 'free'
  // Double-click the wheel: the palette as the look set it.
  const base = useBaseline({ colours, harmony })

  const pointAt = (e: React.PointerEvent): WheelPoint | null => {
    const rect = box.current?.getBoundingClientRect()
    if (!rect) return null
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C
    const hue = (Math.atan2(x, -y) / (Math.PI * 2) + 1) % 1
    return { hue, sat: Math.min(1, Math.hypot(x, y) / R) }
  }
  /** Move colour `index` to `to`; returns where the dragged colour is now. */
  const move = (index: number, to: WheelPoint): number => {
    if (harmony === 'free') {
      const next = moveOne(points, index, to)
      onChange(next.map((p, i) => fromWheel(p, colours[i])) as Trio<Rgb>, harmony)
      return index
    }
    const next = guidedMove(harmony, index, to)
    onChange(toneColours(next.points), harmony)
    return next.index
  }
  const down = (e: React.PointerEvent) => {
    const to = pointAt(e)
    if (!to) return
    const handle = (e.target as Element).closest('[data-slot]')
    let index = handle ? Number(handle.getAttribute('data-slot')) : -1
    if (index < 0) {
      // Nearest handle, on screen.
      const target = at(to)
      index = points.reduce((best, p, i) => {
        const d = (q: WheelPoint) => Math.hypot(at(q).x - target.x, at(q).y - target.y)
        return d(p) < d(points[best]) ? i : best
      }, 2)
      index = move(index, to)
    }
    drag.current = index
    capturePointer(e.currentTarget, e.pointerId)
    e.preventDefault()
  }
  const key = (index: number) => (e: React.KeyboardEvent) => {
    const p = points[index]
    const step = e.shiftKey ? 0.05 : 0.01
    const to =
      e.key === 'ArrowLeft' ? { ...p, hue: p.hue - step }
      : e.key === 'ArrowRight' ? { ...p, hue: p.hue + step }
      : e.key === 'ArrowUp' ? { ...p, sat: p.sat + step }
      : e.key === 'ArrowDown' ? { ...p, sat: p.sat - step }
      : null
    if (!to) return
    e.preventDefault()
    const now = move(index, to)
    // Keep focus on the colour being moved, wherever its tone went.
    if (now !== index) requestAnimationFrame(() => box.current?.querySelector<SVGGElement>(`[data-slot="${now}"]`)?.focus())
  }

  return (
    <div className="palette-wheel">
      <div
        ref={box}
        className="wheel"
        onPointerDown={down}
        onPointerMove={(e) => {
          if (drag.current === null) return
          const to = pointAt(e)
          if (to) drag.current = move(drag.current, to)
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onDoubleClick={() => onChange(base.colours, base.harmony)}
        title="Drag a colour; double-click to put the palette back"
      >
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden={false}>
          {harmony !== 'free' && (
            <polygon
              className="wheel-shape"
              points={points.map((p) => `${at(p).x},${at(p).y}`).join(' ')}
            />
          )}
          {points.map((p, i) => (
            <line key={`l${i}`} className="wheel-spoke" x1={C} y1={C} x2={at(p).x} y2={at(p).y} />
          ))}
          {points.map((p, i) => (
            <g
              key={i}
              data-slot={i}
              className="wheel-handle"
              role="slider"
              tabIndex={0}
              aria-label={`${SLOTS[i].name} colour`}
              aria-valuetext={`hue ${Math.round(p.hue * 360)}°, saturation ${Math.round(p.sat * 100)}%`}
              onKeyDown={key(i)}
            >
              <title>{`${SLOTS[i].name}: drag round for hue, in and out for depth`}</title>
              <circle cx={at(p).x} cy={at(p).y} r={SLOTS[i].r} fill={css(hsvToRgb([p.hue, p.sat, SLOTS[i].v]))} />
              <text x={at(p).x} y={at(p).y} dy="0.35em">
                {SLOTS[i].name[0]}
              </text>
            </g>
          ))}
        </svg>
      </div>
      <div className="chips harmony">
        {HARMONIES.map((h) => (
          <button
            key={h.id}
            className={harmony === h.id ? 'on' : ''}
            title={h.hint}
            onClick={() => {
              // Lay the palette out afresh from its light colour.
              if (h.id === 'free') onChange(colours, h.id)
              else onChange(toneColours(guidedMove(h.id, 2, points[2]).points), h.id)
            }}
          >
            {h.label}
          </button>
        ))}
      </div>
    </div>
  )
}
