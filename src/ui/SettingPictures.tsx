import { useId, useRef } from 'react'
import type { StreakShape } from '../engine/types'
import { copyLook, copySpacing, copySpan, type RepeatParams } from '../engine/repeatParams'
import { capturePointer } from './pointer'

/*
 * Small pictures of what a group of settings does, drawn from the settings
 * themselves and redrawn as they change: the bars a streak's Bars settings
 * make, the copies Repeat's first-to-last settings make. Not the photo, a
 * diagram of it, so what each control does can be seen as it moves.
 */

const hash = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}
/** Smooth noise along a line: neighbours alike. */
const smooth = (x: number, seed: number) => {
  const i = Math.floor(x)
  const f = x - i
  const u = f * f * (3 - 2 * f)
  return hash(i + seed) * (1 - u) + hash(i + 1 + seed) * u
}

const W = 260
const H = 96

/**
 * A streak's bars, side by side, running out from the subject's edge (on
 * the left) as the Bars settings have them: how thick (Bar size), how long
 * (Shortest to Longest, varied smoothly or each its own by Variation), how
 * their ends fade (Soft ends) and are cut (Tip angle, give or take Angle
 * range), mirrored about the middle. Drag the dashed lines to set Shortest
 * and Longest; Shuffle picks again, here as on the photo.
 */
export function StreakBarsPicture({ shape, onChange }: { shape: StreakShape; onChange: (patch: Partial<StreakShape>) => void }) {
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<'min' | 'max' | null>(null)
  const id = useId().replace(/:/g, '')
  const x0 = 14
  const reach = W - x0 - 8
  const lo = shape.lengthMin ?? 1
  const hi = shape.lengthMax ?? 1
  // Bar size is a share of the photo's short side; here, up to a sixth of the picture's height.
  const thick = Math.max(2, Math.min(H / 6, ((shape.band ?? 0.01) / 0.06) * (H / 6) * 1.2 + 1.5))
  const n = Math.max(3, Math.floor((H - 8) / thick))
  const top = (H - n * thick) / 2
  const variation = shape.variation ?? 1
  const seed = (shape.seed ?? 1) % 997
  const soft = Math.min(1, (shape.endSoftness ?? 0) / 0.15) * reach * 0.35
  const tip = shape.tipAngle ?? 0
  const range = shape.tipRange ?? 0
  const mirror = !!shape.mirror
  const vary = shape.mirrorVary ?? 0
  const bars = Array.from({ length: n }, (_, i) => {
    // Mirrored: the bar the same distance from the middle on the other side, nudged by Variation there.
    const m = mirror ? Math.min(i, n - 1 - i) : i
    const own = mirror && i > n - 1 - i ? vary : 0
    const r0 = smooth(m / (1 + (1 - variation) * 6), seed) * (1 - variation) + hash(m * 3.1 + seed) * variation
    const r = r0 * (1 - own) + hash(i * 7.7 + seed) * own
    const len = reach * (lo + (hi - lo) * r)
    const cut = ((tip + (hash(m * 5.3 + seed) * 2 - 1) * range) * Math.PI) / 180
    // Mirrored, the bars on the far side are cut the other way round, as the engine has them.
    const slope = Math.tan(cut) * (mirror && i > n - 1 - i ? -1 : 1)
    const shade = 0.42 + 0.4 * smooth(i / 3.5 + 0.3, 11)
    return { y: top + i * thick, len, slope, shade }
  })
  // The tone along each bar (Along the bar): from its start's brightness,
  // contrast and opacity to its end's, changing from Change from over
  // Change over, as fractions of each bar's own length.
  const tone = (shade: number, bright: number, contrast: number) => {
    const c = 0.5 + (shade - 0.5) * (1 + contrast)
    return Math.round(Math.min(0.97, Math.max(0.03, c * 2 ** (bright * 0.6))) * 100)
  }
  const at = Math.min(1, Math.max(0, shape.changeAt ?? 0))
  const over = Math.max(0.001, Math.min(1 - at, shape.changeLength ?? 1))
  const xAt = (e: React.PointerEvent) => {
    const b = svg.current!.getBoundingClientRect()
    return Math.min(1, Math.max(0, (((e.clientX - b.left) / b.width) * W - x0) / reach))
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    const v = Math.round(xAt(e) * 100) / 100
    if (drag.current === 'min') onChange({ lengthMin: v, lengthMax: Math.max(v, hi) })
    else onChange({ lengthMax: v, lengthMin: Math.min(v, lo) })
  }
  const grab = (which: 'min' | 'max') => (e: React.PointerEvent) => {
    e.stopPropagation()
    drag.current = which
    capturePointer(e.currentTarget, e.pointerId)
  }
  return (
    <svg ref={svg} className="setting-picture" viewBox={`0 0 ${W} ${H}`} onPointerMove={move} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
      <title>The bars these settings make, coming off the subject’s edge, with their tone along them. Drag the dashed lines to set Shortest and Longest.</title>
      <defs>
        {bars.map((b, i) => (
          <linearGradient key={i} id={`${id}-fade-${i}`} gradientUnits="userSpaceOnUse" x1={x0 + b.len - soft} x2={x0 + b.len} y1={0} y2={0}>
            <stop offset="0" stopColor="#fff" stopOpacity={1} />
            <stop offset="1" stopColor="#fff" stopOpacity={soft > 0.5 ? 0 : 1} />
          </linearGradient>
        ))}
        {bars.map((b, i) => (
          <linearGradient key={`t${i}`} id={`${id}-tone-${i}`} gradientUnits="userSpaceOnUse" x1={x0} x2={x0 + Math.max(1, b.len)} y1={0} y2={0}>
            {[
              [0, shape.brightness ?? 0, shape.contrast ?? 0, shape.opacity ?? 1],
              [at, shape.brightness ?? 0, shape.contrast ?? 0, shape.opacity ?? 1],
              [at + over, shape.endBrightness ?? 0, shape.endContrast ?? 0, shape.endOpacity ?? 1],
              [1, shape.endBrightness ?? 0, shape.endContrast ?? 0, shape.endOpacity ?? 1],
            ].map(([off, br, co, op], k) => (
              <stop key={k} offset={off} stopColor={`hsl(32 18% ${tone(b.shade, br, co)}%)`} stopOpacity={Math.max(0, Math.min(1, op))} />
            ))}
          </linearGradient>
        ))}
        {bars.map((_, i) => (
          <mask key={i} id={`${id}-mask-${i}`} maskUnits="userSpaceOnUse" x={0} y={0} width={W} height={H}>
            <rect x={0} y={0} width={W} height={H} fill={`url(#${id}-fade-${i})`} />
          </mask>
        ))}
      </defs>
      <rect className="picture-subject" x={0} y={0} width={x0} height={H} />
      {bars.map((b, i) => {
        // The end cut across the bar: its top and bottom corners apart by the slope.
        const dx = (b.slope * thick) / 2
        const end = x0 + b.len
        const d = `M${x0},${b.y} L${Math.max(x0, end - dx)},${b.y} L${Math.max(x0, end + dx)},${b.y + thick} L${x0},${b.y + thick} Z`
        return <path key={i} d={d} mask={`url(#${id}-mask-${i})`} fill={`url(#${id}-tone-${i})`} />
      })}
      {mirror && <line className="picture-middle" x1={x0} x2={W} y1={H / 2} y2={H / 2} />}
      {(['min', 'max'] as const).map((k) => {
        const x = x0 + reach * (k === 'min' ? lo : hi)
        return (
          <g key={k} className={`picture-handle ${k}`} onPointerDown={grab(k)}>
            <line x1={x} x2={x} y1={1} y2={H - 1} />
            <rect x={x - 6} y={0} width={12} height={H} fill="transparent" />
            <title>{k === 'min' ? 'Shortest: drag to set' : 'Longest: drag to set'}</title>
          </g>
        )
      })}
    </svg>
  )
}

/**
 * Repeat's copies in a row, the piece first, as the first-to-last settings
 * have them: each one's size, turn and opacity, and the spacing between
 * (as a share of the piece), up to ten of them.
 */
export function RepeatCopiesPicture({ r }: { r: RepeatParams }) {
  const span = copySpan(r)
  const n = Math.min(span, 10)
  const unit = 20
  // Middles along the row: each gap a share of the piece (the path's gaps, of the path).
  const xs = [0]
  for (let k = 1; k <= n; k++) xs.push(xs[k - 1] + unit * (r.layout === 'placed' ? 1.25 : copySpacing(r, k, span)))
  const looks = [{ scale: 1, turn: 0, opacity: 1 }, ...Array.from({ length: n }, (_, k) => copyLook(r, k + 1, span))]
  const left = Math.min(...xs.map((x, k) => x - (unit * looks[k].scale) / 2))
  const right = Math.max(...xs.map((x, k) => x + (unit * looks[k].scale) / 2))
  const tall = Math.max(...looks.map((l) => l.scale)) * unit
  const pad = 6
  const vw = Math.max(right - left + pad * 2, 120)
  const vh = Math.max(tall * 1.45 + pad * 2, 40)
  const cy = vh / 2
  const ox = pad - left + (vw - (right - left + pad * 2)) / 2
  // Copies behind the piece are drawn first.
  const order = r.behind ? looks.map((_, k) => looks.length - 1 - k) : looks.map((_, k) => k)
  return (
    <svg className="setting-picture copies" viewBox={`0 0 ${vw} ${vh}`} preserveAspectRatio="xMidYMid meet">
      <title>The piece and its copies, first to last, as these settings make them</title>
      {order.map((k) => {
        const l = looks[k]
        const s = unit * l.scale
        return (
          <g key={k} transform={`translate(${ox + xs[k]} ${cy}) rotate(${l.turn})`} opacity={k === 0 ? 1 : Math.max(0.06, l.opacity)}>
            {/* A little house, so its turn shows: a box with a roof. */}
            <path className={k === 0 ? 'picture-piece' : 'picture-copy'} d={`M${-s / 2},${s / 2} L${-s / 2},${-s / 8} L0,${-s / 2} L${s / 2},${-s / 8} L${s / 2},${s / 2} Z`} />
          </g>
        )
      })}
    </svg>
  )
}
