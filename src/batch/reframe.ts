import { GrainEngine } from '../engine/GrainEngine'
import type { BlendParams } from '../engine/types'
import { isSupportedImageName, renderFile } from '../pipeline/render'
import { hydrateGrainSource, type GrainSource } from '../sources/GrainSource'
import { exportToFolder, findArchivedOriginal } from '../storage/archive'
import { keepPart } from '../storage/parts'
import { readRecipe } from '../storage/recipe'
import { ensureWritePermission, listImageFiles, type Folder } from './fsAccess'
import type { BatchItemResult } from './runBatch'

export interface ReframeOptions {
  /** An export folder: finals carrying their recipe, originals in Originals/. */
  dir: Folder
  /** The border to put on every export. */
  blend: BlendParams
  /** Keep each photo's own paper colour rather than the one in `blend`. */
  keepColour: boolean
  /** Put `blend`'s border on every export; off, each keeps its own. */
  border?: boolean
  /** Export size: each its own ('keep'), or all at the photo's size or Instagram's. */
  size?: 'keep' | 'original' | 'instagram'
  onProgress?: (done: number, total: number, current: string) => void
  signal?: AbortSignal
}

/**
 * Give already-exported photos a new border without touching their edit.
 *
 * Each final carries its edit; that edit gets this border (and, if asked,
 * keeps its own paper colour), is rendered again from the archived original
 * and saved over the final. Photos never edited here are skipped quietly;
 * exports whose original is not in Originals/ are reported — nothing is
 * rendered from a copy that already has the look baked in.
 */
export async function runReframe(opts: ReframeOptions): Promise<BatchItemResult[]> {
  if (!(await ensureWritePermission(opts.dir))) throw new Error('No permission to write to that folder.')
  const files = await listImageFiles(opts.dir, isSupportedImageName)
  if (files.length === 0) throw new Error('No JPEG or PNG files found in that folder.')

  const engine = new GrainEngine()
  const sources = new Map<string, GrainSource>()
  const results: BatchItemResult[] = []
  try {
    for (let i = 0; i < files.length; i++) {
      if (opts.signal?.aborted) break
      const handle = files[i]
      opts.onProgress?.(i, files.length, handle.name)
      try {
        const file = await handle.getFile()
        const recipe = await readRecipe(file)
        if (!recipe) {
          // A photo that was never edited here: nothing to re-frame.
          results.push({ filename: handle.name, status: 'skipped' })
          opts.onProgress?.(i + 1, files.length, handle.name)
          continue
        }
        const original = await findArchivedOriginal(opts.dir, recipe.original.name, recipe.original.sha256)
        if (!original) throw new Error(`original ${recipe.original.name} not found in Originals/`)

        const blend = opts.border === false ? { ...recipe.doc.blend } : keepPart('border', opts.blend, recipe.doc.blend)
        blend.border = { ...blend.border }
        if (opts.keepColour && opts.border !== false) blend.border.colour = recipe.doc.blend.border.colour
        const size = opts.size ?? 'keep'
        const output = size === 'keep' ? recipe.doc.output : { ...recipe.doc.output, size }

        const key = JSON.stringify(recipe.doc.grainSource)
        let source = sources.get(key)
        if (!source) {
          source = await hydrateGrainSource(recipe.doc.grainSource)
          sources.set(key, source)
        }
        const rendered = await renderFile(engine, original, recipe.original.name, source, blend, output)
        const saved = await exportToFolder(
          opts.dir,
          original,
          recipe.original.name,
          rendered.originalHash,
          rendered.blob,
          rendered.ext,
        )
        results.push({ filename: handle.name, status: 'ok', outputName: saved.finalName })
      } catch (err) {
        results.push({ filename: handle.name, status: 'error', message: (err as Error).message })
      }
      opts.onProgress?.(i + 1, files.length, handle.name)
    }
  } finally {
    engine.dispose()
    for (const s of sources.values()) s.dispose?.()
  }
  return results
}
