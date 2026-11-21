import { GrainEngine } from '../engine/GrainEngine'
import { printSizeOf, type BlendParams, type Size, type TextureSource } from '../engine/types'
import type { GrainSource, GrainTexture } from '../sources/GrainSource'

/**
 * A saved look, not a saved image.
 *
 * Storing the settings rather than a rendered frame means a snapshot compares
 * correctly at any zoom or pan position — it is re-rendered through the same
 * engine as the live image, at the same region — and costs a few hundred bytes
 * instead of a full-resolution buffer.
 */
export interface Snapshot {
  id: string
  name: string
  createdAt: number
  blend: BlendParams
  source: GrainSource
  /**
   * Its grain, made from `source` when it is first wanted (compared): a
   * snapshot read back at startup has none yet, as making them all held the
   * app up for seconds before the photo showed.
   */
  grain: GrainTexture | null
  /** Small data URL for the list. */
  thumb: string
  /** The photo it was taken on (its SHA-256). Kept for reference; the list shows every snapshot on every photo. */
  photo?: string
}

let thumbEngine: GrainEngine | null = null

const THUMB_WIDTH = 216

export function createSnapshot(
  name: string,
  source: GrainSource,
  grain: GrainTexture,
  blend: BlendParams,
  base: TextureSource,
  baseSize: Size,
  imageSeed?: number,
): Snapshot {
  thumbEngine ??= new GrainEngine()
  const printed = printSizeOf(baseSize, blend)
  const scale = Math.min(1, THUMB_WIDTH / printed.width)
  const canvas = thumbEngine.render({
    base,
    baseSize,
    grain: grain.source,
    grainSize: grain.size,
    grainMean: grain.mean,
    grainSd: grain.sd,
    params: blend,
    imageSeed,
    outputSize: {
      width: Math.max(1, Math.round(printed.width * scale)),
      height: Math.max(1, Math.round(printed.height * scale)),
    },
  })
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    blend,
    source,
    grain,
    thumb: (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.7),
  }
}

/** When it was taken: the time today, else the day and time. */
export function describeSnapshot(snapshot: Snapshot, now = new Date()): string {
  const at = new Date(snapshot.createdAt)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  if (at.toDateString() === now.toDateString()) return `Today, ${time}`
  return `${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}`
}

/** The next free "Snapshot N": one more than the highest, so a deleted one's number isn't given out twice. */
export function nextSnapshotName(snapshots: Snapshot[]): string {
  const n = Math.max(0, ...snapshots.map((s) => Number(/^Snapshot (\d+)$/.exec(s.name)?.[1] ?? 0)))
  return `Snapshot ${n + 1}`
}
