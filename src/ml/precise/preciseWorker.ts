/// <reference lib="webworker" />
import { edgeGuide, refineEdge, boxMean } from '../refineEdge'

/**
 * Precise selection's pixel work, off the page's thread (src/ml/precise):
 * the photo, or a part of it, made into the models' input (1024 square,
 * ImageNet's mean and spread); Segment Anything's coarse answer (256 square)
 * brought up to that part's size and its edge refined against the photo;
 * BiRefNet's edge laid along it. Also runs models in the page (ONNX Runtime
 * Web, on WebGPU) where the app does not run them natively: Segment
 * Anything on a Mac, whose GPU is quicker there than its CPU natively.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export type ToPrecise =
  | { type: 'photo'; photo: number; bitmap: ImageBitmap }
  | { type: 'forget'; photo: number }
  /** A part of the photo (its pixels; all of it if none) made ready, kept as job `job`, at most `side` long. */
  | { type: 'prepare'; n: number; photo: number; job: string; rect: Rect | null; side: number }
  /** The three coarse readings (3 × 256 × 256 logits) brought up to the job's size, edges refined. */
  | { type: 'readings'; n: number; job: string; low: Float32Array; count: number }
  /** BiRefNet's answer (1024 × 1024 logits) laid along a reading's edge. */
  | { type: 'edge'; n: number; job: string; mask: Uint8Array; logits: Float32Array }
  | { type: 'drop'; job: string }
  /** The web runner: a model's bytes (and its weights' file) opened as a session. */
  | { type: 'load'; n: number; name: string; model: ArrayBuffer; data?: { path: string; bytes: ArrayBuffer }; gpu: boolean }
  | { type: 'run'; n: number; session: string; inputs: WebInput[]; outputs: string[]; keep: Record<string, string> }
  | { type: 'unload'; n: number; name?: string; kept?: string }

export type WebInput = { name: string; type: 'f32' | 'i64'; shape: number[]; data: Float32Array | BigInt64Array } | { name: string; kept: string }

export type FromPrecise =
  | { type: 'prepared'; n: number; tensor: Float32Array; width: number; height: number }
  | { type: 'readings'; n: number; masks: Uint8Array[]; areas: number[] }
  | { type: 'edged'; n: number; mask: Uint8Array }
  | { type: 'loaded'; n: number; device: string }
  | { type: 'ran'; n: number; outputs: Record<string, { shape: number[]; data: Float32Array }> }
  | { type: 'done'; n: number }
  | { type: 'failed'; n: number; error: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (m: FromPrecise, transfer: Transferable[] = []) => scope.postMessage(m, transfer)

const photos = new Map<number, ImageBitmap>()
interface Job {
  width: number
  height: number
  gray: Float32Array
  rgb: Uint8ClampedArray
}
const jobs = new Map<string, Job>()

const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]
const S = 1024

function prepare(photo: ImageBitmap, rect: Rect | null, side: number, key: string): { tensor: Float32Array; width: number; height: number } {
  const r = rect ?? { x: 0, y: 0, width: photo.width, height: photo.height }
  const k = Math.min(1, side / Math.max(r.width, r.height))
  const width = Math.max(1, Math.round(r.width * k))
  const height = Math.max(1, Math.round(r.height * k))
  // The part at its working size: kept for refining edges against.
  const c = new OffscreenCanvas(width, height)
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(photo, r.x, r.y, r.width, r.height, 0, 0, width, height)
  const rgb = ctx.getImageData(0, 0, width, height).data
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = (0.2126 * rgb[i * 4] + 0.7152 * rgb[i * 4 + 1] + 0.0722 * rgb[i * 4 + 2]) / 255
  jobs.set(key, { width, height, gray, rgb })
  // The models' input: the part stretched to 1024 square (as their processors do), normalised, channels first.
  const sq = new OffscreenCanvas(S, S)
  const sctx = sq.getContext('2d', { willReadFrequently: true })!
  sctx.imageSmoothingQuality = 'high'
  sctx.drawImage(photo, r.x, r.y, r.width, r.height, 0, 0, S, S)
  const px = sctx.getImageData(0, 0, S, S).data
  const tensor = new Float32Array(3 * S * S)
  for (let i = 0; i < S * S; i++) for (let ch = 0; ch < 3; ch++) tensor[ch * S * S + i] = (px[i * 4 + ch] / 255 - MEAN[ch]) / STD[ch]
  return { tensor, width, height }
}

/** A square grid of logits (n × n, covering the whole part) read at the part's own size, bilinear. */
function upsample(src: Float32Array, n: number, w: number, h: number, out: Float32Array): Float32Array {
  const sx = n / w
  const sy = n / h
  for (let y = 0; y < h; y++) {
    const fy = Math.min(n - 1, Math.max(0, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(n - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.min(n - 1, Math.max(0, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(n - 1, x0 + 1)
      const tx = fx - x0
      const a = src[y0 * n + x0] + (src[y0 * n + x1] - src[y0 * n + x0]) * tx
      const b = src[y1 * n + x0] + (src[y1 * n + x1] - src[y1 * n + x0]) * tx
      out[y * w + x] = a + (b - a) * ty
    }
  }
  return out
}

function readings(job: Job, low: Float32Array, count: number): { masks: Uint8Array[]; areas: number[] } {
  const { width: w, height: h } = job
  const guide = edgeGuide(job.gray, w, h)
  const logits = new Float32Array(w * h)
  const masks: Uint8Array[] = []
  const areas: number[] = []
  for (let i = 0; i < count; i++) {
    upsample(low.subarray(i * 256 * 256, (i + 1) * 256 * 256), 256, w, h, logits)
    const m = refineEdge(logits, guide, new Uint8Array(w * h))
    let a = 0
    for (let j = 0; j < m.length; j++) a += m[j]
    masks.push(m)
    areas.push(a / m.length)
  }
  return { masks, areas }
}

/**
 * Segment Anything says which thing; BiRefNet where its edge is. Well inside
 * the reading (further than `near` from its edge) it is kept; near its edge,
 * BiRefNet decides; beyond that, nothing. So a neighbour BiRefNet also takes
 * for the subject (the church's wing) stays out, and the edge is BiRefNet's.
 */
function edge(job: Job, mask: Uint8Array, logits: Float32Array): Uint8Array {
  const { width: w, height: h } = job
  const b = upsample(logits, S, w, h, new Float32Array(w * h))
  const r = Math.max(4, Math.round(Math.min(w, h) * 0.03))
  const sum = new Float64Array((w + 1) * (h + 1))
  const near = boxMean(Float32Array.from(mask), w, h, r, new Float32Array(w * h), sum)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = near[i] > 0.999 ? 1 : near[i] > 0 && b[i] > 0 ? 1 : 0
  return out
}

/* ------------------------------------------------------------ web runner */

type Ort = typeof import('onnxruntime-web/webgpu')
let ortPromise: Promise<Ort> | null = null
function ortRuntime(): Promise<Ort> {
  ortPromise ??= (async () => {
    const [ort, { default: factory }, { default: wasm }] = await Promise.all([
      import('onnxruntime-web/webgpu'),
      import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?raw'),
      import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'),
    ])
    ort.env.wasm.proxy = false
    ort.env.wasm.wasmPaths = { mjs: URL.createObjectURL(new Blob([factory], { type: 'text/javascript' })), wasm: new URL(wasm, location.href).href }
    return ort
  })()
  return ortPromise
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessions = new Map<string, any>()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const kept = new Map<string, any>()

async function load(name: string, model: ArrayBuffer, data: { path: string; bytes: ArrayBuffer } | undefined, gpu: boolean): Promise<string> {
  const ort = await ortRuntime()
  const options = (ep: string) => ({
    executionProviders: [ep],
    graphOptimizationLevel: 'all' as const,
    ...(data ? { externalData: [{ path: data.path, data: new Uint8Array(data.bytes) }] } : {}),
  })
  if (gpu && 'gpu' in navigator) {
    try {
      sessions.set(name, await ort.InferenceSession.create(new Uint8Array(model), options('webgpu')))
      return 'webgpu'
    } catch {
      /* the CPU instead */
    }
  }
  sessions.set(name, await ort.InferenceSession.create(new Uint8Array(model), options('wasm')))
  return 'wasm'
}

async function run(session: string, inputs: WebInput[], outputs: string[], keep: Record<string, string>) {
  const ort = await ortRuntime()
  const s = sessions.get(session)
  if (!s) throw new Error(`the model ${session} is not open`)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feeds: Record<string, any> = {}
  for (const i of inputs) {
    if ('kept' in i) {
      const v = kept.get(i.kept)
      if (!v) throw new Error(`nothing is kept as ${i.kept}`)
      feeds[i.name] = v
    } else feeds[i.name] = new ort.Tensor(i.type === 'i64' ? 'int64' : 'float32', i.data, i.shape)
  }
  const result = await s.run(feeds)
  const out: Record<string, { shape: number[]; data: Float32Array }> = {}
  for (const name of outputs) {
    const t = result[name]
    if (!t) throw new Error(`the model gave no ${name}`)
    out[name] = { shape: [...t.dims], data: (t.data as Float32Array).slice() }
  }
  for (const [name, key] of Object.entries(keep)) {
    const t = result[name]
    if (!t) throw new Error(`the model gave no ${name} to keep`)
    kept.set(key, t)
  }
  return out
}

const fail = (n: number) => (err: unknown) => post({ type: 'failed', n, error: String((err as Error)?.message ?? err) })

// One heavy thing at a time, in the order asked.
let queue: Promise<unknown> = Promise.resolve()
const inTurn = (f: () => Promise<void> | void) => {
  queue = queue.then(f, f).catch(() => undefined)
}

scope.onmessage = (e: MessageEvent<ToPrecise>) => {
  const m = e.data
  switch (m.type) {
    case 'photo':
      photos.get(m.photo)?.close()
      photos.set(m.photo, m.bitmap)
      return
    case 'forget':
      photos.get(m.photo)?.close()
      photos.delete(m.photo)
      return
    case 'drop':
      jobs.delete(m.job)
      return
    case 'prepare':
      return inTurn(() => {
        try {
          const photo = photos.get(m.photo)
          if (!photo) throw new Error('The photo to select in is gone.')
          const r = prepare(photo, m.rect, m.side, m.job)
          post({ type: 'prepared', n: m.n, ...r }, [r.tensor.buffer])
        } catch (err) {
          fail(m.n)(err)
        }
      })
    case 'readings':
      return inTurn(() => {
        try {
          const job = jobs.get(m.job)
          if (!job) throw new Error('That part of the photo is gone.')
          const r = readings(job, m.low, m.count)
          post(
            { type: 'readings', n: m.n, ...r },
            r.masks.map((x) => x.buffer),
          )
        } catch (err) {
          fail(m.n)(err)
        }
      })
    case 'edge':
      return inTurn(() => {
        try {
          const job = jobs.get(m.job)
          if (!job) throw new Error('That part of the photo is gone.')
          const mask = edge(job, m.mask, m.logits)
          post({ type: 'edged', n: m.n, mask }, [mask.buffer])
        } catch (err) {
          fail(m.n)(err)
        }
      })
    case 'load':
      return inTurn(() => load(m.name, m.model, m.data, m.gpu).then((device) => post({ type: 'loaded', n: m.n, device }), fail(m.n)))
    case 'run':
      return inTurn(() =>
        run(m.session, m.inputs, m.outputs, m.keep).then(
          (outputs) =>
            post(
              { type: 'ran', n: m.n, outputs },
              Object.values(outputs).map((o) => o.data.buffer),
            ),
          fail(m.n),
        ),
      )
    case 'unload':
      if (m.name) {
        sessions.get(m.name)?.release?.()
        sessions.delete(m.name)
      }
      if (m.kept) for (const k of [...kept.keys()]) if (k.startsWith(m.kept)) kept.delete(k)
      post({ type: 'done', n: m.n })
      return
  }
}
