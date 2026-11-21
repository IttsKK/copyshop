import { DEFAULT_CROP } from '../engine/crop'
import { GrainEngine } from '../engine/GrainEngine'
import type { BlendParams } from '../engine/types'
import { isSupportedImageName, renderFile } from '../pipeline/render'
import type { GrainSource } from '../sources/GrainSource'
import type { OutputSettings } from '../storage/presets'
import { ensureWritePermission, listImageFiles, type Folder } from './fsAccess'

export interface BatchItemResult {
  filename: string
  /** Skipped: not something this run applies to (e.g. a photo that was never edited). */
  status: 'ok' | 'error' | 'skipped'
  outputName?: string
  message?: string
}

export interface BatchOptions {
  inputDir: Folder
  outputDir: Folder
  source: GrainSource
  blend: BlendParams
  output: OutputSettings
  onProgress?: (done: number, total: number, current: string) => void
  signal?: AbortSignal
}

/**
 * Batch is not a second implementation of export — it is a loop around the
 * same renderFile() the single export button calls, which itself is a loop
 * around the same GrainEngine the preview uses.
 */
export async function runBatch(opts: BatchOptions): Promise<BatchItemResult[]> {
  if (!(await ensureWritePermission(opts.outputDir))) {
    throw new Error('Write permission for the output folder was denied.')
  }
  const files = await listImageFiles(opts.inputDir, isSupportedImageName)
  if (files.length === 0) {
    throw new Error('No photos found in the input folder.')
  }

  const engine = new GrainEngine()
  const results: BatchItemResult[] = []
  // A crop is drawn on one photo; a batch's photos are each framed by the
  // export's shape instead (see exportSize.ts).
  const blend = { ...opts.blend, effects: { ...opts.blend.effects, crop: DEFAULT_CROP } }
  try {
    for (let i = 0; i < files.length; i++) {
      if (opts.signal?.aborted) break
      const handle = files[i]
      opts.onProgress?.(i, files.length, handle.name)
      try {
        const file = await handle.getFile()
        const rendered = await renderFile(engine, file, handle.name, opts.source, blend, opts.output)
        await opts.outputDir.write(rendered.filename, rendered.blob)
        results.push({ filename: handle.name, status: 'ok', outputName: rendered.filename })
      } catch (err) {
        results.push({ filename: handle.name, status: 'error', message: (err as Error).message })
      }
      opts.onProgress?.(i + 1, files.length, handle.name)
    }
  } finally {
    engine.dispose()
  }
  return results
}
