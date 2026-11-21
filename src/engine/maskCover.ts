import type { MaskShape } from './types'
import { distanceTo } from '../ml/trace'

/**
 * How wide the band along a mask's edge is where the photo decides, by
 * default: a fraction of the short side. Narrow: a selection is already near
 * the edge, and a band wider than a thin part (a mast) took its colour from
 * the rest of the subject. Saved at the old default, 0.025, it reads as this.
 */
export const KEY_BAND = 0.01
export const OLD_KEY_BAND = 0.025

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1e-6)))
  return t * t * (3 - 2 * t)
}

/**
 * How much a drawn or selected mask covers each cell of a grid, 0..1, worked
 * out as the shader's maskCover does: its cells softened by its feather (or,
 * matched at the edge, the photo deciding in a band along it), its tone key,
 * then what was painted in and out. For the tint over the photo and for
 * Repeat's piece, which are made on the CPU.
 *
 * `inside` is the mask's cells, `px` the photo under them (RGBA, cell for
 * cell), `perShort` how many cells make the mask frame's short side.
 */
export function maskCoverage(
  m: MaskShape,
  w: number,
  h: number,
  inside: Uint8Array,
  px: Uint8ClampedArray,
  perShort: number,
  paintIn: Uint8Array | null = null,
  paintOut: Uint8Array | null = null,
  paintSure: Uint8Array | null = null,
  /** The distances to its edge (edgeDistances), when already worked out for these cells. */
  distances: { toOut: Float32Array; toIn: Float32Array } | null = null,
  /** Where to put it, if a grid's worth is at hand: kept, not made each time, for a brush. */
  into: Float32Array | null = null,
): Float32Array {
  const n = w * h
  const matched = m.key !== 'off'
  const edge = matched && m.keyAt === 'edge'
  const reach = (edge ? (m.keyBand ?? KEY_BAND) : m.feather) * perShort
  const soft = Math.max(m.keySoftness, 0.002)
  const ramp = reach > 0.5
  // Every array the loop reads is always there and always the same kind:
  // one that was sometimes missing made WebKit drop the loop to its slow
  // tier after a few brush strokes, ten times and more slower.
  const none = noPaint(n)
  const pIn = paintIn ?? none
  const pOut = paintOut ?? none
  const pSure = paintSure ?? none
  const zeros = noDistance(n)
  const toOut: Float32Array = ramp ? (distances?.toOut ?? distanceTo(inside, w, h, 0)) : zeros
  const toIn: Float32Array = ramp ? (distances?.toIn ?? distanceTo(inside, w, h, 1)) : zeros
  const out = into && into.length === n ? into : new Float32Array(n)
  // Matched at the edge: the colours just inside and just outside decide (edgeColours).
  let fg: Float32Array | null = null
  let bg: Float32Array | null = null
  let ramps: Float32Array | null = null
  if (edge && ramp) {
    ramps = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      const signed = inside[i] ? toOut[i] - 0.5 : 0.5 - toIn[i]
      const g = 0.5 + signed / (2 * reach)
      ramps[i] = g < 0 ? 0 : g > 1 ? 1 : g
    }
    const maps = edgeColours(px, ramps, w, h, reach * EDGE_REACH + 2)
    fg = maps.fg
    bg = maps.bg
  }
  const blue = m.keyOn === 'blue'
  const lighterKept = m.key === 'lighter'
  const lo = m.keyLevel - soft
  const span = 2 * soft
  const featherMode = m.featherAt === 'outside' ? 0 : m.featherAt === 'centre' ? 1 : 2
  const twoReach = 2 * reach
  for (let i = 0; i < n; i++) {
    let keyed = 1
    if (fg && bg && ramps) keyed = colourKey(px[i * 4] / 255, px[i * 4 + 1] / 255, px[i * 4 + 2] / 255, fg, bg, i, ramps[i])
    else if (matched) {
      const v = blue ? px[i * 4 + 2] / 255 : (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255
      let t = (v - lo) / span
      t = t < 0 ? 0 : t > 1 ? 1 : t
      const lighter = t * t * (3 - 2 * t)
      keyed = lighterKept ? lighter : 1 - lighter
    }
    let c: number
    if (ramp) {
      const signed = inside[i] ? toOut[i] - 0.5 : 0.5 - toIn[i]
      let g = 0.5 + signed / twoReach
      g = g < 0 ? 0 : g > 1 ? 1 : g
      if (edge) c = Math.max(smooth(0.85, 1, g), keyed * smooth(0, 0.15, g))
      else {
        // The feather placed inside, across or outside the line (featherAt).
        const at = featherMode === 0 ? smooth(0, 0.5, g) : featherMode === 1 ? smooth(0.25, 0.75, g) : smooth(0.5, 1, g)
        c = at * keyed
      }
    } else c = inside[i] ? keyed : 0
    if (pIn[i] && keyed > c) c = keyed
    if (pSure[i]) c = 1
    if (pOut[i]) c = 0
    out[i] = c
  }
  return out
}

let noPaintGrid = new Uint8Array(0)
const noPaint = (n: number) => (noPaintGrid.length === n ? noPaintGrid : (noPaintGrid = new Uint8Array(n)))
let noDistanceGrid = new Float32Array(0)
const noDistance = (n: number) => (noDistanceGrid.length === n ? noDistanceGrid : (noDistanceGrid = new Float32Array(n)))

/** How far round the edge band the colours on either side are read, in bands. */
export const EDGE_REACH = 1

/**
 * The colours just inside a mask's edge and just outside it, at every cell:
 * the average of the cells near it inside the edge (`ramp` above 0.5, the
 * further in the more they count) and of those outside it, reaching further
 * where there are none near. Cells off the photo (alpha 0) count for neither.
 * Matched at the edge, each pixel in the band is then as much the subject as
 * its colour is nearer the inside colour than the outside one (colourKey), so
 * a subject both lighter and darker than what is round it (a white mast and
 * a dark pod against grey sky) is kept whole.
 */
export function edgeColours(px: Uint8ClampedArray, ramp: Float32Array, w: number, h: number, radius: number): { fg: Float32Array; bg: Float32Array } {
  const n = w * h
  const sideOf = (wantIn: boolean) => {
    const sum = new Float32Array(n * 4)
    for (let i = 0; i < n; i++) {
      // Off the photo (past its edge): not a colour of either side.
      if (px[i * 4 + 3] < 128) continue
      // Counted by how surely it is on that side: a part thinner than the
      // band (a mast) has no cell solidly inside, and borrowed the colour of
      // the rest of the subject, far off and quite unlike it.
      const g = ramp[i]
      const w = wantIn ? smooth(0.5, 0.9, g) : smooth(0.5, 0.1, g)
      if (w <= 0) continue
      sum[i * 4] = (px[i * 4] / 255) * w
      sum[i * 4 + 1] = (px[i * 4 + 1] / 255) * w
      sum[i * 4 + 2] = (px[i * 4 + 2] / 255) * w
      sum[i * 4 + 3] = w
    }
    // Near first; where nothing of that side is near, from further away.
    const near = blur4(sum, w, h, Math.max(1, Math.round(radius)))
    const far = blur4(sum, w, h, Math.max(2, Math.round(radius * 4)))
    let tr = 0, tg = 0, tb = 0, tw = 0
    for (let i = 0; i < n; i++) {
      tr += sum[i * 4]
      tg += sum[i * 4 + 1]
      tb += sum[i * 4 + 2]
      tw += sum[i * 4 + 3]
    }
    const all = tw > 0 ? [tr / tw, tg / tw, tb / tw] : [0.5, 0.5, 0.5]
    const out = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const a = near[i * 4 + 3]
      const b = far[i * 4 + 3]
      for (let c = 0; c < 3; c++) {
        const v = a > 0.02 ? near[i * 4 + c] / a : b > 0.002 ? far[i * 4 + c] / b : all[c]
        out[i * 3 + c] = v
      }
    }
    return out
  }
  return { fg: sideOf(true), bg: sideOf(false) }
}

/** A cell's share of the subject by its colour against the inside and outside colours there. */
export function colourKey(r: number, g: number, b: number, fg: Float32Array, bg: Float32Array, i: number, ramp: number): number {
  return colourKeyOf(r, g, b, fg[i * 3], fg[i * 3 + 1], fg[i * 3 + 2], bg[i * 3], bg[i * 3 + 1], bg[i * 3 + 2], ramp)
}

/**
 * How much of the subject a colour is, from where it falls between the
 * inside colour (1) and the outside colour (0). Where the two are too alike
 * to tell apart, the mask's own edge (its ramp) decides instead.
 */
export function colourKeyOf(r: number, g: number, b: number, fr: number, fgr: number, fb: number, br: number, bgr: number, bb: number, ramp: number): number {
  const dr = fr - br
  const dg = fgr - bgr
  const db = fb - bb
  const dd = dr * dr + dg * dg + db * db
  let a = ((r - br) * dr + (g - bgr) * dg + (b - bb) * db) / Math.max(dd, 1e-5)
  a = a < 0 ? 0 : a > 1 ? 1 : a
  const sure = smooth(0.002, 0.012, dd)
  return smooth(0.35, 0.65, ramp) * (1 - sure) + smooth(0.2, 0.8, a) * sure
}

/** A box blur of four channels, three times over (near enough a Gaussian), `r` cells each way. */
function blur4(src: Float32Array, w: number, h: number, r: number): Float32Array {
  let a = src
  let b = new Float32Array(src.length)
  for (let pass = 0; pass < 3; pass++) {
    // Across.
    for (let y = 0; y < h; y++) {
      const row = y * w
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let x = -r; x <= r; x++) acc += a[(row + Math.min(w - 1, Math.max(0, x))) * 4 + c]
        for (let x = 0; x < w; x++) {
          b[(row + x) * 4 + c] = acc / (2 * r + 1)
          acc += a[(row + Math.min(w - 1, x + r + 1)) * 4 + c] - a[(row + Math.max(0, x - r)) * 4 + c]
        }
      }
    }
    // Down.
    const t = a === src ? new Float32Array(src.length) : a
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let acc = 0
        for (let y = -r; y <= r; y++) acc += b[(Math.min(h - 1, Math.max(0, y)) * w + x) * 4 + c]
        for (let y = 0; y < h; y++) {
          t[(y * w + x) * 4 + c] = acc / (2 * r + 1)
          acc += b[(Math.min(h - 1, y + r + 1) * w + x) * 4 + c] - b[(Math.max(0, y - r) * w + x) * 4 + c]
        }
      }
    }
    a = t
    b = b === src ? new Float32Array(src.length) : b
  }
  return a
}
