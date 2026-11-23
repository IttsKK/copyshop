/**
 * A selection (a grid of in/out) as a mask outline: the one closed list of
 * points masks are made of, filled even-odd. Each separate piece and each
 * hole is a ring; the rings are joined by thin bridges that go out and come
 * back the same way, so they add nothing to the fill. Specks and pinholes
 * are cleaned away first, and the rings are simplified until the whole
 * outline fits in `maxPoints`.
 */

type Point = { x: number; y: number }

/** Pieces (and holes) smaller than this share of the photo are dropped. */
const SPECK = 0.0004
/**
 * Notches narrower than twice this (share of the short side) are filled:
 * the model now and then leaves a bite out of an edge — a lit rim, a ledge.
 */
const CLOSE = 0.006
/**
 * Then the edge is taken out this far (share of the short side), so the
 * subject's own soft edge pixels are inside it. Left outside, they are what
 * a streak beside the subject borrows its colour from: dark bars up the sky.
 */
const SPREAD = 0.003

/** Distance (in cells, chamfer 3-4, near enough round) from each cell to the nearest cell set to `to`. */
export function distanceTo(grid: Uint8Array, w: number, h: number, to: number): Float32Array {
  const INF = 1e9
  const d = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) d[i] = grid[i] === to ? 0 : INF
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      let v = d[i]
      if (x > 0) v = Math.min(v, d[i - 1] + 3)
      if (y > 0) {
        v = Math.min(v, d[i - w] + 3)
        if (x > 0) v = Math.min(v, d[i - w - 1] + 4)
        if (x < w - 1) v = Math.min(v, d[i - w + 1] + 4)
      }
      d[i] = v
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x
      let v = d[i]
      if (x < w - 1) v = Math.min(v, d[i + 1] + 3)
      if (y < h - 1) {
        v = Math.min(v, d[i + w] + 3)
        if (x < w - 1) v = Math.min(v, d[i + w + 1] + 4)
        if (x > 0) v = Math.min(v, d[i + w - 1] + 4)
      }
      d[i] = v
    }
  for (let i = 0; i < w * h; i++) d[i] /= 3
  return d
}

/** Takes the edge out `r` cells (r > 0) or in (r < 0). */
function spread(grid: Uint8Array, w: number, h: number, r: number) {
  if (r > 0) {
    const d = distanceTo(grid, w, h, 1)
    for (let i = 0; i < w * h; i++) grid[i] = d[i] <= r ? 1 : 0
  } else if (r < 0) {
    const d = distanceTo(grid, w, h, 0)
    for (let i = 0; i < w * h; i++) grid[i] = d[i] > -r ? 1 : 0
  }
}

/** Clears pieces of `value` smaller than `min` cells (4-connected), turning them to the other value. */
function clearSmall(grid: Uint8Array, w: number, h: number, value: number, min: number, keepEdge: boolean) {
  // Typed arrays and no array per cell: a selection is millions of cells, and the garbage of a
  // small array for each was a few hundred MB at once, enough to end the page on a phone.
  const seen = new Uint8Array(w * h)
  const stack = new Int32Array(w * h)
  const cells = new Int32Array(w * h)
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || grid[start] !== value) continue
    let top = 0
    let count = 0
    stack[top++] = start
    seen[start] = 1
    let edge = false
    while (top) {
      const c = stack[--top]
      cells[count++] = c
      const x = c % w
      const y = (c / w) | 0
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true
      if (x > 0 && !seen[c - 1] && grid[c - 1] === value) (seen[c - 1] = 1), (stack[top++] = c - 1)
      if (x < w - 1 && !seen[c + 1] && grid[c + 1] === value) (seen[c + 1] = 1), (stack[top++] = c + 1)
      if (y > 0 && !seen[c - w] && grid[c - w] === value) (seen[c - w] = 1), (stack[top++] = c - w)
      if (y < h - 1 && !seen[c + w] && grid[c + w] === value) (seen[c + w] = 1), (stack[top++] = c + w)
    }
    if (count < min && !(keepEdge && edge)) for (let i = 0; i < count; i++) grid[cells[i]] = 1 - value
  }
}

/** The edges between in and out, as closed loops (marching squares), in cell units. */
function contours(grid: Uint8Array, w: number, h: number): Point[][] {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : grid[y * w + x])
  // Edge midpoints, doubled to stay whole: (2x+1, 2y) on a row, (2x, 2y+1) on a column.
  const W2 = 2 * w + 4
  const key = (x2: number, y2: number) => (y2 + 2) * W2 + (x2 + 2)
  const links = new Map<number, number[]>()
  const pos = new Map<number, Point>()
  const join = (a: [number, number], b: [number, number]) => {
    const ka = key(a[0], a[1])
    const kb = key(b[0], b[1])
    pos.set(ka, { x: a[0] / 2, y: a[1] / 2 })
    pos.set(kb, { x: b[0] / 2, y: b[1] / 2 })
    ;(links.get(ka) ?? links.set(ka, []).get(ka)!).push(kb)
    ;(links.get(kb) ?? links.set(kb, []).get(kb)!).push(ka)
  }
  for (let j = -1; j < h; j++) {
    for (let i = -1; i < w; i++) {
      const code = at(i, j) * 8 + at(i + 1, j) * 4 + at(i + 1, j + 1) * 2 + at(i, j + 1)
      if (code === 0 || code === 15) continue
      const T: [number, number] = [2 * i + 1, 2 * j]
      const B: [number, number] = [2 * i + 1, 2 * j + 2]
      const L: [number, number] = [2 * i, 2 * j + 1]
      const R: [number, number] = [2 * i + 2, 2 * j + 1]
      switch (code) {
        case 1: join(L, B); break
        case 2: join(B, R); break
        case 3: join(L, R); break
        case 4: join(T, R); break
        case 5: join(T, R); join(L, B); break
        case 6: join(T, B); break
        case 7: join(T, L); break
        case 8: join(T, L); break
        case 9: join(T, B); break
        case 10: join(T, L); join(B, R); break
        case 11: join(T, R); break
        case 12: join(L, R); break
        case 13: join(R, B); break
        case 14: join(L, B); break
      }
    }
  }
  const done = new Set<number>()
  const loops: Point[][] = []
  for (const start of links.keys()) {
    if (done.has(start)) continue
    const loop: Point[] = []
    let prev = -1
    let cur = start
    while (!done.has(cur)) {
      done.add(cur)
      loop.push(pos.get(cur)!)
      const [a, b] = links.get(cur)!
      const next = a !== prev && !done.has(a) ? a : b !== prev && !done.has(b) ? b : -1
      prev = cur
      if (next < 0) break
      cur = next
    }
    if (loop.length >= 3) loops.push(loop)
  }
  return loops
}

/** Douglas–Peucker on an open run of points. */
function simplifyRun(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts.slice()
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a].x
    const ay = pts[a].y
    const dx = pts[b].x - ax
    const dy = pts[b].y - ay
    const len = Math.hypot(dx, dy) || 1e-9
    let far = -1
    let farD = tol
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].x - ax) * dy - (pts[i].y - ay) * dx) / len
      if (d > farD) {
        farD = d
        far = i
      }
    }
    if (far >= 0) {
      keep[far] = 1
      stack.push([a, far], [far, b])
    }
  }
  return pts.filter((_, i) => keep[i])
}

/** A closed loop simplified: split at its two most distant points, each half on its own. */
function simplifyLoop(loop: Point[], tol: number): Point[] {
  let far = 0
  let farD = -1
  for (let i = 1; i < loop.length; i++) {
    const d = (loop[i].x - loop[0].x) ** 2 + (loop[i].y - loop[0].y) ** 2
    if (d > farD) {
      farD = d
      far = i
    }
  }
  const a = simplifyRun(loop.slice(0, far + 1), tol)
  const b = simplifyRun([...loop.slice(far), loop[0]], tol)
  return [...a, ...b.slice(1, -1)]
}

const loopArea = (loop: Point[]) => {
  let s = 0
  for (let i = 0; i < loop.length; i++) {
    const p = loop[i]
    const q = loop[(i + 1) % loop.length]
    s += p.x * q.y - q.x * p.y
  }
  return Math.abs(s) / 2
}

/**
 * The selection as one outline, in fractions of the selection's grid (the
 * photo), or null when there is nothing in it.
 */
/**
 * A selection tidied: specks and pinholes gone, bites out of the edge
 * filled, and the edge taken out a little so the subject's own soft edge
 * pixels are inside it. 1 inside, 0 out.
 */
export function cleanSelection(mask: Uint8Array, w: number, h: number, grow = true): Uint8Array {
  const grid = Uint8Array.from(mask, (v) => (v ? 1 : 0))
  const min = Math.max(12, Math.round(w * h * SPECK))
  clearSmall(grid, w, h, 1, min, false)
  // Pinholes inside it, but not the open background round it.
  clearSmall(grid, w, h, 0, min, true)
  // Bites out of the edge filled (out, then back in), then the edge taken out a little.
  const short = Math.min(w, h)
  const close = Math.max(2, CLOSE * short)
  spread(grid, w, h, close)
  spread(grid, w, h, -close)
  if (grow) spread(grid, w, h, Math.max(1.5, SPREAD * short))
  return grid
}

/**
 * A subject's edge taken in `cells` (a selection already cleaned), then
 * tidied again without growing it back: specks the thinning leaves behind
 * are dropped. 1 inside.
 */
export function insetSelection(mask: Uint8Array, w: number, h: number, cells: number): Uint8Array {
  const grid = Uint8Array.from(mask, (v) => (v ? 1 : 0))
  if (cells > 0) spread(grid, w, h, -cells)
  return cleanSelection(grid, w, h, false)
}

export function traceSelection(mask: Uint8Array, w: number, h: number, maxPoints: number, clean = true): Point[] | null {
  const grid = clean ? cleanSelection(mask, w, h) : mask
  const min = Math.max(12, Math.round(w * h * SPECK))
  let loops = contours(grid, w, h).filter((l) => loopArea(l) >= min / 2)
  if (!loops.length) return null
  loops.sort((a, b) => loopArea(b) - loopArea(a))
  // Under a cell: a staircase of cells reads as a ragged edge and costs points.
  let tol = 0.9
  for (let tries = 0; tries < 30; tries++) {
    const simple = loops.map((l) => simplifyLoop(l, tol)).filter((l) => l.length >= 3)
    // Each ring after the first costs its start again plus a step back along the bridge.
    const total = simple.reduce((n, l) => n + l.length, 0) + Math.max(0, simple.length - 1) * 2
    if (total <= maxPoints || tol > Math.max(w, h)) {
      // The first ring closed on itself before the bridge leaves it.
      const out: Point[] = simple.length > 1 ? [...simple[0], simple[0][0]] : [...simple[0]]
      const starts: Point[] = []
      for (const ring of simple.slice(1)) {
        out.push(...ring, ring[0])
        starts.push(ring[0])
      }
      // Back along the bridges, so each is crossed twice and fills nothing.
      for (let i = starts.length - 2; i >= 0; i--) out.push(starts[i])
      const pts = out.slice(0, maxPoints)
      return pts.map((p) => ({ x: (p.x + 0.5) / w, y: (p.y + 0.5) / h }))
    }
    tol *= 1.4
    // Very many rings: let the smallest go rather than flatten the main ones.
    if (tries > 8 && loops.length > 1) loops = loops.slice(0, Math.max(1, Math.ceil(loops.length * 0.7)))
  }
  return null
}
