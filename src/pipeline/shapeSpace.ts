import { GrainEngine } from '../engine/GrainEngine'
import { activeBorder, type BlendParams, type EffectParams } from '../engine/types'
import type { GrainSource } from '../sources/GrainSource'
import type { PresetDoc } from '../storage/presets'
import { renderFile } from './render'

/**
 * What an old export's shapes are fractions of, read off the export itself.
 *
 * Shapes and masks were fractions of the print until the afternoon of
 * 1 November 2026, then of the photo; which one an edit used was only
 * written down from that evening (EffectParams.shapeSpace). An edit from
 * the hours between says nothing and reads as the print, so with a border
 * its shapes land a border's width off where they were drawn, and streaks
 * take their colour from the wrong side of an edge. The export shows where
 * they were: render the edit both ways and keep the one that matches it.
 *
 * Only for an edit that does not say, has shapes and a border (without one
 * the two are the same). Null when it cannot tell.
 */
export function shapeSpaceUnknown(blend: BlendParams, saved: boolean | undefined): boolean {
  if (saved !== false) return false
  const fx = blend.effects
  if (fx.shapeSpace !== 'print') return false
  if (!fx.streaks.shapes.length && !fx.masks.length) return false
  const border = activeBorder(blend)
  return border.width > 0 || border.bottomExtra > 0
}

export async function shapeSpaceFromExport(
  original: Blob,
  name: string,
  exported: Blob,
  source: GrainSource,
  doc: PresetDoc,
): Promise<EffectParams['shapeSpace'] | null> {
  const engine = new GrainEngine()
  try {
    const target = await smallPixels(exported, null)
    let best: { space: EffectParams['shapeSpace']; distance: number } | null = null
    for (const space of ['print', 'photo'] as const) {
      const blend = { ...doc.blend, effects: { ...doc.blend.effects, shapeSpace: space } }
      const rendered = await renderFile(engine, original, name, source, blend, doc.output)
      const distance = pixelDistance(target, await smallPixels(rendered.blob, target))
      if (!best || distance < best.distance) best = { space, distance }
    }
    return best?.space ?? null
  } catch {
    return null
  } finally {
    engine.dispose()
  }
}

/** Small enough to be quick, big enough that a border's width shows. */
const SIDE = 256

async function smallPixels(blob: Blob, like: ImageData | null): Promise<ImageData> {
  const full = await createImageBitmap(blob)
  const k = SIDE / Math.max(full.width, full.height)
  const width = like?.width ?? Math.max(1, Math.round(full.width * k))
  const height = like?.height ?? Math.max(1, Math.round(full.height * k))
  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(full, 0, 0, width, height)
  full.close()
  return ctx.getImageData(0, 0, width, height)
}

function pixelDistance(a: ImageData, b: ImageData): number {
  let sum = 0
  for (let i = 0; i < a.data.length; i += 4)
    sum += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
  return sum / (a.data.length / 4)
}
