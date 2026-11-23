import { maskKind, maskOn } from './maskShapes'
import { pieceCutter } from './repeat'
import type { RepeatPoint } from './repeatParams'
import type { EffectParams, MaskShape, Rect, Size, TextureSource } from './types'

/**
 * Kaleidoscope: the photo, or a piece of it, copied round a point. With no
 * piece, a slice of the photo from the point out (its width a share of the
 * whole turn, one per copy) is copied round until the copies meet all the
 * way round; with a piece (a selection or a drawn outline), the piece is
 * copied round the point over the photo. Every other copy can be mirrored,
 * as a kaleidoscope's mirrors do. Rings: the whole of it again, smaller and
 * turned, inside itself, toward the point, a ring at a time.
 *
 * Like Repeat's copies, it goes into the photo before every other effect
 * (after Repeat's), so colour, grain and streaks treat it as the picture.
 */
export interface KaleidoParams {
  enabled: boolean
  /** The point the copies go round, in fractions of the frame masks are kept in; null: the middle of the picture (of the crop, when cropped). */
  centre: RepeatPoint | null
  /** How many there are all the way round, the slice or piece itself among them. */
  copies: number
  /** Every other copy mirrored, so the copies meet edge to edge. */
  mirror: boolean
  /** Which way the slice points, degrees clockwise from straight up. */
  angle: number
  /** The piece copied round (a mask Kaleidoscope owns); null: a slice of the photo. */
  source: string | null
  /** How many rings, the outer one among them: 1, only it. */
  rings: number
  /** Each ring's size against the one round it. */
  ringSize: number
  /** How far each ring is turned from the one round it, degrees. */
  twist: number
}

export const DEFAULT_KALEIDO: KaleidoParams = {
  enabled: false,
  centre: null,
  copies: 6,
  mirror: true,
  // Down: in most photos the ground and what stands on it, rather than sky.
  angle: 180,
  source: null,
  rings: 1,
  ringSize: 0.6,
  twist: 0,
}

export const KALEIDO_COPIES = { min: 2, max: 16 }
export const KALEIDO_RINGS = { min: 1, max: 8 }

/** Whether Kaleidoscope is doing anything: on, with a slice, or a piece that is still there. */
export function kaleidoActive(k: KaleidoParams | undefined, maskIds: string[]): boolean {
  if (!k?.enabled) return false
  return !k.source || maskIds.includes(k.source)
}

const RAD = Math.PI / 180
/** The copies' slices overlap by this much (radians), so no seam of the photo underneath shows between them. */
const OVERLAP = 0.004
/** The rings' soft edge, a share of each ring's radius. */
const RING_SOFT = 0.18
/** Above this many pixels, the slice is drawn smaller and scaled up: a point near a corner reaches far. */
const MAX_SLICE_PIXELS = 48e6

/**
 * A wedge from (cx, cy) out to radius r, between angles a0 and a1 (radians,
 * clockwise from straight up, as `angle` is).
 */
function wedge(cx: number, cy: number, r: number, a0: number, a1: number): Path2D {
  const p = new Path2D()
  p.moveTo(cx, cy)
  // Canvas angles go clockwise from +x; ours from straight up.
  p.arc(cx, cy, r, a0 - Math.PI / 2, a1 - Math.PI / 2)
  p.closePath()
  return p
}

/**
 * The photo and its eight neighbours mirrored about its edges: a slice
 * reaching past the photo's edge (the point off its middle, the copies
 * going all the way round) shows the photo carrying on in reflection
 * rather than nothing.
 */
function drawMirrored(ctx: OffscreenCanvasRenderingContext2D, photo: CanvasImageSource, W: number, H: number, need: { x0: number; y0: number; x1: number; y1: number }) {
  for (let ty = -1; ty <= 1; ty++)
    for (let tx = -1; tx <= 1; tx++) {
      const x0 = tx * W
      const y0 = ty * H
      if (x0 + W <= need.x0 || x0 >= need.x1 || y0 + H <= need.y0 || y0 >= need.y1) continue
      ctx.save()
      // A mirrored neighbour: x' = -x (left), 2W - x (right); the same for y.
      ctx.translate(tx === 1 ? 2 * W : 0, ty === 1 ? 2 * H : 0)
      ctx.scale(tx === 0 ? 1 : -1, ty === 0 ? 1 : -1)
      ctx.drawImage(photo, 0, 0, W, H)
      ctx.restore()
    }
}

/**
 * The photo with the Kaleidoscope's copies in it, or null when it is doing
 * nothing. `maskFrame` is the frame masks (and the point) are kept in and
 * `photoFrame` where the photo sits, both in print pixels.
 */
export function composeKaleido(base: TextureSource, size: Size, fx: EffectParams, maskFrame: Rect, photoFrame: Rect): OffscreenCanvas | null {
  const k = fx.kaleido
  if (!k || !kaleidoActive(k, fx.masks.map((m) => m.id))) return null
  const piece = k.source ? fx.masks.find((m) => m.id === k.source) : undefined
  if (piece && !maskOn(piece)) return null
  const cutter = pieceCutter(base, size, maskFrame, photoFrame)
  const { photo, W, H } = cutter
  const C = k.centre ? cutter.toPx(k.centre) : { x: W / 2, y: H / 2 }
  const n = Math.max(KALEIDO_COPIES.min, Math.min(KALEIDO_COPIES.max, Math.round(k.copies)))
  const step = (2 * Math.PI) / n

  const level = piece ? pieceRound(cutter, piece, C, n, step, k.mirror) : sliceRound(photo, W, H, C, n, step, k.angle * RAD, k.mirror)
  if (!level) return null

  const out = new OffscreenCanvas(W, H)
  const oc = out.getContext('2d')!
  oc.imageSmoothingEnabled = true
  oc.imageSmoothingQuality = 'high'
  oc.drawImage(photo, 0, 0, W, H)
  const rings = Math.max(KALEIDO_RINGS.min, Math.min(KALEIDO_RINGS.max, Math.round(k.rings)))
  const s = Math.max(0.05, Math.min(0.98, k.ringSize))
  const ringAt = (ctx: OffscreenCanvasRenderingContext2D, i: number) => {
    ctx.translate(C.x, C.y)
    ctx.rotate(i * k.twist * RAD)
    ctx.scale(s ** i, s ** i)
    ctx.translate(-C.x, -C.y)
  }

  if (piece) {
    // Copies over the photo: the rings inside, smaller, behind the ones round them.
    for (let i = rings - 1; i >= 1; i--) {
      oc.save()
      ringAt(oc, i)
      oc.drawImage(level, 0, 0)
      oc.restore()
    }
    oc.drawImage(level, 0, 0)
    return out
  }

  // A slice all the way round covers everything: each ring inside is the
  // whole of it again, cut to a soft circle that fits inside the frame the
  // ring is shrunk to (its nearest edge to the point; a point near an edge
  // still gets rings, the ring round showing where the smaller one has none).
  oc.drawImage(level, 0, 0)
  const nearest = Math.max(Math.min(C.x, C.y, W - C.x, H - C.y), 0.35 * Math.min(W, H))
  for (let i = 1; i < rings; i++) {
    const r = nearest * s ** i
    if (r < 1.5) break
    const ring = new OffscreenCanvas(W, H)
    const rc = ring.getContext('2d')!
    rc.imageSmoothingEnabled = true
    rc.imageSmoothingQuality = 'high'
    rc.save()
    ringAt(rc, i)
    rc.drawImage(level, 0, 0)
    rc.restore()
    const g = rc.createRadialGradient(C.x, C.y, r * (1 - RING_SOFT), C.x, C.y, r)
    g.addColorStop(0, 'rgba(0,0,0,1)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    rc.globalCompositeOperation = 'destination-in'
    rc.fillStyle = g
    rc.fillRect(0, 0, W, H)
    oc.drawImage(ring, 0, 0)
  }
  return out
}

/**
 * A slice of the photo from the point, `step` wide and pointing at `angle`,
 * copied round until the copies meet: copy i turned i steps, every other one
 * mirrored about its own middle when `mirror` (so neighbours meet in a
 * reflection, the way a kaleidoscope's mirrors show it).
 */
function sliceRound(photo: CanvasImageSource, W: number, H: number, C: { x: number; y: number }, n: number, step: number, angle: number, mirror: boolean): OffscreenCanvas {
  // Far enough to reach every corner from the point.
  const R = Math.hypot(Math.max(C.x, W - C.x), Math.max(C.y, H - C.y)) + 2
  const a0 = angle - step / 2 - OVERLAP
  const a1 = angle + step / 2 + OVERLAP
  // The slice on a picture of its own, the photo carried on in reflection where it reaches past the edge.
  const pts = [{ x: C.x, y: C.y }]
  const segs = Math.max(4, Math.ceil((a1 - a0) / (Math.PI / 16)))
  for (let j = 0; j <= segs; j++) {
    const a = a0 + ((a1 - a0) * j) / segs
    pts.push({ x: C.x + Math.sin(a) * R, y: C.y - Math.cos(a) * R })
  }
  const bx0 = Math.floor(Math.max(-W, Math.min(...pts.map((p) => p.x))))
  const by0 = Math.floor(Math.max(-H, Math.min(...pts.map((p) => p.y))))
  const bx1 = Math.ceil(Math.min(2 * W, Math.max(...pts.map((p) => p.x))))
  const by1 = Math.ceil(Math.min(2 * H, Math.max(...pts.map((p) => p.y))))
  const bw = Math.max(1, bx1 - bx0)
  const bh = Math.max(1, by1 - by0)
  const shrink = Math.min(1, Math.sqrt(MAX_SLICE_PIXELS / (bw * bh)))
  const slice = new OffscreenCanvas(Math.max(1, Math.round(bw * shrink)), Math.max(1, Math.round(bh * shrink)))
  const sc = slice.getContext('2d')!
  sc.imageSmoothingEnabled = true
  sc.imageSmoothingQuality = 'high'
  sc.scale(shrink, shrink)
  sc.translate(-bx0, -by0)
  sc.save()
  sc.clip(wedge(C.x, C.y, R, a0, a1))
  drawMirrored(sc, photo, W, H, { x0: bx0, y0: by0, x1: bx1, y1: by1 })
  sc.restore()

  const level = new OffscreenCanvas(W, H)
  const lc = level.getContext('2d')!
  lc.imageSmoothingEnabled = true
  lc.imageSmoothingQuality = 'high'
  for (let i = 0; i < n; i++) {
    lc.save()
    lc.translate(C.x, C.y)
    lc.rotate(i * step)
    if (mirror && i % 2 === 1) {
      // Mirrored about the slice's own middle line.
      lc.rotate(angle)
      lc.scale(-1, 1)
      lc.rotate(-angle)
    }
    lc.translate(-C.x, -C.y)
    lc.drawImage(slice, bx0, by0, bw, bh)
    lc.restore()
  }
  return level
}

/**
 * A piece copied round the point over nothing (the photo goes under it
 * later): copy i turned i steps; every other one mirrored about the line
 * from the point through the piece's middle when `mirror`.
 */
function pieceRound(cutter: ReturnType<typeof pieceCutter>, m: MaskShape, C: { x: number; y: number }, n: number, step: number, mirror: boolean): OffscreenCanvas | null {
  const kind = maskKind(m)
  if (kind !== 'outline' && kind !== 'subject') return null
  const cut = cutter.cut(m)
  if (!cut) return null
  const { piece, bx, by, bw, bh } = cut
  const axis = Math.atan2(bx + bw / 2 - C.x, -(by + bh / 2 - C.y))
  const level = new OffscreenCanvas(cutter.W, cutter.H)
  const lc = level.getContext('2d')!
  lc.imageSmoothingEnabled = true
  lc.imageSmoothingQuality = 'high'
  for (let i = 0; i < n; i++) {
    lc.save()
    lc.translate(C.x, C.y)
    lc.rotate(i * step)
    if (mirror && i % 2 === 1) {
      lc.rotate(axis)
      lc.scale(-1, 1)
      lc.rotate(-axis)
    }
    lc.translate(-C.x, -C.y)
    lc.drawImage(piece, bx, by)
    lc.restore()
  }
  return level
}
