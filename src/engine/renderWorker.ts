/// <reference lib="webworker" />
import { GrainEngine, ShaderPending, setEngineReporter } from './GrainEngine'
import { setCollageImageLookup, setCollagePhoto } from './collage'
import type { CollageImage } from '../storage/collageImages'
import type { RenderRequest, Size, TextureSource } from './types'

/**
 * The preview's renders, off the page's main thread (see renderClient.ts).
 * WebGL waits for the GPU wherever a result is read back, and the streaks'
 * setup is plain JavaScript; here neither holds up a slider, a handle or the
 * page itself. Each engine is a GrainEngine on an OffscreenCanvas, exactly
 * the one the export uses, so a preview is still what the file will be.
 */

export type ToWorker =
  | { type: 'texture'; id: number; source: TextureSource }
  | { type: 'drop'; id: number }
  | { type: 'collagePhoto'; seed: number; texture: number; size: Size }
  | { type: 'collageImage'; image: CollageImage }
  /** Is the streaks' shader built yet on this engine? */
  | { type: 'ready'; engine: string }
  | {
      type: 'render'
      n: number
      engine: string
      /** While the look's shader builds, the photo as a stand-in (GrainEngine.provisional) rather than nothing. */
      provisional?: boolean
      req: Omit<RenderRequest, 'base' | 'grain'> & { base: number; grain: number }
    }

export type FromWorker =
  | { type: 'done'; n: number; bitmap: ImageBitmap; ms: number; streaksLeftOut: boolean; streaksFailed: boolean; provisional?: boolean }
  | { type: 'failed'; n: number; error: string }
  /** The look's shader is still being built: nothing drawn, ask again. */
  | { type: 'pending'; n: number }
  | { type: 'ready'; engine: string; streaks: boolean; look: boolean }
  /** Something to report (the page sends it to Sentry): a lost GPU context, an error nothing caught. */
  | { type: 'notice'; level: 'warning' | 'error'; message: string; extra?: Record<string, unknown> }

const scope = self as unknown as DedicatedWorkerGlobalScope
const engines = new Map<string, GrainEngine>()
const textures = new Map<number, TextureSource>()
const collageImages = new Map<string, CollageImage>()
setCollageImageLookup((id) => collageImages.get(id) ?? null)
setEngineReporter((level, message, extra) => scope.postMessage({ type: 'notice', level, message: `Render worker: ${message}`, extra } satisfies FromWorker))

const engineFor = (name: string): GrainEngine => {
  let engine = engines.get(name)
  if (!engine) {
    // Shaders build in the background here: a render that would wait for one says so instead (pending).
    engine = new GrainEngine(new OffscreenCanvas(1, 1), { background: true })
    engines.set(name, engine)
  }
  return engine
}

const render = (m: Extract<ToWorker, { type: 'render' }>): FromWorker => {
  const base = textures.get(m.req.base)
  const grain = textures.get(m.req.grain)
  if (!base || !grain) return { type: 'failed', n: m.n, error: 'The render lost its photo or grain.' }
  const req: RenderRequest = { ...m.req, base, grain }
  const started = performance.now()
  for (let attempt = 0; ; attempt++) {
    let engine = engineFor(m.engine)
    // Lost between renders (Windows resets a GPU that takes too long, or a
    // driver updates): drawing on it draws nothing and says nothing, so a
    // fresh engine first.
    if (engine.isContextLost()) {
      scope.postMessage({ type: 'notice', level: 'warning', message: 'Render worker: the GPU context was lost between renders', extra: { engine: m.engine } } satisfies FromWorker)
      engine.dispose()
      engines.delete(m.engine)
      engine = engineFor(m.engine)
    }
    try {
      const canvas = engine.render(req) as OffscreenCanvas
      // Timed to the GPU's finish (waiting is free here, off the page's
      // thread): what the preview sizes its drafts by.
      engine.waitForGpu()
      // Lost during the render: its picture is blank, not this edit.
      if (engine.isContextLost()) throw new Error('The GPU context was lost during the render.')
      return { type: 'done', n: m.n, bitmap: canvas.transferToImageBitmap(), ms: performance.now() - started, streaksLeftOut: engine.streaksLeftOut, streaksFailed: engine.streaksFailed }
    } catch (err) {
      if (err instanceof ShaderPending) {
        if (!m.provisional) return { type: 'pending', n: m.n }
        const stand = engine.provisional(req)
        return { type: 'done', n: m.n, bitmap: stand.transferToImageBitmap(), ms: performance.now() - started, streaksLeftOut: false, streaksFailed: false, provisional: true }
      }
      // A lost context (the GPU reset, or the system took it back) is not this
      // render's fault: a fresh engine, once.
      const lost = engine.isContextLost()
      if (lost) {
        scope.postMessage({ type: 'notice', level: attempt > 0 ? 'error' : 'warning', message: 'Render worker: the GPU context was lost', extra: { attempt, engine: m.engine, error: (err as Error).message } } satisfies FromWorker)
        engine.dispose()
        engines.delete(m.engine)
      }
      if (!lost || attempt > 0) return { type: 'failed', n: m.n, error: (err as Error).message }
    }
  }
}

scope.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data
  switch (m.type) {
    case 'texture':
      textures.set(m.id, m.source)
      break
    case 'drop': {
      const t = textures.get(m.id)
      textures.delete(m.id)
      if (t && 'close' in t && typeof t.close === 'function') t.close()
      break
    }
    case 'collagePhoto': {
      const photo = textures.get(m.texture)
      if (photo) setCollagePhoto(m.seed, photo as CanvasImageSource, m.size)
      break
    }
    case 'collageImage':
      collageImages.set(m.image.id, m.image)
      break
    case 'ready': {
      // Whether the streaks' shader is built yet (asking never waits).
      const engine = engines.get(m.engine)
      scope.postMessage({ type: 'ready', engine: m.engine, streaks: !!engine && engine.streaksReady(), look: !!engine && engine.lookReady() } satisfies FromWorker)
      break
    }
    case 'render': {
      const out = render(m)
      scope.postMessage(out, out.type === 'done' ? [out.bitmap] : [])
      break
    }
  }
}

// Anything that slipped past a render's own handling still reaches Sentry.
scope.addEventListener('unhandledrejection', (e) =>
  scope.postMessage({ type: 'notice', level: 'error', message: `Render worker: ${String(e.reason?.message ?? e.reason)}`, extra: { stack: String(e.reason?.stack ?? '') } } satisfies FromWorker),
)
