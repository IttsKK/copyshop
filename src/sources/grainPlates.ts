import { generateGrainPlate, type ProceduralGrainParams } from './generateGrain'
import { reportIssue } from '../platform/telemetry'

/**
 * Generated grain plates, made in a worker and kept. A 1024 plate is about a
 * quarter of a second of arithmetic: on the page's thread it froze the app
 * each time a photo opened (every photo's edit brings a new source with the
 * same grain). The last few plates are kept by their settings, so opening
 * another photo with the same grain costs nothing. Small plates (recipe
 * thumbnails) are quick enough to make here.
 */

const KEEP = 6
const SMALL = 256
const kept = new Map<string, Promise<ImageData>>()

let worker: Worker | null = null
let failed = false
let next = 1
const waiting = new Map<number, { resolve: (p: ImageData) => void; reject: (e: Error) => void }>()

function ensureWorker(): Worker | null {
  if (worker || failed || typeof Worker === 'undefined') return worker
  try {
    worker = new Worker(new URL('./grainWorker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (e: MessageEvent<{ id: number; plate?: ImageData; error?: string }>) => {
      const job = waiting.get(e.data.id)
      if (!job) return
      waiting.delete(e.data.id)
      if (e.data.plate) job.resolve(e.data.plate)
      else job.reject(new Error(e.data.error ?? 'Grain could not be made'))
    }
    worker.onerror = (e) => {
      // Made here from now on; anything waiting is made here too.
      reportIssue('Grain worker crashed; making grain on the page from now on', 'error', { error: e.message, at: `${e.lineno}:${e.colno}`, waiting: waiting.size }, ['grain-worker', 'crashed'])
      failed = true
      worker?.terminate()
      worker = null
      for (const job of waiting.values()) job.reject(new Error('The grain worker stopped.'))
      waiting.clear()
    }
  } catch {
    failed = true
  }
  return worker
}

function make(params: ProceduralGrainParams): Promise<ImageData> {
  const w = Math.round(params.size) > SMALL ? ensureWorker() : null
  if (!w) return Promise.resolve().then(() => generateGrainPlate(params))
  const id = next++
  return new Promise<ImageData>((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    w.postMessage({ id, params })
  }).catch(() => generateGrainPlate(params))
}

/** The plate for these settings: kept, or made off the page's thread. */
export function grainPlate(params: ProceduralGrainParams): Promise<ImageData> {
  const key = JSON.stringify(params)
  const have = kept.get(key)
  if (have) {
    // Most recently used last.
    kept.delete(key)
    kept.set(key, have)
    return have
  }
  const made = make(params)
  kept.set(key, made)
  made.catch(() => kept.delete(key))
  while (kept.size > KEEP) kept.delete(kept.keys().next().value!)
  return made
}
