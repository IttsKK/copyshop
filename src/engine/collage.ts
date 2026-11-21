import { collageImageNow, type CollageImage } from '../storage/collageImages'
import type { CollageParams, CollagePiece, Size } from './types'

/**
 * Collage: finding a piece's area in the photo, and what the GPU needs to lay
 * another image into it (the pass itself is COLLAGE_FRAGMENT, run by
 * GrainEngine before anything else, so grain, colour and light treat the
 * collage as one photo).
 *
 * Finding the area. Thin dark lines — wires, branches, cables — are found
 * first, as a black-hat: how much darker each pixel is than the brightest
 * close around it. From each place clicked the piece spreads to neighbours
 * of a similar colour, and never across such a line. Pixels touch only
 * side-on as it spreads, so even a one-pixel diagonal wire holds it.
 *
 * The edges. A pixel at a wire's edge is part wire, part sky. For each piece
 * two smooth colours are kept: the sky's own colour near it (S, an average of
 * the piece's pixels around it) and the wire's (W, the darkest pixel close
 * by). On the GPU, at full resolution, each pixel is read as a mix of the
 * two, and only its sky part is swapped: pixel + amount * (new - S). A wire
 * keeps its colour and its soft edge exactly, with no halo and no fringe,
 * however thin it is.
 *
 * Everything is worked out on the original photo at a fixed working size
 * (WORK on the long side), so the preview, the Small view and the export,
 * whatever size they render at, use the very same areas.
 */

const WORK = 2048
/** How far past the area its edge band reaches, working pixels: covers a wire's soft edge. */
const BAND = 4
/** Window the wire colour is looked for in: (2 * WIRE_REACH + 1)². */
const WIRE_REACH = 4
/** Black-hat window: lines up to about twice this wide count as lines. */
const HAT_REACH = 3

interface Analysis {
  seed: number
  /** The original photo's size. */
  photo: Size
  w: number
  h: number
  rgb: Uint8ClampedArray
  L: Float32Array
  hat: Float32Array
}

export interface PieceMaps {
  key: string
  /** Working-pixel rectangle the maps cover. */
  x: number
  y: number
  w: number
  h: number
  /** The rectangle in fractions of the photo: [x0, y0, x1, y1]. */
  rect: [number, number, number, number]
  /** The area itself, one byte per working pixel of the rectangle. */
  region: Uint8Array
  /**
   * rgb: the sky's own colour around each pixel (S); a: how much the pixel is
   * in the piece. Kept as ImageData, not a canvas: a canvas premultiplies, and
   * would lose the colour wherever alpha is 0.
   */
  sky: ImageData
  /** rgb: the darkest colour close by (W); a: 1 well inside, where no line is near. */
  wire: ImageData
  /**
   * r: how much each pixel near the piece is part of a thin line (a wire,
   * a twig) rather than the edge of something big (a hill, a roof): those
   * keep the piece's own colour with it, these take the look as before.
   */
  line: ImageData
  /** The area's own extent (not the padded rectangle), photo fractions: [x0, y0, x1, y1]. */
  area: [number, number, number, number]
  /** Average linear luminance of what the piece covers, for matching brightness. */
  meanLin: number
  /** Its average colour, linear: what the photo's light is, for Light the photo. */
  meanRgb: [number, number, number]
  /** Working pixels in the area. */
  pixels: number
}

/** What GrainEngine needs for one piece. */
export interface CollageLayer {
  key: string
  sky: ImageData
  wire: ImageData
  line: ImageData
  rect: [number, number, number, number]
  image: ImageBitmap
  /** The image's centre and its width and height, in fractions of the photo. */
  centre: [number, number]
  span: [number, number]
  /** Turned clockwise, radians; the photo's size in pixels to turn it in. */
  rotation: number
  photoPx: [number, number]
  flip: boolean
  gain: number
  opacity: number
  /** How far a pixel may sit off the wire-to-sky mix and still be swapped. */
  residual: number
  /** How much of the look's editing the piece takes, 0 (its own colour) .. 1. */
  takeLook: number
  /** How much of the photo's fine detail stays on the image well inside the piece, 0..1. */
  detail: number
  /** The image's colour scaled per channel, linear (CollagePiece.tint). */
  tint: [number, number, number]
  /** How much of the old sky's broad light the image takes, 0..1. */
  keepLight: number
  /** The rest of the photo's colour scaled by this, linear: (1, 1, 1) leaves it. */
  relight: [number, number, number]
  /** Softening of the image's own grain, 0..1. */
  smooth: number
}

/*
 * Each photo's analysis, by its seed: the newest few. One at a time, a
 * second photo rendered in the same worker (a thumbnail or the Library's
 * large view while the editor shows another) took the first one's place,
 * and each then drew its pieces on the other's analysis, or none.
 */
const KEEP_ANALYSES = 6
/** By the photo's seed and the size it was given at: a small copy (a recipe's thumbnail) is not the photo. */
const analyses = new Map<string, Analysis>()
/** The size each photo was last given at: what its pieces are worked out on now. */
const current = new Map<number, string>()
const analysisOf = (seed: number | undefined): Analysis | null => {
  if (seed === undefined) return null
  const at = current.get(seed)
  return at ? (analyses.get(at) ?? null) : null
}
/**
 * Where a piece's image comes from: the library, loading it if need be. The
 * render worker has no library; the app hands it the images (see renderWorker).
 */
let imageLookup: (id: string) => CollageImage | null = collageImageNow
export function setCollageImageLookup(lookup: (id: string) => CollageImage | null): void {
  imageLookup = lookup
}
/** An image from the Collage library, if it is loaded (the double exposure's second photo uses the same library). */
export const lookupCollageImage = (id: string): CollageImage | null => imageLookup(id)
const mapsCache = new Map<string, PieceMaps>()
const KEEP_MAPS = 200

/**
 * The photo collage pieces are found in. Analysed once (a fraction of a
 * second at most); a later call for the same photo is free.
 */
export function setCollagePhoto(seed: number, source: CanvasImageSource, photo: Size): void {
  const at = `${seed}:${photo.width}x${photo.height}`
  current.set(seed, at)
  if (analyses.has(at)) {
    const kept = analyses.get(at)!
    analyses.delete(at)
    analyses.set(at, kept)
    return
  }
  const k = Math.min(1, WORK / Math.max(photo.width, photo.height))
  const w = Math.max(1, Math.round(photo.width * k))
  const h = Math.max(1, Math.round(photo.height * k))
  // In the render worker there is no document.
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, w, h)
  const rgb = ctx.getImageData(0, 0, w, h).data
  const n = w * h
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) L[i] = (0.2126 * rgb[i * 4] + 0.7152 * rgb[i * 4 + 1] + 0.0722 * rgb[i * 4 + 2]) / 255
  // Closing (brightest around, then darkest of that) minus the pixel itself.
  const closed = morph(morph(L, w, h, HAT_REACH, true), w, h, HAT_REACH, false)
  const hat = new Float32Array(n)
  for (let i = 0; i < n; i++) hat[i] = Math.max(0, closed[i] - L[i])
  analyses.set(at, { seed, photo: { ...photo }, w, h, rgb, L, hat })
  while (analyses.size > KEEP_ANALYSES) analyses.delete(analyses.keys().next().value!)
}

/** Whether pieces can be found in this photo right now. */
export const collagePhotoReady = (seed: number | undefined) => !!analysisOf(seed)

/** Square max (dilate) or min (erode) filter, separable. */
function morph(src: Float32Array, w: number, h: number, r: number, max: boolean): Float32Array {
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  const pick = max ? Math.max : Math.min
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      let v = src[row + x]
      for (let d = 1; d <= r; d++) {
        if (x - d >= 0) v = pick(v, src[row + x - d])
        if (x + d < w) v = pick(v, src[row + x + d])
      }
      tmp[row + x] = v
    }
  }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = tmp[y * w + x]
      for (let d = 1; d <= r; d++) {
        if (y - d >= 0) v = pick(v, tmp[(y - d) * w + x])
        if (y + d < h) v = pick(v, tmp[(y + d) * w + x])
      }
      out[y * w + x] = v
    }
  return out
}

/** Box blur in place over a w×h float array, separable, radius r. */
function boxBlur(a: Float32Array, w: number, h: number, r: number): void {
  if (r < 1) return
  const tmp = new Float32Array(a.length)
  const n = 2 * r + 1
  for (let y = 0; y < h; y++) {
    const row = y * w
    let sum = 0
    for (let x = -r; x <= r; x++) sum += a[row + Math.min(w - 1, Math.max(0, x))]
    for (let x = 0; x < w; x++) {
      tmp[row + x] = sum / n
      sum += a[row + Math.min(w - 1, x + r + 1)] - a[row + Math.max(0, x - r)]
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0
    for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]
    for (let y = 0; y < h; y++) {
      a[y * w + x] = sum / n
      sum += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]
    }
  }
}

// The photo's seed first (pieceContains reads it), then the size it was analysed at.
const pieceKey = (seed: number, p: CollagePiece) =>
  JSON.stringify([seed, current.get(seed) ?? '', p.seeds, p.tolerance, p.seal, p.soften, p.fillHoles !== false, p.throughLeaves === true])

/** A piece's area and maps, worked out on first use and kept. Null if the photo is not analysed. */
export function pieceMaps(seed: number | undefined, piece: CollagePiece): PieceMaps | null {
  const a = analysisOf(seed)
  if (!a || seed === undefined) return null
  const key = pieceKey(seed, piece)
  // By the piece and the photo it is on: two photos' pieces never share maps.
  const id = `${current.get(seed)}:${piece.id}`
  const hit = mapsCache.get(id)
  if (hit?.key === key) return hit
  const maps = buildMaps(a, piece, key)
  if (maps) {
    mapsCache.delete(id)
    mapsCache.set(id, maps)
    while (mapsCache.size > KEEP_MAPS) mapsCache.delete(mapsCache.keys().next().value!)
  }
  return maps
}

/** A piece's area alone, on the whole working grid (see findArea). */
interface Area {
  /** 1 inside, over the area's own rectangle x0..x1, y0..y1 (inclusive). */
  region: Uint8Array
  x0: number
  y0: number
  x1: number
  y1: number
  pixels: number
}

const areaCache = new Map<string, Area | null>()

/**
 * Just where a piece reaches, without the maps the render needs: what
 * Arrange works out for every gap it is given, so quick, and kept (a few,
 * newest last) for the maps to start from.
 */
function areaOf(a: Analysis, piece: CollagePiece, key: string): Area | null {
  if (areaCache.has(key)) {
    const hit = areaCache.get(key)!
    areaCache.delete(key)
    areaCache.set(key, hit)
    return hit
  }
  const found = findArea(a, piece)
  areaCache.set(key, found)
  while (areaCache.size > 96) areaCache.delete(areaCache.keys().next().value!)
  return found
}

/** A gap's area and extent (photo fractions), from a click in it; null if none. Quick: no maps. */
export function gapArea(
  seed: number | undefined,
  piece: CollagePiece,
): { area: [number, number, number, number]; cx: number; cy: number; pixels: number; grid: { w: number; h: number }; box: [number, number, number, number]; region: Uint8Array } | null {
  const a = analysisOf(seed)
  if (!a || seed === undefined) return null
  const found = areaOf(a, piece, pieceKey(seed, piece))
  if (!found) return null
  let sx = 0
  let sy = 0
  const fw = found.x1 - found.x0 + 1
  for (let y = found.y0; y <= found.y1; y++)
    for (let x = found.x0; x <= found.x1; x++)
      if (found.region[(y - found.y0) * fw + x - found.x0]) {
        sx += x
        sy += y
      }
  return {
    area: [found.x0 / a.w, found.y0 / a.h, (found.x1 + 1) / a.w, (found.y1 + 1) / a.h],
    cx: sx / found.pixels / a.w,
    cy: sy / found.pixels / a.h,
    pixels: found.pixels,
    grid: { w: a.w, h: a.h },
    box: [found.x0, found.y0, found.x1, found.y1],
    region: found.region,
  }
}

/**
 * Which of a piece's clicks reach a gap at (x, y) (photo fractions): their
 * places in `piece.seeds`. Empty where none does (a hole the piece fills
 * round, say, or outside it).
 */
export function gapsAt(seed: number | undefined, piece: CollagePiece, x: number, y: number): number[] {
  const out: number[] = []
  piece.seeds.forEach((s, k) => {
    const g = gapArea(seed, { ...piece, seeds: [s] })
    if (!g) return
    const gx = Math.floor(x * g.grid.w)
    const gy = Math.floor(y * g.grid.h)
    const [x0, y0, x1, y1] = g.box
    if (gx < x0 || gy < y0 || gx > x1 || gy > y1) return
    if (g.region[(gy - y0) * (x1 - x0 + 1) + gx - x0]) out.push(k)
  })
  return out
}

function findArea(a: Analysis, piece: CollagePiece): Area | null {
  const { w, h, rgb, L, hat } = a
  const n = w * h
  // Lines: a pixel well darker than the brightest just around it.
  const barrierAt = 0.11 - 0.08 * piece.seal
  const thick = piece.seal >= 0.75
  const isLine = (i: number) => hat[i] > barrierAt
  const blocked = (i: number) => {
    if (isLine(i)) return true
    if (!thick) return false
    const x = i % w
    return (x > 0 && isLine(i - 1)) || (x < w - 1 && isLine(i + 1)) || (i >= w && isLine(i - w)) || (i + w < n && isLine(i + w))
  }
  const tol = 0.05 + 0.45 * piece.tolerance
  const tol2 = tol * tol
  const step = 0.025 + 0.06 * piece.tolerance
  const step2 = step * step
  const region = new Uint8Array(n)
  const stack = new Int32Array(n)
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  let area = 0
  for (const s of piece.seeds) {
    let sx = Math.min(w - 1, Math.max(0, Math.round(s.x * (w - 1))))
    let sy = Math.min(h - 1, Math.max(0, Math.round(s.y * (h - 1))))
    // Clicked on a line itself: start from the nearest open pixel.
    if (blocked(sy * w + sx)) {
      let best = -1
      let bestD = Infinity
      for (let dy = -6; dy <= 6; dy++)
        for (let dx = -6; dx <= 6; dx++) {
          const x = sx + dx
          const y = sy + dy
          if (x < 0 || y < 0 || x >= w || y >= h || blocked(y * w + x)) continue
          const d = dx * dx + dy * dy
          if (d < bestD) {
            bestD = d
            best = y * w + x
          }
        }
      if (best < 0) continue
      sx = best % w
      sy = (best / w) | 0
    }
    // The colour clicked: an average of the open pixels around it.
    let cr = 0
    let cg = 0
    let cb = 0
    let cn = 0
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const x = sx + dx
        const y = sy + dy
        if (x < 0 || y < 0 || x >= w || y >= h || blocked(y * w + x)) continue
        const i = (y * w + x) * 4
        cr += rgb[i]
        cg += rgb[i + 1]
        cb += rgb[i + 2]
        cn++
      }
    cr /= cn * 255
    cg /= cn * 255
    cb /= cn * 255
    const start = sy * w + sx
    if (region[start]) continue
    let top = 0
    stack[top++] = start
    region[start] = 1
    while (top > 0) {
      const i = stack[--top]
      area++
      const x = i % w
      const y = (i / w) | 0
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
      const pr = rgb[i * 4] / 255
      const pg = rgb[i * 4 + 1] / 255
      const pb = rgb[i * 4 + 2] / 255
      const visit = (j: number) => {
        if (region[j] || blocked(j)) return
        const qr = rgb[j * 4] / 255
        const qg = rgb[j * 4 + 1] / 255
        const qb = rgb[j * 4 + 2] / 255
        // Near the colour clicked, and no sudden jump from its neighbour.
        if ((qr - cr) ** 2 + (qg - cg) ** 2 + (qb - cb) ** 2 > tol2) return
        if ((qr - pr) ** 2 + (qg - pg) ** 2 + (qb - pb) ** 2 > step2) return
        region[j] = 1
        stack[top++] = j
      }
      if (x > 0) visit(i - 1)
      if (x < w - 1) visit(i + 1)
      if (y > 0) visit(i - w)
      if (y < h - 1) visit(i + w)
    }
  }
  if (area === 0) return null

  // Holes: what the area closes round without spreading into it — blue
  // between clouds, a bright cloud top, past the colour Tolerance allows.
  // Left out, the photo's own sky showed through the image there. A hole a
  // line runs through (a street lamp, a cable's loose end) is something in
  // front of the sky, and stays.
  if (piece.fillHoles !== false) {
    const bx0 = Math.max(0, x0 - 1)
    const by0 = Math.max(0, y0 - 1)
    const bx1 = Math.min(w - 1, x1 + 1)
    const by1 = Math.min(h - 1, y1 + 1)
    const bw = bx1 - bx0 + 1
    const bh = by1 - by0 + 1
    // 0 unknown, 1 open to the outside, 2 a hole looked at already.
    const mark = new Uint8Array(bw * bh)
    const at = (x: number, y: number) => (y - by0) * bw + (x - bx0)
    let top = 0
    const push = (x: number, y: number) => {
      const k = at(x, y)
      if (mark[k] || region[y * w + x]) return
      mark[k] = 1
      stack[top++] = y * w + x
    }
    for (let x = bx0; x <= bx1; x++) {
      push(x, by0)
      push(x, by1)
    }
    for (let y = by0; y <= by1; y++) {
      push(bx0, y)
      push(bx1, y)
    }
    while (top > 0) {
      const i = stack[--top]
      const x = i % w
      const y = (i / w) | 0
      if (x > bx0) push(x - 1, y)
      if (x < bx1) push(x + 1, y)
      if (y > by0) push(x, y - 1)
      if (y < by1) push(x, y + 1)
    }
    const hole: number[] = []
    for (let y = by0; y <= by1; y++)
      for (let x = bx0; x <= bx1; x++) {
        const k = at(x, y)
        if (mark[k] || region[y * w + x]) continue
        // One hole: all of it, and how much of it is line.
        hole.length = 0
        let lines = 0
        mark[k] = 2
        stack[top++] = y * w + x
        while (top > 0) {
          const i = stack[--top]
          hole.push(i)
          if (isLine(i)) lines++
          const hx = i % w
          const hy = (i / w) | 0
          const step = (j: number, jx: number, jy: number) => {
            const m = at(jx, jy)
            if (mark[m] || region[j]) return
            mark[m] = 2
            stack[top++] = j
          }
          if (hx > bx0) step(i - 1, hx - 1, hy)
          if (hx < bx1) step(i + 1, hx + 1, hy)
          if (hy > by0) step(i - w, hx, hy - 1)
          if (hy < by1) step(i + w, hx, hy + 1)
        }
        if (lines > Math.max(2, hole.length * 0.02)) continue
        for (const i of hole) region[i] = 1
        area += hole.length
      }

    // Bays: a patch the area closes round on one side with a wire on the
    // other (a cloud top sitting on the wire below it). The wire lets it out
    // to the far side, so it is no hole above; with lines as walls it is one.
    // It is filled when the area makes up at least as much of its edge as
    // the wire and the area's rectangle do together. A gap across a wire
    // touches only the wire, so it stays.
    // Walls are the lines a pixel thicker and a little fainter, so a patch
    // does not slip out through a wire's faint end into the open sky past it.
    const faint = barrierAt * 0.7
    const wall = (i: number) => {
      if (hat[i] > faint) return true
      const x = i % w
      return (x > 0 && hat[i - 1] > faint) || (x < w - 1 && hat[i + 1] > faint) || (i >= w && hat[i - w] > faint) || (i + w < n && hat[i + w] > faint)
    }
    // Looked for a little past the area's rectangle, so a patch that reaches
    // out of it (to the photo's edge, say) is weighed whole, not cut off.
    const reach = Math.round(0.04 * Math.max(w, h))
    const cx0 = Math.max(0, x0 - reach)
    const cy0 = Math.max(0, y0 - reach)
    const cx1 = Math.min(w - 1, x1 + reach)
    const cy1 = Math.min(h - 1, y1 + reach)
    const cw = cx1 - cx0 + 1
    const seen = new Uint8Array(cw * (cy1 - cy0 + 1))
    const near = (x: number, y: number) => (y - cy0) * cw + (x - cx0)
    for (let y = cy0; y <= cy1; y++)
      for (let x = cx0; x <= cx1; x++) {
        const k = near(x, y)
        const i0 = y * w + x
        if (seen[k] || region[i0] || wall(i0)) continue
        hole.length = 0
        let byArea = 0
        let byLine = 0
        let open = 0
        let lightIn = 0
        let lightBy = 0
        seen[k] = 1
        stack[top++] = i0
        while (top > 0) {
          const i = stack[--top]
          hole.push(i)
          lightIn += L[i]
          const hx = i % w
          const hy = (i / w) | 0
          if (hx === cx0 || hx === cx1 || hy === cy0 || hy === cy1) open++
          const step = (j: number, jx: number, jy: number) => {
            if (region[j]) {
              byArea++
              lightBy += L[j]
              return
            }
            if (wall(j)) return void byLine++
            const m = near(jx, jy)
            if (seen[m]) return
            seen[m] = 1
            stack[top++] = j
          }
          if (hx > cx0) step(i - 1, hx - 1, hy)
          if (hx < cx1) step(i + 1, hx + 1, hy)
          if (hy > cy0) step(i - w, hx, hy - 1)
          if (hy < cy1) step(i + w, hx, hy + 1)
        }
        if (byArea < byLine + open || hole.length > area / 2) continue
        // Sky, not something in front of it: a building or a pole reaching
        // up under the area is far darker than the area along its edge.
        if (lightIn / hole.length < 0.35 * (lightBy / byArea)) continue
        for (const i of hole) {
          region[i] = 1
          const hx = i % w
          const hy = (i / w) | 0
          if (hx < x0) x0 = hx
          if (hx > x1) x1 = hx
          if (hy < y0) y0 = hy
          if (hy > y1) y1 = hy
        }
        area += hole.length
      }
  }

  // Sky through leaves: specks of this sky inside foliage near the area,
  // each its own island no click reaches, filled too. A speck is this sky's
  // colour (within its spread), at least as bright as its darker part, not a
  // line, and darker all round (leaves). Through a canopy the specks join
  // into a lacy network, so size alone does not rule one out: a big one must
  // be lacy (much edge for its size). A white wall is solid, or not ringed by
  // anything darker.
  if (piece.throughLeaves) {
    const tally = [0, 0, 0]
    const sq = [0, 0, 0]
    const lums: number[] = []
    let count = 0
    const every = Math.max(1, Math.floor(area / 40000))
    let seen = 0
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const i = y * w + x
        if (!region[i] || seen++ % every) continue
        for (let c = 0; c < 3; c++) {
          tally[c] += rgb[i * 4 + c]
          sq[c] += rgb[i * 4 + c] ** 2
        }
        lums.push(L[i])
        count++
      }
    const mean = tally.map((t) => t / count)
    const spread = sq.map((q, c) => Math.sqrt(Math.max(0, q / count - mean[c] ** 2)))
    lums.sort((p, q) => p - q)
    const darkest = (lums[Math.floor(lums.length * 0.05)] ?? 0) - 0.03
    const reach = Math.round(0.08 * Math.max(w, h))
    const sx0 = Math.max(0, x0 - reach)
    const sy0 = Math.max(0, y0 - reach)
    const sx1 = Math.min(w - 1, x1 + reach)
    const sy1 = Math.min(h - 1, y1 + reach)
    const isSky = (i: number) => {
      if (region[i] || isLine(i) || L[i] < darkest) return false
      for (let c = 0; c < 3; c++) if (Math.abs(rgb[i * 4 + c] - mean[c]) > 2.5 * spread[c] + 12) return false
      return true
    }
    const sw = sx1 - sx0 + 1
    const done = new Uint8Array(sw * (sy1 - sy0 + 1))
    const small = Math.max(60, Math.round(area * 0.01))
    const most = Math.round(area * 0.15)
    const speck: number[] = []
    let top = 0
    for (let y = sy0; y <= sy1; y++)
      for (let x = sx0; x <= sx1; x++) {
        const k0 = (y - sy0) * sw + x - sx0
        const i0 = y * w + x
        if (done[k0] || !isSky(i0)) continue
        speck.length = 0
        let ring = 0
        let ringN = 0
        let contact = 0
        let inner = 0
        let big = false
        done[k0] = 1
        stack[top++] = i0
        while (top > 0) {
          const i = stack[--top]
          if (!big) speck.push(i)
          if (speck.length > most) big = true
          inner += L[i]
          const px = i % w
          const py = (i / w) | 0
          const step = (j: number, jx: number, jy: number) => {
            if (jx < sx0 || jx > sx1 || jy < sy0 || jy > sy1) return
            const kk = (jy - sy0) * sw + jx - sx0
            if (done[kk]) return
            if (!isSky(j)) {
              if (!region[j]) {
                ring += L[j]
                ringN++
              } else contact++
              return
            }
            done[kk] = 1
            stack[top++] = j
          }
          if (px > 0) step(i - 1, px - 1, py)
          if (px < w - 1) step(i + 1, px + 1, py)
          if (py > 0) step(i - w, px, py - 1)
          if (py < h - 1) step(i + w, px, py + 1)
        }
        if (big || !speck.length) continue
        // A patch of this sky the area runs into along much of its edge (a
        // bright cloud top the colour Tolerance stopped short of, open to
        // the trees below it): the same sky, whatever its size.
        const sameSky = contact >= 0.3 * (contact + ringN)
        if (!sameSky) {
          if (!ringN) continue
          if (ring / ringN > inner / speck.length - 0.12) continue
          if (speck.length > small && ringN / speck.length < 0.3) continue
        }
        for (const i of speck) {
          region[i] = 1
          const px = i % w
          const py = (i / w) | 0
          if (px < x0) x0 = px
          if (px > x1) x1 = px
          if (py < y0) y0 = py
          if (py > y1) y1 = py
        }
        area += speck.length
      }
  }

  // Kept cropped to its rectangle: the whole grid per gap adds up.
  const cw = x1 - x0 + 1
  const crop = new Uint8Array(cw * (y1 - y0 + 1))
  for (let y = y0; y <= y1; y++) crop.set(region.subarray(y * w + x0, y * w + x1 + 1), (y - y0) * cw)
  return { region: crop, x0, y0, x1, y1, pixels: area }
}

function buildMaps(a: Analysis, piece: CollagePiece, key: string): PieceMaps | null {
  const { w, h, rgb, L, hat } = a
  const found = areaOf(a, piece, key)
  if (!found) return null
  const { x0, y0, x1, y1, pixels: area } = found
  const fw = x1 - x0 + 1
  const inArea = (x: number, y: number) => (x >= x0 && x <= x1 && y >= y0 && y <= y1 ? found.region[(y - y0) * fw + x - x0] : 0)
  const barrierAt = 0.11 - 0.08 * piece.seal

  // Work on the area's rectangle plus room for the band and the blurs.
  const soft = Math.round(piece.soften * 12)
  const margin = BAND + WIRE_REACH + 10 + soft * 2
  const rx = Math.max(0, x0 - margin)
  const ry = Math.max(0, y0 - margin)
  const rw = Math.min(w, x1 + margin + 1) - rx
  const rh = Math.min(h, y1 + margin + 1) - ry
  const m = rw * rh
  const R = new Float32Array(m)
  const sub = new Uint8Array(m)
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const v = inArea(rx + x, ry + y)
      sub[y * rw + x] = v
      R[y * rw + x] = v
    }
  // The band: where a pixel may still be part sky, up to BAND past the area.
  // Once it has dipped into something dark (a wire) it may only go on
  // downhill, so it stops at the wire's darkest middle; before that it may
  // climb, over the bright halo sharpening leaves on this side. Grown evenly,
  // it reached right across a thin wire into the next gap's sky, which looks
  // like this sky, so that strip took this piece's image: a fringe on the far
  // side of every wire.
  const band = new Float32Array(m)
  {
    const reach = new Int8Array(m).fill(-1)
    const start = new Float32Array(m) // brightness where the path left the area
    const low = new Float32Array(m) // darkest along the path so far
    const queue = new Int32Array(m)
    let head = 0
    let tail = 0
    const lum = (k: number) => L[(ry + ((k / rw) | 0)) * w + rx + (k % rw)]
    for (let k = 0; k < m; k++)
      if (sub[k]) {
        reach[k] = 0
        start[k] = low[k] = lum(k)
        queue[tail++] = k
      }
    while (head < tail) {
      const k = queue[head++]
      band[k] = 1
      const d = reach[k]
      if (d >= BAND) continue
      const here = lum(k)
      const dipped = low[k] < start[k] - 0.06
      const x = k % rw
      const step = (j: number) => {
        if (reach[j] >= 0) return
        const there = lum(j)
        if (dipped && there > here + 0.012) return
        reach[j] = d + 1
        start[j] = start[k]
        low[j] = Math.min(low[k], there)
        queue[tail++] = j
      }
      if (x > 0) step(k - 1)
      if (x < rw - 1) step(k + 1)
      if (k >= rw) step(k - rw)
      if (k + rw < m) step(k + rw)
    }
  }
  // Well inside: the area shrunk by 2, where no line is close.
  const inside = morph(R, rw, rh, 2, false)
  boxBlur(inside, rw, rh, 1)
  const weight = band.slice()
  boxBlur(weight, rw, rh, 1)
  if (soft > 0) {
    boxBlur(weight, rw, rh, soft)
    boxBlur(inside, rw, rh, soft)
  }
  // Never more than a pixel past the band, softened or not: past it is the
  // far side of a line.
  const limit = morph(band, rw, rh, 1, true)
  for (let k = 0; k < m; k++) weight[k] *= limit[k]
  // S: the area's own colour around each pixel, averaged over the area only.
  const sr = new Float32Array(m)
  const sg = new Float32Array(m)
  const sb = new Float32Array(m)
  const sw = R.slice()
  let meanLin = 0
  const meanRgb: [number, number, number] = [0, 0, 0]
  // The old sky's broad light (its glow toward the sun, its haze at the
  // horizon), linear, averaged far over the area only: for Keep the photo's light.
  const broad = new Float32Array(m)
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const k = y * rw + x
      if (!sub[k]) continue
      const i = ((ry + y) * w + rx + x) * 4
      sr[k] = rgb[i]
      sg[k] = rgb[i + 1]
      sb[k] = rgb[i + 2]
      const lr = lin(rgb[i])
      const lg = lin(rgb[i + 1])
      const lb = lin(rgb[i + 2])
      meanRgb[0] += lr
      meanRgb[1] += lg
      meanRgb[2] += lb
      broad[k] = 0.2126 * lr + 0.7152 * lg + 0.0722 * lb
      meanLin += broad[k]
    }
  meanLin /= area
  for (let c = 0; c < 3; c++) meanRgb[c] /= area
  const broadW = R.slice()
  {
    const far = Math.max(8, Math.round(Math.max(w, h) / 40))
    for (let pass = 0; pass < 3; pass++) {
      boxBlur(broad, rw, rh, far)
      boxBlur(broadW, rw, rh, far)
    }
  }
  for (const r of [6, 6, 12]) {
    boxBlur(sr, rw, rh, r)
    boxBlur(sg, rw, rh, r)
    boxBlur(sb, rw, rh, r)
    boxBlur(sw, rw, rh, r)
  }
  const sky = new ImageData(rw, rh)
  const wire = new ImageData(rw, rh)
  const line = new ImageData(rw, rh)
  const smooth01 = (a: number, b: number, x: number) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)
  }
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const k = y * rw + x
      const o = k * 4
      const gx = rx + x
      const gy = ry + y
      const own = (gy * w + gx) * 4
      const wt = sw[k]
      // Where the average has nothing to go on, the pixel's own colour (its weight is 0 there anyway).
      if (wt > 1e-4) {
        sky.data[o] = sr[k] / wt
        sky.data[o + 1] = sg[k] / wt
        sky.data[o + 2] = sb[k] / wt
      } else {
        sky.data[o] = rgb[own]
        sky.data[o + 1] = rgb[own + 1]
        sky.data[o + 2] = rgb[own + 2]
      }
      sky.data[o + 3] = Math.round(Math.min(1, weight[k]) * 255)
      // W: the darkest pixel close by, looked for only where it matters.
      let darkest = own
      if (band[k] > 0 && inside[k] < 1) {
        let lo = L[gy * w + gx]
        for (let dy = -WIRE_REACH; dy <= WIRE_REACH; dy++) {
          const yy = gy + dy
          if (yy < 0 || yy >= h) continue
          for (let dx = -WIRE_REACH; dx <= WIRE_REACH; dx++) {
            const xx = gx + dx
            if (xx < 0 || xx >= w) continue
            const j = yy * w + xx
            if (L[j] < lo) {
              lo = L[j]
              darkest = j * 4
            }
          }
        }
      }
      wire.data[o] = rgb[darkest]
      wire.data[o + 1] = rgb[darkest + 1]
      wire.data[o + 2] = rgb[darkest + 2]
      wire.data[o + 3] = Math.round(Math.min(1, Math.max(0, inside[k])) * 255)
      // A thin line is much darker than the brightest just around it (the
      // black-hat); the edge of a big dark shape is not, however dark it is.
      const isLine = band[k] > 0 ? Math.round(smooth01(barrierAt * 0.4, barrierAt, hat[gy * w + gx]) * 255) : 0
      line.data[o] = isLine
      // g: the broad light here over the area's average, 0..2 as 0..255.
      const here = broadW[k] > 1e-4 ? broad[k] / broadW[k] / Math.max(meanLin, 1e-5) : 1
      line.data[o + 1] = Math.round(Math.min(2, Math.max(0, here)) * 127.5)
      line.data[o + 2] = isLine
      line.data[o + 3] = 255
    }
  return {
    key,
    x: rx,
    y: ry,
    w: rw,
    h: rh,
    rect: [rx / w, ry / h, (rx + rw) / w, (ry + rh) / h],
    area: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h],
    region: sub,
    sky,
    wire,
    line,
    meanLin,
    meanRgb,
    pixels: area,
  }
}

/** Whether a point (photo fractions) is inside a piece's area. */
export function pieceContains(maps: PieceMaps, x: number, y: number): boolean {
  // The analysis the maps were made on: named second in their key (pieceKey).
  const a = analyses.get((JSON.parse(maps.key) as [number, string])[1]) ?? null
  if (!a) return false
  const gx = Math.round(x * (a.w - 1)) - maps.x
  const gy = Math.round(y * (a.h - 1)) - maps.y
  if (gx < 0 || gy < 0 || gx >= maps.w || gy >= maps.h) return false
  return maps.region[gy * maps.w + gx] === 1
}

/** The topmost piece at a point, if any. */
export function pieceAt(seed: number | undefined, collage: CollageParams, x: number, y: number): number | null {
  for (let i = collage.pieces.length - 1; i >= 0; i--) {
    const maps = pieceMaps(seed, collage.pieces[i])
    if (maps && pieceContains(maps, x, y)) return i
  }
  return null
}

/** The image's width and height in fractions of the photo. */
export function imageSpan(piece: Pick<CollagePiece, 'scale'>, image: { width: number; height: number }, photo: Size): [number, number] {
  return [piece.scale, (piece.scale * photo.width * image.height) / (image.width * photo.height)]
}

/**
 * Where a point of the photo (fractions) falls on a piece's image (0..1
 * across and down, before mirroring past its edge): the image is centred on
 * (x, y), turned by its rotation and flipped if asked. Worked in photo
 * pixels, so a turn keeps the image's shape whatever the photo's.
 */
export function imageUvAt(
  piece: Pick<CollagePiece, 'x' | 'y' | 'scale' | 'rotation' | 'flip'>,
  image: { width: number; height: number },
  photo: Size,
  px: number,
  py: number,
): [number, number] {
  const [sw, sh] = imageSpan(piece, image, photo)
  const qx = (px - piece.x) * photo.width
  const qy = (py - piece.y) * photo.height
  const t = ((piece.rotation ?? 0) * Math.PI) / 180
  const c = Math.cos(t)
  const s = Math.sin(t)
  const rx = c * qx + s * qy
  const ry = -s * qx + c * qy
  let u = rx / (sw * photo.width) + 0.5
  const v = ry / (sh * photo.height) + 0.5
  if (piece.flip) u = 1 - u
  return [u, v]
}

/** Where a new piece's image goes: centred on the area, just covering it. */
export function coverPlacement(maps: PieceMaps, image: { width: number; height: number }, photo: Size) {
  const [x0, y0, x1, y1] = maps.area
  const scale = 1.02 * minCoverScale(maps, image, photo)
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, scale }
}

/** The smallest scale at which the image, unturned, still covers the whole area. */
function minCoverScale(maps: PieceMaps, image: { width: number; height: number }, photo: Size) {
  const [x0, y0, x1, y1] = maps.area
  return Math.max(x1 - x0, ((y1 - y0) * photo.height * image.width) / (photo.width * image.height))
}

/** Whether the image, placed so, covers every corner of the area. */
function covers(p: Pick<CollagePiece, 'x' | 'y' | 'scale' | 'rotation'>, maps: PieceMaps, image: { width: number; height: number }, photo: Size) {
  const [x0, y0, x1, y1] = maps.area
  for (const [cx, cy] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
    const [u, v] = imageUvAt({ ...p, flip: false }, image, photo, cx, cy)
    if (u < -1e-4 || u > 1 + 1e-4 || v < -1e-4 || v > 1 + 1e-4) return false
  }
  return true
}

/**
 * A placement held so the image always covers its area: never smaller than
 * it (turned, a little larger), never moved so an edge of the image shows
 * inside it, where there would be nothing to show but edge pixels stretched.
 * A move too far stops where the image still covers; a turn that would
 * uncover a corner grows the image just enough.
 */
export function constrainPlacement(
  p: { x: number; y: number; scale: number; rotation?: number },
  maps: PieceMaps,
  image: { width: number; height: number },
  photo: Size,
): { x: number; y: number; scale: number } {
  const [x0, y0, x1, y1] = maps.area
  const cx = (x0 + x1) / 2
  const cy = (y0 + y1) / 2
  const rotation = p.rotation ?? 0
  // Big enough to cover the area from its centre, turned as it is.
  let scale = Math.max(p.scale, minCoverScale(maps, image, photo))
  if (!covers({ x: cx, y: cy, scale, rotation }, maps, image, photo)) {
    let lo = scale
    let hi = scale * 4
    while (!covers({ x: cx, y: cy, scale: hi, rotation }, maps, image, photo) && hi < 400) hi *= 2
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2
      if (covers({ x: cx, y: cy, scale: mid, rotation }, maps, image, photo)) hi = mid
      else lo = mid
    }
    scale = hi
  }
  if (covers({ x: p.x, y: p.y, scale, rotation }, maps, image, photo)) return { x: p.x, y: p.y, scale }
  // Moved too far: as far toward it from the area's centre as still covers.
  let lo = 0
  let hi = 1
  for (let i = 0; i < 24; i++) {
    const t = (lo + hi) / 2
    if (covers({ x: cx + (p.x - cx) * t, y: cy + (p.y - cy) * t, scale, rotation }, maps, image, photo)) lo = t
    else hi = t
  }
  return { x: cx + (p.x - cx) * lo, y: cy + (p.y - cy) * lo, scale }
}

/** How much the image is scaled to sit at the brightness of what it replaces. */
const imageColours = new WeakMap<ImageBitmap, [number, number, number]>()

/** An image's average colour, linear, read once from a small copy. */
function imageColour(bitmap: ImageBitmap): [number, number, number] {
  const hit = imageColours.get(bitmap)
  if (hit) return hit
  const N = 24
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(N, N) : Object.assign(document.createElement('canvas'), { width: N, height: N })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.drawImage(bitmap, 0, 0, N, N)
  const px = ctx.getImageData(0, 0, N, N).data
  const lin = (v: number) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const sum: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < N * N; i++) for (let c = 0; c < 3; c++) sum[c] += lin(px[i * 4 + c])
  const out = sum.map((v) => v / (N * N)) as [number, number, number]
  imageColours.set(bitmap, out)
  return out
}

/**
 * Light the photo: the rest of it tinted from the old sky's colour toward
 * the new one's, its brightness kept, by the piece's Relight. A warm sky
 * warms the street; a grey one cools it. (1, 1, 1) when off.
 */
function relightFor(piece: CollagePiece, maps: PieceMaps, img: CollageImage): [number, number, number] {
  const k = piece.relight ?? 0
  if (k <= 0) return [1, 1, 1]
  const lumOf = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  const tint = piece.tint ?? [1, 1, 1]
  const now = imageColour(img.bitmap).map((v, c) => v * tint[c])
  const was = maps.meanRgb
  const chroma = (c: number[]) => c.map((v) => v / Math.max(lumOf(c), 1e-5))
  const a = chroma(now)
  const b = chroma(was)
  const gain = a.map((v, c) => Math.pow(Math.max(v, 1e-3) / Math.max(b[c], 1e-3), k))
  const keep = 1 / Math.max(lumOf(gain), 1e-5)
  return gain.map((v) => Math.round(Math.min(3, Math.max(0.3, v * keep)) * 1000) / 1000) as [number, number, number]
}

function gainFor(piece: CollagePiece, maps: PieceMaps, img: CollageImage, photo: Size): number {
  let sum = 0
  let count = 0
  const N = 24
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const lx = Math.floor(((i + 0.5) / N) * maps.w)
      const ly = Math.floor(((j + 0.5) / N) * maps.h)
      if (!maps.region[ly * maps.w + lx]) continue
      const px = maps.rect[0] + (lx / maps.w) * (maps.rect[2] - maps.rect[0])
      const py = maps.rect[1] + (ly / maps.h) * (maps.rect[3] - maps.rect[1])
      const [u, v] = imageUvAt(piece, img.bitmap, photo, px, py)
      const lu = Math.min(img.luma.width - 1, Math.max(0, Math.floor(u * img.luma.width)))
      const lv = Math.min(img.luma.height - 1, Math.max(0, Math.floor(v * img.luma.height)))
      sum += img.luma.data[lv * img.luma.width + lu]
      count++
    }
  const mean = count ? sum / count : 0
  const matched = mean > 1e-4 ? Math.pow(maps.meanLin / mean, piece.match) : 1
  return Math.min(16, matched * Math.pow(2, piece.brightness))
}

/**
 * The pieces to lay into this photo, ready for the GPU. Pieces made on
 * another photo, or whose image is still loading, are left out (the image
 * announces itself when it is ready; see onCollageImage).
 */
export function collageLayers(seed: number | undefined, collage: CollageParams | undefined): CollageLayer[] {
  if (!collage?.enabled || !collage.pieces.length || seed === undefined || collage.photo !== seed) return []
  const a = analysisOf(seed)
  if (!a) return []
  const photo = a.photo
  const out: CollageLayer[] = []
  for (const piece of collage.pieces) {
    const img = imageLookup(piece.image)
    const maps = pieceMaps(seed, piece)
    if (!img || !maps || piece.opacity <= 0) continue
    const gain = gainFor(piece, maps, img, photo)
    const span = imageSpan(piece, img.bitmap, photo)
    const residual = 0.03 + 0.06 * piece.tolerance
    const relight = relightFor(piece, maps, img)
    out.push({
      key: JSON.stringify([maps.key, piece.image, piece.x, piece.y, span, piece.rotation, piece.flip, gain, piece.opacity, residual, piece.takeLook, piece.detail ?? 0, piece.tint ?? null, piece.keepLight ?? 0, relight, piece.smooth ?? 0]),
      sky: maps.sky,
      wire: maps.wire,
      line: maps.line,
      rect: maps.rect,
      image: img.bitmap,
      centre: [piece.x, piece.y],
      span,
      rotation: ((piece.rotation ?? 0) * Math.PI) / 180,
      photoPx: [photo.width, photo.height],
      flip: piece.flip,
      gain,
      opacity: piece.opacity,
      residual,
      takeLook: piece.takeLook,
      detail: piece.detail ?? 0,
      tint: piece.tint ?? [1, 1, 1],
      keepLight: piece.keepLight ?? 0,
      relight,
      smooth: piece.smooth ?? 0,
    })
  }
  return out
}

/**
 * One piece laid in, on the GPU, at the base's own resolution: each pixel is
 * read as a mix of the line colour W and the sky colour S near it, and only
 * the sky part is swapped for the image (see the top of this file). In
 * linear light, where mixes of light add up.
 */
export const COLLAGE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform sampler2D uSky;
uniform sampler2D uWire;
uniform sampler2D uImage;
uniform sampler2D uLine;   // r: part of a thin line (see PieceMaps.line)
uniform vec4 uRect;      // the maps' rectangle in photo fractions: x0, y0, x1, y1
uniform vec4 uCrop;      // where the base sits in the photo: x, y, width, height
uniform vec3 uCropTurn;  // a turned crop: cos and sin of its angle, the photo's width over its height (z 0: not turned)
uniform vec2 uCentre;    // the image's centre, photo fractions
uniform vec2 uSpan;      // the image's width and height, photo fractions
uniform vec2 uPhotoPx;   // the photo's size in pixels, so a turn keeps the image's shape
uniform float uRotation; // the image turned clockwise, radians
uniform float uFlip;
uniform float uGain;
uniform float uOpacity;
uniform float uResidual;
uniform float uTakeLook;  // how much of the look the piece takes, 0..1
uniform float uDetail;    // how much of the photo's fine detail stays on the image well inside, 0..1
uniform vec3 uTint;       // the image's colour scaled per channel, linear
uniform float uKeepLight; // how much of the old sky's broad light the image takes, 0..1
uniform vec3 uRelight;    // the rest of the photo's colour scaled by this, linear; (1,1,1) off
uniform float uSmooth;    // softening of the image's own grain, 0..1

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

// The rest of the photo under the new sky's light (Light the photo).
vec4 relit(vec4 base) {
  if (uRelight == vec3(1.0)) return base;
  return vec4(toSrgb(toLinear(base.rgb) * uRelight), base.a);
}

void main() {
  vec4 base = texture(uSource, vUv);
  vec2 p = uCrop.xy + vUv * uCrop.zw;
  // Back through the turn, about the photo's middle, in its own proportions.
  if (uCropTurn.z > 0.0) {
    vec2 d = (p - 0.5) * vec2(uCropTurn.z, 1.0);
    d = vec2(d.x * uCropTurn.x + d.y * uCropTurn.y, -d.x * uCropTurn.y + d.y * uCropTurn.x);
    p = d / vec2(uCropTurn.z, 1.0) + 0.5;
  }
  vec2 m = (p - uRect.xy) / (uRect.zw - uRect.xy);
  if (m.x < 0.0 || m.y < 0.0 || m.x > 1.0 || m.y > 1.0) { outColor = relit(base); return; }
  vec4 sky = texture(uSky, m);
  if (sky.a <= 0.0) { outColor = relit(base); return; }
  vec4 wire = texture(uWire, m);
  vec3 c = toLinear(base.rgb);
  vec3 S = toLinear(sky.rgb);
  vec3 W = toLinear(wire.rgb);
  // How much of this pixel is sky: where it sits between the line and the sky.
  vec3 d = S - W;
  float dd = dot(d, d);
  float t = dd < 1e-5 ? 1.0 : dot(c - W, d) / dd;
  float a = clamp(t, 0.0, 1.0);
  // Not a mix of the two at all (something else at the edge): leave it. Only
  // what lies off the line from W to S counts: a camera's sharpening leaves a
  // bright halo beside a wire, brighter than the sky but along the same line,
  // and it is sky. Counted, it was left as a pale strip along every wire.
  float off = length(c - W - t * d);
  a *= 1.0 - smoothstep(uResidual, uResidual * 2.5, off);
  a = mix(a, 1.0, wire.a) * sky.a * uOpacity;
  vec2 q = (p - uCentre) * uPhotoPx;
  float cr = cos(uRotation);
  float sr = sin(uRotation);
  vec2 iu = vec2(cr * q.x + sr * q.y, -sr * q.x + cr * q.y) / (uSpan * uPhotoPx) + 0.5;
  if (uFlip > 0.5) iu.x = 1.0 - iu.x;
  // Past its edge the image is mirrored, never its edge pixels stretched
  // (placement keeps it covering the area; this is for what still shows).
  vec2 raw = iu;
  iu = 1.0 - abs(mod(iu, 2.0) - 1.0);
  vec3 img = toLinear(texture(uImage, iu).rgb);
  // Smooth: the image's own grain averaged away over a small disc (up to
  // six of its pixels across), each tap folded back in as the image is.
  // A coarser mip level instead went blocky and smeared.
  if (uSmooth > 0.0) {
    vec2 texel = 1.0 / vec2(textureSize(uImage, 0));
    float r = uSmooth * 6.0;
    float lod = max(0.0, log2(r / 3.0));
    vec3 acc = textureLod(uImage, iu, lod).rgb;
    acc = toLinear(acc);
    float wsum = 1.0;
    for (int k = 0; k < 16; k++) {
      float fk = float(k) + 0.5;
      float a = fk * 2.39996323;
      float d = sqrt(fk / 16.0) * r;
      vec2 off = vec2(cos(a), sin(a)) * d * texel;
      vec2 q = 1.0 - abs(mod(raw + off, 2.0) - 1.0);
      float w = exp(-2.0 * (d / max(r, 1e-3)) * (d / max(r, 1e-3)));
      acc += toLinear(textureLod(uImage, q, lod).rgb) * w;
      wsum += w;
    }
    img = acc / wsum;
  }
  img *= uGain * uTint;
  // The old sky's broad light, kept on the new one (Keep the photo's light).
  float broad = texture(uLine, m).g * 2.0;
  img *= mix(1.0, broad, uKeepLight);
  // Alpha: how much of the look this pixel takes (see uCollageOwn in the main
  // pass). What became the piece's sky keeps its own colour; so does its half
  // of each thin line beside it, so a wire next to a new sky stays the photo's
  // own dark (a thin wire is mostly mid-tones, which a gradient map turns
  // orange, and graded it read as a coloured line round every piece). The
  // edge of something big — a hill, a roof — takes the look as the rest of
  // it does, or it shows as an ungraded outline.
  float lineHere = texture(uLine, m).r;
  // What is not swapped is lit by the new sky.
  if (uRelight != vec3(1.0)) {
    vec3 lit = c * uRelight;
    c = mix(lit, c, a);
  }
  float own = max(smoothstep(0.3, 0.7, a / max(uOpacity, 1e-4)), lineHere * sky.a) * uOpacity;
  // Near a line the pixel is a mix of line and sky, and only its sky part
  // is swapped: c + a * (img - S), which keeps the pixel's own difference
  // from the sky around it, so the wire keeps its edge. Well inside (wire.a)
  // there is no line to keep, and that difference is the old sky's texture —
  // clouds showing through the image — so there the image is laid in as it
  // is, with only Detail's share of that texture on it.
  vec3 laid = c + a * (img - S) - a * wire.a * (1.0 - uDetail) * (c - S);
  outColor = vec4(toSrgb(max(laid, vec3(0.0))), base.a * (1.0 - own * (1.0 - uTakeLook)));
}`
