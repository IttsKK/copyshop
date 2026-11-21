/**
 * The look's and the streaks' programs built once in a worker of their own,
 * waiting for each, so the browser keeps them (see shaderWarmup). Waiting
 * here holds up nothing else: the render worker goes on with its own builds
 * in the background. Next launch, the render worker's come back at once.
 */
import { GrainEngine } from './GrainEngine'
import type { LeanKind, LeanVariant } from './streakLean'

const LEAN: [LeanKind, LeanVariant][] = [
  ['table', {}],
  ['trail', {}],
  ['fill', {}],
  ['colour', {}],
  ['lines', {}],
  ['light', {}],
  ['trail', { skip: true }],
  ['fill', { skip: true }],
  ['table', { path: true }],
  ['trail', { path: true }],
  ['fill', { path: true }],
  ['colour', { path: true }],
  ['lines', { path: true }],
  ['light', { path: true }],
  ['trail', { path: true, skip: true }],
  ['fill', { path: true, skip: true }],
]

self.onmessage = () => {
  const t0 = performance.now()
  try {
    // Not in the background: each build waited for, as only those were kept.
    const engine = new GrainEngine(new OffscreenCanvas(1, 1)) as unknown as {
      lookReady: () => boolean
      leanState: (kind: LeanKind, v: LeanVariant) => string
      dispose: () => void
    }
    engine.lookReady()
    for (const [kind, v] of LEAN) engine.leanState(kind, v)
    engine.dispose()
  } catch {
    /* nothing kept this time: the render worker builds its own as ever */
  }
  ;(self as unknown as Worker).postMessage({ ms: Math.round(performance.now() - t0) })
}
