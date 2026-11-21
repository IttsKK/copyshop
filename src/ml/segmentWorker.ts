/// <reference lib="webworker" />
import type { Pick, PickBox, Selection } from './segment'

/**
 * The selection model (segment.ts) in its own worker. On the page's thread a
 * slow run (the CPU fallback on a slow machine: single-threaded WebAssembly,
 * many seconds) froze the whole window, and Chrome on Windows gave up on the
 * tab. Here the window keeps working whatever the model does, and the page can
 * stop the worker if it never answers.
 *
 * Photos come in once each (scaled to WORK_SIDE here), are worked out once,
 * and only the last two are kept: the model's working copies (on the GPU when
 * it runs there) are let go with them.
 */

export type ToSegmenter =
  | { type: 'init'; cpuOnly: boolean }
  | { type: 'photo'; photo: number; bitmap: ImageBitmap }
  | { type: 'prepare'; n: number; photo: number }
  | { type: 'segment'; n: number; photo: number; picks: Pick[]; box: PickBox | null }

export type FromSegmenter =
  | { type: 'done'; n: number; sel: Selection | null }
  | { type: 'failed'; n: number; error: string }
  /** What it is doing now: a breadcrumb on the page, for crash reports. */
  | { type: 'stage'; message: string }
  /** Something to report (the page sends it to Sentry). */
  | { type: 'notice'; level: 'warning' | 'error'; message: string; extra?: Record<string, unknown> }
  | { type: 'device'; device: string; gpu?: string }

const scope = self as unknown as DedicatedWorkerGlobalScope
const post = (m: FromSegmenter, transfer: Transferable[] = []) => scope.postMessage(m, transfer)
const stage = (message: string) => post({ type: 'stage', message })
const notice = (level: 'warning' | 'error', message: string, extra?: Record<string, unknown>) => post({ type: 'notice', level, message, extra })

const MODEL = 'onnx-community/EdgeTAM-ONNX'
/** The longest side the photo is worked at: the masks come back this size. */
const WORK_SIDE = 1600
/** Photos worked out and kept. */
const KEEP = 2

type Transformers = typeof import('@huggingface/transformers')
interface Loaded {
  T: Transformers
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  model: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  processor: any
  device: string
}

let loading: Promise<Loaded> | null = null

/** What's used of WebGPU's device (no WebGPU types in this project). */
interface GpuDevice {
  lost: Promise<{ reason: string; message: string }>
  adapterInfo?: { vendor?: string; architecture?: string; device?: string; description?: string }
}

/**
 * The GPU can't be trusted with this model here: it gave a selection that
 * can't be right (nothing, or not numbers; some Windows drivers run this
 * half-precision model and return garbage without an error), its device was
 * lost, or the page said so (a run there stopped answering before). From then
 * on it runs on the CPU.
 */
let gpuUnusable = false

async function load(): Promise<Loaded> {
  const [T, { default: ortFactory }, { default: ortWasm }] = await Promise.all([
    import('@huggingface/transformers'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.mjs?raw'),
    import('onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url'),
  ])
  const { env } = T
  env.allowRemoteModels = false
  env.allowLocalModels = true
  // Where the app is served from (/ in the desktop app, /app/ on the web), whatever its scheme.
  env.localModelPath = `${import.meta.env.BASE_URL}models/`
  // The files are on disk already: nothing to keep a second copy of.
  env.useBrowserCache = false
  // The runtime's own module, handed over as a blob: ONNX Runtime imports it
  // itself otherwise, which the dev server turns away and a cache can serve
  // stale. Both are the build's own copies (no CDN).
  const onnx = env.backends.onnx as { wasm?: { wasmPaths?: unknown; proxy?: boolean }; webgpu?: { device?: Promise<GpuDevice> } }
  onnx.wasm ??= {}
  onnx.wasm.proxy = false
  onnx.wasm.wasmPaths = {
    mjs: URL.createObjectURL(new Blob([ortFactory], { type: 'text/javascript' })),
    wasm: new URL(ortWasm, location.href).href,
  }
  ;(env as { useWasmCache?: boolean }).useWasmCache = false
  const processor = await T.AutoProcessor.from_pretrained(MODEL)
  const hasGpu = 'gpu' in navigator
  for (const device of hasGpu && !gpuUnusable ? ['webgpu', 'wasm'] : ['wasm']) {
    stage(`Selection model: loading (${device})`)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = await T.EdgeTamModel.from_pretrained(MODEL, { device: device as any, dtype: 'fp16' })
      let gpu: string | undefined
      if (device === 'webgpu') gpu = await watchGpu(onnx.webgpu?.device)
      post({ type: 'device', device, gpu })
      stage(`Selection model: ready (${device})`)
      return { T, model, processor, device }
    } catch (err) {
      if (device === 'wasm') throw err
      notice('warning', 'Selection model: could not start on WebGPU; running it on the CPU instead', { error: String((err as Error)?.message ?? err) })
    }
  }
  throw new Error('No way to run the selection model here')
}

/** The GPU's name for reports, and a report if the device is lost (a driver reset, or the system took it back). */
async function watchGpu(device: Promise<GpuDevice> | undefined): Promise<string | undefined> {
  try {
    const d = await device
    if (!d) return undefined
    d.lost.then((info) => {
      if (info.reason === 'destroyed') return
      gpuUnusable = true
      notice('error', 'Selection model: the GPU device was lost', { reason: info.reason, message: info.message })
    })
    const a = d.adapterInfo
    return a ? [...new Set([a.vendor, a.architecture, a.device, a.description].filter(Boolean))].join(' / ') : undefined
  } catch {
    return undefined
  }
}

function ready(): Promise<Loaded> {
  loading ??= load().catch((err) => {
    loading = null
    throw err
  })
  return loading
}

interface Embedded {
  width: number
  height: number
  /** The photo's brightness at the work size, 0..1: what the selection's edge is refined against. */
  gray: Float32Array
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputs: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  embeddings: any
}

interface Photo {
  /** At the work size: kept to work it out again (on the CPU, if the GPU fails). */
  bitmap: ImageBitmap
  job: Promise<Embedded> | null
}

const photos = new Map<number, Photo>()

/** The model's tensors (GPU buffers on the GPU) let go. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function disposeTensors(o: any): void {
  for (const v of Object.values(o ?? {})) {
    try {
      ;(v as { dispose?: () => void })?.dispose?.()
    } catch {
      /* already gone */
    }
  }
}

function forget(id: number): void {
  const p = photos.get(id)
  photos.delete(id)
  p?.bitmap.close()
  p?.job?.then((e) => (disposeTensors(e.inputs), disposeTensors(e.embeddings))).catch(() => undefined)
}

function addPhoto(id: number, bitmap: ImageBitmap): void {
  forget(id)
  // Scaled here, once: the full photo isn't kept.
  const k = Math.min(1, WORK_SIDE / Math.max(bitmap.width, bitmap.height))
  const width = Math.max(1, Math.round(bitmap.width * k))
  const height = Math.max(1, Math.round(bitmap.height * k))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  photos.set(id, { bitmap: canvas.transferToImageBitmap(), job: null })
  while (photos.size > KEEP) forget(photos.keys().next().value!)
}

async function embed(photo: Photo): Promise<Embedded> {
  const { T, model, processor, device } = await ready()
  const bitmap = photo.bitmap
  const { width, height } = bitmap
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(bitmap, 0, 0)
  const pixels = ctx.getImageData(0, 0, width, height).data
  const image = new T.RawImage(new Uint8ClampedArray(pixels), width, height, 4).rgb()
  stage(`Selection model: working out the photo (${device})`)
  const inputs = await processor(image)
  const embeddings = await model.get_image_embeddings(inputs)
  const gray = new Float32Array(width * height)
  for (let i = 0; i < gray.length; i++) gray[i] = (0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]) / 255
  return { width, height, gray, inputs, embeddings }
}

function prepare(id: number): Promise<Embedded> {
  const photo = photos.get(id)
  if (!photo) return Promise.reject(new Error('The photo to select in is gone.'))
  if (!photo.job) {
    const job = embed(photo)
    photo.job = job
    job.catch(() => photo.job === job && (photo.job = null))
  }
  return photo.job
}

/**
 * Off the GPU for good: its model and every photo's working copies let go
 * first (they were the GPU's), so the CPU's copy isn't loaded beside them.
 */
async function toCpu(): Promise<void> {
  gpuUnusable = true
  const was = loading
  loading = null
  for (const p of photos.values()) {
    p.job?.then((e) => (disposeTensors(e.inputs), disposeTensors(e.embeddings))).catch(() => undefined)
    p.job = null
  }
  try {
    await (await was)?.model?.dispose?.()
  } catch {
    /* gone with the device */
  }
}

async function segment(id: number, picks: Pick[], box: PickBox | null): Promise<Selection | null> {
  if (!picks.length && !box) return null
  const { width, height, gray, inputs, embeddings } = await prepare(id)
  const { model, processor, device } = await ready()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prompt: any = {}
  if (picks.length) {
    const points = [[picks.map((p) => [p.x * width, p.y * height])]]
    const labels = [[picks.map((p) => (p.on ? 1 : 0))]]
    prompt.input_points = processor.reshape_input_points(points, inputs.original_sizes, inputs.reshaped_input_sizes)
    prompt.input_labels = processor.image_processor.add_input_labels(labels, prompt.input_points)
  }
  if (box)
    prompt.input_boxes = processor.reshape_input_points(
      [[[box.x0 * width, box.y0 * height, box.x1 * width, box.y1 * height]]],
      inputs.original_sizes,
      inputs.reshaped_input_sizes,
      true,
    )
  stage(`Selection model: selecting (${device})`)
  let out
  try {
    out = await model({ ...inputs, ...embeddings, ...prompt })
  } catch (err) {
    if (device !== 'webgpu' || gpuUnusable) throw err
    notice('warning', 'Selection model: WebGPU failed to select; running it on the CPU instead', { error: String((err as Error)?.message ?? err) })
    await toCpu()
    return segment(id, picks, box)
  }
  // The model's own answer is coarse (a grid of about 6 px here): kept soft,
  // then refined against the photo (refineEdge) before it is cut in or out,
  // so the edge follows the subject's and flat sky does not come out in steps.
  const [masks] = await processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: false })
  const n = masks.dims[1] as number
  const logits = masks.data as Float32Array
  const size = width * height
  // A click always lands on something: no reading with anything inside it, or
  // readings that aren't numbers, means the GPU got it wrong. Run it again on the CPU.
  let usable = false
  for (let i = 0; i < logits.length; i += 3) {
    const v = logits[i]
    if (Number.isNaN(v)) {
      usable = false
      break
    }
    if (v > 0) usable = true
  }
  if (!usable && device === 'webgpu') {
    disposeTensors(out)
    notice('warning', 'Selection model: WebGPU returned no selection; running it on the CPU instead')
    await toCpu()
    return segment(id, picks, box)
  }
  stage('Selection model: refining the edge')
  const data = new Uint8Array(n * size)
  for (let i = 0; i < n; i++) data.set(refineEdge(logits.subarray(i * size, (i + 1) * size), gray, width, height), i * size)
  const scores = Array.from(out.iou_scores.data as Float32Array).slice(0, n)
  disposeTensors(out)
  const readings = Array.from({ length: n }, (_, i) => {
    const mask = data.slice(i * size, (i + 1) * size)
    let area = 0
    for (let j = 0; j < size; j++) area += mask[j]
    return { mask, area, score: scores[i] }
  })
  readings.sort((a, b) => a.area - b.area)
  let best = 0
  readings.forEach((r, i) => r.score > readings[best].score && (best = i))
  return { width, height, masks: readings.map((r) => r.mask), scores: readings.map((r) => r.score), best }
}

/** Sums over a (2r+1)² box at every cell, edges clamped: an integral image. */
function boxMean(src: Float32Array, w: number, h: number, r: number): Float32Array {
  const sum = new Float64Array((w + 1) * (h + 1))
  for (let y = 0; y < h; y++) {
    let row = 0
    for (let x = 0; x < w; x++) {
      row += src[y * w + x]
      sum[(y + 1) * (w + 1) + x + 1] = sum[y * (w + 1) + x + 1] + row
    }
  }
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r)
    const y1 = Math.min(h, y + r + 1)
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r)
      const x1 = Math.min(w, x + r + 1)
      const s = sum[y1 * (w + 1) + x1] - sum[y0 * (w + 1) + x1] - sum[y1 * (w + 1) + x0] + sum[y0 * (w + 1) + x0]
      out[y * w + x] = s / ((x1 - x0) * (y1 - y0))
    }
  }
  return out
}

/**
 * A selection's edge refined against the photo (a guided filter, He et al.):
 * the model's soft answer smoothed where the photo is flat, and snapped to
 * the photo's own edges where it has them; then cut at half. 1 inside.
 */
function refineEdge(logits: Float32Array, gray: Float32Array, w: number, h: number): Uint8Array {
  const p = new Float32Array(w * h)
  for (let i = 0; i < p.length; i++) p[i] = 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, logits[i]))))
  const r = Math.max(3, Math.round(Math.min(w, h) * 0.008))
  const eps = 1e-3
  const meanI = boxMean(gray, w, h, r)
  const meanP = boxMean(p, w, h, r)
  const II = new Float32Array(w * h)
  const IP = new Float32Array(w * h)
  for (let i = 0; i < II.length; i++) {
    II[i] = gray[i] * gray[i]
    IP[i] = gray[i] * p[i]
  }
  const corrI = boxMean(II, w, h, r)
  const corrIP = boxMean(IP, w, h, r)
  const a = new Float32Array(w * h)
  const b = new Float32Array(w * h)
  for (let i = 0; i < a.length; i++) {
    const varI = corrI[i] - meanI[i] * meanI[i]
    const cov = corrIP[i] - meanI[i] * meanP[i]
    a[i] = cov / (varI + eps)
    b[i] = meanP[i] - a[i] * meanI[i]
  }
  const ma = boxMean(a, w, h, r)
  const mb = boxMean(b, w, h, r)
  const out = new Uint8Array(w * h)
  for (let i = 0; i < out.length; i++) out[i] = ma[i] * gray[i] + mb[i] >= 0.5 ? 1 : 0
  return out
}

// One request at a time: the model isn't run twice at once, and a switch to
// the CPU happens between requests.
let queue: Promise<unknown> = Promise.resolve()
const inTurn = <T>(f: () => Promise<T>): Promise<T> => {
  const next = queue.then(f, f)
  queue = next.catch(() => undefined)
  return next
}

const fail = (n: number) => (err: unknown) => post({ type: 'failed', n, error: String((err as Error)?.message ?? err) })

scope.onmessage = (e: MessageEvent<ToSegmenter>) => {
  const m = e.data
  switch (m.type) {
    case 'init':
      gpuUnusable ||= m.cpuOnly
      break
    case 'photo':
      addPhoto(m.photo, m.bitmap)
      break
    case 'prepare':
      inTurn(() => prepare(m.photo)).then(() => post({ type: 'done', n: m.n, sel: null }), fail(m.n))
      break
    case 'segment':
      inTurn(() => segment(m.photo, m.picks, m.box)).then(
        (sel) => post({ type: 'done', n: m.n, sel }, sel ? sel.masks.map((k) => k.buffer as ArrayBuffer) : []),
        fail(m.n),
      )
      break
  }
}

// Anything that slipped past a request's own handling still reaches Sentry.
scope.addEventListener('unhandledrejection', (e) => notice('error', `Selection worker: ${String(e.reason?.message ?? e.reason)}`, { stack: String(e.reason?.stack ?? '') }))
