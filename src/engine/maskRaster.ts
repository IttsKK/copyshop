import type { MaskRaster, Rect } from './types'

/**
 * A subject mask kept as the selection itself, a grid of in and out, rather
 * than an outline: a subject in pieces, or with holes (a building behind a
 * tree), is exactly what was selected, with no lines joining the pieces.
 * Stored as run lengths (out first, then in, alternating) in base64 varints,
 * a few kilobytes for a photo-sized grid.
 */

/** The longest side a selection is kept at. */
export const RASTER_SIDE = 800

export function encodeRaster(grid: Uint8Array, w: number, h: number): string {
  const bytes: number[] = []
  const put = (n: number) => {
    while (n >= 128) {
      bytes.push((n & 127) | 128)
      n >>>= 7
    }
    bytes.push(n)
  }
  let value = 0
  let run = 0
  for (let i = 0; i < w * h; i++) {
    const v = grid[i] ? 1 : 0
    if (v === value) run++
    else {
      put(run)
      value = v
      run = 1
    }
  }
  put(run)
  let s = ''
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.slice(i, i + 8192))
  return btoa(s)
}

export function decodeRaster(r: Pick<MaskRaster, 'w' | 'h' | 'runs'>): Uint8Array {
  const out = new Uint8Array(r.w * r.h)
  const bin = atob(r.runs)
  let i = 0
  let at = 0
  let value = 0
  while (i < bin.length && at < out.length) {
    let n = 0
    let shift = 0
    let b: number
    do {
      b = bin.charCodeAt(i++)
      n |= (b & 127) << shift
      shift += 7
    } while (b & 128 && i < bin.length)
    if (value) out.fill(1, at, Math.min(out.length, at + n))
    at += n
    value = 1 - value
  }
  return out
}

/** The grid at most `side` long, each cell in if most of what it covers is. */
export function shrinkGrid(grid: Uint8Array, w: number, h: number, side = RASTER_SIDE): { grid: Uint8Array; w: number; h: number } {
  const k = Math.min(1, side / Math.max(w, h))
  if (k >= 1) return { grid, w, h }
  const W = Math.max(1, Math.round(w * k))
  const H = Math.max(1, Math.round(h * k))
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const y0 = Math.floor((y * h) / H)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / H))
    for (let x = 0; x < W; x++) {
      const x0 = Math.floor((x * w) / W)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / W))
      let on = 0
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) on += grid[yy * w + xx]
      out[y * W + x] = on * 2 >= (x1 - x0) * (y1 - y0) ? 1 : 0
    }
  }
  return { grid: out, w: W, h: H }
}

/** What the selection covers, in fractions of its own grid; null when empty. */
export function rasterBounds(grid: Uint8Array, w: number, h: number): Rect | null {
  let x0 = w
  let y0 = h
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (grid[y * w + x]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  if (x1 < 0) return null
  return { x: x0 / w, y: y0 / h, width: (x1 + 1 - x0) / w, height: (y1 + 1 - y0) / h }
}

/** A quick fingerprint of a raster, for telling one apart from another without comparing it whole. */
export function rasterKey(r: MaskRaster): string {
  let h = 2166136261
  const all = `${r.runs}|${r.paintIn ?? ''}|${r.paintSure ?? ''}|${r.paintOut ?? ''}`
  for (let i = 0; i < all.length; i++) h = Math.imul(h ^ all.charCodeAt(i), 16777619)
  return `${r.w}x${r.h}:${all.length}:${(h >>> 0).toString(36)}:${r.x},${r.y},${r.width},${r.height}`
}

/**
 * A selection made into points: the edge of its largest piece, followed
 * round and cut down to the points that hold its shape, as an outline mask
 * drawn by hand has. In the fractions the raster's own x, y, width and
 * height are in (the frame masks are kept in). What was painted in counts as
 * in, what was painted out as out. Holes, and pieces apart from the largest,
 * cannot be one outline: `pieces` says how many were left out. Null when
 * nothing is selected.
 */
export function rasterToPoints(r: MaskRaster, maxPoints = 80): { points: { x: number; y: number }[]; pieces: number; holes: boolean } | null {
  const { w, h } = r
  const grid = decodeRaster(r)
  const layer = (runs: string | undefined) => (runs ? decodeRaster({ w, h, runs }) : null)
  const paintIn = layer(r.paintIn)
  const paintSure = layer(r.paintSure)
  const paintOut = layer(r.paintOut)
  for (let i = 0; i < grid.length; i++) {
    if (paintIn?.[i] || paintSure?.[i]) grid[i] = 1
    if (paintOut?.[i]) grid[i] = 0
  }
  // The pieces (side by side counts as joined, corner to corner does not).
  const piece = new Int32Array(w * h).fill(-1)
  const sizes: number[] = []
  const stack: number[] = []
  for (let s = 0; s < grid.length; s++) {
    if (!grid[s] || piece[s] >= 0) continue
    const id = sizes.length
    let n = 0
    piece[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      n++
      const x = i % w
      const y = (i - x) / w
      if (x > 0 && grid[i - 1] && piece[i - 1] < 0) (piece[i - 1] = id), stack.push(i - 1)
      if (x < w - 1 && grid[i + 1] && piece[i + 1] < 0) (piece[i + 1] = id), stack.push(i + 1)
      if (y > 0 && grid[i - w] && piece[i - w] < 0) (piece[i - w] = id), stack.push(i - w)
      if (y < h - 1 && grid[i + w] && piece[i + w] < 0) (piece[i + w] = id), stack.push(i + w)
    }
    sizes.push(n)
  }
  if (!sizes.length) return null
  const keep = sizes.indexOf(Math.max(...sizes))
  // Specks don't count as pieces left out.
  const pieces = sizes.filter((n, id) => id !== keep && n >= Math.max(4, sizes[keep] * 0.01)).length
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && piece[y * w + x] === keep
  // Its edge, cell corner to cell corner, the piece always on the right
  // (y down), from the top-left corner of its first cell.
  const first = piece.indexOf(keep)
  const sx = first % w
  const sy = (first - sx) / w
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const // east, south, west, north
  // The cells ahead on the right and on the left of a corner, going each way.
  const ahead = (x: number, y: number, d: number): [boolean, boolean] =>
    d === 0 ? [inside(x, y), inside(x, y - 1)] : d === 1 ? [inside(x - 1, y), inside(x, y)] : d === 2 ? [inside(x - 1, y - 1), inside(x - 1, y)] : [inside(x, y - 1), inside(x - 1, y - 1)]
  const corners: { x: number; y: number }[] = []
  let x = sx
  let y = sy
  let d = 0
  for (let guard = 0; guard < 8 * (w + 1) * (h + 1); guard++) {
    const [right, left] = ahead(x, y, d)
    const turn = !right ? (d + 1) % 4 : left ? (d + 3) % 4 : d
    if (turn !== d || !corners.length) corners.push({ x, y })
    d = turn
    x += DIRS[d][0]
    y += DIRS[d][1]
    if (x === sx && y === sy) break
  }
  // Holes: cells out that the piece closes round (out cells not reached from the edge).
  let holes = false
  {
    const seen = new Uint8Array(w * h)
    const q: number[] = []
    for (let i = 0; i < w; i++) q.push(i, (h - 1) * w + i)
    for (let j = 0; j < h; j++) q.push(j * w, j * w + w - 1)
    while (q.length) {
      const i = q.pop()!
      if (seen[i] || piece[i] === keep) continue
      seen[i] = 1
      const cx = i % w
      if (cx > 0) q.push(i - 1)
      if (cx < w - 1) q.push(i + 1)
      if (i >= w) q.push(i - w)
      if (i < w * (h - 1)) q.push(i + w)
    }
    for (let i = 0; i < w * h && !holes; i++) if (!seen[i] && piece[i] !== keep) holes = true
  }
  // Cut down: the stair steps of the cells smoothed away, then fewer points
  // until there are few enough to move by hand.
  // Points almost on top of each other (a small kink kept twice) are one
  // fiddly handle to drag: no two closer than about 1% of the selection's side.
  const gap = Math.max(w, h) * 0.012
  const thin = (pts: { x: number; y: number }[]) => {
    const out: { x: number; y: number }[] = []
    for (const p of pts) if (!out.length || Math.hypot(p.x - out[out.length - 1].x, p.y - out[out.length - 1].y) >= gap) out.push(p)
    // The last back round to the first.
    while (out.length > 3 && Math.hypot(out[out.length - 1].x - out[0].x, out[out.length - 1].y - out[0].y) < gap) out.pop()
    return out.length >= 3 ? out : pts
  }
  let tolerance = 1
  let points = thin(simplifyClosed(corners, tolerance))
  while (points.length > maxPoints && tolerance < Math.max(w, h)) points = thin(simplifyClosed(corners, (tolerance *= 1.4)))
  return {
    points: points.map((p) => ({ x: r.x + (p.x / w) * r.width, y: r.y + (p.y / h) * r.height })),
    pieces,
    holes,
  }
}

/** A closed outline with the points that stray less than `tolerance` from the line past them taken out (Douglas-Peucker). */
function simplifyClosed(pts: { x: number; y: number }[], tolerance: number): { x: number; y: number }[] {
  if (pts.length <= 4) return pts
  // Split at the point furthest from the first, and simplify each half as an open line.
  let far = 0
  let best = -1
  for (let i = 1; i < pts.length; i++) {
    const dd = (pts[i].x - pts[0].x) ** 2 + (pts[i].y - pts[0].y) ** 2
    if (dd > best) (best = dd), (far = i)
  }
  const open = (a: { x: number; y: number }[]): { x: number; y: number }[] => {
    const keep = new Uint8Array(a.length)
    keep[0] = keep[a.length - 1] = 1
    const span: [number, number][] = [[0, a.length - 1]]
    while (span.length) {
      const [i, j] = span.pop()!
      const ax = a[i].x
      const ay = a[i].y
      const dx = a[j].x - ax
      const dy = a[j].y - ay
      const len = Math.hypot(dx, dy) || 1
      let worst = -1
      let at = -1
      for (let k = i + 1; k < j; k++) {
        const dist = Math.abs((a[k].x - ax) * dy - (a[k].y - ay) * dx) / len
        if (dist > worst) (worst = dist), (at = k)
      }
      if (at >= 0 && worst > tolerance) {
        keep[at] = 1
        span.push([i, at], [at, j])
      }
    }
    return a.filter((_, k) => keep[k])
  }
  const one = open(pts.slice(0, far + 1))
  const two = open([...pts.slice(far), pts[0]])
  return [...one, ...two.slice(1, -1)]
}
