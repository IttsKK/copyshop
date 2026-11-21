import type { GrainSource, GrainTexture, SerializedGrainSource } from './GrainSource'
import { registerGrainSourceKind } from './GrainSource'
import { DEFAULT_PROCEDURAL_PARAMS, type ProceduralGrainParams } from './generateGrain'
import { grainPlate } from './grainPlates'

export const PROCEDURAL_KIND = 'procedural'

const clamp = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback

export function parseProceduralParams(input: unknown): ProceduralGrainParams {
  const p = (input ?? {}) as Record<string, unknown>
  const d = DEFAULT_PROCEDURAL_PARAMS
  return {
    size: Math.round(clamp(p.size, d.size, 128, 4096)),
    grainSize: clamp(p.grainSize, d.grainSize, 0, 12),
    contrast: clamp(p.contrast, d.contrast, 0, 1),
    roughness: clamp(p.roughness, d.roughness, 0, 1),
    hardness: clamp(p.hardness, d.hardness, 0, 1),
    clumps: clamp(p.clumps, d.clumps, 0, 1),
    definition: clamp(p.definition, 0, 0, 1),
    unevenness: clamp(p.unevenness, d.unevenness, 0, 1),
    chroma: clamp(p.chroma, d.chroma, 0, 1),
    seed: Math.round(clamp(p.seed, d.seed, 0, 2 ** 31)),
  }
}

/**
 * Grain synthesised from parameters instead of loaded from a scan.
 *
 * A sibling of PlateSource, not a special case: the engine, the presets and the
 * batch runner treat it identically. It is fully described by its parameters,
 * so a preset referencing it is portable between machines — unlike a plate,
 * which lives in one browser's library.
 */
export class ProceduralSource implements GrainSource {
  readonly kind = PROCEDURAL_KIND
  private cache: { key: string; texture: GrainTexture } | null = null

  constructor(
    readonly id: string,
    readonly name: string,
    readonly params: ProceduralGrainParams,
  ) {}

  private get key(): string {
    return JSON.stringify(this.params)
  }

  async getTexture(): Promise<GrainTexture> {
    if (this.cache?.key === this.key) return this.cache.texture
    const image = await grainPlate(this.params)
    const texture: GrainTexture = {
      source: image,
      size: { width: image.width, height: image.height },
      // Synthesis centres the plate on mid-grey by construction.
      mean: 0.5,
      sd: 0.42 * this.params.contrast,
    }
    this.cache = { key: this.key, texture }
    return texture
  }

  /** A new source with some parameters changed; the id and name carry over. */
  withParams(changes: Partial<ProceduralGrainParams>): ProceduralSource {
    return new ProceduralSource(this.id, this.name, { ...this.params, ...changes })
  }

  serialize(): SerializedGrainSource {
    return { kind: this.kind, id: this.id, name: this.name, params: this.params }
  }

  dispose(): void {
    this.cache = null
  }
}

export function createProceduralSource(
  params: Partial<ProceduralGrainParams> = {},
  name = 'Generated grain',
): ProceduralSource {
  return new ProceduralSource(PROCEDURAL_KIND, name, { ...DEFAULT_PROCEDURAL_PARAMS, ...params })
}

registerGrainSourceKind({
  kind: PROCEDURAL_KIND,
  async hydrate(data: SerializedGrainSource) {
    // Nothing to look up: the parameters in the preset are the whole source.
    return new ProceduralSource(
      data.id,
      typeof data.name === 'string' ? data.name : 'Generated grain',
      parseProceduralParams(data.params),
    )
  },
})
