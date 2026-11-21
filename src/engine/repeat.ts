import { decodeRaster } from './maskRaster'
import { maskCoverage } from './maskCover'
import { maskKind, maskOn } from './maskShapes'
import { copyLook, copySpacing, copySpan, repeatActive, type RepeatParams, type RepeatPoint } from './repeatParams'
import type { EffectParams, MaskShape, Rect, Size, TextureSource } from './types'

/** The long side of the grid a mask's cover is worked out on: its edge is drawn up from this, smoothly. */
const GRID_SIDE = 1024

type Drawable = Exclude<TextureSource, ImageData>

const asDrawable = (src: TextureSource): Drawable => {
  if (!(src instanceof ImageData)) return src
  const c = new OffscreenCanvas(src.width, src.height)
  c.getContext('2d')!.putImageData(src, 0, 0)
  return c
}

/** One copy: where its middle goes (photo pixels), its size against the piece, its turn (radians) and opacity; mirrored across or up; how many steps out it is. */
export interface RepeatCopy {
  x: number
  y: number
  scale: number
  turn: number
  opacity: number
  flipX?: boolean
  flipY?: boolean
  n?: number
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * A path through its points, smoothed (Catmull-Rom through each), as many
 * short straight steps: a few points make a curve.
 */
/** A path as straight lines between its points, a few samples along each, so it is walked as the smooth one is. */
export function straightPath(pts: { x: number; y: number }[], steps = 16): { x: number; y: number }[] {
  if (pts.length < 2) return pts.slice()
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < steps; k++) out.push({ x: pts[i].x + ((pts[i + 1].x - pts[i].x) * k) / steps, y: pts[i].y + ((pts[i + 1].y - pts[i].y) * k) / steps })
  out.push(pts[pts.length - 1])
  return out
}

export function smoothPath(pts: { x: number; y: number }[], steps = 16): { x: number; y: number }[] {
  if (pts.length < 3) return pts.slice()
  const out: { x: number; y: number }[] = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[Math.min(pts.length - 1, i + 2)]
    for (let s = 0; s < steps; s++) {
      const t = s / steps
      const t2 = t * t
      const t3 = t2 * t
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3)
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
    }
  }
  out.push(pts[pts.length - 1])
  return out
}

/** Samples to a stretch of a drawn path (smoothPath, straightPath): each control point is the PATH_STEPS-th sample after the one before (a smooth path of two is just its two). */
const PATH_STEPS = 16

/**
 * Where the piece goes into a path that runs through it (pieceOnPath
 * 'middle'): the place among the path's points that makes the path least
 * longer, so a path drawn across the piece passes through it, and one drawn
 * off to one side starts or ends there. An index into `pts`; the piece goes
 * before the point there (pts.length: after the last).
 */
export function pieceIndexOnPath(pts: { x: number; y: number }[], c: { x: number; y: number }): number {
  if (!pts.length) return 0
  const d = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)
  let best = 0
  let cost = d(c, pts[0])
  if (d(c, pts[pts.length - 1]) < cost) {
    best = pts.length
    cost = d(c, pts[pts.length - 1])
  }
  for (let i = 1; i < pts.length; i++) {
    const k = d(pts[i - 1], c) + d(c, pts[i]) - d(pts[i - 1], pts[i])
    if (k < cost) {
      best = i
      cost = k
    }
  }
  return best
}

/**
 * Where each copy goes, given the piece's middle and size (photo pixels)
 * and a way to bring the settings' points onto the photo. The piece itself
 * is copy 0; each copy is a step on from the one before in size, turn and
 * opacity.
 */
export function repeatCopies(r: RepeatParams, centre: { x: number; y: number }, piece: Size, toPx: (p: RepeatPoint) => { x: number; y: number }): RepeatCopy[] {
  // Copy n of span, first to last (copyLook); the piece itself, copy 0, as it is.
  const span = copySpan(r)
  const step = (n: number) => {
    const l = copyLook(r, n, span)
    return { scale: l.scale, turn: (l.turn * Math.PI) / 180, opacity: l.opacity }
  }
  const sizeAt = (n: number) => (n <= 0 ? 1 : step(n).scale)
  const out: RepeatCopy[] = []
  if (r.layout === 'grid') {
    // How far out the nth copy's middle is, a step at a time.
    // With Spacing (RepeatParams.spacing), each step is its own share of
    // the piece, whatever the copies' size; before it, each step was the
    // two copies' sizes averaged.
    const far = r.spacing
      ? (n: number, size: number) => {
          let d = 0
          for (let k = 1; k <= n; k++) d += size * copySpacing(r, k, span)
          return d
        }
      : (n: number, size: number) => {
          let d = 0
          for (let k = 0; k < n; k++) d += (size * (sizeAt(k) + sizeAt(k + 1))) / 2
          return d
        }
    const stepX = r.spacing ? piece.width : piece.width * (1 + r.gapX)
    const stepY = r.spacing ? piece.height : piece.height * (1 + r.gapY)
    const nx = Math.round(Math.abs(r.across))
    const ny = Math.round(Math.abs(r.up))
    const both = !!r.both
    // Perspective (vanish): one row or column, toward the point.
    const V = r.vanish ? toPx(r.vanish) : null
    if (V && (nx === 0) !== (ny === 0)) {
      const D = Math.hypot(V.x - centre.x, V.y - centre.y)
      const ux = (V.x - centre.x) / Math.max(D, 1e-6)
      const uy = (V.y - centre.y) / Math.max(D, 1e-6)
      // The piece's reach toward the point, and its near and far sides' distances from it.
      const h = Math.abs((piece.width / 2) * ux) + Math.abs((piece.height / 2) * uy)
      if (D > h * 1.05) {
        const near = (D - h) / (D + h)
        const n = nx || ny
        // Each copy is the one before made smaller about the point: by
        // near / far, its far side on the one before's near side (Spacing
        // 100%); toward 1 they overlap.
        const sides: (1 | -1)[] = both ? [1, -1] : [1]
        for (const side of sides) {
          let F = 1
          for (let k = 1; k <= n; k++) {
            const f = 1 - copySpacing(r, k, span) * (1 - near)
            F = side > 0 ? F * f : F / f
            const st = step(k)
            out.push({
              x: V.x + F * (centre.x - V.x),
              y: V.y + F * (centre.y - V.y),
              ...st,
              scale: st.scale * F,
              n: k,
              ...(side < 0 && r.mirror ? (nx ? { flipX: true } : { flipY: true }) : {}),
            })
          }
        }
        return out
      }
    }
    const sx = Math.sign(r.across) || 1
    const sy = -(Math.sign(r.up) || 1)
    // The rows and columns turned (angle): across along ex, up along ey.
    const a = ((r.angle ?? 0) * Math.PI) / 180
    const ex = { x: Math.cos(a), y: Math.sin(a) }
    const ey = { x: -Math.sin(a), y: Math.cos(a) }
    for (let j = both ? -ny : 0; j <= ny; j++)
      for (let i = both ? -nx : 0; i <= nx; i++) {
        if (i === 0 && j === 0) continue
        const ai = Math.abs(i)
        const aj = Math.abs(j)
        const n = Math.max(ai, aj)
        // Stagger: every other row moved along (or, a single column, every other copy moved across).
        const unitX = r.spacing ? stepX * copySpacing(r, 1, span) : stepX
        const unitY = r.spacing ? stepY * copySpacing(r, 1, span) : stepY
        const shift = r.stagger * (nx > 0 ? (aj % 2) * unitX * sx : (aj % 2) * piece.width)
        const shiftY = nx > 0 && ny === 0 ? r.stagger * (ai % 2) * unitY * sy : 0
        const along = sx * Math.sign(i) * far(ai, stepX) + shift
        const up = sy * Math.sign(j) * far(aj, stepY) + shiftY
        out.push({
          x: centre.x + ex.x * along + ey.x * up,
          y: centre.y + ex.y * along + ey.y * up,
          ...step(n),
          n,
          ...(r.mirror && both && i < 0 ? { flipX: true } : {}),
          ...(r.mirror && both && j < 0 ? { flipY: true } : {}),
        })
      }
    return out
  }
  if (r.layout === 'path') {
    // The piece on the path (pieceOnPath): at its start, the copies run on
    // from it to the path's end; in the middle, the path runs through it and
    // the copies go both ways, toward each end; not on it, the first copy is
    // at the path's own first point.
    const pts = r.path.map(toPx)
    const pieceAt = r.pieceOnPath === 'start' ? 0 : r.pieceOnPath === 'middle' ? pieceIndexOnPath(pts, centre) : -1
    const control = pieceAt < 0 ? pts : [...pts.slice(0, pieceAt), centre, ...pts.slice(pieceAt)]
    if (control.length < 2 || r.count < 1) return out
    const line = r.straight ? straightPath(control, PATH_STEPS) : smoothPath(control, PATH_STEPS)
    const lens = [0]
    for (let i = 1; i < line.length; i++) lens.push(lens[i - 1] + Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y))
    const total = lens[lens.length - 1]
    const at = (d: number) => {
      let i = 1
      while (i < line.length - 1 && lens[i] < d) i++
      const a = line[i - 1]
      const b = line[i]
      const t = (d - lens[i - 1]) / Math.max(lens[i] - lens[i - 1], 1e-6)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) }
    }
    const count = Math.max(1, Math.round(r.count))
    if (pieceAt < 0) {
      const first = at(0).angle
      // Spread along it by Spacing: each gap its share of the whole (even with none set).
      const gaps = Array.from({ length: Math.max(0, count - 1) }, (_, k) => copySpacing(r, k + 2, count))
      const sum = gaps.reduce((a, b) => a + b, 0) || 1
      let run = 0
      for (let k = 0; k < count; k++) {
        if (k > 0) run += gaps[k - 1] ?? 0
        const p = at(count > 1 ? (total * run) / sum : 0)
        const st = step(k + 1)
        out.push({ x: p.x, y: p.y, ...st, turn: st.turn + (r.followPath ? p.angle - first : 0) })
      }
      return out
    }
    // The piece's place along the line (each control point is one of its points), and its way there.
    const from = lens[line.length === control.length ? pieceAt : pieceAt * PATH_STEPS] ?? 0
    const pieceAngle = at(Math.min(from + 1e-3, total)).angle
    // The copies shared between the two sides by their lengths, each side with one at least.
    const ahead = total - from
    let back = Math.round((count * from) / Math.max(total, 1e-6))
    if (count > 1 && from > 1e-3 && ahead > 1e-3) back = Math.min(count - 1, Math.max(1, back))
    // First to last: out from the piece both ways, a step out the same on
    // either side (the shorter side stops sooner); or along the whole path,
    // from its start (or end) through the piece.
    const order = r.firstToLast ?? 'out'
    const span = Math.max(count - back, back, 1)
    const placed: { d: number; k: number; p: ReturnType<typeof at> }[] = []
    for (const [dir, n, length] of [
      [1, count - back, ahead],
      [-1, back, from],
    ] as const) {
      if (n < 1) continue
      // Out from the piece to that end, by Spacing.
      const gaps = Array.from({ length: n }, (_, k) => copySpacing(r, k + 1, span))
      const sum = gaps.reduce((a, b) => a + b, 0) || 1
      let run = 0
      for (let k = 0; k < n; k++) {
        run += gaps[k]
        const d = from + (dir * length * run) / sum
        placed.push({ d, k, p: at(d) })
      }
    }
    const byLine = [...placed].sort((a, b) => (order === 'back' ? b.d - a.d : a.d - b.d))
    for (const c of placed) {
      const l = order === 'out' ? copyLook(r, c.k + 1, span) : copyLook(r, byLine.indexOf(c) + 1, placed.length)
      const turn = (l.turn * Math.PI) / 180
      out.push({ x: c.p.x, y: c.p.y, scale: l.scale, opacity: l.opacity, turn: turn + (r.followPath ? c.p.angle - pieceAngle : 0) })
    }
    return out
  }
  r.placed.forEach((p, k) => out.push({ ...toPx(p), ...step(k + 1) }))
  return out
}

/**
 * How much a mask covers each cell of a grid over the photo, 0..1. Drawn
 * outlines and selections as the shader has them (maskCoverage); radial and
 * gradient masks from their numbers.
 */
function coverOnGrid(
  m: MaskShape,
  gw: number,
  gh: number,
  px: Uint8ClampedArray,
  photo: Size,
  maskFrame: Rect,
  photoFrame: Rect,
): Float32Array {
  // Grid cell middles to the mask frame's fractions, and back.
  const kx = photo.width / photoFrame.width
  const ky = photo.height / photoFrame.height
  const toFrac = (gx: number, gy: number) => ({
    x: (((gx + 0.5) / gw) * photo.width / kx + photoFrame.x - maskFrame.x) / maskFrame.width,
    y: (((gy + 0.5) / gh) * photo.height / ky + photoFrame.y - maskFrame.y) / maskFrame.height,
  })
  const toGrid = (p: { x: number; y: number }) => ({
    x: ((maskFrame.x + p.x * maskFrame.width - photoFrame.x) * kx * gw) / photo.width,
    y: ((maskFrame.y + p.y * maskFrame.height - photoFrame.y) * ky * gh) / photo.height,
  })
  const short = Math.min(maskFrame.width, maskFrame.height)
  const kind = maskKind(m)
  const out = new Float32Array(gw * gh)
  if (kind === 'radial' || kind === 'gradient') {
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const f = toFrac(gx, gy)
        const qx = f.x * maskFrame.width
        const qy = f.y * maskFrame.height
        let c: number
        if (kind === 'gradient') {
          const g = m.gradient!
          const ax = g.x0 * maskFrame.width
          const ay = g.y0 * maskFrame.height
          const bx = g.x1 * maskFrame.width - ax
          const by = g.y1 * maskFrame.height - ay
          const t = ((qx - ax) * bx + (qy - ay) * by) / Math.max(bx * bx + by * by, 1e-8)
          c = 1 - smooth(0, 1, t)
        } else {
          const r = m.radial!
          const dx = qx - r.x * maskFrame.width
          const dy = qy - r.y * maskFrame.height
          const a = (r.angle * Math.PI) / 180
          const ex = (Math.cos(a) * dx + Math.sin(a) * dy) / Math.max(r.rx * short, 1e-5)
          const ey = (-Math.sin(a) * dx + Math.cos(a) * dy) / Math.max(r.ry * short, 1e-5)
          c = 1 - smooth(1 - Math.max(r.soft, 0.002), 1, Math.hypot(ex, ey))
        }
        out[gy * gw + gx] = c
      }
    return out
  }
  const inside = new Uint8Array(gw * gh)
  let pin: Uint8Array | null = null
  let pout: Uint8Array | null = null
  let psure: Uint8Array | null = null
  if (m.raster) {
    const r = m.raster
    const cells = decodeRaster(r)
    const pi = r.paintIn ? decodeRaster({ w: r.w, h: r.h, runs: r.paintIn }) : null
    const po = r.paintOut ? decodeRaster({ w: r.w, h: r.h, runs: r.paintOut }) : null
    const ps = r.paintSure ? decodeRaster({ w: r.w, h: r.h, runs: r.paintSure }) : null
    if (ps) psure = new Uint8Array(gw * gh)
    if (pi) pin = new Uint8Array(gw * gh)
    if (po) pout = new Uint8Array(gw * gh)
    for (let gy = 0; gy < gh; gy++)
      for (let gx = 0; gx < gw; gx++) {
        const f = toFrac(gx, gy)
        const rx = Math.floor(((f.x - r.x) / r.width) * r.w)
        const ry = Math.floor(((f.y - r.y) / r.height) * r.h)
        if (rx < 0 || ry < 0 || rx >= r.w || ry >= r.h) continue
        const k = ry * r.w + rx
        const g = gy * gw + gx
        inside[g] = cells[k]
        if (pi) pin![g] = pi[k]
        if (po) pout![g] = po[k]
        if (ps) psure![g] = ps[k]
      }
  } else {
    const c = new OffscreenCanvas(gw, gh)
    const ctx = c.getContext('2d', { willReadFrequently: true })!
    const path = new Path2D()
    m.outline.forEach((p, i) => {
      const q = toGrid(p)
      if (i) path.lineTo(q.x, q.y)
      else path.moveTo(q.x, q.y)
    })
    path.closePath()
    ctx.fill(path, 'evenodd')
    const a = ctx.getImageData(0, 0, gw, gh).data
    for (let i = 0; i < inside.length; i++) inside[i] = a[i * 4 + 3] > 127 ? 1 : 0
  }
  const perShort = (short * kx * gw) / photo.width
  return maskCoverage(m, gw, gh, inside, px, perShort, pin, pout, psure)
}

/** A cover grid as a white picture with that alpha, to cut with. */
function coverCanvas(cover: Float32Array, gw: number, gh: number): OffscreenCanvas {
  const c = new OffscreenCanvas(gw, gh)
  const img = new ImageData(gw, gh)
  for (let i = 0; i < cover.length; i++) {
    img.data[i * 4] = 255
    img.data[i * 4 + 1] = 255
    img.data[i * 4 + 2] = 255
    img.data[i * 4 + 3] = Math.round(cover[i] * 255)
  }
  c.getContext('2d')!.putImageData(img, 0, 0)
  return c
}

const BLEND: Record<RepeatParams['blend'], GlobalCompositeOperation> = {
  normal: 'source-over',
  lighten: 'lighten',
  darken: 'darken',
  screen: 'screen',
  multiply: 'multiply',
}

/**
 * What a mask covers on the grid, kept per photo: working it out (its edge
 * matched to the photo) takes most of a Repeat change, and moving, turning
 * or fading the copies leaves the piece and its masks as they were.
 */
const coverCache = new WeakMap<object, Map<string, Float32Array>>()
function coverFor(photo: object, m: MaskShape, gw: number, gh: number, px: Uint8ClampedArray, size: Size, maskFrame: Rect, photoFrame: Rect): Float32Array {
  let kept = coverCache.get(photo)
  if (!kept) coverCache.set(photo, (kept = new Map()))
  const key = JSON.stringify([m, gw, gh, size, maskFrame, photoFrame])
  let cover = kept.get(key)
  if (!cover) {
    // Only the latest few: an edit in progress makes a new one per brush stroke.
    if (kept.size >= 6) kept.delete(kept.keys().next().value!)
    cover = coverOnGrid(m, gw, gh, px, size, maskFrame, photoFrame)
    kept.set(key, cover)
  }
  return cover
}
/** The photo on the grid, kept per photo, for the covers above. */
const gridCache = new WeakMap<object, { gw: number; gh: number; px: Uint8ClampedArray }>()

/**
 * The photo with Repeat's copies in it, or null when Repeat is doing
 * nothing. Each repeat in the list goes in, the one higher in the list in
 * front (as streaks are), its piece cut from the photo as it was (not from
 * another repeat's copies). `maskFrame` is the
 * frame masks are kept in and `photoFrame` where the photo sits, both in
 * print pixels (see GrainEngine's buildLayers).
 */
export function composeRepeat(base: TextureSource, size: Size, fx: EffectParams, maskFrame: Rect, photoFrame: Rect): OffscreenCanvas | null {
  const mod = fx.repeat
  if (!mod?.enabled) return null
  const ids = fx.masks.map((m) => m.id)
  // Last first, so the first in the list is drawn last, in front.
  const items = mod.items.filter((r) => repeatActive(r, ids)).reverse()
  if (!items.length) return null
  const photo = asDrawable(base)
  const W = size.width
  const H = size.height
  const k = Math.min(1, GRID_SIDE / Math.max(W, H))
  const gw = Math.max(8, Math.round(W * k))
  const gh = Math.max(8, Math.round(H * k))
  const keyOf = typeof base === 'object' && base !== null ? (base as object) : null
  let grid = keyOf ? gridCache.get(keyOf) : undefined
  if (!grid || grid.gw !== gw || grid.gh !== gh) {
    const small = new OffscreenCanvas(gw, gh)
    const sc = small.getContext('2d', { willReadFrequently: true })!
    sc.imageSmoothingQuality = 'high'
    sc.drawImage(photo, 0, 0, gw, gh)
    grid = { gw, gh, px: sc.getImageData(0, 0, gw, gh).data }
    if (keyOf) gridCache.set(keyOf, grid)
  }
  const px = grid.px
  const coverOf = (m: MaskShape) => (keyOf ? coverFor(keyOf, m, gw, gh, px, size, maskFrame, photoFrame) : coverOnGrid(m, gw, gh, px, size, maskFrame, photoFrame))
  const kx = W / photoFrame.width
  const ky = H / photoFrame.height
  const toPx = (p: RepeatPoint) => ({ x: (maskFrame.x + p.x * maskFrame.width - photoFrame.x) * kx, y: (maskFrame.y + p.y * maskFrame.height - photoFrame.y) * ky })

  // Its module's mask, as any module's: the copies only inside the masks
  // (the sky, say), or everywhere but them. The same for every repeat.
  const use = fx.maskUse?.repeat
  const held = (use?.ids ?? []).map((id) => fx.masks.find((m) => m.id === id)).filter((m): m is NonNullable<typeof m> => !!m && maskOn(m))
  let heldCover: OffscreenCanvas | null = null
  if (use && held.length) {
    heldCover = new OffscreenCanvas(W, H)
    const cc = heldCover.getContext('2d')!
    for (const m of held) cc.drawImage(coverCanvas(coverOf(m), gw, gh), 0, 0, W, H)
  }

  let out: OffscreenCanvas | null = null
  for (const r of items) {
    const source = fx.masks.find((m) => m.id === r.source)
    if (!source || !maskOn(source)) continue
    const kind = maskKind(source)
    if (kind !== 'outline' && kind !== 'subject') continue
    const cover = coverOf(source)
    // The piece: the cells it covers, a cell's margin round them, in photo pixels.
    let x0 = gw
    let y0 = gh
    let x1 = -1
    let y1 = -1
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++)
        if (cover[y * gw + x] > 0.004) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) continue
    x0 = Math.max(0, x0 - 1)
    y0 = Math.max(0, y0 - 1)
    x1 = Math.min(gw - 1, x1 + 1)
    y1 = Math.min(gh - 1, y1 + 1)
    const bx = Math.floor((x0 / gw) * W)
    const by = Math.floor((y0 / gh) * H)
    const bw = Math.max(1, Math.ceil(((x1 + 1) / gw) * W) - bx)
    const bh = Math.max(1, Math.ceil(((y1 + 1) / gh) * H) - by)
    const piece = new OffscreenCanvas(bw, bh)
    const pc = piece.getContext('2d')!
    pc.drawImage(photo, bx, by, bw, bh, 0, 0, bw, bh)
    pc.globalCompositeOperation = 'destination-in'
    pc.imageSmoothingEnabled = true
    pc.imageSmoothingQuality = 'high'
    pc.drawImage(coverCanvas(cover, gw, gh), -bx, -by, W, H)

    const centre = { x: bx + bw / 2, y: by + bh / 2 }
    const copies = repeatCopies(r, centre, { width: bw, height: bh }, toPx)
    if (!copies.length) continue

    // The copies on a layer of their own, furthest first so each is under the one before it.
    const layer = new OffscreenCanvas(W, H)
    const lc = layer.getContext('2d')!
    lc.imageSmoothingEnabled = true
    lc.imageSmoothingQuality = 'high'
    // (Furthest out drawn first: copies on both sides interleave in the list.)
    const order = copies.map((c, i) => ({ c, at: c.n ?? i })).sort((p, q) => q.at - p.at)
    for (const { c } of order) {
      if (c.opacity <= 0.004 || c.scale <= 0.01) continue
      lc.save()
      lc.globalAlpha = c.opacity
      lc.translate(c.x, c.y)
      lc.rotate(c.turn)
      lc.scale(c.scale * (c.flipX ? -1 : 1), c.scale * (c.flipY ? -1 : 1))
      lc.drawImage(piece, -bw / 2, -bh / 2)
      lc.restore()
    }
    if (heldCover && use) {
      lc.globalCompositeOperation = use.mode === 'only' ? 'destination-in' : 'destination-out'
      lc.drawImage(heldCover, 0, 0)
    }
    if (!out) {
      out = new OffscreenCanvas(W, H)
      out.getContext('2d')!.drawImage(photo, 0, 0, W, H)
    }
    const oc = out.getContext('2d')!
    oc.globalCompositeOperation = BLEND[r.blend] ?? 'source-over'
    oc.drawImage(layer, 0, 0)
    // Behind: the piece itself stays in front of its copies.
    if (r.behind) {
      oc.globalCompositeOperation = 'source-over'
      oc.drawImage(piece, bx, by)
    }
    oc.globalCompositeOperation = 'source-over'
  }
  return out
}

/**
 * Where Repeat's piece is, in the mask frame's fractions: the middle of what
 * its mask covers, as the copies are measured from (composeRepeat). For the
 * path's start, on the photo.
 */
export function pieceCentreOf(m: MaskShape): RepeatPoint {
  const b = pieceBoxOf(m)
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
}

/** The box round the piece a mask cuts out, fractions of the mask's frame: its selection's cells, or its outline. */
export function pieceBoxOf(m: MaskShape): { x: number; y: number; width: number; height: number } {
  const r = m.raster
  if (r) {
    const grid = decodeRaster(r)
    let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1
    for (let y = 0; y < r.h; y++)
      for (let x = 0; x < r.w; x++)
        if (grid[y * r.w + x]) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 >= 0) return { x: r.x + (x0 / r.w) * r.width, y: r.y + (y0 / r.h) * r.height, width: ((x1 + 1 - x0) / r.w) * r.width, height: ((y1 + 1 - y0) / r.h) * r.height }
  }
  const xs = m.outline.map((p) => p.x)
  const ys = m.outline.map((p) => p.y)
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) }
}
