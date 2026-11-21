/**
 * WebP export. Safari and the Mac app's webview can't encode WebP from a
 * canvas, so libwebp itself does it, as WebAssembly in a worker
 * (webpWorker.ts), loaded only when a WebP is exported. Lossy, with the
 * export's quality; WebP keeps colour at half resolution at any quality, as
 * JPEG does below 100.
 *
 * Also the RIFF chunk work for carrying the edit in a WebP (storage/recipe.ts).
 */

/** WebP's own limit, a side. */
export const WEBP_MAX_SIDE = 16383

let worker: Worker | null = null
let nextId = 1
const waiting = new Map<number, { resolve: (b: ArrayBuffer) => void; reject: (e: Error) => void }>()

function webpWorker(): Worker {
  if (worker) return worker
  worker = new Worker(new URL('./webpWorker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (e: MessageEvent<{ id: number; out?: ArrayBuffer; error?: string }>) => {
    const job = waiting.get(e.data.id)
    if (!job) return
    waiting.delete(e.data.id)
    if (e.data.out) job.resolve(e.data.out)
    else job.reject(new Error(`Could not encode the WebP: ${e.data.error ?? 'unknown error'}`))
  }
  worker.onerror = (e) => {
    for (const job of waiting.values()) job.reject(new Error(`Could not encode the WebP: ${e.message || 'the encoder did not load'}`))
    waiting.clear()
    worker?.terminate()
    worker = null
  }
  return worker
}

/** RGBA pixels as a lossy WebP; `quality` 0..1. */
export function encodeWebp(pixels: Uint8ClampedArray, width: number, height: number, quality: number): Promise<Uint8Array<ArrayBuffer>> {
  if (width > WEBP_MAX_SIDE || height > WEBP_MAX_SIDE)
    return Promise.reject(
      new Error(`A WebP can be at most ${WEBP_MAX_SIDE} pixels on a side; this export is ${width} × ${height}. Set a smaller long edge, or export a JPEG, PNG or TIFF.`),
    )
  const id = nextId++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve: (b) => resolve(new Uint8Array(b)), reject })
    const copy = pixels.buffer.byteLength === pixels.byteLength ? pixels.buffer : pixels.slice().buffer
    webpWorker().postMessage({ id, width, height, pixels: copy, quality: Math.round(Math.min(1, Math.max(0, quality)) * 100) }, [copy as ArrayBuffer])
  })
}

// --- RIFF chunks -------------------------------------------------------------

const ascii = (b: Uint8Array, at: number) => String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3])
export const isWebp = (b: Uint8Array) => b.length >= 16 && ascii(b, 0) === 'RIFF' && ascii(b, 8) === 'WEBP'

interface Chunk {
  type: string
  /** The whole chunk: header, payload and its pad byte. */
  bytes: Uint8Array
  payload: Uint8Array
}

function chunks(b: Uint8Array): Chunk[] {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Chunk[] = []
  let p = 12
  while (p + 8 <= b.length) {
    const size = d.getUint32(p + 4, true)
    const end = Math.min(b.length, p + 8 + size + (size & 1))
    out.push({ type: ascii(b, p), bytes: b.subarray(p, end), payload: b.subarray(p + 8, Math.min(b.length, p + 8 + size)) })
    p = end
  }
  return out
}

function chunk(type: string, payload: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + payload.length + (payload.length & 1))
  out.set(new TextEncoder().encode(type))
  new DataView(out.buffer).setUint32(4, payload.length, true)
  out.set(payload, 8)
  return out
}

/** The picture's size and whether it has alpha, from its VP8 or VP8L chunk. */
function frameOf(cs: Chunk[]): { width: number; height: number; alpha: boolean } | null {
  for (const c of cs) {
    const p = c.payload
    if (c.type === 'VP8 ' && p.length >= 10) {
      return { width: (p[6] | (p[7] << 8)) & 0x3fff, height: (p[8] | (p[9] << 8)) & 0x3fff, alpha: false }
    }
    if (c.type === 'VP8L' && p.length >= 5 && p[0] === 0x2f) {
      const bits = p[1] | (p[2] << 8) | (p[3] << 16) | (p[4] << 24)
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: ((bits >>> 28) & 1) === 1 }
    }
  }
  return null
}

/**
 * The WebP with a chunk of `type` holding `payload`, at the end, replacing
 * one there already. A simple WebP becomes an extended one (VP8X) first: only
 * that form may carry other chunks. Null if it isn't a WebP that can be read.
 */
export function webpWithChunk(bytes: Uint8Array, type: string, payload: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (!isWebp(bytes)) return null
  let cs = chunks(bytes).filter((c) => c.type !== type)
  if (cs[0]?.type !== 'VP8X') {
    const frame = frameOf(cs)
    if (!frame) return null
    const x = new Uint8Array(10)
    x[0] = frame.alpha ? 0x10 : 0
    const w = frame.width - 1
    const h = frame.height - 1
    x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 4)
    const vp8x = chunk('VP8X', x)
    cs = [{ type: 'VP8X', bytes: vp8x, payload: vp8x.subarray(8) }, ...cs]
  }
  const parts = [...cs.map((c) => c.bytes), chunk(type, payload)]
  const size = 4 + parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(8 + size)
  out.set(new TextEncoder().encode('RIFF'))
  new DataView(out.buffer).setUint32(4, size, true)
  out.set(new TextEncoder().encode('WEBP'), 8)
  let at = 12
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** The payload of a WebP's chunk of `type`, or null. */
export function webpChunk(bytes: Uint8Array, type: string): Uint8Array | null {
  if (!isWebp(bytes)) return null
  return chunks(bytes).find((c) => c.type === type)?.payload ?? null
}
