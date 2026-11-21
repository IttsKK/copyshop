/**
 * Browser self-test for GrainEngine. Verifies the properties the whole app
 * depends on: blend neutrality, amount as a true mix, preview/export agreement
 * on a crop, and variance preservation of the stochastic tiler.
 */
import { bend as bendLens, unbend } from './engine/lensBend'
import { DEFAULT_LIGHT, type LightShape } from './engine/lighting'
import { dominantMeeting, findLines, meetingPoint, streakPerspective } from './engine/perspective'
import { DEFAULT_REPEAT, type RepeatParams } from './engine/repeatParams'
import { perspectiveFromGuides } from './ui/streakLines'
import { rasterOutline } from './ui/maskBrush'
import { GrainEngine } from './engine/GrainEngine'
import { DEFAULT_BLEND_PARAMS, DEFAULT_MASK, MASK_SECTIONS, DEFAULT_STREAK_FIX, STREAK_DEFAULTS, type BlendParams, type MaskShape, type StreakFix, type StreakShape, type BlendMode, type ColorSpace, type Rect, type Size } from './engine/types'
import {
  CURVE_PRESETS, FLAT_CURVE, evaluateCurve, curveToLut, normaliseCurve, MAX_STRENGTH,
  blendSensitivity, peakBlendSensitivity,
} from './engine/curve'
import { DEFAULT_PROCEDURAL_PARAMS, generateGrainPlate } from './sources/generateGrain'
import { DEFAULT_DEFECTS } from './sources/defects'
import { DEFAULT_BORDER, DEFAULT_EFFECTS, DEFAULT_DITHER, DEFAULT_GLASS, DEFAULT_GRADE, DEFAULT_KEYS, DEFAULT_LEAKS, DEFAULT_MODULES, DEFAULT_PIXEL_ART, DEFAULT_SURGE, printSize, printSizeOf } from './engine/types'
import { randomSpots } from './engine/leaks'
import { LEAK_STYLES } from './engine/leakStyles'
import { paletteFromPixels } from './engine/palette'
import { resolveParams } from './engine/resolve'
import { mergeGrade, ruleColours, ruleMatching, type ColourRule } from './engine/recipe'
import { autoBase, evaluateToneCurve, neutralise } from './engine/base'
import { drawStamp, stampText } from './engine/extras'
import { BUILT_IN_RECIPES } from './storage/recipes'
import { inUse, startModule, stopModule, MODULES, MASKABLE, WITH_PRESETS, presetKind, resetModule, FACTORY } from './ui/moduleCatalog'
import { guidedMove, moveOne, rampColour, toneColours, wheelPoint, type WheelPoint } from './engine/harmony'
import { LIGHT_ARC, lch, lightShadeOf, lightShadeStops, mirrored, rampPeak } from './engine/lightshade'
import { PRESET_SCHEMA_VERSION, parsePreset } from './storage/presets'
import { pathFlow, streakCoords as streakCoordsJs, streakPos as streakPosJs, streakVanish } from './engine/streaks'
import { embedRecipe, readRecipe, sha256 } from './storage/recipe'
import { shapeSpaceFromExport, shapeSpaceUnknown } from './pipeline/shapeSpace'
import { renderFile } from './pipeline/render'
import { decodeRaster, encodeRaster } from './engine/maskRaster'
import { DEFAULT_CROP, fitRatio } from './engine/crop'
import { DEFAULT_OUTPUT, type OutputSettings } from './storage/presets'
import { createProceduralSource } from './sources/ProceduralSource'
import { fitToInstagram, instagramCrop, instagramPhotoSize, shapesOnCrop } from './pipeline/instagram'
import { decodePhoto } from './pipeline/decode'
import { applyPart, extractPart, hasPlaced, keepPart, resetPart, withPlaced, withoutPlaced } from './storage/parts'
import { constrainPlacement, imageUvAt, pieceContains, pieceMaps, setCollageImageLookup, setCollagePhoto } from './engine/collage'
import { addCollageImage, collageImageNow, listCollageImages, registerCollageImage, removeCollageImage } from './storage/collageImages'
import { colourError, fitPalette, lookPapers, offWheelColour } from './ui/paletteFit'
import { DEFAULT_COLLAGE_PIECE, type CollagePiece } from './engine/types'

/** A fix that copies its bars' colours from beside its span, as fixes did before they could keep them. */
const SPAN_FIX = { ...DEFAULT_STREAK_FIX, mode: 'borrow' as const }

const results: string[] = []
let failures = 0

function check(name: string, pass: boolean, detail = '') {
  if (!pass) failures++
  results.push(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}


const srgbToLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const linearToSrgb = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055)

/** CPU mirror of the GLSL blend functions, used only to test the shader. */
function blendChannel(mode: BlendMode, b: number, s: number): number {
  if (mode === 'overlay') return b < 0.5 ? 2 * b * s : 1 - 2 * (1 - b) * (1 - s)
  if (mode === 'linearLight') return Math.min(1, Math.max(0, b + 2 * s - 1))
  const d = b <= 0.25 ? ((16 * b - 12) * b + 4) * b : Math.sqrt(b)
  return s < 0.5 ? b - (1 - 2 * s) * b * (1 - b) : b + (2 * s - 1) * (d - b)
}

function referenceBlend(
  base: ImageData,
  grain: number,
  mode: BlendMode,
  space: ColorSpace,
  amount: number,
): ImageData {
  const out = new ImageData(base.width, base.height)
  for (let i = 0; i < base.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let b = base.data[i + c] / 255
      if (space === 'linear') b = srgbToLinear(b)
      let r = b + (blendChannel(mode, b, grain) - b) * amount
      r = Math.min(1, Math.max(0, r))
      if (space === 'linear') r = linearToSrgb(r)
      out.data[i + c] = Math.round(r * 255)
    }
    out.data[i + 3] = 255
  }
  return out
}

function makeBase(w: number, h: number): ImageData {
  const d = new ImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      d.data[i] = Math.round((x / (w - 1)) * 255)
      d.data[i + 1] = Math.round((y / (h - 1)) * 255)
      d.data[i + 2] = 128
      d.data[i + 3] = 255
    }
  }
  return d
}

function makeFlatGrain(w: number, h: number, value = 128): ImageData {
  const d = new ImageData(w, h)
  d.data.fill(255)
  for (let i = 0; i < d.data.length; i += 4) {
    d.data[i] = value
    d.data[i + 1] = value
    d.data[i + 2] = value
  }
  return d
}



/** Share of variance sitting below the grain frequencies, as a fraction. */
function lowFrequencyShare(img: ImageData): number {
  const W = img.width
  const H = img.height
  const block = 16
  const dw = Math.floor(W / block)
  const dh = Math.floor(H / block)
  if (dw < 2 || dh < 2) return 0
  const low: number[] = []
  for (let y = 0; y < dh; y++) {
    for (let x = 0; x < dw; x++) {
      let sum = 0
      for (let j = 0; j < block; j++) {
        for (let k = 0; k < block; k++) sum += img.data[((y * block + j) * W + x * block + k) * 4]
      }
      low.push(sum / (block * block))
    }
  }
  const mean = low.reduce((a, b) => a + b, 0) / low.length
  const lowVar = low.reduce((a, b) => a + (b - mean) ** 2, 0) / low.length
  const total = stdDev(img) ** 2
  return total > 0 ? lowVar / total : 0
}

/**
 * A plate the way a scan arrives: centred wherever it happened to be exposed,
 * not on mid-grey, optionally with the uneven density a scanner adds.
 */
function makeOffsetGrain(n: number, mean: number, sd: number, mottle = 0): ImageData {
  const d = new ImageData(n, n)
  let seed = railSeed++
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4
      const drift = mottle * Math.sin((x / n) * Math.PI * 2) * Math.cos((y / n) * Math.PI)
      const noise = (rand() + rand() + rand() - 1.5) * sd * 2
      const v = Math.max(0, Math.min(1, mean + drift + noise))
      d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.round(v * 255)
      d.data[i + 3] = 255
    }
  }
  return d
}

let railSeed = 424242

/** A plate of hard-edged clumps, for testing that tiling preserves character. */
function makeClumpyGrain(n: number): ImageData {
  const d = new ImageData(n, n)
  let seed = 31337
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  const field = new Float32Array(n * n)
  for (let i = 0; i < field.length; i++) field[i] = rand() + rand() + rand() - 1.5
  // Blur with wraparound, then saturate: clumps with definite edges.
  const tmp = new Float32Array(field.length)
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let acc = 0
        for (let k = -2; k <= 2; k++) acc += field[y * n + ((x + k + n) % n)]
        tmp[y * n + x] = acc / 5
      }
    }
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        let acc = 0
        for (let k = -2; k <= 2; k++) acc += tmp[((y + k + n) % n) * n + x]
        field[y * n + x] = acc / 5
      }
    }
  }
  let sum = 0
  for (const v of field) sum += v
  const mean = sum / field.length
  let sq = 0
  for (const v of field) sq += (v - mean) ** 2
  const sd = Math.sqrt(sq / field.length) || 1
  for (let i = 0; i < field.length; i++) {
    const v = Math.tanh(((field[i] - mean) / sd) * 4)
    const code = Math.max(0, Math.min(255, Math.round((0.5 + v * 0.3) * 255)))
    d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = code
    d.data[i * 4 + 3] = 255
  }
  return d
}

/** A plate with independent per-channel noise, for testing the chroma control. */
function makeColourNoise(w: number, h: number): ImageData {
  const d = new ImageData(w, h)
  let seed = 5150
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < d.data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      d.data[i + c] = Math.max(0, Math.min(255, Math.round(128 + (rand() + rand() + rand() - 1.5) * 90)))
    }
    d.data[i + 3] = 255
  }
  return d
}

function makeNoiseGrain(w: number, h: number): ImageData {
  const d = new ImageData(w, h)
  let seed = 12345
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let i = 0; i < d.data.length; i += 4) {
    // Roughly gaussian around mid-grey.
    const v = Math.round(128 + (rand() + rand() + rand() - 1.5) * 60)
    d.data[i] = d.data[i + 1] = d.data[i + 2] = Math.max(0, Math.min(255, v))
    d.data[i + 3] = 255
  }
  return d
}

function readPixels(canvas: HTMLCanvasElement | OffscreenCanvas): ImageData {
  const c = document.createElement('canvas')
  c.width = canvas.width
  c.height = canvas.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(canvas as CanvasImageSource, 0, 0)
  return ctx.getImageData(0, 0, c.width, c.height)
}

function maxDiff(a: ImageData, b: ImageData): number {
  let m = 0
  for (let i = 0; i < a.data.length; i++) {
    if (i % 4 === 3) continue
    m = Math.max(m, Math.abs(a.data[i] - b.data[i]))
  }
  return m
}

function imageMean(img: ImageData): number {
  let sum = 0
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    sum += img.data[i]
    n++
  }
  return sum / n
}

function stdDev(img: ImageData): number {
  let sum = 0
  let sumSq = 0
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    const v = img.data[i]
    sum += v
    sumSq += v * v
    n++
  }
  return Math.sqrt(sumSq / n - (sum / n) ** 2)
}

function run() {
  const W = 256
  const H = 192
  const engine = new GrainEngine()
  const base = makeBase(W, H)
  const baseSize = { width: W, height: H }
  const flat = makeFlatGrain(64, 64)
  const noise = makeNoiseGrain(64, 64)
  const grainSize = { width: 64, height: 64 }

  const render = (
    grain: ImageData,
    params: Partial<typeof DEFAULT_BLEND_PARAMS>,
    region?: any,
    outputSize?: any,
    grainMean?: number,
  ) =>
    readPixels(
      engine.render({
        base,
        baseSize,
        grain,
        grainSize,
        grainMean,
        params: { ...DEFAULT_BLEND_PARAMS, ...params },
        region,
        outputSize,
      }),
    )

  // Baseline: amount 0 must be an exact passthrough of the base image.
  const passthrough = render(noise, { amount: 0 })
  check('amount=0 is a passthrough', maxDiff(passthrough, base) <= 1, `maxΔ=${maxDiff(passthrough, base)}`)

  // Blend math against a CPU reference, using a flat plate so tiling plays no
  // part. Note 8-bit "mid grey" is 128/255, half a code value above true
  // neutral — in linear space that half-step lands as a visible offset in deep
  // shadow, which is why this compares against the reference rather than
  // asserting the render is untouched.
  for (const mode of ['overlay', 'softLight', 'linearLight'] as BlendMode[]) {
    for (const space of ['srgb', 'linear'] as ColorSpace[]) {
      const out = render(flat, { blendMode: mode, amount: 1, colorSpace: space, tiling: 'repeat' })
      const expected = referenceBlend(base, 128 / 255, mode, space, 1)
      const d = maxDiff(out, expected)
      check(`${mode} matches CPU reference (${space})`, d <= 2, `maxΔ=${d}`)
    }
  }

  // Amount must interpolate, not switch: half amount sits between the ends.
  const full = render(noise, { amount: 1, blendMode: 'overlay' })
  const half = render(noise, { amount: 0.5, blendMode: 'overlay' })
  let between = 0
  for (let i = 0; i < half.data.length; i += 4) {
    const lo = Math.min(base.data[i], full.data[i])
    const hi = Math.max(base.data[i], full.data[i])
    if (half.data[i] >= lo - 2 && half.data[i] <= hi + 2) between++
  }
  const ratio = between / (half.data.length / 4)
  check('amount=0.5 lies between bypass and full', ratio > 0.99, `${(ratio * 100).toFixed(2)}% of pixels`)

  // The property the whole architecture rests on: a 1:1 preview crop is a
  // literal sub-rectangle of the full-resolution render.
  // Deliberately awkward parameters: rotation, a non-integer scale and partial
  // chroma all feed the sampling coordinate, so they are exactly what would
  // break the crop/export guarantee if any of them depended on the viewport.
  const hardParams = {
    amount: 0.8,
    tiling: 'stochastic' as const,
    grainRotation: 33,
    grainScale: 1.7,
    chroma: 0.4,
    softness: 0.4,
    response: [
      { x: 0, y: 1.4 },
      { x: 0.5, y: 0.8 },
      { x: 1, y: 0.3 },
    ],
  }
  const fullRender = render(noise, hardParams)
  const cropRegion = { x: 61, y: 37, width: 96, height: 64 }
  const crop = render(noise, hardParams, cropRegion, {
    width: cropRegion.width,
    height: cropRegion.height,
  })
  const repeatFull = render(noise, { amount: 0.8, tiling: 'repeat' })
  const repeatCrop = render(noise, { amount: 0.8, tiling: 'repeat' }, cropRegion, {
    width: cropRegion.width,
    height: cropRegion.height,
  })
  let repeatMax = 0
  for (let y = 0; y < cropRegion.height; y++) {
    for (let x = 0; x < cropRegion.width; x++) {
      const a = ((y + cropRegion.y) * W + x + cropRegion.x) * 4
      const b = (y * cropRegion.width + x) * 4
      for (let c = 0; c < 3; c++) repeatMax = Math.max(repeatMax, Math.abs(repeatFull.data[a + c] - repeatCrop.data[b + c]))
    }
  }
  check('1:1 crop matches full render (repeat tiling)', repeatMax <= 1, `maxΔ=${repeatMax}`)

  // Each photo gets its own grain position and paper: the same seed renders
  // identically, another seed differently, and with varyPerPhoto off the seed
  // is ignored. A preview crop still matches the export under a seed.
  {
    const seeded = (imageSeed: number | undefined, vary = true, region?: any) =>
      readPixels(
        engine.render({
          base,
          baseSize,
          grain: noise,
          grainSize,
          imageSeed,
          params: {
            ...DEFAULT_BLEND_PARAMS,
            ...hardParams,
            varyPerPhoto: vary,
            border: { ...DEFAULT_BORDER, width: 0.08, irregularity: 0.8, texture: 0.8 },
            modules: { ...DEFAULT_BLEND_PARAMS.modules, border: true },
          },
          region,
          outputSize: region ? { width: region.width, height: region.height } : undefined,
        }),
      )
    const a1 = seeded(123456789)
    const a2 = seeded(123456789)
    const b = seeded(987654321)
    const off = seeded(987654321, false)
    const none = seeded(undefined)
    // Paper only: the top-left border strip.
    const strip = (img: ImageData) => {
      let d = 0
      for (let y = 0; y < 10; y++) for (let x = 0; x < img.width; x++) d += img.data[(y * img.width + x) * 4]
      return d
    }
    check(
      'per-photo seed: same photo renders the same, another photo differently',
      maxDiff(a1, a2) === 0 && maxDiff(a1, b) > 20 && strip(a1) !== strip(b),
      `same Δ=${maxDiff(a1, a2)}, other Δ=${maxDiff(a1, b)}`,
    )
    check('per-photo seed is ignored when varyPerPhoto is off', maxDiff(off, none) === 0, `Δ=${maxDiff(off, none)}`)
    const r = { x: 40, y: 30, width: 96, height: 64 }
    const crop = seeded(123456789, true, r)
    let m = 0
    for (let y = 0; y < r.height; y++)
      for (let x = 0; x < r.width; x++)
        for (let c = 0; c < 3; c++)
          m = Math.max(m, Math.abs(a1.data[((y + r.y) * a1.width + x + r.x) * 4 + c] - crop.data[(y * r.width + x) * 4 + c]))
    check('1:1 crop matches full render with a per-photo seed', m <= 2, `maxΔ=${m}`)
  }

  // Main colours: the Rest tint colours the faded greys, and a grey Pop colour
  // takes the standout colour's hue away — so with Rest fully faded, most of
  // the colour is gone (hues at the edge of the band keep a little).
  {
    const graded = (g: Partial<typeof DEFAULT_GRADE>) =>
      readPixels(
        engine.render({
          base,
          baseSize,
          grain: flat,
          grainSize,
          params: {
            ...DEFAULT_BLEND_PARAMS,
            amount: 0,
            effects: { ...DEFAULT_EFFECTS, grade: { ...DEFAULT_GRADE, isolateColour: { source: 'manual', colour: [1, 0.5, 0.1] }, ...g } },
          },
        }),
      )
    const spread = (img: ImageData) => {
      let t = 0
      for (let i = 0; i < img.data.length; i += 4)
        t += Math.max(img.data[i], img.data[i + 1], img.data[i + 2]) - Math.min(img.data[i], img.data[i + 1], img.data[i + 2])
      return t / (img.data.length / 4)
    }
    const blueBias = (img: ImageData) => {
      let t = 0
      for (let i = 0; i < img.data.length; i += 4) t += img.data[i + 2] - img.data[i]
      return t / (img.data.length / 4)
    }
    const grey = graded({ isolateAmount: 1 })
    const blue = graded({ isolateAmount: 1, restColour: { source: 'manual', colour: [0.3, 0.4, 0.8] } })
    check('Rest tint colours the faded greys', blueBias(blue) > blueBias(grey) + 5, `blue bias ${blueBias(grey).toFixed(1)} → ${blueBias(blue).toFixed(1)}`)
    const kept = graded({ isolateAmount: 1, isolateWidth: 1 })
    const greyed = graded({ isolateAmount: 1, isolateWidth: 1, popAmount: 1, popColour: { source: 'manual', colour: [0.5, 0.5, 0.5] } })
    check('a grey Pop colour takes the standout colour away', spread(greyed) < spread(kept) * 0.5, `chroma ${spread(kept).toFixed(1)} → ${spread(greyed).toFixed(1)}`)
    // A full gradient map in greys repaints everything; Pop → Keep shields the
    // standout colour from it.
    const greyMap = { mapAmount: 1, mapShadow: { source: 'manual' as const, colour: [0.2, 0.2, 0.2] as [number, number, number] }, mapMid: { source: 'manual' as const, colour: [0.5, 0.5, 0.5] as [number, number, number] }, mapHigh: { source: 'manual' as const, colour: [0.9, 0.9, 0.9] as [number, number, number] } }
    const mapped = graded({ ...greyMap, isolateWidth: 1 })
    const shielded = graded({ ...greyMap, isolateWidth: 1, popKeep: 1 })
    check('Pop Keep shields the standout colour from the gradient map', spread(shielded) > spread(mapped) + 10, `chroma ${spread(mapped).toFixed(1)} → ${spread(shielded).toFixed(1)}`)
  }

  let cropMax = 0
  let cropWorstAt = ''
  let cropDiffCount = 0
  for (let y = 0; y < cropRegion.height; y++) {
    for (let x = 0; x < cropRegion.width; x++) {
      const a = ((y + cropRegion.y) * W + x + cropRegion.x) * 4
      const b = (y * cropRegion.width + x) * 4
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(fullRender.data[a + c] - crop.data[b + c])
        if (d > 1) cropDiffCount++
        if (d > cropMax) {
          cropMax = d
          cropWorstAt = `x=${x + cropRegion.x},y=${y + cropRegion.y}`
        }
      }
    }
  }
  check(
    '1:1 crop matches the full-res render under rotation and scaling',
    cropMax <= 1,
    `maxΔ=${cropMax} at ${cropWorstAt} (rotation makes the coordinate a float op, so a single code of rounding is allowed here; the unrotated case above is exact), ${cropDiffCount} samples differing by more than a code, of ${cropRegion.width * cropRegion.height * 3}`,
  )

  // Stochastic tiling must not wash the grain out: contrast against a flat
  // base should stay close to plain repeat tiling.
  const flatBase = makeFlatGrain(W, H, 128)
  const grainOnly = (tiling: 'repeat' | 'stochastic') =>
    stdDev(
      readPixels(
        engine.render({
          base: flatBase,
          baseSize,
          grain: noise,
          grainSize,
          params: { ...DEFAULT_BLEND_PARAMS, tiling, amount: 1, blendMode: 'linearLight', colorSpace: 'srgb' },
        }),
      ),
    )
  const sRepeat = grainOnly('repeat')
  const sStoch = grainOnly('stochastic')
  check(
    'stochastic tiling preserves grain contrast',
    Math.abs(sStoch - sRepeat) / sRepeat < 0.15,
    `repeat σ=${sRepeat.toFixed(2)}, stochastic σ=${sStoch.toFixed(2)}`,
  )

  // Seam check on a realistic plate: grain with the uneven density a real scan
  // has, so its left and right edges do not match. A seam shows up as columns
  // of unusually large pixel-to-pixel change exactly at the plate period.
  const seamPlate = makeUnevenGrain(64, 64)
  const seamRatio = (tiling: 'repeat' | 'stochastic') => {
    const img = readPixels(
      engine.render({
        base: flatBase,
        baseSize,
        grain: seamPlate,
        grainSize,
        grainMean: 0.5,
        params: { ...DEFAULT_BLEND_PARAMS, tiling, amount: 1, blendMode: 'linearLight', colorSpace: 'srgb' },
      }),
    )
    const colDiff: number[] = []
    for (let x = 1; x < W; x++) {
      let sum = 0
      for (let y = 0; y < H; y++) {
        const i = (y * W + x) * 4
        sum += Math.abs(img.data[i] - img.data[i - 4])
      }
      colDiff.push(sum / H)
    }
    const atSeam = colDiff.filter((_, idx) => (idx + 1) % 64 === 0)
    const elsewhere = colDiff.filter((_, idx) => (idx + 1) % 64 !== 0)
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    return mean(atSeam) / mean(elsewhere)
  }
  const seamRepeat = seamRatio('repeat')
  const seamStoch = seamRatio('stochastic')
  check('plain repeat shows a seam at the plate period', seamRepeat > 1.5, `ratio=${seamRepeat.toFixed(2)}`)
  check(
    'stochastic tiling leaves no seam at the plate period',
    seamStoch < 1.15,
    `seam/elsewhere ratio=${seamStoch.toFixed(2)} (repeat=${seamRepeat.toFixed(2)})`,
  )


  // Response curve: flat is a no-op, zero removes grain, and a shadows-only
  // curve must leave the highlights alone.
  const flatResponse = render(noise, { amount: 0.7 })
  const explicitFlat = render(noise, { amount: 0.7, response: [...FLAT_CURVE] })
  check('flat response curve changes nothing', maxDiff(flatResponse, explicitFlat) === 0)

  const noResponse = render(noise, { amount: 1, response: [{ x: 0, y: 0 }, { x: 1, y: 0 }] })
  check('zero response curve removes all grain', maxDiff(noResponse, base) <= 1, `maxΔ=${maxDiff(noResponse, base)}`)

  // Note this measures mean movement, not "every pixel moved": in deep shadow
  // an overlay blend shifts the value by well under one 8-bit code, so a
  // per-pixel test would fail on quantisation rather than on behaviour.
  const shadowsOnly = render(noise, {
    amount: 1,
    response: [
      { x: 0, y: 2 },
      { x: 0.5, y: 0 },
      { x: 1, y: 0 },
    ],
  })
  let brightTouched = 0
  let darkDelta = 0
  let darkTotal = 0
  for (let i = 0; i < base.data.length; i += 4) {
    const luma = (0.2126 * base.data[i] + 0.7152 * base.data[i + 1] + 0.0722 * base.data[i + 2]) / 255
    const delta = Math.abs(shadowsOnly.data[i] - base.data[i])
    if (luma > 0.62) {
      if (delta > 1) brightTouched++
    } else if (luma < 0.25) {
      darkDelta += delta
      darkTotal++
    }
  }
  const meanDark = darkDelta / Math.max(darkTotal, 1)
  check(
    'shadows-only curve grains the shadows and spares the highlights',
    brightTouched === 0 && meanDark > 1,
    `${brightTouched} highlight pixels touched, mean shadow shift=${meanDark.toFixed(2)} codes`,
  )

  // The shader reads a baked LUT; it must agree with the curve the editor drew.
  const testCurve = CURVE_PRESETS[1].curve
  const lut = curveToLut(testCurve)
  let lutError = 0
  for (let i = 0; i < 256; i++) {
    const expected = evaluateCurve(testCurve, i / 255)
    lutError = Math.max(lutError, Math.abs((lut[i * 4] / 255) * MAX_STRENGTH - expected))
  }
  check('baked LUT matches the curve', lutError < 0.01, `max error=${lutError.toFixed(4)} of ${MAX_STRENGTH}`)

  // Monotone interpolation: a curve pulled to zero must not overshoot back up
  // between control points, which would put grain where the user removed it.
  const pulled = normaliseCurve([
    { x: 0, y: 1.8 },
    { x: 0.35, y: 0 },
    { x: 0.7, y: 0 },
    { x: 1, y: 1.8 },
  ])
  let minBetween = Infinity
  for (let i = 0; i <= 100; i++) {
    const x = 0.35 + (i / 100) * 0.35
    minBetween = Math.min(minBetween, evaluateCurve(pulled, x))
  }
  check('curve does not overshoot below its control points', minBetween >= -1e-6, `min=${minBetween.toFixed(4)}`)

  let maxOvershoot = 0
  for (let i = 0; i <= 200; i++) {
    const x = i / 200
    maxOvershoot = Math.max(maxOvershoot, evaluateCurve(pulled, x))
  }
  check('curve does not overshoot above its control points', maxOvershoot <= 1.8 + 1e-6, `max=${maxOvershoot.toFixed(4)}`)

  // Softness should reduce grain contrast without shifting overall density.
  const sharpGrain = readPixels(
    engine.render({
      base: flatBase,
      baseSize,
      grain: noise,
      grainSize,
      params: { ...DEFAULT_BLEND_PARAMS, amount: 1, softness: 0, blendMode: 'linearLight', colorSpace: 'srgb' },
    }),
  )
  const softGrain = readPixels(
    engine.render({
      base: flatBase,
      baseSize,
      grain: noise,
      grainSize,
      params: { ...DEFAULT_BLEND_PARAMS, amount: 1, softness: 1, blendMode: 'linearLight', colorSpace: 'srgb' },
    }),
  )
  check(
    'softness blurs the grain without shifting density',
    stdDev(softGrain) < stdDev(sharpGrain) * 0.8 && Math.abs(imageMean(softGrain) - imageMean(sharpGrain)) < 2,
    `σ ${stdDev(sharpGrain).toFixed(1)} -> ${stdDev(softGrain).toFixed(1)}, mean shift ${(imageMean(softGrain) - imageMean(sharpGrain)).toFixed(2)}`,
  )

  // Chroma 0 must produce neutral grain: equal movement in all three channels.
  const colourGrain = makeColourNoise(64, 64)
  const mono = readPixels(
    engine.render({
      base: flatBase,
      baseSize,
      grain: colourGrain,
      grainSize,
      params: { ...DEFAULT_BLEND_PARAMS, amount: 1, chroma: 0, blendMode: 'linearLight', colorSpace: 'srgb' },
    }),
  )
  let maxChannelSpread = 0
  for (let i = 0; i < mono.data.length; i += 4) {
    const hi = Math.max(mono.data[i], mono.data[i + 1], mono.data[i + 2])
    const lo = Math.min(mono.data[i], mono.data[i + 1], mono.data[i + 2])
    maxChannelSpread = Math.max(maxChannelSpread, hi - lo)
  }
  check('chroma=0 makes grain neutral', maxChannelSpread <= 2, `max channel spread=${maxChannelSpread}`)

  const colourful = readPixels(
    engine.render({
      base: flatBase,
      baseSize,
      grain: colourGrain,
      grainSize,
      params: { ...DEFAULT_BLEND_PARAMS, amount: 1, chroma: 1, blendMode: 'linearLight', colorSpace: 'srgb' },
    }),
  )
  let colourSpread = 0
  for (let i = 0; i < colourful.data.length; i += 4) {
    colourSpread = Math.max(
      colourSpread,
      Math.max(colourful.data[i], colourful.data[i + 1]) - Math.min(colourful.data[i], colourful.data[i + 1]),
    )
  }
  check('chroma=1 keeps the plate colour', colourSpread > 20, `max channel spread=${colourSpread}`)



  // The curve editor draws what the blend mode does to the response on its own.
  // That hint is only worth showing if it agrees with what the engine renders,
  // so check the predicted sensitivity against measured output at each tone.
  const sensitivityPlate = makeOffsetGrain(256, 0.5, 0.06)
  const sensitivityStats = { mean: imageMean(sensitivityPlate) / 255, sd: stdDev(sensitivityPlate) / 255 }
  for (const mode of ['overlay', 'linearLight'] as BlendMode[]) {
    const measured: number[] = []
    const predicted: number[] = []
    // Sampled away from black and white: near the ends the grain's tails clip,
    // which suppresses the measured deviation below what a derivative predicts
    // (measured 0.85 against a predicted 1.00 at luma 26). That is real
    // behaviour, not a wrong hint, and the hint does not claim to model it.
    for (const luma of [51, 96, 128, 160, 204]) {
      const patch = makeFlatGrain(96, 96, luma)
      const out = readPixels(
        engine.render({
          base: patch,
          baseSize: { width: 96, height: 96 },
          grain: sensitivityPlate,
          grainSize: { width: 256, height: 256 },
          grainMean: sensitivityStats.mean,
          grainSd: sensitivityStats.sd,
          // A modest amount keeps the grain off the clipping points: the hint
          // is a small-signal sensitivity and does not model clipped tails.
          params: { ...DEFAULT_BLEND_PARAMS, blendMode: mode, amount: 0.25, colorSpace: 'srgb', tiling: 'repeat' },
        }),
      )
      measured.push(stdDev(out))
      predicted.push(blendSensitivity(mode, 'srgb', luma / 255))
    }
    // Compare shapes, not absolute scale: both normalised to their own peak.
    const normalise = (xs: number[]) => { const peak = Math.max(...xs); return xs.map((x) => x / peak) }
    const m = normalise(measured)
    const p = normalise(predicted)
    const worst = Math.max(...m.map((v, i) => Math.abs(v - p[i])))
    check(
      `the editor's ${mode} response hint matches what the engine renders`,
      worst < 0.12,
      `largest difference ${worst.toFixed(3)} across the tone range`,
    )
  }
  check(
    'overlay really does collapse the shadows that linear light keeps',
    blendSensitivity('overlay', 'srgb', 0.06) / peakBlendSensitivity('overlay', 'srgb') < 0.2 &&
      blendSensitivity('linearLight', 'srgb', 0.06) / peakBlendSensitivity('linearLight', 'srgb') > 0.7,
    `at luma 0.06 overlay retains ${(blendSensitivity('overlay', 'srgb', 0.06) / peakBlendSensitivity('overlay', 'srgb')).toFixed(2)}, linear light ${(blendSensitivity('linearLight', 'srgb', 0.06) / peakBlendSensitivity('linearLight', 'srgb')).toFixed(2)}`,
  )


  // --- light-transport stages ----------------------------------------------
  // A bright disc on a dark field: the only place glow can come from.
  const discSize = { width: 256, height: 256 }
  const disc = (() => {
    const d = new ImageData(256, 256)
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4
        const v = Math.hypot(x - 128, y - 128) < 34 ? 250 : 26
        d.data[i] = v
        d.data[i + 1] = v
        d.data[i + 2] = v
        d.data[i + 3] = 255
      }
    }
    return d
  })()
  const neutralPlate = makeFlatGrain(8, 8, 128)
  const withEffects = (effects: Partial<typeof DEFAULT_EFFECTS>, region?: Rect, outputSize?: Size) =>
    readPixels(
      engine.render({
        base: disc,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        region,
        outputSize,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, ...effects } },
      }),
    )
  const pixel = (img: ImageData, x: number, y: number) => {
    const i = (y * img.width + x) * 4
    return { r: img.data[i], g: img.data[i + 1], b: img.data[i + 2] }
  }

  const noEffects = withEffects({})
  // A warm glow colour, set here: the default takes the photo's own light, which on this grey scene is grey.
  const haloed = withEffects({ halation: 0.7, glowRadius: 0.06, glowColour: { source: 'manual', colour: [1, 0.61, 0.38] } })
  const nearGlow = pixel(haloed, 128 + 45, 128)
  const farGlow = pixel(haloed, 128 + 110, 128)
  check(
    'halation bleeds warm light out of the highlights',
    nearGlow.r > nearGlow.b + 12 && nearGlow.r > pixel(noEffects, 128 + 45, 128).r + 12,
    `just outside the disc: r${nearGlow.r} g${nearGlow.g} b${nearGlow.b}, was r${pixel(noEffects, 128 + 45, 128).r}`,
  )
  check(
    'halation falls off with distance and never darkens',
    farGlow.r >= pixel(noEffects, 128 + 110, 128).r && farGlow.r < nearGlow.r,
    `r${nearGlow.r} at 45px vs r${farGlow.r} at 110px (base r${pixel(noEffects, 128 + 110, 128).r})`,
  )

  const bloomed = withEffects({ bloom: 0.6, glowRadius: 0.06 })
  const bloomPixel = pixel(bloomed, 128 + 45, 128)
  check(
    'bloom glows without a colour cast',
    bloomPixel.r > pixel(noEffects, 128 + 45, 128).r + 10 && Math.abs(bloomPixel.r - bloomPixel.b) <= 2,
    `r${bloomPixel.r} g${bloomPixel.g} b${bloomPixel.b}`,
  )

  // The guarantee the whole architecture rests on, now that a stage reads light
  // from outside the region being rendered.
  const glowRegion = { x: 130, y: 90, width: 80, height: 70 }
  const glowCrop = withEffects({ halation: 0.7, glowRadius: 0.06, glowColour: { source: 'manual', colour: [1, 0.61, 0.38] } }, glowRegion, { width: 80, height: 70 })
  let glowCropDiff = 0
  for (let y = 0; y < glowRegion.height; y++) {
    for (let x = 0; x < glowRegion.width; x++) {
      const a = ((y + glowRegion.y) * 256 + x + glowRegion.x) * 4
      const b = (y * glowRegion.width + x) * 4
      for (let c = 0; c < 3; c++) glowCropDiff = Math.max(glowCropDiff, Math.abs(haloed.data[a + c] - glowCrop.data[b + c]))
    }
  }
  check(
    'a preview crop still matches the export with halation on',
    glowCropDiff <= 1,
    `maxΔ=${glowCropDiff} — the glow is built from the whole frame, not the crop`,
  )

  const vignetted = withEffects({ vignette: 0.6 })
  check(
    'vignette darkens the corners and leaves the centre alone',
    pixel(vignetted, 128, 128).r === pixel(noEffects, 128, 128).r && pixel(vignetted, 6, 6).r < pixel(noEffects, 6, 6).r,
    `centre ${pixel(vignetted, 128, 128).r} unchanged, corner ${pixel(noEffects, 6, 6).r} -> ${pixel(vignetted, 6, 6).r}`,
  )

  // --- vibe stages ----------------------------------------------------------
  const scene = (value: (x: number, y: number) => [number, number, number]) => {
    const d = new ImageData(256, 256)
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4
        const [r, g, b] = value(x, y)
        d.data[i] = r
        d.data[i + 1] = g
        d.data[i + 2] = b
        d.data[i + 3] = 255
      }
    }
    return d
  }
  const renderScene = (base: ImageData, effects: Partial<typeof DEFAULT_EFFECTS>, region?: Rect, outputSize?: Size) =>
    readPixels(
      engine.render({
        base,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        region,
        outputSize,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, ...effects } },
      }),
    )

  // The whole-frame blur passes write into render targets, whose rows run the
  // other way from the photo's. A disc near the top must glow near the top —
  // the centred disc above cannot tell, which is how a flipped glow shipped.
  const topDisc = scene((x, y) => (Math.hypot(x - 128, y - 60) < 30 ? [250, 250, 250] : [26, 26, 26]))
  const topPlain = renderScene(topDisc, {})
  const topGlow = renderScene(topDisc, { halation: 0.7, glowRadius: 0.06 })
  check(
    'glow is the right way up',
    pixel(topGlow, 128, 100).r > pixel(topPlain, 128, 100).r + 10 &&
      pixel(topGlow, 128, 196).r <= pixel(topPlain, 128, 196).r + 3,
    `below the disc +${pixel(topGlow, 128, 100).r - pixel(topPlain, 128, 100).r}, at its mirror image +${pixel(topGlow, 128, 196).r - pixel(topPlain, 128, 196).r}`,
  )

  // Edge glow: a bright left half against a dark right half.
  const step = scene((x) => (x < 128 ? [235, 150, 90] : [10, 10, 12]))
  const stepPlain = renderScene(step, {})
  const stepRim = renderScene(step, { rim: 1.5, rimRadius: 0.02 })
  check(
    'edge glow lights the dark side of an edge',
    pixel(stepRim, 130, 128).r > pixel(stepPlain, 130, 128).r + 15 && pixel(stepRim, 130, 128).r > pixel(stepRim, 130, 128).b,
    `next to the edge r${pixel(stepPlain, 130, 128).r} -> r${pixel(stepRim, 130, 128).r} b${pixel(stepRim, 130, 128).b}`,
  )
  check(
    'edge glow leaves flat areas alone',
    Math.abs(pixel(stepRim, 220, 128).r - pixel(stepPlain, 220, 128).r) <= 1 &&
      Math.abs(pixel(stepRim, 40, 128).g - pixel(stepPlain, 40, 128).g) <= 1,
    `far dark Δ${pixel(stepRim, 220, 128).r - pixel(stepPlain, 220, 128).r}, far bright Δ${pixel(stepRim, 40, 128).g - pixel(stepPlain, 40, 128).g}`,
  )
  const flatScene = scene(() => [120, 100, 90])
  check(
    'crunch leaves a flat field alone',
    maxDiff(renderScene(flatScene, { crunch: 1, rimRadius: 0.02 }), renderScene(flatScene, {})) <= 1,
  )
  const crunched = renderScene(step, { crunch: 0.8, rimRadius: 0.02 })
  check(
    'crunch steepens an edge',
    pixel(crunched, 124, 128).g > pixel(stepPlain, 124, 128).g && pixel(crunched, 132, 128).g <= pixel(stepPlain, 132, 128).g,
    `bright side ${pixel(stepPlain, 124, 128).g} -> ${pixel(crunched, 124, 128).g}, dark side ${pixel(stepPlain, 132, 128).g} -> ${pixel(crunched, 132, 128).g}`,
  )

  const leaksAt = (seed: number) => ({ ...DEFAULT_LEAKS, amount: 0.8, spots: randomSpots(seed, 2), seed })
  // Halo: luminance-only rims where light meets dark; nothing on a flat field.
  check('the halo leaves a flat field alone', maxDiff(renderScene(flatScene, { halo: 1, haloRadius: 0.05 }), renderScene(flatScene, {})) <= 1)
  const rimmed = renderScene(step, { halo: 1, haloRadius: 0.05 })
  check(
    'the halo lightens the bright side of an edge and darkens the dark side',
    pixel(rimmed, 120, 128).g > pixel(stepPlain, 120, 128).g && pixel(rimmed, 136, 128).g <= pixel(stepPlain, 136, 128).g,
    `bright ${pixel(stepPlain, 120, 128).g} -> ${pixel(rimmed, 120, 128).g}, dark ${pixel(stepPlain, 136, 128).g} -> ${pixel(rimmed, 136, 128).g}`,
  )
  // Structure: texture-scale contrast — a flat field stays flat, ripples deepen.
  check(
    'structure leaves a flat field alone',
    maxDiff(renderScene(flatScene, { structure: 1, structureRadius: 0.03 }), renderScene(flatScene, {})) <= 1,
  )
  const ripples = scene((_x, y) => {
    const v = 70 + 18 * Math.sin(y * 0.5)
    return [v, v, v + 10]
  })
  const rippleContrast = (img: ImageData) => {
    let lo = 255
    let hi = 0
    for (let y = 100; y < 140; y++) {
      lo = Math.min(lo, pixel(img, 128, y).g)
      hi = Math.max(hi, pixel(img, 128, y).g)
    }
    return hi - lo
  }
  const plainRipples = rippleContrast(renderScene(ripples, {}))
  const structured = rippleContrast(renderScene(ripples, { structure: 1, structureRadius: 0.03 }))
  check('structure deepens texture-scale detail', structured > plainRipples * 1.3, `ripple range ${plainRipples} -> ${structured}`)

  // Solarize: only above its threshold, and there the brightest tones fall.
  const brightScene = scene((x) => [x, x, x])
  const solarized = renderScene(brightScene, { solarize: 1, solarizeFrom: 0.6 })
  const plainRamp = renderScene(brightScene, {})
  check(
    'solarize reverses the brightest tones and leaves the rest',
    pixel(solarized, 100, 128).g === pixel(plainRamp, 100, 128).g && pixel(solarized, 255, 128).g < pixel(solarized, 215, 128).g,
    `100: ${pixel(plainRamp, 100, 128).g} -> ${pixel(solarized, 100, 128).g}; 215: ${pixel(solarized, 215, 128).g}, 255: ${pixel(solarized, 255, 128).g}`,
  )

  const leakA = renderScene(flatScene, { leaks: leaksAt(5) })
  const leakB = renderScene(flatScene, { leaks: leaksAt(5) })
  const leakC = renderScene(flatScene, { leaks: leaksAt(6) })
  check('leaks are deterministic for a seed', maxDiff(leakA, leakB) === 0)
  check('a different leak seed moves the leaks', maxDiff(leakA, leakC) > 20)
  check(
    'a warm leak adds warm light',
    imageMean(leakA) > imageMean(renderScene(flatScene, {})) + 3,
    `mean ${imageMean(renderScene(flatScene, {})).toFixed(1)} -> ${imageMean(leakA).toFixed(1)}`,
  )

  // Leak styles: the same seed gives the same leaks, and raising the count
  // adds leaks without moving the ones already placed.
  const stable = LEAK_STYLES.every((style) => {
    const few = style.generate(77, 3)
    const more = style.generate(77, 6)
    return JSON.stringify(more.slice(0, 3)) === JSON.stringify(few) && JSON.stringify(style.generate(77, 3)) === JSON.stringify(few)
  })
  check('leak styles are deterministic and adding leaks keeps the existing ones', stable)
  const differs = LEAK_STYLES.every((style) => JSON.stringify(style.generate(1, 2)) !== JSON.stringify(style.generate(2, 2)))
  check('a new leak seed gives new leaks in every style', differs)

  // A leak's own colour overrides the leaks' colour.
  const centreSpot = { x: 0.5, y: 0.5, size: 0.4, stretch: 1, angle: 0, strength: 1, kind: 'light' as const }
  const blueLeaks = { ...DEFAULT_LEAKS, amount: 0.8, colour: { source: 'manual' as const, colour: [0.3, 0.5, 1] as [number, number, number] } }
  const asLeaks = pixel(renderScene(flatScene, { leaks: { ...blueLeaks, spots: [centreSpot] } }), 128, 128)
  const ownRed = pixel(
    renderScene(flatScene, { leaks: { ...blueLeaks, spots: [{ ...centreSpot, colour: { source: 'manual', colour: [1, 0.2, 0.1] } }] } }),
    128,
    128,
  )
  check(
    'a leak can have its own colour',
    asLeaks.b > asLeaks.r && ownRed.r > ownRed.b + 20,
    `leak colour rgb ${asLeaks.r} ${asLeaks.g} ${asLeaks.b}, own colour ${ownRed.r} ${ownRed.g} ${ownRed.b}`,
  )

  // A painted shape fills its outline: lit inside, untouched well outside, and
  // the same in a preview crop as in the export.
  const square = [
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.3 },
    { x: 0.7, y: 0.7 },
    { x: 0.3, y: 0.7 },
  ]
  const shapeLeaks = {
    ...DEFAULT_LEAKS,
    amount: 0.8,
    spots: [{ x: 0, y: 0, size: 0.03, stretch: 1, angle: 0, strength: 1, kind: 'light' as const, outline: square }],
  }
  const shaped = renderScene(flatScene, { leaks: shapeLeaks })
  const flatPlainPx = pixel(renderScene(flatScene, {}), 128, 128)
  check(
    'a painted shape lights its inside and leaves the outside alone',
    pixel(shaped, 128, 128).r > flatPlainPx.r + 20 && Math.abs(pixel(shaped, 12, 12).r - flatPlainPx.r) <= 1,
    `inside r ${flatPlainPx.r} -> ${pixel(shaped, 128, 128).r}, outside r ${pixel(shaped, 12, 12).r}`,
  )
  const shapeRegion = { x: 40, y: 50, width: 90, height: 70 }
  const shapeCrop = renderScene(flatScene, { leaks: shapeLeaks }, shapeRegion, { width: 90, height: 70 })
  let shapeCropDiff = 0
  for (let y = 0; y < shapeRegion.height; y++) {
    for (let x = 0; x < shapeRegion.width; x++) {
      const a = ((y + shapeRegion.y) * 256 + x + shapeRegion.x) * 4
      const b = (y * shapeRegion.width + x) * 4
      for (let c = 0; c < 3; c++) shapeCropDiff = Math.max(shapeCropDiff, Math.abs(shaped.data[a + c] - shapeCrop.data[b + c]))
    }
  }
  check('a preview crop matches the export with a painted shape', shapeCropDiff <= 1, `maxΔ=${shapeCropDiff}`)

  // Grain that follows colour: quiet over neutral grey, kept over rich colour.
  const followPlate = makeOffsetGrain(128, 0.5, 0.09)
  const grainOn = (base: ImageData, follow: number) =>
    stdDev(
      readPixels(
        engine.render({
          base,
          baseSize: discSize,
          grain: followPlate,
          grainSize: { width: 128, height: 128 },
          grainMean: 0.5,
          grainSd: 0.09,
          params: { ...DEFAULT_BLEND_PARAMS, amount: 0.4, grainFollowsColour: follow },
        }),
      ),
    )
  const greyScene = scene(() => [128, 128, 128])
  const richScene = scene(() => [210, 90, 40])
  check(
    'grain that follows colour goes quiet over neutral grey',
    grainOn(greyScene, 1) < grainOn(greyScene, 0) * 0.5,
    `σ ${grainOn(greyScene, 0).toFixed(1)} -> ${grainOn(greyScene, 1).toFixed(1)}`,
  )
  check(
    'and keeps its strength over rich colour',
    grainOn(richScene, 1) > grainOn(richScene, 0) * 0.85,
    `σ ${grainOn(richScene, 0).toFixed(1)} -> ${grainOn(richScene, 1).toFixed(1)}`,
  )

  const greenPatch = scene(() => [60, 160, 60])
  const violet = pixel(renderScene(greenPatch, { stock: { id: 'violet', strength: 1, keepTone: 0 } }), 128, 128)
  check('the violet stock turns greens blue', violet.b > violet.g, `rgb ${violet.r} ${violet.g} ${violet.b}`)
  check(
    'the natural stock is a no-op',
    maxDiff(renderScene(greenPatch, { stock: { id: 'none', strength: 1, keepTone: 0 } }), renderScene(greenPatch, {})) === 0,
  )
  check(
    'exposure pushes the light up in stops',
    pixel(renderScene(flatScene, { exposure: 1 }), 128, 128).r > pixel(renderScene(flatScene, {}), 128, 128).r + 30,
  )

  // Key controls scale the look's own settings, resolved inside the engine.
  const glowy = { halation: 0.7, glowRadius: 0.06 }
  const renderKeys = (keys: Partial<typeof DEFAULT_KEYS>, effects: Partial<typeof DEFAULT_EFFECTS>) =>
    readPixels(
      engine.render({
        base: topDisc,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, ...effects }, keys: { ...DEFAULT_KEYS, ...keys } },
      }),
    )
  check('glow key at 0 turns the glow off', maxDiff(renderKeys({ glow: 0 }, glowy), topPlain) === 0)
  check(
    'glow key at 50% matches half the halation',
    maxDiff(renderKeys({ glow: 0.5 }, glowy), renderKeys({}, { ...glowy, halation: 0.35 })) <= 1,
  )
  check('the look key scales every group', maxDiff(renderKeys({ look: 0 }, glowy), topPlain) === 0)
  // The Colour key works on looks with no grade: it sets how coloured the
  // look's own light is, and above 100% saturates the photo.
  const warmGlow = { ...glowy, halation: 0.9, glowColour: { source: 'manual' as const, colour: [1, 0.61, 0.38] as [number, number, number] } }
  const neutralGlow = pixel(renderKeys({ colour: 0 }, warmGlow), 128, 100)
  const colouredGlow = pixel(renderKeys({}, warmGlow), 128, 100)
  check(
    'the Colour key at 0% turns a warm glow neutral',
    colouredGlow.r > colouredGlow.b + 10 && Math.abs(neutralGlow.r - neutralGlow.b) <= 3,
    `100% rgb ${colouredGlow.r} ${colouredGlow.g} ${colouredGlow.b}, 0% rgb ${neutralGlow.r} ${neutralGlow.g} ${neutralGlow.b}`,
  )

  // Module switches: off renders as if the module's controls were at zero.
  const renderModules = (modules: Partial<typeof DEFAULT_MODULES>, effects: Partial<typeof DEFAULT_EFFECTS>) =>
    readPixels(
      engine.render({
        base: topDisc,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, ...effects }, modules: { ...DEFAULT_MODULES, ...modules } },
      }),
    )
  check('switching Light off removes the glow', maxDiff(renderModules({ light: false }, glowy), topPlain) === 0)
  check(
    'switching Tone off undoes exposure, fade and roll-off',
    maxDiff(renderModules({ tone: false }, { exposure: 1, fade: 0.1, shoulder: 0.8, vignette: 0.5 }), topPlain) === 0,
  )
  check(
    'switching a module back on restores it exactly',
    maxDiff(renderModules({ light: true }, glowy), renderKeys({}, glowy)) === 0,
  )
  const bordered = { ...DEFAULT_BLEND_PARAMS, border: { ...DEFAULT_BORDER, width: 0.1 } }
  check(
    'switching the border off gives back the photo’s own size',
    printSizeOf(discSize, bordered).width > 256 &&
      printSizeOf(discSize, { ...bordered, modules: { ...DEFAULT_MODULES, border: false } }).width === 256,
  )

  // Colours read from the photo: the glow under an orange light is orange,
  // under a blue light blue, from one setting.
  const lit = (rgb: [number, number, number]) =>
    scene((x, y) => (Math.hypot(x - 128, y - 60) < 30 ? rgb : [20, 20, 20]))
  const photoGlow = { halation: 0.9, glowRadius: 0.06, glowThreshold: 0.2, glowColour: { source: 'light' as const, colour: [1, 1, 1] as [number, number, number] } }
  const orangeGlow = pixel(renderScene(lit([255, 150, 40]), photoGlow), 128, 100)
  const blueGlow = pixel(renderScene(lit([60, 140, 255]), photoGlow), 128, 100)
  check(
    'glow can take its colour from the photo',
    orangeGlow.r > orangeGlow.b + 10 && blueGlow.b > blueGlow.r + 10,
    `under orange rgb ${orangeGlow.r} ${orangeGlow.g} ${orangeGlow.b}, under blue ${blueGlow.r} ${blueGlow.g} ${blueGlow.b}`,
  )
  const pal = paletteFromPixels(new Uint8ClampedArray([255, 140, 40, 255, 250, 150, 50, 255, 10, 10, 30, 255, 20, 20, 40, 255]))
  // Vivid is the colour that stands out, not the one that covers the most:
  // a big blue sky over a small orange horizon gives orange.
  const skyPixels: number[] = []
  for (let i = 0; i < 90; i++) skyPixels.push(70, 110, 190, 255)
  for (let i = 0; i < 10; i++) skyPixels.push(250, 120, 30, 255)
  const skyPal = paletteFromPixels(new Uint8ClampedArray(skyPixels))
  check(
    'vivid picks the standout colour, accent the widespread one',
    skyPal.vivid[0] > skyPal.vivid[2] && skyPal.accent[2] > skyPal.accent[0],
    `vivid ${skyPal.vivid.map((v) => v.toFixed(2)).join(' ')}, accent ${skyPal.accent.map((v) => v.toFixed(2)).join(' ')}`,
  )
  check('the palette reads the colour of the light', pal.light[0] === 1 && pal.light[2] < 0.3, pal.light.map((v) => v.toFixed(2)).join(' '))

  const mutedPatch = scene(() => [120, 140, 110])
  const boosted = pixel(
    readPixels(
      engine.render({
        base: mutedPatch,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, keys: { ...DEFAULT_KEYS, colour: 2 } },
      }),
    ),
    128,
    128,
  )
  const plainMuted = pixel(renderScene(mutedPatch, {}), 128, 128)
  check(
    'the Colour key above 100% saturates the photo',
    boosted.g - boosted.b > plainMuted.g - plainMuted.b + 5,
    `rgb ${plainMuted.r} ${plainMuted.g} ${plainMuted.b} -> ${boosted.r} ${boosted.g} ${boosted.b}`,
  )

  // Gradient map: every pixel takes the ramp's colour at its own brightness,
  // spread across the photo's range, and keeps that brightness.
  const toneRamp = scene((x) => [x * 0.6 + 40, x * 0.6 + 40, x * 0.6 + 40])
  const mapped = renderScene(toneRamp, {
    grade: {
      ...DEFAULT_GRADE,
      mapAmount: 1,
      mapShadow: { source: 'manual', colour: [0, 0, 1] },
      mapMid: { source: 'manual', colour: [0, 1, 0] },
      mapHigh: { source: 'manual', colour: [1, 0, 0] },
    },
  })
  const darkEnd = pixel(mapped, 12, 128)
  const brightEnd = pixel(mapped, 244, 128)
  check(
    'the gradient map spans the photo’s own range, dark to bright',
    darkEnd.b > darkEnd.r && brightEnd.r > brightEnd.b,
    `dark rgb ${darkEnd.r} ${darkEnd.g} ${darkEnd.b}, bright rgb ${brightEnd.r} ${brightEnd.g} ${brightEnd.b}`,
  )
  // The palette's Contrast and Balance. Contrast pulls the map's tones apart
  // round the middle of the photo's range; Balance slides the midtone colour,
  // so at +1 a pixel a third of the way up has moved on past green to red.
  const lumOf = (p: { r: number; g: number; b: number }) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b
  const mapWith = (patch: Partial<typeof DEFAULT_GRADE>) =>
    renderScene(toneRamp, {
      grade: {
        ...DEFAULT_GRADE,
        mapAmount: 1,
        mapShadow: { source: 'manual', colour: [0, 0, 1] },
        mapMid: { source: 'manual', colour: [0, 1, 0] },
        mapHigh: { source: 'manual', colour: [1, 0, 0] },
        ...patch,
      },
    })
  const punchy = mapWith({ mapContrast: 1 })
  const flatter = mapWith({ mapContrast: -1 })
  const mapSpread = (img: ImageData) => lumOf(pixel(img, 230, 128)) - lumOf(pixel(img, 26, 128))
  check(
    'the palette’s Contrast pulls its tones apart, or draws them together, and leaves 0 as it was',
    mapSpread(punchy) > mapSpread(mapped) + 15 && mapSpread(flatter) < mapSpread(mapped) - 15 && maxDiff(mapWith({ mapContrast: 0 }), mapped) <= 1,
    `dark-to-light spread ${mapSpread(flatter).toFixed(0)} / ${mapSpread(mapped).toFixed(0)} / ${mapSpread(punchy).toFixed(0)}`,
  )
  const towardLight = pixel(mapWith({ mapBalance: 1 }), 100, 128)
  const asMapped = pixel(mapped, 100, 128)
  check(
    'the palette’s Balance moves the midtone colour along the tones',
    towardLight.r > asMapped.r + 20 && towardLight.b < asMapped.b,
    `a third of the way up: rgb ${asMapped.r} ${asMapped.g} ${asMapped.b} -> ${towardLight.r} ${towardLight.g} ${towardLight.b}`,
  )
  // The guided wheel: the dragged colour goes exactly where it is put and the
  // others are laid out from it. Orange on the light gives Tide's blues
  // underneath; drag the same handle to blue and blue, being the darker,
  // moves to the shadows with a warm light over it. Free moves one alone.
  const hueGap = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b))
  const tideLike = guidedMove('complementary', 2, { hue: 30 / 360, sat: 0.8 })
  const blueDrag = guidedMove('complementary', 2, { hue: 230 / 360, sat: 0.8 })
  const warmTop = blueDrag.points[2].hue * 360
  const wheelPoints = [
    { hue: 0.6, sat: 0.8 },
    { hue: 0.55, sat: 0.6 },
    { hue: 0.06, sat: 0.9 },
  ] as [WheelPoint, WheelPoint, WheelPoint]
  const freed = moveOne(wheelPoints, 1, { hue: 0.2, sat: 0.5 })
  check(
    'the guided wheel lays out a palette from the dragged colour, darker hues on the shadows, and Free moves one alone',
    tideLike.index === 2 &&
      Math.abs(tideLike.points[2].hue - 30 / 360) < 1e-9 &&
      tideLike.points.slice(0, 2).every((p) => p.hue * 360 > 185 && p.hue * 360 < 240) &&
      blueDrag.index === 0 &&
      hueGap(blueDrag.points[0].hue, 230 / 360) < 1e-9 &&
      warmTop > 20 && warmTop < 75 &&
      freed[0] === wheelPoints[0] && freed[2] === wheelPoints[2] && Math.abs(freed[1].hue - 0.2) < 1e-9,
    `orange light: ${tideLike.points.map((p) => Math.round(p.hue * 360)).join('/')}; blue dragged: ${blueDrag.points.map((p) => Math.round(p.hue * 360)).join('/')} (now ${'SML'[blueDrag.index]})`,
  )
  // Colour blobs (the Colour lab's Ladder and Magnets): a warm colour placed
  // on the light tones tints the bright end of a grey ramp and leaves the dark
  // end grey, and the shader agrees with the JS used to draw the lab.
  const warmRung = { x: 0.6, y: 0.45, reach: 2, tone: 0.9, toneWidth: 0.25, strength: 1, kind: 'ladder' as const }
  const laddered = renderScene(toneRamp, { grade: { ...DEFAULT_GRADE, blobs: [warmRung] } })
  const lightEnd = pixel(laddered, 236, 128)
  const darkEnd2 = pixel(laddered, 20, 128)
  check(
    'a colour on the ladder tints its own tones and leaves the others',
    lightEnd.r - lightEnd.b > 25 && Math.abs(darkEnd2.r - darkEnd2.b) <= 3,
    `light end rgb ${lightEnd.r} ${lightEnd.g} ${lightEnd.b}, dark end ${darkEnd2.r} ${darkEnd2.g} ${darkEnd2.b}`,
  )
  // The strip under the wheel is the map as the shader works it out.
  const strip = [0.1, 0.5, 0.9].map((t) => rampColour([[0, 0, 1], [0, 1, 0], [1, 0, 0]], t, 0, 0))
  check(
    'the palette strip runs shadows, midtones, light, each at its own brightness',
    strip[0][2] > strip[0][0] && strip[1][1] > strip[1][0] && strip[1][1] > strip[1][2] && strip[2][0] > strip[2][2] &&
      Math.abs(0.2126 * strip[1][0] + 0.7152 * strip[1][1] + 0.0722 * strip[1][2] - 0.5) < 0.01,
    strip.map((c) => c.map((v) => v.toFixed(2)).join(',')).join(' | '),
  )
  const isoScene = scene((x) => (x < 128 ? [220, 110, 40] : [40, 90, 220]))
  const isolated = renderScene(isoScene, {
    grade: { ...DEFAULT_GRADE, isolateAmount: 1, isolateColour: { source: 'manual', colour: [1, 0.5, 0.15] }, isolateWidth: 0.3 },
  })
  const isoKept = pixel(isolated, 40, 128)
  const greyed = pixel(isolated, 220, 128)
  check(
    'isolate colour keeps the chosen hue and greys the rest',
    isoKept.r - isoKept.b > 100 && Math.abs(greyed.r - greyed.b) < 10,
    `kept rgb ${isoKept.r} ${isoKept.g} ${isoKept.b}, other rgb ${greyed.r} ${greyed.g} ${greyed.b}`,
  )

  // Dither: a smooth ramp becomes a few flat bands, and the band edges are
  // stippled by the grain rather than cut clean.
  const ditherPlate = makeOffsetGrain(128, 0.5, 0.09)
  const dithered = readPixels(
    engine.render({
      base: scene((x) => [x, x, x]),
      baseSize: discSize,
      grain: ditherPlate,
      grainSize: { width: 128, height: 128 },
      grainMean: 0.5,
      grainSd: 0.09,
      params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, dither: { ...DEFAULT_DITHER, amount: 1, steps: 4, spread: 1 } } },
    }),
  )
  const levelsSeen = new Set<number>()
  for (let x = 0; x < 256; x += 3) levelsSeen.add(pixel(dithered, x, 128).g)
  let mixedColumn = false
  for (let x = 0; x < 256 && !mixedColumn; x++) {
    const column = new Set<number>()
    for (let y = 0; y < 256; y += 4) column.add(pixel(dithered, x, y).g)
    if (column.size > 1) mixedColumn = true
  }
  // Following a line, the bands run across it even on a flat field, and the
  // banding stops past the line's end.
  const lined = readPixels(
    engine.render({
      base: scene(() => [128, 128, 128]),
      baseSize: discSize,
      grain: ditherPlate,
      grainSize: { width: 128, height: 128 },
      grainMean: 0.5,
      grainSd: 0.09,
      params: {
        ...DEFAULT_BLEND_PARAMS,
        amount: 0,
        effects: {
          ...DEFAULT_EFFECTS,
          dither: { ...DEFAULT_DITHER, amount: 1, steps: 4, spread: 0, follow: 1, from: { x: 0.5, y: 0 }, to: { x: 0.5, y: 0.5 } },
        },
      },
    }),
  )
  const rowValue = (y: number) => pixel(lined, 128, y).g
  check(
    'dither can band along a line set on the photo',
    rowValue(10) !== rowValue(110) && pixel(lined, 20, 10).g === pixel(lined, 230, 10).g && rowValue(220) === 128,
    `top ${rowValue(10)}, middle ${rowValue(110)}, past the end ${rowValue(220)}`,
  )
  // Oval: rings round the start handle, equal at equal distances in any
  // direction when the stretch is 1.
  const ringed = readPixels(
    engine.render({
      base: scene(() => [128, 128, 128]),
      baseSize: discSize,
      grain: ditherPlate,
      grainSize: { width: 128, height: 128 },
      grainMean: 0.5,
      grainSd: 0.09,
      params: {
        ...DEFAULT_BLEND_PARAMS,
        amount: 0,
        effects: {
          ...DEFAULT_EFFECTS,
          dither: { ...DEFAULT_DITHER, amount: 1, steps: 4, spread: 0, follow: 1, shape: 'oval', stretch: 1, from: { x: 0.5, y: 0.5 }, to: { x: 0.5, y: 0.9 } },
        },
      },
    }),
  )
  check(
    'oval dither bands ring round their centre',
    Math.abs(pixel(ringed, 128, 128 + 60).g - pixel(ringed, 128 + 60, 128).g) <= 4 &&
      Math.abs(pixel(ringed, 128 + 60, 128).g - pixel(ringed, 128 - 60, 128).g) <= 4 &&
      Math.abs(pixel(ringed, 128, 128).g - pixel(ringed, 128, 128 + 60).g) > 10,
    `centre ${pixel(ringed, 128, 128).g}, ring ${pixel(ringed, 128, 188).g} ${pixel(ringed, 188, 128).g} ${pixel(ringed, 68, 128).g}`,
  )
  // Guides steer the picture's own bands: on a smooth ramp, a Lift guide
  // moves a band edge without replacing the bands.
  const guidedRender = (guides: { x: number; y: number; radius: number; strength: number }[]) =>
    readPixels(
      engine.render({
        base: scene((x) => [x, x, x]),
        baseSize: discSize,
        grain: ditherPlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.09,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: { ...DEFAULT_EFFECTS, dither: { ...DEFAULT_DITHER, amount: 1, steps: 4, spread: 0, guides } },
        },
      }),
    )
  const unguided = guidedRender([])
  const guided = guidedRender([{ x: 0.5, y: 0.5, radius: 0.2, strength: 1 }])
  check(
    'a band guide moves the bands near it and leaves the rest',
    Math.abs(pixel(guided, 128, 128).g - pixel(unguided, 128, 128).g) > 20 &&
      Math.abs(pixel(guided, 128, 8).g - pixel(unguided, 128, 8).g) <= 2,
    `centre ${pixel(unguided, 128, 128).g} -> ${pixel(guided, 128, 128).g}, far ${pixel(unguided, 128, 8).g} -> ${pixel(guided, 128, 8).g}`,
  )
  // Bigger dither dots: every pixel in a dot shares its value.
  const chunky = readPixels(
    engine.render({
      base: scene((x) => [x, x, x]),
      baseSize: discSize,
      grain: ditherPlate,
      grainSize: { width: 128, height: 128 },
      grainMean: 0.5,
      grainSd: 0.09,
      params: {
        ...DEFAULT_BLEND_PARAMS,
        amount: 0,
        effects: { ...DEFAULT_EFFECTS, dither: { ...DEFAULT_DITHER, amount: 1, steps: 4, spread: 1, pixel: 4, pattern: 'ordered' } },
      },
    }),
  )
  // A block can still split where a band edge runs through it: allow a few.
  let split = 0
  let mixed = false
  for (let by = 0; by < 64; by++) {
    for (let bx = 0; bx < 64; bx++) {
      const v = pixel(chunky, bx * 4 + 1, by * 4 + 1).g
      if (Math.abs(pixel(chunky, bx * 4 + 2, by * 4 + 2).g - v) > 3) split++
      if (bx > 0 && Math.abs(pixel(chunky, bx * 4 - 3, by * 4 + 1).g - v) > 20) mixed = true
    }
  }
  check('dither dots can be several pixels, and still dither', split < 64 * 64 * 0.1 && mixed, `${split} of 4096 blocks split`)
  // Streaks: Fill drags the entering edge across the shape; Trail smears a
  // shape out beyond itself; both match between a crop and the export.
  const stripes = scene((_x, y) => (Math.floor(y / 16) % 2 ? [220, 60, 40] : [30, 60, 200]))
  const streakSquare = [
    { x: 0.3, y: 0.3 },
    { x: 0.7, y: 0.3 },
    { x: 0.7, y: 0.7 },
    { x: 0.3, y: 0.7 },
  ]
  const streakShape = (shape: Partial<StreakShape>): StreakShape => ({
    ...STREAK_DEFAULTS,
    outline: streakSquare,
    angle: 90,
    band: 0.01,
    seed: 1,
    mode: 'fill',
    length: 0.3,
    ...shape,
  })
  const streakRender = (
    shape: Partial<StreakShape>,
    region?: Rect,
    outputSize?: Size,
    masks: MaskShape[] = [],
    base = stripes,
  ) =>
    readPixels(
      engine.render({
        base,
        baseSize: discSize,
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        region,
        outputSize,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: {
            ...DEFAULT_EFFECTS,
            streaks: { enabled: true, amount: 1, shapes: [streakShape(shape)] },
            // Masks given here hold the streaks back.
            masks,
            maskUse: masks.length ? { streaks: { ids: masks.map((m) => m.id), mode: 'exclude' as const } } : {},
          },
        },
      }),
    )
  const cropMatches = (shape: Partial<StreakShape>, more: MaskShape[] = []) => {
    const region = { x: 60, y: 90, width: 120, height: 120 }
    const crop = streakRender(shape, region, { width: 120, height: 120 }, more)
    const full = streakRender(shape, undefined, undefined, more)
    let diff = 0
    for (let y = 0; y < 120; y++)
      for (let x = 0; x < 120; x++)
        for (let c = 0; c < 3; c++)
          diff = Math.max(diff, Math.abs(full.data[((y + 90) * 256 + x + 60) * 4 + c] - crop.data[(y * 120 + x) * 4 + c]))
    return diff
  }
  const filled = streakRender({})
  const plainStripes = renderScene(stripes, {})
  // Dragged downward, every row inside takes the colour at the top edge.
  check(
    'a fill streak drags the entering edge across the shape',
    Math.abs(pixel(filled, 128, 100).r - pixel(filled, 128, 170).r) <= 3 &&
      Math.abs(pixel(plainStripes, 128, 100).r - pixel(plainStripes, 128, 120).r) > 50 &&
      maxDiff(filled, plainStripes) > 0 &&
      Math.abs(pixel(filled, 30, 30).r - pixel(plainStripes, 30, 30).r) <= 1,
  )
  const trailed = streakRender({ mode: 'trail', length: 0.25 })
  check(
    'a trail streak smears the shape out beyond it',
    Math.abs(pixel(trailed, 128, 200).r - pixel(trailed, 128, 182).r) <= 3 &&
      Math.abs(pixel(trailed, 128, 150).r - pixel(plainStripes, 128, 150).r) <= 1,
  )
  const ragged = { lengthMin: 0.5 }
  check('a preview crop matches the export with streaks on', cropMatches(ragged) <= 1, `maxΔ=${cropMatches(ragged)}`)

  // Red above and below a blue middle band, so a shape reaching into the
  // band from above streaks red into blue whichever way up the pixels are read.
  const band = scene((_x, y) => (y >= 64 && y < 192 ? [30, 60, 200] : [220, 60, 40]))
  const tall = [
    { x: 0.3, y: 0.15 },
    { x: 0.7, y: 0.15 },
    { x: 0.7, y: 0.7 },
    { x: 0.3, y: 0.7 },
  ]
  /** Streaked (red) rows inside the blue band, per column. */
  const redRows = (img: ImageData, x: number) => {
    let n = 0
    for (let y = 64; y < 192; y++) if (pixel(img, x, y).r > 150) n++
    return n
  }
  const endSpread = (img: ImageData, x0: number, x1: number) => {
    const rows = Array.from({ length: x1 - x0 }, (_, k) => redRows(img, x0 + k))
    return Math.max(...rows) - Math.min(...rows)
  }
  // Every bar half length, grown from the edge: a level line across.
  const ends = { outline: tall, anchor: 'edge' as const, lengthMin: 0.5, lengthMax: 0.5, band: 0.1 }
  const square0 = streakRender({ ...ends }, undefined, undefined, [], band)
  const slanted = streakRender({ ...ends, tipAngle: 45 }, undefined, undefined, [], band)
  check(
    'bar ends are cut square, or at the tip angle',
    redRows(square0, 120) > 10 && endSpread(square0, 112, 144) <= 2 && endSpread(slanted, 112, 144) > 10,
    `level spread ${endSpread(square0, 112, 144)}, slanted ${endSpread(slanted, 112, 144)}`,
  )
  // Shortest/longest: bars pick lengths between them.
  const ranged = streakRender({ ...ends, lengthMin: 0.2, lengthMax: 0.9, band: 0.03 }, undefined, undefined, [], band)
  const lengths = Array.from({ length: 80 }, (_, k) => redRows(ranged, 88 + k))
  check(
    'bars take lengths between the shortest and the longest',
    Math.max(...lengths) - Math.min(...lengths) > 30 && Math.min(...lengths) > 0,
    `${Math.min(...lengths)}..${Math.max(...lengths)} rows`,
  )
  // A straight path the same way as the direction streaks the same.
  const pathed = streakRender({ path: [{ x: 0.5, y: 0.1 }, { x: 0.5, y: 0.9 }] })
  check('a straight path streaks like a plain direction', maxDiff(pathed, filled) <= 2, `maxΔ=${maxDiff(pathed, filled)}`)
  const curve = [
    { x: 0.2, y: 0.2 },
    { x: 0.5, y: 0.45 },
    { x: 0.8, y: 0.5 },
  ]
  check('a curved path streaks differently from a straight one', maxDiff(streakRender({ path: curve }), filled) > 50)

  // A mask holds the streak off what it surrounds; outside it the streak is
  // untouched. Feathered, it fades the streak back in instead of cutting.
  const maskShape = (outline: { x: number; y: number }[], patch: Partial<MaskShape> = {}): MaskShape => ({
    ...DEFAULT_MASK,
    id: `m${outline.length}-${patch.feather ?? 0}`,
    name: 'Mask',
    outline,
    ...patch,
  })
  const mask = (feather: number): MaskShape =>
    maskShape(
      [
        { x: 0.45, y: 0.4 },
        { x: 0.6, y: 0.4 },
        { x: 0.6, y: 0.6 },
        { x: 0.45, y: 0.6 },
      ],
      { feather },
    )
  const bandFilled = streakRender({ outline: tall }, undefined, undefined, [], band)
  const masked = streakRender({ outline: tall }, undefined, undefined, [mask(0)], band)
  check(
    'a mask keeps the photo in front of the streak',
    pixel(bandFilled, 135, 128).r > 200 && pixel(masked, 135, 128).r < 40 && pixel(masked, 95, 128).r > 200,
    `streak ${pixel(bandFilled, 135, 128).r}, masked ${pixel(masked, 135, 128).r}, beside ${pixel(masked, 95, 128).r}`,
  )
  const softMasked = streakRender({ outline: tall }, undefined, undefined, [mask(0.06)], band)
  const maskRamp = (img: ImageData) => {
    let n = 0
    for (let x = 80; x < 140; x++) if (pixel(img, x, 128).r > 45 && pixel(img, x, 128).r < 205) n++
    return n
  }
  check(
    'a feathered mask blends the streak back in at its edge',
    maskRamp(masked) <= 2 && maskRamp(softMasked) >= 6,
    `${maskRamp(masked)} → ${maskRamp(softMasked)} blended pixels`,
  )
  // Outlines are drawn into a texture, so a detailed one — a 40-pointed star,
  // 80 points, its spikes a few pixels apart — is followed point for point.
  const star = Array.from({ length: 80 }, (_, k) => {
    const a = (k * Math.PI) / 40
    const r = k % 2 ? 0.1 : 0.2
    return { x: 0.5 + r * Math.cos(a), y: 0.5 + r * Math.sin(a) }
  })
  const starred = streakRender({ outline: tall }, undefined, undefined, [maskShape(star)], band)
  const spike = { x: Math.round(128 + 0.13 * 256), y: 128 }
  const gap = { x: Math.round(128 + 0.16 * 256 * Math.cos(Math.PI / 40)), y: Math.round(128 + 0.16 * 256 * Math.sin(Math.PI / 40)) }
  check(
    'a detailed mask outline is followed point for point',
    pixel(starred, spike.x, spike.y).r < 60 && pixel(starred, gap.x, gap.y).r > 190 && pixel(starred, 128, 128).r < 40,
    `in a spike ${pixel(starred, spike.x, spike.y).r}, between spikes ${pixel(starred, gap.x, gap.y).r}`,
  )
  // A trail behind a thin arm of its shape — thinner along the flow than one
  // step of the look-back — must streak as one unbroken line, not dashes:
  // the look-back steps sit on a grid along the line, the same for every
  // pixel on it, so the arm is caught for all of them or none.
  const armScene = scene((_x, y) => (y >= 150 && y < 160 ? [40, 200, 60] : [128, 128, 128]))
  // Points every 0.05 along the arm keep the outline's curve on its straight edges.
  const along = (x0: number, x1: number, y: number) =>
    Array.from({ length: Math.round(Math.abs(x1 - x0) / 0.05) + 1 }, (_, k) => ({
      x: x0 + ((x1 - x0) * k) / Math.round(Math.abs(x1 - x0) / 0.05),
      y,
    }))
  const armShape = [...along(0.45, 0.8, 0.6), ...along(0.8, 0.55, 0.608), { x: 0.55, y: 0.9 }, { x: 0.45, y: 0.9 }]
  const armTrail = streakRender({ outline: armShape, mode: 'trail', angle: -90, length: 1 }, undefined, undefined, [], armScene)
  const runs = (x: number) => {
    let changes = 0
    let streaked = 0
    for (let y = 1; y < 256; y++) {
      const green = (yy: number) => pixel(armTrail, x, yy).g > 160
      if (green(y) !== green(y - 1)) changes++
      if (green(y)) streaked++
    }
    return { changes, streaked }
  }
  const armRuns = [170, 180, 190].map(runs)
  check(
    'a trail behind a thin part of its shape is unbroken, not dashed',
    armRuns.every((r) => r.streaked > 40 && r.changes <= 4),
    armRuns.map((r) => `${r.streaked} rows, ${r.changes} breaks`).join('; '),
  )
  // An angled bar end is one straight cut: the trail's length changes by a
  // pixel or so per column, all one way, with no stair-steps (the look-back
  // must reach exactly the trail's length, not stop at its last grid step).
  // A long trail from a shape low in the frame, so a grid step is several
  // pixels and rounding to it would show.
  const baseScene = scene((_x, y) => (y >= 236 && y < 254 ? [40, 200, 60] : [128, 128, 128]))
  const block = [...along(0.2, 0.8, 0.92), ...along(0.8, 0.2, 0.99)]
  const angled = streakRender(
    { outline: block, mode: 'trail', angle: -90, length: 0.85, band: 0.1, tipAngle: 40 },
    undefined,
    undefined,
    [],
    baseScene,
  )
  const greenRows = (x: number) => {
    let n = 0
    for (let y = 0; y < 256; y++) if (pixel(angled, x, y).g > 160) n++
    return n
  }
  const steps = Array.from({ length: 19 }, (_, k) => greenRows(132 + k + 1) - greenRows(132 + k))
  const rising = steps.every((d) => d >= 0 && d <= 2) || steps.every((d) => d <= 0 && d >= -2)
  check(
    'an angled bar end is one straight cut, not a staircase',
    rising && Math.abs(steps.reduce((a, b) => a + b, 0)) >= 10,
    `row changes per column: ${steps.join(' ')}`,
  )
  // A shape's sides are the straight lines between its points, as the editor
  // draws them: a smooth curve through four corners bulged past the edges.
  const upward = streakRender({ angle: -90 })
  check(
    'a streak shape stops at the straight edges drawn between its points',
    Math.abs(pixel(upward, 128, 72).r - pixel(plainStripes, 128, 72).r) <= 2 &&
      Math.abs(pixel(upward, 128, 100).r - pixel(plainStripes, 128, 100).r) > 50,
    `just past the top edge ${pixel(upward, 128, 72).r} (photo ${pixel(plainStripes, 128, 72).r})`,
  )
  // A bar ends level even where the edge it grew from zigzags: its length is
  // measured from where its centre line crossed the edge, not each line's own
  // crossing, which copied every wiggle of the outline into the bar's end.
  const zigScene = scene((_x, y) => (y >= 170 ? [40, 200, 60] : [128, 128, 128]))
  const zigzag = [
    { x: 0.2, y: 0.3 },
    { x: 0.8, y: 0.3 },
    ...Array.from({ length: 31 }, (_, k) => ({ x: 0.8 - k * 0.02, y: 0.7 + (k % 2 ? 0.03 : -0.03) })),
  ]
  const zigFill = streakRender(
    { outline: zigzag, angle: -90, anchor: 'edge', lengthMin: 0.5, lengthMax: 0.5, band: 0.1 },
    undefined,
    undefined,
    [],
    zigScene,
  )
  const zigRows = Array.from({ length: 19 }, (_, k) => {
    let n = 0
    for (let y = 0; y < 256; y++) if (pixel(zigFill, 106 + k, y).g > 160) n++
    return n
  })
  check(
    'a bar ends level even where the edge it grew from zigzags',
    Math.max(...zigRows) - Math.min(...zigRows) <= 1 && Math.min(...zigRows) > 100,
    `streak rows across one bar: ${Math.min(...zigRows)}..${Math.max(...zigRows)}`,
  )
  // Fill's settings. The square spans rows 77..179; streaks run upward from
  // its bottom edge, which sits in a green band, so a streak shows as green.
  const fillScene = scene((_x, y) => (y >= 170 ? [40, 200, 60] : y >= 118 && y < 140 ? [220, 40, 40] : [128, 128, 128]))
  const fillTest = (shape: Partial<StreakShape>) => streakRender({ angle: -90, ...shape }, undefined, undefined, [], fillScene)
  const green = (img: ImageData, y: number) => pixel(img, 128, y).g > 160 && pixel(img, 128, y).r < 100
  const clippedRun = fillTest({ clip: true, measure: 'distance', length: 0.6 })
  const runsOn = fillTest({ clip: false, measure: 'distance', length: 0.6 })
  check(
    'a clipped fill stops at its outline; unclipped, it runs on for its length',
    green(clippedRun, 90) && !green(clippedRun, 50) && green(runsOn, 50) && !green(runsOn, 12),
    `clipped at rows 90, 50: ${green(clippedRun, 90)} ${green(clippedRun, 50)}; unclipped at 50, 12: ${green(runsOn, 50)} ${green(runsOn, 12)}`,
  )
  const acrossFull = fillTest({ measure: 'across', lengthMin: 1, lengthMax: 1 })
  const acrossHalf = fillTest({ measure: 'across', lengthMin: 0.5, lengthMax: 0.5 })
  check(
    'measured across the shape, 100% reaches the far edge and 50% half way',
    green(acrossFull, 82) && green(acrossHalf, 150) && !green(acrossHalf, 100),
  )
  const hung = fillTest({ measure: 'across', lengthMin: 0.5, lengthMax: 0.5, anchor: 'far' })
  const red = (img: ImageData, y: number) => pixel(img, 128, y).r > 180 && pixel(img, 128, y).g < 100
  check(
    'bars hung from the far edge reach half way down, coloured where they start',
    red(hung, 85) && red(hung, 110) && !red(hung, 150) && !green(hung, 100),
  )
  // Feather position and edge. The square's bottom edge (row 179), where the
  // colour comes from, is the bottom of a red stripe; everything else is
  // grey, so the streak shows red and the photo grey.
  const edgeScene = scene((_x, y) => (y >= 170 && y < 180 ? [220, 40, 40] : [128, 128, 128]))
  const soft = (shape: Partial<StreakShape>) =>
    streakRender({ angle: -90, feather: 0.08, ...shape }, undefined, undefined, [], edgeScene)
  const redness = (img: ImageData, y: number) => pixel(img, 128, y).r - pixel(img, 128, y).g
  const insideSoft = soft({ featherAt: 'inside' })
  const outsideSoft = soft({ featherAt: 'outside' })
  check(
    'feathered inside, the streak eases in above its edge; outside, it is solid to the edge and fades past it',
    redness(insideSoft, 167) < 170 && redness(outsideSoft, 167) > 175 && redness(insideSoft, 185) < 5 && redness(outsideSoft, 185) > 20,
    `12px in: ${redness(insideSoft, 167)} vs ${redness(outsideSoft, 167)}; 6px out: ${redness(insideSoft, 185)} vs ${redness(outsideSoft, 185)}`,
  )
  // Grain edges: every pixel is wholly streak or wholly photo.
  const mixedIn = (img: ImageData) => {
    let n = 0
    for (let y = 150; y < 200; y++)
      for (let x = 100; x < 156; x++) {
        const r = pixel(img, x, y).r - pixel(img, x, y).g
        if (r > 12 && r < 168) n++
      }
    return n
  }
  const grainSoft = soft({ featherAt: 'outside', featherEdge: 'grain' })
  check(
    'a grain edge dissolves the streak into the photo with no in-between colours',
    mixedIn(outsideSoft) > 50 && mixedIn(grainSoft) < 15 && redness(grainSoft, 150) > 170,
    `${mixedIn(outsideSoft)} mixed pixels smooth, ${mixedIn(grainSoft)} grain`,
  )
  // Soft ends fade where each bar stops; the outline's feather does not.
  const plainFill = renderScene(fillScene, {})
  const maxDiffAt = (a: ImageData, b: ImageData, x: number, y: number) =>
    Math.max(...(['r', 'g', 'b'] as const).map((c) => Math.abs(pixel(a, x, y)[c] - pixel(b, x, y)[c])))
  const fadingRows = (img: ImageData) => {
    let n = 0
    for (let y = 90; y < 170; y++) {
      const p = pixel(img, 128, y)
      const photo = pixel(plainFill, 128, y)
      const isStreak = p.g > 190 && p.r < 70
      const isPhoto = Math.abs(p.r - photo.r) < 6 && Math.abs(p.g - photo.g) < 6
      if (!isStreak && !isPhoto) n++
    }
    return n
  }
  const halfBars = { measure: 'across' as const, lengthMin: 0.5, lengthMax: 0.5 }
  const softEnds = fillTest({ ...halfBars, endSoftness: 0.08 })
  const featherOnly = fillTest({ ...halfBars, feather: 0.05, endSoftness: 0 })
  check(
    'soft ends fade where each bar stops; the outline feather leaves the ends hard',
    fadingRows(softEnds) > 6 && fadingRows(featherOnly) <= 2,
    `${fadingRows(softEnds)} rows fading with soft ends, ${fadingRows(featherOnly)} with the feather alone`,
  )
  // Colours from under a mask. The entering edge (row 179) is dark on the
  // left, under a mask keyed to dark that holds the streaks back, and yellow
  // on the right. Skipping masked colours, the left bars borrow the yellow.
  const treeScene = scene((x, y) => (y >= 170 ? (x < 128 ? [20, 20, 24] : [210, 190, 60]) : [128, 128, 128]))
  const treeMask = maskShape(
    [
      { x: 0.2, y: 0.62 },
      { x: 0.52, y: 0.62 },
      { x: 0.52, y: 0.78 },
      { x: 0.2, y: 0.78 },
    ],
    { key: 'darker', keyLevel: 0.24, keySoftness: 0.05 },
  )
  const treeTest = (skipMasked: boolean) =>
    streakRender({ angle: -90, band: 0.03, skipMasked }, undefined, undefined, [treeMask], treeScene)
  const skipped = treeTest(true)
  const unskipped = treeTest(false)
  let darkBars = 0
  for (let x = 80; x < 120; x += 3) if (pixel(skipped, x, 120).r < 90) darkBars++
  check(
    'skipping masked colours, bars whose colour is under a mask take a clear bar\'s instead',
    pixel(unskipped, 100, 120).r < 60 && darkBars === 0 && pixel(skipped, 150, 120).r > 180,
    `off ${pixel(unskipped, 100, 120).r}, on: ${darkBars} dark columns of 14`,
  )
  check('a preview crop matches the export when masked colours are skipped', cropMatches({ angle: -90, band: 0.03 }, [treeMask]) <= 1)
  // Perspective: the lines run through a vanishing point. Here it is one
  // short side above the shape's middle, the flow going up toward it: a
  // pixel near the top takes the colour where its line, slanting out from
  // the point, crossed the bottom edge — further out than straight below.
  {
    const ramp = scene((x) => [x, 128, 60])
    const box = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.3 }, { x: 0.8, y: 0.75 }, { x: 0.2, y: 0.75 }]
    const look = (converge: number) => streakRender({ outline: box, angle: -90, converge, lengthMin: 1, lengthMax: 1, measure: 'across' }, undefined, undefined, [], ramp)
    const straight = look(0)
    const inPerspective = look(1)
    // The point: (128, 134 - 256) px; the line through (148, 90) meets the bottom (y 192) at x 157.6.
    const want = 128 + (20 * (192 + 122)) / (90 + 122)
    const got = pixel(inPerspective, 148, 90).r
    check(
      'a streak in perspective takes its colour along lines through the vanishing point',
      Math.abs(got - want) <= 4 && Math.abs(pixel(straight, 148, 90).r - 148) <= 3,
      `at 148,90: ${got} (want ${want.toFixed(1)}), straight ${pixel(straight, 148, 90).r}`,
    )
    const v = streakVanish(box.map((p) => ({ x: p.x, y: p.y })), { x: 0, y: -1 }, 1)!
    let worst = 0
    for (const q of [{ x: 0.3, y: 0.4 }, { x: 0.71, y: 0.62 }, { x: 0.5, y: 0.2 }]) {
      const st = streakCoordsJs(q, { x: 0, y: -1 }, null, v)
      const back = streakPosJs(st.s, st.t, { x: 0, y: -1 }, null, v)
      worst = Math.max(worst, Math.hypot(back.x - q.x, back.y - q.y))
    }
    const spread = streakVanish(box, { x: 0, y: -1 }, -1)!
    check(
      'perspective coordinates go there and back, ahead when closing and behind when spreading',
      worst < 1e-9 && Math.abs(v.y - (0.525 - 1)) < 1e-9 && Math.abs(spread.y - (0.525 + 1)) < 1e-9,
      `round trip ${worst.toExponential(1)}; point ${v.y.toFixed(3)} / ${spread.y.toFixed(3)}`,
    )
    check('a preview crop matches the export in perspective', cropMatches({ outline: box, angle: -90, converge: 1 }) <= 1)
    // Trees against a hazy sky as bright as they are: a key on brightness
    // keeps the sky between them in front too, and it shows through the
    // streak; a key on blue keeps only the trees.
    {
      const forest = scene((x, y) => (y < 128 ? [220, 220, 230] : x % 20 < 10 ? [85, 110, 30] : [95, 110, 130]))
      const ground = [{ x: -0.1, y: 0.5 }, { x: 1.1, y: 0.5 }, { x: 1.1, y: 1.1 }, { x: -0.1, y: 1.1 }]
      const down = (patch: Partial<MaskShape>) =>
        streakRender(
          { outline: [{ x: 0.0, y: 0.45 }, { x: 1.0, y: 0.45 }, { x: 1.0, y: 0.95 }, { x: 0.0, y: 0.95 }], angle: 90, lengthMin: 1, lengthMax: 1, measure: 'across', skipMasked: false },
          undefined,
          undefined,
          [maskShape(ground, { key: 'darker', keySoftness: 0.03, ...patch })],
          forest,
        )
      const byBlue = down({ keyOn: 'blue', keyLevel: 0.3 })
      const byBrightness = down({ keyOn: 'brightness', keyLevel: 0.45 })
      check(
        'a mask keyed on blue keeps trees in front and lets a sky as bright as them be streaked',
        pixel(byBlue, 4, 180).b < 50 && pixel(byBlue, 14, 180).r > 200 && pixel(byBrightness, 14, 180).r < 110,
        `tree ${pixel(byBlue, 4, 180).b} blue; sky between: by blue ${pixel(byBlue, 14, 180).r}, by brightness ${pixel(byBrightness, 14, 180).r}`,
      )
    }
    // A tree's soft edge against blue sky, a red streak over both, the tree
    // kept in front by a blue key: an edge pixel mostly tree is kept, and
    // its share of sky came with it, a pale blue ring. Cleaned, that share
    // takes the streak's red; the tree itself is untouched.
    {
      const lin = (c: number) => ((c / 255) <= 0.04045 ? c / 255 / 12.92 : ((c / 255 + 0.055) / 1.055) ** 2.4)
      const enc = (v: number) => Math.round(255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055))
      const tree = [40, 90, 30]
      const sky = [120, 160, 230]
      // Mostly tree up to x 120, over to sky by x 136, mixed in linear light as a lens does.
      const edged = scene((x, y) => {
        if (y < 128) return [220, 40, 40]
        const a = Math.min(1, Math.max(0, (136 - x) / 16))
        return [0, 1, 2].map((k) => enc(a * lin(tree[k]) + (1 - a) * lin(sky[k]))) as [number, number, number]
      })
      const keyed = (cleanEdges: number) =>
        streakRender(
          { outline: [{ x: 0.0, y: 0.45 }, { x: 1.0, y: 0.45 }, { x: 1.0, y: 0.95 }, { x: 0.0, y: 0.95 }], angle: 90, lengthMin: 1, lengthMax: 1, measure: 'across', skipMasked: false },
          undefined,
          undefined,
          [maskShape([{ x: -0.1, y: 0.5 }, { x: 1.1, y: 0.5 }, { x: 1.1, y: 1.1 }, { x: -0.1, y: 1.1 }], { key: 'darker', keyOn: 'blue', keyLevel: 0.6, keySoftness: 0.02, cleanEdges })],
          edged,
        )
      const raw = keyed(0)
      const clean = keyed(1)
      // x 124: three quarters tree, kept by the key.
      const ringRaw = pixel(raw, 124, 190)
      const ringClean = pixel(clean, 124, 190)
      const treeRaw = pixel(raw, 60, 190)
      const treeClean = pixel(clean, 60, 190)
      check(
        "a keyed mask's Clean edges turns the sky in its edge pixels into the streak and leaves the subject",
        ringRaw.b - ringClean.b > 30 && ringClean.r - ringRaw.r > 30 &&
          Math.abs(treeRaw.r - treeClean.r) + Math.abs(treeRaw.g - treeClean.g) + Math.abs(treeRaw.b - treeClean.b) <= 3 &&
          pixel(clean, 200, 190).r > 200,
        `edge rgb ${ringRaw.r} ${ringRaw.g} ${ringRaw.b} → ${ringClean.r} ${ringClean.g} ${ringClean.b}; tree ${treeRaw.r} ${treeRaw.g} ${treeRaw.b} → ${treeClean.r} ${treeClean.g} ${treeClean.b}; sky ${pixel(clean, 200, 190).r}`,
      )
    }
    // Colour lines: a fill over an edge whose every pixel is its own colour
    // (red is the column) is a line a pixel wide each; grouped into stripes of 6..10 px, each
    // runs that wide in one colour; with half texture each keeps the edge's
    // lines across it, half as many, so each twice as wide.
    {
      const fine = scene((x) => [x, 128, 60])
      const runsAt = (stripeMin: number, stripeMax: number, stripeTexture = 0) => {
        const out = streakRender({ outline: box, angle: -90, lengthMin: 1, lengthMax: 1, measure: 'across', stripeMin, stripeMax, stripeTexture }, undefined, undefined, [], fine)
        const runs: number[] = []
        let run = 1
        for (let x = 61; x < 196; x++) {
          if (pixel(out, x, 130).r !== pixel(out, x - 1, 130).r) {
            runs.push(run)
            run = 1
          } else run++
        }
        return runs.slice(1)
      }
      const own = runsAt(0, 0)
      const grouped = runsAt(6 / 256, 10 / 256)
      check(
        'colour lines group a fine edge into stripes between the thinnest and thickest, each one colour',
        Math.max(...own) <= 1 && grouped.length > 10 && Math.min(...grouped) >= 5 && Math.max(...grouped) <= 11,
        `own lines ${Math.min(...own)}..${Math.max(...own)} px; stripes ${grouped.length}, ${Math.min(...grouped)}..${Math.max(...grouped)} px`,
      )
      const textured = runsAt(6 / 256, 10 / 256, 0.5)
      check(
        'colour lines with texture keep the fine lines inside each stripe, wider',
        textured.length > 2.5 * grouped.length && textured.length < 0.75 * own.length && Math.max(...textured) <= 4,
        `lines ${textured.length} (flat stripes ${grouped.length}, own ${own.length}), ${Math.min(...textured)}..${Math.max(...textured)} px`,
      )
    }
    // The streak cache: a look edit after a render reuses the search, and
    // must come out as it would searched afresh; a streak edit searches again.
    {
      const shape = streakShape({ outline: box, angle: -90, lengthMin: 0.4, lengthMax: 1, measure: 'across' })
      const at = (exposure: number, s: StreakShape = shape) =>
        readPixels(
          engine.render({
            base: stripes,
            baseSize: discSize,
            grain: neutralPlate,
            grainSize: { width: 8, height: 8 },
            grainMean: 0.5,
            grainSd: 0.0001,
            params: {
              ...DEFAULT_BLEND_PARAMS,
              amount: 0,
              effects: { ...DEFAULT_EFFECTS, exposure, streaks: { enabled: true, amount: 1, shapes: [s] } },
            },
          }),
        )
      at(0)
      const reused = at(0.6)
      at(0.6, { ...shape, angle: -80 })
      const afresh = at(0.6)
      const moved = at(0.6, { ...shape, angle: -80 })
      let diff = 0
      let changed = 0
      for (let i = 0; i < reused.data.length; i += 4)
        for (let c = 0; c < 3; c++) {
          diff = Math.max(diff, Math.abs(reused.data[i + c] - afresh.data[i + c]))
          if (c === 0 && Math.abs(moved.data[i] - afresh.data[i]) > 20) changed++
        }
      check(
        'a look edit reuses the streak search and matches it searched afresh; a streak edit searches again',
        diff === 0 && changed > 500,
        `max diff ${diff}; ${changed} pixels changed by the streak edit`,
      )
    }
    // A loose shape over a clear dark line (a building's edge), with a loose
    // dark-keyed mask round the line: the line stays in front, no bar drags
    // its dark up the perspective lines, and the rest is as without a mask.
    const lined = scene((x, y) => (Math.abs(x - 150) <= 1 && y > 40 && y < 210 ? [10, 10, 10] : [x, 128, 60]))
    const lineMask = maskShape(
      [{ x: 0.5, y: 0.1 }, { x: 0.66, y: 0.1 }, { x: 0.66, y: 0.85 }, { x: 0.5, y: 0.85 }],
      { key: 'darker', keyLevel: 0.24, keySoftness: 0.05 },
    )
    const masked = (skipMasked: boolean) =>
      streakRender({ outline: box, angle: -90, converge: 1, lengthMin: 1, lengthMax: 1, measure: 'across', skipMasked }, undefined, undefined, [lineMask], lined)
    const kept = masked(true)
    const dragged = masked(false)
    // The bar whose line meets the bottom edge on the line: x 128 + 22 * 222 / 314 at y 100.
    const onRay = Math.round(128 + (22 * 222) / 314)
    check(
      'in perspective, a dark-keyed mask keeps a line in front and its dark out of the bars',
      pixel(kept, 150, 100).r < 40 && pixel(dragged, onRay, 100).r < 60 && pixel(kept, onRay, 100).r > 100 &&
        Math.abs(pixel(kept, 180, 100).r - pixel(inPerspective, 180, 100).r) <= 3,
      `line ${pixel(kept, 150, 100).r}; bar from it ${pixel(dragged, onRay, 100).r} -> ${pixel(kept, onRay, 100).r} skipping; elsewhere ${pixel(kept, 180, 100).r} vs ${pixel(inPerspective, 180, 100).r}`,
    )
    // Converging, the lines spread apart going back to their colour: a
    // pixel near the point covers several of the source's pixels across the
    // flow. Fine stripes there are averaged, not aliased into hairlines.
    const striped = scene((x, y) => (y >= 186 ? (x % 2 ? [255, 255, 255] : [0, 0, 0]) : [128, 128, 128]))
    const fan = streakRender({ outline: box, angle: -90, converge: 2, lengthMin: 1, lengthMax: 1, measure: 'across', band: 0.004 }, undefined, undefined, [], striped)
    let lo = 255
    let hi = 0
    for (let x = 118; x < 138; x++) {
      lo = Math.min(lo, pixel(fan, x, 70).r)
      hi = Math.max(hi, pixel(fan, x, 70).r)
    }
    check('in perspective, a spread-out source is averaged, not aliased into stripes', hi - lo < 90, `row near the point ${lo}..${hi}`)
    // A trail off a flat roof toward the point: its bars shorten as their
    // lines close in, so their ends make the roof again, smaller toward the
    // point — the building carried on up — not the roof slid along each line.
    // The point is at (128, 57.6) px, the roof at y 128; ends at y 99.8 all along.
    {
      const roofed = scene((_x, y) => (y < 128 ? [255, 255, 255] : [40, 40, 40]))
      const tower = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.8, y: 0.95 }, { x: 0.2, y: 0.95 }]
      const up = streakRender({ outline: tower, angle: -90, converge: 2, mode: 'trail', length: 0.2, lengthMin: 1, lengthMax: 1, band: 0.01 }, undefined, undefined, [], roofed)
      const endAlong = (x0: number) => {
        // Up the line through (x0, 128) from the point, to where the trail stops.
        for (let y = 126; y > 60; y--) {
          const x = Math.round(128 + ((x0 - 128) * (y - 57.6)) / 70.4)
          if (pixel(up, x, y).r > 150) return y
        }
        return -1
      }
      const ends = [128, 90, 60].map(endAlong)
      check(
        'in perspective, a trail ends in its edge drawn smaller toward the point',
        ends.every((y) => Math.abs(y - 99.8) <= 3),
        `ends at y ${ends.join(', ')} (want 99.8)`,
      )
    }
    // A trail with an end line drawn across it: each bar runs to the line,
    // or its share of the way there. Here the line slants from y 76.8 at the
    // left of the tower to 25.6 at the right.
    {
      const roofed = scene((_x, y) => (y < 128 ? [255, 255, 255] : [40, 40, 40]))
      const tower = [{ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, { x: 0.8, y: 0.95 }, { x: 0.2, y: 0.95 }]
      const ends = [{ x: 0.2, y: 0.3 }, { x: 0.8, y: 0.1 }]
      const trail = (lengthMax: number) =>
        streakRender({ outline: tower, angle: -90, mode: 'trail', ends, lengthMin: lengthMax, lengthMax, band: 0.01 }, undefined, undefined, [], roofed)
      const endAt = (img: ImageData, x: number) => {
        for (let y = 126; y > 4; y--) if (pixel(img, x, y).r > 150) return y
        return -1
      }
      const lineAt = (x: number) => (0.3 - (0.2 * (x / 256 - 0.2)) / 0.6) * 256
      const full = trail(1)
      const half = trail(0.5)
      const got = [64, 180].map((x) => endAt(full, x))
      const want = [64, 180].map(lineAt)
      const halfway = endAt(half, 64)
      check(
        'a trail with an end line runs each bar to it, or its share of the way there',
        got.every((y, k) => Math.abs(y - want[k]) <= 3) && Math.abs(halfway - (128 + want[0]) / 2) <= 3,
        `ends at y ${got.join(', ')} (want ${want.map((v) => v.toFixed(1)).join(', ')}); at half, ${halfway} (want ${((128 + want[0]) / 2).toFixed(1)})`,
      )
    }
  }
  // The look's glow is made from the photo as streaked: a bright sky a trail
  // covers does not glow onto the building below it, and the trail does not
  // carry the glow of what it hides. Streaked, it should glow as a photo
  // whose sky there really were the trail's colour.
  {
    const sky = (dark: boolean) => scene((x, y) => (y < 128 ? (dark && x >= 26 && x < 230 ? [40, 40, 40] : [255, 255, 255]) : [40, 40, 40]))
    const building = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }, { x: 0.9, y: 0.95 }, { x: 0.1, y: 0.95 }]
    const glowing = (base: ImageData, streaked: boolean) =>
      readPixels(
        engine.render({
          base, baseSize: discSize, grain: neutralPlate, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
          params: {
            ...DEFAULT_BLEND_PARAMS,
            amount: 0,
            effects: {
              ...DEFAULT_EFFECTS,
              bloom: 1,
              halation: 1,
              glowThreshold: 0.5,
              streaks: {
                enabled: streaked,
                amount: 1,
                shapes: streaked ? [streakShape({ outline: building, angle: -90, mode: 'trail', length: 0.8, lengthMin: 1, lengthMax: 1 })] : [],
              },
            },
          },
        }),
      )
    const streaked = glowing(sky(false), true)
    const covered = glowing(sky(true), false)
    const bare = glowing(sky(false), false)
    const at = (img: ImageData, x: number, y: number) => pixel(img, x, y).r
    check(
      'a bright sky a streak covers does not glow through it onto the building',
      at(bare, 128, 136) > at(covered, 128, 136) + 15 && Math.abs(at(streaked, 128, 136) - at(covered, 128, 136)) <= 4 &&
        // In the trail: within a level or two (the open sky past the bars' ends still glows a little).
        Math.abs(at(streaked, 128, 60) - at(covered, 128, 60)) <= 6 &&
        // Beside the sky left uncovered, the glow is as it would be: the
        // streaked photo the passes blur is the right way up.
        at(covered, 14, 136) > at(covered, 128, 136) + 10 && Math.abs(at(streaked, 14, 136) - at(covered, 14, 136)) <= 4,
      `below the edge: bare ${at(bare, 128, 136)}, streaked ${at(streaked, 128, 136)}, as if covered ${at(covered, 128, 136)}; in the trail ${at(streaked, 128, 60)} vs ${at(covered, 128, 60)}; by the open sky ${at(streaked, 14, 136)} vs ${at(covered, 14, 136)}`,
    )
  }
  // Colour fixes. A wide shape whose entering edge is a gradient, with a
  // magenta strip in the middle: a fix over the strip borrows from beside it.
  const wide = [
    { x: 0.05, y: 0.3 },
    { x: 0.95, y: 0.3 },
    { x: 0.95, y: 0.7 },
    { x: 0.05, y: 0.7 },
  ]
  const fixScene = scene((x, y) => (y >= 170 ? (x >= 103 && x < 158 ? [255, 0, 255] : [x, 255 - x, 110]) : [128, 128, 128]))
  const fixSpan = { a: { x: 0.38, y: 0.5 }, b: { x: 0.62, y: 0.5 } }
  const fixed = (fix: Partial<StreakFix>) =>
    streakRender(
      { outline: wide, angle: -90, band: 0.03, fixes: [{ ...SPAN_FIX, ...fixSpan, seed: 5, ...fix }] },
      undefined,
      undefined,
      [],
      fixScene,
    )
  const magentaIn = (img: ImageData) => {
    let n = 0
    for (let y = 90; y < 160; y += 4) for (let x = 100; x < 156; x++) if (pixel(img, x, y).g < 60 && pixel(img, x, y).r > 200 && pixel(img, x, y).b > 200) n++
    return n
  }
  // Each bar's colour in the span: the middle of each bar, down its length.
  const barColours = (img: ImageData) => {
    const out: number[][] = []
    const bandPx = 0.03 * 256
    for (let k = Math.ceil(0.38 / 0.03 - 0.5); k <= Math.floor(0.62 / 0.03 - 0.5); k++) {
      const x = Math.round((k + 0.5) * bandPx)
      let r = 0
      let g = 0
      for (let y = 100; y < 160; y++) {
        r += pixel(img, x, y).r
        g += pixel(img, x, y).g
      }
      out.push([r / 60, g / 60])
    }
    return out
  }
  const unfixed = streakRender({ outline: wide, angle: -90, band: 0.03 }, undefined, undefined, [], fixScene)
  const borrowed = fixed({ mode: 'borrow' })
  // The stretch takes the lines beside it, mirrored in across its sides: no
  // magenta left, and just inside each side the line just outside it, so
  // there is no seam. (The span runs x 97..159 on the 256 px scene.)
  const columnRed = (img: ImageData, x: number) => {
    let r = 0
    for (let y = 100; y < 160; y++) r += pixel(img, x, y).r
    return r / 60
  }
  const seams = [Math.abs(columnRed(borrowed, 99) - columnRed(borrowed, 95)), Math.abs(columnRed(borrowed, 157) - columnRed(borrowed, 161))]
  check(
    'a colour fix takes the colours beside it, mirrored in, with no seam at its sides',
    magentaIn(unfixed) > 500 && magentaIn(borrowed) === 0 && seams.every((d) => d < 12),
    `magenta ${magentaIn(unfixed)} -> ${magentaIn(borrowed)}; across its sides ${seams.map(Math.round).join(', ')}`,
  )
  // A fix keeping the colours changes only its bars' tone: darkening, only
  // the span darkens; at no opacity, the photo shows through it.
  {
    const keepFix = (fix: Partial<StreakFix>) => fixed({ mode: 'keep', ...fix })
    const kept = keepFix({})
    let same = 0
    for (let i = 0; i < kept.data.length; i++) same = Math.max(same, Math.abs(kept.data[i] - unfixed.data[i]))
    check('a fix that keeps the colours and the tone changes nothing', same <= 1, `max difference ${same}`)
    const darker = keepFix({ brightness: -1 })
    const lum = (img: ImageData, x: number, y: number) => pixel(img, x, y).r + pixel(img, x, y).g + pixel(img, x, y).b
    check(
      'a fix darkens its bars and no others',
      lum(darker, 128, 120) < lum(unfixed, 128, 120) * 0.8 && lum(darker, 50, 120) === lum(unfixed, 50, 120) && lum(darker, 210, 120) === lum(unfixed, 210, 120),
      `in the span ${lum(unfixed, 128, 120)} -> ${lum(darker, 128, 120)}, beside it ${lum(unfixed, 50, 120)} -> ${lum(darker, 50, 120)}`,
    )
    check('a fix keeping the colours keeps them', magentaIn(kept) > 500, `magenta ${magentaIn(kept)}`)
    const faded = keepFix({ opacity: 0 })
    const photo = pixel(fixScene, 128, 120)
    check(
      'a fix at no opacity shows the photo across its bars',
      Math.abs(pixel(faded, 128, 120).r - photo.r) <= 2 && Math.abs(pixel(faded, 128, 120).g - photo.g) <= 2,
      `${pixel(faded, 128, 120).r},${pixel(faded, 128, 120).g} vs photo ${photo.r},${photo.g}`,
    )
    // Feathered, the darkening eases in across the span's sides: halfway at
    // the side, none a feather's half out, all of it a feather's half in.
    const soft = keepFix({ brightness: -1, feather: 0.06 })
    const at = (x: number) => [lum(unfixed, x, 120), lum(soft, x, 120), lum(darker, x, 120)]
    const [u0, s0] = at(86)
    const [u1, s1, d1] = at(100)
    const [, s2, d2] = at(112)
    check(
      'a feathered fix eases its tone in across its sides',
      s0 === u0 && s1 < u1 - 10 && s1 > d1 + 10 && Math.abs(s2 - d2) <= 2,
      `outside ${u0} -> ${s0}; at the side ${u1} -> ${s1} (hard ${d1}); inside ${s2} (hard ${d2})`,
    )
    const softCopy = fixed({ mode: 'borrow', feather: 0.06 })
    let left = 0
    for (let y = 90; y < 160; y += 4) for (let x = 114; x < 150; x++) if (pixel(softCopy, x, y).g < 60 && pixel(softCopy, x, y).r > 200 && pixel(softCopy, x, y).b > 200) left++
    check('a feathered fix still copies all of its bars well inside', left === 0, `${left} magenta pixels left`)
    const both = fixed({ mode: 'borrow', brightness: -1 })
    check(
      'a fix can copy colours and darken them at once',
      magentaIn(both) === 0 && lum(both, 128, 120) < lum(borrowed, 128, 120) * 0.8,
      `magenta ${magentaIn(both)}; ${lum(both, 128, 120)} vs ${lum(borrowed, 128, 120)} copied alone`,
    )
  }
  const oneSide = barColours(fixed({ mode: 'borrow', side: 'before', variation: 0 }))
  check(
    'a fix borrowing from one side takes only that side\'s colours',
    // Before the span (left here) the gradient is red-poor: r < 96.
    oneSide.every((c) => c[0] < 100),
    oneSide.map((c) => Math.round(c[0])).join(' '),
  )
  // Recoloured, a stretch keeps its own light and dark in the chosen
  // colours: every pixel between red and blue, and not flat. Over the
  // gradient here (x 26..77), so there is light and dark to keep.
  const painted = streakRender(
    { outline: wide, angle: -90, band: 0.03, fixes: [{ ...SPAN_FIX, a: { x: 0.1, y: 0.5 }, b: { x: 0.3, y: 0.5 }, seed: 5, mode: 'colours', colours: [[1, 0, 0], [0, 0, 1]], variation: 0 }] },
    undefined,
    undefined,
    [],
    fixScene,
  )
  let offPalette = 0
  const shades = new Set<number>()
  for (let x = 30; x < 74; x++) {
    const p = pixel(painted, x, 120)
    if (p.g > 12 || Math.abs(p.r + p.b - 255) > 40) offPalette++
    shades.add(Math.round(p.r / 8))
  }
  check(
    'a fix with your colours recolours its own light and dark, not one flat colour',
    offPalette === 0 && shades.size >= 8,
    `${offPalette} off the colours, ${shades.size} shades along a row`,
  )
  // A chosen part of the streak sets the colours: from x 26..77 here, where
  // the gradient's red is low.
  const chosen = barColours(fixed({ mode: 'borrow', source: { a: { x: 0.1, y: 0.5 }, b: { x: 0.3, y: 0.5 } }, variation: 0 }))
  check(
    'a fix takes its colours from the part of the streak you choose',
    chosen.every((c) => c[0] > 15 && c[0] < 90),
    chosen.map((c) => Math.round(c[0])).join(' '),
  )
  // How often the colours change comes with them: stripes every 3 lines on
  // the left of the edge, smooth on the right; a fix from each.
  const changeScene = scene((x, y) => (y >= 170 ? (x < 96 ? (Math.floor(x / 3) % 2 ? [230, 230, 230] : [30, 30, 30]) : [80 + (x - 96) * 0.5, 120, 160]) : [128, 128, 128]))
  const changes = (source: StreakFix['source']) => {
    const img = streakRender(
      { outline: wide, angle: -90, band: 0.03, fixes: [{ ...SPAN_FIX, a: { x: 0.45, y: 0.5 }, b: { x: 0.75, y: 0.5 }, source, seed: 3 }] },
      undefined,
      undefined,
      [],
      changeScene,
    )
    let n = 0
    for (let x = 118; x < 190; x++) if (Math.abs(pixel(img, x, 120).r - pixel(img, x - 1, 120).r) > 60) n++
    return n
  }
  const busy = changes({ a: { x: 0.08, y: 0.5 }, b: { x: 0.34, y: 0.5 } })
  const calm = changes({ a: { x: 0.4, y: 0.5 }, b: { x: 0.62, y: 0.5 } })
  check(
    'a fix keeps how often its source\'s colours change',
    busy >= 14 && calm <= 4,
    `${busy} changes from the striped part, ${calm} from the smooth part, over 72 px`,
  )
  // Each fix says whether its source's masked colours count: a dark block
  // under a dark-keyed mask in the middle of the source.
  const maskedScene = scene((x, y) => (y >= 170 ? (x >= 40 && x < 70 ? [15, 15, 15] : [200, 170, 90]) : [128, 128, 128]))
  const blockMask = maskShape(
    [
      { x: 0.14, y: 0.6 },
      { x: 0.29, y: 0.6 },
      { x: 0.29, y: 0.8 },
      { x: 0.14, y: 0.8 },
    ],
    { key: 'darker', keyLevel: 0.24, keySoftness: 0.05 },
  )
  const darkIn = (masked: boolean) => {
    const img = streakRender(
      {
        outline: wide,
        angle: -90,
        band: 0.03,
        skipMasked: false,
        fixes: [{ ...SPAN_FIX, a: { x: 0.45, y: 0.5 }, b: { x: 0.75, y: 0.5 }, source: { a: { x: 0.08, y: 0.5 }, b: { x: 0.34, y: 0.5 } }, masked, seed: 3 }],
      },
      undefined,
      undefined,
      [blockMask],
      maskedScene,
    )
    let n = 0
    for (let x = 118; x < 190; x++) if (pixel(img, x, 120).r < 60) n++
    return n
  }
  check(
    'a fix skips its source\'s masked colours unless told to take them',
    darkIn(false) === 0 && darkIn(true) > 3,
    `dark pixels: ${darkIn(false)} skipping, ${darkIn(true)} taking them`,
  )
  // A fix copies its source as the streak shows it. The source here is all
  // under a dark-keyed mask, so with Skip masked colours on its bars show
  // colours lent by the clear gradient beside it; the fix's bars must show
  // those, not the dark edge they would have had.
  {
    const shownScene = scene((x, y) => (y >= 170 ? (x < 128 ? [18, 18, 22] : [x, 255 - x, 60]) : [128, 128, 128]))
    const cover = maskShape(
      [
        { x: 0, y: 0.62 },
        { x: 0.5, y: 0.62 },
        { x: 0.5, y: 0.8 },
        { x: 0, y: 0.8 },
      ],
      { key: 'darker', keyLevel: 0.24, keySoftness: 0.05 },
    )
    const base = { outline: wide, angle: -90, band: 0.03, skipMasked: true }
    const fixOf = (masked: boolean): StreakFix => ({
      ...SPAN_FIX,
      a: { x: 0.62, y: 0.5 },
      b: { x: 0.9, y: 0.5 },
      source: { a: { x: 0.12, y: 0.5 }, b: { x: 0.45, y: 0.5 } },
      masked,
      variation: 0,
      seed: 9,
    })
    const plain = streakRender(base, undefined, undefined, [cover], shownScene)
    const shownColours: number[][] = []
    for (let x = 32; x < 114; x++) {
      const p = pixel(plain, x, 120)
      shownColours.push([p.r, p.g, p.b])
    }
    const matching = (img: ImageData) => {
      let ok = 0
      let n = 0
      for (let x = 162; x < 228; x++) {
        const p = pixel(img, x, 120)
        n++
        if (shownColours.some((c) => Math.abs(c[0] - p.r) + Math.abs(c[1] - p.g) + Math.abs(c[2] - p.b) <= 14)) ok++
      }
      return ok / n
    }
    const asShown = matching(streakRender({ ...base, fixes: [fixOf(false)] }, undefined, undefined, [cover], shownScene))
    const raw = matching(streakRender({ ...base, fixes: [fixOf(true)] }, undefined, undefined, [cover], shownScene))
    check(
      'a fix copies its source bars as the streak shows them, borrowed colours and all',
      asShown >= 0.9 && raw < 0.5 && Math.min(...shownColours.map((c) => c[0])) > 100,
      `${Math.round(asShown * 100)}% of the fix's colours are among its source's shown ones; taking masked colours, ${Math.round(raw * 100)}%; source r ${Math.min(...shownColours.map((c) => c[0]))}..${Math.max(...shownColours.map((c) => c[0]))}`,
    )
  }
  // A dark subject held in front of light bars by a feathered mask, with the
  // look's halo on. In the soft edge each pixel is partly bar and partly
  // subject, so it lands between the two: the subject alone and the bars
  // unmasked. The halo's blur used to be read only where the bar's colour
  // came from, the bright edge far away, which darkened the subject's whole
  // soft edge past both.
  {
    const subjectScene = scene((_x, y) => (y >= 128 ? [110, 110, 110] : [200, 200, 200]))
    const front = maskShape(
      [
        { x: -0.1, y: 0.5 },
        { x: 1.1, y: 0.5 },
        { x: 1.1, y: 1.1 },
        { x: -0.1, y: 1.1 },
      ],
      { feather: 0.03, featherAt: 'centre' },
    )
    const look = { halo: 0.15, haloRadius: 0.05 }
    const barsRender = (masks: MaskShape[]) =>
      readPixels(
        engine.render({
          base: subjectScene,
          baseSize: discSize,
          grain: neutralPlate,
          grainSize: { width: 8, height: 8 },
          grainMean: 0.5,
          grainSd: 0.0001,
          params: {
            ...DEFAULT_BLEND_PARAMS,
            amount: 0,
            effects: {
              ...DEFAULT_EFFECTS,
              ...look,
              streaks: { enabled: true, amount: 1, shapes: [streakShape({ outline: wide, angle: 90, band: 0.03, length: 1 })] },
              masks,
              maskUse: masks.length ? { streaks: { ids: masks.map((m) => m.id), mode: 'exclude' as const } } : {},
            },
          },
        }),
      )
    const held = barsRender([front])
    const unmasked = barsRender([])
    const alone = renderScene(subjectScene, look)
    let worst = 0
    for (let y = 122; y <= 136; y++)
      for (const x of [64, 128, 192]) {
        const lo = Math.min(pixel(alone, x, y).r, pixel(unmasked, x, y).r)
        worst = Math.max(worst, lo - pixel(held, x, y).r)
      }
    check(
      "a mask's soft edge over bars stays between the subject and the bars with the halo on",
      worst <= 2 && pixel(alone, 128, 132).r > 40,
      `at most ${worst} darker than both; subject alone ${pixel(alone, 128, 132).r}`,
    )
  }
  check(
    'a preview crop matches the export with a colour fix',
    (() => {
      const shape = { outline: wide, angle: -90, band: 0.03, fixes: [{ ...SPAN_FIX, ...fixSpan, seed: 5 }] }
      const region = { x: 60, y: 90, width: 120, height: 120 }
      const crop = streakRender(shape, region, { width: 120, height: 120 }, [], fixScene)
      const full = streakRender(shape, undefined, undefined, [], fixScene)
      let diff = 0
      for (let y = 0; y < 120; y++)
        for (let x = 0; x < 120; x++)
          for (let c = 0; c < 3; c++)
            diff = Math.max(diff, Math.abs(full.data[((y + 90) * 256 + x + 60) * 4 + c] - crop.data[(y * 120 + x) * 4 + c]))
      return diff <= 1
    })(),
  )
  // The JS streak coordinates (the overlay's, and where a fix's ends fall)
  // agree with the shader's: a point and back again, on a bent path.
  {
    const bent = pathFlow(
      [
        { x: 0.2, y: 0.2 },
        { x: 0.5, y: 0.35 },
        { x: 0.8, y: 0.2 },
      ],
      [{ x: 0.1, y: 0.05 }, { x: 0.9, y: 0.05 }, { x: 0.9, y: 0.6 }, { x: 0.1, y: 0.6 }],
    )!
    const dir = { x: 1, y: 0 }
    let worst = 0
    for (const q of [
      { x: 0.3, y: 0.3 },
      { x: 0.5, y: 0.5 },
      { x: 0.7, y: 0.25 },
      { x: 0.45, y: 0.1 },
    ]) {
      const c = streakCoordsJs(q, dir, bent)
      const back = streakPosJs(c.s, c.t, dir, bent)
      worst = Math.max(worst, Math.hypot(back.x - q.x, back.y - q.y))
    }
    check('streak coordinates on a path go to a point and back', worst < 1e-3, `off by ${worst.toExponential(1)}`)
  }
  // Round a tight corner the lines on its inside, further off than the
  // corner's radius, would fold back on themselves — along the corner's
  // inner diagonal the place along the path jumped from one arm to the
  // other. Following smoother versions of the path further off, they do not:
  // neighbouring points' coordinates change smoothly, and each point is on
  // its line exactly.
  {
    // Its lines out along its normal (as a path that turns back has them,
    // not swept across): the corner is eased where they would fold.
    const corner = pathFlow(
      [{ x: 0.2, y: 0.8 }, { x: 0.2, y: 0.3 }, { x: 0.7, y: 0.3 }],
      [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      1,
      false,
    )!
    const dir = { x: 1, y: 0 }
    let jump = 0
    let off = 0
    const step = 0.02
    for (let y = 0.36; y < 0.74; y += step)
      for (let x = 0.26; x < 0.64; x += step) {
        const here = streakCoordsJs({ x, y }, dir, corner)
        const right = streakCoordsJs({ x: x + step, y }, dir, corner)
        const below = streakCoordsJs({ x, y: y + step }, dir, corner)
        jump = Math.max(jump, Math.abs(right.s - here.s), Math.abs(below.s - here.s), Math.abs(right.t - here.t), Math.abs(below.t - here.t))
        const back = streakPosJs(here.s, here.t, dir, corner)
        off = Math.max(off, Math.hypot(back.x - x, back.y - y))
      }
    check(
      'lines inside a tight corner do not fold: their coordinates change smoothly',
      // Folded, as before, the place along jumped by nearly 1 across the diagonal.
      !corner.sweep && jump < 0.25 && off < 1e-4,
      `largest step ${jump.toFixed(3)} for ${step} across; off by ${off.toExponential(1)}`,
    )
  }
  // A streak along a path is a straight one bent round: neighbouring lines
  // stay a band apart all the way along, so every bar keeps its width.
  {
    const arc = pathFlow(
      [{ x: 0.15, y: 0.8 }, { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.25 }, { x: 0.85, y: 0.7 }],
      [{ x: 0.05, y: 0.1 }, { x: 0.95, y: 0.1 }, { x: 0.95, y: 0.9 }, { x: 0.05, y: 0.9 }],
    )!
    const dir = { x: 1, y: 0 }
    const band = 0.02
    let worst = 0
    for (let s = 0.1; s < 1.2; s += 0.05)
      for (let t = -0.3; t <= 0.3; t += 0.05) {
        const a = streakPosJs(s, t, dir, arc)
        const b = streakPosJs(s, t + band, dir, arc)
        worst = Math.max(worst, Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - band) / band)
      }
    check('a streak along a path keeps every bar its width the whole way along', !arc.sweep && worst < 0.02, `widths off by up to ${(worst * 100).toFixed(1)}%`)
  }
  // A path that keeps heading one way is swept: every line is the very
  // curve drawn, moved straight across, so none folds and none is eased.
  {
    const wiggle = [{ x: 0.5, y: 0.9 }, { x: 0.4, y: 0.7 }, { x: 0.6, y: 0.5 }, { x: 0.4, y: 0.3 }, { x: 0.5, y: 0.1 }]
    const swept = pathFlow(wiggle, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }])!
    const dir = { x: 1, y: 0 }
    let worst = 0
    let back = 0
    for (let s = -0.1; s < 0.95; s += 0.05)
      for (let t = -0.45; t <= 0.45; t += 0.05) {
        const on = streakPosJs(s, 0, dir, swept)
        const off = streakPosJs(s, t, dir, swept)
        // The same place on every copy, straight across from the path.
        const n = { x: -swept.sweep!.y, y: swept.sweep!.x }
        worst = Math.max(worst, Math.hypot(off.x - on.x - n.x * t, off.y - on.y - n.y * t))
        const c = streakCoordsJs(off, dir, swept)
        const again = streakPosJs(c.s, c.t, dir, swept)
        back = Math.max(back, Math.hypot(again.x - off.x, again.y - off.y))
      }
    check(
      'a path that keeps heading one way is swept: every line the same curve, moved across',
      !!swept.sweep && worst < 1e-9 && back < 1e-6,
      `copies off by ${worst.toExponential(1)}, there and back ${back.toExponential(1)}`,
    )
  }
  // Round a hairpin, a line runs further than the shape is across: bars of
  // the whole way across reach the far end, not stopping where a search
  // capped at the shape's size gave up.
  {
    const hairpin = [{ x: 0.3, y: 0.95 }, { x: 0.3, y: 0.25 }, { x: 0.5, y: 0.12 }, { x: 0.7, y: 0.25 }, { x: 0.7, y: 0.95 }]
    const box = [{ x: 0.12, y: 0.05 }, { x: 0.88, y: 0.05 }, { x: 0.88, y: 0.92 }, { x: 0.12, y: 0.92 }]
    const across = scene((x) => [x, 128, 60])
    const round = streakRender({ outline: box, path: hairpin, band: 0.01, lengthMin: 1, lengthMax: 1, measure: 'across' }, undefined, undefined, [], across)
    // Near the end of the right arm the colour is from where the left arm entered (r about 77), not the photo's own (179).
    const r = pixel(round, 179, 220).r
    check('bars along a hairpin path reach all the way round', r < 120, `r ${r} at the far end`)
  }

  // A streak's own tone: brightness and contrast on the streaked colour only.
  const toneBase = fillTest({})
  const brighter = fillTest({ brightness: 1, endBrightness: 1 })
  const contrasty = fillTest({ contrast: 0.5, endContrast: 0.5 })
  const at = (img: ImageData) => pixel(img, 128, 150)
  check(
    "a streak's brightness and contrast change the streak, not the photo round it",
    at(brighter).r > at(toneBase).r + 10 &&
      at(brighter).g > at(toneBase).g &&
      at(contrasty).r < at(toneBase).r - 10 &&
      at(contrasty).g > at(toneBase).g + 10 &&
      maxDiffAt(brighter, toneBase, 20, 20) === 0,
    `streak r/g ${at(toneBase).r}/${at(toneBase).g} → brighter ${at(brighter).r}/${at(brighter).g}, contrast ${at(contrasty).r}/${at(contrasty).g}`,
  )
  // Masks on other sections. A small square in the middle, held back from a
  // leak lighting the middle: inside the square the photo is as it was.
  const middle = maskShape([
    { x: 0.42, y: 0.42 },
    { x: 0.58, y: 0.42 },
    { x: 0.58, y: 0.58 },
    { x: 0.42, y: 0.58 },
  ])
  const maskPlain = renderScene(flatScene, {})
  const leakOnly = { leaks: { ...DEFAULT_LEAKS, amount: 0.8, spots: [centreSpot] } }
  const leakMasked = renderScene(flatScene, { ...leakOnly, masks: [middle], maskUse: { leaks: { ids: [middle.id], mode: 'exclude' } } })
  const leakFree = renderScene(flatScene, leakOnly)
  check(
    'a mask holds a light leak back from what it covers',
    maxDiffAt(leakMasked, maskPlain, 128, 128) <= 1 && maxDiffAt(leakMasked, leakFree, 128, 80) <= 1 && maxDiffAt(leakFree, maskPlain, 128, 128) > 10,
  )
  const toneOnly = renderScene(flatScene, { exposure: 1, masks: [middle], maskUse: { tone: { ids: [middle.id], mode: 'only' } } })
  check(
    'a section can apply only inside a mask',
    pixel(toneOnly, 128, 128).r > pixel(maskPlain, 128, 128).r + 20 && maxDiffAt(toneOnly, maskPlain, 30, 30) <= 1,
  )
  // Glass masked to a pane: its ribs' light and shade (all a flat scene
  // shows of it) inside the square and nowhere else; kept off the square,
  // the other way round.
  {
    const glassLook = { glass: { ...DEFAULT_GLASS, amount: 0.8, width: 0.05, edges: 1 } }
    const glassAll = renderScene(flatScene, glassLook)
    const glassIn = renderScene(flatScene, { ...glassLook, masks: [middle], maskUse: { glass: { ids: [middle.id], mode: 'only' } } })
    const glassOut = renderScene(flatScene, { ...glassLook, masks: [middle], maskUse: { glass: { ids: [middle.id], mode: 'exclude' } } })
    // The most a render differs from another across a row of the square's middle, or of the corner.
    const across = (a: ImageData, b: ImageData, y: number, x0: number, x1: number) => {
      let m = 0
      for (let x = x0; x <= x1; x++) m = Math.max(m, maxDiffAt(a, b, x, y))
      return m
    }
    check(
      'glass can be kept to a mask, or off it',
      across(glassAll, maskPlain, 128, 112, 144) > 6 &&
        across(glassIn, glassAll, 128, 112, 144) <= 1 &&
        across(glassIn, maskPlain, 30, 10, 60) <= 1 &&
        across(glassOut, maskPlain, 128, 112, 144) <= 1 &&
        across(glassOut, glassAll, 30, 10, 60) <= 1,
      `glass shows ${across(glassAll, maskPlain, 128, 112, 144)} in the square; only-in leaves ${across(glassIn, maskPlain, 30, 10, 60)} outside, kept-off leaves ${across(glassOut, maskPlain, 128, 112, 144)} inside`,
    )
  }
  // A feather wider than the mask itself: placed outside, it softens round
  // the mask and leaves the mask whole. Made by blurring, it spread a small
  // mask so thin that none of it was at full strength any more.
  const tiny = [
    { x: 0.46, y: 0.46 },
    { x: 0.54, y: 0.46 },
    { x: 0.54, y: 0.54 },
    { x: 0.46, y: 0.54 },
  ]
  const tinyHard = maskShape(tiny)
  const tinySoft = maskShape(tiny, { feather: 0.1, featherAt: 'outside' })
  const tinyLook = (m: MaskShape) => ({ exposure: 1, masks: [m], maskUse: { tone: { ids: [m.id], mode: 'only' as const } } })
  const hardTiny = renderScene(flatScene, tinyLook(tinyHard))
  const softTiny = renderScene(flatScene, tinyLook(tinySoft))
  check(
    'a wide feather softens round a small mask and leaves its middle at full strength',
    maxDiffAt(softTiny, hardTiny, 128, 128) <= 1 &&
      pixel(softTiny, 150, 128).r > pixel(maskPlain, 150, 128).r + 3 &&
      pixel(softTiny, 150, 128).r < pixel(hardTiny, 128, 128).r - 3,
    `middle ${pixel(hardTiny, 128, 128).r}→${pixel(softTiny, 128, 128).r}, 12px out ${pixel(maskPlain, 150, 128).r}→${pixel(softTiny, 150, 128).r}`,
  )
  // A tone key: a loose square round a dark disc, keyed to dark pixels, so
  // the mask takes the disc's own edge — the light pixels round it inside
  // the square still get the exposure.
  const darkDisc = scene((x, y) => (Math.hypot(x - 128, y - 128) < 18 ? [20, 20, 24] : [170, 170, 170]))
  const loose = maskShape(
    [
      { x: 0.3, y: 0.3 },
      { x: 0.7, y: 0.3 },
      { x: 0.7, y: 0.7 },
      { x: 0.3, y: 0.7 },
    ],
    { key: 'darker', keyLevel: 0.35, keySoftness: 0.05 },
  )
  const keyedPlain = renderScene(darkDisc, {})
  const keyed = renderScene(darkDisc, { exposure: 1, masks: [loose], maskUse: { tone: { ids: [loose.id], mode: 'exclude' } } })
  check(
    'a tone key keeps a mask to the dark subject inside its outline',
    maxDiffAt(keyed, keyedPlain, 128, 128) <= 1 && pixel(keyed, 128, 95).r > pixel(keyedPlain, 128, 95).r + 20,
    `disc ${pixel(keyedPlain, 128, 128).r}→${pixel(keyed, 128, 128).r}, round it ${pixel(keyedPlain, 128, 95).r}→${pixel(keyed, 128, 95).r}`,
  )
  const maskedLook = { exposure: 0.6, leaks: leakOnly.leaks, masks: [loose, middle], maskUse: { tone: { ids: [loose.id], mode: 'exclude' as const }, leaks: { ids: [middle.id], mode: 'only' as const } } }
  const mFull = renderScene(darkDisc, maskedLook)
  const mCrop = renderScene(darkDisc, maskedLook, { x: 60, y: 90, width: 120, height: 120 }, { width: 120, height: 120 })
  let mDiff = 0
  for (let y = 0; y < 120; y++)
    for (let x = 0; x < 120; x++)
      for (let c = 0; c < 3; c++)
        mDiff = Math.max(mDiff, Math.abs(mFull.data[((y + 90) * 256 + x + 60) * 4 + c] - mCrop.data[(y * 120 + x) * 4 + c]))
  check('a preview crop matches the export with masks on sections', mDiff <= 1, `maxΔ=${mDiff}`)
  // Tone along a bar: the square's bars run up from row 179 to row 77, so
  // low rows are near a bar's start and high rows near its end.
  const fading = fillTest({ brightness: 1, endBrightness: -1, changeAt: 0, changeLength: 1 })
  const stepped = fillTest({ opacity: 1, endOpacity: 0, changeAt: 0.5, changeLength: 0 })
  check(
    'a streak brightens at its start and darkens at its end, and its opacity steps at a point along it',
    pixel(fading, 128, 172).g > pixel(toneBase, 128, 172).g + 20 &&
      pixel(fading, 128, 84).g < pixel(toneBase, 128, 84).g - 20 &&
      maxDiffAt(stepped, toneBase, 128, 160) <= 1 &&
      maxDiffAt(stepped, plainFill, 128, 100) <= 1,
    `near the start ${pixel(toneBase, 128, 172).g}→${pixel(fading, 128, 172).g}, near the end ${pixel(toneBase, 128, 84).g}→${pixel(fading, 128, 84).g}`,
  )
  const allStreak: Partial<StreakShape> = {
    brightness: 0.4,
    contrast: 0.2,
    endBrightness: -0.3,
    endOpacity: 0.6,
    changeAt: 0.3,
    changeLength: 0.4,
    featherAt: 'outside',
    featherEdge: 'grain',
    path: curve,
    lengthMin: 0.3,
    variation: 0.4,
    tipAngle: 30,
    tipRange: 20,
    feather: 0.03,
    pull: 0.05,
  }
  const allDiff = cropMatches(allStreak, [mask(0.03)])
  check('a preview crop matches the export with a path, angled ends and a mask', allDiff <= 1, `maxΔ=${allDiff}`)
  const runOnDiff = cropMatches({ ...allStreak, clip: false, measure: 'distance', length: 0.5 })
  check('a preview crop matches the export with a fill running past its shape', runOnDiff <= 1, `maxΔ=${runOnDiff}`)
  const trailDiff = cropMatches({ ...allStreak, mode: 'trail' })
  check('a preview crop matches the export with a trail along a path', trailDiff <= 1, `maxΔ=${trailDiff}`)

  // Pixel art: solid blocks on the print grid, a palette limits colours, and a
  // preview crop still matches the export.
  const artParams = (art: Partial<typeof DEFAULT_PIXEL_ART>) => ({
    ...DEFAULT_BLEND_PARAMS,
    amount: 0.2,
    effects: { ...DEFAULT_EFFECTS, pixelArt: { ...DEFAULT_PIXEL_ART, enabled: true, ...art } },
  })
  const artRender = (art: Partial<typeof DEFAULT_PIXEL_ART>, region?: Rect, outputSize?: Size) =>
    readPixels(
      engine.render({
        base: scene((x, y) => [x, y, 255 - x]),
        baseSize: discSize,
        grain: ditherPlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.09,
        params: artParams(art),
        region,
        outputSize,
      }),
    )
  const blocky = artRender({ pixelate: 8 })
  let solid = true
  for (let by = 0; by < 32 && solid; by++)
    for (let bx = 0; bx < 32 && solid; bx++)
      if (Math.abs(pixel(blocky, bx * 8 + 1, by * 8 + 1).r - pixel(blocky, bx * 8 + 6, by * 8 + 6).r) > 1) solid = false
  check('pixelate draws the frame in solid blocks', solid)
  const artRegion = { x: 40, y: 56, width: 96, height: 80 }
  const artCrop = artRender({ pixelate: 8, palette: 'pico8', dither: 0.7 }, artRegion, { width: 96, height: 80 })
  const artFull = artRender({ pixelate: 8, palette: 'pico8', dither: 0.7 })
  let artDiff = 0
  for (let y = 0; y < artRegion.height; y++)
    for (let x = 0; x < artRegion.width; x++)
      for (let c = 0; c < 3; c++)
        artDiff = Math.max(artDiff, Math.abs(artFull.data[((y + artRegion.y) * 256 + x + artRegion.x) * 4 + c] - artCrop.data[(y * 96 + x) * 4 + c]))
  check('a preview crop matches the export with pixel art on', artDiff <= 1, `maxΔ=${artDiff}`)
  const paletted = readPixels(
    engine.render({
      base: scene((x, y) => [x, y, 255 - x]),
      baseSize: discSize,
      grain: ditherPlate,
      grainSize: { width: 128, height: 128 },
      grainMean: 0.5,
      grainSd: 0.0001,
      params: { ...artParams({ palette: 'gameboy', dither: 0 }), amount: 0 },
    }),
  )
  const colourSet = new Set<string>()
  for (let i = 0; i < paletted.data.length; i += 4) colourSet.add(`${paletted.data[i]},${paletted.data[i + 1]},${paletted.data[i + 2]}`)
  check('a palette limits the picture to its colours', colourSet.size <= 4, `${colourSet.size} colours`)
  // Transitions only: a flat field sitting between two bands gets no
  // checker — one solid level — while a gradient keeps its pattern.
  const transRender = (base: ImageData, transitionsOnly: number) =>
    readPixels(
      engine.render({
        base,
        baseSize: discSize,
        grain: ditherPlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.09,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: {
            ...DEFAULT_EFFECTS,
            dither: { ...DEFAULT_DITHER, amount: 1, steps: 5, spread: 1, pattern: 'ordered', transitionsOnly },
          },
        },
      }),
    )
  const midFlat = scene(() => [96, 96, 96])
  const distinct = (img: ImageData, y0: number, y1: number) => {
    const s = new Set<number>()
    for (let y = y0; y < y1; y++) for (let x = 60; x < 200; x++) s.add(pixel(img, x, y).g)
    return s.size
  }
  check(
    'transitions only turns a flat checker into a solid band',
    distinct(transRender(midFlat, 0), 60, 200) > 1 && distinct(transRender(midFlat, 1), 60, 200) === 1,
  )
  check(
    'and keeps the pattern where colours change',
    distinct(transRender(scene((x) => [x, x, x]), 1), 60, 200) > 3,
  )
  check(
    'dither steps a gradient into bands with stippled edges',
    levelsSeen.size <= 5 && mixedColumn,
    `${levelsSeen.size} levels across the ramp`,
  )

  check(
    'a zero grade is a no-op',
    maxDiff(renderScene(greenPatch, { grade: { ...DEFAULT_GRADE } }), renderScene(greenPatch, {})) === 0,
  )
  const luma = (p: { r: number; g: number; b: number }) => 0.2126 * p.r + 0.7152 * p.g + 0.0722 * p.b
  const kept = pixel(renderScene(greenPatch, { stock: { id: 'violet', strength: 1, keepTone: 1 } }), 128, 128)
  const plainGreen = pixel(renderScene(greenPatch, {}), 128, 128)
  check(
    'keep tones takes the stock’s colour and the photo’s brightness',
    kept.b > kept.g && Math.abs(luma(kept) - luma(plainGreen)) < 4,
    `luma ${luma(plainGreen).toFixed(0)} -> ${luma(kept).toFixed(0)}, rgb ${kept.r} ${kept.g} ${kept.b}`,
  )
  const warmer = pixel(renderScene(flatScene, { grade: { ...DEFAULT_GRADE, warmth: 1 } }), 128, 128)
  const flatPlain = pixel(renderScene(flatScene, {}), 128, 128)
  check(
    'warmth shifts colour without moving brightness',
    warmer.r > flatPlain.r && warmer.b < flatPlain.b && Math.abs(luma(warmer) - luma(flatPlain)) < 2,
    `rgb ${flatPlain.r} ${flatPlain.g} ${flatPlain.b} -> ${warmer.r} ${warmer.g} ${warmer.b}`,
  )

  // Every new stage at once, preview crop against export. Edge glow and crunch
  // read a whole-frame blur and the leaks are keyed to the print, so all of
  // them must land identically in a crop.
  const everything = {
    rim: 1.2, crunch: 0.6, rimRadius: 0.02, exposure: 0.4, halo: 0.6, haloRadius: 0.04, solarize: 0.5, halation: 0.5, glowRadius: 0.04,
    stock: { id: 'sunburn', strength: 1, keepTone: 0.5 },
    leaks: { ...DEFAULT_LEAKS, amount: 0.6, spots: [...randomSpots(9, 2), { ...randomSpots(4, 1, 'burn')[0] }], seed: 9 },
    grade: { ...DEFAULT_GRADE, vibrance: 0.4, shadowAmount: 0.5, highlightAmount: 0.5 },
    glowColour: { source: 'light' as const, colour: [1, 1, 1] as [number, number, number] },
  }
  const vibeFull = renderScene(step, everything)
  const vibeRegion = { x: 100, y: 60, width: 90, height: 80 }
  const vibeCrop = renderScene(step, everything, vibeRegion, { width: 90, height: 80 })
  let vibeCropDiff = 0
  for (let y = 0; y < vibeRegion.height; y++) {
    for (let x = 0; x < vibeRegion.width; x++) {
      const a = ((y + vibeRegion.y) * 256 + x + vibeRegion.x) * 4
      const b = (y * vibeRegion.width + x) * 4
      for (let c = 0; c < 3; c++) vibeCropDiff = Math.max(vibeCropDiff, Math.abs(vibeFull.data[a + c] - vibeCrop.data[b + c]))
    }
  }
  check('a preview crop matches the export with every vibe stage on', vibeCropDiff <= 1, `maxΔ=${vibeCropDiff}`)

  // Shoulder: compress the top of the range, leave everything below the knee.
  const ramp = (() => {
    const d = new ImageData(256, 32)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4
        d.data[i] = d.data[i + 1] = d.data[i + 2] = x
        d.data[i + 3] = 255
      }
    }
    return d
  })()
  const rampThrough = (shoulder: number, fade = 0) =>
    readPixels(
      engine.render({
        base: ramp,
        baseSize: { width: 256, height: 32 },
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, shoulder, fade } },
      }),
    )
  const flatRamp = rampThrough(0)
  const rolled = rampThrough(0.8)
  const rampAt = (img: ImageData, x: number) => img.data[(16 * 256 + x) * 4]
  check(
    'shoulder leaves the shadows and midtones where they were',
    Math.abs(rampAt(rolled, 40) - rampAt(flatRamp, 40)) <= 1 && Math.abs(rampAt(rolled, 110) - rampAt(flatRamp, 110)) <= 1,
    `luma 40 and 110 unchanged`,
  )
  check(
    'shoulder compresses the top of the range',
    rampAt(rolled, 250) - rampAt(rolled, 225) < rampAt(flatRamp, 250) - rampAt(flatRamp, 225),
    `top 25 codes span ${rampAt(flatRamp, 250) - rampAt(flatRamp, 225)} without, ${rampAt(rolled, 250) - rampAt(rolled, 225)} with`,
  )

  // Fade: the film's toe. Lifts black off the floor, leaves highlights alone,
  // and stays monotone so no two tones swap places.
  const faded = rampThrough(0, 0.06)
  check(
    'fade lifts black off the floor',
    rampAt(faded, 0) >= 12 && rampAt(faded, 0) <= 18,
    `black ${rampAt(flatRamp, 0)} -> ${rampAt(faded, 0)}`,
  )
  check(
    'fade leaves the highlights where they were',
    Math.abs(rampAt(faded, 200) - rampAt(flatRamp, 200)) <= 1 && rampAt(faded, 255) === rampAt(flatRamp, 255),
    `200 -> ${rampAt(faded, 200)}, 255 -> ${rampAt(faded, 255)}`,
  )
  let fadeMonotone = true
  for (let x = 1; x < 256; x++) if (rampAt(faded, x) < rampAt(faded, x - 1)) fadeMonotone = false
  check('fade keeps the tone scale monotone', fadeMonotone)

  // Roll-off and Fade change brightness, not colour: a bright orange stays as
  // orange as it rolls off, and a dark blue stays as blue as it lifts. Each
  // used to work on the channels one by one, which drained both toward grey.
  const satOf = (p: { r: number; g: number; b: number }) => (Math.max(p.r, p.g, p.b) - Math.min(p.r, p.g, p.b)) / Math.max(p.r, p.g, p.b, 1)
  const hueOf = (p: { r: number; g: number; b: number }) => {
    const mx = Math.max(p.r, p.g, p.b)
    const d = mx - Math.min(p.r, p.g, p.b)
    return d === 0 ? 0 : mx === p.r ? (((p.g - p.b) / d + 6) % 6) * 60 : mx === p.g ? ((p.b - p.r) / d + 2) * 60 : ((p.r - p.g) / d + 4) * 60
  }
  const brightOrange = scene(() => [250, 150, 70])
  const darkBlue = scene(() => [20, 26, 60])
  const orangePlain = pixel(renderScene(brightOrange, {}), 128, 128)
  const orangeRolled = pixel(renderScene(brightOrange, { shoulder: 1 }), 128, 128)
  const bluePlain = pixel(renderScene(darkBlue, {}), 128, 128)
  const blueLifted = pixel(renderScene(darkBlue, { fade: 0.08 }), 128, 128)
  check(
    'roll-off and fade change brightness and keep the colour',
    orangeRolled.r !== orangePlain.r &&
      Math.abs(satOf(orangeRolled) - satOf(orangePlain)) < 0.03 &&
      Math.abs(hueOf(orangeRolled) - hueOf(orangePlain)) < 3 &&
      blueLifted.b > bluePlain.b &&
      Math.abs(satOf(blueLifted) - satOf(bluePlain)) < 0.03 &&
      Math.abs(hueOf(blueLifted) - hueOf(bluePlain)) < 3,
    `orange ${orangePlain.r},${orangePlain.g},${orangePlain.b} -> ${orangeRolled.r},${orangeRolled.g},${orangeRolled.b}; blue ${bluePlain.r},${bluePlain.g},${bluePlain.b} -> ${blueLifted.r},${blueLifted.g},${blueLifted.b}`,
  )
  // With Colour off the look adds no colour: its glow is neutral light.
  const colourOff = resolveParams(
    { ...DEFAULT_BLEND_PARAMS, modules: { ...DEFAULT_MODULES, colour: false }, effects: { ...DEFAULT_EFFECTS, glowColour: { source: 'manual', colour: [1, 0.6, 0.3] } } },
    paletteFromPixels(new Uint8ClampedArray([200, 120, 60, 255, 30, 40, 90, 255])),
  ).effects.glowColour.colour
  check(
    'with Colour off the glow is neutral',
    Math.max(...colourOff) - Math.min(...colourOff) < 1e-6,
    colourOff.map((v) => v.toFixed(2)).join(','),
  )

  // Defects are one layer across the frame, and reproducible from their seed.
  const withDefects = (defects: Partial<typeof DEFAULT_DEFECTS>) =>
    withEffects({ defects: { ...DEFAULT_DEFECTS, strength: 1, dust: 400, hairs: 2, scratches: 2, ...defects } })
  const defectsA = withDefects({ seed: 5 })
  const defectsB = withDefects({ seed: 5 })
  const defectsC = withDefects({ seed: 6 })
  check('defects are deterministic for a seed', maxDiff(defectsA, defectsB) === 0)
  check('a different defect seed gives different defects', maxDiff(defectsA, defectsC) > 20)
  check(
    'defects mark the frame without moving the picture',
    maxDiff(defectsA, noEffects) > 20 && Math.abs(imageMean(defectsA) - imageMean(noEffects)) < 6,
    `mean ${imageMean(noEffects).toFixed(1)} -> ${imageMean(defectsA).toFixed(1)}`,
  )

  // Everything off must be byte-identical to the pipeline without the stages.
  check(
    'the effect stages are a no-op when they are all zero',
    maxDiff(noEffects, withEffects({ halation: 0, bloom: 0, shoulder: 0, fade: 0, vignette: 0 })) === 0,
  )


  // --- borders --------------------------------------------------------------
  // The border is part of the print: composited before the grain, so the same
  // emulsion texture and the same dust carry across the picture edge. A clean
  // border around a grainy photograph reads as a graphic overlay at once.
  const borderPlate = makeOffsetGrain(256, 0.5, 0.09)
  const borderStats = { mean: imageMean(borderPlate) / 255, sd: stdDev(borderPlate) / 255 }
  const photo = makeFlatGrain(240, 300, 96)
  const photoSize = { width: 240, height: 300 }
  const printed = (border: Partial<typeof DEFAULT_BORDER>, extra: Record<string, unknown> = {}, region?: Rect, outputSize?: Size) =>
    readPixels(
      engine.render({
        base: photo,
        baseSize: photoSize,
        grain: borderPlate,
        grainSize: { width: 256, height: 256 },
        grainMean: borderStats.mean,
        grainSd: borderStats.sd,
        region,
        outputSize,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          blendMode: 'linearLight',
          amount: 0.4,
          colorSpace: 'srgb',
          ...extra,
          border: { ...DEFAULT_BORDER, ...border },
        },
      }),
    )

  const noBorder = printed({ width: 0 })
  check(
    'no border leaves the print the size of the photo',
    noBorder.width === 240 && noBorder.height === 300,
    `${noBorder.width}x${noBorder.height}`,
  )

  const framed = printed({ width: 0.1, bottomExtra: 0.15, irregularity: 0, texture: 0 })
  const expected = printSize(photoSize, { ...DEFAULT_BORDER, width: 0.1, bottomExtra: 0.15 })
  check(
    'a border grows the print, with extra paper at the bottom',
    framed.width === expected.width && framed.height === expected.height && expected.height - 300 > expected.width - 240,
    `photo 240x300 becomes ${framed.width}x${framed.height}`,
  )

  // Grain must be on the paper, not just on the photograph.
  const paperBox = (img: ImageData) => {
    const strip: number[] = []
    for (let y = img.height - 26; y < img.height - 6; y++) {
      for (let x = 30; x < img.width - 30; x++) strip.push(img.data[(y * img.width + x) * 4])
    }
    const mean = strip.reduce((a, b) => a + b, 0) / strip.length
    return Math.sqrt(strip.reduce((a, b) => a + (b - mean) ** 2, 0) / strip.length)
  }
  const grainyPaper = printed({ width: 0.1, bottomExtra: 0.15, irregularity: 0, texture: 0, grain: 1 })
  const cleanPaper = printed({ width: 0.1, bottomExtra: 0.15, irregularity: 0, texture: 0, grain: 0 })
  check(
    'grain carries onto the paper',
    paperBox(grainyPaper) > 3 && paperBox(cleanPaper) < 1,
    `paper sigma ${paperBox(grainyPaper).toFixed(2)} with grain, ${paperBox(cleanPaper).toFixed(2)} without`,
  )

  // And dust: one layer over the whole print, not just the picture.
  const dusty = printed(
    { width: 0.12, irregularity: 0, texture: 0, grain: 0 },
    { amount: 0, effects: { ...DEFAULT_EFFECTS, defects: { ...DEFAULT_DEFECTS, strength: 1, dust: 900, hairs: 0, scratches: 0, seed: 3 } } },
  )
  const cleanPrint = printed({ width: 0.12, irregularity: 0, texture: 0, grain: 0 }, { amount: 0 })
  const edgePx = Math.round(0.12 * Math.min(240, 300))
  let paperMarks = 0
  for (let y = 0; y < dusty.height; y++) {
    for (let x = 0; x < dusty.width; x++) {
      const onPaper = x < edgePx || y < edgePx || x >= dusty.width - edgePx || y >= dusty.height - edgePx
      if (!onPaper) continue
      const i = (y * dusty.width + x) * 4
      if (Math.abs(dusty.data[i] - cleanPrint.data[i]) > 8) paperMarks++
    }
  }
  check('dust falls on the border as well as the picture', paperMarks > 20, `${paperMarks} marked pixels on the paper`)

  // The edge between picture and paper should not be a ruler-straight line.
  const straightEdge = printed({ width: 0.1, irregularity: 0, texture: 0, grain: 0 }, { amount: 0 })
  const wobblyEdge = printed({ width: 0.1, irregularity: 1, texture: 0, grain: 0 }, { amount: 0 })
  const edgeRowFor = (img: ImageData) => {
    // Find, for each column, the first row that belongs to the photograph.
    const rows: number[] = []
    for (let x = 40; x < img.width - 40; x += 3) {
      for (let y = 0; y < img.height; y++) {
        if (img.data[(y * img.width + x) * 4] < 160) {
          rows.push(y)
          break
        }
      }
    }
    const mean = rows.reduce((a, b) => a + b, 0) / rows.length
    return Math.sqrt(rows.reduce((a, b) => a + (b - mean) ** 2, 0) / rows.length)
  }
  check(
    'the cut between picture and paper wanders',
    // Wander is scaled to the photo (0.4% of its short side at irregularity 1),
    // so on this 240-px test photo it is about a pixel.
    edgeRowFor(straightEdge) < 0.2 && edgeRowFor(wobblyEdge) > 0.3,
    `edge wander ${edgeRowFor(straightEdge).toFixed(2)}px straight vs ${edgeRowFor(wobblyEdge).toFixed(2)}px irregular`,
  )

  // And the guarantee, once more, now that the render happens in print space.
  const printRegion = { x: 10, y: 12, width: 90, height: 80 }
  const printCrop = printed({ width: 0.1, bottomExtra: 0.15 }, {}, printRegion, { width: 90, height: 80 })
  const printFull = printed({ width: 0.1, bottomExtra: 0.15 })
  let printCropDiff = 0
  for (let y = 0; y < printRegion.height; y++) {
    for (let x = 0; x < printRegion.width; x++) {
      const a = ((y + printRegion.y) * printFull.width + x + printRegion.x) * 4
      const b = (y * printRegion.width + x) * 4
      for (let c = 0; c < 3; c++) printCropDiff = Math.max(printCropDiff, Math.abs(printFull.data[a + c] - printCrop.data[b + c]))
    }
  }
  check('a preview crop of the border matches the export', printCropDiff <= 1, `maxΔ=${printCropDiff}`)


  // Scanner artefacts are fixed-pattern: the same row is always read by the
  // same electronics, so the variation holds still. Random per-pixel noise
  // would read as grain, not as a scan.
  const scanned = (defects: Partial<typeof DEFAULT_DEFECTS>) =>
    readPixels(
      engine.render({
        base: makeFlatGrain(200, 200, 120),
        baseSize: { width: 200, height: 200 },
        grain: neutralPlate,
        grainSize: { width: 8, height: 8 },
        grainMean: 0.5,
        grainSd: 0.0001,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: { ...DEFAULT_EFFECTS, defects: { ...DEFAULT_DEFECTS, strength: 0, seed: 12, ...defects } },
        },
      }),
    )
  const rowSpread = (img: ImageData) => {
    // Variation between row averages, against variation within a row.
    const rowMeans: number[] = []
    let withinRow = 0
    for (let y = 0; y < img.height; y++) {
      const row: number[] = []
      for (let x = 0; x < img.width; x++) row.push(img.data[(y * img.width + x) * 4])
      const m = row.reduce((a, b) => a + b, 0) / row.length
      rowMeans.push(m)
      withinRow += Math.sqrt(row.reduce((a, b) => a + (b - m) ** 2, 0) / row.length)
    }
    const mean = rowMeans.reduce((a, b) => a + b, 0) / rowMeans.length
    const between = Math.sqrt(rowMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / rowMeans.length)
    return { between, within: withinRow / img.height }
  }
  const linesOff = rowSpread(scanned({}))
  const linesOn = rowSpread(scanned({ scanLines: 0.8 }))
  check(
    'scan lines vary between rows, not within them',
    linesOn.between > 1 && linesOn.between > linesOn.within * 4 && linesOff.between < 0.2,
    `row-to-row ${linesOn.between.toFixed(2)} vs within-row ${linesOn.within.toFixed(2)}`,
  )

  const columnSpread = (img: ImageData) => {
    const colMeans: number[] = []
    for (let x = 0; x < img.width; x++) {
      let sum = 0
      for (let y = 0; y < img.height; y++) sum += img.data[(y * img.width + x) * 4]
      colMeans.push(sum / img.height)
    }
    const mean = colMeans.reduce((a, b) => a + b, 0) / colMeans.length
    return {
      spread: Math.sqrt(colMeans.reduce((a, b) => a + (b - mean) ** 2, 0) / colMeans.length),
      worst: Math.max(...colMeans.map((c) => Math.abs(c - mean))),
    }
  }
  const streaksOn = columnSpread(scanned({ scanStreaks: 0.8 }))
  check(
    'streaks run down whole columns, with the odd strong one',
    streaksOn.spread > 0.5 && streaksOn.worst > streaksOn.spread * 3,
    `column spread ${streaksOn.spread.toFixed(2)}, worst column off by ${streaksOn.worst.toFixed(2)}`,
  )
  check(
    'scan artefacts are a no-op at zero',
    maxDiff(scanned({}), scanned({ scanLines: 0, scanStreaks: 0 })) === 0,
  )


  // --- surge marks ----------------------------------------------------------
  // Bands where the film developed harder. Unlike a scanner artefact these
  // modulate the *grain*, so the test measures local grain strength rather than
  // brightness, on a flat field where nothing else varies.
  // One plate, reused: makeOffsetGrain advances a seed on every call, so
  // building it inside would compare two different plates.
  const surgePlate = makeOffsetGrain(128, 0.5, 0.06)
  const surgeBase = makeFlatGrain(320, 320, 120)
  const surgeField = (surge: Partial<typeof DEFAULT_SURGE>, amount = 0.25) =>
    readPixels(
      engine.render({
        base: surgeBase,
        baseSize: { width: 320, height: 320 },
        grain: surgePlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.06,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          blendMode: 'linearLight',
          colorSpace: 'srgb',
          amount,
          effects: { ...DEFAULT_EFFECTS, surge: { ...DEFAULT_SURGE, ...surge } },
        },
      }),
    )
  /** Local grain strength on a grid of cells. */
  const cellSigmas = (img: ImageData, cells = 8) => {
    const size = Math.floor(img.width / cells)
    const grid: number[][] = []
    for (let cy = 0; cy < cells; cy++) {
      const row: number[] = []
      for (let cx = 0; cx < cells; cx++) {
        let sq = 0
        let n = 0
        for (let y = cy * size + 2; y < (cy + 1) * size - 2; y++) {
          for (let x = cx * size + 2; x < (cx + 1) * size - 2; x++) {
            let sum = 0
            for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) sum += img.data[((y + j) * img.width + x + k) * 4]
            sq += (img.data[(y * img.width + x) * 4] - sum / 25) ** 2
            n++
          }
        }
        row.push(Math.sqrt(sq / n))
      }
      grid.push(row)
    }
    return grid
  }
  const spreadOfGrid = (grid: number[][]) => {
    const all = grid.flat()
    return Math.max(...all) / Math.max(1e-6, Math.min(...all))
  }

  const surgeOff = cellSigmas(surgeField({ strength: 0 }))
  const surgeOn = cellSigmas(surgeField({ strength: 1, count: 3, width: 0.09, angle: 90, seed: 5 }))
  check(
    'surge marks raise the grain in places rather than everywhere',
    spreadOfGrid(surgeOn) > spreadOfGrid(surgeOff) * 1.5 && spreadOfGrid(surgeOff) < 1.2,
    `local grain varies ${spreadOfGrid(surgeOff).toFixed(2)}x across the frame without, ${spreadOfGrid(surgeOn).toFixed(2)}x with`,
  )

  // Bands run in a direction: with vertical bands the grain should change as
  // you move across the frame far more than as you move down it.
  const vertical = cellSigmas(surgeField({ strength: 1, count: 3, width: 0.07, angle: 90, seed: 5 }))
  const deviationOf = (xs: number[]) => {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length)
  }
  const columnMeans = vertical[0].map((_, cx) => vertical.reduce((a, row) => a + row[cx], 0) / vertical.length)
  const rowMeans = vertical.map((row) => row.reduce((a, b) => a + b, 0) / row.length)
  check(
    'surge bands run in the direction they are pointed',
    deviationOf(columnMeans) > deviationOf(rowMeans) * 1.6,
    `across the bands ${deviationOf(columnMeans).toFixed(2)}, along them ${deviationOf(rowMeans).toFixed(2)}`,
  )

  check(
    'surge marks are deterministic for a seed',
    maxDiff(surgeField({ strength: 1, count: 3, seed: 5 }), surgeField({ strength: 1, count: 3, seed: 5 })) === 0,
  )
  check(
    'a different surge seed puts the bands elsewhere',
    maxDiff(surgeField({ strength: 1, count: 3, seed: 5 }), surgeField({ strength: 1, count: 3, seed: 6 })) > 4,
  )
  check('surge marks are a no-op at zero', maxDiff(surgeField({ strength: 0 }), surgeField({ strength: 0, count: 6 })) === 0)

  // They are in the emulsion, so they must not appear on the paper border.
  const borderedSurge = (strength: number) =>
    readPixels(
      engine.render({
        base: makeFlatGrain(200, 200, 120),
        baseSize: { width: 200, height: 200 },
        grain: surgePlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.06,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          blendMode: 'linearLight',
          colorSpace: 'srgb',
          amount: 0.25,
          border: { ...DEFAULT_BORDER, width: 0.15, texture: 0, irregularity: 0, grain: 0.7 },
          effects: { ...DEFAULT_EFFECTS, surge: { ...DEFAULT_SURGE, strength, count: 4, width: 0.12, angle: 90, seed: 5 } },
        },
      }),
    )
  const paperStrip = (img: ImageData) => {
    let sq = 0
    let n = 0
    for (let y = 4; y < 16; y++) {
      for (let x = 40; x < img.width - 40; x++) {
        let sum = 0
        for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) sum += img.data[((y + j) * img.width + x + k) * 4]
        sq += (img.data[(y * img.width + x) * 4] - sum / 25) ** 2
        n++
      }
    }
    return Math.sqrt(sq / n)
  }
  check(
    'surge marks stay in the emulsion and off the paper',
    Math.abs(paperStrip(borderedSurge(1)) - paperStrip(borderedSurge(0))) < 0.35,
    `paper grain ${paperStrip(borderedSurge(0)).toFixed(2)} without, ${paperStrip(borderedSurge(1)).toFixed(2)} with`,
  )


  // --- per-channel response -------------------------------------------------
  // Read against overall brightness, grain lands equally in all three channels
  // and reads as neutral specks lying over the picture. Read against each
  // channel's own value — which is how three dye layers behave — it follows the
  // picture's colour instead. Measured on a colour negative reference, the
  // channels' grain peaked at 0.19 (blue), 0.31 (green) and 0.56 (red).
  const colourPatch = (() => {
    const d = new ImageData(160, 160)
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = 43        // a blue sky: dark in red, mid in green, brighter in blue
      d.data[i + 1] = 88
      d.data[i + 2] = 150
      d.data[i + 3] = 255
    }
    return d
  })()
  const channelSigmas = (mode: 'luminance' | 'channel') => {
    const out = readPixels(
      engine.render({
        base: colourPatch,
        baseSize: { width: 160, height: 160 },
        grain: surgePlate,
        grainSize: { width: 128, height: 128 },
        grainMean: 0.5,
        grainSd: 0.06,
        params: {
          ...DEFAULT_BLEND_PARAMS,
          blendMode: 'linearLight',
          colorSpace: 'srgb',
          amount: 0.35,
          responseMode: mode,
          layerSpread: 1,
          response: [
            { x: 0, y: 0.65 }, { x: 0.25, y: 0.92 }, { x: 0.42, y: 1 },
            { x: 0.62, y: 0.82 }, { x: 0.85, y: 0.46 }, { x: 1, y: 0.35 },
          ],
        },
      }),
    )
    const sigmas: number[] = []
    for (let k = 0; k < 3; k++) {
      let sq = 0
      let n = 0
      for (let y = 3; y < out.height - 3; y++) {
        for (let x = 3; x < out.width - 3; x++) {
          let acc = 0
          for (let j = -2; j <= 2; j++) for (let m = -2; m <= 2; m++) acc += out.data[((y + j) * out.width + x + m) * 4 + k]
          sq += (out.data[(y * out.width + x) * 4 + k] - acc / 25) ** 2
          n++
        }
      }
      sigmas.push(Math.sqrt(sq / n))
    }
    return sigmas
  }
  const byLuma = channelSigmas('luminance')
  const byChannel = channelSigmas('channel')
  const spreadRatio = (xs: number[]) => Math.max(...xs) / Math.max(1e-6, Math.min(...xs))
  check(
    'reading the curve per channel ties the grain to the picture colour',
    spreadRatio(byLuma) < 1.15 && spreadRatio(byChannel) > 1.25,
    `channel sigmas even at ${spreadRatio(byLuma).toFixed(2)}x by luminance, ${spreadRatio(byChannel).toFixed(2)}x per channel`,
  )
  check(
    'per-channel response is a no-op when the layers are not spread',
    spreadRatio(
      (() => {
        const flat = readPixels(
          engine.render({
            base: makeFlatGrain(120, 120, 128),
            baseSize: { width: 120, height: 120 },
            grain: surgePlate,
            grainSize: { width: 128, height: 128 },
            grainMean: 0.5,
            grainSd: 0.06,
            params: { ...DEFAULT_BLEND_PARAMS, blendMode: 'linearLight', colorSpace: 'srgb', amount: 0.3, responseMode: 'channel', layerSpread: 0 },
          }),
        )
        const s: number[] = []
        for (let k = 0; k < 3; k++) {
          let sq = 0
          let n = 0
          for (let y = 3; y < 117; y++) for (let x = 3; x < 117; x++) {
            let acc = 0
            for (let j = -2; j <= 2; j++) for (let m = -2; m <= 2; m++) acc += flat.data[((y + j) * 120 + x + m) * 4 + k]
            sq += (flat.data[(y * 120 + x) * 4 + k] - acc / 25) ** 2
            n++
          }
          s.push(Math.sqrt(sq / n))
        }
        return s
      })(),
    ) < 1.15,
  )

  // Plate handling. A scan is rarely centred on mid-grey, and every blend mode
  // here is neutral there, so an uncentred plate darkens the picture instead of
  // graining it. Measured on three real film plates: means of 100, 75 and 54
  // out of 255, which at overlay 50% pulled mid-grey down by 14, 27 and 38.
  const darkPlate = makeOffsetGrain(128, 0.21, 0.07)
  const darkStats = { mean: imageMean(darkPlate) / 255, sd: stdDev(darkPlate) / 255 }
  const onMidGrey = (plate: ImageData, stats: { mean: number; sd: number }, params: Partial<typeof DEFAULT_BLEND_PARAMS>) =>
    readPixels(
      engine.render({
        base: flatBase,
        baseSize,
        grain: plate,
        grainSize: { width: plate.width, height: plate.height },
        grainMean: stats.mean,
        grainSd: stats.sd,
        params: { ...DEFAULT_BLEND_PARAMS, blendMode: 'overlay', amount: 0.5, colorSpace: 'srgb', ...params },
      }),
    )

  const rawRender = onMidGrey(darkPlate, darkStats, { plateNormalise: 'off' })
  const centredRender = onMidGrey(darkPlate, darkStats, { plateNormalise: 'centre' })
  check(
    'an uncentred plate darkens the picture when left raw',
    imageMean(rawRender) < 118,
    `mid-grey 128 renders as ${imageMean(rawRender).toFixed(1)}`,
  )
  check(
    'centring a plate keeps mid-grey where it was',
    Math.abs(imageMean(centredRender) - 128) < 1.5,
    `mid-grey 128 renders as ${imageMean(centredRender).toFixed(1)}`,
  )
  check(
    'centring keeps the grain it is centring',
    Math.abs(stdDev(centredRender) - stdDev(rawRender)) < 1,
    `sigma ${stdDev(rawRender).toFixed(2)} raw vs ${stdDev(centredRender).toFixed(2)} centred`,
  )

  // 'match' should make plates of different contrast interchangeable.
  const weakPlate = makeOffsetGrain(128, 0.35, 0.03)
  const strongPlate = makeOffsetGrain(128, 0.62, 0.12)
  const weakStats = { mean: imageMean(weakPlate) / 255, sd: stdDev(weakPlate) / 255 }
  const strongStats = { mean: imageMean(strongPlate) / 255, sd: stdDev(strongPlate) / 255 }
  const spread = (mode: 'centre' | 'match') => {
    const a = stdDev(onMidGrey(weakPlate, weakStats, { plateNormalise: mode, amount: 1 }))
    const b = stdDev(onMidGrey(strongPlate, strongStats, { plateNormalise: mode, amount: 1 }))
    return Math.max(a, b) / Math.max(1e-6, Math.min(a, b))
  }
  check(
    'matching contrast makes plates interchangeable',
    spread('match') < 1.25 && spread('centre') > 2,
    `strength ratio ${spread('centre').toFixed(2)}x centred vs ${spread('match').toFixed(2)}x matched`,
  )

  // Flatten removes the plate's own density variation, not its grain.
  const mottledPlate = makeOffsetGrain(256, 0.3, 0.07, 0.06)
  const mottledStats = { mean: imageMean(mottledPlate) / 255, sd: stdDev(mottledPlate) / 255 }
  const flatOff = onMidGrey(mottledPlate, mottledStats, { plateFlatten: 0, amount: 1 })
  const flatOn = onMidGrey(mottledPlate, mottledStats, { plateFlatten: 1, amount: 1 })
  check(
    'flatten removes the plate density that tiles as blotches',
    lowFrequencyShare(flatOn) < lowFrequencyShare(flatOff) * 0.5,
    `low-frequency share ${(lowFrequencyShare(flatOff) * 100).toFixed(1)}% -> ${(lowFrequencyShare(flatOn) * 100).toFixed(1)}%`,
  )
  check(
    'flatten leaves the grain alone',
    Math.abs(stdDev(flatOn) - stdDev(flatOff)) < stdDev(flatOff) * 0.15,
    `sigma ${stdDev(flatOff).toFixed(2)} -> ${stdDev(flatOn).toFixed(2)}`,
  )


  // Scale must change how big the grain is, not how strong. Interpolated
  // sampling only lands on texel centres at exactly scale 1, so every other
  // scale used to lose about a third of the contrast — a cliff at 1.0 that
  // made the scale slider silently a strength slider too.
  const scalePlate = makeOffsetGrain(256, 0.5, 0.08)
  const scaleStats = { mean: imageMean(scalePlate) / 255, sd: stdDev(scalePlate) / 255 }
  const sigmaAtScale = (grainScale: number, plateSampling: 'smooth' | 'crisp') =>
    stdDev(onMidGrey(scalePlate, scaleStats, { grainScale, plateSampling, amount: 1, tiling: 'repeat' }))
  const scales = [0.9, 1, 1.25, 1.5, 2, 3]
  const spreadOf = (mode: 'smooth' | 'crisp') => {
    const values = scales.map((s) => sigmaAtScale(s, mode))
    return Math.max(...values) / Math.max(1e-6, Math.min(...values))
  }
  check(
    'crisp sampling keeps grain strength independent of scale',
    spreadOf('crisp') < 1.2 && spreadOf('smooth') > 1.3,
    `strength varies ${spreadOf('smooth').toFixed(2)}x across scales when interpolated, ${spreadOf('crisp').toFixed(2)}x when crisp`,
  )

  // Crisp, non-Gaussian grain must survive tiling. Blending four copies pulls
  // the distribution back toward Gaussian by the central limit theorem, so this
  // bounds how much clump definition the stochastic tiler is allowed to cost
  // relative to mirroring, which reproduces the plate exactly.
  const crispPlate = makeClumpyGrain(128)
  const tiledDefinition = (tiling: 'mirror' | 'stochastic') =>
    clumpDefinition(
      readPixels(
        engine.render({
          base: flatBase,
          baseSize,
          grain: crispPlate,
          grainSize: { width: 128, height: 128 },
          grainMean: 0.5,
          params: { ...DEFAULT_BLEND_PARAMS, tiling, amount: 1, blendMode: 'linearLight', colorSpace: 'srgb' },
        }),
      ),
    )
  const mirrorDefinition = tiledDefinition('mirror')
  const stochasticDefinition = tiledDefinition('stochastic')
  check(
    'stochastic tiling keeps crisp grain crisp',
    stochasticDefinition > mirrorDefinition * 0.9,
    `definition ${mirrorDefinition.toFixed(3)} mirrored vs ${stochasticDefinition.toFixed(3)} stochastic`,
  )

  // A plate that scans denser than mid-grey must not change the picture's
  // overall density when tiled stochastically: recombining copies around the
  // measured mean keeps the result on top of what plain tiling would give,
  // while assuming 0.5 lifts the whole frame.
  const densePlate = makeUnevenGrain(64, 64, 0.6)
  const densePlateMean = imageMean(densePlate) / 255
  const meanOf = (tiling: 'repeat' | 'stochastic', grainMean: number) =>
    imageMean(
      readPixels(
        engine.render({
          base: flatBase,
          baseSize,
          grain: densePlate,
          grainSize,
          grainMean,
          params: { ...DEFAULT_BLEND_PARAMS, tiling, amount: 0.25, blendMode: 'linearLight', colorSpace: 'srgb' },
        }),
      ),
    )
  const densityRepeat = meanOf('repeat', densePlateMean)
  const densityMeasured = meanOf('stochastic', densePlateMean)
  const densityAssumed = meanOf('stochastic', 0.5)
  check(
    'stochastic tiling preserves plate density',
    Math.abs(densityMeasured - densityRepeat) < 1,
    `repeat=${densityRepeat.toFixed(2)}, stochastic=${densityMeasured.toFixed(2)}`,
  )
  check(
    'measuring the plate mean is what preserves it',
    Math.abs(densityAssumed - densityRepeat) > 3 * Math.abs(densityMeasured - densityRepeat),
    `assuming 0.5 drifts by ${(densityAssumed - densityRepeat).toFixed(2)} codes`,
  )

  engine.dispose()
}



/**
 * Edge steepness at the transitions, as a high percentile of the neighbour
 * difference. The *mean* difference is the wrong measure for clumping: pushing
 * grain toward definite clumps flattens the plateau interiors, which drags the
 * mean down even as the edges between clumps get sharper.
 */
function edgeSteepness(img: ImageData, percentile = 0.95): number {
  const steps: number[] = []
  for (let y = 0; y < img.height; y++) {
    for (let x = 1; x < img.width; x++) {
      steps.push(Math.abs(img.data[(y * img.width + x) * 4] - img.data[(y * img.width + x - 1) * 4]))
    }
  }
  steps.sort((a, b) => a - b)
  return steps[Math.floor(steps.length * percentile)] / (stdDev(img) || 1)
}

/**
 * How two-level the field is. A Gaussian field sits at sqrt(2/pi) = 0.798; a
 * field of definite clumps with edges approaches 1.
 */
function clumpDefinition(img: ImageData): number {
  const mean = imageMean(img)
  let abs = 0
  let n = 0
  for (let i = 0; i < img.data.length; i += 4) {
    abs += Math.abs(img.data[i] - mean)
    n++
  }
  return abs / n / (stdDev(img) || 1)
}

/** Mean absolute difference between horizontally adjacent pixels. */
function localStep(img: ImageData): number {
  let sum = 0
  let count = 0
  for (let y = 0; y < img.height; y++) {
    for (let x = 1; x < img.width; x++) {
      sum += Math.abs(img.data[(y * img.width + x) * 4] - img.data[(y * img.width + x - 1) * 4])
      count++
    }
  }
  return sum / count
}

/**
 * Clump size, as the lag at which horizontal autocorrelation falls below half.
 * Bigger grain correlates further along the row.
 */
function clumpWidth(img: ImageData): number {
  const n = img.width
  const mean = imageMean(img)
  let variance = 0
  for (let i = 0; i < img.data.length; i += 4) variance += (img.data[i] - mean) ** 2
  variance /= img.width * img.height
  for (let lag = 1; lag < 24; lag++) {
    let cov = 0
    let count = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x + lag < n; x++) {
        cov += (img.data[(y * n + x) * 4] - mean) * (img.data[(y * n + x + lag) * 4] - mean)
        count++
      }
    }
    if (cov / count / variance < 0.5) return lag
  }
  return 24
}

function runGeneratorTests() {
  // A fine, mildly clumped baseline so each control's effect is measured in
  // isolation. The app default is heavily clumped, which would swamp them.
  const params = {
    ...DEFAULT_PROCEDURAL_PARAMS,
    size: 256,
    grainSize: 0.4,
    contrast: 0.33,
    clumps: 0.35,
    unevenness: 0.12,
    chroma: 0,
    seed: 99,
  }
  const plate = generateGrainPlate(params)
  check('generator returns the requested size', plate.width === 256 && plate.height === 256)

  const again = generateGrainPlate(params)
  check('generation is deterministic for a seed', maxDiff(plate, again) === 0)

  const other = generateGrainPlate({ ...params, seed: 100 })
  check('a different seed gives different grain', maxDiff(plate, other) > 10)

  const mean = imageMean(plate)
  check('generated grain centres on mid-grey', Math.abs(mean - 127.5) < 2, `mean=${mean.toFixed(2)}`)

  // Tileable by construction: the wrap-around edge must be no more abrupt than
  // any interior column, or the tiler would have a seam to hide.
  const n = plate.width
  const colStep = (x: number) => {
    let sum = 0
    for (let y = 0; y < n; y++) {
      const a = (y * n + x) * 4
      const b = (y * n + ((x - 1 + n) % n)) * 4
      sum += Math.abs(plate.data[a] - plate.data[b])
    }
    return sum / n
  }
  let interior = 0
  for (let x = 1; x < n; x++) interior += colStep(x)
  interior /= n - 1
  const wrap = colStep(0)
  check('generated plate wraps seamlessly', wrap < interior * 1.25, `wrap=${wrap.toFixed(2)}, interior=${interior.toFixed(2)}`)

  const unfiltered = generateGrainPlate({ ...params, grainSize: 0, roughness: 0 })
  const clumped = generateGrainPlate({ ...params, grainSize: 3, roughness: 0 })
  const localStepOf = (img: ImageData) => {
    let sum = 0
    let count = 0
    for (let y = 0; y < img.height; y++) {
      for (let x = 1; x < img.width; x++) {
        sum += Math.abs(img.data[(y * img.width + x) * 4] - img.data[(y * img.width + x - 1) * 4])
        count++
      }
    }
    return sum / count
  }
  check(
    'grain size 0 leaves the noise unfiltered',
    localStepOf(unfiltered) > localStepOf(clumped) * 3,
    `step ${localStepOf(unfiltered).toFixed(1)} vs ${localStepOf(clumped).toFixed(1)}`,
  )



  // Unevenness must put large-scale variation back into synthesised grain,
  // landing in the range measured on real film plates (0.8%, 4.6% and 6.2% of
  // variance below the grain frequencies for gold, lomography and rollei).
  const evenPlate = generateGrainPlate({ ...params, size: 512, unevenness: 0, roughness: 0 })
  const unevenPlate = generateGrainPlate({ ...params, size: 512, unevenness: 1, roughness: 0 })
  const evenShare = lowFrequencyShare(evenPlate)
  const unevenShare = lowFrequencyShare(unevenPlate)
  check(
    'unevenness adds the large-scale variation real film has',
    unevenShare > evenShare * 1.8 && unevenShare < 0.12,
    `low-frequency share ${(evenShare * 100).toFixed(1)}% -> ${(unevenShare * 100).toFixed(1)}% (film measures 0.8-6.2%)`,
  )
  check(
    'unevenness does not change overall grain contrast',
    Math.abs(stdDev(unevenPlate) - stdDev(evenPlate)) < stdDev(evenPlate) * 0.12,
    `sigma ${stdDev(evenPlate).toFixed(1)} -> ${stdDev(unevenPlate).toFixed(1)}`,
  )

  // Grain size must be continuous. It used to round to an integer blur radius,
  // so the first step above "fine" jumped straight to a radius-1 triple box —
  // there was no gradual path from the finest grain to a slightly larger one.
  const sweep = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.3, 1.6, 2]
  const steps = sweep.map((g) => localStep(generateGrainPlate({ ...params, grainSize: g, roughness: 0, hardness: 0 })))
  let worstJump = 1
  let worstAt = ''
  for (let i = 1; i < steps.length; i++) {
    const ratio = Math.max(steps[i], steps[i - 1]) / Math.max(1e-6, Math.min(steps[i], steps[i - 1]))
    if (ratio > worstJump) {
      worstJump = ratio
      worstAt = `${sweep[i - 1]}→${sweep[i]}`
    }
  }
  check(
    'grain size is continuous across its range',
    worstJump < 1.8,
    `largest jump ${worstJump.toFixed(2)}x at ${worstAt}`,
  )

  // ...and monotone: every increase in size must soften the local detail.
  const monotone = steps.every((v, i) => i === 0 || v <= steps[i - 1] + 0.5)
  check('larger grain size always means larger clumps', monotone, steps.map((v) => v.toFixed(1)).join(' '))

  // Hardness must crisp up the clump edges without changing the clump size —
  // that is what makes big grain look like grain rather than mush.
  const soft = generateGrainPlate({ ...params, grainSize: 2.5, roughness: 0, hardness: 0 })
  const crisp = generateGrainPlate({ ...params, grainSize: 2.5, roughness: 0, hardness: 0.9 })
  check(
    'hardness sharpens the clump edges',
    edgeSteepness(crisp) > edgeSteepness(soft) * 1.5,
    `95th-percentile edge ${edgeSteepness(soft).toFixed(2)} -> ${edgeSteepness(crisp).toFixed(2)} sigma`,
  )
  check(
    'hardness turns the field into definite clumps',
    clumpDefinition(soft) < 0.85 && clumpDefinition(crisp) > 0.93,
    `mean|x|/sigma ${clumpDefinition(soft).toFixed(3)} -> ${clumpDefinition(crisp).toFixed(3)} (Gaussian is 0.798)`,
  )
  const widthSoft = clumpWidth(soft)
  const widthCrisp = clumpWidth(crisp)
  check(
    'hardness leaves the clump size alone',
    Math.abs(widthCrisp - widthSoft) <= Math.max(1, widthSoft * 0.3),
    `clump width ${widthSoft} -> ${widthCrisp} px`,
  )
  check(
    'bigger grain size really is bigger',
    clumpWidth(generateGrainPlate({ ...params, grainSize: 3, roughness: 0, hardness: 0.6 })) >
      clumpWidth(generateGrainPlate({ ...params, grainSize: 0.6, roughness: 0, hardness: 0.6 })),
    `${clumpWidth(generateGrainPlate({ ...params, grainSize: 0.6, roughness: 0, hardness: 0.6 }))}px -> ${clumpWidth(generateGrainPlate({ ...params, grainSize: 3, roughness: 0, hardness: 0.6 }))}px`,
  )

  // Definition: big grain keeps a crisp edge — steeper steps between
  // neighbours — without collapsing to two levels the way Hardness does.
  const softBig = generateGrainPlate({ ...params, grainSize: 2.5, roughness: 0, hardness: 0, clumps: 0 })
  const definedBig = generateGrainPlate({ ...params, grainSize: 2.5, roughness: 0, hardness: 0, clumps: 0, definition: 1 })
  const levels = (img: ImageData) => new Set(Array.from({ length: img.width * img.height }, (_, i) => img.data[i * 4])).size
  // A defined grain spends less of its area in the mid-grey transition
  // between inside and outside: fewer pixels near the mean, in units of sd.
  const mush = (img: ImageData) => {
    const mean = imageMean(img)
    const sd = stdDev(img)
    let near = 0
    for (let i = 0; i < img.data.length; i += 4) if (Math.abs(img.data[i] - mean) < 0.3 * sd) near++
    return near / (img.data.length / 4)
  }
  check(
    'definition sharpens big grain without making it two-level',
    mush(definedBig) < mush(softBig) * 0.85 && levels(definedBig) > 40,
    `mid-grey share ${(mush(softBig) * 100).toFixed(0)}% -> ${(mush(definedBig) * 100).toFixed(0)}%, ${levels(definedBig)} levels`,
  )

  const lowContrast = stdDev(generateGrainPlate({ ...params, contrast: 0.2 }))
  const highContrast = stdDev(generateGrainPlate({ ...params, contrast: 0.9 }))
  check(
    'contrast control scales grain contrast',
    highContrast > lowContrast * 2,
    `σ ${lowContrast.toFixed(1)} -> ${highContrast.toFixed(1)}`,
  )

  const fine = stdDev(generateGrainPlate({ ...params, grainSize: 0.5, roughness: 0 }))
  const coarsePlate = generateGrainPlate({ ...params, grainSize: 4, roughness: 0 })
  // Coarser grain means neighbouring pixels are more alike, whatever the
  // overall contrast, so measure local difference rather than spread.
  check(
    'grain size control changes clump size',
    localStep(coarsePlate) < localStep(generateGrainPlate({ ...params, grainSize: 0.5, roughness: 0 })),
    `fine σ=${fine.toFixed(1)}, coarse step=${localStep(coarsePlate).toFixed(2)}`,
  )

  const grey = generateGrainPlate({ ...params, chroma: 0 })
  let greySpread = 0
  for (let i = 0; i < grey.data.length; i += 4) {
    greySpread = Math.max(greySpread, Math.abs(grey.data[i] - grey.data[i + 2]))
  }
  check('chroma=0 generates neutral grain', greySpread === 0)

  const colour = generateGrainPlate({ ...params, chroma: 1 })
  let colourSpread = 0
  for (let i = 0; i < colour.data.length; i += 4) {
    colourSpread = Math.max(colourSpread, Math.abs(colour.data[i] - colour.data[i + 2]))
  }
  check('chroma=1 generates independent channels', colourSpread > 10, `max spread=${colourSpread}`)
}

function runColourRecipeTests() {
  const sunset = { light: [1, 0.55, 0.25], shadow: [0.3, 0.35, 1], accent: [1, 0.4, 0.15], vivid: [1, 0.3, 0.1], range: [0, 1] } as const
  const overcast = { light: [0.95, 0.97, 1], shadow: [0.6, 0.7, 1], accent: [0.4, 0.6, 1], vivid: [0.2, 0.7, 0.4], range: [0, 1] } as const
  const pal = (p: typeof sunset | typeof overcast) => ({ light: [...p.light], shadow: [...p.shadow], accent: [...p.accent], vivid: [...p.vivid], range: [...p.range] }) as unknown as Parameters<typeof ruleColours>[1]
  const rule: ColourRule = { from: 'light', harmony: 'complementary', lead: 2, turn: 0, richness: 1 }
  const a = ruleColours(rule, pal(sunset))
  const b = ruleColours(rule, pal(overcast))
  const diff = a.reduce((sum, c, i) => sum + Math.abs(c[0] - b[i][0]) + Math.abs(c[1] - b[i][1]) + Math.abs(c[2] - b[i][2]), 0)
  check('a recipe builds different colours from different photos', diff > 0.3, diff.toFixed(3))
  const ok = (c: number[]) => c.every((v) => Number.isFinite(v) && v >= 0 && v <= 1)
  check('every built-in recipe makes valid colours on both photos', BUILT_IN_RECIPES.every((r) => [...ruleColours(r.rule, pal(sunset)), ...ruleColours(r.rule, pal(overcast))].every(ok)))
  const fixed = ruleColours({ ...rule, from: 'fixed', fixed: [0.2, 0.8, 0.4] }, pal(sunset))
  const fixed2 = ruleColours({ ...rule, from: 'fixed', fixed: [0.2, 0.8, 0.4] }, pal(overcast))
  check('a fixed recipe is the same on every photo', fixed.every((c, i) => c.every((v, j) => Math.abs(v - fixed2[i][j]) < 1e-9)))
  const blend = { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, grade: { ...DEFAULT_GRADE, mapAmount: 0.7, recipe: rule } } }
  const r1 = resolveParams(blend, pal(sunset)).effects.grade
  const r2 = resolveParams(blend, pal(overcast)).effects.grade
  check('rendering resolves a recipe against each photo', JSON.stringify(r1.mapHigh) !== JSON.stringify(r2.mapHigh) && r1.mapHigh.source === 'manual')
  const doc = parsePreset(JSON.parse(JSON.stringify({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'r', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend, output: {} })))
  check('a recipe survives saving and loading a look', JSON.stringify(doc.blend.effects.grade.recipe) === JSON.stringify(rule))
  const bad = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'r', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...blend, effects: { ...blend.effects, grade: { ...blend.effects.grade, recipe: { from: 'nope', lead: 7, turn: 9, richness: -1 } } } }, output: {} })
  const br = bad.blend.effects.grade.recipe!
  check('a damaged recipe is read back as a valid one', br.from === 'light' && br.lead === 2 && br.turn === 0.5 && br.richness === 0)
  const manual = mergeGrade(blend.effects.grade, { mapHigh: { source: 'manual', colour: [1, 0, 0] } })
  const kept = mergeGrade(blend.effects.grade, { mapAmount: 0.3 })
  check('setting a palette colour by hand lets go of the recipe; other changes keep it', !manual.recipe && !!kept.recipe)
  // Dragging the wheel with a recipe in use reshapes the recipe: it rebuilds the palette the wheel was dragged to.
  let worst = 0
  for (const p of [pal(sunset), pal(overcast)])
    for (const to of [{ hue: 0.6, sat: 0.5 }, { hue: 0.05, sat: 0.8 }, { hue: 0.33, sat: 0.2 }])
      for (const i of [0, 1, 2]) {
        const dragged = toneColours(guidedMove('split', i, to).points)
        const got = ruleColours(ruleMatching(rule, p, dragged, 'split'), p).map(wheelPoint)
        for (const q of dragged.map(wheelPoint)) {
          const gap = Math.min(...got.map((g) => { const dh = Math.abs(g.hue - q.hue) % 1; return Math.min(dh, 1 - dh) * q.sat + Math.abs(g.sat - q.sat) }))
          worst = Math.max(worst, gap)
        }
      }
  check('dragging the wheel on a recipe moves the recipe to where it was dragged', worst < 0.02, worst.toFixed(4))
}

function runNewModuleTests() {
  // Every new module's settings survive a save and load, and damaged ones are read back valid.
  const fx = {
    ...DEFAULT_EFFECTS,
    base: { ...DEFAULT_EFFECTS.base, exposure: 0.7, temperature: -0.3, curve: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }] },
    mono: { ...DEFAULT_EFFECTS.mono, enabled: true, filter: 'red' as const },
    halftone: { ...DEFAULT_EFFECTS.halftone, enabled: true, style: 'riso' as const },
    lens: { ...DEFAULT_EFFECTS.lens, enabled: true, distortion: 0.4 },
    double: { ...DEFAULT_EFFECTS.double, enabled: true, image: 'img_abc', mode: 'lighten' as const },
    stamp: { ...DEFAULT_EFFECTS.stamp, enabled: true, date: '1998-06-22', corner: 'tl' as const },
  }
  const blend = { ...DEFAULT_BLEND_PARAMS, effects: fx }
  const doc = parsePreset(JSON.parse(JSON.stringify({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'n', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend, output: {} })))
  const e = doc.blend.effects
  check(
    'the new modules survive saving and loading',
    e.base.exposure === 0.7 && e.base.curve.length === 3 && e.mono.filter === 'red' && e.halftone.style === 'riso' && e.lens.distortion === 0.4 && e.double.mode === 'lighten' && e.stamp.date === '1998-06-22',
  )
  const bad = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'b', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...blend, effects: { ...fx, base: { exposure: 99, curve: 'x' }, mono: { filter: 'purple' }, stamp: { date: 'yesterday', size: 5 } } }, output: {} })
  check('damaged new settings are read back valid', bad.blend.effects.base.exposure === 4 && bad.blend.effects.base.curve.length === 2 && bad.blend.effects.mono.filter === 'none' && bad.blend.effects.stamp.date === '' && bad.blend.effects.stamp.size === 0.12)
  check(
    "the stamp prints the photo's date as each camera would",
    stampText(fx.stamp) === '06/22/1998' &&
      stampText({ ...fx.stamp, date: '1998-06-22 15:07', format: 'mm/dd/yyyy-time' }) === '06/22/1998 3:07' &&
      // A date back leaves a blank slot where a leading zero would be.
      stampText({ ...fx.stamp, theme: 'film', format: 'yy-mm-dd', date: '1998-06-04' }) === "'98 _6 _4",
    stampText({ ...fx.stamp, theme: 'film', format: 'yy-mm-dd', date: '1998-06-04' }),
  )
  check('both stamp themes draw', (['digicam', 'film'] as const).every((t) => !!drawStamp(t === 'film' ? "'98 _6 _4" : '06/22/1998', 24, t)))
  const old = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'o', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...blend, effects: { ...fx, stamp: { enabled: true, format: 'yy-mm-dd' } } }, output: {} })
  check('a stamp from before themes stays a film date back', old.blend.effects.stamp.theme === 'film')
  // A look never carries one photo's corrections, second photo or date to another.
  const other = { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, stamp: { ...DEFAULT_EFFECTS.stamp, date: '2026-11-07' } } }
  const kept = withPlaced(other, blend)
  check("applying a look keeps the photo's own base, second exposure and date", kept.effects.base.exposure === 0 && kept.effects.double.image === null && kept.effects.stamp.date === '2026-11-07' && kept.effects.mono.filter === 'red')
  // The tone curve is smooth and passes through its points.
  const c = fx.base.curve
  check('the base curve passes through its points', c.every((p) => Math.abs(evaluateToneCurve(c, p.x) - p.y) < 1e-6))
  // Auto white balance greys a grey photo lit warm.
  const px = new Uint8ClampedArray(64 * 4)
  for (let i = 0; i < 64; i++) px.set([200, 160, 120, 255], i * 4)
  const auto = autoBase(px)
  const n = neutralise([200 / 255, 160 / 255, 120 / 255])
  check('auto white balance cools a warm cast', auto.temperature < 0 && n.temperature < 0, `${auto.temperature} ${n.temperature}`)
}

/** The passes laid into the photo before the look: base corrections, a second exposure, the lens, the date. */
async function runPrepareTests() {
  const W = 120
  const H = 80
  const engine = new GrainEngine()
  const base = makeBase(W, H)
  const flat = makeFlatGrain(64, 64)
  const render = (effects: Partial<typeof DEFAULT_EFFECTS>) =>
    readPixels(
      engine.render({
        base,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, ...effects } },
      }),
    )
  const mean = (d: ImageData) => {
    let s = 0
    for (let i = 0; i < d.data.length; i += 4) s += d.data[i] + d.data[i + 1] + d.data[i + 2]
    return s / ((d.data.length / 4) * 3)
  }
  const plain = render({})
  check('base corrections at rest change nothing', maxDiff(render({ base: { ...DEFAULT_EFFECTS.base, lightOn: true, colourOn: true } }), plain) <= 1)
  const brighter = render({ base: { ...DEFAULT_EFFECTS.base, exposure: 1 } })
  check('base exposure up brightens the photo', mean(brighter) > mean(plain) + 10, `${mean(brighter).toFixed(1)} vs ${mean(plain).toFixed(1)}`)
  const warm = render({ base: { ...DEFAULT_EFFECTS.base, temperature: 0.6 } })
  const rb = (d: ImageData) => {
    let r = 0
    let b = 0
    for (let i = 0; i < d.data.length; i += 4) {
      r += d.data[i]
      b += d.data[i + 2]
    }
    return r - b
  }
  check('base temperature warms the photo', rb(warm) > rb(plain))
  check('the lens bends the photo', maxDiff(render({ lens: { ...DEFAULT_EFFECTS.lens, enabled: true, distortion: 0.9 } }), plain) > 20)
  const stamped = render({ stamp: { ...DEFAULT_EFFECTS.stamp, enabled: true, date: '1998-06-22', size: 0.1 } })
  check('the date stamp prints in its corner, and only there', maxDiff(stamped, plain) > 40 && (() => {
    // The top-left quarter is untouched with the stamp bottom right.
    for (let y = 0; y < H / 2; y++)
      for (let x = 0; x < W / 2; x++) {
        const i = (y * W + x) * 4
        if (Math.abs(stamped.data[i] - plain.data[i]) > 1) return false
      }
    return true
  })())
  const mono = render({ mono: { ...DEFAULT_EFFECTS.mono, enabled: true } })
  let grey = 0
  for (let i = 0; i < mono.data.length; i += 4) grey = Math.max(grey, Math.abs(mono.data[i] - mono.data[i + 1]), Math.abs(mono.data[i + 1] - mono.data[i + 2]))
  check('black & white has no colour left', grey <= 2, `max channel gap ${grey}`)
  check('halftone screens the photo', maxDiff(render({ halftone: { ...DEFAULT_EFFECTS.halftone, enabled: true, style: 'riso' } }), plain) > 40)
  // A second exposure, its image handed straight to the engine (the library is the app's).
  const second = new ImageData(60, 40)
  for (let i = 0; i < second.data.length; i += 4) second.data.set([230, 230, 230, 255], i)
  const bitmap = await createImageBitmap(second)
  setCollageImageLookup((id) => (id === 'img_test' ? { id, name: 'test', bitmap, thumb: '', luma: { width: 1, height: 1, data: new Float32Array(1) } } : collageImageNow(id)))
  const doubled = render({ double: { ...DEFAULT_EFFECTS.double, enabled: true, image: 'img_test', mode: 'screen', amount: 1 } })
  setCollageImageLookup(collageImageNow)
  check('a second exposure adds its light to the photo', mean(doubled) > mean(plain) + 20, `${mean(doubled).toFixed(1)} vs ${mean(plain).toFixed(1)}`)
}

/** Radial and gradient masks, worked out exactly, and masks switched off. */
async function runShapeMaskTests() {
  const W = 120
  const H = 80
  const engine = new GrainEngine()
  const base = new ImageData(W, H)
  for (let i = 0; i < base.data.length; i += 4) base.data.set([110, 110, 110, 255], i)
  const flat = makeFlatGrain(64, 64)
  const render = (effects: Partial<typeof DEFAULT_EFFECTS>) =>
    readPixels(
      engine.render({
        base,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, exposure: 1.2, ...effects } },
      }),
    )
  const at = (d: ImageData, x: number, y: number) => d.data[(Math.round(y) * W + Math.round(x)) * 4]
  const outline = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
  const radial = { ...DEFAULT_MASK, id: 'r', name: 'R', kind: 'radial' as const, radial: { x: 0.5, y: 0.5, rx: 0.3, ry: 0.3, angle: 0, soft: 0.3 }, outline }
  const only = (id: string) => ({ tone: { ids: [id], mode: 'only' as const } })
  const r = render({ masks: [radial], maskUse: only('r') })
  check('a radial mask applies in its middle and not past its edge', at(r, 60, 40) > at(r, 5, 5) + 40, `${at(r, 60, 40)} vs ${at(r, 5, 5)}`)
  const gradient = { ...DEFAULT_MASK, id: 'g', name: 'G', kind: 'gradient' as const, gradient: { x0: 0.5, y0: 0, x1: 0.5, y1: 1 }, outline }
  const g = render({ masks: [gradient], maskUse: only('g') })
  check('a gradient mask fades from its start to its end', at(g, 60, 3) > at(g, 60, 40) && at(g, 60, 40) > at(g, 60, 77), `${at(g, 60, 3)} ${at(g, 60, 40)} ${at(g, 60, 77)}`)
  const off = render({ masks: [{ ...radial, enabled: false }], maskUse: only('r') })
  const none = render({})
  check('a mask switched off holds nothing back', maxDiff(off, none) <= 1, `max ${maxDiff(off, none)}`)
  const doc = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'm', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, masks: [radial, { ...gradient, enabled: false }] } }, output: {} })
  const [pr, pg] = doc.blend.effects.masks
  check('radial and gradient masks survive saving and loading', pr.kind === 'radial' && pr.radial?.rx === 0.3 && pg.kind === 'gradient' && pg.gradient?.y1 === 1 && pg.enabled === false)
  // A selected subject in two pieces with a gap between: kept as the selection
  // itself, so the gap stays out and nothing joins the pieces.
  const gw = 60
  const gh = 40
  const grid = new Uint8Array(gw * gh)
  for (let y = 5; y < 35; y++) for (let x = 0; x < gw; x++) if (x < 20 || x >= 40) grid[y * gw + x] = 1
  const runs = encodeRaster(grid, gw, gh)
  const back = decodeRaster({ w: gw, h: gh, runs })
  check('a subject selection is stored and read back exactly', back.every((v, i) => v === grid[i]), `${runs.length} characters`)
  const subject = {
    ...DEFAULT_MASK,
    id: 's',
    name: 'S',
    outline: [{ x: 0, y: 0.125 }, { x: 1, y: 0.125 }, { x: 1, y: 0.875 }, { x: 0, y: 0.875 }],
    raster: { w: gw, h: gh, runs, x: 0, y: 0, width: 1, height: 1 },
  }
  const sr = render({ masks: [subject], maskUse: only('s') })
  check(
    'a subject mask covers its pieces and leaves the gap between them alone',
    Math.abs(at(sr, 15, 40) - at(none, 15, 40)) <= 2 && Math.abs(at(sr, 105, 40) - at(none, 105, 40)) <= 2 && Math.abs(at(sr, 60, 40) - 110) <= 2,
    `left ${at(sr, 15, 40)} gap ${at(sr, 60, 40)} (photo 110) right ${at(sr, 105, 40)} (edited ${at(none, 60, 40)})`,
  )
  const ds = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'm', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, masks: [subject] } }, output: {} })
  check('a subject mask survives saving and loading', ds.blend.effects.masks[0].raster?.runs === runs)
  // Matched to the photo at its edge: a selection stopping short of the
  // subject's real edge (dark to x 66, light past it; the selection to x 60)
  // takes the photo's edge within its band, and stays solid well inside.
  const split = new ImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) split.data.set(x < 66 ? [60, 60, 60, 255] : [200, 200, 200, 255], (y * W + x) * 4)
  const sg = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < 60; x++) sg[y * W + x] = 1
  const short = { ...DEFAULT_MASK, id: 'k', name: 'K', outline: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }], raster: { w: W, h: H, runs: encodeRaster(sg, W, H), x: 0, y: 0, width: 1, height: 1 } }
  const renderOn = (masks: (typeof short)[]) =>
    readPixels(
      engine.render({
        base: split,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, exposure: 1.2, masks, maskUse: only('k') } },
      }),
    )
  const plain = renderOn([short])
  const matched = renderOn([{ ...short, key: 'darker', keyOn: 'brightness', keyLevel: 0.5, keySoftness: 0.02, keyAt: 'edge', keyBand: 0.15 }])
  const photoAt = (x: number) => (x < 66 ? 60 : 200)
  check(
    'a selection matched to the photo at its edge reaches the real edge and stops there',
    at(plain, 63, 40) <= photoAt(63) + 2 && at(matched, 63, 40) > photoAt(63) + 20 && Math.abs(at(matched, 72, 40) - photoAt(72)) <= 2 && at(matched, 20, 40) > photoAt(20) + 20,
    `inside ${at(matched, 20, 40)}, past the selection ${at(plain, 63, 40)} → ${at(matched, 63, 40)}, past the photo's edge ${at(matched, 72, 40)} (photo ${photoAt(63)} / ${photoAt(72)})`,
  )
  // Painted by hand: out always wins; in adds, or with the mask matched, lets the photo decide.
  const band = (x0: number, x1: number) => {
    const g = new Uint8Array(W * H)
    for (let y = 0; y < H; y++) for (let x = x0; x < x1; x++) g[y * W + x] = 1
    return encodeRaster(g, W, H)
  }
  const paintedRaster = { ...short.raster, paintOut: band(20, 30), paintIn: band(90, 100) }
  // Its outline takes in what was painted, as the brush leaves it (ui/maskBrush.ts).
  const painted = { ...short, raster: paintedRaster, outline: rasterOutline(paintedRaster) }
  const pp = renderOn([painted])
  const pm = renderOn([{ ...painted, key: 'darker', keyOn: 'brightness', keyLevel: 0.5, keySoftness: 0.02, keyAt: 'edge', keyBand: 0.02 }])
  check(
    'painting a selection: out always wins, in adds, and with the mask matched the photo decides where it was painted in',
    Math.abs(at(pp, 25, 40) - 60) <= 2 && at(pp, 95, 40) > 202 && Math.abs(at(pm, 25, 40) - 60) <= 2 && Math.abs(at(pm, 95, 40) - 200) <= 2 && at(pm, 10, 40) > 80,
    `painted out ${at(pp, 25, 40)} / ${at(pm, 25, 40)} (photo 60), painted in ${at(pp, 95, 40)} / matched ${at(pm, 95, 40)} (photo 200), selected ${at(pm, 10, 40)}`,
  )
  // Brushed in plainly (the brush's usual way): in, even where the match says out.
  const sureRaster = { ...short.raster, paintSure: band(90, 100) }
  const ps = renderOn([{ ...short, raster: sureRaster, outline: rasterOutline(sureRaster), key: 'darker', keyOn: 'brightness', keyLevel: 0.5, keySoftness: 0.02, keyAt: 'edge', keyBand: 0.02 }])
  check('brushed in plainly is in, even on a mask matched to the photo', at(ps, 95, 40) > 202, `brushed ${at(ps, 95, 40)} (photo 200)`)
  // Repeat: a piece cut out by a mask, copied up the photo, before the edit.
  const scene2 = new ImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) scene2.data.set(x >= 50 && x < 70 && y >= 60 && y < 75 ? [220, 40, 40, 255] : [60, 60, 60, 255], (y * W + x) * 4)
  const box = { ...DEFAULT_MASK, id: 'p', name: 'P', outline: [{ x: 48 / W, y: 58 / H }, { x: 72 / W, y: 58 / H }, { x: 72 / W, y: 77 / H }, { x: 48 / W, y: 77 / H }] }
  const renderRep = (repeat: Partial<RepeatParams>) =>
    readPixels(
      engine.render({
        base: scene2,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, masks: [box], repeat: { enabled: true, items: [{ ...DEFAULT_REPEAT, opacity: [1, 1], enabled: true, source: 'p', ...repeat }] } } },
      }),
    )
  const red = (d: ImageData, x: number, y: number) => d.data[(y * W + x) * 4] - d.data[(y * W + x) * 4 + 1]
  const up2 = renderRep({ layout: 'grid', across: 0, up: 2, gapY: 0 })
  const placed = renderRep({ layout: 'placed', placed: [{ x: 20 / W, y: 20 / H }] })
  const repOff = renderRep({ enabled: false, up: 2 })
  check(
    'Repeat copies a masked piece up the photo, or where it is placed, and nothing when off',
    red(up2, 60, 67) > 100 && red(up2, 60, 48) > 100 && red(up2, 60, 28) > 100 && red(up2, 60, 10) < 20 && red(placed, 20, 20) > 100 && red(repOff, 60, 48) < 20,
    `piece ${red(up2, 60, 67)}, copies ${red(up2, 60, 48)} / ${red(up2, 60, 28)}, past them ${red(up2, 60, 10)}, placed ${red(placed, 20, 20)}, off ${red(repOff, 60, 48)}`,
  )
  const keptRepeat = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'm', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, masks: [box], repeat: { ...DEFAULT_REPEAT, enabled: true, source: 'p', layout: 'path', path: [{ x: 0.1, y: 0.2 }, { x: 0.5, y: 0.6 }], count: 7 } } }, output: {} })
  // (Saved as the one Repeat of before there was a list: it becomes the list's one repeat.)
  const kr = keptRepeat.blend.effects.repeat
  const kr0 = kr?.items[0]
  check('Repeat from before there was a list loads as its one repeat', kr?.enabled === true && kr.items.length === 1 && kr0?.enabled === true && kr0.source === 'p' && kr0.layout === 'path' && kr0.path.length === 2 && kr0.count === 7)
  // Two repeats: both in the photo, each its own piece, saved and loaded.
  // (The same square, a mask of its own: the second repeat's piece.)
  const box2 = { ...box, id: 'q' }
  const two = readPixels(
    engine.render({
      base: scene2,
      baseSize: { width: W, height: H },
      grain: flat,
      grainSize: { width: 64, height: 64 },
      params: {
        ...DEFAULT_BLEND_PARAMS,
        amount: 0,
        effects: {
          ...DEFAULT_EFFECTS,
          masks: [box, box2],
          repeat: { enabled: true, items: [{ ...DEFAULT_REPEAT, opacity: [1, 1], enabled: true, source: 'p', up: 2, across: 0 }, { ...DEFAULT_REPEAT, opacity: [1, 1], enabled: true, source: 'q', layout: 'placed', placed: [{ x: 20 / W, y: 20 / H }] }] },
        },
      },
    }),
  )
  const keptTwo = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'm', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, masks: [box, box2], repeat: { enabled: true, items: [{ ...DEFAULT_REPEAT, id: 'a', enabled: true, source: 'p' }, { ...DEFAULT_REPEAT, id: 'b', enabled: false, source: 'q', layout: 'placed', placed: [{ x: 0.2, y: 0.2 }] }] } } }, output: {} }).blend.effects.repeat
  check(
    'Two repeats each copy their own piece, and both are kept, the second switched off',
    red(two, 60, 48) > 100 && red(two, 20, 20) > 100 && keptTwo?.items.length === 2 && keptTwo.items[0].id === 'a' && keptTwo.items[0].enabled && keptTwo.items[1].enabled === false && keptTwo.items[1].placed.length === 1,
    `first's copy ${red(two, 60, 48)}, second's placed ${red(two, 20, 20)}, kept ${JSON.stringify(keptTwo?.items.map((r) => [r.id, r.enabled, r.source]))}`,
  )
  // Perspective from lines: where lines meet, the streak angle and
  // perspective that run through that point, and lines found in a picture.
  {
    const vp = { x: 0.6, y: -0.5 }
    const through = (x: number, y: number) => ({ a: { x, y }, b: { x: vp.x + (x - vp.x) * 0.5, y: vp.y + (y - vp.y) * 0.5 } })
    const met = meetingPoint([through(0.2, 1), through(1.0, 1), through(0.5, 0.8)])
    const sp = streakPerspective([through(0.2, 1), through(1.0, 1)], { x: 0.6, y: 0.5 }, { x: 0, y: -1 })
    check(
      'guides meet where their lines do, and the streak runs up through that point',
      !!met && Math.hypot(met.x - vp.x, met.y - vp.y) < 1e-6 && !!sp && Math.abs(sp.angle + 90) < 0.01 && Math.abs(sp.converge - 1) < 1e-6,
      `met ${met && `${met.x.toFixed(3)},${met.y.toFixed(3)}`}, angle ${sp?.angle.toFixed(2)}, converge ${sp?.converge.toFixed(3)}`,
    )
    // Two dark lines on light, leaning toward a point above the picture.
    const gw = 200
    const gh = 200
    const grey = new Float32Array(gw * gh).fill(0.85)
    const top = { x: 100, y: -300 }
    for (const x0 of [40, 160])
      for (let y = 20; y < 200; y++) {
        const x = top.x + ((x0 - top.x) * (y - top.y)) / (200 - top.y)
        // Drawn smooth, as a photo's edges are: stepped, its edges would be little upright stairs.
        for (let xi = Math.floor(x) - 4; xi <= Math.ceil(x) + 4; xi++) {
          if (xi < 0 || xi >= gw) continue
          const cover = Math.min(1, Math.max(0, 3 - Math.abs(xi + 0.5 - x)))
          grey[y * gw + xi] = Math.min(grey[y * gw + xi], 0.85 - 0.7 * cover)
        }
      }
    const all = findLines(grey, gw, gh, { x0: 0, y0: 0, x1: gw, y1: gh }, -Math.PI / 2)
    const found = dominantMeeting(all)
    const at = found?.point
    check(
      'lines found in a picture meet where they were drawn to',
      !!at && Math.hypot(at.x - top.x, at.y - top.y) < 25,
      at ? `${at.x.toFixed(1)},${at.y.toFixed(1)} (drawn to ${top.x},${top.y})` : 'none found',
    )
  }
  // Lighting: a light brightens just where it is drawn; Colour only tints
  // without brightening; an old edit's even leak shape moves into Lighting.
  {
    const box = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.3, y: 0.7 }]
    const lightRender = (light: Partial<LightShape>) =>
      readPixels(
        engine.render({
          base,
          baseSize: { width: W, height: H },
          grain: flat,
          grainSize: { width: 64, height: 64 },
          params: {
            ...DEFAULT_BLEND_PARAMS,
            amount: 0,
            effects: { ...DEFAULT_EFFECTS, lighting: { enabled: true, lights: [{ ...DEFAULT_LIGHT, id: 'l', name: 'L', outline: box, rounded: false, edge: 0.01, ...light }] } },
          },
        }),
      )
    const plain = lightRender({ strength: 0 })
    const lit = lightRender({ colour: { source: 'manual', colour: [1, 1, 1] }, strength: 1 })
    const tinted = lightRender({ colour: { source: 'manual', colour: [0.3, 0.5, 1] }, strength: 1, mode: 'tint' })
    const px = (d: ImageData, x: number, y: number) => [0, 1, 2].map((c) => d.data[(y * W + x) * 4 + c])
    const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    const mid = px(tinted, 60, 40)
    check(
      'a light brightens where it is drawn and nowhere else; Colour only tints without brightening',
      at(lit, 60, 40) > at(plain, 60, 40) + 30 && Math.abs(at(lit, 5, 5) - at(plain, 5, 5)) <= 2 && mid[2] > mid[0] + 20 && Math.abs(lum(mid) - lum(px(plain, 60, 40))) < 18,
      `lit ${at(lit, 60, 40)} (plain ${at(plain, 60, 40)}), outside ${at(lit, 5, 5)}, tinted ${mid.join(',')}`,
    )
    // Lighting is its own module: a mask set on Leaks & burns (kept to a
    // corner far from the light) does not hold its lights back.
    const corner = { ...DEFAULT_MASK, id: 'c', name: 'C', outline: [{ x: 0, y: 0 }, { x: 0.1, y: 0 }, { x: 0.1, y: 0.1 }, { x: 0, y: 0.1 }] }
    const leaksMasked = readPixels(
      engine.render({
        base,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: {
            ...DEFAULT_EFFECTS,
            masks: [corner],
            maskUse: { leaks: { ids: ['c'], mode: 'only' } },
            lighting: { enabled: true, lights: [{ ...DEFAULT_LIGHT, id: 'l', name: 'L', outline: box, rounded: false, edge: 0.01, colour: { source: 'manual', colour: [1, 1, 1] }, strength: 1 }] },
          },
        },
      }),
    )
    check(
      "a light ignores Leaks & burns' mask: Lighting is its own module",
      Math.abs(at(leaksMasked, 60, 40) - at(lit, 60, 40)) <= 2,
      `lit ${at(leaksMasked, 60, 40)} with a Leaks mask elsewhere, ${at(lit, 60, 40)} without`,
    )
    // Over a bright sky a strong warm light lifts and warms it, easing off
    // before white rather than clipping into a flat blob.
    const sky = new ImageData(W, H)
    for (let k = 0; k < W * H; k++) sky.data.set([200, 212, 225, 255], k * 4)
    const skyLit = readPixels(
      engine.render({
        base: sky,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: { ...DEFAULT_EFFECTS, lighting: { enabled: true, lights: [{ ...DEFAULT_LIGHT, id: 'l', name: 'L', outline: box, rounded: false, edge: 0.01, colour: { source: 'manual', colour: [1, 0.7, 0.4] }, strength: 1.5 }] } },
        },
      }),
    )
    const sl = px(skyLit, 60, 40)
    const s0 = px(sky, 60, 40)
    check(
      'a strong light over a bright sky warms and lifts it without burning out to white',
      sl[0] > s0[0] + 15 && sl[0] < 254 && sl[2] < 245 && sl[0] - sl[2] > s0[0] - s0[2] + 15,
      `sky ${s0.join(',')} → ${sl.join(',')}`,
    )
    // A module masked like any other: black & white kept to the left half.
    {
      const colourful = new ImageData(W, H)
      for (let k = 0; k < W * H; k++) colourful.data.set([200, 60, 40, 255], k * 4)
      const left = { ...DEFAULT_MASK, id: 'h', name: 'H', outline: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 1 }, { x: 0, y: 1 }] }
      const bw = readPixels(
        engine.render({
          base: colourful,
          baseSize: { width: W, height: H },
          grain: flat,
          grainSize: { width: 64, height: 64 },
          params: {
            ...DEFAULT_BLEND_PARAMS,
            amount: 0,
            effects: { ...DEFAULT_EFFECTS, masks: [left], maskUse: { mono: { ids: ['h'], mode: 'only' } }, mono: { ...DEFAULT_EFFECTS.mono, enabled: true, amount: 1 } },
          },
        }),
      )
      const px2 = (x: number, y: number) => [0, 1, 2].map((c) => bw.data[(y * W + x) * 4 + c])
      const l = px2(Math.round(W * 0.2), 40)
      const r = px2(Math.round(W * 0.8), 40)
      check(
        'a mask keeps black & white to its part of the photo, as any module',
        Math.max(...l) - Math.min(...l) < 8 && r[0] - r[2] > 100,
        `masked ${l.join(',')}, outside ${r.join(',')}`,
      )
    }
    // Colour, one order: Vibrance and Warmth work on what the palette made,
    // so with a full palette they still show; an older edit, whose came
    // before the palette, is scaled to look as it did.
    {
      const ramp = new ImageData(W, H)
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) ramp.data.set([Math.round((x / W) * 255), Math.round((x / W) * 200), 60, 255], (y * W + x) * 4)
      const graded = (g: Partial<typeof DEFAULT_EFFECTS.grade>) =>
        readPixels(
          engine.render({
            base: ramp,
            baseSize: { width: W, height: H },
            grain: flat,
            grainSize: { width: 64, height: 64 },
            params: { ...DEFAULT_BLEND_PARAMS, amount: 0, effects: { ...DEFAULT_EFFECTS, grade: { ...DEFAULT_EFFECTS.grade, mapAmount: 1, mapShadow: { source: 'manual', colour: [0.05, 0.1, 0.4] }, mapMid: { source: 'manual', colour: [0.2, 0.6, 0.6] }, mapHigh: { source: 'manual', colour: [1, 0.6, 0.2] }, ...g } } },
          }),
        )
      const chroma = (d: ImageData) => {
        let t = 0
        for (let x = 4; x < W - 4; x += 8) {
          const k = (40 * W + x) * 4
          t += Math.max(d.data[k], d.data[k + 1], d.data[k + 2]) - Math.min(d.data[k], d.data[k + 1], d.data[k + 2])
        }
        return t
      }
      const plain = chroma(graded({}))
      const dull = chroma(graded({ vibrance: -0.8 }))
      const warm = graded({ warmth: 1 })
      const cool = graded({ warmth: -1 })
      const k = (40 * W + W / 2) * 4
      const old = parsePreset({ schemaVersion: 5, name: 'o', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, grade: { ...DEFAULT_EFFECTS.grade, mapAmount: 0.8, vibrance: 0.5, warmth: 0.5, mapSaturation: -0.5 } } }, output: {} })
      const og = old.blend.effects.grade
      check(
        'with a full palette, Vibrance and Warmth still change the picture; an older edit is scaled to look as it did',
        dull < plain * 0.6 && warm.data[k] - warm.data[k + 2] > cool.data[k] - cool.data[k + 2] + 10 && Math.abs(og.vibrance - (0.5 * 0.2 - 0.5 * 0.8)) < 0.002 && Math.abs(og.warmth - 0.1) < 0.002,
        `colour ${plain} → ${dull} at Vibrance -0.8; old edit's vibrance ${og.vibrance}, warmth ${og.warmth}`,
      )
    }
    // Through the lens: a light drawn over a patch of the photo stays on it
    // as the lens bends both, as streaks, masks and copies do.
    {
      const scene = new ImageData(W, H)
      const inPatch = (x: number, y: number) => x >= W * 0.05 && x < W * 0.3 && y >= H * 0.05 && y < H * 0.3
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) scene.data.set(inPatch(x, y) ? [120, 120, 120, 255] : [40, 40, 40, 255], (y * W + x) * 4)
      const patch = [{ x: 0.05, y: 0.05 }, { x: 0.3, y: 0.05 }, { x: 0.3, y: 0.3 }, { x: 0.05, y: 0.3 }]
      const lensed = (light: boolean) =>
        readPixels(
          engine.render({
            base: scene,
            baseSize: { width: W, height: H },
            grain: flat,
            grainSize: { width: 64, height: 64 },
            params: {
              ...DEFAULT_BLEND_PARAMS,
              amount: 0,
              effects: {
                ...DEFAULT_EFFECTS,
                lens: { ...DEFAULT_EFFECTS.lens, enabled: true, distortion: 1 },
                lighting: { enabled: light, lights: [{ ...DEFAULT_LIGHT, id: 'p', name: 'P', outline: patch, rounded: false, edge: 0.002, colour: { source: 'manual', colour: [1, 1, 1] }, strength: 1 }] },
              },
            },
          }),
        )
      const off = lensed(false)
      const on = lensed(true)
      let shown = 0
      let shownLit = 0
      let dark = 0
      let darkLit = 0
      let moved = 0
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const v = at(off, x, y)
          const lit = at(on, x, y) > v + 25
          if (v > 100) {
            shown++
            if (lit) shownLit++
            if (!inPatch(x, y)) moved++
          } else if (v < 60) {
            dark++
            if (lit) darkLit++
          }
        }
      check(
        'through the lens, a light drawn on a patch of the photo bends with it and stays on it',
        moved > 20 && shownLit / Math.max(shown, 1) > 0.95 && darkLit / Math.max(dark, 1) < 0.01,
        `patch moved ${moved} px, lit ${shownLit}/${shown} of it, ${darkLit}/${dark} off it`,
      )
    }
    // A glow round a mask: brightest just outside its edge, fading out,
    // nothing on the mask itself or far from it.
    const tower = { ...DEFAULT_MASK, id: 't', name: 'T', outline: [{ x: 0.4, y: 0.3 }, { x: 0.6, y: 0.3 }, { x: 0.6, y: 1 }, { x: 0.4, y: 1 }] }
    const glowed = readPixels(
      engine.render({
        base,
        baseSize: { width: W, height: H },
        grain: flat,
        grainSize: { width: 64, height: 64 },
        params: {
          ...DEFAULT_BLEND_PARAMS,
          amount: 0,
          effects: { ...DEFAULT_EFFECTS, masks: [tower], lighting: { enabled: true, lights: [{ ...DEFAULT_LIGHT, id: 'g', name: 'G', outline: [], mask: 't', glow: 0.15, strength: 1, colour: { source: 'manual', colour: [1, 1, 1] } }] } },
        },
      }),
    )
    const gx = Math.round(W * 0.5)
    const yEdge = Math.round(H * 0.3)
    const near = at(glowed, gx, yEdge - 2) - at(plain, gx, yEdge - 2)
    const mid2 = at(glowed, gx, yEdge - Math.round(H * 0.08)) - at(plain, gx, yEdge - Math.round(H * 0.08))
    const inside = at(glowed, gx, yEdge + Math.round(H * 0.2)) - at(plain, gx, yEdge + Math.round(H * 0.2))
    const far = at(glowed, 3, 3) - at(plain, 3, 3)
    check(
      'a glow round a mask is brightest at its edge, fades out, and leaves the mask and far away alone',
      near > 30 && mid2 > 3 && mid2 < near && Math.abs(inside) <= 2 && Math.abs(far) <= 2,
      `at the edge +${near}, further +${mid2}, inside ${inside}, far ${far}`,
    )
    const old = parsePreset({
      schemaVersion: PRESET_SCHEMA_VERSION,
      name: 'o',
      grainSource: { kind: 'procedural', id: 'g', params: {} },
      blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, leaks: { ...DEFAULT_EFFECTS.leaks, amount: 0.5, spots: [{ x: 0, y: 0, size: 0.05, stretch: 1, angle: 0, strength: 1, kind: 'light', outline: box, polygon: true, texture: 0, edge: 0.03 }] } } },
      output: {},
    })
    const ol = old.blend.effects.lighting
    check(
      "an old edit's even leak shape moves into Lighting, as bright as it was",
      !!ol && ol.lights.length === 1 && Math.abs(ol.lights[0].strength - 0.5) < 1e-6 && old.blend.effects.leaks.spots.length === 0,
      `${ol?.lights.length ?? 0} lights, ${old.blend.effects.leaks.spots.length} leaks left`,
    )
  }
  // A lens bend: bending a point and unbending it lands back where it was.
  {
    const lb = { k: 0.12, cx: 0.4, cy: 0.6, R: 0.9 }
    const pts = [{ x: 0.1, y: 0.2 }, { x: 0.75, y: 1.1 }, { x: 0.4, y: 0.6 }]
    const worst = Math.max(...pts.map((q) => { const r = unbend(bendLens(q, lb), lb); return Math.hypot(r.x - q.x, r.y - q.y) }))
    check('a lens bend undone lands where it started', worst < 1e-4, `worst ${worst.toExponential(1)}`)
  }
  // A bend from guides: half a pixel of wobble along lines near the middle
  // is not a bend (a building's edges, snapped point by point); lines near
  // the frame's edge that really bow give back the bend that bowed them.
  {
    const W2 = 1077
    const H2 = 1440
    const frame = { x: 0, y: 0, width: W2, height: H2 }
    const space = { frame, measure: { x: 0, y: 0, unit: W2 } }
    const sh = { ...STREAK_DEFAULTS, outline: [{ x: 0.2, y: 0.05 }, { x: 0.7, y: 0.05 }, { x: 0.7, y: 0.6 }, { x: 0.2, y: 0.6 }], angle: -85, band: 0.02, seed: 1, mode: 'fill' as const }
    const wobbly = [
      [[0.2628, 0.3618], [0.234, 0.4208], [0.2061, 0.4799], [0.1792, 0.5389], [0.1513, 0.5993]],
      [[0.5413, 0.2757], [0.532, 0.3625], [0.5218, 0.4514], [0.5125, 0.5403], [0.5023, 0.6271]],
      [[0.6063, 0.3146], [0.6063, 0.3924], [0.6063, 0.4708], [0.6054, 0.5486], [0.6045, 0.6264]],
      [[0.3779, 0.2611], [0.3445, 0.3521], [0.3101, 0.4417], [0.2758, 0.5361], [0.2433, 0.6271]],
    ].map((pts) => {
      const q = pts.map(([x, y]) => ({ x, y }))
      return { a: q[0], b: q[q.length - 1], points: q }
    })
    const straightish = perspectiveFromGuides(sh, wobbly, space, frame)
    const lens = { k: 0.08, cx: W2 / 2 / W2, cy: H2 / 2 / W2, R: Math.hypot(W2, H2) / 2 / W2 }
    const jitter = [0.4, -0.3, 0.1, -0.4, 0.3, -0.2, 0.4]
    const bowed = [
      [60, 100, 70, 1340],
      [1010, 100, 1000, 1340],
      [300, 200, 340, 1100],
    ].map(([x0, y0, x1, y1], li) => {
      const q = [0, 1, 2, 3, 4, 5, 6].map((i) => {
        const t = i / 6
        const b = bendLens({ x: (x0 + (x1 - x0) * t) / W2, y: (y0 + (y1 - y0) * t) / W2 }, lens)
        const j = jitter[(i + li) % jitter.length] / W2
        return { x: (b.x + j) * W2 / W2, y: ((b.y - j) * W2) / H2 }
      })
      return { a: q[0], b: q[q.length - 1], points: q }
    })
    const bent = perspectiveFromGuides(sh, bowed, space, frame)
    check(
      "guides only bend the streaks as much as they show: a pixel's wobble is not a bend, a real bow is",
      !!straightish && Math.abs(straightish.bend ?? 0) < 0.035 && !!bent && Math.abs((bent.bend ?? 0) - 0.08) < 0.02,
      `wobbly ${straightish?.bend}, bowed by 0.08 ${bent?.bend}`,
    )
  }
  const keptKey = parsePreset({ schemaVersion: PRESET_SCHEMA_VERSION, name: 'm', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, masks: [{ ...short, key: 'darker', keyAt: 'edge', keyBand: 0.04 }] } }, output: {} })
  check('a mask matched at its edge survives saving and loading', keptKey.blend.effects.masks[0].keyAt === 'edge' && keptKey.blend.effects.masks[0].keyBand === 0.04)
}

/**
 * Every module works on its own: from a blank edit, adding just that module
 * (as the Add button does) changes the photo. A module that only works with
 * another one on (dither needing grain, say) fails here.
 */
async function runModuleAloneTests() {
  const W = 160
  const H = 110
  const engine = new GrainEngine()
  // A photo-like test image: a sky gradient, a dark ground, a bright sun, some texture.
  const base = new ImageData(W, H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const sky = y < H * 0.6
      const sun = Math.hypot(x - W * 0.7, y - H * 0.3) < 10
      const n = ((x * 37 + y * 91) % 17) - 8
      const c = sun ? [255, 245, 220] : sky ? [90 + y, 140 + y * 0.5, 210] : [40 + n, 55 + n, 30 + n]
      base.data.set([...c.map((v) => Math.max(0, Math.min(255, v + (sky ? n * 0.5 : 0)))), 255], i)
    }
  const flat = makeNoiseGrain(64, 64)
  // Every other module's switch off, as on a photo with only this module in use.
  const allOff = Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as BlendParams['modules']
  const blank: BlendParams = { ...DEFAULT_BLEND_PARAMS, amount: 0, modules: allOff, effects: { ...DEFAULT_EFFECTS }, border: { ...DEFAULT_BLEND_PARAMS.border, width: 0, bottomExtra: 0 } }
  const render = (params: BlendParams) =>
    readPixels(engine.render({ base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 64, height: 64 }, params, imageSeed: 7 }))
  const meanDiff = (a: ImageData, b: ImageData) => {
    if (a.width !== b.width || a.height !== b.height) return 255
    let d = 0
    for (let i = 0; i < a.data.length; i += 4) d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2])
    return d / ((a.data.length / 4) * 3)
  }
  const plain = render(blank)
  // What some modules need placed before they can do anything: a streak shape, a second photo.
  const second = new ImageData(40, 30)
  for (let i = 0; i < second.data.length; i += 4) second.data.set([240, 200, 120, 255], i)
  const secondBitmap = await createImageBitmap(second)
  setCollageImageLookup((id) => (id === 'img_alone' ? { id, name: 'alone', bitmap: secondBitmap, thumb: '', luma: { width: 1, height: 1, data: new Float32Array(1) } } : collageImageNow(id)))
  const placed = (id: string, b: BlendParams): BlendParams => {
    if (id === 'streaks')
      return { ...b, effects: { ...b.effects, streaks: { ...b.effects.streaks, enabled: true, amount: 1, shapes: [{ ...STREAK_DEFAULTS, outline: [{ x: 0.1, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.8 }, { x: 0.1, y: 0.8 }], mode: 'trail', seed: 3 }] } } }
    if (id === 'double') return { ...b, effects: { ...b.effects, double: { ...b.effects.double, image: 'img_alone' } } }
    // Base corrections start at rest; a correction to make.
    if (id === 'exposure') return { ...b, effects: { ...b.effects, base: { ...b.effects.base, exposure: 0.8 } } }
    if (id === 'balance') return { ...b, effects: { ...b.effects, base: { ...b.effects.base, temperature: 0.5 } } }
    if (id === 'curve') return { ...b, effects: { ...b.effects, base: { ...b.effects.base, curve: [{ x: 0, y: 0.1 }, { x: 0.5, y: 0.65 }, { x: 1, y: 1 }] } } }
    return b
  }
  for (const m of MODULES) {
    if (m.id === 'collage') continue // its pieces come from the image library, which this page cannot store into
    if (m.id === 'crop') continue // taken before the engine: see the crop and export tests
    if (m.id === 'repeat') continue // needs a mask to copy: see runShapeMaskTests
    if (m.id === 'lighting') continue // needs a light drawn: see the lighting test
    const on = placed(m.id, startModule(m.id, blank))
    const shown = render(on)
    const d = meanDiff(shown, plain)
    // Dust specks and surge bands touch few pixels, but plainly: count those too.
    let changed = 0
    for (let i = 0; i < shown.data.length; i += 4)
      if (Math.max(Math.abs(shown.data[i] - plain.data[i]), Math.abs(shown.data[i + 1] - plain.data[i + 1]), Math.abs(shown.data[i + 2] - plain.data[i + 2])) >= 4) changed++
    const share = changed / (W * H)
    check(`${m.title} works on its own`, d > 0.4 || share > 0.003, `mean change ${d.toFixed(2)} of 255, ${(share * 100).toFixed(2)}% of pixels visibly changed`)
    // And turned off again, it leaves the photo as it was.
    const off = stopModule(m.id, on)
    const back = meanDiff(render(off), plain)
    check(`${m.title} turned off leaves the photo alone`, back < 0.25, `mean change ${back.toFixed(2)}`)
  }
  setCollageImageLookup(collageImageNow)
}

function runModuleStackTests() {
  const base = { ...DEFAULT_BLEND_PARAMS, amount: 0, modules: { ...DEFAULT_MODULES }, effects: { ...DEFAULT_EFFECTS } }
  // Looks saved before Edges and Solarize had their own switches and masks:
  // edges went with Glow, solarizing with Tone, and they still do.
  const mask = { id: 'm1', name: 'M', outline: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }] }
  const { edges: _e, solarize: _s, ...oldModules } = { ...DEFAULT_MODULES, light: false, tone: true }
  const old = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'old',
    grainSource: { kind: 'procedural', id: 'g', params: {} },
    blend: { ...base, modules: oldModules, effects: { ...base.effects, masks: [mask], maskUse: { light: { ids: ['m1'], mode: 'only' }, tone: { ids: ['m1'], mode: 'exclude' } } } },
    output: {},
  })
  check(
    'an older look keeps edges with Glow and solarize with Tone, switches and masks',
    !old.blend.modules.edges && old.blend.modules.solarize && old.blend.effects.maskUse.edges?.mode === 'only' && old.blend.effects.maskUse.solarize?.mode === 'exclude',
    JSON.stringify([old.blend.modules.edges, old.blend.modules.solarize, old.blend.effects.maskUse.edges, old.blend.effects.maskUse.solarize]),
  )
  for (const m of MODULES) {
    if (m.id === 'streaks' || m.id === 'collage' || m.id === 'double' || m.id === 'lighting') continue // need shapes, pieces or a second photo
    // Base corrections start at rest: adding one shows it, ready, and changes nothing yet.
    if (m.category === 'base') {
      check(`adding ${m.title.toLowerCase()} changes nothing until it is used`, !inUse(m.id, startModule(m.id, base)))
      continue
    }
    const on = startModule(m.id, base)
    const off = stopModule(m.id, on)
    check(`adding ${m.title.toLowerCase()} puts it in use; taking it off does not`, inUse(m.id, on) && !inUse(m.id, off), `${inUse(m.id, on)} ${inUse(m.id, off)}`)
  }  // Every module alike: a reset that keeps its switch and changes nothing
  // else; presets that bring back what was saved; masks for the ones that
  // can have them, each a section the masks list and the engine know.
  {
    const broken: string[] = []
    for (const m of MODULES) {
      const on = startModule(m.id, base)
      let reset: typeof on
      try {
        reset = resetModule(m.id, on)
      } catch (err) {
        broken.push(`${m.id} reset threw ${(err as Error).message}`)
        continue
      }
      const others = MODULES.filter((o) => o.id !== m.id && o.id !== 'border' && inUse(o.id, on) !== inUse(o.id, reset))
      if (others.length) broken.push(`${m.id} reset touched ${others.map((o) => o.id).join(',')}`)
      const kind = presetKind(m.id)
      if (kind) {
        const saved = extractPart(kind, on, null)
        const back = applyPart(saved, reset, { kind: 'procedural', id: 'g', params: {} } as never).blend
        const got = extractPart(kind, back, null).blend as Record<string, unknown>
        // Setting by setting, in any order.
        const flat = (o: unknown, pre = ''): Record<string, string> => (o && typeof o === 'object' ? Object.assign({}, ...Object.entries(o as object).map(([k, v]) => flat(v, `${pre}.${k}`))) : { [pre]: JSON.stringify(o) })
        const a = flat(saved.blend)
        const b = flat(got)
        const diff = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).slice(0, 4).map((k) => `${k} ${a[k]}→${b[k]}`)
        if (diff.length) broken.push(`${m.id} preset did not come back: ${diff.join(' ')}`)
      }
      if (MASKABLE.has(m.id) && !(MASK_SECTIONS as string[]).includes(m.id)) broken.push(`${m.id} can be masked but has no section`)
      // A module that is on stays on when reset, at how adding it starts it.
      if (m.category !== 'base' && inUse(m.id, on) && !inUse(m.id, reset)) broken.push(`${m.id} went off when reset`)
      if (m.category !== 'base' && inUse(m.id, resetModule(m.id, stopModule(m.id, on)))) broken.push(`${m.id} came on when reset while off`)
    }
    {
      const moved = { ...startModule('solarize', base), effects: { ...startModule('solarize', base).effects, solarize: 0.9, halo: 0 } }
      const back = resetModule('solarize', moved)
      if (back.effects.solarize !== FACTORY.effects.solarize || back.effects.halo !== FACTORY.effects.halo) broken.push(`solarize reset to ${back.effects.solarize}/${back.effects.halo}, not where its sliders reset to`)
    }
    check(
      'every module resets on its own, its presets come back, and every maskable one has a mask section',
      broken.length === 0 && WITH_PRESETS.size > 10 && MASKABLE.size > 10,
      broken.join('; ') || `${MODULES.length} modules`,
    )
  }
  // Repeat's own piece: a mask it keeps, saved with the look and still its own.
  const piece = { ...mask, id: 'piece', owner: 'repeat' }
  const kept = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'piece',
    grainSource: { kind: 'procedural', id: 'g', params: {} },
    blend: { ...base, effects: { ...base.effects, masks: [mask, piece], repeat: { ...DEFAULT_REPEAT, enabled: true, source: 'piece' } } },
    output: {},
  })
  check(
    "Repeat's own piece is kept as its own, and the module is on without one",
    kept.blend.effects.masks[1]?.owner === 'repeat' && !kept.blend.effects.masks[0]?.owner && kept.blend.effects.repeat?.items[0]?.source === 'piece' && inUse('repeat', { ...base, effects: { ...base.effects, repeat: { enabled: true, items: [] } } }),
    JSON.stringify(kept.blend.effects.masks.map((m) => m.owner ?? null)),
  )
}

function runPartTests() {
  // Placed on the photo (streaks, masks, collage): left out of a look unless asked.
  {
    const shape: StreakShape = { ...STREAK_DEFAULTS, outline: [{ x: 0.2, y: 0.2 }, { x: 0.6, y: 0.2 }, { x: 0.6, y: 0.6 }], angle: 0, band: 0.02, seed: 1, mode: 'fill' }
    const mask: MaskShape = { ...DEFAULT_MASK, id: 'm1', name: 'Mask 1', outline: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.1 }, { x: 0.3, y: 0.3 }] }
    const drawn = {
      ...DEFAULT_BLEND_PARAMS,
      amount: 0.4,
      effects: { ...DEFAULT_EFFECTS, fade: 0.1, streaks: { enabled: true, amount: 1, shapes: [shape] }, masks: [mask], maskUse: { tone: { ids: ['m1'], mode: 'only' as const } } },
    }
    const look = withoutPlaced(drawn)
    check('a look is saved without the streaks and masks placed on the photo', !hasPlaced(look) && look.effects.fade === 0.1 && look.amount === 0.4)
    const applied = withPlaced(drawn, { ...DEFAULT_BLEND_PARAMS, effects: { ...DEFAULT_EFFECTS, fade: 0.02 } })
    check('applying a look keeps the photo’s own streaks and masks', applied.effects.streaks.shapes.length === 1 && applied.effects.masks.length === 1 && applied.effects.fade === 0.02)
    const doc = parsePreset({ schemaVersion: 5, name: 'with', placed: true, grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: drawn, output: {} })
    const plain = parsePreset({ schemaVersion: 5, name: 'without', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: drawn, output: {} })
    check('a look saved with its placed things says so; one without does not', doc.placed === true && plain.placed === undefined)
    // Colour fixes and Skip masked colours are kept with their streak; an
    // older streak with neither skips masked colours and has no fixes.
    const fix: StreakFix = { ...SPAN_FIX, a: { x: 0.3, y: 0.4 }, b: { x: 0.5, y: 0.4 }, mode: 'colours', source: { a: { x: 0.1, y: 0.4 }, b: { x: 0.2, y: 0.4 } }, masked: true, colours: [[1, 0.5, 0], [0, 0.2, 1]], variation: 0.6, seed: 42 }
    const withFix = { ...drawn, effects: { ...drawn.effects, streaks: { ...drawn.effects.streaks, shapes: [{ ...shape, skipMasked: false, fixes: [fix] }] } } }
    const back = parsePreset(JSON.parse(JSON.stringify({ schemaVersion: 5, name: 'fixed', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: withFix, output: {} })))
    const got = back.blend.effects.streaks.shapes[0]
    const { skipMasked: _s, fixes: _f, ...older } = shape
    const old = parsePreset({ schemaVersion: 5, name: 'old', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { ...drawn, effects: { ...drawn.effects, streaks: { enabled: true, amount: 1, shapes: [older] } } }, output: {} })
    check(
      'a streak keeps its colour fixes and Skip masked colours',
      got.skipMasked === false &&
        got.fixes.length === 1 &&
        (Object.keys(fix) as (keyof StreakFix)[]).every((k) => JSON.stringify(got.fixes[0][k]) === JSON.stringify(fix[k])) &&
        old.blend.effects.streaks.shapes[0].skipMasked === true && old.blend.effects.streaks.shapes[0].fixes.length === 0,
    )
  }
  // A section preset changes only its section, and a look keeps the border.
  const src = { kind: 'procedural', id: 'procedural', name: 'g', params: {} }
  const a = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'a',
    grainSource: src,
    blend: { amount: 0.3, border: { width: 0.06 }, effects: { halation: 0.5, grade: { vibrance: 0.4 } } },
    output: {},
  }).blend
  const b = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'b',
    grainSource: src,
    blend: { amount: 0.1, border: { width: 0 }, effects: { halation: 0.1, grade: { vibrance: -0.2 } } },
    output: {},
  }).blend
  const borderPart = extractPart('border', a, src)
  const applied = applyPart(borderPart, b, src).blend
  check(
    'a border preset changes the border and nothing else',
    applied.border.width === 0.06 && applied.amount === 0.1 && applied.effects.halation === 0.1,
  )
  const colourApplied = applyPart(extractPart('colour', a, src), b, src).blend
  check(
    'a colour preset changes the colour and nothing else',
    colourApplied.effects.grade.vibrance === 0.4 && colourApplied.effects.halation === 0.1 && colourApplied.border.width === 0,
  )
  const lookKeptBorder = keepPart('border', a, b)
  check('loading a look keeps the current border', lookKeptBorder.border.width === 0.06 && lookKeptBorder.amount === 0.1)
  // A section's reset: its settings back to defaults, the rest untouched, and
  // its switch as it was.
  const offColour = { ...a, modules: { ...a.modules, colour: false } }
  const colourReset = resetPart('colour', offColour)
  check(
    'resetting a section puts only its settings back to their defaults',
    colourReset.effects.grade.vibrance === DEFAULT_GRADE.vibrance &&
      colourReset.effects.stock.id === 'none' &&
      colourReset.effects.halation === a.effects.halation &&
      colourReset.border.width === a.border.width &&
      colourReset.amount === a.amount &&
      colourReset.modules.colour === false,
  )
}

function runInstagramTests() {
  // The print — photo plus border — comes out exactly 1080 wide, within
  // Instagram's aspect limits, whatever the photo and border.
  const cases: [Size, number, number][] = [
    [{ width: 1054, height: 1440 }, 0, 0],
    [{ width: 4000, height: 3000 }, 0, 0],
    [{ width: 3000, height: 4500 }, 0.05, 0.09],
    [{ width: 6000, height: 2000 }, 0.04, 0],
    // Rounding the border per side once left this one at 1079.
    [{ width: 1077, height: 1440 }, 0.035, 0],
  ]
  for (let b = 0.005; b <= 0.2; b += 0.005) cases.push([{ width: 4000, height: 6000 }, b, (b * 7) % 0.1])
  for (let b = 0.005; b <= 0.2; b += 0.005) cases.push([{ width: 6000, height: 4000 }, b, 0])
  let ok = true
  const seen: string[] = []
  for (const [photo, width, bottomExtra] of cases) {
    const border = { ...DEFAULT_BORDER, width, bottomExtra }
    const size = instagramPhotoSize(photo, border)
    const full = printSize(size, border)
    // At most two pixels of paper over, trimmed on export.
    const print = fitToInstagram(full)
    const ratio = print.height / print.width
    if (print.width !== 1080 || full.width - print.width > 2 || full.height - print.height > 2 || full.width - print.width > 2 || full.height - print.height > 2) seen.push(`${photo.width}×${photo.height} b${width.toFixed(3)} → ${print.width}×${print.height}`)
    if (print.width !== 1080 || full.width - print.width > 2 || full.height - print.height > 2 || ratio > 4 / 3 + 0.01 || ratio < 1 / 1.91 - 0.01) ok = false
  }
  check('Instagram size gives a print exactly 1080 wide within its aspect limits', ok, seen.join(', '))
}

function runPresetTests() {
  // Streaks saved before Clip and Bar lengths: a fill measured its bars
  // against the box round the shape and said which end was ragged.
  const oldStreaks = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'Old streaks',
    grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
    blend: {
      effects: {
        streaks: {
          shapes: [
            { outline: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.8 }], mode: 'fill', tips: 'near', lengthMin: 0.5 },
            { outline: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.8 }], mode: 'fill', tips: 'far' },
            { outline: [{ x: 0, y: 0 }, { x: 0.6, y: 0 }, { x: 0.6, y: 0.8 }], mode: 'trail', length: 0.7 },
          ],
        },
      },
    },
    output: {},
  }).blend.effects.streaks.shapes
  check(
    'old fill streaks become clipped fills measured as a distance, keeping their ragged end',
    oldStreaks[0].clip &&
      oldStreaks[0].measure === 'distance' &&
      Math.abs(oldStreaks[0].length - 1) < 1e-6 &&
      oldStreaks[0].anchor === 'far' &&
      oldStreaks[1].anchor === 'edge' &&
      oldStreaks[2].length === 0.7 &&
      oldStreaks[2].measure === 'across',
  )
  // v4 leaks were a style and a count placed from a seed; v5 stores spots.
  const v4Leaks = parsePreset({
    schemaVersion: 4,
    name: 'Old leaks',
    grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
    blend: { effects: { leaks: { amount: 0.5, style: 'burn', count: 3, seed: 8 } } },
    output: {},
  })
  const legacySpots = v4Leaks.blend.effects.leaks.spots
  check(
    'v4 leaks migrate to placed spots',
    legacySpots.length === 3 && legacySpots.every((s) => s.kind === 'burn') && v4Leaks.blend.effects.leaks.amount === 0.5,
    `${legacySpots.length} ${legacySpots[0]?.kind} spots`,
  )
  check('presets without key controls load at 100%', Object.values(v4Leaks.blend.keys).every((v) => v === 1))


  // A v1 preset predates response, rotation, chroma and softness; loading one
  // must produce neutral defaults, i.e. render exactly as it did when saved.
  const v1 = {
    schemaVersion: 1,
    name: 'Old preset',
    grainSource: { kind: 'plate', id: 'plate_x', name: 'Tri-X' },
    blend: { blendMode: 'softLight', amount: 0.4, colorSpace: 'srgb', tiling: 'mirror', grainScale: 2 },
    output: { jpegQuality: 0.8, suffix: '_g' },
  }
  const migrated = parsePreset(v1)
  check(
    'v1 presets migrate to neutral current defaults',
    migrated.schemaVersion === PRESET_SCHEMA_VERSION &&
      migrated.blend.amount === 0.4 &&
      migrated.blend.grainScale === 2 &&
      migrated.blend.grainRotation === 0 &&
      migrated.blend.chroma === 1 &&
      migrated.blend.softness === 0 &&
      migrated.blend.response.every((p) => p.y === 1),
  )

  // A procedural source is defined entirely by its parameters, so the parser
  // must not drop them the way it would an unknown field.
  // v2 stored three band multipliers; the migrated curve must reproduce that
  // function closely or old presets would render differently.
  const v2 = {
    ...v1,
    schemaVersion: 2,
    blend: { ...v1.blend, response: { shadows: 1.6, midtones: 0.9, highlights: 0.2 } },
  }
  const migratedCurve = parsePreset(v2).blend.response
  const legacyAt = (luma: number) => {
    const sh = Math.max(0, 1 - 2 * luma)
    const hi = Math.max(0, 2 * luma - 1)
    return 1.6 * sh + 0.9 * (1 - sh - hi) + 0.2 * hi
  }
  let migrationError = 0
  for (let i = 0; i <= 100; i++) {
    const x = i / 100
    migrationError = Math.max(migrationError, Math.abs(evaluateCurve(migratedCurve, x) - legacyAt(x)))
  }
  check(
    'v2 band response migrates to an equivalent curve',
    migrationError < 0.05,
    `max deviation=${migrationError.toFixed(4)} of ${MAX_STRENGTH}`,
  )

  const withProcedural = {
    ...v1,
    schemaVersion: 2,
    grainSource: { kind: 'procedural', id: 'procedural', name: 'Generated grain', params: { seed: 42, grainSize: 3 } },
  }
  const kept = parsePreset(withProcedural).grainSource as Record<string, any>
  check('procedural parameters survive preset parsing', kept.params?.seed === 42 && kept.params?.grainSize === 3)
}

/**
 * A grain plate the way a real scan looks: high-frequency noise riding on an
 * uneven density field, so opposite edges do not match and naive tiling seams.
 */
function makeUnevenGrain(w: number, h: number, mean = 0.5): ImageData {
  const d = new ImageData(w, h)
  let seed = 9871
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const falloff = 0.06 * Math.cos((x / w) * Math.PI) + 0.04 * Math.sin((y / h) * Math.PI * 0.7)
      const noise = (rand() + rand() + rand() - 1.5) * 0.14
      const v = Math.round(Math.min(1, Math.max(0, mean + falloff + noise)) * 255)
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v
      d.data[i + 3] = 255
    }
  }
  return d
}

/** An export carries its edit: embed and read back, in both formats. */
async function runRecipeTests() {
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 24
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#c84'
  ctx.fillRect(0, 0, 32, 24)
  const doc = parsePreset({
    schemaVersion: PRESET_SCHEMA_VERSION,
    name: 'Recipe test',
    grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
    blend: { amount: 0.21, effects: { dither: { amount: 0.5, guides: [{ x: 0.5, y: 0, radius: 0.4, strength: 0.6 }] } } },
    output: {},
  })
  for (const type of ['image/jpeg', 'image/png']) {
    const plain = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), type, 0.9))
    const original = { name: 'P0001.jpg', size: 1234, sha256: await sha256(plain) }
    const embedded = await embedRecipe(plain, { v: 1, doc, original })
    const back = await readRecipe(embedded)
    // Still a valid image after embedding.
    const decoded = await createImageBitmap(embedded).then((b) => b.width === 32).catch(() => false)
    check(
      `${type} exports carry their edit and stay valid images`,
      decoded &&
        back?.original.sha256 === original.sha256 &&
        back.doc.blend.amount === 0.21 &&
        back.doc.blend.effects.dither.guides[0]?.strength === 0.6,
    )
    check(`a plain ${type} has no recipe`, (await readRecipe(plain)) === null)
  }
  {
    // Collage images travel by name, size and hash; whether the edit said
    // what its shapes are fractions of is read back, never written.
    const plain = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9))
    const original = { name: 'P0001.jpg', size: 1234, sha256: await sha256(plain) }
    const ref = { id: 'img_0123456789abcdef01234567', name: 'Sky.jpg', size: 4321, sha256: '0123456789abcdef01234567'.padEnd(64, '0') }
    const back = await readRecipe(await embedRecipe(plain, { v: 1, doc, original, collage: [ref], shapeSpaceSaved: true }))
    const raw = new TextDecoder('latin1').decode(new Uint8Array(await (await embedRecipe(plain, { v: 1, doc, original, shapeSpaceSaved: true })).arrayBuffer()))
    // A doc written now always says.
    const freshBack = await readRecipe(await embedRecipe(plain, { v: 1, doc, original }))
    check(
      'an export records its collage images and whether it said what its shapes are fractions of',
      back?.collage?.[0]?.name === 'Sky.jpg' &&
        back.collage[0].sha256 === ref.sha256 &&
        back.shapeSpaceSaved === true &&
        !raw.includes('shapeSpaceSaved') &&
        freshBack?.shapeSpaceSaved === true,
    )
  }
  // An old export's shapes, read off the export: drawn on the photo in the
  // hours before edits said so, they must not be read as the print's.
  {
    const photo = document.createElement('canvas')
    photo.width = 120
    photo.height = 160
    const pc = photo.getContext('2d')!
    for (let y = 0; y < 160; y += 8) {
      pc.fillStyle = `rgb(${(y * 37) % 255}, ${255 - ((y * 53) % 255)}, ${(y * 11) % 255})`
      pc.fillRect(0, y, 120, 8)
    }
    const file = await new Promise<Blob>((r) => photo.toBlob((b) => r(b!), 'image/png'))
    const source = createProceduralSource()
    const blendIn = (space: 'photo' | 'print') => ({
      ...DEFAULT_BLEND_PARAMS,
      modules: { ...DEFAULT_BLEND_PARAMS.modules, border: true },
      border: { ...DEFAULT_BLEND_PARAMS.border, width: 0.1 },
      effects: {
        ...DEFAULT_BLEND_PARAMS.effects,
        shapeSpace: space,
        streaks: {
          enabled: true,
          amount: 1,
          shapes: [
            {
              ...STREAK_DEFAULTS,
              mode: 'fill' as const,
              seed: 3,
              angle: -90,
              band: 0.02,
              outline: [
                { x: 0.2, y: 0.1 },
                { x: 0.8, y: 0.1 },
                { x: 0.8, y: 0.55 },
                { x: 0.2, y: 0.55 },
              ],
            },
          ],
        },
      },
    })
    const engine = new GrainEngine()
    const picks: string[] = []
    for (const space of ['photo', 'print'] as const) {
      const exportDoc = { ...doc, blend: blendIn(space), output: { ...doc.output, size: 'original' as const } }
      const rendered = await renderFile(engine, file, 'P0002.png', source, exportDoc.blend, exportDoc.output)
      // Read back as an edit that did not say: the print's.
      const asRead = { ...exportDoc, blend: blendIn('print') }
      const unknown = shapeSpaceUnknown(asRead.blend, false)
      picks.push(`${unknown ? '' : 'known '}${await shapeSpaceFromExport(file, 'P0002.png', rendered.blob, source, asRead)}`)
    }
    engine.dispose()
    check(
      "an old export's shapes are read the way they were drawn, photo or print",
      picks[0] === 'photo' && picks[1] === 'print' && !shapeSpaceUnknown(blendIn('print'), true) && !shapeSpaceUnknown(blendIn('photo'), false),
      `drawn on the photo: ${picks[0]}; on the print: ${picks[1]}`,
    )
  }
}

// The crop is taken before the edit, and the export's preset after it: the
// file comes out at the crop's size, then the preset's shape and size, and a
// recipe never takes the crop away.
async function runCropExportTests() {
  const c = document.createElement('canvas')
  c.width = 400
  c.height = 300
  const g = c.getContext('2d')!
  const grad = g.createLinearGradient(0, 0, 400, 0)
  grad.addColorStop(0, '#203040')
  grad.addColorStop(1, '#f0c080')
  g.fillStyle = grad
  g.fillRect(0, 0, 400, 300)
  const file = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
  const allOff = { ...DEFAULT_BLEND_PARAMS, modules: Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES }
  const cropped = { ...allOff, effects: { ...allOff.effects, crop: { ...DEFAULT_CROP, enabled: true, x: 0.25, y: 0, width: 0.5, height: 1 } } }
  const engine = new GrainEngine()
  const source = createProceduralSource()
  const sizeOf = async (blend: BlendParams, output: OutputSettings, name = 'p.png') => {
    const r = await renderFile(engine, file, name, source, blend, output)
    return `${r.width}x${r.height}.${r.ext}`
  }
  const own = await sizeOf(cropped, DEFAULT_OUTPUT)
  check('a crop exports at the crop’s size', own === '200x300.png', own)
  const long = await sizeOf(allOff, { ...DEFAULT_OUTPUT, longEdge: 200 })
  check('a long edge scales the whole picture, never cropping it', long === '200x150.png', long)
  const ig = await sizeOf(cropped, { ...DEFAULT_OUTPUT, shape: 'instagram' })
  check('Instagram size scales the cropped picture to 1080 wide', ig === '1080x1620.png', ig)
  const jpeg = await sizeOf(allOff, { ...DEFAULT_OUTPUT, format: 'jpeg' })
  check('a format other than the photo’s is used', jpeg === '400x300.jpg', jpeg)
  const raw = await sizeOf(allOff, DEFAULT_OUTPUT, 'p.png')
  check('Original keeps the photo’s own size and format', raw === '400x300.png', raw)
  engine.dispose()
  const legacy = parsePreset({ schemaVersion: 5, name: 'x', grainSource: { kind: 'procedural', id: 'procedural' }, output: { size: 'instagram' } })
  check('an export saved as Instagram size still reads as Instagram', legacy.output.shape === 'instagram' && legacy.output.longEdge === null, JSON.stringify(legacy.output))
  const recipe = { ...allOff, effects: { ...allOff.effects, crop: DEFAULT_CROP } }
  const applied = withPlaced(cropped, recipe)
  check('a recipe leaves the photo’s crop alone', applied.effects.crop.enabled && applied.effects.crop.width === 0.5, JSON.stringify(applied.effects.crop))
  const fit = fitRatio({ ...DEFAULT_CROP, enabled: true }, { width: 400, height: 300 }, 1)
  check('choosing 1:1 makes the largest square that fits', Math.abs(fit.width * 400 - 300) < 1 && Math.abs(fit.height - 1) < 1e-6 && Math.abs(fit.x - 0.125) < 1e-6, JSON.stringify(fit))
}

// A photo's embedded colour profile is applied before it reaches WebGL, which
// ignores profiles (Safari always, Chrome with colorSpaceConversion 'none').
// The test image stores pure red under darktable's channel-swapping "BRG"
// profile, so every viewer shows it blue — and so must the render.
async function runDecodeTests() {
  const file = await (await fetch('/selftest-brg.png')).blob()
  const engine = new GrainEngine()
  const flat = makeFlatGrain(8, 8, 128)
  const allOff = { ...DEFAULT_BLEND_PARAMS, modules: Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES }
  const renderOf = (bmp: ImageBitmap) => {
    const d = readPixels(engine.render({ base: bmp, baseSize: { width: bmp.width, height: bmp.height }, grain: flat, grainSize: { width: 8, height: 8 }, params: allOff })).data
    const k = (1 * bmp.width + 1) * 4
    return { r: d[k], g: d[k + 1], b: d[k + 2] }
  }
  const raw = renderOf(await createImageBitmap(file, { colorSpaceConversion: 'none' }))
  const shown = renderOf(await decodePhoto(file))
  check(
    'a photo’s colour profile is applied before rendering',
    shown.b > 200 && shown.r < 40 && shown.g < 40,
    `stored red under a channel-swapping profile renders rgb ${shown.r} ${shown.g} ${shown.b} (raw upload would be ${raw.r} ${raw.g} ${raw.b})`,
  )
  engine.dispose()
}

// Light & shade: every place on the wheel makes a palette inside the rules —
// Tide's place gives Tide's colours back, nothing is more saturated than the
// cap, the light stays warm and the shade cool, and linked handles mirror.
function runLightShadeTests() {
  const tide: [number, number, number][] = [[0.02, 0.05, 0.16], [0.08, 0.36, 0.48], [1, 0.52, 0.18]]
  const back = lightShadeOf(tide[1] as [number, number, number], tide[2] as [number, number, number])
  const again = lightShadeStops(back)
  const off = Math.max(...again.slice(1).flatMap((c, i) => c.map((v, k) => Math.abs(v - tide[i + 1][k]))))
  check('light & shade reads Tide back and rebuilds its midtone and light colours', off < 0.04, `max channel difference ${off.toFixed(3)}`)
  let worst = 0
  let warm = true
  for (let lh = 0; lh < 360; lh += 15)
    for (let sh = 0; sh < 360; sh += 15)
      for (const r of [0.3, 1]) {
        const stops = lightShadeStops({ light: { hue: lh, r }, shade: { hue: sh, r } })
        worst = Math.max(worst, rampPeak(stops))
        const [, cl, hl] = lch(stops[2])
        if (cl > 0.03 && !(hl >= LIGHT_ARC[0] - 6 && hl <= LIGHT_ARC[1] + 6)) warm = false
      }
  check('no place on the light & shade wheel is more saturated than the cap', worst <= 0.135, `peak chroma ${worst.toFixed(3)}`)
  check('the light & shade light colour always stays warm', warm)
  check(
    'linked light & shade handles mirror: orange light swings the shade to blue-teal',
    Math.abs(mirrored(55, 'shade') - 235) < 1e-9 && mirrored(140, 'light') === LIGHT_ARC[0],
  )
}

// A streak fill covers its whole shape. Drawn round a real subject (this is a
// traced outline: an edge that leans across the flow, small steps in it),
// two things used to leave whole bars of the inside empty: a bar's run
// measured from the first point outside, which on some columns read the
// near edge as the far one; and a bar measured on its centre line, which a
// step in the outline cut short for everything beyond it.
function runStreakFillTests() {
  const W = 1077
  const H = 1440
  const outline = [[0.7724123853081887,-0.006675058701424912],[0.7723214496410773,0.01370636416164809],[0.6037581954419735,0.09513355745606132],[0.597614852989867,0.1011771163217045],[0.5943122002549166,0.1101489188070244],[0.5958123350652487,0.6725610667364242],[0.5809736645596637,0.6690040921766817],[0.5472375061146547,0.6731856196091134],[0.513098611108018,0.6632944936069449],[0.48648782155156817,0.670063648419136],[0.44636673253231435,0.6672786090189923],[0.4130859887147273,0.6836660434731675],[0.3719442956140227,0.6888566617580597],[0.3443135855320006,0.6841084072154447],[0.32037171657517494,0.6941449247063978],[0.2834536202483459,0.6925399910787785],[0.25887276114342006,0.6863592123583075],[0.26257614115603484,0.498600835306355],[0.2651477589815607,0.498609190457667],[0.265611771149293,0.4728655851142436],[0.2588087464956549,0.40494393039022897],[0.25002221305353556,0.4041722881859215],[0.2496916182179469,0.3877648547898121],[0.24773614323194532,0.3777235661441127],[0.24535664443507996,0.3773067468723826],[0.24504727841190493,0.3268850902942262],[0.24972130753524896,0.325508411957282],[0.2274665089892756,0.06347702024214903],[0.21457816879521124,0.06241707178576011],[0.2124107336387888,0.053777938350179376],[0.19225430043877664,0.05313378463160466],[0.19194177953323058,-0.012251054814897452]].map(([x, y]) => ({ x, y }))
  // Every row its own colour, none repeated: a streaked pixel shows another row's.
  const rows = new ImageData(W, H)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) rows.data.set([y % 256, Math.floor(y / 256) * 40, (y * 7) % 256, 255], (y * W + x) * 4)
  const engine = new GrainEngine()
  const flat = makeFlatGrain(8, 8, 128)
  const poly = outline.map((p) => [p.x * W, p.y * H])
  const inside = (x: number, y: number) => {
    let c = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]
      const [xj, yj] = poly[j]
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
    }
    return c
  }
  const fill = (more: Partial<StreakShape>) => {
    const shape: StreakShape = {
      ...STREAK_DEFAULTS, outline, path: null, angle: -90, band: 0.012, seed: 82498, mode: 'fill', clip: true,
      measure: 'across', anchor: 'edge', lengthMin: 1, lengthMax: 1, tipAngle: 0, tipRange: 0, feather: 0, endSoftness: 0,
      ...more,
    }
    const at = (amount: number) =>
      readPixels(engine.render({
        base: rows, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
        params: {
          ...DEFAULT_BLEND_PARAMS, amount: 0,
          modules: Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES,
          effects: { ...DEFAULT_EFFECTS, streaks: { enabled: true, amount, shapes: [shape] } },
        },
      }))
    const on = at(1)
    const off = at(0)
    let total = 0
    let empty = 0
    const where: string[] = []
    const colIn = new Array(W).fill(0)
    const colEmpty = new Array(W).fill(0)
    for (let y = 0; y < H; y += 2)
      for (let x = 0; x < W; x++) {
        // Well inside only (2 px from the outline), so its antialiasing does not count.
        if (!(inside(x + 0.5, y + 0.5) && inside(x - 1.5, y) && inside(x + 2.5, y) && inside(x, y - 1.5) && inside(x, y + 2.5))) continue
        total++
        colIn[x]++
        const k = (y * W + x) * 4
        if (Math.abs(on.data[k] - off.data[k]) + Math.abs(on.data[k + 1] - off.data[k + 1]) + Math.abs(on.data[k + 2] - off.data[k + 2]) <= 6) {
          empty++
          colEmpty[x]++
          if (where.length < 6) where.push(`${x},${y}`)
        }
      }
    // Bars may end short of the far side by design; a column of the inside
    // left empty for most of its height is a whole bar that never drew.
    // Only columns that cross the shape as far as their neighbours do: one
    // that enters it through a slanted edge is shorter by the shape alone.
    const near = (x: number) => Math.max(...colIn.slice(Math.max(0, x - 40), x + 41))
    const emptyColumns = colIn.flatMap((n, x) => (n > 50 && n >= near(x) * 0.8 && colEmpty[x] > n * 0.5 ? [x] : []))
    return { total, empty, where, emptyColumns }
  }
  for (const band of [0.012, 0.03]) {
    const r = fill({ band })
    check(`a full-length streak fill covers its whole traced shape (band ${band})`, r.empty / r.total < 0.001, `${r.empty} of ${r.total} inside pixels left empty ${r.where.join(' ')}`)
  }
  // As drawn: bars of 82..100% of the way across, their ends cut at angles.
  const drawn = fill({ lengthMin: 0.82, lengthMax: 1, variation: 1, tipRange: 28 })
  // Beside an edge leaning over a bar, its centre line leaves through the side
  // early; the bar is still as long as its neighbours (here, 60% across).
  const lean = fill({ band: 0.018, lengthMin: 0.6, lengthMax: 0.6 })
  check('a bar beside a leaning edge is as long as its neighbours', lean.emptyColumns.length === 0, lean.emptyColumns.length ? `short bars at x ${lean.emptyColumns.join(',')}` : 'every column at least half drawn')
  check('no bar of a traced streak fill is left out', drawn.emptyColumns.length === 0, drawn.emptyColumns.length ? `empty columns at x ${drawn.emptyColumns.join(',')}` : `${drawn.empty} of ${drawn.total} inside pixels empty (bar ends)`)
  engine.dispose()
}

// Streak shapes and masks are placed on the photo, not the print: adding a
// border moves the photo into the print, and they must move with it.
function runBorderShapeTests() {
  const W = 300
  const H = 200
  const base = new ImageData(W, H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) base.data.set([y % 256, (x * 3) % 256, 90, 255], (y * W + x) * 4)
  const engine = new GrainEngine()
  const flat = makeFlatGrain(8, 8, 128)
  const box = [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }, { x: 0.7, y: 0.75 }, { x: 0.3, y: 0.75 }]
  const streak: StreakShape = { ...STREAK_DEFAULTS, outline: box, angle: -90, band: 0.02, seed: 3, mode: 'fill' }
  const mask: MaskShape = { ...DEFAULT_MASK, id: 'm', name: 'm', outline: [{ x: 0.1, y: 0.1 }, { x: 0.45, y: 0.1 }, { x: 0.45, y: 0.5 }, { x: 0.1, y: 0.5 }] }
  const at = (width: number) =>
    readPixels(engine.render({
      base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params: {
        ...DEFAULT_BLEND_PARAMS, amount: 0,
        modules: { ...(Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES), tone: true, border: true },
        border: { ...DEFAULT_BORDER, width, bottomExtra: 0 },
        effects: {
          ...DEFAULT_EFFECTS,
          exposure: 1,
          streaks: { enabled: true, amount: 1, shapes: [streak] },
          masks: [mask],
          maskUse: { tone: { ids: ['m'], mode: 'only' } },
        },
      },
    }))
  const plain = at(0)
  const bordered = at(0.1)
  const edge = Math.round(0.1 * Math.min(W, H))
  const bw = W + edge * 2
  let worst = 0
  // Away from the photo's edge, where the border's soft cut changes things.
  for (let y = 8; y < H - 8; y++)
    for (let x = 8; x < W - 8; x++) {
      const a = (y * W + x) * 4
      const b = ((y + edge) * bw + x + edge) * 4
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(plain.data[a + c] - bordered.data[b + c]))
    }
  check('a border does not move streak shapes or masks on the photo', worst <= 3, `max difference ${worst}`)

  // Nor does it resize them: bars of their own lengths, a feather and a
  // grain edge are measured on the photo, so each bar is the same width,
  // length and place with a border as without.
  {
    const varied: StreakShape = {
      ...streak, band: 0.03, lengthMin: 0.4, lengthMax: 1, variation: 1, tipRange: 30, feather: 0.03, endSoftness: 0.02, featherEdge: 'grain',
    }
    const shot = (width: number, units: 'photo' | 'print') =>
      readPixels(engine.render({
        base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
        params: {
          ...DEFAULT_BLEND_PARAMS, amount: 0,
          modules: { ...(Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES), border: true },
          border: { ...DEFAULT_BORDER, width, bottomExtra: 0 },
          effects: { ...DEFAULT_EFFECTS, shapeUnits: units, streaks: { enabled: true, amount: 1, shapes: [varied] } },
        },
      }))
    const diff = (a: ImageData, b: ImageData) => {
      let worst = 0
      for (let y = 8; y < H - 8; y++)
        for (let x = 8; x < W - 8; x++) {
          const i = (y * W + x) * 4
          const j = ((y + edge) * bw + x + edge) * 4
          for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(a.data[i + c] - b.data[j + c]))
        }
      return worst
    }
    const same = diff(shot(0, 'photo'), shot(0.1, 'photo'))
    check('a border does not resize streak bars measured on the photo', same <= 3, `max difference ${same}`)
    // An edit made before keeps the print's measure, so it looks as it did.
    const old = diff(shot(0, 'print'), shot(0.1, 'print'))
    check('an edit measured on the print still renders as it was made', old > 20, `max difference ${old}`)
  }

  // Saved before shapes were put on the photo, an edit's shapes are fractions
  // of the print: read as such, they land where they were drawn.
  const legacyDoc = parsePreset({
    schemaVersion: 5,
    name: 'old',
    grainSource: { kind: 'procedural', id: 'g', params: {} },
    blend: { effects: { streaks: { enabled: true, amount: 1, shapes: [streak] } } },
    output: {},
  })
  check('an edit saved before shapes were on the photo keeps them on the print', legacyDoc.blend.effects.shapeSpace === 'print')
  const fresh = parsePreset({ schemaVersion: 5, name: 'new', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { effects: { shapeSpace: 'photo', streaks: { enabled: true, amount: 1, shapes: [streak] } } }, output: {} })
  check('an edit saved since keeps its shapes on the photo', fresh.blend.effects.shapeSpace === 'photo')
  check('an edit saved before streaks were measured on the photo keeps the print\'s measure', legacyDoc.blend.effects.shapeUnits === 'print')
  check('an edit saved since is measured on the photo', parsePreset({ schemaVersion: 5, name: 'new', grainSource: { kind: 'procedural', id: 'g', params: {} }, blend: { effects: { shapeSpace: 'photo', shapeUnits: 'photo', streaks: { enabled: true, amount: 1, shapes: [streak] } } }, output: {} }).blend.effects.shapeUnits === 'photo')
  {
    const width = 0.1
    const edge = Math.round(width * Math.min(W, H))
    const pw = W + 2 * edge
    const ph = H + 2 * edge
    const onPrint = (p: { x: number; y: number }) => ({ x: (p.x * W + edge) / pw, y: (p.y * H + edge) / ph })
    const render = (shapeSpace: 'photo' | 'print', outline: { x: number; y: number }[]) =>
      readPixels(engine.render({
        base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
        params: {
          ...DEFAULT_BLEND_PARAMS, amount: 0,
          modules: { ...(Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES), border: true },
          border: { ...DEFAULT_BORDER, width, bottomExtra: 0 },
          effects: { ...DEFAULT_EFFECTS, shapeSpace, streaks: { enabled: true, amount: 1, shapes: [{ ...streak, outline }] } },
        },
      }))
    const a = render('photo', box)
    const b = render('print', box.map(onPrint))
    let off = 0
    for (let i = 0; i < a.data.length; i++) off = Math.max(off, Math.abs(a.data[i] - b.data[i]))
    check('shapes saved on the print render where they were drawn', off <= 3, `max difference ${off}`)
  }

  // The Instagram export (and the small view) render a crop of the photo,
  // its size set by the border; shapes moved onto it must land on the same
  // pixels as on the whole photo.
  for (const width of [0, 0.035, 0.1]) {
    const crop = instagramCrop({ width: W, height: H * 2 }, { ...DEFAULT_BORDER, width, bottomExtra: 0 })
    const tall = new ImageData(W, H * 2)
    for (let y = 0; y < H * 2; y++) for (let x = 0; x < W; x++) tall.data.set([y % 256, (x * 3) % 256, (y >> 8) * 60, 255], (y * W + x) * 4)
    const part = new ImageData(crop.width, crop.height)
    for (let y = 0; y < crop.height; y++)
      part.data.set(tall.data.subarray(((y + crop.y) * W + crop.x) * 4, ((y + crop.y) * W + crop.x + crop.width) * 4), y * crop.width * 4)
    const params: typeof DEFAULT_BLEND_PARAMS = {
      ...DEFAULT_BLEND_PARAMS, amount: 0,
      modules: { ...(Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES), tone: true },
      effects: {
        ...DEFAULT_EFFECTS,
        exposure: 1,
        streaks: { enabled: true, amount: 1, shapes: [{ ...streak, outline: [{ x: 0.3, y: 0.35 }, { x: 0.7, y: 0.35 }, { x: 0.7, y: 0.6 }, { x: 0.3, y: 0.6 }] }] },
        masks: [{ ...mask, outline: [{ x: 0.1, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.1, y: 0.5 }] }],
        maskUse: { tone: { ids: ['m'], mode: 'only' as const } },
      },
    }
    const shot = (img: ImageData, p: typeof params) =>
      readPixels(engine.render({ base: img, baseSize: { width: img.width, height: img.height }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001, params: p }))
    const whole = shot(tall, params)
    const cropped = shot(part, shapesOnCrop(params, { width: W, height: H * 2 }, crop))
    let off = 0
    for (let y = 8; y < crop.height - 8; y++)
      for (let x = 8; x < crop.width - 8; x++) {
        const a = ((y + crop.y) * W + x + crop.x) * 4
        const b = (y * crop.width + x) * 4
        for (let c = 0; c < 3; c++) off = Math.max(off, Math.abs(whole.data[a + c] - cropped.data[b + c]))
      }
    check(`shapes land on the same pixels on the Instagram crop (border ${width})`, off <= 3, `crop ${crop.width}×${crop.height} at ${crop.x},${crop.y}; max difference ${off}`)
  }
  engine.dispose()
}


/**
 * Collage: a piece spreads from the place clicked and stops at thin dark
 * lines, even a one-pixel diagonal one; inside it the image replaces the sky,
 * on a line the photo is kept; a crop of the photo (the Instagram size) gets
 * the very same pixels.
 */
async function runCollageTests() {
  const W = 400
  const H = 300
  const photo = document.createElement('canvas')
  photo.width = W
  photo.height = H
  const ctx = photo.getContext('2d')!
  const sky = ctx.createLinearGradient(0, 0, 0, H)
  sky.addColorStop(0, '#a8b4c8')
  sky.addColorStop(1, '#cfd3da')
  ctx.fillStyle = sky
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#1a1c20'
  ctx.lineWidth = 1.2
  ctx.beginPath()
  ctx.moveTo(0, 40)
  ctx.lineTo(W, 260)
  ctx.stroke()
  // A big dark shape (a roof) standing in the top-right gap.
  ctx.fillStyle = '#2c3440'
  ctx.fillRect(360, 50, 40, 40)
  // A camera's sharpening: a bright halo either side of the thick wire.
  ctx.strokeStyle = '#eef3fa'
  ctx.lineWidth = 1.5
  for (const off of [-3, 3]) {
    ctx.beginPath()
    ctx.moveTo(0, 150 + off)
    ctx.lineTo(W, 140 + off)
    ctx.stroke()
  }
  ctx.strokeStyle = '#1a1c20'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(0, 150)
  ctx.lineTo(W, 140)
  ctx.stroke()
  const base = ctx.getImageData(0, 0, W, H)
  const seed = 4242
  setCollagePhoto(seed, photo, { width: W, height: H })
  const ic = document.createElement('canvas')
  ic.width = 64
  ic.height = 64
  const ix = ic.getContext('2d')!
  ix.fillStyle = '#ff8030'
  ix.fillRect(0, 0, 64, 64)
  const orangeLin = 0.2126 * srgbToLinear(1) + 0.7152 * srgbToLinear(0x80 / 255) + 0.0722 * srgbToLinear(0x30 / 255)
  registerCollageImage({ id: 'img_test', name: 'test', bitmap: await createImageBitmap(ic), thumb: '', luma: { width: 1, height: 1, data: new Float32Array([orangeLin]) } })
  // Above both lines, on the right.
  const piece: CollagePiece = { ...DEFAULT_COLLAGE_PIECE, id: 'p1', image: 'img_test', seeds: [{ x: 0.85, y: 0.1 }], x: 0.5, y: 0.5, scale: 3 }
  const maps = pieceMaps(seed, piece)
  check('a collage piece is found where it was clicked', !!maps && pieceContains(maps, 0.85, 0.1))
  // Below the one-pixel diagonal (x 40: the line is at y 62), above the wire.
  check('a collage piece stops at a one-pixel diagonal line', !!maps && !pieceContains(maps, 0.1, 0.4))
  check('a collage piece stops at a wire', !!maps && !pieceContains(maps, 0.85, 0.8))

  const engine = new GrainEngine()
  const flat = makeFlatGrain(8, 8, 128)
  const off = Object.fromEntries(Object.keys(DEFAULT_MODULES).map((k) => [k, false])) as unknown as typeof DEFAULT_MODULES
  const params = {
    ...DEFAULT_BLEND_PARAMS,
    amount: 0,
    modules: off,
    effects: { ...DEFAULT_EFFECTS, collage: { enabled: true, photo: seed, scale: 1, pieces: [piece] } },
  }
  const render = (src: ImageData, crop?: Rect) =>
    readPixels(engine.render({
      base: src, baseSize: { width: src.width, height: src.height }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params, imageSeed: seed, ...(crop ? { photoCrop: crop } : {}),
    }))
  const out = render(base)
  const px = (img: ImageData, x: number, y: number) => Array.from(img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 3))
  const inside = px(out, 340, 30)
  check('inside a piece the image replaces the sky', inside[0] > inside[2] + 60, `rgb ${inside.join(',')} (sky was ${px(base, 340, 30).join(',')})`)
  // On the wire, inside the band either side of it: kept as it was.
  const wireAt = px(out, 340, 141)
  const wireWas = px(base, 340, 141)
  check('a wire through a piece keeps its colour', wireAt.every((v, c) => Math.abs(v - wireWas[c]) <= 12), `rgb ${wireAt.join(',')} was ${wireWas.join(',')}`)
  // The halo just above the wire (x 340: wire at 141.5, halo at 138.5) is sky.
  const halo = px(out, 340, 138)
  check('a sharpening halo beside a wire takes the new image', halo[0] > halo[2] + 40, `rgb ${halo.join(',')} (was ${px(base, 340, 138).join(',')})`)
  // Just past the one-pixel diagonal, in the next gap (x 40: the line at 62):
  // the piece above it must not reach across.
  const across = [64, 65, 66].map((y) => {
    const now = px(out, 40, y)
    const was = px(base, 40, y)
    return Math.max(...now.map((v, c) => Math.abs(v - was[c])))
  })
  check('a piece does not bleed across a thin line into the next gap', Math.max(...across) <= 6, `changed by ${across.join(', ')}`)
  const other = px(out, 40, 120)
  const otherWas = px(base, 40, 120)
  check('outside a piece the photo is untouched', other.every((v, c) => Math.abs(v - otherWas[c]) <= 1), `rgb ${other.join(',')} was ${otherWas.join(',')}`)
  // Matched brightness: the orange sits at the sky's own brightness.
  const lum = (c: number[]) => 0.2126 * srgbToLinear(c[0] / 255) + 0.7152 * srgbToLinear(c[1] / 255) + 0.0722 * srgbToLinear(c[2] / 255)
  const ratio = lum(inside) / lum(px(base, 340, 30))
  check('a piece is laid in at the brightness of what it replaces', ratio > 0.8 && ratio < 1.25, `ratio ${ratio.toFixed(2)}`)

  // A crop of the photo, as the Instagram size renders it.
  const cx = 100
  const cw = 240
  const cropped = new ImageData(cw, H)
  for (let y = 0; y < H; y++) cropped.data.set(base.data.subarray((y * W + cx) * 4, (y * W + cx + cw) * 4), y * cw * 4)
  const part = render(cropped, { x: cx / W, y: 0, width: cw / W, height: 1 })
  let worst = 0
  for (let y = 0; y < H; y++)
    for (let x = 2; x < cw - 2; x++)
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(part.data[(y * cw + x) * 4 + c] - out.data[(y * W + x + cx) * 4 + c]))
  check('a crop of the photo gets the same collage pixels', worst <= 3, `max difference ${worst}`)

  // Turned: the image is rotated about its centre, the crop still agrees, and
  // the placement held to cover the piece covers it turned too.
  const turned = { ...piece, rotation: 30 }
  const pTurned = { ...params, effects: { ...params.effects, collage: { enabled: true, photo: seed, scale: 1, pieces: [turned] } } }
  const renderT = (src: ImageData, crop?: Rect) =>
    readPixels(engine.render({
      base: src, baseSize: { width: src.width, height: src.height }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params: pTurned, imageSeed: seed, ...(crop ? { photoCrop: crop } : {}),
    }))
  const outT = renderT(base)
  const partT = renderT(cropped, { x: cx / W, y: 0, width: cw / W, height: 1 })
  let worstT = 0
  for (let y = 0; y < H; y++)
    for (let x = 2; x < cw - 2; x++)
      for (let c = 0; c < 3; c++) worstT = Math.max(worstT, Math.abs(partT.data[(y * cw + x) * 4 + c] - outT.data[(y * W + x + cx) * 4 + c]))
  check('a turned collage image renders the same on a crop', worstT <= 3, `max difference ${worstT}`)
  // With a strong colour look, a wire beside a piece that keeps its own colour
  // stays the photo's own dark, not graded into a coloured line round it.
  {
    const graded = {
      ...params,
      modules: { ...params.modules, colour: true },
      effects: {
        ...params.effects,
        grade: {
          ...DEFAULT_GRADE,
          mapAmount: 1,
          mapShadow: { source: 'manual' as const, colour: [0.05, 0.08, 0.3] as [number, number, number] },
          mapMid: { source: 'manual' as const, colour: [1, 0.45, 0.1] as [number, number, number] },
          mapHigh: { source: 'manual' as const, colour: [1, 0.85, 0.6] as [number, number, number] },
        },
      },
    }
    const outG = readPixels(engine.render({
      base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params: graded, imageSeed: seed,
    }))
    // The wire's rows on the piece's side (x 340: its middle at 141).
    const off = [140, 141].map((y) => {
      const now = px(outG, 340, y)
      const was = px(base, 340, y)
      return Math.max(...now.map((v, c) => Math.abs(v - was[c])))
    })
    // Its middle is where the piece's area ends, softened over a pixel: half graded.
    check('a wire beside an own-colour piece is not graded into a coloured line', off[0] <= 14 && off[1] <= 32, `changed by ${off.join(', ')}`)
    // The roof's edge, two pixels in, takes the look as it would with no
    // collage: only thin lines keep the piece's own colour, not big shapes.
    const lookOnly = readPixels(engine.render({
      base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params: { ...graded, effects: { ...graded.effects, collage: { ...graded.effects.collage, enabled: false } } }, imageSeed: seed,
    }))
    const roof = [[362, 70], [380, 52], [397, 70]].map(([x, y]) => Math.max(...px(outG, x, y).map((v, c) => Math.abs(v - px(lookOnly, x, y)[c]))))
    check('the edge of a big shape beside a piece takes the look as before', Math.max(...roof) <= 8, `differs by ${roof.join(', ')}`)
  }
  // Two pieces, each drawn over its own area: both laid in, the wire between kept.
  {
    const second = { ...piece, id: 'p2', seeds: [{ x: 0.1, y: 0.3 }] }
    const both = { ...params, effects: { ...params.effects, collage: { enabled: true, photo: seed, scale: 1, pieces: [piece, second] } } }
    const out2 = readPixels(engine.render({
      base, baseSize: { width: W, height: H }, grain: flat, grainSize: { width: 8, height: 8 }, grainMean: 0.5, grainSd: 0.0001,
      params: both, imageSeed: seed,
    }))
    const a = px(out2, 340, 30)
    const b = px(out2, 40, 100)
    const wire = px(out2, 340, 141)
    check('several pieces are each laid into their own gap', a[0] > a[2] + 60 && b[0] > b[2] + 60, `first ${a.join(',')}, second ${b.join(',')}`)
    check('the wire between two pieces is kept', wire.every((v, c) => Math.abs(v - px(base, 340, 141)[c]) <= 12), `rgb ${wire.join(',')}`)
  }
  if (maps) {
    const held = constrainPlacement({ x: 0.5, y: 0.5, scale: 0.05, rotation: 30 }, maps, { width: 64, height: 64 }, { width: W, height: H })
    const corners = [[maps.area[0], maps.area[1]], [maps.area[2], maps.area[1]], [maps.area[0], maps.area[3]], [maps.area[2], maps.area[3]]]
    const inside = corners.every(([px, py]) => {
      const [u, v] = imageUvAt({ ...held, rotation: 30, flip: false }, { width: 64, height: 64 }, { width: W, height: H }, px, py)
      return u >= -1e-3 && u <= 1.001 && v >= -1e-3 && v <= 1.001
    })
    check('a turned image is held so it still covers its piece', inside, `scale ${held.scale.toFixed(2)}`)
  }

  // The library is per photo: an image added for one photo is not offered on
  // another, × takes it off one photo only, and it is gone once no photo has
  // it. (This page's own browser storage; the app's library is not touched.)
  {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    const g = c.getContext('2d')!
    g.fillStyle = `rgb(${Math.floor(Math.random() * 255)}, 90, 200)`
    g.fillRect(0, 0, 8, 8)
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'))
    const A = 900_000_001
    const B = 900_000_002
    const ids = async (photo: number, used: string[] = []) => (await listCollageImages(photo, used)).map((i) => i.id)
    const img = await addCollageImage(blob, 'sky.png', A)
    const onA = (await ids(A)).includes(img.id)
    const offB = !(await ids(B)).includes(img.id)
    check('a collage image is listed on the photo it was added for, not on others', onA && offB)
    const again = await addCollageImage(blob, 'sky copy.png', B)
    check('the same file added for a second photo is kept once and listed on both', again.id === img.id && (await ids(A)).includes(img.id) && (await ids(B)).includes(img.id))
    await removeCollageImage(img.id, B)
    check('removing an image on one photo leaves it on the other', !(await ids(B)).includes(img.id) && (await ids(A)).includes(img.id))
    check("an image a photo's pieces use is listed there, and becomes its own", (await ids(B, [img.id])).includes(img.id) && (await ids(B)).includes(img.id))
    await removeCollageImage(img.id, A)
    await removeCollageImage(img.id, B)
    check('an image no photo has any more is deleted', !(await ids(A, [img.id])).includes(img.id))
  }
  engine.dispose()
}


/**
 * A look coloured by a film stock and a shadow tint, with the palette off:
 * the wheels show what it adds up to (fitPalette), and the look moved onto the
 * palette comes far closer to it than the palette's old, unused colours do.
 */
async function runPaletteFitTests() {
  const W = 120
  const H = 90
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  const across = ctx.createLinearGradient(0, 0, W, 0)
  across.addColorStop(0, '#2a5d8f')
  across.addColorStop(0.5, '#c9a46b')
  across.addColorStop(1, '#5a8f3a')
  ctx.fillStyle = across
  ctx.fillRect(0, 0, W, H)
  const down = ctx.createLinearGradient(0, 0, 0, H)
  down.addColorStop(0, 'rgba(255,255,255,0.6)')
  down.addColorStop(1, 'rgba(0,0,0,0.85)')
  ctx.fillStyle = down
  ctx.fillRect(0, 0, W, H)
  const photo = await createImageBitmap(c)
  const grain = { source: makeFlatGrain(8, 8, 128), size: { width: 8, height: 8 }, mean: 0.5, sd: 0.0001 }
  const look = {
    ...DEFAULT_BLEND_PARAMS,
    amount: 0,
    effects: {
      ...DEFAULT_EFFECTS,
      stock: { id: 'turquoise', strength: 0.9, keepTone: 0 },
      grade: {
        ...DEFAULT_GRADE,
        shadowAmount: 0.74,
        shadowTint: { source: 'manual' as const, colour: [0.39, 0.14, 0.62] as [number, number, number] },
        mapAmount: 0,
      },
    },
  }
  check('a look coloured by a stock and a tint says so', offWheelColour(look).join(',') === 'film stock,shadow tint')
  const fit = fitPalette(look, photo, grain)
  // What the wheels used to show: the palette's own colours, unused, turned on.
  const stale = {
    ...look,
    effects: { ...look.effects, stock: { ...look.effects.stock, strength: 0 }, grade: { ...look.effects.grade, shadowAmount: 0, mapAmount: 0.9 } },
  }
  const near = colourError(fit.blend, look, photo, grain)
  const far = colourError(stale, look, photo, grain)
  check('a look moved onto the wheels keeps its colour', near < far * 0.6, `off by ${near.toFixed(1)} vs ${far.toFixed(1)} for the palette's old colours`)
  const accented = { ...look, effects: { ...look.effects, grade: { ...look.effects.grade, isolateAmount: 0.6, popAmount: 0.3 } } }
  const moved = fitPalette(accented, photo, grain).blend.effects
  // Paper colours from the finished look: a navy-to-orange palette gives a
  // deep blue ink and a warm, pale paper, whatever the photo's own colours.
  const tide = {
    ...DEFAULT_BLEND_PARAMS,
    amount: 0,
    effects: {
      ...DEFAULT_EFFECTS,
      grade: {
        ...DEFAULT_GRADE,
        mapAmount: 1,
        mapShadow: { source: 'manual' as const, colour: [0.06, 0.1, 0.3] as [number, number, number] },
        mapMid: { source: 'manual' as const, colour: [0.2, 0.45, 0.5] as [number, number, number] },
        mapHigh: { source: 'manual' as const, colour: [1, 0.7, 0.4] as [number, number, number] },
      },
    },
  }
  const papers = lookPapers(tide, photo, grain)
  const ink = papers[0].colour
  const paper = papers[3].colour
  const lum = (c: number[]) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
  check('the border ink is the look’s deep blue', ink[2] > ink[0] + 0.02 && lum(ink) < 0.15, `ink ${ink.map((v) => v.toFixed(2)).join(',')}`)
  check('the border paper is the look’s warm light, pale', paper[0] > paper[2] && lum(paper) > 0.8, `paper ${paper.map((v) => v.toFixed(2)).join(',')}`)
  check(
    'moving onto the wheels keeps Isolate and Pop, and drops the stock and tint',
    moved.grade.isolateAmount === 0.6 && moved.grade.popAmount === 0.3 && moved.stock.strength === 0 && moved.grade.shadowAmount === 0 && moved.grade.mapAmount > 0,
  )
}

// Each suite on its own, so one that throws (an API a browser lacks, say)
// does not hide the results of the rest.
for (const [name, suite] of [
  ['engine', run],
  ['generator', runGeneratorTests],
  ['presets', runPresetTests],
  ['instagram', runInstagramTests],
  ['parts', runPartTests],
  ['recipes', runRecipeTests],
  ['decode', runDecodeTests],
  ['lightshade', runLightShadeTests],
  ['streak fill', runStreakFillTests],
  ['border shapes', runBorderShapeTests],
  ['collage', runCollageTests],
  ['palette fit', runPaletteFitTests],
  ['colour recipes', runColourRecipeTests],
  ['module stack', runModuleStackTests],
  ['new modules', runNewModuleTests],
  ['prepare passes', runPrepareTests],
  ['shape masks', runShapeMaskTests],
  ['each module alone', runModuleAloneTests],
  ['crop and export presets', runCropExportTests],
] as const) {
  try {
    await suite()
  } catch (err) {
    failures++
    results.push(` FAIL  ${name} suite threw: ${(err as Error).message}`)
  }
}

const summary = failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`
const report = `${summary}\n${navigator.userAgent}\n\n${results.join('\n')}`
document.getElementById('out')!.textContent = report
;(window as any).__selftest = { failures, results }
// ?save=<name>: write the report to out/ through the dev server, to compare
// browsers (WebKit for a Tauri build, say) without reading their windows.
const saveAs = new URLSearchParams(location.search).get('save')
if (saveAs && /^[\w-]+$/.test(saveAs))
  void fetch('/__save', { method: 'POST', headers: { 'x-filename': `selftest-${saveAs}.txt` }, body: report })
