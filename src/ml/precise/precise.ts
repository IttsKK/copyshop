import { invoke } from '@tauri-apps/api/core'
import { readFile } from '../../platform/native'
import { Sentry, reportIssue } from '../../platform/telemetry'
import { track } from '../../platform/usage'
import type { Pick, PickBox, Selection } from '../segment'
import { mlInfo, precisePath, preciseStore, type PrecisePart } from './models'
import type { FromPrecise, Rect, ToPrecise, WebInput } from './preciseWorker'
import { PRECISE_SIDE } from './side'

/**
 * Precise selection: what was clicked or boxed found by Segment Anything 2.1
 * on the whole photo, then again on the photo cropped round it (so it fills
 * the model's view, and its edge comes out sharp), then its edge traced by
 * BiRefNet along that. The first answer comes back at once; the sharper one
 * follows (onBetter) when it is ready, seconds later.
 *
 * Where the models run: on Windows, natively on the GPU (DirectML, the CPU if
 * it can't); on a Mac with Apple silicon, Segment Anything on the GPU in the
 * page (WebGPU, ~0.3 s) and BiRefNet natively on the CPU (~15 s). An Intel Mac
 * and Linux have no native runtime: Segment Anything only, in the page (on
 * WebGPU on the Mac, the CPU on Linux).
 */

/* ---------------------------------------------------------------- worker */

let worker: Worker | null = null
let n = 0
const waiting = new Map<number, { resolve: (m: FromPrecise) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker {
  if (worker) return worker
  const w = new Worker(new URL('./preciseWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<FromPrecise>) => {
    const m = e.data
    const p = waiting.get(m.n)
    if (!p) return
    waiting.delete(m.n)
    if (m.type === 'failed') p.reject(new Error(m.error))
    else p.resolve(m)
  }
  w.onerror = (e) => {
    e.preventDefault()
    if (worker !== w) return
    worker = null
    w.terminate()
    reset()
    for (const p of waiting.values()) p.reject(new Error('Precise selection stopped. Try again.'))
    waiting.clear()
    reportIssue('Precise selection: worker crashed', 'error', { error: e.message }, ['precise-worker'])
  }
  worker = w
  return w
}

function ask<T extends FromPrecise>(make: (n: number) => ToPrecise, transfer: Transferable[] = []): Promise<T> {
  const w = ensureWorker()
  const id = ++n
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (m: FromPrecise) => void, reject })
    w.postMessage(make(id), transfer)
  })
}

/* --------------------------------------------------------------- runners */

type Input = WebInput
type Outputs = Record<string, { shape: number[]; data: Float32Array }>
interface Runner {
  load(name: string, model: string, data?: string): Promise<string>
  run(session: string, inputs: Input[], outputs: string[], keep?: Record<string, string>): Promise<Outputs>
  forget(kept: string): Promise<void>
}

/** The app's own runtime (src-tauri/src/ml.rs): inputs and outputs as raw bytes. */
const native: Runner = {
  load: (name, model) => invoke<string>('ml_load', { name, path: model }),
  async run(session, inputs, outputs, keep = {}) {
    const specs: object[] = []
    const parts: Uint8Array[] = []
    let offset = 0
    for (const i of inputs) {
      if ('kept' in i) {
        specs.push({ name: i.name, kept: i.kept })
        continue
      }
      const bytes = new Uint8Array(i.data.buffer, i.data.byteOffset, i.data.byteLength)
      specs.push({ name: i.name, type: i.type, shape: i.shape, offset, bytes: bytes.length })
      parts.push(bytes)
      offset += bytes.length
    }
    const header = new TextEncoder().encode(JSON.stringify({ session, inputs: specs, outputs, keep }))
    const body = new Uint8Array(4 + header.length + offset)
    new DataView(body.buffer).setUint32(0, header.length, true)
    body.set(header, 4)
    let at = 4 + header.length
    for (const p of parts) {
      body.set(p, at)
      at += p.length
    }
    const res = new Uint8Array(await invoke<ArrayBuffer>('ml_run', body))
    const len = new DataView(res.buffer, res.byteOffset).getUint32(0, true)
    const meta = JSON.parse(new TextDecoder().decode(res.subarray(4, 4 + len))) as { outputs: { name: string; shape: number[]; offset: number; bytes: number }[] }
    const base = res.byteOffset + 4 + len
    const out: Outputs = {}
    for (const o of meta.outputs) out[o.name] = { shape: o.shape, data: new Float32Array(res.buffer.slice(base + o.offset, base + o.offset + o.bytes)) }
    return out
  },
  forget: (kept) => invoke('ml_unload', { kept }),
}

/** ONNX Runtime Web in the worker, on WebGPU where there is one. */
const web: Runner = {
  async load(name, model, data) {
    const bytes = await readFile(model)
    if (!bytes) throw new Error(`${model} is missing`)
    const extra = data ? await readFile(data) : null
    if (data && !extra) throw new Error(`${data} is missing`)
    const transfer: Transferable[] = [bytes.buffer, ...(extra ? [extra.buffer] : [])]
    const m = await ask<Extract<FromPrecise, { type: 'loaded' }>>(
      (n) => ({ type: 'load', n, name, model: bytes.buffer, data: extra && data ? { path: data.split('/').pop()!, bytes: extra.buffer } : undefined, gpu: true }),
      transfer,
    )
    return m.device
  },
  async run(session, inputs, outputs, keep = {}) {
    const transfer = inputs.flatMap((i) => ('kept' in i ? [] : [i.data.buffer]))
    const m = await ask<Extract<FromPrecise, { type: 'ran' }>>((n) => ({ type: 'run', n, session, inputs, outputs, keep }), transfer)
    return m.outputs
  },
  async forget(kept) {
    await ask((n) => ({ type: 'unload', n, kept }))
  },
}

/* ---------------------------------------------------------------- models */

interface Ready {
  find: Runner
  /** BiRefNet, opened in the background: the first answer does not wait for it. */
  edge: Promise<Runner | null>
  devices: string
}
let ready: Promise<Ready> | null = null
/** Where the models ran, for reports and the self-check: "find webgpu/webgpu, cpu; edge cpu". */
export let preciseDevices = ''

function reset() {
  ready = null
  photoIds = new WeakMap()
  encoded = new WeakMap()
}

/** Opens the models (once): where each runs is chosen here (see the top of this file). */
function load(parts: PrecisePart[]): Promise<Ready> {
  ready ??= (async () => {
    const info = await mlInfo()
    // Segment Anything: natively when that has the GPU (Windows) or the page has no WebGPU; else in the page.
    const findHere = info.native && (info.gpu !== null || !('gpu' in navigator)) ? native : web
    const enc = await precisePath('sam', 'vision_encoder_fp16.onnx')
    const dec = await precisePath('sam', 'prompt_encoder_mask_decoder_fp16.onnx')
    const d1 = await findHere.load('sam_enc', enc, `${enc}_data`)
    const d2 = await findHere.load('sam_dec', dec, `${dec}_data`)
    const edge: Promise<Runner | null> =
      parts.includes('edge') && info.native
        ? precisePath('edge', 'model_fp16.onnx')
            .then((path) => native.load('biref', path))
            .then((d3) => {
              Sentry.setTag('precise.edge', d3)
              preciseDevices += `; edge ${d3}`
              return native
            })
            .catch((err) => {
              reportIssue('Precise selection: the edge model could not open', 'warning', { error: String((err as Error)?.message ?? err) }, ['precise-edge-load'])
              return null
            })
        : Promise.resolve(null)
    const devices = `find ${d1}/${d2}, ${info.gpu ?? 'cpu'}`
    Sentry.setTag('precise.devices', devices)
    preciseDevices = devices
    return { find: findHere, edge, devices }
  })().catch((err) => {
    ready = null
    throw err
  })
  return ready
}

/* ------------------------------------------------------------- selecting */

let photoIds = new WeakMap<ImageBitmap, number>()
let nextPhoto = 1
function photoId(photo: ImageBitmap): number {
  let id = photoIds.get(photo)
  if (!id) {
    id = nextPhoto++
    photoIds.set(photo, id)
    ensureWorker().postMessage({ type: 'photo', photo: id, bitmap: photo } satisfies ToPrecise)
  }
  return id
}

/** The longest side the whole photo is worked at (the first answer). */
const WORK_SIDE = 1600
/** The longest side the part round the subject is worked at, and the final selection kept at. */
const CROP_SIDE = 2048

interface Encoded {
  key: string
  width: number
  height: number
  /** The models' input for this part, while it is still here (the web runner takes it over). */
  tensor: Float32Array
}
let encoded = new WeakMap<ImageBitmap, Promise<Encoded>>()

async function encode(r: Ready, photo: ImageBitmap, rect: Rect | null, side: number, key: string): Promise<Encoded> {
  const id = photoId(photo)
  const p = await ask<Extract<FromPrecise, { type: 'prepared' }>>((n) => ({ type: 'prepare', n, photo: id, job: key, rect, side }))
  await r.find.run('sam_enc', [{ name: 'pixel_values', type: 'f32', shape: [1, 3, 1024, 1024], data: p.tensor }], [], {
    'image_embeddings.0': `${key}/0`,
    'image_embeddings.1': `${key}/1`,
    'image_embeddings.2': `${key}/2`,
  })
  return { key, width: p.width, height: p.height, tensor: p.tensor }
}

/** The whole photo worked out ahead of the first click. */
export async function preparePrecise(photo: ImageBitmap, parts: PrecisePart[]): Promise<void> {
  const r = await load(parts)
  let job = encoded.get(photo)
  if (!job) {
    job = encode(r, photo, null, WORK_SIDE, `p${photoId(photo)}`)
    encoded.set(photo, job)
    job.catch(() => encoded.get(photo) === job && encoded.delete(photo))
  }
  await job
}

interface Prompt {
  /** In the part's own pixels. */
  points: { x: number; y: number; on: boolean }[]
  box: { x0: number; y0: number; x1: number; y1: number } | null
}

/** Segment Anything's three readings for a prompt, on an encoded part, each refined at the part's size. */
async function decode(r: Ready, e: Encoded, prompt: Prompt): Promise<{ masks: Uint8Array[]; scores: number[]; areas: number[] }> {
  const fx = 1024 / e.width
  const fy = 1024 / e.height
  const np = prompt.points.length
  const inputs: Input[] = [
    { name: 'input_points', type: 'f32', shape: [1, 1, np, 2], data: Float32Array.from(prompt.points.flatMap((p) => [p.x * fx, p.y * fy])) },
    { name: 'input_labels', type: 'i64', shape: [1, 1, np], data: BigInt64Array.from(prompt.points.map((p) => (p.on ? 1n : 0n))) },
    prompt.box
      ? { name: 'input_boxes', type: 'f32', shape: [1, 1, 4], data: Float32Array.from([prompt.box.x0 * fx, prompt.box.y0 * fy, prompt.box.x1 * fx, prompt.box.y1 * fy]) }
      : { name: 'input_boxes', type: 'f32', shape: [1, 0, 4], data: new Float32Array(0) },
    { name: 'image_embeddings.0', kept: `${e.key}/0` },
    { name: 'image_embeddings.1', kept: `${e.key}/1` },
    { name: 'image_embeddings.2', kept: `${e.key}/2` },
  ]
  const out = await r.find.run('sam_dec', inputs, ['iou_scores', 'pred_masks'])
  const low = out.pred_masks.data
  const count = Math.min(3, out.iou_scores.data.length)
  if (!low.some((v) => v > 0) || low.some((v) => Number.isNaN(v))) throw new Error('nothing came back from the selection model')
  const res = await ask<Extract<FromPrecise, { type: 'readings' }>>((n) => ({ type: 'readings', n, job: e.key, low, count }), [low.buffer])
  return { masks: res.masks, scores: Array.from(out.iou_scores.data).slice(0, count), areas: res.areas }
}

/**
 * The reading to use: the one the model rates highest (never one that is
 * most of the picture); with clicks, of two it rates about the same, the
 * larger. Segment Anything 2.1 rates well: on the test photos its best was
 * the whole building, tree or car every time (the small model's was not).
 */
function choose(scores: number[], areas: number[], boxed: boolean): number {
  const ok = scores.map((_, i) => i).filter((i) => areas[i] < 0.85)
  const pool = ok.length ? ok : scores.map((_, i) => i)
  const top = Math.max(...pool.map((i) => scores[i]))
  if (boxed) return pool.find((i) => scores[i] === top)!
  return pool.filter((i) => scores[i] >= top - 0.05).sort((a, b) => areas[b] - areas[a])[0]
}

/** Readings ordered smallest to largest, as Selection has them. */
function bySize(masks: Uint8Array[], scores: number[], areas: number[], pick: number) {
  const order = masks.map((_, i) => i).sort((a, b) => areas[a] - areas[b])
  return { masks: order.map((i) => masks[i]), scores: order.map((i) => scores[i]), best: order.indexOf(pick) }
}

/** A grid scaled to another size, nearest cell. */
function scaleGrid(src: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / H)) * w
    for (let x = 0; x < W; x++) out[y * W + x] = src[sy + Math.min(w - 1, Math.floor(((x + 0.5) * w) / W))]
  }
  return out
}

export interface PreciseOptions {
  /** The sharper selection, when it is ready (not called if a newer selection started first). */
  onBetter?: (sel: Selection) => void
  /** What it is doing now, for the status line. */
  onStage?: (message: string | null) => void
}

let generation = 0

/** Precise selection for clicks (and a box), in fractions of the photo. */
export async function preciseSegment(photo: ImageBitmap, picks: Pick[], box: PickBox | null, parts: PrecisePart[], opts: PreciseOptions = {}): Promise<Selection | null> {
  if (!picks.length && !box) return null
  const gen = ++generation
  const r = await load(parts)
  await preparePrecise(photo, parts)
  const whole = await encoded.get(photo)!
  const W = whole.width
  const H = whole.height
  const t0 = performance.now()
  const first = await decode(r, whole, {
    points: picks.map((p) => ({ x: p.x * W, y: p.y * H, on: p.on })),
    box: box ? { x0: box.x0 * W, y0: box.y0 * H, x1: box.x1 * W, y1: box.y1 * H } : null,
  })
  const pick = choose(first.scores, first.areas, !!box)
  const sel1: Selection = { width: W, height: H, ...bySize(first.masks, first.scores, first.areas, pick), precise: true }
  track('perf', 'precise_first', r.devices.slice(0, 60), Math.round(performance.now() - t0))
  // The sharper one, in the background.
  void sharpen(gen, r, photo, picks, box, sel1, pick, first.masks[pick], opts)
  return sel1
}

async function sharpen(gen: number, r: Ready, photo: ImageBitmap, picks: Pick[], box: PickBox | null, sel1: Selection, _pick: number, mask: Uint8Array, opts: PreciseOptions) {
  const W = sel1.width
  const H = sel1.height
  const t0 = performance.now()
  const key = `c${gen}`
  try {
    // The part round what was found, from the full-size photo, with room round it.
    let x0 = W,
      y0 = H,
      x1 = -1,
      y1 = -1
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (mask[y * W + x]) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
          if (y > y1) y1 = y
        }
    if (x1 < 0) return
    if (box) {
      x0 = Math.min(x0, box.x0 * W)
      y0 = Math.min(y0, box.y0 * H)
      x1 = Math.max(x1, box.x1 * W)
      y1 = Math.max(y1, box.y1 * H)
    }
    const k = photo.width / W
    const mx = (x1 - x0) * 0.12 + 16
    const my = (y1 - y0) * 0.12 + 16
    const rect: Rect = {
      x: Math.max(0, Math.floor((x0 - mx) * k)),
      y: Math.max(0, Math.floor((y0 - my) * k)),
      width: 0,
      height: 0,
    }
    rect.width = Math.min(photo.width, Math.ceil((x1 + 1 + mx) * k)) - rect.x
    rect.height = Math.min(photo.height, Math.ceil((y1 + 1 + my) * k)) - rect.y
    if (gen !== generation) return
    opts.onStage?.('Sharpening the selection…')
    const part = await encode(r, photo, rect, CROP_SIDE, key)
    if (gen !== generation) return
    const cw = part.width
    const ch = part.height
    // The prompt in the part's pixels: the found subject's box, and the clicks that fall in the part.
    const toPart = (fx: number, fy: number) => ({ x: ((fx * photo.width - rect.x) / rect.width) * cw, y: ((fy * photo.height - rect.y) / rect.height) * ch })
    const b0 = toPart(x0 / W, y0 / H)
    const b1 = toPart((x1 + 1) / W, (y1 + 1) / H)
    const points = picks.map((p) => ({ ...toPart(p.x, p.y), on: p.on })).filter((p) => p.x >= 0 && p.y >= 0 && p.x < cw && p.y < ch)
    const second = await decode(r, part, { points, box: { x0: b0.x, y0: b0.y, x1: b1.x, y1: b1.y } })
    // Put back into the whole photo, kept at up to PRECISE_SIDE: the part sharp, the other readings as they were.
    const send = (found: Uint8Array) => {
      const k2 = Math.min(1, PRECISE_SIDE / Math.max(photo.width, photo.height))
      const FW = Math.max(1, Math.round(photo.width * k2))
      const FH = Math.max(1, Math.round(photo.height * k2))
      const full = new Uint8Array(FW * FH)
      const px = rect.x * k2
      const py = rect.y * k2
      const pw = rect.width * k2
      const ph = rect.height * k2
      for (let y = Math.max(0, Math.floor(py)); y < Math.min(FH, Math.ceil(py + ph)); y++) {
        const sy = Math.min(ch - 1, Math.floor(((y + 0.5 - py) / ph) * ch))
        if (sy < 0) continue
        for (let x = Math.max(0, Math.floor(px)); x < Math.min(FW, Math.ceil(px + pw)); x++) {
          const sx = Math.min(cw - 1, Math.floor(((x + 0.5 - px) / pw) * cw))
          if (sx >= 0) full[y * FW + x] = found[sy * cw + sx]
        }
      }
      const masks = sel1.masks.map((m, i) => (i === sel1.best ? full : scaleGrid(m, W, H, FW, FH)))
      opts.onBetter?.({ width: FW, height: FH, masks, scores: sel1.scores, best: sel1.best, precise: true, sharp: true })
    }
    let found = second.masks[choose(second.scores, second.areas, true)]
    if (gen !== generation) return
    // The closer look first (a second after the click); the traced edge replaces it when it is ready.
    send(found)
    track('perf', 'precise_zoom', r.devices.slice(0, 60), Math.round(performance.now() - t0))
    // The edge traced by BiRefNet, where it runs.
    const edgeModel = await r.edge
    if (edgeModel) {
      if (gen !== generation) return
      opts.onStage?.('Finding the edge…')
      const t1 = performance.now()
      // The same input as Segment Anything's: the part at 1024 square, normalised the same way (made again if it went to the page's runner).
      const input = part.tensor.byteLength
        ? part.tensor
        : (await ask<Extract<FromPrecise, { type: 'prepared' }>>((n) => ({ type: 'prepare', n, photo: photoId(photo), job: `${key}e`, rect, side: CROP_SIDE }))).tensor
      const out = await edgeModel.run('biref', [{ name: 'input_image', type: 'f32', shape: [1, 3, 1024, 1024], data: input }], ['output_image'])
      if (gen !== generation) return
      const edged = await ask<Extract<FromPrecise, { type: 'edged' }>>(
        (n) => ({ type: 'edge', n, job: key, mask: found, logits: out.output_image.data }),
        [out.output_image.data.buffer],
      )
      found = edged.mask
      track('perf', 'precise_edge', r.devices.slice(0, 60), Math.round(performance.now() - t1))
      if (gen !== generation) return
      send(found)
    }
    opts.onStage?.(null)
  } catch (err) {
    opts.onStage?.(null)
    if (gen === generation)
      reportIssue('Precise selection: sharpening failed', 'warning', { error: String((err as Error)?.message ?? err), devices: r.devices }, ['precise-sharpen'])
  } finally {
    ensureWorker().postMessage({ type: 'drop', job: key } satisfies ToPrecise)
    ensureWorker().postMessage({ type: 'drop', job: `${key}e` } satisfies ToPrecise)
    void r.find.forget(`${key}/`).catch(() => undefined)
  }
}

/** Lets go of the models (precise selection removed, or switched off). */
export function closePrecise(): void {
  generation++
  worker?.terminate()
  worker = null
  reset()
  for (const name of ['sam_enc', 'sam_dec', 'biref']) void invoke('ml_unload', { name, kept: '' }).catch(() => undefined)
}

/** Whether precise selection is ready to use: the models are here. */
export function preciseParts(): PrecisePart[] | null {
  const s = preciseStore.get()
  return s.kind === 'installed' ? s.parts : null
}
