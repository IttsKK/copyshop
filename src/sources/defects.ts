/**
 * Film and scan defects: dust, hairs and scratches.
 *
 * Generated as a single layer covering the frame rather than a tiled plate —
 * a repeating scratch reads as a pattern, and the whole point of a defect is
 * that it is a one-off. Deterministic for a given seed, so a preset reproduces
 * the same speck in the same place.
 */

export interface DefectParams {
  /** Overall opacity of the layer. 0 disables it entirely. */
  strength: number
  /** Specks per megapixel. */
  dust: number
  /** Number of hairs across the frame. */
  hairs: number
  /** Number of scratches. */
  scratches: number
  /**
   * Horizontal banding from the scanner's line sensor: each row is read by
   * slightly different electronics, and the transport adds a slow periodic
   * ripple on top.
   */
  scanLines: number
  /** Vertical streaks: dirt on the sensor draws a line down the whole scan. */
  scanStreaks: number
  seed: number
}

export const DEFAULT_DEFECTS: DefectParams = {
  strength: 0,
  dust: 40,
  hairs: 0,
  scratches: 1,
  scanLines: 0,
  scanStreaks: 0,
  seed: 1,
}

const MAX_LAYER = 2048

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Draw the defect layer for a frame of the given size.
 *
 * Returns a canvas with transparent background: alpha is where a defect is,
 * colour is what it looks like. Dust on a negative blocks light and prints
 * dark; a scratch through the emulsion prints bright. Both happen, so both are
 * here, weighted the way scans usually look.
 */
export function generateDefectLayer(width: number, height: number, params: DefectParams): HTMLCanvasElement | OffscreenCanvas {
  const scale = Math.min(1, MAX_LAYER / Math.max(width, height))
  const w = Math.max(16, Math.round(width * scale))
  const h = Math.max(16, Math.round(height * scale))
  // In the render worker there is no document.
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : new OffscreenCanvas(w, h)
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
  ctx.clearRect(0, 0, w, h)

  const rand = mulberry32(params.seed)
  const megapixels = (w * h) / 1e6

  // Dust: small specks, mostly dark, a few bright. Soft edges, because a speck
  // out of the scanner's focal plane is never a hard dot.
  const speckCount = Math.round(params.dust * megapixels)
  for (let i = 0; i < speckCount; i++) {
    const x = rand() * w
    const y = rand() * h
    const radius = 0.4 + rand() * rand() * 3.2
    const bright = rand() < 0.22
    const alpha = 0.25 + rand() * 0.65
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius)
    const colour = bright ? '255,255,255' : '15,12,10'
    gradient.addColorStop(0, `rgba(${colour},${alpha})`)
    gradient.addColorStop(0.6, `rgba(${colour},${alpha * 0.7})`)
    gradient.addColorStop(1, `rgba(${colour},0)`)
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }

  // Hairs: long, thin, curved, always dark.
  ctx.lineCap = 'round'
  for (let i = 0; i < params.hairs; i++) {
    const x0 = rand() * w
    const y0 = rand() * h
    const length = (0.15 + rand() * 0.5) * Math.max(w, h)
    const angle = rand() * Math.PI * 2
    const curve = (rand() - 0.5) * length * 0.8
    ctx.strokeStyle = `rgba(12,10,9,${0.5 + rand() * 0.4})`
    ctx.lineWidth = 0.8 + rand() * 1.4
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.quadraticCurveTo(
      x0 + Math.cos(angle) * length * 0.5 - Math.sin(angle) * curve,
      y0 + Math.sin(angle) * length * 0.5 + Math.cos(angle) * curve,
      x0 + Math.cos(angle) * length,
      y0 + Math.sin(angle) * length,
    )
    ctx.stroke()
  }

  // Scratches: near-vertical, bright, running most of the frame — the mark of
  // film dragged against something in the transport.
  for (let i = 0; i < params.scratches; i++) {
    const x = rand() * w
    const drift = (rand() - 0.5) * w * 0.02
    const alpha = 0.18 + rand() * 0.3
    ctx.strokeStyle = `rgba(255,252,245,${alpha})`
    ctx.lineWidth = 0.6 + rand() * 1.1
    ctx.beginPath()
    ctx.moveTo(x, -10)
    ctx.quadraticCurveTo(x + drift, h * 0.5, x + drift * 0.4, h + 10)
    ctx.stroke()
  }

  return canvas
}

export function defectKey(width: number, height: number, params: DefectParams): string {
  return `${width}x${height}|${params.dust}|${params.hairs}|${params.scratches}|${params.seed}`
}
