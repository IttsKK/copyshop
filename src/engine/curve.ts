/**
 * The grain response curve: how strongly grain lands at each luminance.
 *
 * Pure maths, no DOM and no GL — the editor draws it, the engine samples a LUT
 * built from it, and the self-test checks both against this one implementation.
 */

export interface CurvePoint {
  /** Luminance of the base image, 0 (black) to 1 (white). */
  x: number
  /** Grain strength multiplier, 0 to MAX_STRENGTH. */
  y: number
}

export type GrainCurve = CurvePoint[]

export const MAX_STRENGTH = 2

/** Grain everywhere, at the amount the slider says. */
export const FLAT_CURVE: GrainCurve = [
  { x: 0, y: 1 },
  { x: 1, y: 1 },
]

export const CURVE_PRESETS: { name: string; curve: GrainCurve }[] = [
  { name: 'Even', curve: FLAT_CURVE },
  {
    // Where real emulsions put it: strong through the midtones, easing off at
    // both ends so blacks stay clean and highlights don't sparkle.
    name: 'Midtones',
    curve: [
      { x: 0, y: 0.35 },
      { x: 0.45, y: 1.35 },
      { x: 1, y: 0.3 },
    ],
  },
  {
    name: 'Keep highlights clean',
    curve: [
      { x: 0, y: 1.15 },
      { x: 0.62, y: 1 },
      { x: 1, y: 0.12 },
    ],
  },
  {
    name: 'Shadows only',
    curve: [
      { x: 0, y: 1.7 },
      { x: 0.4, y: 0.65 },
      { x: 1, y: 0.05 },
    ],
  },
  {
    name: 'Highlights only',
    curve: [
      { x: 0, y: 0.05 },
      { x: 0.55, y: 0.5 },
      { x: 1, y: 1.6 },
    ],
  },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function sortCurve(curve: GrainCurve): GrainCurve {
  return [...curve].sort((a, b) => a.x - b.x)
}

/** Clean up an arbitrary point list into something evaluable. */
export function normaliseCurve(curve: GrainCurve): GrainCurve {
  const points = sortCurve(curve)
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => ({ x: clamp(p.x, 0, 1), y: clamp(p.y, 0, MAX_STRENGTH) }))
  if (points.length === 0) return [...FLAT_CURVE]
  if (points.length === 1)
    return [
      { x: 0, y: points[0].y },
      { x: 1, y: points[0].y },
    ]
  // The ends must be anchored so the curve is defined across the whole range.
  if (points[0].x > 0) points.unshift({ x: 0, y: points[0].y })
  if (points[points.length - 1].x < 1) points.push({ x: 1, y: points[points.length - 1].y })
  return points
}

/**
 * Monotone cubic interpolation (Fritsch–Carlson). Plain Catmull-Rom would
 * overshoot between points, which on a strength curve shows up as grain
 * appearing in tones the user explicitly pulled to zero.
 */
export function evaluateCurve(curve: GrainCurve, x: number): number {
  const p = curve
  const n = p.length
  if (n === 0) return 1
  if (n === 1) return p[0].y
  const t = clamp(x, 0, 1)
  if (t <= p[0].x) return p[0].y
  if (t >= p[n - 1].x) return p[n - 1].y

  let i = 0
  while (i < n - 2 && t > p[i + 1].x) i++

  const h = p[i + 1].x - p[i].x
  if (h <= 0) return p[i + 1].y

  // Secant slopes, then tangents limited to keep each segment monotone.
  const secant = (k: number) => (p[k + 1].y - p[k].y) / (p[k + 1].x - p[k].x)
  const d = secant(i)
  const dPrev = i > 0 ? secant(i - 1) : d
  const dNext = i < n - 2 ? secant(i + 1) : d

  const tangent = (a: number, b: number) => (a * b <= 0 ? 0 : (a + b) / 2)
  let m0 = tangent(dPrev, d)
  let m1 = tangent(d, dNext)
  if (d === 0) {
    m0 = 0
    m1 = 0
  } else {
    const alpha = m0 / d
    const beta = m1 / d
    const s = alpha * alpha + beta * beta
    if (s > 9) {
      const scale = 3 / Math.sqrt(s)
      m0 = scale * alpha * d
      m1 = scale * beta * d
    }
  }

  const s = (t - p[i].x) / h
  const s2 = s * s
  const s3 = s2 * s
  return (
    (2 * s3 - 3 * s2 + 1) * p[i].y + (s3 - 2 * s2 + s) * h * m0 + (-2 * s3 + 3 * s2) * p[i + 1].y + (s3 - s2) * h * m1
  )
}

export const LUT_SIZE = 256

/**
 * Bake the curve into the 8-bit LUT the shader samples. Strength is stored as
 * a fraction of MAX_STRENGTH, so one code value is ~0.8% of gain — well below
 * anything visible in grain.
 */
export function curveToLut(curve: GrainCurve): Uint8Array {
  const lut = new Uint8Array(LUT_SIZE * 4)
  for (let i = 0; i < LUT_SIZE; i++) {
    const y = clamp(evaluateCurve(curve, i / (LUT_SIZE - 1)), 0, MAX_STRENGTH)
    const v = Math.round((y / MAX_STRENGTH) * 255)
    lut[i * 4] = v
    lut[i * 4 + 1] = v
    lut[i * 4 + 2] = v
    lut[i * 4 + 3] = 255
  }
  return lut
}

export function curveKey(curve: GrainCurve): string {
  return curve.map((p) => `${p.x.toFixed(4)}:${p.y.toFixed(4)}`).join(',')
}

/** True when the curve applies the same strength everywhere. */
export function isFlatCurve(curve: GrainCurve, at = 1): boolean {
  return curve.every((p) => Math.abs(p.y - at) < 1e-6)
}

/**
 * How much the blended result moves per unit of grain, at a given base
 * luminance — the blend mode's own tone response.
 *
 * This is the thing that is easy to miss: Overlay's sensitivity is 2b in the
 * shadows and 2(1-b) in the highlights, so it collapses to almost nothing at
 * both ends. Draw a perfectly flat response curve with Overlay selected and
 * the shadows still come out clean, because the blend mode removed the grain
 * before the curve ever applied. Linear Light is flat, so what you draw is
 * what you get.
 *
 * Computed numerically from the same formulas the shader uses, rather than
 * differentiated by hand, so the two cannot drift apart.
 *
 * This is a small-signal figure: it describes the response to a little grain
 * and does not model what happens once strong grain clips against black or
 * white, which suppresses the extremes further than this predicts.
 */
export function blendSensitivity(mode: string, colorSpace: string, luma: number): number {
  const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
  const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)
  const blend = (b: number, s: number): number => {
    if (mode === 'overlay') return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
    if (mode === 'linearLight') return Math.min(1, Math.max(0, b + 2 * s - 1))
    const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
    return s < 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b)
  }
  const delta = 0.05
  const base = colorSpace === 'linear' ? srgbToLinear(clamp01(luma)) : clamp01(luma)
  const encode = (v: number) => (colorSpace === 'linear' ? linearToSrgb(clamp01(v)) : clamp01(v))
  return Math.abs(encode(blend(base, 0.5 + delta)) - encode(blend(base, 0.5 - delta))) / (2 * delta)
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Peak sensitivity of a mode, for normalising the effective-response display. */
export function peakBlendSensitivity(mode: string, colorSpace: string): number {
  let peak = 0
  for (let i = 0; i <= 64; i++) peak = Math.max(peak, blendSensitivity(mode, colorSpace, i / 64))
  return peak || 1
}
