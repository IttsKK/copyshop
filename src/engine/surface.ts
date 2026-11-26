/**
 * Surface: what the print is on. A paper's tooth, a canvas weave, crumpled
 * paper, cracked paint, an image of your own: a texture over the finished
 * picture, border and all, flat or lit as a raised surface.
 *
 * Drawn by a small program of its own after the look's pass (GrainEngine
 * drawSurface), blended onto it as "twice multiply" (the destination times
 * twice the source): a source of 0.5 leaves the picture as it is, darker
 * darkens and lighter lightens, as the border's paper does (paperAt). So it
 * needs no room in the look's shader (all its texture units are taken, and
 * Windows builds that shader slowly), and an uploaded image has a texture of
 * its own here.
 */

export type SurfaceKind = 'paper' | 'canvas' | 'linen' | 'watercolour' | 'fibre' | 'crumpled' | 'cracked' | 'concrete' | 'mesh' | 'brushed' | 'image'

export interface SurfaceParams {
  enabled: boolean
  kind: SurfaceKind
  /** 0..1: how strongly the surface shows. */
  amount: number
  /** How big its features are: 1 as designed, 0.25..4. */
  scale: number
  /** 0..1: flat (a pattern of light and dark) to lit as a raised surface. */
  relief: number
  /** Where the light comes from, degrees (0 from the right, 90 from below, 270 from above). */
  light: number
  /** Turns the texture, degrees. */
  turn: number
  /** An image of your own (kind 'image'): its colour kept, 0..1, or its brightness only. */
  colour: number
  seed: number
  /** The uploaded texture (kind 'image'), by its id in the texture store (sources/surfaceTextures.ts). */
  image?: string
  /** Its name, to show. */
  imageName?: string
}

export const DEFAULT_SURFACE: SurfaceParams = {
  enabled: false,
  kind: 'paper',
  amount: 0.5,
  scale: 1,
  relief: 0.4,
  light: 225,
  turn: 0,
  colour: 0,
  seed: 1,
}

export const SURFACE_KINDS: { id: SurfaceKind; label: string; hint: string }[] = [
  { id: 'paper', label: 'Paper', hint: 'Paper with tooth and mottle' },
  { id: 'canvas', label: 'Canvas', hint: 'Threads woven over and under' },
  { id: 'linen', label: 'Linen', hint: 'Fine threads both ways, with slubs' },
  { id: 'watercolour', label: 'Watercolour', hint: 'Cold-press paper: soft hills and hollows' },
  { id: 'fibre', label: 'Fibre', hint: 'Card with short fibres and specks' },
  { id: 'crumpled', label: 'Crumpled', hint: 'Paper crushed and flattened out' },
  { id: 'cracked', label: 'Cracked', hint: 'Old paint, cracked into plates' },
  { id: 'concrete', label: 'Concrete', hint: 'Cast concrete, pitted' },
  { id: 'mesh', label: 'Mesh', hint: 'A fine screen, like a screen door' },
  { id: 'brushed', label: 'Brushed', hint: 'Brushed metal, streaked one way' },
  { id: 'image', label: 'Image', hint: 'An image of your own, repeated' },
]

/** Surface units across the print's long side at Size 1: its features a share of the print, so a preview and an export look alike. */
export const SURFACE_UNITS = 1200

/**
 * Each kind's gains, flat and lit, that bring its texture to the same
 * spread (about 1), so a strength looks alike on all of them. Measured on
 * flat grey (the spread of each, Strength 1, Relief 0 and 1).
 */
export const SURFACE_GAINS: Record<SurfaceKind, [flat: number, lit: number]> = {
  paper: [6.9, 17],
  canvas: [5.1, 4.3],
  linen: [6.8, 8.5],
  watercolour: [4.8, 13.5],
  fibre: [5.3, 4.1],
  crumpled: [2.2, 45],
  cracked: [3.6, 4.4],
  concrete: [2.4, 5.6],
  mesh: [2.8, 2.2],
  brushed: [4.8, 4.8],
  image: [1, 5.6],
}

const KIND_INDEX: Record<SurfaceKind, number> = Object.fromEntries(SURFACE_KINDS.map((k, i) => [k.id, i])) as Record<SurfaceKind, number>
export const surfaceKindIndex = (k: SurfaceKind) => KIND_INDEX[k] ?? 0

/** The surface shows: on, some strength, and an image when it is one. */
export const surfaceOn = (s: SurfaceParams | undefined): s is SurfaceParams => !!s && s.enabled && s.amount > 0 && (s.kind !== 'image' || !!s.image)

export const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform vec2 uRegionOrigin;   // the part of the print drawn, print px
uniform vec2 uRegionSize;
uniform float uUnit;          // print px per surface unit at scale 1: a share of the print's long side, so it looks the same at any size
uniform float uUnitPx;        // output px per surface unit: the relief is measured over one output pixel
uniform int uKind;            // SURFACE_KINDS order
uniform float uAmount;
uniform float uScale;
uniform float uRelief;
uniform vec2 uLight;          // unit direction the light comes from
uniform float uTurn;          // radians
uniform float uSeed;
uniform sampler2D uImage;     // kind image
uniform vec2 uImageSize;      // its size, px
uniform float uImageMean;     // its mean brightness
uniform float uImageSd;       // and how far it strays from it
uniform float uColour;        // kind image: how much of its colour
uniform float uFlatGain;      // this kind's SURFACE_GAINS
uniform float uLitGain;
const float SPREAD = 0.03;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
/** Ridged noise, a few octaves: creases where it folds over. */
float ridged(vec2 p) {
  float h = 0.0;
  float amp = 0.55;
  for (int o = 0; o < 4; o++) {
    float n = 1.0 - abs(noise(p) * 2.0 - 1.0);
    h += n * n * amp;
    p = mat2(1.6, 1.2, -1.2, 1.6) * p + 3.1;
    amp *= 0.5;
  }
  return h;
}
/** Nearest and second-nearest cell points: (distance to the edge between them, this cell's own value). */
vec2 cells(vec2 p) {
  vec2 i = floor(p);
  float f1 = 8.0;
  float f2 = 8.0;
  float own = 0.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 c = i + vec2(float(x), float(y));
      vec2 at = c + vec2(hash21(c + uSeed), hash21(c + uSeed + 17.0)) * 0.8 + 0.1;
      float d = length(p - at);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        own = hash21(c + uSeed * 3.0);
      } else if (d < f2) f2 = d;
    }
  return vec2(f2 - f1, own);
}

/** The surface's height at q (surface units), about -0.5..0.5. Shared by every kind, so relief lights them all alike. */
float heightAt(vec2 q) {
  float s = uSeed;
  float mottle = noise(q * 0.035 + s * 1.7) - 0.5;
  if (uKind == 1) {
    // Canvas: threads over and under each other, each a little uneven.
    vec2 w = q * 0.3 + s;
    float wob = noise(q * 0.06 + s * 3.1) - 0.5;
    float across = sin(w.y * 3.14159 + wob * 1.5);
    float down = sin(w.x * 3.14159 + wob * 1.5);
    float over = step(0.0, sin(w.x * 1.5708) * sin(w.y * 1.5708));
    float thread = mix(abs(down), abs(across), over);
    return (thread - 0.6) * 0.6 + mottle * 0.25;
  }
  if (uKind == 2) {
    float h = noise(vec2(q.x * 0.04, q.y * 1.1) + s) - 0.5;
    float v = noise(vec2(q.x * 1.1, q.y * 0.04) + s * 2.3) - 0.5;
    return (h + v) * 0.4 + mottle * 0.35;
  }
  if (uKind == 3) {
    float hill = noise(q * 0.12 + s) - 0.5;
    float small = noise(q * 0.38 + s * 1.3) - 0.5;
    return hill * 0.7 + small * 0.4 + mottle * 0.5;
  }
  if (uKind == 4) {
    float f1 = noise(vec2(q.x * 0.9, q.y * 0.08) + s) - 0.5;
    float f2 = noise(vec2(q.x * 0.08, q.y * 0.9) + s * 1.9) - 0.5;
    float fibre = max(abs(f1), abs(f2));
    vec2 r = vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8);
    vec2 r2 = vec2(q.x * 0.28 + q.y * 0.96, q.y * 0.28 - q.x * 0.96);
    float speck = smoothstep(0.8, 0.9, noise(r * 0.5 + s * 5.3)) * smoothstep(0.62, 0.8, noise(r2 * 1.7 + s * 2.9));
    return (fibre - 0.2) * 1.0 + mottle * 0.4 - speck * 1.5;
  }
  if (uKind == 5) {
    // Crumpled: big creased folds, and the fine wrinkles between them.
    return (ridged(q * 0.008 + s) - 0.55) * 2.4 + (noise(q * 0.2 + s) - 0.5) * 0.1;
  }
  if (uKind == 6) {
    // Cracked: plates of paint, each tilted its own way, dark cracks between them.
    vec2 c = cells(q * 0.025 + s);
    float crack = 1.0 - smoothstep(0.0, 0.06, c.x);
    return (c.y - 0.5) * 0.25 + mottle * 0.3 - crack * 1.2;
  }
  if (uKind == 7) {
    // Concrete: mottled, with small pits.
    float pit = smoothstep(0.8, 0.88, noise(q * 0.1 + s * 4.1));
    return mottle * 1.2 + (noise(q * 0.7 + s) - 0.5) * 0.4 - pit * 1.4;
  }
  if (uKind == 8) {
    // Mesh: a fine woven screen.
    vec2 g = abs(sin(q * 0.9 + s));
    return (min(g.x, g.y) - 0.35) * 1.2 + mottle * 0.15;
  }
  if (uKind == 9) {
    // Brushed: fine streaks one way.
    float streak = noise(vec2(q.x * 0.015, q.y * 1.4) + s) - 0.5;
    float fine = noise(vec2(q.x * 0.05, q.y * 4.0) + s * 2.0) - 0.5;
    return streak * 0.9 + fine * 0.5;
  }
  if (uKind == 10) {
    vec3 c = texture(uImage, q / uImageSize).rgb;
    return (dot(c, vec3(0.2126, 0.7152, 0.0722)) - uImageMean) / max(uImageSd, 0.02);
  }
  // Paper: tooth and mottle.
  float tooth = noise(q * 0.5 + s) - 0.5;
  return tooth * 0.25 + mottle * 0.6;
}

void main() {
  vec2 printPx = uRegionOrigin + vUv * uRegionSize;
  // Surface units: a share of the print and the chosen size, turned about the print's corner.
  float c = cos(uTurn);
  float sn = sin(uTurn);
  vec2 q = mat2(c, sn, -sn, c) * (printPx / (uUnit * uScale));
  float h = heightAt(q);
  // Lit as a raised surface: its slope toward the light, per surface unit.
  // (Forward differences: three heights a pixel, not five; small programs build quickly on Windows too.)
  float e = max(0.75, 1.0 / max(uUnitPx, 1e-3));
  vec2 slope = vec2(heightAt(q + vec2(e, 0.0)) - h, heightAt(q + vec2(0.0, e)) - h) / e;
  // Each kind brought to the same spread, flat or lit (SURFACE_GAINS), so Strength means the same on all of them.
  float s = mix(h * uFlatGain, dot(slope, -uLight) * uLitGain, uRelief);
  // A slight texture, not an overlay: about 6% either way at full strength, its peaks (cracks, pits) eased off.
  float t = uAmount * SPREAD * s / sqrt(1.0 + s * s * 0.25);
  vec3 tone = vec3(t);
  if (uKind == 10 && uColour > 0.0) {
    // Its colour too: how far each channel is from its grey.
    vec3 img = texture(uImage, q / uImageSize).rgb;
    tone += (img - dot(img, vec3(0.2126, 0.7152, 0.0722))) * uColour * uAmount * 0.25;
  }
  // Twice multiply: 0.5 leaves the picture, below darkens, above lightens.
  outColor = vec4(clamp(0.5 + tone, 0.02, 1.0), 1.0);
}`
