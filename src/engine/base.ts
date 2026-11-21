/**
 * The base photo: the few corrections a photo that hasn't been edited
 * anywhere else needs before the look goes on — exposure, white balance,
 * contrast and a simple curve. Most photos arrive already edited and never
 * touch these; they are for a camera JPEG or a RAW file, to start from a
 * good place, not a RAW developer.
 *
 * Applied once, to the photo itself, before anything else (GrainEngine's
 * develop pass), so every later step — streaks smearing it, glass bending
 * it, the glow reading its highlights — sees the corrected photo.
 */

type Rgb = [number, number, number]

export interface ToneCurvePoint {
  /** Brightness in, 0..1 (sRGB). */
  x: number
  /** Brightness out, 0..1. */
  y: number
}

export interface BaseParams {
  /** Exposure, in stops. */
  exposure: number
  /** -1..1: flatter to punchier, around the midtones. */
  contrast: number
  /** -1..1: brings bright areas down (or lifts them). */
  highlights: number
  /** -1..1: opens dark areas up (or deepens them). */
  shadows: number
  /** -1..1: the brightest whites. */
  whites: number
  /** -1..1: the darkest blacks. */
  blacks: number
  /** -1..1: cooler to warmer, a correction of the photo's own light. */
  temperature: number
  /** -1..1: greener to more magenta. */
  tint: number
  /** -1..1: all colour, less to more. */
  saturation: number
  /** One curve for brightness, in to out. Straight is no change. */
  curve: ToneCurvePoint[]
  /** Each Base module's switch: off keeps its settings. */
  lightOn: boolean
  colourOn: boolean
  curveOn: boolean
}

export const STRAIGHT_CURVE: ToneCurvePoint[] = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
]

export const DEFAULT_BASE: BaseParams = {
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  temperature: 0,
  tint: 0,
  saturation: 0,
  curve: STRAIGHT_CURVE,
  lightOn: true,
  colourOn: true,
  curveOn: true,
}

/** A few starting curves, for a curve without having to draw one. */
export const CURVE_PRESETS: { name: string; hint: string; curve: ToneCurvePoint[] }[] = [
  { name: 'Straight', hint: 'No change', curve: STRAIGHT_CURVE },
  { name: 'Gentle S', hint: 'A little more contrast, kinder to skin and skies than the Contrast slider', curve: [{ x: 0, y: 0 }, { x: 0.25, y: 0.21 }, { x: 0.75, y: 0.79 }, { x: 1, y: 1 }] },
  { name: 'Strong S', hint: 'Deep shadows, bright highlights', curve: [{ x: 0, y: 0 }, { x: 0.25, y: 0.17 }, { x: 0.75, y: 0.84 }, { x: 1, y: 1 }] },
  { name: 'Matte', hint: 'Blacks lifted to a soft grey, as a matte print', curve: [{ x: 0, y: 0.08 }, { x: 0.3, y: 0.3 }, { x: 1, y: 0.97 }] },
  { name: 'Brighter', hint: 'The midtones up, the ends kept', curve: [{ x: 0, y: 0 }, { x: 0.45, y: 0.55 }, { x: 1, y: 1 }] },
  { name: 'Darker', hint: 'The midtones down, the ends kept', curve: [{ x: 0, y: 0 }, { x: 0.55, y: 0.45 }, { x: 1, y: 1 }] },
]

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Whether the curve changes nothing. */
export const isStraight = (c: ToneCurvePoint[]): boolean =>
  c.length >= 2 && c.every((p) => Math.abs(p.x - p.y) < 1e-4) && c[0].x <= 1e-4 && c[c.length - 1].x >= 1 - 1e-4

/** What each module does to this photo, with its switch: nothing when off or at rest. */
export function baseActive(b: BaseParams): { light: boolean; colour: boolean; curve: boolean } {
  return {
    light: b.lightOn && (b.exposure !== 0 || b.contrast !== 0 || b.highlights !== 0 || b.shadows !== 0 || b.whites !== 0 || b.blacks !== 0),
    colour: b.colourOn && (b.temperature !== 0 || b.tint !== 0 || b.saturation !== 0),
    curve: b.curveOn && !isStraight(b.curve),
  }
}

export const baseChanges = (b: BaseParams): boolean => {
  const a = baseActive(b)
  return a.light || a.colour || a.curve
}

/**
 * Channel gains for a temperature and tint, in linear light, kept to the
 * same brightness: warmer lifts red and lowers blue, more magenta lowers
 * green.
 */
export function whiteBalanceGains(temperature: number, tint: number): Rgb {
  const g: Rgb = [2 ** (temperature * 0.6), 2 ** (-tint * 0.5), 2 ** (-temperature * 0.6)]
  const lum = 0.2126 * g[0] + 0.7152 * g[1] + 0.0722 * g[2]
  return [g[0] / lum, g[1] / lum, g[2] / lum]
}

/** The curve at x: a smooth curve through its points (monotone cubic), clamped to 0..1. */
export function evaluateToneCurve(curve: ToneCurvePoint[], x: number): number {
  const p = [...curve].sort((a, b) => a.x - b.x)
  const n = p.length
  if (n === 0) return x
  if (x <= p[0].x) return clamp(p[0].y, 0, 1)
  if (x >= p[n - 1].x) return clamp(p[n - 1].y, 0, 1)
  // Fritsch–Carlson tangents: no overshoot between points.
  const d = p.slice(0, -1).map((a, i) => (p[i + 1].y - a.y) / Math.max(1e-6, p[i + 1].x - a.x))
  const m = p.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) m[i] = m[i + 1] = 0
    else {
      const a = m[i] / d[i]
      const b = m[i + 1] / d[i]
      const s = a * a + b * b
      if (s > 9) {
        const t = 3 / Math.sqrt(s)
        m[i] = t * a * d[i]
        m[i + 1] = t * b * d[i]
      }
    }
  }
  let i = 0
  while (i < n - 2 && x > p[i + 1].x) i++
  const h = p[i + 1].x - p[i].x
  const t = (x - p[i].x) / h
  const t2 = t * t
  const t3 = t2 * t
  const y =
    (2 * t3 - 3 * t2 + 1) * p[i].y + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * p[i + 1].y + (t3 - t2) * h * m[i + 1]
  return clamp(y, 0, 1)
}

export const CURVE_LUT_SIZE = 256

/** The curve as a lookup row for the develop pass. */
export function toneCurveLut(curve: ToneCurvePoint[]): Uint8Array {
  const lut = new Uint8Array(CURVE_LUT_SIZE * 4)
  for (let i = 0; i < CURVE_LUT_SIZE; i++) {
    const v = Math.round(evaluateToneCurve(curve, i / (CURVE_LUT_SIZE - 1)) * 255)
    lut.set([v, v, v, 255], i * 4)
  }
  return lut
}

const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback

/** Base settings read back from a saved edit, every value checked. */
export function parseBase(value: unknown): BaseParams {
  const b = (value ?? {}) as Record<string, unknown>
  const d = DEFAULT_BASE
  const curve = Array.isArray(b.curve)
    ? (b.curve as unknown[])
        .map((p) => p as Record<string, unknown>)
        .filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number')
        .slice(0, 16)
        .map((p) => ({ x: clamp(p.x as number, 0, 1), y: clamp(p.y as number, 0, 1) }))
    : d.curve
  return {
    exposure: num(b.exposure, d.exposure, -4, 4),
    contrast: num(b.contrast, d.contrast, -1, 1),
    highlights: num(b.highlights, d.highlights, -1, 1),
    shadows: num(b.shadows, d.shadows, -1, 1),
    whites: num(b.whites, d.whites, -1, 1),
    blacks: num(b.blacks, d.blacks, -1, 1),
    temperature: num(b.temperature, d.temperature, -1, 1),
    tint: num(b.tint, d.tint, -1, 1),
    saturation: num(b.saturation, d.saturation, -1, 1),
    curve: curve.length >= 2 ? curve : d.curve,
    lightOn: typeof b.lightOn === 'boolean' ? b.lightOn : true,
    colourOn: typeof b.colourOn === 'boolean' ? b.colourOn : true,
    curveOn: typeof b.curveOn === 'boolean' ? b.curveOn : true,
  }
}

const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)

/** The temperature and tint that make a colour neutral grey. */
export function neutralise(c: Rgb): { temperature: number; tint: number } {
  const [r, g, b] = c.map((v) => Math.max(1e-4, lin(v)))
  // Red × 2^(0.6t) = blue × 2^(-0.6t)
  const temperature = clamp(Math.log2(b / r) / 1.2, -1, 1)
  const rb = Math.sqrt(r * 2 ** (0.6 * temperature) * b * 2 ** (-0.6 * temperature))
  // Green × 2^(-0.5k) = the balanced red and blue
  const tint = clamp(Math.log2(g / rb) / 0.5, -1, 1)
  return { temperature, tint }
}

/**
 * A gentle automatic start for a photo, from its pixels (sRGB, RGBA): the
 * exposure that puts its middle brightness at a mid tone, the white balance
 * that greys its neutral-ish midtones (most of the way, so a sunset stays
 * warm), and a little highlight and shadow recovery if the ends clip.
 */
export function autoBase(pixels: Uint8ClampedArray): Pick<BaseParams, 'exposure' | 'contrast' | 'highlights' | 'shadows' | 'temperature' | 'tint'> {
  const lums: number[] = []
  let sr = 0
  let sg = 0
  let sb = 0
  let w = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i] / 255
    const g = pixels[i + 1] / 255
    const b = pixels[i + 2] / 255
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    lums.push(l)
    const chroma = Math.max(r, g, b) - Math.min(r, g, b)
    // Midtones that aren't strongly coloured say most about the light.
    if (l > 0.15 && l < 0.85 && chroma < 0.35) {
      const k = 1 - chroma / 0.35
      sr += lin(r) * k
      sg += lin(g) * k
      sb += lin(b) * k
      w += k
    }
  }
  lums.sort((a, b) => a - b)
  const at = (q: number) => lums[Math.min(lums.length - 1, Math.floor(q * lums.length))] ?? 0.5
  const median = Math.max(0.02, at(0.5))
  const exposure = clamp(Math.log2(lin(0.4) / lin(median)) * 0.6, -1.5, 1.5)
  const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)
  // Enough neutral-ish midtones to read the light by: 2% of the photo's worth.
  const wb = w > lums.length * 0.02 ? neutralise([enc(sr / w), enc(sg / w), enc(sb / w)]) : { temperature: 0, tint: 0 }
  const after = (v: number) => Math.min(1, enc(lin(v) * 2 ** exposure))
  return {
    exposure: Math.round(exposure * 20) / 20,
    contrast: 0.1,
    highlights: after(at(0.99)) > 0.97 ? -0.35 : 0,
    shadows: after(at(0.02)) < 0.04 ? 0.25 : 0,
    temperature: Math.round(wb.temperature * 0.75 * 100) / 100,
    tint: Math.round(wb.tint * 0.75 * 100) / 100,
  }
}

/** The develop pass: the photo with the Base corrections, still sRGB. */
export const DEVELOP_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uCurve;
uniform vec3 uGains;      // white balance and exposure, linear
uniform float uContrast;
uniform float uHighlights;
uniform float uShadows;
uniform float uWhites;
uniform float uBlacks;
uniform float uSaturation;
uniform float uKnee;     // 0 at rest, up to 1 as exposure goes up
uniform int uToneOn;
uniform int uCurveOn;
out vec4 outColor;

vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
float toLin1(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); }
float toSrgb1(float c) { c = max(c, 0.0); return c <= 0.0031308 ? c * 12.92 : 1.055 * pow(c, 1.0 / 2.4) - 0.055; }
const vec3 W = vec3(0.2126, 0.7152, 0.0722);

void main() {
  vec4 src = texture(uSource, vUv);
  vec3 lin = toLinear(src.rgb) * uGains;
  if (uToneOn == 1) {
    float L = max(dot(lin, W), 1e-6);
    // Shaped on brightness as it looks (sRGB), then the colour is scaled to
    // match, so hues stay put.
    float q = toSrgb1(L);
    // Exposure up eases the brightest tones into white instead of clipping
    // them, as film's shoulder does; at rest nothing changes.
    if (uKnee > 0.0 && q > 0.8) q = mix(q, 0.8 + 0.2 * (1.0 - exp(-(q - 0.8) / 0.2)), uKnee);
    float hi = uHighlights >= 0.0 ? 1.2 : 1.8;
    // pow of a negative is undefined in GLSL (NaN, even times 0): above white, nothing is below it.
    float under = max(1.0 - q, 0.0);
    q += uShadows * 1.4 * q * under * under * under;
    q += uHighlights * hi * q * q * q * under;
    q += uWhites * 0.3 * q * q * q * q;
    under = max(1.0 - q, 0.0);
    q += uBlacks * 0.25 * under * under * under * under * (uBlacks < 0.0 ? 1.0 : 0.6);
    q = clamp(q, 0.0, 1.0);
    if (uContrast > 0.0) q = mix(q, q * q * (3.0 - 2.0 * q), uContrast * 0.85);
    else if (uContrast < 0.0) q = mix(q, 0.5 - sin(asin(1.0 - 2.0 * q) / 3.0), -uContrast * 0.85);
    lin *= toLin1(q) / L;
  }
  if (uSaturation != 0.0) {
    float g = dot(lin, W);
    lin = max(vec3(0.0), g + (lin - g) * (1.0 + uSaturation));
  }
  vec3 c = clamp(toSrgb(lin), 0.0, 1.0);
  if (uCurveOn == 1) {
    c = vec3(
      texture(uCurve, vec2((c.r * 255.0 + 0.5) / 256.0, 0.5)).r,
      texture(uCurve, vec2((c.g * 255.0 + 0.5) / 256.0, 0.5)).r,
      texture(uCurve, vec2((c.b * 255.0 + 0.5) / 256.0, 0.5)).r
    );
  }
  outColor = vec4(c, src.a);
}`
