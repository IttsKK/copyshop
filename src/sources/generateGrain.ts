/**
 * Procedural grain synthesis.
 *
 * Pure computation: no DOM, no GL, no storage. Given the same parameters it
 * returns the same plate, which is what lets a preset store six numbers instead
 * of an image.
 *
 * The model is deliberately simple and physical in spirit rather than in
 * detail: silver halide crystals clump, so filtered noise at a chosen clump
 * size reads far more like film than raw white noise does. Two octaves give the
 * mix of fine speckle and coarser mottling a real emulsion has.
 *
 * All filtering wraps around the edges, so the plate tiles seamlessly by
 * construction — the tiler never has to hide a discontinuity that isn't there.
 */

export interface ProceduralGrainParams {
  /** Plate resolution in pixels (square). */
  size: number
  /** Clump radius in pixels. 0 leaves the noise unfiltered — the tightest,
   *  crispest grain; larger values read as coarser, faster film. */
  grainSize: number
  /** Grain contrast, 0..1. */
  contrast: number
  /** 0 = pure fine grain, 1 = heavy coarse mottling on top. */
  roughness: number
  /** 0 = soft clouds, 1 = crisp-edged clumps at the same size. */
  hardness: number
  /**
   * Sparse large grains riding on the fine ones, 0..1.
   *
   * This is what gives grain character. A Gaussian field has kurtosis 3 and
   * reads as an even screen of noise; real emulsions have a spread of crystal
   * sizes and the occasional much larger clump, which shows up as heavy tails.
   * Measured on a reference with the character we were chasing: kurtosis 5.9 in
   * the sky and 24.5 in the dark slope, against a Gaussian 3.
   */
  clumps: number
  /**
   * Large-scale variation in density and grain strength, 0..1.
   *
   * Synthesised noise is stationary: every part of the plate has identical
   * statistics, which is the tell that makes it read as digital. Real emulsion
   * and the scans of it are not — measured on three film plates, 1% to 6% of
   * their variance sits below the grain frequencies.
   *
   * Keep it low. Matching a scanned plate's full unevenness (0.5 and up) reads
   * as blotching on a smooth sky rather than as grain: a plate carries the
   * scanner's own unevenness as well as the film's, and only the film's belongs
   * in the picture.
   */
  unevenness: number
  /** 0 = identical noise in all channels, 1 = independent per channel. */
  chroma: number
  /**
   * Keeps big grain crisp. Bigger grain is noise blurred further, and its
   * edges soften as fast as it grows, so it turns to mush. Definition
   * sharpens each grain at its own scale (an unsharp mask at the grain size,
   * then a gentle S-curve) so a large grain has a defined edge — without the
   * two-level salt-and-pepper look Hardness gives. 0..1; optional, 0 when absent.
   */
  definition?: number
  seed: number
}

/**
 * Dense, fine, lightly coloured grain — the texture of the strong-grain
 * references: about a pixel across, near-Gaussian, no sparse clumps, with a
 * little unevenness so it is not a flat screen. It is what the app starts on.
 */
export const DEFAULT_PROCEDURAL_PARAMS: ProceduralGrainParams = {
  size: 1024,
  grainSize: 0.3,
  contrast: 0.4,
  roughness: 0,
  hardness: 0,
  clumps: 0,
  unevenness: 0.15,
  chroma: 0.3,
  seed: 5,
}

/**
 * Starting points. "Fine" reproduces the tight unfiltered grain of the first
 * test plate; the rest walk up the speed range by widening the clumps and
 * raising contrast, which is roughly what faster emulsions do.
 */
export const GRAIN_PRESETS: { name: string; hint: string; params: Omit<ProceduralGrainParams, 'seed'> }[] = [
  {
    name: 'Dense',
    hint: 'Fine, strong, lightly coloured — the default',
    params: { size: 1024, grainSize: 0.3, contrast: 0.4, roughness: 0, hardness: 0, clumps: 0, unevenness: 0.15, chroma: 0.3 },
  },
  {
    name: 'Character',
    hint: 'Clumpy, uneven — fitted to the beach reference',
    params: { size: 1024, grainSize: 0.95, contrast: 0.3, roughness: 0, hardness: 0, clumps: 0.85, unevenness: 0.18, chroma: 0.22 },
  },
  {
    name: 'Fine',
    hint: 'Tight, crisp, slow film',
    params: { size: 512, grainSize: 0.4, contrast: 0.33, roughness: 0, hardness: 0, clumps: 0.25, unevenness: 0.1, chroma: 0 },
  },
  {
    name: 'Classic 400',
    hint: 'Fitted to a scanned colour negative',
    params: { size: 1024, grainSize: 0.85, contrast: 0.4, roughness: 0, hardness: 0, clumps: 0.4, unevenness: 0.12, chroma: 0.2 },
  },
  {
    name: 'Pushed',
    hint: 'Coarse and contrasty',
    params: { size: 1024, grainSize: 1.2, contrast: 0.55, roughness: 0.15, hardness: 0.15, clumps: 0.6, unevenness: 0.2, chroma: 0.15 },
  },
  {
    name: 'Chunky',
    hint: 'Big grain that stays crisp',
    params: { size: 1024, grainSize: 2.4, contrast: 0.6, roughness: 0.15, hardness: 0.6, clumps: 0.5, unevenness: 0.2, chroma: 0 },
  },
  {
    name: 'Colour neg',
    hint: 'Dye clouds, per-channel',
    params: { size: 1024, grainSize: 1.0, contrast: 0.45, roughness: 0.1, hardness: 0.1, clumps: 0.45, unevenness: 0.15, chroma: 0.5 },
  },
]

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function whiteNoise(n: number, rand: () => number): Float32Array {
  const out = new Float32Array(n * n)
  for (let i = 0; i < out.length; i++) {
    // Three uniforms sum to something close enough to Gaussian for grain.
    out[i] = rand() + rand() + rand() - 1.5
  }
  return out
}

/**
 * Separable Gaussian with an exact kernel rather than repeated box passes.
 *
 * Box blurs only come in integer radii, which made grain size jump: anything
 * above "no filtering" landed straight on a radius-1 triple box, so there was
 * no gradual path from the finest grain to a slightly larger one. A real kernel
 * takes any sigma, so the control is continuous all the way down.
 */
function gaussianKernel(sigma: number): Float32Array {
  const radius = Math.min(16, Math.max(1, Math.ceil(sigma * 3)))
  const kernel = new Float32Array(radius * 2 + 1)
  let sum = 0
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / (2 * sigma * sigma))
    kernel[i + radius] = w
    sum += w
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum
  return kernel
}

/** Convolve one axis, wrapping at the edges to keep the plate tileable. */
function convolveAxis(src: Float32Array, dst: Float32Array, n: number, kernel: Float32Array, horizontal: boolean) {
  const radius = (kernel.length - 1) / 2
  const padded = new Float32Array(n + radius * 2)
  for (let line = 0; line < n; line++) {
    // Copy the line into a wrapped, padded buffer so the inner loop has no
    // modulo in it — the convolution runs on every pixel of every plate.
    for (let i = 0; i < n; i++) padded[i + radius] = src[horizontal ? line * n + i : i * n + line]
    for (let i = 0; i < radius; i++) {
      padded[i] = padded[n + i]
      padded[n + radius + i] = padded[radius + i]
    }
    for (let i = 0; i < n; i++) {
      let acc = 0
      for (let t = 0; t < kernel.length; t++) acc += kernel[t] * padded[i + t]
      dst[horizontal ? line * n + i : i * n + line] = acc
    }
  }
}

function blurWrapped(field: Float32Array, n: number, sigma: number): Float32Array {
  if (sigma < 0.05) return field  // unfiltered white noise: the finest grain
  const kernel = gaussianKernel(sigma)
  const tmp = new Float32Array(field.length)
  convolveAxis(field, tmp, n, kernel, true)
  convolveAxis(tmp, field, n, kernel, false)
  return field
}

/**
 * Clumping. Blurring alone makes grain bigger *and* softer, which is why larger
 * settings looked like mush rather than grain. Pushing the blurred field toward
 * its extremes restores crisp boundaries at the same clump size — closer to
 * what silver halide actually does, where the clumps have edges.
 */
function applyHardness(field: Float32Array, hardness: number): void {
  if (hardness <= 0) return
  const k = 0.5 + hardness * 5.5
  const norm = Math.tanh(k)
  for (let i = 0; i < field.length; i++) field[i] = Math.tanh(field[i] * k) / norm
}

function applyDefinition(field: Float32Array, n: number, definition: number, sigma: number): void {
  if (definition <= 0 || sigma < 0.35) return
  // Unsharp mask at a little over the grain's own size: steepens the edge of
  // every grain without adding detail finer than the grain itself.
  const wide = blurWrapped(field, n, sigma * 1.6)
  const k = definition * 2.2
  for (let i = 0; i < field.length; i++) field[i] += k * (field[i] - wide[i])
  normalise(field)
  // A soft S-curve: grains read as shapes with an inside and an outside, but
  // the distribution stays continuous (tanh at slope 1.6 is far from the
  // two-level hard threshold).
  const s = 1 + definition * 0.6
  const norm = Math.tanh(s)
  for (let i = 0; i < field.length; i++) field[i] = Math.tanh(field[i] * s) / norm
}

function normalise(field: Float32Array): void {
  let sum = 0
  for (let i = 0; i < field.length; i++) sum += field[i]
  const mean = sum / field.length
  let sq = 0
  for (let i = 0; i < field.length; i++) {
    field[i] -= mean
    sq += field[i] * field[i]
  }
  const sd = Math.sqrt(sq / field.length) || 1
  for (let i = 0; i < field.length; i++) field[i] /= sd
}

/**
 * A very low frequency field, built at a handful of cells and interpolated up
 * rather than blurred down — a blur wide enough for this would need a kernel
 * the size of the plate.
 */
function lowFrequencyField(n: number, cells: number, rand: () => number): Float32Array {
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i++) grid[i] = rand() + rand() + rand() - 1.5
  const out = new Float32Array(n * n)
  const smooth = (t: number) => t * t * (3 - 2 * t)
  for (let y = 0; y < n; y++) {
    const gy = (y / n) * cells
    const y0 = Math.floor(gy) % cells
    const y1 = (y0 + 1) % cells
    const fy = smooth(gy - Math.floor(gy))
    for (let x = 0; x < n; x++) {
      const gx = (x / n) * cells
      const x0 = Math.floor(gx) % cells
      const x1 = (x0 + 1) % cells
      const fx = smooth(gx - Math.floor(gx))
      // Wrapping indices keep the field tileable along with everything else.
      const top = grid[y0 * cells + x0] * (1 - fx) + grid[y0 * cells + x1] * fx
      const bottom = grid[y1 * cells + x0] * (1 - fx) + grid[y1 * cells + x1] * fx
      out[y * n + x] = top * (1 - fy) + bottom * fy
    }
  }
  return out
}

/**
 * Add sparse large grains. Keep only the high-density side of a coarser noise
 * field, then re-centre it. The old symmetric threshold produced equal black
 * and white pepper spots — digital static. Real clumps are density events with
 * a diffuse counter-field, so their distribution is deliberately skewed.
 */
function applyClumps(field: Float32Array, n: number, clumps: number, sigma: number, seed: number): void {
  if (clumps <= 0) return
  const sparse = blurWrapped(whiteNoise(n, mulberry32(seed ^ 0x2545f491)), n, Math.max(0.9, sigma * 2.2))
  normalise(sparse)
  // Soft threshold, fixed: this cut leaves about 7% of the field carrying a
  // clump and the rest at zero. The control is how much of the result is made
  // of those clumps, not how sparse they are — varying the cut instead sends
  // kurtosis from 18 to 2000 over the slider's range, which is unusable.
  const CUT = 1.8
  for (let i = 0; i < sparse.length; i++) {
    sparse[i] = Math.max(0, sparse[i] - CUT)
  }
  normalise(sparse)
  const w = clumps * 0.55
  const norm = Math.sqrt((1 - w) * (1 - w) + w * w)
  for (let i = 0; i < field.length; i++) field[i] = ((1 - w) * field[i] + w * sparse[i]) / norm
}

/**
 * Break up the uniformity: vary how strong the grain is from region to region,
 * and add a little large-scale density on top. The first is what stops grain
 * reading as a flat screen of noise; the second is what a real plate's own
 * scan carries.
 */
function applyUnevenness(field: Float32Array, n: number, unevenness: number, seed: number): void {
  if (unevenness <= 0) return
  const amplitude = lowFrequencyField(n, 7, mulberry32(seed ^ 0x27d4eb2d))
  const density = lowFrequencyField(n, 5, mulberry32(seed ^ 0x165667b1))
  normalise(amplitude)
  normalise(density)
  for (let i = 0; i < field.length; i++) {
    const gain = Math.max(0, 1 + unevenness * 0.55 * amplitude[i])
    field[i] = field[i] * gain + density[i] * unevenness * 0.22
  }
}

/** One channel of grain: fine and coarse octaves, mixed and normalised. */
function grainChannel(n: number, params: ProceduralGrainParams, seed: number): Float32Array {
  // grainSize is a Gaussian sigma in plate pixels; 0 leaves the noise alone.
  const fineSigma = params.grainSize
  const coarseSigma = Math.max(0.6, params.grainSize) * 3
  const fine = blurWrapped(whiteNoise(n, mulberry32(seed)), n, fineSigma)
  normalise(fine)
  applyDefinition(fine, n, params.definition ?? 0, fineSigma)
  applyHardness(fine, params.hardness)
  normalise(fine)
  if (params.roughness <= 0) {
    applyClumps(fine, n, params.clumps, fineSigma, seed)
    applyUnevenness(fine, n, params.unevenness, seed)
    normalise(fine)
    return fine
  }
  const coarse = blurWrapped(whiteNoise(n, mulberry32(seed ^ 0x9e3779b9)), n, coarseSigma)
  normalise(coarse)
  applyHardness(coarse, params.hardness)
  normalise(coarse)
  const w = params.roughness
  // Weights in quadrature so the mix keeps unit variance instead of flattening.
  const norm = Math.sqrt((1 - w) * (1 - w) + w * w)
  for (let i = 0; i < fine.length; i++) fine[i] = ((1 - w) * fine[i] + w * coarse[i]) / norm
  applyClumps(fine, n, params.clumps, fineSigma, seed)
  applyUnevenness(fine, n, params.unevenness, seed)
  normalise(fine)
  return fine
}

/**
 * Render a grain plate. Returns 8-bit RGBA centred on mid-grey, which is the
 * neutral point of every blend mode in the engine.
 */
export function generateGrainPlate(params: ProceduralGrainParams): ImageData {
  const n = Math.max(64, Math.round(params.size))
  const spread = 0.42 * params.contrast // sigma in 0..1 units at contrast 1
  const channels: Float32Array[] = [grainChannel(n, params, params.seed)]
  if (params.chroma > 0) {
    channels.push(grainChannel(n, params, params.seed + 7919), grainChannel(n, params, params.seed + 104729))
  }

  const out = new ImageData(n, n)
  for (let i = 0; i < n * n; i++) {
    const luma = channels[0][i]
    for (let c = 0; c < 3; c++) {
      const own = params.chroma > 0 ? channels[c === 0 ? 0 : c][i] : luma
      const v = luma + (own - luma) * params.chroma
      out.data[i * 4 + c] = Math.max(0, Math.min(255, Math.round((0.5 + v * spread) * 255)))
    }
    out.data[i * 4 + 3] = 255
  }
  return out
}
