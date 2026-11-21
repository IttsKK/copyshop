import { useEffect, useRef, useState } from 'react'
import { hsvToRgb, rampColour, rgbToHsv } from '../engine/harmony'
import {
  LIGHT_ARC,
  SCREEN_OFFSET,
  SHADE_ARC,
  clampHue,
  lightShadeOf,
  lightShadeStops,
  mirrored,
  oklch,
  sideOf,
  type LightShade,
} from '../engine/lightshade'
import type { ColourChoice, GradeParams, Rgb } from '../engine/types'
import type { Palette } from '../engine/palette'
import { useBaseline } from './controls'
import { capturePointer } from './pointer'

interface Props {
  grade: GradeParams
  setGrade: (patch: Partial<GradeParams>) => void
  palette: Palette
  onPreview: (patch: Partial<GradeParams> | null) => void
}

type SideId = 'light' | 'shade'

const SIZE = 200
const C = SIZE / 2
const R = C - 11
const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(' ')})`
const manual = (colour: Rgb): ColourChoice => ({ source: 'manual', colour })
const rad = (deg: number) => (deg * Math.PI) / 180
const inArc = (h: number, [a, b]: [number, number]) => h >= a && h <= b

/** A hue and depth's place in the 200-unit box: warm at the top, cool at the bottom. */
const at = (hue: number, r: number) => ({
  x: C + r * R * Math.sin(rad(hue - SCREEN_OFFSET)),
  y: C - r * R * Math.cos(rad(hue - SCREEN_OFFSET)),
})

/** The colour a handle shows: the light bright, the shade as it sits in the shadows. */
const handleColour = (side: SideId, hue: number, r: number): Rgb =>
  side === 'light'
    ? hsvToRgb([rgbToHsv(oklch(0.65, 0.1, hue))[0], 0.82 * r, 1])
    : hsvToRgb([rgbToHsv(oklch(0.65, 0.1, hue))[0], 0.83 * r, 0.62])

/** Paint the disc once: the light's colours over the top, the shade's under, grey where neither goes. */
function paintDisc(canvas: HTMLCanvasElement) {
  const n = 120
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const img = ctx.createImageData(n, n)
  const hsvOf = new Map<number, number>()
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ((i + 0.5) / n) * 2 - 1
      const y = ((j + 0.5) / n) * 2 - 1
      const rho = Math.hypot(x, y)
      const k = (j * n + i) * 4
      if (rho > 1) continue
      const hue = (((Math.atan2(x, -y) * 180) / Math.PI + SCREEN_OFFSET) % 360 + 360) % 360
      const key = Math.round(hue)
      if (!hsvOf.has(key)) hsvOf.set(key, rgbToHsv(oklch(0.65, 0.1, key))[0])
      let c: Rgb
      if (inArc(hue, LIGHT_ARC)) c = hsvToRgb([hsvOf.get(key)!, 0.82 * rho, 0.95])
      else if (inArc(hue, SHADE_ARC)) c = hsvToRgb([hsvOf.get(key)!, 0.83 * rho, 0.6])
      else c = [0.17, 0.17, 0.17]
      img.data[k] = c[0] * 255
      img.data[k + 1] = c[1] * 255
      img.data[k + 2] = c[2] * 255
      img.data[k + 3] = 255
    }
  ctx.putImageData(img, 0, 0)
}

/**
 * Light & shade: two handles on a wheel laid out warm over cool. The light
 * moves round the warm half, the shade round the cool half, and how far out
 * each sits is how deep it goes. Linked, moving one swings the other to the
 * opposite side, as Tide's teal and orange sit. Everywhere it can go makes a
 * palette that holds together (engine/lightshade.ts). Hover to see a place
 * on the photo; press or drag to keep it.
 */
export function LightShadeWheel({ grade, setGrade, palette, onPreview }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const disc = useRef<HTMLCanvasElement>(null)
  const drag = useRef<SideId | null>(null)
  const [linked, setLinked] = useState(true)
  const [ghost, setGhost] = useState<LightShade | null>(null)
  // The handles as last set here. The palette read back from the grade can
  // differ a little (the ramp cap), so ours are kept while the grade still
  // holds what we wrote; anything else (undo, a look) reads them afresh.
  const [local, setLocal] = useState<LightShade | null>(null)
  // Double-click the wheel: the palette as the look set it.
  const base = useBaseline({
    mapShadow: grade.mapShadow,
    mapMid: grade.mapMid,
    mapHigh: grade.mapHigh,
    mapAmount: grade.mapAmount,
    mapHarmony: grade.mapHarmony,
  })
  const written = useRef('')
  useEffect(() => {
    if (disc.current) paintDisc(disc.current)
  }, [])

  const colourOf = (c: ColourChoice): Rgb => (c.source === 'manual' ? c.colour : palette[c.source])
  const stopsKey = JSON.stringify([grade.mapShadow.colour, grade.mapMid.colour, grade.mapHigh.colour])
  const ls: LightShade = local && written.current === stopsKey ? local : lightShadeOf(colourOf(grade.mapMid), colourOf(grade.mapHigh))
  const on = grade.mapAmount > 0

  const patchFor = (next: LightShade): Partial<GradeParams> => {
    const [s, m, l] = lightShadeStops(next)
    return {
      mapShadow: manual(s),
      mapMid: manual(m),
      mapHigh: manual(l),
      mapHarmony: 'free',
      mapAmount: on ? grade.mapAmount : 0.9,
    }
  }
  const commit = (next: LightShade) => {
    const patch = patchFor(next)
    written.current = JSON.stringify([patch.mapShadow!.colour, patch.mapMid!.colour, patch.mapHigh!.colour])
    setLocal(next)
    setGrade(patch)
  }

  /** Where the pointer is, as a hue and depth. */
  const pointAt = (e: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * SIZE - C
    const y = ((e.clientY - rect.top) / rect.height) * SIZE - C
    const hue = (((Math.atan2(x, -y) * 180) / Math.PI + SCREEN_OFFSET) % 360 + 360) % 360
    return { hue, r: Math.min(1, Math.hypot(x, y) / R) }
  }
  /** The palette with one side moved to a point (and, linked, the other swung opposite). */
  const placed = (from: LightShade, side: SideId, p: { hue: number; r: number }): LightShade => {
    const other: SideId = side === 'light' ? 'shade' : 'light'
    const next = { ...from, [side]: { hue: clampHue(p.hue, side === 'light' ? LIGHT_ARC : SHADE_ARC), r: p.r } } as LightShade
    if (linked) next[other] = { ...from[other], hue: mirrored(p.hue, other) }
    return next
  }

  const down = (e: React.PointerEvent) => {
    const p = pointAt(e)
    const hit = (e.target as Element).closest('[data-side]')
    const side = (hit?.getAttribute('data-side') as SideId | null) ?? sideOf(p.hue)
    drag.current = side
    setGhost(null)
    onPreview(null)
    if (!hit) commit(placed(ls, side, p))
    capturePointer(e.currentTarget, e.pointerId)
    e.preventDefault()
  }
  const move = (e: React.PointerEvent) => {
    const p = pointAt(e)
    if (drag.current) {
      commit(placed(ls, drag.current, p))
      return
    }
    if ((e.target as Element).closest('[data-side]') || p.r > 1.02) {
      setGhost(null)
      onPreview(null)
      return
    }
    // Hovering: show this place on the photo without keeping it.
    const next = placed(ls, sideOf(p.hue), p)
    setGhost(next)
    onPreview(patchFor(next))
  }
  const leave = () => {
    setGhost(null)
    onPreview(null)
  }
  const key = (side: SideId) => (e: React.KeyboardEvent) => {
    const s = ls[side]
    const step = e.shiftKey ? 10 : 3
    const to =
      e.key === 'ArrowLeft' ? { hue: s.hue - step, r: s.r }
      : e.key === 'ArrowRight' ? { hue: s.hue + step, r: s.r }
      : e.key === 'ArrowUp' ? { hue: s.hue, r: Math.min(1, s.r + 0.05) }
      : e.key === 'ArrowDown' ? { hue: s.hue, r: Math.max(0, s.r - 0.05) }
      : null
    if (!to) return
    e.preventDefault()
    commit(placed(ls, side, to))
  }

  const shown = ghost ?? ls
  const stops = lightShadeStops(shown)
  const ramp = Array.from({ length: 17 }, (_, k) => css(rampColour(stops, k / 16, grade.mapBalance, grade.mapContrast)))

  return (
    <div className="palette-wheel">
      <div ref={box} className="wheel ls-wheel" title="Warm light on top, cool shade below: drag either, and the other swings opposite. Hover to try a place on the photo; press to keep it. Further out is deeper" onPointerDown={down} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)} onPointerLeave={leave} onDoubleClick={() => {
        drag.current = null
        setLocal(null)
        written.current = ''
        onPreview(null)
        setGrade(base)
      }}>
        <canvas ref={disc} className="ls-disc" />
        <svg viewBox={`0 0 ${SIZE} ${SIZE}`}>
          {(['light', 'shade'] as const).map((side) => {
            const p = at(ls[side].hue, ls[side].r)
            return <line key={`s${side}`} className="wheel-spoke" x1={C} y1={C} x2={p.x} y2={p.y} />
          })}
          {ghost &&
            (['light', 'shade'] as const).map((side) => {
              const p = at(ghost[side].hue, ghost[side].r)
              return <circle key={`g${side}`} className="ls-ghost" cx={p.x} cy={p.y} r={7} />
            })}
          {(['shade', 'light'] as const).map((side) => {
            const s = ls[side]
            const p = at(s.hue, s.r)
            const name = side === 'light' ? 'Light' : 'Shade'
            return (
              <g
                key={side}
                data-side={side}
                className="wheel-handle"
                role="slider"
                tabIndex={0}
                aria-label={`${name} colour`}
                aria-valuetext={`hue ${Math.round(s.hue)}°, depth ${Math.round(s.r * 100)}%`}
                onKeyDown={key(side)}
              >
                <title>{`${name}: drag round for its colour, in and out for depth`}</title>
                <circle cx={p.x} cy={p.y} r={side === 'light' ? 9.5 : 8} fill={css(handleColour(side, s.hue, s.r))} />
                <text x={p.x} y={p.y} dy="0.35em">
                  {name[0]}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="palette-ramp" title="What the tones become, dark to light" style={{ background: `linear-gradient(to right, ${ramp.join(', ')})` }} />
      <div className="chips harmony">
        <button className={linked ? 'on' : ''} title="Moving one swings the other to the opposite side of the wheel" onClick={() => setLinked(!linked)}>
          Linked
        </button>
      </div>
    </div>
  )
}
