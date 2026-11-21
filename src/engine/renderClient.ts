import { GrainEngine, setEngineReporter } from './GrainEngine'
import { collageImageNow } from '../storage/collageImages'
import type { RenderRequest, TextureSource } from './types'
import type { FromWorker, ToWorker } from './renderWorker'
import { reportIssue } from '../platform/telemetry'
import { warmShaderCache } from './shaderWarmup'

/**
 * Renders for the preview, in a worker (renderWorker.ts) so the page's main
 * thread never waits on one: sliders, handles and scrolling keep moving
 * while the GPU works, and each picture is drawn when it arrives.
 *
 * Requests go in lanes (the view, the loupe, the backdrop...). In each lane
 * only the newest waiting request is kept: while one renders, the next edit
 * replaces whatever was queued behind it, so a fast drag never builds up a
 * backlog — a replaced request resolves to null. Engines are named apart
 * from lanes: the view and the loupe share the main engine and its caches.
 *
 * Where a worker cannot render (no OffscreenCanvas WebGL2), the same calls
 * run here on the main thread, as before.
 */

export interface Rendered {
  bitmap: ImageBitmap
  /** How long the render itself took, to the GPU's finish (not the wait for its turn). */
  ms: number
  /**
   * A stand-in while the look's shader builds: the photo as it is, on its
   * paper (GrainEngine.provisional). Not to be kept as the render: the
   * 'grain:graphics-ready' event says when to ask again.
   */
  provisional?: boolean
}

interface Job {
  engine: string
  req: RenderRequest
  provisional?: boolean
  resolve: (r: Rendered | null) => void
  reject: (err: Error) => void
}

interface Lane {
  busy: boolean
  queued: Job | null
}

/**
 * Whether the GPU is still building the shaders, for a note on the preview.
 * look: the first one (nothing can be drawn yet); streaks: the one with
 * streaks (the photo is drawn without them meanwhile), or 'failed' when this
 * GPU could not build it. On Windows these builds take from seconds to
 * minutes (see GrainEngine.background).
 */
export interface GraphicsState {
  look: 'ready' | 'preparing'
  streaks: 'ready' | 'preparing' | 'failed'
}
let graphics: GraphicsState = { look: 'ready', streaks: 'ready' }
const graphicsListeners = new Set<() => void>()
const setGraphics = (next: Partial<GraphicsState>) => {
  if (Object.entries(next).every(([k, v]) => graphics[k as keyof GraphicsState] === v)) return
  graphics = { ...graphics, ...next }
  graphicsListeners.forEach((l) => l())
}
export const graphicsState = {
  get: (): GraphicsState => graphics,
  subscribe(l: () => void): () => void {
    graphicsListeners.add(l)
    return () => graphicsListeners.delete(l)
  },
}

const canClone = (s: TextureSource): boolean =>
  (typeof ImageBitmap !== 'undefined' && s instanceof ImageBitmap) || (typeof ImageData !== 'undefined' && s instanceof ImageData)

// The page's own engines (exports, and renders where the worker can't).
setEngineReporter((level, message, extra) => reportIssue(`${message} (on the page)`, level, extra, ['engine', message]))

class RenderClient {
  private worker: Worker | null = null
  private failedWorker = false
  private local = new Map<string, GrainEngine>()
  private lanes = new Map<string, Lane>()
  private n = 0
  private waiting = new Map<number, { resolve: (r: Rendered | null) => void; reject: (err: Error) => void; started: number; engine: string; again: () => void }>()
  /** Engines whose last render left streaks out while their shader builds. */
  private streaksWaiting = new Set<string>()
  /** Engines that drew a stand-in (Rendered.provisional): asked until their look's shader is built. */
  private lookWaiting = new Set<string>()
  private readyTimer: ReturnType<typeof setTimeout> | null = null
  private ids = new WeakMap<object, number>()
  private nextId = 1
  /** Sources being copied for the worker (a canvas becomes an ImageBitmap first). */
  private sending = new WeakMap<object, Promise<number>>()
  private collageSent = new WeakSet<object>()
  private released = typeof FinalizationRegistry !== 'undefined'
    ? new FinalizationRegistry<number>((id) => this.post({ type: 'drop', id }))
    : null

  private ensureWorker(): Worker | null {
    if (this.worker || this.failedWorker) return this.worker
    try {
      if (typeof OffscreenCanvas === 'undefined' || !('transferToImageBitmap' in OffscreenCanvas.prototype)) throw new Error('no OffscreenCanvas')
      this.worker = new Worker(new URL('./renderWorker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data)
      this.worker.onerror = (e) => {
        reportIssue('Render worker crashed; rendering on the page from now on', 'error', { error: e.message, at: `${e.lineno}:${e.colno}`, waiting: this.waiting.size }, ['render-worker', 'crashed'])
        this.abandonWorker()
      }
      this.worker.onmessageerror = () => {
        reportIssue('Render worker sent a message that could not be read', 'error', undefined, ['render-worker', 'messageerror'])
        this.abandonWorker()
      }
    } catch {
      this.failedWorker = true
      this.worker = null
    }
    return this.worker
  }

  /** The worker failed to start or crashed: every waiting render and every later one runs here. */
  private abandonWorker(): void {
    this.worker?.terminate()
    this.worker = null
    this.failedWorker = true
    for (const w of this.waiting.values()) w.reject(new Error('The render worker stopped.'))
    this.waiting.clear()
  }

  private post(m: ToWorker, transfer: Transferable[] = []): void {
    this.worker?.postMessage(m, transfer)
  }

  private receive(m: FromWorker): void {
    if (m.type === 'notice') {
      reportIssue(m.message, m.level, m.extra, ['render-worker', m.message])
      return
    }
    // A render this slow is what a slow open or a stuck slider is made of.
    if (m.type === 'done' && m.ms > 4000) reportIssue('Slow render', m.ms > 15_000 ? 'error' : 'warning', { seconds: Math.round(m.ms / 100) / 10 }, ['slow-render'])
    if (m.type === 'failed') reportIssue(`Render failed: ${m.error}`, 'error', undefined, ['render-failed', m.error.replace(/\d+/g, '#').slice(0, 100)])
    if (m.type === 'ready') {
      const lookWas = this.lookWaiting.size
      const streaksWas = this.streaksWaiting.size
      if (m.look) this.lookWaiting.delete(m.engine)
      if (m.streaks) this.streaksWaiting.delete(m.engine)
      let again = false
      if (lookWas && !this.lookWaiting.size) {
        setGraphics({ look: 'ready' })
        again = true
      }
      if (streaksWas && !this.streaksWaiting.size) {
        setGraphics({ streaks: 'ready' })
        again = true
      }
      if (this.lookWaiting.size || this.streaksWaiting.size) this.askReady()
      // The stand-ins, and the pictures drawn without streaks, are drawn again.
      if (again) window.dispatchEvent(new Event('grain:graphics-ready'))
      return
    }
    const w = this.waiting.get(m.n)
    if (!w) return
    if (m.type === 'pending') {
      // Nothing drawn yet: the same render again shortly, the caller still waiting.
      setGraphics({ look: 'preparing' })
      setTimeout(w.again, 250)
      return
    }
    this.waiting.delete(m.n)
    if (m.type === 'done' && m.provisional) {
      // The photo as a stand-in: the look's shader is still building.
      setGraphics({ look: 'preparing' })
      this.lookWaiting.add(w.engine)
      this.askReady()
      w.resolve({ bitmap: m.bitmap, ms: m.ms, provisional: true })
      return
    }
    if (m.type === 'done') {
      setGraphics({ look: 'ready' })
      // The look has drawn: its programs and the streaks' are built again in
      // a worker of their own (shaderWarmup), so Windows keeps them for next launch.
      if (/Windows/.test(navigator.userAgent)) warmShaderCache()
      if (m.streaksFailed) setGraphics({ streaks: 'failed' })
      else if (!m.streaksLeftOut) {
        this.streaksWaiting.delete(w.engine)
        if (!this.streaksWaiting.size) setGraphics({ streaks: 'ready' })
      } else {
        setGraphics({ streaks: 'preparing' })
        this.streaksWaiting.add(w.engine)
        this.askReady()
      }
      w.resolve({ bitmap: m.bitmap, ms: m.ms })
    } else w.reject(new Error(m.error))
  }

  /** Asks, in a moment, whether the waiting engines' streak shaders are built. */
  private askReady(): void {
    if (this.readyTimer) return
    this.readyTimer = setTimeout(() => {
      this.readyTimer = null
      for (const engine of new Set([...this.streaksWaiting, ...this.lookWaiting])) this.post({ type: 'ready', engine })
    }, 1000)
  }

  /** The worker's id for a texture source, sending it the first time. */
  private textureId(source: TextureSource): Promise<number> {
    const known = this.ids.get(source)
    if (known) return Promise.resolve(known)
    let sending = this.sending.get(source)
    if (!sending) {
      sending = (async () => {
        const id = this.nextId++
        // An ImageBitmap or ImageData is copied as it is; a canvas or an
        // image becomes an ImageBitmap of its pixels, unconverted.
        const copy = canClone(source)
          ? source
          : await createImageBitmap(source as ImageBitmapSource, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
        this.post({ type: 'texture', id, source: copy })
        this.ids.set(source, id)
        this.released?.register(source, id, source)
        return id
      })()
      this.sending.set(source, sending)
    }
    return sending
  }

  /** The collage's photo and images, which the worker cannot load itself. */
  private async sendCollage(req: RenderRequest, base: number): Promise<void> {
    const collage = req.params.effects.collage
    if (!collage?.enabled || !collage.pieces.length || req.imageSeed === undefined) return
    // Every time: the worker keeps a few photos' analyses and may have let
    // this one go; for one it has, it costs nothing.
    this.post({ type: 'collagePhoto', seed: req.imageSeed, texture: base, size: req.baseSize })
    for (const piece of collage.pieces) {
      const img = collageImageNow(piece.image)
      if (img && !this.collageSent.has(img)) {
        this.collageSent.add(img)
        this.post({ type: 'collageImage', image: img })
      }
    }
  }

  private async run(job: Job): Promise<Rendered | null> {
    const worker = this.ensureWorker()
    if (!worker) {
      let engine = this.local.get(job.engine)
      if (!engine) {
        engine = new GrainEngine()
        this.local.set(job.engine, engine)
      }
      const started = performance.now()
      const out = engine.render(job.req)
      return { bitmap: await createImageBitmap(out as ImageBitmapSource), ms: performance.now() - started }
    }
    const started = performance.now()
    const [base, grain] = await Promise.all([this.textureId(job.req.base), this.textureId(job.req.grain)])
    await this.sendCollage(job.req, base)
    if (!this.worker) return this.run(job)
    const n = ++this.n
    const { base: _b, grain: _g, ...rest } = job.req
    try {
      return await new Promise<Rendered | null>((resolve, reject) => {
        const message: ToWorker = { type: 'render', n, engine: job.engine, req: { ...rest, base, grain }, ...(job.provisional ? { provisional: true } : {}) }
        this.waiting.set(n, { resolve, reject, started, engine: job.engine, again: () => this.post(message) })
        this.post(message)
      })
    } catch (err) {
      // No WebGL2 in workers here, or the worker stopped: render on this thread.
      if (this.worker && !/WebGL2 is not available/.test((err as Error).message)) throw err
      if (this.worker) this.abandonWorker()
      return this.run(job)
    }
  }

  private pump(name: string, lane: Lane): void {
    const job = lane.queued
    if (lane.busy || !job) return
    lane.queued = null
    lane.busy = true
    this.run(job)
      .then(job.resolve, job.reject)
      .finally(() => {
        lane.busy = false
        this.pump(name, lane)
      })
  }

  /**
   * Render req on the named engine, in a lane: resolves to the picture, or to
   * null if a newer request in the same lane replaced it before it started.
   */
  render(lane: string, engine: string, req: RenderRequest, opts: { provisional?: boolean } = {}): Promise<Rendered | null> {
    let l = this.lanes.get(lane)
    if (!l) {
      l = { busy: false, queued: null }
      this.lanes.set(lane, l)
    }
    l.queued?.resolve(null)
    const queued: Job = { engine, req, provisional: opts.provisional, resolve: () => undefined, reject: () => undefined }
    const done = new Promise<Rendered | null>((resolve, reject) => {
      queued.resolve = resolve
      queued.reject = reject
    })
    l.queued = queued
    this.pump(lane, l)
    return done
  }

  /** Done with a source sent to the worker: its copy there goes too. */
  release(source: TextureSource): void {
    const id = this.ids.get(source)
    if (!id) return
    this.ids.delete(source)
    this.sending.delete(source)
    this.released?.unregister(source)
    this.post({ type: 'drop', id })
  }

  /** Whether a lane has a render running or waiting. */
  busy(lane: string): boolean {
    const l = this.lanes.get(lane)
    return !!l && (l.busy || !!l.queued)
  }
}

/** The one client: one worker, its engines and the textures sent to it. */
export const renderClient = new RenderClient()
