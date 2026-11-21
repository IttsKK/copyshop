import type { Size, TextureSource } from '../engine/types'

export interface GrainTexture {
  source: TextureSource
  size: Size
  /** Average density, 0..1. Omitted means "assume mid-grey". */
  mean?: number
  /** Contrast, 0..1. Omitted means "assume already the reference contrast". */
  sd?: number
}

/**
 * Context the app can hand a source when asking for a texture. v1's plate
 * loader ignores it; a procedural generator would use it to synthesise grain
 * matched to the image it is about to be applied to.
 */
export interface GrainTextureRequest {
  targetSize?: Size
  seed?: number
}

/** Serialised form stored in presets — enough to rebuild the source later. */
export interface SerializedGrainSource {
  kind: string
  id: string
  name: string
  [key: string]: unknown
}

/**
 * A grain source is anything that can hand the engine a texture.
 *
 * v1 ships exactly one implementation (a scanned plate loaded from disk), but
 * "procedural generator" and "analysed-plate synthesis" are siblings of it,
 * not forks of the pipeline: they implement this interface and everything
 * downstream is unchanged.
 */
export interface GrainSource {
  readonly kind: string
  readonly id: string
  readonly name: string
  getTexture(request?: GrainTextureRequest): Promise<GrainTexture>
  serialize(): SerializedGrainSource
  /** Release GPU/CPU resources. */
  dispose?(): void
}

export interface GrainSourceFactory<T extends GrainSource = GrainSource> {
  kind: string
  /** Rebuild a source from its serialised form (e.g. when loading a preset). */
  hydrate(data: SerializedGrainSource): Promise<T>
}

const factories = new Map<string, GrainSourceFactory>()

export function registerGrainSourceKind(factory: GrainSourceFactory): void {
  factories.set(factory.kind, factory)
}

export function knownGrainSourceKinds(): string[] {
  return [...factories.keys()]
}

export async function hydrateGrainSource(data: SerializedGrainSource): Promise<GrainSource> {
  const factory = factories.get(data.kind)
  if (!factory) {
    throw new Error(`Unknown grain source kind "${data.kind}". This preset needs a newer build.`)
  }
  return factory.hydrate(data)
}
