/**
 * Select a subject by clicking it: EdgeTAM (a small Segment Anything model,
 * onnx-community/EdgeTAM-ONNX) run on this machine, on the GPU where there is
 * one. Nothing leaves the computer: the model and its runtime ship with the
 * app (public/models, public/ort), and remote models are switched off.
 *
 * The photo is worked out once (its embedding, ~0.3 s); each click after
 * that is a quick decode. The model gives three readings of a click, from a
 * small part to the whole object, for the caller to choose between.
 *
 * The model runs in a worker (segmentWorker.ts), never on the page's thread:
 * on the CPU it can take many seconds, and the window has to keep working.
 * A run that never answers stops the worker; the next one starts a new
 * worker, on the CPU if the stuck run was on the GPU.
 */

import { Sentry, reportIssue } from '../platform/telemetry'
import type { FromSegmenter, ToSegmenter } from './segmentWorker'

export interface Pick {
  /** Fractions of the photo. */
  x: number
  y: number
  /** A part of the subject (true), or a part to leave out. */
  on: boolean
}

export interface Selection {
  width: number
  height: number
  /** Three readings, 1 inside; ordered smallest to largest area. */
  masks: Uint8Array[]
  /** The model's confidence in each, same order. */
  scores: number[]
  /** The reading the model rates best (index into masks). */
  best: number
  /** From precise selection (src/ml/precise): `best` is the one to use, and it is already tidy. */
  precise?: boolean
  /** Precise selection's sharper answer: masks[best] traced at the subject's own scale (up to PRECISE_SIDE). */
  sharp?: boolean
}

/** Precise selection's models, when they are here (the desktop app, once downloaded): it is used instead. */
async function precise() {
  const { preciseStore } = await import('./precise/models')
  const s = preciseStore.get()
  return s.kind === 'installed' ? { parts: s.parts, mod: await import('./precise/precise') } : null
}

/** A box dragged round the subject, in fractions of the photo. */
export interface PickBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * How long a request may take before the worker is taken to be stuck: the
 * first loads the model and works the photo out (slow on the CPU of an old
 * machine), later clicks are quick.
 */
const FIRST_MS = 180_000
const CLICK_MS = 120_000

let worker: Worker | null = null
/** Where the model runs in the current worker. */
let device: string | null = null
/**
 * The model runs on the CPU from the start on phones and tablets (a touch
 * screen), and later ones use it after a worker on the GPU stopped answering
 * or crashed. A phone ends a page that takes more memory than it allows, and
 * the CPU's way has the lower peak: its runtime build is half the size, and
 * nothing goes through the GPU (measured in WebKit, Nov 22: about 520 MB at
 * most, against 1.15 GB on WebGPU). Slower to select, and phones say so.
 */
let cpuOnly = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
/** Workers that crashed or got stuck: past a few, selecting is switched off. */
let deaths = 0
let n = 0
const waiting = new Map<number, { resolve: (s: Selection | null) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()
let photoIds = new WeakMap<ImageBitmap, number>()
let prepared = new WeakMap<ImageBitmap, Promise<void>>()
let nextPhoto = 1

function receive(m: FromSegmenter): void {
  switch (m.type) {
    case 'stage':
      Sentry.addBreadcrumb({ category: 'selection', message: m.message, level: 'info' })
      return
    case 'notice':
      reportIssue(m.message, m.level, { device, ...m.extra }, ['selection', m.message])
      return
    case 'device':
      device = m.device
      Sentry.setTag('selection.device', m.device)
      if (m.gpu) Sentry.setTag('gpu', m.gpu.slice(0, 200))
      return
    case 'done':
    case 'failed': {
      const w = waiting.get(m.n)
      if (!w) return
      waiting.delete(m.n)
      clearTimeout(w.timer)
      if (m.type === 'done') w.resolve(m.sel)
      else w.reject(new Error(m.error))
    }
  }
}

/** The worker is gone (crashed or stuck): everything waiting on it fails, and the next request starts afresh. */
function lose(why: string, extra: Record<string, unknown> = {}): void {
  const was = worker
  worker = null
  was?.terminate()
  deaths++
  if (device === 'webgpu') cpuOnly = true
  reportIssue(`Selection worker ${why}`, 'error', { device, deaths, waiting: waiting.size, ...extra }, ['selection-worker', why])
  device = null
  photoIds = new WeakMap()
  prepared = new WeakMap()
  for (const w of waiting.values()) {
    clearTimeout(w.timer)
    w.reject(new Error(why === 'took too long' ? 'Selecting took too long and was stopped. Try again.' : 'The selection model stopped. Try again.'))
  }
  waiting.clear()
}

/**
 * Done selecting for now: the model and its copy of the photo go with their
 * worker, freeing their memory for drawing (a phone runs out with both). The
 * next selection loads the model again. Not while a selection is running.
 */
export function releaseSegmenter(): void {
  const was = worker
  if (!was || waiting.size) return
  worker = null
  was.terminate()
  device = null
  photoIds = new WeakMap()
  prepared = new WeakMap()
}

function ensureWorker(): Worker {
  if (worker) return worker
  if (deaths >= 3) throw new Error('Selecting is not working on this computer right now. Reload the page to try again.')
  const w = new Worker(new URL('./segmentWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<FromSegmenter>) => worker === w && receive(e.data)
  w.onerror = (e) => {
    e.preventDefault()
    if (worker === w) lose('crashed', { error: e.message, at: `${e.lineno}:${e.colno}` })
  }
  w.onmessageerror = () => worker === w && lose('sent a message that could not be read')
  worker = w
  send({ type: 'init', cpuOnly })
  return w
}

function send(m: ToSegmenter, transfer: Transferable[] = []): void {
  worker?.postMessage(m, transfer)
}

function request(make: (n: number) => ToSegmenter, ms: number): Promise<Selection | null> {
  ensureWorker()
  const id = ++n
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => lose('took too long', { seconds: ms / 1000 }), ms)
    waiting.set(id, { resolve, reject, timer })
    send(make(id))
  })
}

/** The worker's id for this photo, sending it a copy the first time. */
function photoId(photo: ImageBitmap): number {
  ensureWorker()
  let id = photoIds.get(photo)
  if (!id) {
    id = nextPhoto++
    photoIds.set(photo, id)
    // A copy: the page keeps drawing with its own.
    send({ type: 'photo', photo: id, bitmap: photo })
  }
  return id
}

/** Where the model runs, once loaded ('webgpu' or 'wasm'). */
export const segmenterDevice = async () => device

/** Works the photo out ahead of the first click (and loads the model, the first time). */
export async function prepareSegmenter(photo: ImageBitmap): Promise<void> {
  const p = await precise()
  if (p) {
    try {
      return await p.mod.preparePrecise(photo, p.parts)
    } catch (err) {
      reportIssue('Precise selection: could not start; the small model instead', 'warning', { error: String((err as Error)?.message ?? err) }, ['precise-start'])
    }
  }
  return prepareSmall(photo)
}

function prepareSmall(photo: ImageBitmap): Promise<void> {
  let job = prepared.get(photo)
  if (!job) {
    try {
      const id = photoId(photo)
      job = request((n) => ({ type: 'prepare', n, photo: id }), FIRST_MS).then(() => undefined)
    } catch (err) {
      job = Promise.reject(err)
    }
    prepared.set(photo, job)
    const p = job
    job.catch(() => prepared.get(photo) === p && prepared.delete(photo))
  }
  return job
}

export interface SegmentOptions {
  /** Precise selection's sharper answer, when it is ready. */
  onBetter?: (sel: Selection) => void
  /** What precise selection is doing now (null: done), for the status line. */
  onStage?: (message: string | null) => void
}

/** The subject the picks (and a box round it, if one was dragged) point at, three ways. */
export async function segment(photo: ImageBitmap, picks: Pick[], box: PickBox | null = null, opts: SegmentOptions = {}): Promise<Selection | null> {
  if (!picks.length && !box) return null
  const p = await precise()
  if (p) {
    try {
      return await p.mod.preciseSegment(photo, picks, box, p.parts, opts)
    } catch (err) {
      reportIssue('Precise selection: failed; the small model instead', 'warning', { error: String((err as Error)?.message ?? err) }, ['precise-segment'])
    }
  }
  await prepareSmall(photo)
  const id = photoId(photo)
  return request((n) => ({ type: 'segment', n, photo: id, picks, box }), CLICK_MS)
}

/**
 * Which reading to use when the user has not chosen: one click is ambiguous
 * (a window, the wall, the house), and a click is nearly always meant for
 * the whole thing, so the largest that is not most of the photo; with more
 * picks the model knows what is meant, so its best.
 */
export function defaultReading(sel: Selection, picks: number): number {
  if (picks > 1) return sel.best
  const size = sel.width * sel.height
  for (let i = sel.masks.length - 1; i >= 0; i--) {
    let area = 0
    const m = sel.masks[i]
    for (let j = 0; j < size; j += 7) area += m[j]
    if ((area * 7) / size < 0.6) return i
  }
  return 0
}
