import type { GrainSource, GrainTexture, SerializedGrainSource } from './GrainSource'
import { registerGrainSourceKind } from './GrainSource'
import { PLATE_STORE, get, getAll, newId, put, remove, type PlateRecord } from '../storage/db'
import { decodeValues } from '../pipeline/decode'

export const PLATE_KIND = 'plate'

/**
 * v1's only grain source: a scanned grain plate the user dropped in, kept in
 * IndexedDB so it survives reloads and can be referenced by presets.
 */
export interface PlateStats {
  mean: number
  sd: number
}

/**
 * Average density and contrast of a plate, measured on the real pixels.
 *
 * Both matter: the mean because every blend mode is neutral at 0.5 and a scan
 * is rarely centred there, the deviation because it is what "amount" is
 * actually scaling. Measuring on a downscaled copy would give the right mean
 * and a meaningless sd — averaging is exactly what destroys grain.
 */
function measurePlate(bitmap: ImageBitmap): PlateStats {
  // Cap the working size: a full 24MP plate is not needed to estimate two
  // numbers, and getImageData on one is slow.
  const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!
  // Nearest-neighbour: sample the plate's own pixels rather than averages of
  // them, so the measured contrast is the grain's, not the resampler's.
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(bitmap, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let i = 0; i < data.length; i += 4) {
    const v = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    sum += v
    sumSq += v * v
    n++
  }
  const mean = sum / n
  return { mean, sd: Math.sqrt(Math.max(0, sumSq / n - mean * mean)) }
}

export class PlateSource implements GrainSource {
  readonly kind = PLATE_KIND
  private bitmap: ImageBitmap | null = null
  private stats: PlateStats | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    private readonly blob: Blob,
    private readonly width: number,
    private readonly height: number,
  ) {}

  async getTexture(): Promise<GrainTexture> {
    if (!this.bitmap) {
      this.bitmap = await decodeValues(this.blob, this.name)
    }
    this.stats ??= measurePlate(this.bitmap)
    return {
      source: this.bitmap,
      size: { width: this.width, height: this.height },
      mean: this.stats.mean,
      sd: this.stats.sd,
    }
  }

  serialize(): SerializedGrainSource {
    return { kind: this.kind, id: this.id, name: this.name }
  }

  dispose(): void {
    this.bitmap?.close()
    this.bitmap = null
    this.stats = null
  }

  static fromRecord(record: PlateRecord): PlateSource {
    return new PlateSource(record.id, record.name, record.blob, record.width, record.height)
  }
}

/** Import a plate file into the library and return it as a source. */
export async function importPlateFile(file: File | Blob, name: string, fileName = ''): Promise<PlateSource> {
  const bitmap = await decodeValues(file, fileName)
  const record: PlateRecord = {
    id: newId('plate'),
    name,
    blob: file,
    width: bitmap.width,
    height: bitmap.height,
    createdAt: Date.now(),
  }
  bitmap.close()
  // Saving may be a no-op when storage is unavailable; the plate still works
  // for this session, it just will not be there next time.
  await put(PLATE_STORE, record)
  return PlateSource.fromRecord(record)
}

export async function listPlates(): Promise<PlateSource[]> {
  const records = await getAll<PlateRecord>(PLATE_STORE)
  return records.sort((a, b) => a.createdAt - b.createdAt).map(PlateSource.fromRecord)
}

export async function deletePlate(id: string): Promise<void> {
  await remove(PLATE_STORE, id)
}

registerGrainSourceKind({
  kind: PLATE_KIND,
  async hydrate(data: SerializedGrainSource) {
    const record = await get<PlateRecord>(PLATE_STORE, data.id)
    if (!record) {
      throw new Error(
        `Grain plate "${data.name}" (${data.id}) is not in this browser's library. Re-import the plate file, then reload the preset.`,
      )
    }
    return PlateSource.fromRecord(record)
  },
})
