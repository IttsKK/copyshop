import { gapArea } from './collage'
import { DEFAULT_COLLAGE_PIECE, MAX_COLLAGE_PIECES, type ArrangeCell, type CollageArrange, type CollagePiece, type Size } from './types'

/**
 * Arrange (see CollageArrange): what each image is like, which cells touch,
 * which image goes in which cell, and the pieces that makes.
 */

/** What Arrange knows of an image: where its sky is, and its colour there. */
export interface ImageInfo {
  id: string
  width: number
  height: number
  /** The part of the image that is sky, fractions: u0, v0, u1, v1. Ground, trees and black frames are left out. */
  window: [number, number, number, number]
  /**
   * Where the image may show, on a small grid over it (w by h, row by row):
   * 1 its sky, 0 what is left out (ground, trees, frames). A placement is
   * kept to it, wherever its sky is, not only in the window.
   */
  usable?: { w: number; h: number; data: Uint8Array }
  /** Mean colour of that part, linear light. */
  lin: [number, number, number]
  /** Its luminance, linear. */
  lum: number
  /** OKLab of the mean colour. */
  lab: [number, number, number]
}

const lin = (v: number) => {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function oklab([r, g, b]: [number, number, number]): [number, number, number] {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

const infos = new Map<string, ImageInfo>()

/**
 * An image read for Arrange, once per image. Its sky: the largest clear
 * rectangle once dark silhouettes reaching in from the bottom or the sides
 * (trees, the ground, a pole, water at dusk) and black frame edges are left
 * out, a higher one preferred over a lower one of the same size.
 */
export function imageInfo(id: string, bitmap: ImageBitmap, keepOut?: { w: number; h: number; data: Uint8Array; at: number }): ImageInfo {
  const key = `${id}:${keepOut?.at ?? 0}`
  const hit = infos.get(key)
  if (hit) return hit
  const W = 96
  const H = Math.max(8, Math.round((W * bitmap.height) / bitmap.width))
  const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(W, H) : Object.assign(document.createElement('canvas'), { width: W, height: H })
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, W, H)
  const px = ctx.getImageData(0, 0, W, H).data
  const n = W * H
  const L = new Float32Array(n)
  for (let i = 0; i < n; i++) L[i] = 0.2126 * lin(px[i * 4]) + 0.7152 * lin(px[i * 4 + 1]) + 0.0722 * lin(px[i * 4 + 2])
  const blur = (src: Float32Array, r: number) => {
    const out = new Float32Array(n)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        let s = 0
        let c = 0
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            const yy = Math.min(H - 1, Math.max(0, y + dy))
            const xx = Math.min(W - 1, Math.max(0, x + dx))
            s += src[yy * W + xx]
            c++
          }
        out[y * W + x] = s / c
      }
    return out
  }
  // The sky's brightness: the brighter part of the top half.
  const top = Array.from(L.subarray(0, W * Math.floor(H / 2))).sort((a, b) => a - b)
  const ref = top[Math.floor(top.length * 0.8)] ?? 1
  const darkAt = Math.min(0.3 * ref, 0.035)
  const darkRaw = new Float32Array(n)
  for (let i = 0; i < n; i++) darkRaw[i] = L[i] < darkAt ? 1 : 0
  const darkSm = blur(darkRaw, 1)
  const dark = (i: number) => darkSm[i] > 0.5
  // Dark, and joined to the bottom edge or to a side below its top 30%.
  const bad = new Float32Array(n)
  const stack: number[] = []
  const seedAt = (i: number) => {
    if (dark(i) && !bad[i]) {
      bad[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < W; x++) seedAt((H - 1) * W + x)
  for (let y = Math.floor(H * 0.3); y < H; y++) {
    seedAt(y * W)
    seedAt(y * W + W - 1)
  }
  // A black frame along the top edge too.
  for (let x = 0; x < W; x++) if (L[x] < 0.004) seedAt(x)
  while (stack.length) {
    const i = stack.pop()!
    const x = i % W
    if (x > 0) seedAt(i - 1)
    if (x < W - 1) seedAt(i + 1)
    if (i >= W) seedAt(i - W)
    if (i + W < n) seedAt(i + W)
  }
  // A little margin round what is left out.
  const near = blur(bad, 2)
  // The best clear rectangle: largest, higher preferred (histogram method).
  const h = new Int32Array(W)
  let best = { score: -1, x0: 0, y0: 0, x1: W, y1: H }
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) h[x] = near[y * W + x] > 0.05 ? 0 : h[x] + 1
    const st: [number, number][] = []
    for (let x = 0; x <= W; x++) {
      const cur = x < W ? h[x] : 0
      let start = x
      while (st.length && st[st.length - 1][1] >= cur) {
        const [s0, hh] = st.pop()!
        const area = hh * (x - s0)
        const cy = (y + 1 - hh / 2) / H
        const score = area * (1 - 0.7 * cy)
        if (hh > 0 && score > best.score) best = { score, x0: s0, y0: y + 1 - hh, x1: x, y1: y + 1 }
        start = s0
      }
      st.push([start, cur])
    }
  }
  // Nothing clear (a dark image): all of it.
  if (best.score <= 0 || (best.x1 - best.x0) * (best.y1 - best.y0) < n * 0.04) best = { score: 0, x0: 0, y0: 0, x1: W, y1: H }
  const window: [number, number, number, number] = [best.x0 / W, best.y0 / H, best.x1 / W, best.y1 / H]
  let r = 0
  let g = 0
  let b = 0
  let k = 0
  for (let y = best.y0; y < best.y1; y++)
    for (let x = best.x0; x < best.x1; x++) {
      const i = (y * W + x) * 4
      r += lin(px[i])
      g += lin(px[i + 1])
      b += lin(px[i + 2])
      k++
    }
  const mean: [number, number, number] = [r / k, g / k, b / k]
  // Where it may show: all but what is left out, and in each column nothing
  // below the first of it (water or a beach under a ridge or a treeline is
  // not sky, however bright). All of it, for an image with no clear sky.
  const usable = new Uint8Array(n)
  const clear = best.score > 0
  for (let x = 0; x < W; x++) {
    let below = false
    for (let y = 0; y < H; y++) {
      const i = y * W + x
      if (near[i] > 0.05) below = true
      usable[i] = !clear || !below ? 1 : 0
    }
  }
  // Parts marked not to use: any cell with a mark in it.
  if (keepOut) {
    for (let y = 0; y < keepOut.h; y++)
      for (let x = 0; x < keepOut.w; x++)
        if (keepOut.data[y * keepOut.w + x]) usable[Math.min(H - 1, Math.floor((y * H) / keepOut.h)) * W + Math.min(W - 1, Math.floor((x * W) / keepOut.w))] = 0
  }
  const info: ImageInfo = {
    id,
    width: bitmap.width,
    height: bitmap.height,
    window,
    usable: { w: W, h: H, data: usable },
    lin: mean,
    lum: 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2],
    lab: oklab(mean),
  }
  infos.set(key, info)
  return info
}

/**
 * A gap to fill (or a region of several, one image across them): where it
 * was clicked, its extent and middle, photo fractions.
 */
export interface Cell {
  seed: { x: number; y: number }
  /** A region of several gaps: a click in each. */
  seeds?: { x: number; y: number }[]
  /** Points spread over its gaps themselves, photo fractions: what a placement must cover with sky. */
  points?: { x: number; y: number }[]
  area: [number, number, number, number]
  cx: number
  cy: number
  /** Its size, working pixels. */
  size: number
}

/** The cells' gaps found with the settings a new piece has. */
const cellPiece = (seed: { x: number; y: number }): CollagePiece => ({
  ...DEFAULT_COLLAGE_PIECE,
  id: `cell:${seed.x.toFixed(5)},${seed.y.toFixed(5)}`,
  image: '',
  seeds: [seed],
  x: 0.5,
  y: 0.5,
  scale: 1,
})

/** The gap a click falls in (see gapArea), or null if it falls in none (on a wire, say). */
export const cellArea = (seed: number | undefined, at: { x: number; y: number }) => gapArea(seed, cellPiece(at))

type Gap = NonNullable<ReturnType<typeof cellArea>>
const gapHas = (g: Gap, x: number, y: number) => {
  const gx = Math.round(x * (g.grid.w - 1))
  const gy = Math.round(y * (g.grid.h - 1))
  const [x0, y0, x1, y1] = g.box
  return gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1 && g.region[(gy - y0) * (x1 - x0 + 1) + gx - x0] === 1
}

/** Which of the cells (as clicked) a point is in, or -1. */
export function cellAt(seed: number | undefined, clicks: { x: number; y: number }[], x: number, y: number): number {
  for (let k = 0; k < clicks.length; k++) {
    const g = cellArea(seed, clicks[k])
    if (g && gapHas(g, x, y)) return k
  }
  return -1
}

/**
 * The cells, each gap once (a second click in a gap already a cell is
 * dropped), and how much each pair touches: across a wire, how much of
 * their edges lie within a wire's width of each other, 0..1.
 */
export function cellsOf(seed: number | undefined, clicks: { x: number; y: number }[]): { cells: Cell[]; touch: Map<number, number>[]; from: number[] } {
  const cells: Cell[] = []
  const gaps: Gap[] = []
  /** Which click each cell is. */
  const from: number[] = []
  clicks.forEach((at, k) => {
    if (gaps.some((g) => gapHas(g, at.x, at.y))) return
    const g = cellArea(seed, at)
    if (!g) return
    gaps.push(g)
    from.push(k)
    cells.push({ seed: at, area: g.area, cx: g.cx, cy: g.cy, size: g.pixels })
  })
  const touch = cells.map(() => new Map<number, number>())
  if (!gaps.length) return { cells, touch, from }
  const grid = gaps[0].grid
  // Every cell's pixels labelled on the working grid.
  const label = new Int16Array(grid.w * grid.h).fill(-1)
  gaps.forEach((g, k) => {
    const [x0, y0, x1, y1] = g.box
    const bw = x1 - x0 + 1
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) if (g.region[(y - y0) * bw + x - x0]) label[y * grid.w + x] = k
  })
  // From each edge pixel, look a wire's width out in eight directions.
  const reach = Math.max(4, Math.round(Math.max(grid.w, grid.h) / 90))
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]
  const edges = cells.map(() => 0)
  gaps.forEach((g, k) => {
    const [x0, y0, x1, y1] = g.box
    for (let gy = Math.max(1, y0); gy <= Math.min(grid.h - 2, y1); gy++)
      for (let gx = Math.max(1, x0); gx <= Math.min(grid.w - 2, x1); gx++) {
        const i = gy * grid.w + gx
        if (label[i] !== k) continue
        if (label[i + 1] === k && label[i - 1] === k && label[i + grid.w] === k && label[i - grid.w] === k) continue
        edges[k]++
        const seen = new Set<number>()
        for (const [dx, dy] of dirs)
          for (let r = 2; r <= reach; r++) {
            const qx = Math.round(gx + dx * r)
            const qy = Math.round(gy + dy * r)
            if (qx < 0 || qy < 0 || qx >= grid.w || qy >= grid.h) break
            const l = label[qy * grid.w + qx]
            if (l === k) break
            if (l >= 0) {
              seen.add(l)
              break
            }
          }
        for (const l of seen) touch[k].set(l, (touch[k].get(l) ?? 0) + 1)
      }
  })
  // Symmetric, as a share of the shorter of the two edges.
  const out = cells.map(() => new Map<number, number>())
  for (let k = 0; k < cells.length; k++)
    for (const [l, c] of touch[k]) {
      const both = Math.max(c, touch[l].get(k) ?? 0)
      const share = Math.min(1, both / Math.max(1, Math.min(edges[k], edges[l]) * 0.25))
      if (share < 0.05) continue
      out[k].set(l, share)
      out[l].set(k, share)
    }
  return { cells, touch: out, from }
}

/**
 * The cells as regions: the gaps of one group as one region, its area the
 * whole of theirs, an image laid across them all; each other gap a region
 * of its own. Regions touch where their gaps do. `pinned`: the image each
 * region is set to have, if one is.
 */
export function regionsOf(
  clicks: ArrangeCell[],
  cells: Cell[],
  touch: Map<number, number>[],
  from: number[],
): { regions: Cell[]; touch: Map<number, number>[]; pinned: (string | undefined)[] } {
  const keyOf = (i: number) => clicks[from[i]].group ?? -(from[i] + 1)
  const order: number[] = []
  const members = new Map<number, number[]>()
  cells.forEach((_, i) => {
    const k = keyOf(i)
    if (!members.has(k)) {
      members.set(k, [])
      order.push(k)
    }
    members.get(k)!.push(i)
  })
  const at = new Map<number, number>()
  const regions: Cell[] = order.map((k, r) => {
    const m = members.get(k)!
    m.forEach((i) => at.set(i, r))
    const size = m.reduce((t, i) => t + cells[i].size, 0)
    return {
      seed: cells[m[0]].seed,
      seeds: m.map((i) => cells[i].seed),
      area: [
        Math.min(...m.map((i) => cells[i].area[0])),
        Math.min(...m.map((i) => cells[i].area[1])),
        Math.max(...m.map((i) => cells[i].area[2])),
        Math.max(...m.map((i) => cells[i].area[3])),
      ],
      cx: m.reduce((t, i) => t + cells[i].cx * cells[i].size, 0) / Math.max(1, size),
      cy: m.reduce((t, i) => t + cells[i].cy * cells[i].size, 0) / Math.max(1, size),
      size,
    }
  })
  const near = regions.map(() => new Map<number, number>())
  touch.forEach((t, i) =>
    t.forEach((w, j) => {
      const a = at.get(i)!
      const b = at.get(j)!
      if (a === b) return
      near[a].set(b, Math.max(near[a].get(b) ?? 0, w))
    }),
  )
  const pinned = order.map((k) => members.get(k)!.map((i) => clicks[from[i]].image).find((x) => !!x))
  return { regions, touch: near, pinned }
}

function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Ranks scaled to 0..1, ties sharing their middle rank. */
function ranks(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0])
  const out = new Array<number>(values.length)
  let k = 0
  while (k < order.length) {
    let j = k
    while (j + 1 < order.length && order[j + 1][0] === order[k][0]) j++
    const r = (k + j) / 2
    for (let q = k; q <= j; q++) out[order[q][1]] = values.length > 1 ? r / (values.length - 1) : 0.5
    k = j + 1
  }
  return out
}

/** Where along the flow each cell is, 0..1. */
function flowOf(cells: Cell[], flow: CollageArrange['flow'], photo: Size): number[] {
  const mx = cells.reduce((a, c) => a + c.cx, 0) / Math.max(1, cells.length)
  const my = cells.reduce((a, c) => a + c.cy, 0) / Math.max(1, cells.length)
  const v = cells.map((c) => {
    switch (flow) {
      case 'down':
        return c.cy
      case 'up':
        return -c.cy
      case 'right':
        return c.cx
      case 'left':
        return -c.cx
      case 'out':
        return Math.hypot((c.cx - mx) * photo.width, (c.cy - my) * photo.height)
      case 'in':
        return -Math.hypot((c.cx - mx) * photo.width, (c.cy - my) * photo.height)
      default:
        return 0
    }
  })
  return ranks(v)
}

/** What an image is ordered by. */
function keyOf(info: ImageInfo, by: CollageArrange['by']): number {
  const [L, a, b] = info.lab
  if (by === 'tone') return L
  if (by === 'warmth') return 0.7 * b + 0.3 * a
  // Round the colour wheel from blue: blue, teal, green, yellow, orange, red, magenta.
  const h = Math.atan2(b, a)
  const blue = (264 * Math.PI) / 180
  return (((h - blue) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
}

/**
 * Which image goes in each cell: a balance of following the flow (images
 * ordered by tone, warmth or hue laid along it), using every image about
 * as often, touching cells alike or set apart, and no image twice side by
 * side unless they are to share it. Found by annealing from the plain
 * sequence, so a seed gives another good answer, not a random one.
 */
export function assign(
  cells: Cell[],
  touch: Map<number, number>[],
  images: ImageInfo[],
  s: CollageArrange,
  photo: Size,
  fixed: (number | undefined)[] = [],
  /** Only the first this many images are chosen from; the rest are only for regions set to them. */
  choosable = images.length,
): number[] {
  const n = cells.length
  const m = Math.max(1, Math.min(images.length, choosable))
  if (!n || !m) return []
  // Regions set to an image keep it; only the others are chosen.
  const free = cells.map((_, i) => i).filter((i) => fixed[i] === undefined)
  const p = flowOf(cells, s.flow, photo)
  const k = ranks(images.map((im) => keyOf(im, s.by)))
  const G = s.flow === 'none' ? 0 : 8 * s.follow * s.follow
  const fair = Math.max(1, cells.filter((_, i) => fixed[i] === undefined).length) / m
  // Colour differences, scaled by how far apart the images are on the whole.
  const dist = images.map((a) => images.map((b) => Math.hypot(a.lab[0] - b.lab[0], a.lab[1] - b.lab[1], a.lab[2] - b.lab[2])))
  const all = dist.flat().filter((d) => d > 0).sort((a, b) => a - b)
  const typical = all.length ? all[Math.floor(all.length / 2)] : 1
  const pairs: [number, number, number][] = []
  touch.forEach((t, i) => t.forEach((w, j) => i < j && pairs.push([i, j, w])))
  const cost = (a: number[]) => {
    let c = 0
    for (let i = 0; i < n; i++) c += G * (k[a[i]] - p[i]) ** 2
    const used = new Array<number>(m).fill(0)
    for (const j of a) if (j < m) used[j]++
    for (const u of used) c += (2 * (u - fair) ** 2) / Math.max(1, fair)
    for (const [i, j, w] of pairs) {
      if (a[i] === a[j]) c += w * (s.join ? -0.6 : 1.5)
      else c -= w * s.neighbours * 0.8 * Math.min(2, dist[a[i]][a[j]] / typical)
    }
    return c
  }
  // Start from the plain sequence: cells in flow order, images in key order.
  const byFlow = p.map((v, i) => [v, i] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const byKey = k.slice(0, m).map((v, j) => [v, j] as const).sort((x, y) => x[0] - y[0] || x[1] - y[1])
  const a = new Array<number>(n)
  byFlow.forEach(([, i], r) => {
    const q = m > n ? Math.round(((r + 0.5) * m) / n - 0.5) : Math.floor((r * m) / n)
    a[i] = fixed[i] ?? byKey[Math.min(m - 1, q)][1]
  })
  const rand = rng(s.seed * 7919 + 17)
  if (!free.length) return a
  // A shuffle starts from a different place.
  if (s.seed > 1) for (let t = 0; t < n; t++) a[free[Math.floor(rand() * free.length)]] = Math.floor(rand() * m)
  let cur = cost(a)
  let best = a.slice()
  let bestCost = cur
  const iters = 2500 * free.length
  for (let t = 0; t < iters; t++) {
    const temp = 1.2 * (1 - t / iters) + 0.01
    const i = free[Math.floor(rand() * free.length)]
    const swap = rand() < 0.5 && free.length > 1
    const j = swap ? free[Math.floor(rand() * free.length)] : Math.floor(rand() * m)
    const ai = a[i]
    const aj = swap ? a[j] : 0
    if (swap) {
      a[i] = aj
      a[j] = ai
    } else a[i] = j
    const next = cost(a)
    if (next <= cur || rand() < Math.exp((cur - next) / temp)) {
      cur = next
      if (cur < bestCost) {
        bestCost = cur
        best = a.slice()
      }
    } else if (swap) {
      a[j] = aj
      a[i] = ai
    } else a[i] = ai
  }
  return best
}

const lumOf = (c: [number, number, number]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]

/**
 * The pieces: one per cell, or per run of touching cells sharing an image
 * when they may (join). Each image on its sky, at the size asked or larger
 * to cover; repeats on another part of the image, some mirrored. Tone and
 * colour pulled together as asked.
 */
export function arrangePieces(
  cells: Cell[],
  touch: Map<number, number>[],
  images: ImageInfo[],
  a: number[],
  s: CollageArrange,
  photo: Size,
): CollagePiece[] {
  // Groups: cells that touch and share an image, when they may.
  const parent = cells.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  if (s.join) touch.forEach((t, i) => t.forEach((_, j) => a[i] === a[j] && (parent[find(i)] = find(j))))
  const groups = new Map<number, number[]>()
  cells.forEach((_, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  // The set's colour and brightness, by how much of the photo each image covers.
  let total = 0
  const mean: [number, number, number] = [0, 0, 0]
  let logLum = 0
  cells.forEach((c, i) => {
    const im = images[a[i]]
    total += c.size
    for (let q = 0; q < 3; q++) mean[q] += Math.log(Math.max(im.lin[q], 1e-4)) * c.size
    logLum += Math.log(Math.max(im.lum, 1e-4)) * c.size
  })
  const M = mean.map((v) => Math.exp(v / Math.max(1, total))) as [number, number, number]
  const Lbar = Math.exp(logLum / Math.max(1, total))
  const uses = new Map<number, number>()
  /** What each image already shows, in its own fractions: a repeat is placed to show another part of it. */
  const footprints = new Map<number, [number, number, number, number][]>()
  const out: CollagePiece[] = []
  // In flow order, so the pieces list reads as the sequence does.
  const ordered = [...groups.values()].sort((g, h) => cells[g[0]].cy - cells[h[0]].cy || cells[g[0]].cx - cells[h[0]].cx)
  for (const g of ordered.slice(0, MAX_COLLAGE_PIECES)) {
    const j = a[g[0]]
    const im = images[j]
    const x0 = Math.min(...g.map((i) => cells[i].area[0]))
    const y0 = Math.min(...g.map((i) => cells[i].area[1]))
    const x1 = Math.max(...g.map((i) => cells[i].area[2]))
    const y1 = Math.max(...g.map((i) => cells[i].area[3]))
    const use = uses.get(j) ?? 0
    uses.set(j, use + 1)
    // Its own draw, from where it is: a gap added elsewhere leaves it where it was.
    const own = rng(s.seed * 104729 + Math.round(cells[g[0]].seed.x * 9973) * 31 + Math.round(cells[g[0]].seed.y * 9967))
    const points = g.flatMap((i) => cells[i].points ?? areaPoints(cells[i].area))
    const shown = footprints.get(j) ?? []
    const at = placeImage(im, points, [x0, y0, x1, y1], s, photo, shown, own)
    footprints.set(j, [...shown, at.footprint])
    const { scale, cx, cy, flip } = at
    // Colour: toward the set's, its luminance kept.
    let tint: [number, number, number] | undefined
    if (s.harmony > 0) {
      const target = im.lin.map((v, q) => Math.exp((1 - s.harmony) * Math.log(Math.max(v, 1e-4)) + s.harmony * Math.log(M[q]))) as [number, number, number]
      const gain = target.map((v, q) => v / Math.max(im.lin[q], 1e-4)) as [number, number, number]
      const keep = im.lum / Math.max(1e-6, lumOf(im.lin.map((v, q) => v * gain[q]) as [number, number, number]))
      tint = gain.map((v) => Math.round(Math.min(2, Math.max(0.5, v * keep)) * 1000) / 1000) as [number, number, number]
    }
    // Brightness: toward the set's, for whatever of it is not matched to the photo.
    const brightness = Math.max(-2, Math.min(2, s.evenTone * (1 - s.match) * Math.log2(Lbar / Math.max(im.lum, 1e-4))))
    const first = cells[g[0]].seed
    out.push({
      ...DEFAULT_COLLAGE_PIECE,
      id: `piece_arr_${first.x.toFixed(5)}_${first.y.toFixed(5)}`,
      image: im.id,
      seeds: g.flatMap((i) => cells[i].seeds ?? [cells[i].seed]),
      x: cx / photo.width,
      y: cy / photo.height,
      scale,
      flip,
      match: s.match,
      brightness: Math.round(brightness * 100) / 100,
      ...(tint ? { tint } : {}),
    })
  }
  return out
}

/** Points over an area's rectangle, for a region with none of its own: a 5 by 5 grid. */
function areaPoints([x0, y0, x1, y1]: [number, number, number, number]): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (let j = 0; j < 5; j++) for (let i = 0; i < 5; i++) out.push({ x: x0 + ((x1 - x0) * (i + 0.5)) / 5, y: y0 + ((y1 - y0) * (j + 0.5)) / 5 })
  return out
}

/** How many placements are tried for each region, and how many of the best it chooses among. */
const TRIES = 90
const AMONG = 5

/**
 * Where an image goes over a region: many placements tried (where its
 * centre is, how big, flipped or not), each with the whole region's
 * points inside the image, and each scored. Showing anything the image
 * may not show there (its usable map) rules a placement out; past that it
 * is better for showing sky high in the image (surest to be sky), for
 * being near the size asked, and for showing a part of the image other
 * regions using it do not. One of the few best is taken, by the region's
 * own draw, so Shuffle gives another good one and never a bad one.
 */
export function placeImage(
  im: ImageInfo,
  points: { x: number; y: number }[],
  area: [number, number, number, number],
  s: CollageArrange,
  photo: Size,
  shown: [number, number, number, number][],
  rand: () => number,
): { scale: number; cx: number; cy: number; flip: boolean; footprint: [number, number, number, number] } {
  const [x0, y0, x1, y1] = area
  const aspect = im.height / im.width
  const bw = (x1 - x0) * photo.width
  const bh = (y1 - y0) * photo.height
  // Big enough for the image itself to cover the region, and at least the size asked.
  const cover = 1.02 * Math.max(bw / photo.width, bh / (photo.width * aspect))
  const least = Math.min(20, Math.max(s.size, cover))
  const map = im.usable
  const usableAt = (u: number, v: number) => {
    if (!map) return 1
    const x = Math.min(map.w - 1, Math.max(0, Math.floor(u * map.w)))
    const y = Math.min(map.h - 1, Math.max(0, Math.floor(v * map.h)))
    return map.data[y * map.w + x]
  }
  type Try = { scale: number; cx: number; cy: number; flip: boolean; bad: number; score: number; footprint: [number, number, number, number] }
  const tries: Try[] = []
  for (let t = 0; t < TRIES; t++) {
    // The first try is the plain one: the size asked, centred across, high in the image.
    const first = t === 0
    const scale = Math.min(20, least * (first ? 1 : 1 + 0.7 * rand() * rand()))
    const imw = scale * photo.width
    const imh = imw * aspect
    // The centre anywhere that keeps the whole region inside the image.
    const loX = x1 * photo.width - imw / 2
    const hiX = x0 * photo.width + imw / 2
    const loY = y1 * photo.height - imh / 2
    const hiY = y0 * photo.height + imh / 2
    const fx = first ? 0.5 : rand()
    const fy = first ? 0.85 : rand()
    const cx = loX <= hiX ? loX + (hiX - loX) * fx : (loX + hiX) / 2
    const cy = loY <= hiY ? loY + (hiY - loY) * fy : (loY + hiY) / 2
    const flip = s.vary && !first && rand() < 0.5
    let bad = 0
    let vSum = 0
    let fu0 = 1
    let fv0 = 1
    let fu1 = 0
    let fv1 = 0
    for (const p of points) {
      let u = (p.x * photo.width - (cx - imw / 2)) / imw
      const v = (p.y * photo.height - (cy - imh / 2)) / imh
      if (flip) u = 1 - u
      if (u < 0 || u > 1 || v < 0 || v > 1 || !usableAt(u, v)) bad++
      vSum += v
      fu0 = Math.min(fu0, u)
      fu1 = Math.max(fu1, u)
      fv0 = Math.min(fv0, v)
      fv1 = Math.max(fv1, v)
    }
    const n = Math.max(1, points.length)
    // Another region's part of the same image, overlapped: by how much of this one's.
    let overlap = 0
    for (const [a0, b0, a1, b1] of shown) {
      const w = Math.max(0, Math.min(fu1, a1) - Math.max(fu0, a0))
      const h = Math.max(0, Math.min(fv1, b1) - Math.max(fv0, b0))
      overlap = Math.max(overlap, (w * h) / Math.max(1e-6, (fu1 - fu0) * (fv1 - fv0)))
    }
    const score = -0.6 * (vSum / n) - 0.5 * Math.log(scale / least) - (s.vary ? 1.2 * overlap : 0)
    tries.push({ scale, cx, cy, flip, bad: bad / n, score, footprint: [fu0, fv0, fu1, fv1] })
  }
  // Those that show nothing they may not (allowing a stray point or two), best first.
  const fine = tries.filter((x) => x.bad <= 0.01)
  const pool = (fine.length ? fine : [...tries].sort((p, q) => p.bad - q.bad).slice(0, 1)).sort((p, q) => q.score - p.score)
  const pick = pool[Math.floor(rand() * Math.min(AMONG, pool.length))]
  return { scale: pick.scale, cx: pick.cx, cy: pick.cy, flip: pick.flip, footprint: pick.footprint }
}

/** Points spread over the gaps clicked (a few hundred at most, evenly), photo fractions. */
export function gapPoints(seed: number | undefined, seeds: { x: number; y: number }[]): { x: number; y: number }[] | undefined {
  const gaps = seeds.map((at) => cellArea(seed, at)).filter((g): g is Gap => !!g)
  if (!gaps.length) return undefined
  const pixels = gaps.reduce((t, g) => t + g.pixels, 0)
  const stride = Math.max(1, Math.ceil(Math.sqrt(pixels / 320)))
  const out: { x: number; y: number }[] = []
  for (const g of gaps) {
    const [x0, y0, x1, y1] = g.box
    const bw = x1 - x0 + 1
    for (let y = y0; y <= y1; y += stride)
      for (let x = x0; x <= x1; x += stride) if (g.region[(y - y0) * bw + x - x0]) out.push({ x: (x + 0.5) / g.grid.w, y: (y + 0.5) / g.grid.h })
  }
  return out.length ? out : undefined
}

/** Arranged pieces are known by their id, so running again replaces them. */
export const ARRANGED_ID = 'piece_arr_'

/**
 * The whole run: the cells, the images (as the library has them), the
 * assignment and the pieces. Null when there is nothing to arrange.
 */
export function arrangement(
  seed: number | undefined,
  photo: Size,
  a: CollageArrange,
  lookup: (id: string) => { id: string; bitmap: ImageBitmap; keepOut?: { w: number; h: number; data: Uint8Array; at: number } } | null,
): CollagePiece[] | null {
  // The images it may choose, and any a region is set to have.
  const ids = [...new Set([...a.images, ...a.cells.map((c) => c.image).filter((x): x is string => !!x)])]
  const pool = ids.map(lookup).filter((x): x is NonNullable<ReturnType<typeof lookup>> => !!x)
  if (!pool.length || !a.cells.length) return null
  const images = pool.map((img) => imageInfo(img.id, img.bitmap, img.keepOut))
  const found = cellsOf(seed, a.cells)
  if (!found.cells.length) return null
  const { regions, touch, pinned } = regionsOf(a.cells, found.cells, found.touch, found.from)
  // Each region's own shape, as points over its gaps, for placing its image.
  for (const r of regions) r.points = gapPoints(seed, r.seeds ?? [r.seed])
  // Chosen from those it may use (all of them, if it may use none but the set ones).
  const choosable = images.filter((im) => a.images.includes(im.id))
  const pick = choosable.length ? choosable : images
  // A set image not among those it may choose: added after them, held to its regions only.
  const list = [...pick]
  const held = pinned.map((id) => {
    if (!id) return undefined
    let k = list.findIndex((im) => im.id === id)
    if (k < 0) {
      const im = images.find((x) => x.id === id)
      if (!im) return undefined
      list.push(im)
      k = list.length - 1
    }
    return k
  })
  return arrangePieces(regions, touch, list, assign(regions, touch, list, a, photo, held, pick.length), a, photo)
}
