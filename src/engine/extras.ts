/**
 * The creative modules that came after the first set: black & white film,
 * halftone and riso print, a lens in front of the camera, a second exposure
 * on the same frame, and the date the camera printed in the corner.
 *
 * Black & white and halftone are worked out per pixel in the main pass.
 * The lens, the second exposure and the date are laid into the photo before
 * it (GrainEngine's prepare passes): they happen in the camera, so the
 * grain, the glow and the rest of the look go on top of them.
 */

type Rgb = [number, number, number]

/* ------------------------------------------------------------------ mono */

export type MonoFilter = 'none' | 'yellow' | 'orange' | 'red' | 'green' | 'blue'

export type MonoTone = 'none' | 'sepia' | 'selenium' | 'cyan' | 'gold'

export interface MonoParams {
  enabled: boolean
  /** A toner on the print, and how strong. */
  tone: MonoTone
  toneAmount: number
  /** 0..1: how far to black and white. */
  amount: number
  /** The coloured filter on the lens: which colours print light. */
  filter: MonoFilter
  /** -1..1: the film's contrast. */
  contrast: number
}

export const DEFAULT_MONO: MonoParams = { enabled: false, amount: 1, filter: 'none', contrast: 0, tone: 'none', toneAmount: 0.6 }

export const MONO_TONES: { id: MonoTone; label: string; hint: string; colour: Rgb }[] = [
  { id: 'none', label: 'None', hint: 'Neutral black and white', colour: [1, 1, 1] },
  { id: 'sepia', label: 'Sepia', hint: 'Warm brown, as an old print', colour: [0.84, 0.66, 0.46] },
  { id: 'selenium', label: 'Selenium', hint: 'A cool purple-brown in the shadows', colour: [0.7, 0.62, 0.72] },
  { id: 'cyan', label: 'Cyanotype', hint: 'Prussian blue, as a sun print', colour: [0.4, 0.6, 0.82] },
  { id: 'gold', label: 'Gold', hint: 'A cool blue-black, as gold toner gives', colour: [0.62, 0.68, 0.78] },
]

export const monoTone = (t: MonoTone): Rgb => (MONO_TONES.find((m) => m.id === t) ?? MONO_TONES[0]).colour

export const MONO_FILTERS: { id: MonoFilter; label: string; hint: string; mix: Rgb }[] = [
  { id: 'none', label: 'None', hint: 'No filter', mix: [0.2126, 0.7152, 0.0722] },
  { id: 'yellow', label: 'Yellow', hint: 'Slightly darker skies, clouds stand out', mix: [0.36, 0.56, 0.08] },
  { id: 'orange', label: 'Orange', hint: 'Darker skies, smoother skin', mix: [0.5, 0.45, 0.05] },
  { id: 'red', label: 'Red', hint: 'Very dark skies, bright foliage', mix: [0.7, 0.28, 0.02] },
  { id: 'green', label: 'Green', hint: 'Foliage light, skin and lips darker', mix: [0.15, 0.78, 0.07] },
  { id: 'blue', label: 'Blue', hint: 'Pale skies, darker skin, like orthochromatic film', mix: [0.08, 0.32, 0.6] },
]

export const monoMix = (f: MonoFilter): Rgb => (MONO_FILTERS.find((m) => m.id === f) ?? MONO_FILTERS[0]).mix

/* ------------------------------------------------------------- halftone */

export type HalftoneStyle = 'dots' | 'lines' | 'riso'

export interface HalftoneParams {
  enabled: boolean
  style: HalftoneStyle
  /** 0..1: how much of the picture is screened. */
  amount: number
  /** The screen's cell, as a share of the photo's short side. */
  cell: number
  /** Screen angle, degrees. */
  angle: number
  /** Riso: the two inks, dark and light. */
  inkA: Rgb
  inkB: Rgb
  /** Riso: how far the second ink's plate slips, as a share of the short side. */
  slip: number
  /** The paper under the ink. */
  paper: Rgb
}

export const DEFAULT_HALFTONE: HalftoneParams = {
  enabled: false,
  style: 'dots',
  amount: 1,
  cell: 0.008,
  angle: 45,
  inkA: [0.12, 0.25, 0.62],
  inkB: [1, 0.36, 0.45],
  slip: 0.002,
  paper: [0.96, 0.94, 0.88],
}

/** Riso ink pairs, after the drum colours print shops stock. */
export const RISO_INKS: { name: string; a: Rgb; b: Rgb }[] = [
  { name: 'Blue & pink', a: [0.12, 0.25, 0.62], b: [1, 0.36, 0.45] },
  { name: 'Teal & orange', a: [0.0, 0.47, 0.51], b: [1, 0.42, 0.13] },
  { name: 'Green & yellow', a: [0.0, 0.47, 0.32], b: [1, 0.85, 0.15] },
  { name: 'Purple & yellow', a: [0.38, 0.22, 0.6], b: [1, 0.85, 0.15] },
  { name: 'Black & red', a: [0.1, 0.1, 0.12], b: [0.9, 0.18, 0.2] },
]

/* ------------------------------------------------------------------ lens */

export interface LensParams {
  enabled: boolean
  /** -1..1: pincushion to barrel and fisheye bulge. */
  distortion: number
  /** 0..1: colour fringes toward the edges, red and blue apart. */
  fringe: number
  /** 0..1: a diffusion filter's soft glow round the highlights, and a little haze. */
  diffusion: number
  /** 0..1: softness toward the corners, as a cheap lens has. */
  softEdges: number
  /** 0..1: a tilt-shift band: sharp across, soft above and below. */
  tilt: number
  /** Where the sharp band is, top (0) to bottom (1). */
  focus: number
  /** How wide the sharp band is, as a share of the height. */
  focusWidth: number
}

export const DEFAULT_LENS: LensParams = {
  enabled: false,
  distortion: 0,
  fringe: 0,
  diffusion: 0,
  softEdges: 0,
  tilt: 0,
  focus: 0.55,
  focusWidth: 0.2,
}

export const lensOn = (l: LensParams): boolean =>
  l.enabled && (l.distortion !== 0 || l.fringe > 0 || l.diffusion > 0 || l.softEdges > 0 || l.tilt > 0)

/* ----------------------------------------------------------------- prism */

/**
 * Prism: the photo's colours pulled apart, as light through a prism or a
 * glass edge in front of the lens: red one way, blue the other, or a smooth
 * rainbow between them. The streaks' own prism does this along their bars;
 * this does it to the whole photo, before the look, so the grain is on top.
 */
export interface PrismParams {
  enabled: boolean
  /** 0..1: how far apart the colours go, up to 3% of the photo's short side. */
  split: number
  /** straight: the same split everywhere, along `angle`; radial: out from the middle, none there and most at the corners. */
  shape: 'straight' | 'radial'
  /** Straight: the way red goes, degrees (0 to the right, 90 down); blue goes the other way. */
  angle: number
  /** rgb: red and blue apart, green between; spectrum: a smooth rainbow across the split. */
  colours: 'rgb' | 'spectrum'
  /** 0..1: only what is bright splits, as light does through glass; 0 everything. */
  light: number
  /** 0..1: how much of the split shows. */
  amount: number
}

export const DEFAULT_PRISM: PrismParams = {
  enabled: false,
  split: 0,
  shape: 'straight',
  angle: 0,
  colours: 'rgb',
  light: 0,
  amount: 1,
}

export const prismOn = (p: PrismParams | undefined): p is PrismParams => !!p && p.enabled && p.split > 0 && p.amount > 0

/** The split's full width at its widest, as a share of the short side, at split 1. */
export const PRISM_MAX = 0.03

export const PRISM_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform vec2 uSize;        // the photo in pixels
uniform vec2 uOffset;      // straight: red's read to blue's, in uv
uniform int uRadial;
uniform float uSplitPx;    // radial: red's read to blue's at the corners, in pixels
uniform int uSpectrum;
uniform float uLight;
uniform float uAmount;
out vec4 outColor;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
vec3 at(vec2 uv) { return toLinear(texture(uSource, clamp(uv, vec2(0.0), vec2(1.0))).rgb); }
// How much of each colour a read at t (-1 red's end, 1 blue's) brings: a
// rainbow's bands, overlapping.
vec3 band(float t) {
  vec3 d = (vec3(t) - vec3(-0.7, 0.0, 0.7)) / vec3(0.45, 0.4, 0.45);
  return exp(-d * d);
}
void main() {
  vec4 src = texture(uSource, vUv);
  vec3 here = toLinear(src.rgb);
  vec2 off = uOffset;
  if (uRadial == 1) {
    vec2 d = (vUv - 0.5) * uSize;
    float corner = 0.5 * length(uSize);
    float r = length(d) / corner;
    off = length(d) > 0.5 ? normalize(d) * r * uSplitPx / uSize : vec2(0.0);
  }
  vec3 sum = vec3(0.0);
  vec3 weight = vec3(0.0);
  float peak = 0.0;
  int n = uSpectrum == 1 ? 9 : 3;
  for (int i = 0; i < 9; i++) {
    if (i >= n) break;
    float t = -1.0 + 2.0 * float(i) / float(n - 1);
    // Red (t -1) is read from behind, so it moves ahead along the split; blue the other way.
    vec3 c = at(vUv + off * 0.5 * t);
    vec3 w = uSpectrum == 1 ? band(t) : vec3(i == 0 ? 1.0 : 0.0, i == 1 ? 1.0 : 0.0, i == 2 ? 1.0 : 0.0);
    sum += c * w;
    weight += w;
    peak = max(peak, dot(c, vec3(0.2126, 0.7152, 0.0722)));
  }
  vec3 split = sum / max(weight, vec3(1e-4));
  // Only the light: where the brightest read is bright enough, so a lamp
  // splits and the dark round it takes its fringes, but the rest stays.
  float m = uAmount;
  if (uLight > 0.0) m *= smoothstep(uLight * 0.6, uLight, peak);
  outColor = vec4(clamp(toSrgb(mix(here, split, m)), 0.0, 1.0), src.a);
}`

export function parsePrism(value: unknown): PrismParams {
  const x = obj(value)
  const d = DEFAULT_PRISM
  return {
    enabled: bool(x.enabled, d.enabled),
    split: num(x.split, d.split, 0, 1),
    shape: x.shape === 'radial' ? 'radial' : 'straight',
    angle: num(x.angle, d.angle, -180, 180),
    colours: x.colours === 'spectrum' ? 'spectrum' : 'rgb',
    light: num(x.light, d.light, 0, 1),
    amount: num(x.amount, d.amount, 0, 1),
  }
}

/* ------------------------------------------------------- double exposure */

export type DoubleMode = 'screen' | 'lighten' | 'multiply' | 'overlay'

export interface DoubleParams {
  enabled: boolean
  /** The second photo, from the Collage library (collageImages). */
  image: string | null
  mode: DoubleMode
  /** 0..1: how strong the second exposure is. */
  amount: number
  /** Its centre on the photo, in fractions. */
  x: number
  y: number
  /** 1 covers the photo; larger zooms in. */
  scale: number
  flip: boolean
  /** Take its colour (0) or only its light (1). */
  mono: number
}

export const DEFAULT_DOUBLE: DoubleParams = {
  enabled: false,
  image: null,
  mode: 'screen',
  amount: 0.7,
  x: 0.5,
  y: 0.5,
  scale: 1,
  flip: false,
  mono: 0,
}

export const DOUBLE_MODES: { id: DoubleMode; label: string; hint: string }[] = [
  { id: 'screen', label: 'Screen', hint: 'Light adds to light, as two exposures on one frame of film do' },
  { id: 'lighten', label: 'Lighten', hint: 'Keeps whichever is brighter, so silhouettes fill with the other photo' },
  { id: 'multiply', label: 'Multiply', hint: 'Darks add to darks, as two negatives sandwiched together' },
  { id: 'overlay', label: 'Overlay', hint: 'The second photo as texture over the first' },
]

export const doubleOn = (d: DoubleParams): boolean => d.enabled && !!d.image && d.amount > 0

/* ------------------------------------------------------------ date stamp */

/**
 * The date as real cameras printed it:
 * - digicam: a digital camera writing the date into the picture, upright
 *   condensed amber digits with a thin black edge, 10/31/2026.
 * - film: a film camera's quartz date back, which exposes the date onto the
 *   film from behind with LEDs: slanted seven-segment digits, a blank where
 *   a leading zero would be ('98  6 22), light rather than ink (strong on
 *   shadows, lost in a bright sky), a yellow-orange core in a red halo.
 */
export type StampTheme = 'digicam' | 'film'
export type StampFormat =
  | 'mm/dd/yyyy'
  | 'dd/mm/yyyy'
  | 'yyyy/mm/dd'
  | 'mm/dd/yyyy-time'
  | 'yy-mm-dd'
  | 'mm-dd-yy'
  | 'dd-mm-yy'
  | 'custom'
export type StampCorner = 'br' | 'bl' | 'tr' | 'tl'

export interface StampParams {
  enabled: boolean
  theme: StampTheme
  format: StampFormat
  /** What is printed when format is custom: digits and ' . - : / and spaces. */
  custom: string
  corner: StampCorner
  /** The stamp's colour. */
  colour: Rgb
  /** Digit height, as a share of the photo's short side. */
  size: number
  /** 0..1: how much the digits bloom into the film. */
  glow: number
  /** When the photo was taken, "YYYY-MM-DD" or "YYYY-MM-DD HH:MM", read from it when it opens. Belongs to the photo. */
  date: string
}

export const STAMP_THEMES: { id: StampTheme; label: string; hint: string; look: Pick<StampParams, 'format' | 'colour' | 'corner' | 'size' | 'glow'> }[] = [
  {
    id: 'digicam',
    label: 'Digital camera',
    hint: 'A digital camera writing the date into the picture: upright amber digits with a thin black edge',
    look: { format: 'mm/dd/yyyy', colour: [0.91, 0.67, 0.27], corner: 'br', size: 0.045, glow: 0 },
  },
  {
    id: 'film',
    label: 'Film date back',
    hint: "A film camera's quartz date back: LED digits exposed onto the film, glowing, lost in bright skies",
    look: { format: 'yy-mm-dd', colour: [1, 0.62, 0.18], corner: 'br', size: 0.032, glow: 0.6 },
  },
]

export const DEFAULT_STAMP: StampParams = {
  enabled: false,
  theme: 'digicam',
  custom: '',
  date: '',
  ...STAMP_THEMES[0].look,
}

export const STAMP_COLOURS: { name: string; colour: Rgb }[] = [
  { name: 'Amber', colour: [0.91, 0.67, 0.27] },
  { name: 'Orange', colour: [1, 0.62, 0.18] },
  { name: 'Red', colour: [1, 0.3, 0.14] },
  { name: 'Yellow', colour: [1, 0.86, 0.32] },
]

/** Which formats each kind of camera printed. A quartz date back has fixed digit slots and a two-digit year. */
export const STAMP_FORMATS: { id: StampFormat; label: string; theme: StampTheme | 'both' }[] = [
  { id: 'mm/dd/yyyy', label: '10/31/2026', theme: 'digicam' },
  { id: 'dd/mm/yyyy', label: '31/10/2026', theme: 'digicam' },
  { id: 'yyyy/mm/dd', label: '2026/10/31', theme: 'digicam' },
  { id: 'mm/dd/yyyy-time', label: '10/31/2026 8:08 PM', theme: 'digicam' },
  { id: 'yy-mm-dd', label: "'26 10 31", theme: 'film' },
  { id: 'mm-dd-yy', label: "10 31 '26", theme: 'film' },
  { id: 'dd-mm-yy', label: "31 10 '26", theme: 'film' },
  { id: 'custom', label: 'Your own', theme: 'both' },
]

/** The printed text. "_" is a digit slot left blank, as a date back shows a month below ten. */
export function stampText(s: StampParams, today = new Date()): string {
  if (s.format === 'custom') return s.custom.replace(/[^0-9 '.\-:/]/g, '').slice(0, 20)
  const m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?$/.exec(s.date)
  const pad = (n: number) => String(n).padStart(2, '0')
  const [y, mo, d] = m ? [m[1], m[2], m[3]] : [String(today.getFullYear()), pad(today.getMonth() + 1), pad(today.getDate())]
  const slot = (v: string) => (v.startsWith('0') ? `_${v[1]}` : v)
  const yy = `'${y.slice(2)}`
  switch (s.format) {
    case 'mm/dd/yyyy':
      return `${mo}/${d}/${y}`
    case 'dd/mm/yyyy':
      return `${d}/${mo}/${y}`
    case 'yyyy/mm/dd':
      return `${y}/${mo}/${d}`
    case 'mm/dd/yyyy-time': {
      if (!m?.[4]) return `${mo}/${d}/${y}`
      const h = Number(m[4])
      return `${mo}/${d}/${y} ${h % 12 || 12}:${m[5]}`
    }
    case 'yy-mm-dd':
      return `${yy} ${slot(mo)} ${slot(d)}`
    case 'mm-dd-yy':
      return `${slot(mo)} ${slot(d)} ${yy}`
    case 'dd-mm-yy':
      return `${slot(d)} ${slot(mo)} ${yy}`
  }
}

/** The text as the panel shows it: blank slots as spaces. */
export const stampLabel = (text: string) => text.replace(/_/g, ' ')

/** The segments lit for each character of a seven-segment display: a b c d e f g. */
const SEGMENTS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g',
}

/** A canvas this big, in the page or a worker. */
function makeCanvas(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h })
}

/** The digital camera's type: DIN condensed on a Mac, its kin elsewhere. */
const DIGICAM_FONT = '"DIN Condensed", "Bahnschrift SemiCondensed", "Roboto Condensed", "Arial Narrow", sans-serif'

/**
 * The stamp, drawn on opaque black so each channel is a light or a shade of
 * its own, which the lens pass lays into the photo:
 * - red: the characters;
 * - green: the same blurred, for the bloom;
 * - blue: a dark edge round them (the digital camera's).
 * Digits are `px` tall.
 */
export function drawStamp(text: string, px: number, theme: StampTheme = 'film'): HTMLCanvasElement | OffscreenCanvas | null {
  const h = Math.max(8, Math.round(px))
  return theme === 'digicam' ? drawDigicam(text, h) : drawDateBack(text, h)
}

function drawDigicam(text: string, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  // DIN's figures are about 0.7 of the font size; the camera's are a touch wider.
  const size = h / 0.7
  const font = `bold ${size}px ${DIGICAM_FONT}`
  const stretch = 1.1
  // The camera's characters sit a little apart.
  const spacing = h * 0.19
  const probe = makeCanvas(4, 4).getContext('2d') as CanvasRenderingContext2D | null
  if (!probe) return null
  probe.font = font
  const pad = Math.round(h * 0.5)
  const W = Math.ceil(probe.measureText(text.replace(/_/g, '0')).width * stretch + spacing * text.length + pad * 2)
  const H = Math.ceil(h + pad * 2)
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return null
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  ctx.font = font
  ctx.textBaseline = 'alphabetic'
  ctx.lineJoin = 'round'
  const draw = (style: string, edge: number) => {
    ctx.save()
    ctx.translate(pad, pad + h)
    ctx.scale(stretch, 1)
    let x = 0
    for (const ch of text) {
      // Blank slots keep a digit's width.
      if (ch !== '_') {
        if (edge > 0) {
          ctx.strokeStyle = style
          ctx.lineWidth = edge
          ctx.strokeText(ch, x, 0)
        } else {
          ctx.fillStyle = style
          ctx.fillText(ch, x, 0)
        }
      }
      x += ctx.measureText(ch === '_' ? '0' : ch).width + spacing / stretch
    }
    ctx.restore()
  }
  // The black edge round every character, then the characters.
  draw('rgb(0,0,255)', Math.max(1.5, h * 0.15))
  draw('rgb(255,0,0)', 0)
  return canvas
}

function drawDateBack(text: string, h: number): HTMLCanvasElement | OffscreenCanvas | null {
  const w0 = h * 0.52
  const gap = h * 0.16
  const charW = (ch: string) => (ch === ' ' ? h * 0.32 : ch === "'" || ch === '.' || ch === ':' ? h * 0.18 : w0) + gap
  const pad = Math.round(h * 0.6)
  const W = Math.ceil([...text].reduce((s, ch) => s + charW(ch), 0) + h * 0.6 + pad * 2)
  const H = Math.ceil(h + pad * 2)
  const canvas = makeCanvas(W, H)
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | null
  if (!ctx) return null
  const t = h * 0.12 // segment thickness
  const segments = (style: string) => {
    ctx.save()
    ctx.translate(pad + h * 0.2, pad)
    ctx.transform(1, 0, -0.12, 1, h * 0.12, 0) // the LCD's slant
    ctx.fillStyle = style
    let x = 0
    for (const ch of text) {
      const segs = SEGMENTS[ch]
      if (segs) {
        const L = x
        const R = x + w0
        const M = h / 2
        // A segment with chamfered ends and a hair of gap at each, as the LEDs have.
        const seg = (x0: number, y0: number, x1: number, y1: number) => {
          ctx.beginPath()
          if (y0 === y1) {
            ctx.moveTo(x0 + t * 0.7, y0)
            ctx.lineTo(x0 + t * 1.1, y0 - t / 2)
            ctx.lineTo(x1 - t * 1.1, y0 - t / 2)
            ctx.lineTo(x1 - t * 0.7, y0)
            ctx.lineTo(x1 - t * 1.1, y0 + t / 2)
            ctx.lineTo(x0 + t * 1.1, y0 + t / 2)
          } else {
            ctx.moveTo(x0, y0 + t * 0.7)
            ctx.lineTo(x0 + t / 2, y0 + t * 1.1)
            ctx.lineTo(x0 + t / 2, y1 - t * 1.1)
            ctx.lineTo(x0, y1 - t * 0.7)
            ctx.lineTo(x0 - t / 2, y1 - t * 1.1)
            ctx.lineTo(x0 - t / 2, y0 + t * 1.1)
          }
          ctx.closePath()
          ctx.fill()
        }
        if (segs.includes('a')) seg(L, 0, R, 0)
        if (segs.includes('b')) seg(R, 0, R, M)
        if (segs.includes('c')) seg(R, M, R, h)
        if (segs.includes('d')) seg(L, h, R, h)
        if (segs.includes('e')) seg(L, M, L, h)
        if (segs.includes('f')) seg(L, 0, L, M)
        if (segs.includes('g')) seg(L, M, R, M)
      } else if (ch === "'") ctx.fillRect(x + t * 0.2, -t * 0.2, t * 0.9, h * 0.32)
      else if (ch === '.') ctx.fillRect(x + t * 0.2, h - t, t * 1.1, t * 1.1)
      else if (ch === ':') {
        ctx.fillRect(x + t * 0.2, h * 0.25, t, t)
        ctx.fillRect(x + t * 0.2, h * 0.7, t, t)
      } else if (ch === '/') ctx.fillRect(x + w0 * 0.4, 0, t, h)
      // "_" and " ": blank.
      x += ch === '_' ? w0 + gap : charW(ch)
    }
    ctx.restore()
  }
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  ctx.globalCompositeOperation = 'lighter'
  // The LEDs are imaged through the film base, so even the core is a little
  // soft: drawn through a small blur (a shadow cast from out of view).
  const blurred = (style: string, blur: number) => {
    ctx.save()
    ctx.shadowColor = style
    ctx.shadowBlur = blur
    ctx.shadowOffsetX = W * 4
    ctx.translate(-W * 4, 0)
    segments(style)
    ctx.restore()
  }
  blurred('rgb(255,0,0)', Math.max(1, h * 0.06))
  blurred('rgb(0,255,0)', Math.max(2, h * 0.4))
  return canvas
}

/* ----------------------------------------------------------------- parse */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const num = (v: unknown, fallback: number, lo: number, hi: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback
const bool = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback)
const rgb = (v: unknown, fallback: Rgb): Rgb =>
  Array.isArray(v) && v.length === 3 && v.every((c) => typeof c === 'number' && Number.isFinite(c))
    ? (v.map((c) => clamp(c as number, 0, 1)) as Rgb)
    : fallback
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (options.includes(v as T) ? (v as T) : fallback)
const obj = (v: unknown) => (v ?? {}) as Record<string, unknown>

export function parseMono(value: unknown): MonoParams {
  const m = obj(value)
  const d = DEFAULT_MONO
  return {
    enabled: bool(m.enabled, d.enabled),
    amount: num(m.amount, d.amount, 0, 1),
    filter: pick(m.filter, MONO_FILTERS.map((f) => f.id), d.filter),
    contrast: num(m.contrast, d.contrast, -1, 1),
    tone: pick(m.tone, MONO_TONES.map((t) => t.id), d.tone),
    toneAmount: num(m.toneAmount, d.toneAmount, 0, 1),
  }
}

export function parseHalftone(value: unknown): HalftoneParams {
  const h = obj(value)
  const d = DEFAULT_HALFTONE
  return {
    enabled: bool(h.enabled, d.enabled),
    style: pick(h.style, ['dots', 'lines', 'riso'] as const, d.style),
    amount: num(h.amount, d.amount, 0, 1),
    cell: num(h.cell, d.cell, 0.002, 0.04),
    angle: num(h.angle, d.angle, -90, 90),
    inkA: rgb(h.inkA, d.inkA),
    inkB: rgb(h.inkB, d.inkB),
    slip: num(h.slip, d.slip, 0, 0.02),
    paper: rgb(h.paper, d.paper),
  }
}

export function parseLens(value: unknown): LensParams {
  const l = obj(value)
  const d = DEFAULT_LENS
  return {
    enabled: bool(l.enabled, d.enabled),
    distortion: num(l.distortion, d.distortion, -1, 1),
    fringe: num(l.fringe, d.fringe, 0, 1),
    diffusion: num(l.diffusion, d.diffusion, 0, 1),
    softEdges: num(l.softEdges, d.softEdges, 0, 1),
    tilt: num(l.tilt, d.tilt, 0, 1),
    focus: num(l.focus, d.focus, 0, 1),
    focusWidth: num(l.focusWidth, d.focusWidth, 0.02, 0.8),
  }
}

export function parseDouble(value: unknown): DoubleParams {
  const x = obj(value)
  const d = DEFAULT_DOUBLE
  return {
    enabled: bool(x.enabled, d.enabled),
    image: typeof x.image === 'string' && x.image ? x.image.slice(0, 80) : null,
    mode: pick(x.mode, DOUBLE_MODES.map((m) => m.id), d.mode),
    amount: num(x.amount, d.amount, 0, 1),
    x: num(x.x, d.x, -0.5, 1.5),
    y: num(x.y, d.y, -0.5, 1.5),
    scale: num(x.scale, d.scale, 0.5, 4),
    flip: bool(x.flip, d.flip),
    mono: num(x.mono, d.mono, 0, 1),
  }
}

export function parseStamp(value: unknown): StampParams {
  const s = obj(value)
  const d = DEFAULT_STAMP
  // Stamps from before themes were the film date back's; themes that have
  // gone (dot matrix, camcorder, modern) become the digital camera's.
  const theme: StampTheme = !('theme' in s) ? 'film' : s.theme === 'film' ? 'film' : 'digicam'
  const look = STAMP_THEMES.find((t) => t.id === theme)!.look
  const format = pick(s.format, STAMP_FORMATS.map((f) => f.id), look.format)
  return {
    enabled: bool(s.enabled, d.enabled),
    theme,
    format: STAMP_FORMATS.some((f) => f.id === format && (f.theme === theme || f.theme === 'both')) ? format : look.format,
    custom: typeof s.custom === 'string' ? s.custom.slice(0, 20) : d.custom,
    corner: pick(s.corner, ['br', 'bl', 'tr', 'tl'] as const, d.corner),
    colour: rgb(s.colour, look.colour),
    size: num(s.size, look.size, 0.01, 0.12),
    glow: num(s.glow, look.glow, 0, 1),
    date: typeof s.date === 'string' && /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(s.date) ? s.date : d.date,
  }
}

/* ---------------------------------------------------------------- shaders */

/**
 * The second exposure, blended into the (developed) photo in linear light.
 * Run as part of the develop pass's output: reads the developed photo and
 * the second image, writes the frame both exposures make.
 */
export const DOUBLE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uSecond;
uniform vec2 uCentre;   // the second image's centre, photo fractions
uniform vec2 uSpan;     // its size, photo fractions
uniform float uFlip;
uniform int uMode;      // 0 screen, 1 lighten, 2 multiply, 3 overlay
uniform float uAmount;
uniform float uMono;
out vec4 outColor;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }
void main() {
  vec4 src = texture(uSource, vUv);
  vec2 q = (vUv - uCentre) / uSpan + 0.5;
  if (uFlip > 0.5) q.x = 1.0 - q.x;
  vec3 b = texture(uSecond, clamp(q, 0.0, 1.0)).rgb;
  b = mix(b, vec3(dot(b, vec3(0.2126, 0.7152, 0.0722))), uMono);
  vec3 a = src.rgb;
  vec3 r;
  if (uMode == 0) r = toSrgb(1.0 - (1.0 - toLinear(a)) * (1.0 - toLinear(b)));
  else if (uMode == 1) r = max(a, b);
  else if (uMode == 2) r = a * b;
  else r = mix(2.0 * a * b, 1.0 - 2.0 * (1.0 - a) * (1.0 - b), step(0.5, a));
  outColor = vec4(mix(a, clamp(r, 0.0, 1.0), uAmount), src.a);
}`

/**
 * The lens, and the date printed on the frame: the photo's colours split
 * toward the edges (its distortion is the main shader's, lensScene), softened by a
 * cheap lens's corners or a tilt-shift's band (read from the mipmaps), a
 * diffusion filter's glow round the highlights; then the date's LCD added as
 * light, as the camera exposes it onto the film.
 */
/** The lens's distortion at the frame's corner, per unit of LensParams.distortion (see lensScene). */
export const LENS_K = 0.45

export const LENS_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uStamp;
uniform vec2 uSize;        // the photo in pixels
uniform int uLensOn;
uniform float uFringe;
uniform float uDiffusion;
uniform float uSoftEdges;
uniform float uTilt;
uniform float uFocus;
uniform float uFocusWidth;
uniform int uStampOn;
uniform vec4 uStampRect;   // x, y, width, height in photo fractions
uniform vec3 uStampColour; // linear
uniform float uStampGlow;
uniform int uStampPaint;   // 1: written over the photo (digital), 0: exposed as light (film)
out vec4 outColor;
vec3 toLinear(vec3 c) { return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 c) { c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c)); }

vec3 at(vec2 uv, float lod) { return textureLod(uSource, clamp(uv, vec2(0.0), vec2(1.0)), lod).rgb; }

void main() {
  vec4 src = texture(uSource, vUv);
  vec3 col = src.rgb;
  if (uLensOn == 1) {
    float aspect = uSize.x / uSize.y;
    vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
    float norm = 0.25 * (aspect * aspect + 1.0);   // the corner's distance squared
    float r2 = dot(d, d) / norm;                    // 0 centre, 1 corner
    // The distortion itself is drawn with the edit (lensScene in the main
    // shader), so what is put on the photo bends with it.
    vec2 base = vUv;
    // How soft here: corners, and the tilt-shift's band.
    float band = abs(vUv.y - uFocus) - uFocusWidth * 0.5;
    float blurPx = uSoftEdges * 14.0 * r2 * r2 + uTilt * 22.0 * smoothstep(0.0, 0.35, band);
    float lod = log2(1.0 + blurPx * min(uSize.x, uSize.y) / 1200.0);
    // Red and blue apart toward the edges.
    float f = uFringe * 0.006 * r2;
    vec2 dir = vUv - 0.5;
    col = vec3(
      at(base + dir * f, lod).r,
      at(base, lod).g,
      at(base - dir * f, lod).b
    );
    if (uDiffusion > 0.0) {
      vec3 lin = toLinear(col);
      vec3 wide = toLinear(at(base, 4.5 + log2(max(uSize.x, uSize.y) / 2000.0 + 1.0)));
      // The highlights spread; a little haze lifts everything.
      vec3 spill = max(wide - 0.25, 0.0) * 0.9;
      lin = lin + spill * uDiffusion + (wide - lin) * uDiffusion * 0.12;
      col = toSrgb(lin);
    }
  }
  if (uStampOn == 1) {
    vec2 q = (vUv - uStampRect.xy) / uStampRect.zw;
    if (q.x >= 0.0 && q.y >= 0.0 && q.x <= 1.0 && q.y <= 1.0) {
      vec3 s = texture(uStamp, q).rgb;
      vec3 lin = toLinear(col);
      // A dark edge or shadow behind the characters (the digital themes).
      lin *= 1.0 - s.b * (uStampPaint == 1 ? 0.92 : 0.7);
      // Exposed as light onto film, or written over the photo as pixels.
      if (uStampPaint == 1) {
        lin = mix(lin, uStampColour, clamp(s.r, 0.0, 1.0));
        lin += uStampColour * s.g * uStampGlow * 0.9;
      } else {
        // Exposed as light: a warmer, brighter core, and a halo redder than
        // it, the light spreading into the film's red-sensitive layer.
        lin += mix(uStampColour, vec3(1.0, 0.8, 0.45), 0.25) * s.r * 1.4;
        lin += uStampColour * vec3(1.0, 0.5, 0.3) * s.g * uStampGlow * 1.1;
      }
      col = toSrgb(lin);
      // On the characters themselves the look leaves their colour alone (see
      // uCollageOwn); their glow and shadow take the look like the rest of
      // the frame, or the photo from before the look would show round them.
      float cover = clamp(s.r * 1.2, 0.0, 1.0);
      outColor = vec4(clamp(col, 0.0, 1.0), src.a * (1.0 - cover));
      return;
    }
  }
  outColor = vec4(clamp(col, 0.0, 1.0), src.a);
}`
