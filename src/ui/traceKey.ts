import type { Point } from '../engine/leaks'
import type { Size } from '../engine/types'

/** What a tone key picks: pixels darker (or lighter) than a level, in brightness or in blue. */
export interface TraceKey {
  key: 'darker' | 'lighter'
  keyOn: 'brightness' | 'blue'
  /** 0..1, encoded, as the shader's key reads it. */
  keyLevel: number
}

/** The most samples across the traced area: past this it is read smaller. */
const MAX_GRID = 1600

/**
 * An outline traced to a key: inside the outline, the pixels the key picks;
 * of those, the largest connected patch, its holes filled; its edge followed
 * to within a fraction of a pixel (marching squares on the key's own values,
 * so the line sits where the key crosses its level, not on pixel steps); and
 * thinned to at most `points` points, keeping the corners.
 *
 * So a loose outline round the sign's black glyph becomes the glyph's own
 * outline, which stays exact when the shape is scaled up somewhere else.
 * Fractions of the photo in and out; null when the key picks nothing there.
 */
export function traceKeyOutline(photo: CanvasImageSource, size: Size, outline: Point[], k: TraceKey, points: number): Point[] | null {
  if (outline.length < 3) return null
  const W = size.width
  const H = size.height
  // The outline's box, a few pixels wider, on the photo.
  const xs = outline.map((p) => p.x * W)
  const ys = outline.map((p) => p.y * H)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)) - 3)
  const y0 = Math.max(0, Math.floor(Math.min(...ys)) - 3)
  const x1 = Math.min(W, Math.ceil(Math.max(...xs)) + 3)
  const y1 = Math.min(H, Math.ceil(Math.max(...ys)) + 3)
  const w = x1 - x0
  const h = y1 - y0
  if (w < 2 || h < 2) return null
  // Small areas are read at twice the size, smoothly, so a sign a hundred
  // pixels wide still gives a clean edge; big ones are read smaller.
  const s = Math.min(2, MAX_GRID / Math.max(w, h))
  const gw = Math.max(2, Math.round(w * s))
  const gh = Math.max(2, Math.round(h * s))

  const canvas = new OffscreenCanvas(gw, gh)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, x0, y0, w, h, 0, 0, gw, gh)
  const rgb = ctx.getImageData(0, 0, gw, gh).data
  // The outline itself, grown by a pixel and a half so tracing an outline
  // that was traced already does not wear it away.
  ctx.clearRect(0, 0, gw, gh)
  ctx.beginPath()
  outline.forEach((p, i) => {
    const px = (p.x * W - x0) * s
    const py = (p.y * H - y0) * s
    if (i) ctx.lineTo(px, py)
    else ctx.moveTo(px, py)
  })
  ctx.closePath()
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3 * s
  ctx.lineJoin = 'round'
  ctx.fill()
  ctx.stroke()
  const poly = ctx.getImageData(0, 0, gw, gh).data

  // The key's value, softened a touch (JPEG noise would fray the edge), and
  // how far each pixel is past the level on the picked side.
  const n = gw * gh
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const r = rgb[i * 4] / 255
    const g = rgb[i * 4 + 1] / 255
    const b = rgb[i * 4 + 2] / 255
    raw[i] = k.keyOn === 'blue' ? b : 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const d = new Float32Array(n)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      let sum = 0
      let count = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue
          sum += raw[yy * gw + xx]
          count++
        }
      const v = sum / count
      d[y * gw + x] = k.key === 'darker' ? k.keyLevel - v : v - k.keyLevel
    }

  // Picked pixels inside the outline; the largest connected patch of them.
  const picked = new Uint8Array(n)
  for (let i = 0; i < n; i++) picked[i] = poly[i * 4 + 3] > 127 && d[i] > 0 ? 1 : 0
  const label = new Int32Array(n)
  let best = 0
  let bestSize = 0
  let next = 0
  const stack: number[] = []
  for (let i = 0; i < n; i++) {
    if (!picked[i] || label[i]) continue
    next++
    let size = 0
    label[i] = next
    stack.push(i)
    while (stack.length) {
      const c = stack.pop()!
      size++
      const cx = c % gw
      const cy = (c - cx) / gw
      const visit = (j: number) => {
        if (picked[j] && !label[j]) {
          label[j] = next
          stack.push(j)
        }
      }
      if (cx > 0) visit(c - 1)
      if (cx < gw - 1) visit(c + 1)
      if (cy > 0) visit(c - gw)
      if (cy < gh - 1) visit(c + gw)
    }
    if (size > bestSize) {
      bestSize = size
      best = next
    }
  }
  if (!best || bestSize < 4) return null
  const inside = new Uint8Array(n)
  for (let i = 0; i < n; i++) inside[i] = label[i] === best ? 1 : 0
  // Holes in it (a bolt on the sign) filled: whatever the outside cannot reach.
  const out = new Uint8Array(n)
  for (let x = 0; x < gw; x++) {
    stack.push(x, (gh - 1) * gw + x)
  }
  for (let y = 0; y < gh; y++) stack.push(y * gw, y * gw + gw - 1)
  while (stack.length) {
    const c = stack.pop()!
    if (out[c] || inside[c]) continue
    out[c] = 1
    const cx = c % gw
    const cy = (c - cx) / gw
    if (cx > 0) stack.push(c - 1)
    if (cx < gw - 1) stack.push(c + 1)
    if (cy > 0) stack.push(c - gw)
    if (cy < gh - 1) stack.push(c + gw)
  }

  // The field the edge is traced on, a sample border all round so every
  // edge closes: positive inside the patch (by how far past the level, so
  // the line falls between pixels where the key crosses), just below zero
  // everywhere else that is not the patch.
  const EPS = 1e-4
  const PW = gw + 2
  const PH = gh + 2
  const f = new Float32Array(PW * PH).fill(-EPS)
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++) {
      const i = y * gw + x
      const v = d[i]
      f[(y + 1) * PW + x + 1] = inside[i] || !out[i] ? Math.max(v, EPS) : Math.min(v, -EPS)
    }

  // Marching squares: a crossing on each cell edge where the field changes
  // sign, joined into closed lines. Edges are numbered so the two cells
  // either side of one meet at the same crossing.
  const hEdge = (x: number, y: number) => (y * PW + x) * 2
  const vEdge = (x: number, y: number) => (y * PW + x) * 2 + 1
  const at = new Map<number, Point>()
  const cross = (e: number): number => {
    if (!at.has(e)) {
      const cell = e >> 1
      const x = cell % PW
      const y = (cell - x) / PW
      const a = f[y * PW + x]
      const b = e & 1 ? f[(y + 1) * PW + x] : f[y * PW + x + 1]
      const t = a / (a - b)
      at.set(e, e & 1 ? { x, y: y + t } : { x: x + t, y })
    }
    return e
  }
  const links = new Map<number, number[]>()
  const join = (a: number, b: number) => {
    cross(a)
    cross(b)
    ;(links.get(a) ?? links.set(a, []).get(a)!).push(b)
    ;(links.get(b) ?? links.set(b, []).get(b)!).push(a)
  }
  for (let y = 0; y < PH - 1; y++)
    for (let x = 0; x < PW - 1; x++) {
      const tl = f[y * PW + x] > 0
      const tr = f[y * PW + x + 1] > 0
      const br = f[(y + 1) * PW + x + 1] > 0
      const bl = f[(y + 1) * PW + x] > 0
      const c = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0)
      if (c === 0 || c === 15) continue
      const T = hEdge(x, y)
      const B = hEdge(x, y + 1)
      const L = vEdge(x, y)
      const R = vEdge(x + 1, y)
      switch (c) {
        case 1: case 14: join(L, B); break
        case 2: case 13: join(B, R); break
        case 3: case 12: join(L, R); break
        case 4: case 11: join(T, R); break
        case 6: case 9: join(T, B); break
        case 7: case 8: join(L, T); break
        case 5: case 10: {
          // A saddle: the middle decides which corners are joined.
          const mid = (f[y * PW + x] + f[y * PW + x + 1] + f[(y + 1) * PW + x + 1] + f[(y + 1) * PW + x]) / 4 > 0
          if ((c === 5) === mid) {
            join(L, T)
            join(B, R)
          } else {
            join(L, B)
            join(T, R)
          }
          break
        }
      }
    }
  // Follow each closed line; keep the one round the most area.
  const seen = new Set<number>()
  let loop: Point[] = []
  let loopArea = 0
  for (const start of links.keys()) {
    if (seen.has(start)) continue
    const line: Point[] = []
    let prev = -1
    let cur = start
    while (!seen.has(cur)) {
      seen.add(cur)
      line.push(at.get(cur)!)
      const nb = links.get(cur)!
      const nxt = nb[0] !== prev ? nb[0] : nb[1]
      prev = cur
      if (nxt === undefined) break
      cur = nxt
    }
    let area = 0
    for (let i = 0; i < line.length; i++) {
      const p = line[i]
      const q = line[(i + 1) % line.length]
      area += p.x * q.y - q.x * p.y
    }
    if (Math.abs(area) > loopArea) {
      loopArea = Math.abs(area)
      loop = line
    }
  }
  if (loop.length < 3) return null
  // Samples sit at pixel centres: padded sample x is photo px x0 + (x - 0.5) / s.
  const photoPx = loop.map((p) => ({ x: x0 + (p.x - 0.5) / s, y: y0 + (p.y - 0.5) / s }))
  return thinClosed(photoPx, Math.max(3, Math.round(points))).map((p) => ({ x: p.x / W, y: p.y / H }))
}

/**
 * A closed line thinned to at most `max` points: Ramer–Douglas–Peucker at
 * the smallest tolerance that gets there, so the points go where the line
 * turns and none are spent on its straight runs.
 */
export function thinClosed(pts: Point[], max: number): Point[] {
  if (pts.length <= max) return pts
  // Split at the point furthest from the first, so each half is an open run.
  let far = 0
  let farD = -1
  for (let i = 1; i < pts.length; i++) {
    const dd = Math.hypot(pts[i].x - pts[0].x, pts[i].y - pts[0].y)
    if (dd > farD) {
      farD = dd
      far = i
    }
  }
  const halves = [pts.slice(0, far + 1), [...pts.slice(far), pts[0]]]
  const thin = (tol: number) => {
    const a = rdp(halves[0], tol)
    const b = rdp(halves[1], tol)
    return [...a.slice(0, -1), ...b.slice(0, -1)]
  }
  let lo = 0
  let hi = Math.max(farD, 1)
  let result = thin(hi)
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    const r = thin(mid)
    if (r.length <= max) {
      hi = mid
      result = r
    } else lo = mid
  }
  return result
}

function rdp(pts: Point[], tol: number): Point[] {
  if (pts.length < 3) return pts
  const keep = new Uint8Array(pts.length)
  keep[0] = keep[pts.length - 1] = 1
  const stack: [number, number][] = [[0, pts.length - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    const ax = pts[a].x
    const ay = pts[a].y
    const bx = pts[b].x
    const by = pts[b].y
    const len = Math.hypot(bx - ax, by - ay)
    let far = -1
    let farD = tol
    for (let i = a + 1; i < b; i++) {
      const dd =
        len > 1e-9
          ? Math.abs((bx - ax) * (ay - pts[i].y) - (ax - pts[i].x) * (by - ay)) / len
          : Math.hypot(pts[i].x - ax, pts[i].y - ay)
      if (dd > farD) {
        farD = dd
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
