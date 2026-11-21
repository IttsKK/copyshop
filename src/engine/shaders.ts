import { MAX_BLOBS } from './blobs'
import { buildBlendDispatch } from './blendModes'
import { MAX_HUE_MOVES } from './stocks'
import { MASK_SECTIONS, MAX_BAND_GUIDES, MAX_FIX_COLOURS, MAX_LEAK_SPOTS, MAX_MASKS, MAX_PALETTE, MAX_STREAKS, MAX_STREAK_FIXES } from './types'
import { END_SAMPLES, OTHER_ARM, PATH_LEVELS, PATH_NEWTON, PATH_NEWTON_STEP, STREAK_MARCH, STREAK_PATH_SAMPLES } from './streaks'
import { PATH_SAMPLES, SDF_RANGE } from './leaks'

export const VERTEX_SHADER = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  // Full-screen triangle: no vertex buffer needed.
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  // v flipped so uv (0,0) is the top-left of the image, matching pixel coords.
  vUv = vec2(p.x, 1.0 - p.y);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

export const TILING_REPEAT = 0
export const TILING_MIRROR = 1
export const TILING_STOCHASTIC = 2

export const FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 outColor;
layout(location = 1) out vec4 outUv; // the streak cache's second half (uLinePass 5)

uniform sampler2D uBase;
uniform sampler2D uGrain;

uniform vec2 uBaseSize;      // px
uniform vec2 uGrainSize;     // px
uniform vec2 uRegionOrigin;  // px, top-left of the rendered region in base space
uniform vec2 uRegionSize;    // px

uniform int uBlendMode;
uniform int uTiling;
uniform float uAmount;
uniform float uGrainScale;
uniform int uLinearBlend;    // 1 = blend in linear light, 0 = blend sRGB-encoded
uniform float uGrainMean;    // measured average density of the plate
uniform float uGrainRotation; // radians
uniform vec2 uGrainShift;     // base px: where this photo starts on the grain
uniform float uChroma;        // 0 = monochrome grain, 1 = source colour
uniform sampler2D uResponseLut; // grain strength against base luminance
uniform float uSoftness;      // 0 = grain as sharp as the plate
uniform float uGrainCentre;   // value treated as neutral when normalising
uniform float uGrainGain;     // contrast rescale applied after centring
uniform float uFlatten;       // 0..1, removes the plate's low-frequency density
uniform float uFlattenLod;    // mip level standing in for "heavily blurred"
uniform int uCrisp;           // 1 = snap reads to whole plate texels
uniform sampler2D uGlow;      // blurred highlights, whole-frame, fixed resolution
uniform float uHalation;      // warm glow out of the highlights
uniform float uBloom;         // neutral glow
uniform float uShoulder;      // highlight roll-off
uniform float uFade;          // shadow lift, the film's toe
uniform float uExposure;      // stops
uniform float uVignette;      // corner falloff
uniform sampler2D uDefects;   // dust, hairs and scratches, one layer per frame
uniform float uDefectStrength;
uniform vec2 uPrintSize;      // the finished print, photo plus paper
uniform vec2 uImageOffset;    // where the photo sits within the print, in px
uniform vec2 uShapeOrigin;    // streaks' and masks' units: their origin in print px
uniform float uShapeUnit;     // and their unit, px (the photo's short side; see shapeMeasure)
uniform vec4 uShapeFrame;     // the frame shapes are placed on (the photo, or the print), in those units: min x, y, max x, y
uniform vec3 uPaperColour;
uniform float uPaperTexture;
uniform int uEdgeKind;          // 0 printed, 1 torn, 2 brush, 3 film, 4 deckle (BorderParams.edge)
uniform float uEdgeIrregularity;  // px of wander in the cut between the two
uniform float uEdgeSoftness;      // px: half-width of the soft printed edge
uniform float uBorderSeed;
uniform float uBorderGrain;   // grain on the paper, as a multiple of Amount
uniform int uHasBorder;
uniform vec3 uPaperColour2;
uniform int uPaperKind;       // 0 paper, 1 smooth, 2 canvas, 3 linen, 4 watercolour, 5 fibre (BorderParams.paper)
uniform int uPaperFill;       // 0 flat, 1 a gradient along uPaperDir, 2 out from the middle
uniform vec2 uPaperDir;       // the gradient's direction, unit, print px (y down)
uniform float uCornerRadius;  // px: the photo's rounded corners
uniform float uShadow;        // the photo's shadow on the paper, 0..1
uniform float uShadowBlur;    // px
uniform vec2 uShadowOffset;   // px
uniform float uBevelWidth;    // px: a cut mat's bevel round the photo
uniform float uBevelLight;
uniform float uLineWidth;     // px: a line round the photo (0 none)
uniform float uLineGap;       // px between the photo and the line
uniform vec3 uLineColour;
uniform float uInset;         // shade along the photo's inside edge
uniform float uInsetSize;     // px
uniform float uScanLines;
uniform float uScanStreaks;
uniform float uScanSeed;
// This photo's pixels per pixel of the photo its edit was made on (BlendParams.pixelScale).
uniform float uPixelScale;
uniform float uSurgeStrength;
uniform int uSurgeCount;
uniform float uSurgeWidth;
uniform float uSurgeAngle;
uniform float uSurgeSeed;
uniform int uPerChannelResponse;
uniform vec3 uLayerShift;
uniform sampler2D uDetail;    // the whole picture, blurred, linear light
uniform float uRim;           // edge glow: bright neighbours bleeding into dark
uniform float uCrunch;        // large-radius unsharp mask
uniform sampler2D uHalo;      // the whole picture blurred wide, linear light
uniform float uHaloAmount;    // Mackie lines: pale rims where light meets dark
uniform sampler2D uStructure; // the picture blurred at texture scale, linear light
uniform float uStructureAmount;
uniform float uSolarize;      // Sabattier: the brightest tones partly reverse
uniform float uMonoAmount;    // black & white film: how far, the filter's mix, its contrast
uniform vec3 uMonoMix;
uniform float uMonoContrast;
uniform vec3 uMonoTone;       // a toner's colour, sRGB, and how strongly
uniform float uMonoToneAmount;
uniform int uHalftoneStyle;   // -1 off, 0 dots, 1 lines, 2 riso
uniform float uHalftoneAmount;
uniform float uHalftoneCell;  // print pixels
uniform float uHalftoneAngle; // radians
uniform vec3 uInkA;
uniform vec3 uInkB;
uniform vec3 uHalftonePaper;
uniform float uHalftoneSlip;  // print pixels
uniform float uSolarizeFrom;
uniform float uFollowColour;   // grain gathers where the colour is
uniform float uDitherAmount;   // posterise, with the grain as the dither pattern
uniform float uDitherSteps;
uniform float uDitherSpread;
uniform float uDitherNoise;    // 1 / the grain's standard deviation
uniform float uDitherFollow;   // 0 bands follow brightness, 1 a direction
uniform vec2 uDitherFrom;      // print px: bands step from here...
uniform vec2 uDitherTo;        // ...to here, and fade out just past it
uniform int uDitherOval;       // 1 = rings centred on uDitherFrom
uniform float uDitherStretch;  // oval width across, relative to its reach
uniform vec4 uBandGuides[${MAX_BAND_GUIDES}]; // centre (short-side units), radius, strength
uniform int uBandGuideCount;
uniform float uDitherPixel;    // dither dot size, print px
uniform float uDitherClumps;   // grain read this much larger, smoothly, for the dots (1 = as it is)
uniform int uDitherOrdered;    // 1 = Bayer matrix instead of grain
uniform float uPixelate;       // block size in print px, 1 = off
uniform float uPixelKeep;      // Pixel art's Keep lines, 0..1: pixels unlike their block keep their own colour; negative, Dither's Keep detail: a block with detail in it keeps its pixels
uniform highp sampler2DArray uStreakShapes;  // a layer per shape: r its inside, g that blurred by its feather
uniform vec4 uStreakRect[${MAX_STREAKS}];      // the area each layer covers: min x, y, size x, y (short-side units)
uniform sampler2D uMatteBack;  // round the streaks' keyed masks: the photo where streaked, premultiplied by how surely (a), mipmapped
uniform sampler2D uMatteFore;  // ...and where kept in front of them
uniform int uMatteOn;          // 1 when those are drawn (a streak mask has Clean edges)
uniform float uMatteLod;       // their finest level worth reading: about two photo pixels
uniform highp sampler2D uStreakPaths;            // each path-following streak's path: per side, PATH_LEVELS rows of STREAK_PATH_SAMPLES, point and unit tangent (short-side units)
uniform vec4 uStreakPathReach[${MAX_STREAKS * 2}];  // from how far off its path each version takes over, PATH_LEVELS of eight
uniform vec4 uStreakInfo[${MAX_STREAKS}];      // skips masked colours, width either side of the path (0: none), direction x, y
uniform vec4 uFixSpan[${MAX_STREAK_FIXES}];      // shape, across from, to (short-side units), mode (0 borrow, 1 colours, 2 keep)
uniform vec4 uFixFrom[${MAX_STREAK_FIXES}];      // borrow: the spans beside it colours come from, before (from, to), after (from, to)
uniform vec4 uFixInfo[${MAX_STREAK_FIXES}];      // seed (0..1), variation, colour count, masked (1) + carry (2: copy, 4: colour)
uniform vec4 uFixTone[${MAX_STREAK_FIXES}];      // brightness (stops), contrast, opacity on its bars, feather (short-side units)
uniform vec3 uFixColours[${MAX_STREAK_FIXES * MAX_FIX_COLOURS}];
uniform int uFixCount;
uniform int uLinePass;                          // 1: draw the line table instead of the picture; 2: the photo as streaked, nothing after; 3, 4: the matte (see buildMatte); 5: the streak cache (see cacheStreaks)
// 1: read the streaks from the cache (see GrainEngine.cacheStreaks) instead
// of searching. The cache comes in on the matte's samplers, which only the
// search reads (a fragment shader has 16): uMatteBack holds the streaked
// photo before the look (rgb) and how streaked (a), uMatteFore where each
// output pixel's colour came from (xy, photo uv).
uniform int uStreakCacheOn;
// Where the cache's first row is in the picture, when it is drawn in tiles (GrainEngine).
uniform ivec2 uCacheOffset;
uniform vec4 uCrossRange[${MAX_STREAKS}];
uniform sampler2D uLineTable;                   // per shape (row), per line across it: where it takes its colour, and whether that is held back
uniform vec4 uLineInfo[${MAX_STREAKS}];         // first line's across position, spacing, line count (0: no table), along range start
uniform float uLineSpan[${MAX_STREAKS}];        // along range length (short-side units)
uniform vec4 uStreakExtra[${MAX_STREAKS}];     // band, seed, reach (short-side units), mode (0 fill, 1 trail, 2 mask)
uniform vec4 uStreakEnds[${MAX_STREAKS}];      // longest, shortest (shares of the full length), variation, grows from the colour edge
uniform vec4 uStreakRepeat3[${MAX_STREAKS}];   // repeat, in perspective: how far the copies' own point is moved along the lines from the streak's (short-side units; 0 the same), and three unused
uniform vec4 uStreakRepeat2[${MAX_STREAKS}];   // repeat: how much detail, (unused), the blur level detail is measured against, how far along a bar the copy holds
uniform vec4 uStreakRepeat[${MAX_STREAKS}];
uniform vec4 uStreakBend[${MAX_STREAKS}];     // the lens's bend (k), the photo's middle and half-diagonal (short-side units): see lensBend.ts
uniform float uStreakRepeatMask[${MAX_STREAKS}]; // repeat only where this mask covers the bar's colour edge (its index; -1 everywhere)    // repeat: on, each copy's depth (short-side units), mirrored, each copy's size against the last
uniform vec4 uStreakFlags[${MAX_STREAKS}];     // clipped to the shape, lengths measured across it, feather inside/centre/outside (0/1/2), grain edge
uniform vec4 uStreakEdge[${MAX_STREAKS}];      // feather, pull, trail length (short-side units), tip angle (radians)
uniform vec4 uStreakMirror[${MAX_STREAKS}];     // mirrored bars: the middle line (across the flow, t), how far each side goes its own way (0 the same, 1 its own), on
uniform vec4 uStreakStripe[${MAX_STREAKS}];     // colour stripes: middle width (short-side units, 0: none), how far each edge moves (a share of it), how much of the edge's detail each keeps
uniform float uStreakEndSoft[${MAX_STREAKS}];  // how far each bar's end fades out (short-side units)
uniform vec4 uStreakToneStart[${MAX_STREAKS}]; // at a bar's start: brightness (stops), contrast, opacity; where the change begins (share of the bar)
uniform vec4 uStreakToneEnd[${MAX_STREAKS}];   // at its end: brightness, contrast, opacity; how long the change takes (share of the bar)
uniform vec4 uStreakPathInfo[${MAX_STREAKS}];  // swept (1) or offset, path samples (0: straight), spacing, tip angle range (radians)
uniform vec4 uStreakSweep[${MAX_STREAKS}];     // a swept path's start-to-end direction (xy, unit); radial Around: outer radius (y, 0: none), circle radius (z), on (w)
uniform vec4 uStreakEndS[${MAX_STREAKS * END_SAMPLES / 4}]; // a trail's end line: where each of its lines meets it, END_SAMPLES across, four to a vec4
uniform vec4 uStreakEndInfo[${MAX_STREAKS}];  // its first line across (t), the step between, the shape's nearest along (s), 1 if drawn
uniform vec4 uStreakVanish[${MAX_STREAKS}];    // in perspective: vanishing point, its distance from the middle, toward (-1) or away (1); w 0 parallel
uniform int uStreakCount;
uniform highp sampler2DArray uMaskShapes;      // a layer per mask: r its inside, g that blurred by its feather
uniform vec4 uMaskRect[${MAX_MASKS}];           // the area each layer covers (short-side units)
uniform float uMaskGrow[${MAX_MASKS}];          // how far each reaches past what it covers (short-side units)
uniform vec4 uMaskFlags[${MAX_MASKS}];          // feather inside/centre/outside (0/1/2), key measures blue (1) or brightness, key off/darker/lighter (0/1/2), clean edges 0..1 (keyed only)
uniform vec2 uMaskKey[${MAX_MASKS}];            // key level, softness (encoded brightness)
uniform vec4 uMaskShape[${MAX_MASKS}];          // kind (0 drawn, 1 radial, 2 gradient); radial: centre, angle; gradient: start
uniform vec4 uMaskShape2[${MAX_MASKS}];         // radial: radii, softness; gradient: end (shape units)
uniform int uMaskCount;                         // 0 when no section uses a mask
uniform ivec2 uSectionMask[${MASK_SECTIONS.length}]; // each module's masks, in MASK_SECTIONS' order: mask bits; 0 none, 1 hold back inside, 2 only inside
uniform float uStreakAmount;
uniform sampler2D uCalm;       // the picture's brightness blurred a little (r) and more (g): their difference is how much the colour is changing
uniform sampler2D uStreakGlow; // the streaked bars' own colour, blurred: light off them (see buildStreakGlow)
uniform float uStreakGlowAmount;
uniform ivec2 uStreakMask[${MAX_STREAKS}];     // per streak: its own masks (a bit each), and kept off them (1) or only on them (2); 0 none
uniform vec4 uStreakKey[${MAX_STREAKS}];       // per streak: key off/darker/lighter (0/1/2), measures blue (1), level, softness
uniform int uStreakKeyed;                      // 1 when any streak has a key
uniform float uPrism;                          // print px between a bar's red and its blue, 0 off
uniform vec2 uPrismTurn;                       // cos, sin of the split's turn from across the bars
uniform vec2 uShowMask;                        // a mask shown on the photo: its index (-1 none), and how: 0 red, 1 green, 2 alone
uniform float uLensK;                          // the lens's distortion at the corner: barrel above 0, pincushion below
uniform vec4 uGlass;                           // amount, kind (0 reeded, 1 facets, 2 ripple), rib width (print px), dispersion
uniform vec4 uGlassAxis;                       // across the ribs (unit xy), edge light, unused
uniform float uDitherTransitions; // keep the pattern to where colours change
uniform float uDitherSparePop;    // leave the standout colour smooth

// How much the pixel is the standout colour (Colour → Pop), set by
// applyGrade for the stages after it.
float gStandout = 0.0;
uniform vec2 uDitherTone;      // brightness range the dither is kept to
uniform vec3 uPalette[${MAX_PALETTE}]; // sRGB
uniform int uPaletteCount;     // 0 = no palette
uniform float uPaletteAmount;
uniform float uPaletteDither;
uniform float uPaletteSpacing; // typical gap between palette colours
uniform float uStockStrength;
// Streaks left out of the Colour module's grade (StreakParams.graded false): 1.
uniform float uStreakUngraded;
uniform vec4 uHueMoves[${MAX_HUE_MOVES}]; // hue, shift, saturation, width
uniform int uHueMoveCount;
uniform vec3 uStockLift;
uniform vec3 uStockGain;
uniform float uStockSat;
uniform float uStockContrast;
uniform float uStockKeepTone;
uniform float uLeak;
uniform int uLeakCount;
uniform float uLeakSeed;
uniform vec4 uLeakGeo[${MAX_LEAK_SPOTS}];   // centre (short-side units), size, stretch; a shape: depth, seed, breakup, soft edge
uniform vec4 uLeakAxis[${MAX_LEAK_SPOTS}];  // cos, sin of the long axis, strength, kind (1 = burn)
uniform vec3 uLeakTint[${MAX_LEAK_SPOTS}]; // per spot, linear, brightest channel 1
uniform int uLightBehind;                       // 1: a light is held behind the streaks, so the search also finds how far past a bar's end it is moved (gLightShift)
uniform vec4 uLeakHold[${MAX_LEAK_SPOTS}]; // a light's mask (its index, -1 none), behind the streaks (1), only inside the mask (1) rather than behind it
uniform vec2 uLeakPath[${MAX_LEAK_SPOTS}];  // path spots: first sample, sample count (0 = ellipse); a light: its mask, -1
uniform vec2 uLeakPoints[${PATH_SAMPLES}];  // every path's samples, short-side units
uniform vec4 uLeakRect[${MAX_LEAK_SPOTS}];  // a drawn shape's layer in uMaskShapes: where it lies (shape units)
uniform vec4 uLeakLight[${MAX_LEAK_SPOTS}]; // a drawn shape's lighting: falloff, from (radians), key (see GrainEngine), key softness
uniform vec3 uGlowTint;       // linear, brightest channel 1
uniform float uVibrance;
uniform float uWarmth;
uniform float uTint;
uniform vec3 uShadowTint;     // sRGB
uniform float uShadowAmount;
uniform vec3 uHighlightTint;  // sRGB
uniform float uHighlightAmount;
uniform int uHasGrade;
uniform int uPassesStreaked; // 1: the wide passes are blurs of the streaked photo, read where each pixel is
uniform int uCollageOwn;      // 1: the base's alpha says how much of the look each pixel takes (collage pieces keep their own colour)
uniform float uMapAmount;     // gradient map
uniform vec3 uMapShadow;      // sRGB
uniform vec3 uMapMid;
uniform vec3 uMapHigh;
uniform vec2 uMapRange;       // the photo's own tonal range, encoded
uniform vec3 uMapShape;       // the map's contrast, balance and saturation, each -1..1
uniform int uBlobCount;       // colour blobs (experiment, blobs.ts)
uniform vec4 uBlobA[${MAX_BLOBS}];  // wheel x, y, reach, strength
uniform vec4 uBlobB[${MAX_BLOBS}];  // tone, tone width
uniform float uIsolateAmount; // desaturate all but one hue
uniform float uIsolateHue;    // 0..1
uniform float uIsolateWidth;
uniform float uPopAmount;      // recolour the kept hue toward uPopColour
uniform float uPopKeep;        // shield the kept hue from the gradient map
uniform vec3 uPopColour;
uniform vec3 uRestColour;      // the tint the rest's greys take

${buildBlendDispatch()}

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

/**
 * One read of the plate, with its own low-frequency density removed.
 *
 * The flattening has to happen per tap, at the coordinate that tap actually
 * reads. Subtracting the blur at some other position — the un-offset
 * coordinate, say — does not cancel anything; it adds a second, uncorrelated
 * density field on top, which is worse than leaving it alone.
 */
// Set while the dither reads the grain larger for its clumps: read smoothly
// there, whatever the grain's own sampling, so the clumps are soft, not squares.
bool gSoftRead = false;

vec3 plateAt(vec2 uvIn, vec2 ddx, vec2 ddy) {
  // Snapping to texel centres makes the bilinear fetch return one whole texel
  // rather than a blend of four, which is what keeps grain contrast constant
  // as the scale changes. Minification still resolves through the mip chain,
  // so this does not reintroduce sparkle in the fit view.
  vec2 uv = uCrisp == 1 && !gSoftRead ? (floor(uvIn * uGrainSize) + 0.5) / uGrainSize : uvIn;
  vec3 v = textureGrad(uGrain, uv, ddx, ddy).rgb;
  if (uFlatten > 0.0) {
    v -= (textureLod(uGrain, uv, uFlattenLod).rgb - vec3(uGrainCentre)) * uFlatten;
  }
  return v;
}

float hash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec2 hash22(vec2 p) {
  return vec2(hash21(p), hash21(p + 19.19));
}

/**
 * Texture bombing with variance-preserving blending. Four hashed copies of the
 * plate are cross-faded, so neither tile seams nor the plate's own repetition
 * period are visible. Deviations from the plate's mean density are summed and
 * renormalised by sqrt(sum(w^2)) so the grain keeps its original contrast
 * instead of being averaged toward flat. The reference is the measured mean
 * rather than a hardcoded 0.5: a plate that scans slightly dense would
 * otherwise have that offset amplified up to 2x into visible blotching.
 */
vec3 sampleStochastic(vec2 uv) {
  vec2 cell = floor(uv);
  vec2 f = fract(uv);
  vec3 acc = vec3(0.0);
  float wsq = 0.0;
  // Gradients come from the *continuous* coordinate. Deriving them from the
  // offset copies instead would make the mip level jump at every cell border
  // (a visible blurred grid) and, worse, make the result depend on how the GPU
  // aligns its 2x2 quads — so a preview crop would not match the export.
  // Softness widens the sample footprint, so the hardware picks a coarser mip
  // level: grain that reads as slightly out of focus rather than blurred by a
  // separate pass.
  float spread = 1.0 + uSoftness * 3.0;
  // Pixelated, every pixel in a block reads the same point, so screen
  // derivatives are zero inside a block and jump at its edge; read the
  // finest level instead, or each block would get a blurred seam.
  vec2 ddx = uPixelate > 1.0 ? vec2(0.0) : dFdx(uv) * spread;
  vec2 ddy = uPixelate > 1.0 ? vec2(0.0) : dFdy(uv) * spread;
  for (int j = 0; j < 2; j++) {
    for (int i = 0; i < 2; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float w = (i == 0 ? 1.0 - f.x : f.x) * (j == 0 ? 1.0 - f.y : f.y);
      if (w <= 0.0) continue;
      // Snap the per-copy offset to whole plate texels: a fractional offset
      // would resample the grain bilinearly and quietly halve its contrast.
      vec2 off = floor(hash22(c) * uGrainSize) / uGrainSize;
      vec3 g = plateAt(uv + off, ddx, ddy);
      acc += w * (g - uGrainMean);
      wsq += w * w;
    }
  }
  return vec3(uGrainMean) + acc / sqrt(max(wsq, 1e-6));
}

vec3 sampleGrain(vec2 basePx) {
  // Grain is addressed in base-image pixels, so a 1:1 preview crop and the
  // full-resolution export sample the identical grain values. Rotation is
  // about the image centre and likewise depends only on basePx, which keeps
  // that guarantee.
  vec2 p = basePx - uBaseSize * 0.5;
  float c = cos(uGrainRotation);
  float s = sin(uGrainRotation);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + uBaseSize * 0.5 + uGrainShift;

  vec2 uv = p / (uGrainSize * uGrainScale);
  float spread = 1.0 + uSoftness * 3.0;
  vec3 g = uTiling == ${TILING_STOCHASTIC}
    ? sampleStochastic(uv)
    : plateAt(uv, uPixelate > 1.0 ? vec2(0.0) : dFdx(uv) * spread, uPixelate > 1.0 ? vec2(0.0) : dFdy(uv) * spread);

  // Normalise: put the plate's average on mid-grey, where every blend mode
  // here is neutral, and optionally rescale its contrast to the reference.
  g = vec3(0.5) + (g - vec3(uGrainCentre)) * uGrainGain;

  // Desaturating toward mid-grey keeps the blend neutral.
  float mono = dot(g, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(mono), g, uChroma);
}

/**
 * Tone-dependent grain strength, read straight from the curve the user drew.
 * Baking the curve into a LUT keeps arbitrary shapes free at render time — the
 * shader does not care how many control points there were.
 */
float responseAt(float luma) {
  return texture(uResponseLut, vec2(clamp(luma, 0.0, 1.0), 0.5)).r * 2.0;
}

float hash11(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float valueNoise1(float x) {
  float i = floor(x);
  float f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(hash11(i), hash11(i + 1.0), f);
}

/*
 * A streak's bars, mirrored (StreakShape.mirror): either side of a middle
 * line across the flow they are the same bars the other way round, their
 * widths, lengths and end cuts, a share of each going its own way
 * (mirrorVary). Their colours are still the photo's where each bar is.
 */
/**
 * Where streak i's bars are laid across it: with no mirror, from line 0
 * (returns 0); mirrored, moved so an edge between bars falls on the middle
 * line (returns how far), and mi that edge's number.
 */
float barGrid(int i, float band, out float mi) {
  vec4 m = uStreakMirror[i];
  mi = 0.0;
  if (m.z < 0.5) return 0.0;
  mi = floor(m.x / band);
  return m.x - mi * band;
}

/** How far the edge before bar b is moved by Bar widths, a share of a bar (-0.5..0.5, times barVary); mi the middle's edge (barGrid). */
float barEdgeShift(int i, float b, float mi) {
  float seed = uStreakExtra[i].y;
  float own = hash11(b * 9.71 + seed + 41.0) - 0.5;
  vec4 m = uStreakMirror[i];
  if (m.z < 0.5) return own;
  float r = b - mi;
  float mirrored = r == 0.0 ? 0.0 : sign(r) * (hash11(abs(r) * 9.71 + seed + 41.0) - 0.5);
  return mix(mirrored, own, m.y);
}

/** Bar k's own picks (mi the middle's edge, barGrid): x its length alone, y its length on the slow wave, z its end cut's turn (-1..1), w which way its cut goes (-1 on the mirrored side). */
vec4 barPicks(int i, float k, float mi) {
  float seed = uStreakExtra[i].y;
  vec3 own = vec3(hash11(k * 1.31 + seed), valueNoise1(k * 0.18 + seed * 0.37), hash11(k * 2.71 + seed + 17.0) * 2.0 - 1.0);
  vec4 m = uStreakMirror[i];
  if (m.z < 0.5) return vec4(own, 1.0);
  float j = k - mi;
  float key = j >= 0.0 ? j : -j - 1.0;
  vec3 mirrored = vec3(hash11(key * 1.31 + seed), valueNoise1(key * 0.18 + seed * 0.37), hash11(key * 2.71 + seed + 17.0) * 2.0 - 1.0);
  return vec4(mix(mirrored, own, m.y), j >= 0.0 ? 1.0 : -1.0);
}

float valueNoise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

/** Paper: a flat colour would look printed on, so give it tooth and mottle. */
vec3 paperAt(vec2 printPx) {
  vec3 paper = uPaperColour;
  if (uPaperFill == 1) {
    // Corner to corner along the direction: from colour to colour2 across the whole print.
    float reach = 0.5 * (abs(uPaperDir.x) * uPrintSize.x + abs(uPaperDir.y) * uPrintSize.y);
    float t = clamp(0.5 + dot(printPx - uPrintSize * 0.5, uPaperDir) / max(2.0 * reach, 1.0), 0.0, 1.0);
    paper = mix(uPaperColour, uPaperColour2, smoothstep(0.0, 1.0, t));
  } else if (uPaperFill == 2) {
    float t = clamp(length((printPx - uPrintSize * 0.5) / (uPrintSize * 0.5)) / 1.4142, 0.0, 1.0);
    paper = mix(uPaperColour, uPaperColour2, smoothstep(0.0, 1.0, t));
  }
  if (uPaperTexture > 0.0) {
    vec2 q = printPx / uPixelScale;
    float mottle = valueNoise2(q * 0.035 + uBorderSeed * 1.7) - 0.5;
    float t = 0.0;
    if (uPaperKind == 1) {
      // Smooth: a print's surface, only the faintest unevenness.
      t = mottle * 0.025;
    } else if (uPaperKind == 2) {
      // Canvas: threads over and under each other, each a little uneven.
      vec2 w = q * 0.55 + uBorderSeed;
      float wob = valueNoise2(q * 0.06 + uBorderSeed * 3.1) - 0.5;
      float across = sin(w.y * 3.14159 + wob * 1.5);
      float down = sin(w.x * 3.14159 + wob * 1.5);
      float over = step(0.0, sin(w.x * 1.5708) * sin(w.y * 1.5708));
      float thread = mix(abs(down), abs(across), over);
      t = (thread - 0.6) * 0.2 + mottle * 0.04 + (valueNoise2(q * 0.9 + uBorderSeed) - 0.5) * 0.03;
    } else if (uPaperKind == 3) {
      // Linen: fine threads both ways, with the thicker slubs real linen has.
      float h = valueNoise2(vec2(q.x * 0.04, q.y * 1.1) + uBorderSeed) - 0.5;
      float v = valueNoise2(vec2(q.x * 1.1, q.y * 0.04) + uBorderSeed * 2.3) - 0.5;
      t = (h + v) * 0.07 + mottle * 0.035;
    } else if (uPaperKind == 4) {
      // Watercolour (cold-press): soft hills and hollows, and pigment pooled in them.
      float hill = valueNoise2(q * 0.12 + uBorderSeed) - 0.5;
      float small = valueNoise2(q * 0.38 + uBorderSeed * 1.3) - 0.5;
      t = hill * 0.07 + small * 0.04 + mottle * 0.09;
    } else if (uPaperKind == 5) {
      // Fibre: card with short fibres running every which way and dark specks.
      float f1 = valueNoise2(vec2(q.x * 0.9, q.y * 0.08) + uBorderSeed) - 0.5;
      float f2 = valueNoise2(vec2(q.x * 0.08, q.y * 0.9) + uBorderSeed * 1.9) - 0.5;
      float fibre = max(abs(f1), abs(f2));
      // Specks where two noises both peak: scattered, never on a grid.
      vec2 r = vec2(q.x * 0.8 - q.y * 0.6, q.x * 0.6 + q.y * 0.8);
      vec2 r2 = vec2(q.x * 0.28 + q.y * 0.96, q.y * 0.28 - q.x * 0.96);
      float speck = smoothstep(0.8, 0.9, valueNoise2(r * 0.5 + uBorderSeed * 5.3)) * smoothstep(0.62, 0.8, valueNoise2(r2 * 1.7 + uBorderSeed * 2.9));
      t = (fibre - 0.2) * 0.14 + mottle * 0.07 - speck * 0.4;
    } else {
      // Paper: tooth and mottle.
      float tooth = valueNoise2(q * 0.8 + uBorderSeed) - 0.5;
      t = tooth * 0.05 + mottle * 0.06;
    }
    paper *= 1.0 + t * uPaperTexture;
  }
  return paper;
}

/**
 * How far inside the photo a point is, in pixels, with the edge allowed to
 * wander. A perfectly straight cut is the giveaway of a digital frame, so each
 * side drifts along its own length.
 */
float edgeNoise(float t, float seed) {
  // Several octaves along the edge: a slow drift, mid wander, fine fibres.
  float n = 0.0;
  float amp = 0.55;
  float f = 1.0;
  for (int o = 0; o < 5; o++) {
    n += (valueNoise1(t * f + seed * (1.7 + float(o))) - 0.5) * amp;
    f *= 2.7;
    amp *= 0.5;
  }
  return n * 2.0;
}

/** One side's wander, by the kind of edge (uEdgeKind): positive pulls the photo in, negative reaches out. */
float edgeShape(float t, float seed) {
  if (uEdgeKind == 1) {
    // Torn: bigger bites, and a jagged run of small ones.
    return edgeNoise(t * 0.45, seed) * 2.6 + (abs(valueNoise1(t * 14.0 + seed * 3.3) - 0.5) - 0.2) * 3.2 + (valueNoise1(t * 70.0 + seed) - 0.5) * 1.2;
  }
  if (uEdgeKind == 2) {
    // Brush: a soft wander, and bristle strokes reaching out onto the paper.
    // Few and uneven: a stroke here and there, long and thin, the rest a ragged wet edge.
    float bristle = pow(valueNoise1(t * 90.0 + seed * 7.1), 14.0) * 9.0 + pow(valueNoise1(t * 33.0 + seed * 2.3), 9.0) * 6.0;
    return edgeNoise(t * 0.4, seed) * 1.6 + (valueNoise1(t * 60.0 + seed * 1.3) - 0.5) * 1.4 - bristle;
  }
  if (uEdgeKind == 4) {
    // Deckle: small even scallops, a little uneven.
    return (abs(sin(t * 7.0)) - 0.6) * 1.4 + edgeNoise(t, seed) * 0.35;
  }
  return edgeNoise(t, seed);
}

float sminEdge(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / max(k, 1e-3), 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float insideImage(vec2 imagePx, vec2 imageSize) {
  // Each side wanders on its own, at several scales, in pixels of the print
  // (uEdgeIrregularity), and the corners are slightly rounded, as an easel
  // blade and real paper give.
  float a = uEdgeIrregularity;
  float sh = min(imageSize.x, imageSize.y);
  float left = imagePx.x - a * edgeShape(imagePx.y / sh * 9.0, uBorderSeed);
  float right = imageSize.x - imagePx.x - a * edgeShape(imagePx.y / sh * 9.0, uBorderSeed + 31.0);
  float top = imagePx.y - a * edgeShape(imagePx.x / sh * 9.0, uBorderSeed + 57.0);
  float bottom = imageSize.y - imagePx.y - a * edgeShape(imagePx.x / sh * 9.0, uBorderSeed + 83.0);
  float k = a * 2.0 + 0.5;
  float d = sminEdge(sminEdge(left, right, k), sminEdge(top, bottom, k), k);
  // Rounded corners: the rounded box's own distance where it is the nearer edge.
  if (uCornerRadius > 0.0) {
    float r = min(uCornerRadius, 0.5 * min(imageSize.x, imageSize.y));
    vec2 q = abs(imagePx - imageSize * 0.5) - (imageSize * 0.5 - r);
    d = min(d, -(length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r));
  }
  return d;
}

/**
 * The paper round the photo, dressed: the photo's shadow on it, a cut mat's
 * bevel, a line round the photo. inside is how far into the photo this is
 * (negative out on the paper), from insideImage.
 */
vec3 dressPaper(vec3 paper, vec2 imagePx, float inside) {
  float out_ = -inside;
  if (uEdgeKind == 3) {
    // Film: the negative's black edge round the photo, as a filed-out carrier prints it, its outside rough.
    float sh = min(uBaseSize.x, uBaseSize.y);
    float reach = sh * 0.014 * (1.0 + (valueNoise2(imagePx / sh * 90.0 + uBorderSeed) - 0.5) * 0.7 + (valueNoise2(imagePx / sh * 25.0 + uBorderSeed * 2.1) - 0.5) * 0.35 + (valueNoise2(imagePx / sh * 4.0 + uBorderSeed * 3.7) - 0.5) * 0.15);
    paper = mix(vec3(0.028, 0.027, 0.03), paper, smoothstep(reach - 0.8, reach + 0.8, out_));
  }
  if (uShadow > 0.0) {
    // The photo, moved by the offset, darkening the paper under it; soft by the blur.
    float under = insideImage(imagePx - uShadowOffset, uBaseSize);
    float s = smoothstep(-uShadowBlur, uShadowBlur * 0.35, under);
    paper *= 1.0 - uShadow * 0.8 * s;
  }
  if (uBevelWidth > 0.0 && out_ > -1.0 && out_ < uBevelWidth + 1.5) {
    // Which side of the photo this is beside; the bevel slopes down to it,
    // so it faces the photo, and the light comes from the top left.
    vec2 c = imagePx - uBaseSize * 0.5;
    vec2 past = abs(c) - uBaseSize * 0.5;
    vec2 away = past.x > past.y ? vec2(sign(c.x), 0.0) : vec2(0.0, sign(c.y));
    float lit = dot(-away, normalize(vec2(-1.0, -1.0)));
    // The mat's white core, shown by the cut.
    vec3 core = mix(paper, vec3(0.965, 0.955, 0.935), 0.75);
    float band = 1.0 - smoothstep(uBevelWidth - 0.75, uBevelWidth + 0.75, out_);
    paper = mix(paper, clamp(core * (1.0 + lit * uBevelLight * 0.4), 0.0, 1.0), band);
  }
  if (uLineWidth > 0.0) {
    float a = smoothstep(uLineGap - 0.6, uLineGap + 0.6, out_) * (1.0 - smoothstep(uLineGap + uLineWidth - 0.6, uLineGap + uLineWidth + 0.6, out_));
    paper = mix(paper, uLineColour, a);
  }
  return paper;
}

/**
 * Surge marks: how much harder the film developed at this point, 0 upward.
 *
 * Each band is a soft ridge across its width and an envelope along its length
 * that ramps in and then stops. The stop is the characteristic part — developer
 * exhausts, or flow separates, and the streak simply ends rather than fading
 * symmetrically. The across-band centre drifts with distance along the band, so
 * it is never a ruler line.
 */
float surgeAt(vec2 printPx) {
  if (uSurgeStrength <= 0.0 || uSurgeCount < 1) return 0.0;
  float shortSide = min(uPrintSize.x, uPrintSize.y);
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= uSurgeCount) break;
    float fi = float(i);
    float h1 = hash11(fi * 1.7 + uSurgeSeed);
    float h2 = hash11(fi * 3.1 + uSurgeSeed * 1.3);
    float h3 = hash11(fi * 5.3 + uSurgeSeed * 2.7);
    float h4 = hash11(fi * 7.9 + uSurgeSeed * 3.9);

    float angle = radians(uSurgeAngle) + (h1 - 0.5) * 0.45;
    vec2 along = vec2(cos(angle), sin(angle));
    vec2 across = vec2(-along.y, along.x);
    // Start each band outside the frame, on the incoming side, so it is
    // already ramping when it enters. Placing origins uniformly leaves most
    // bands starting somewhere in the middle and never crossing the picture.
    vec2 origin = vec2(h2, h3) * uPrintSize - along * max(uPrintSize.x, uPrintSize.y) * (0.25 + h4 * 0.5);
    vec2 rel = printPx - origin;
    float v = dot(rel, along);
    float u = dot(rel, across);

    // Drift, so the band wanders the way liquid does.
    u -= (valueNoise1(v / (shortSide * 0.3) + fi * 9.0) - 0.5) * shortSide * 0.05;

    float width = shortSide * uSurgeWidth * (0.55 + h4);
    float ridge = exp(-(u * u) / max(width * width, 1.0));

    // Fade in along the band, then cut off.
    float length = max(uPrintSize.x, uPrintSize.y) * (0.75 + h1 * 0.9);
    float fadeIn = smoothstep(0.0, length * 0.8, v);
    float cutOff = 1.0 - smoothstep(length * 0.9, length, v);
    total += ridge * fadeIn * cutOff;
  }
  return min(total, 2.0);
}

/**
 * Scanner artefacts, applied last because they happen when the finished print
 * is digitised — after the film, after the grain, after the dust settles on it.
 *
 * Fixed-pattern rather than random: the same row is always read by the same
 * electronics, so the variation is per-row and per-column and holds still,
 * which is exactly what makes it read as a scan rather than as noise.
 */
vec3 applyScanArtefacts(vec3 c, vec2 printPx) {
  // In the pixels of the photo the edit was made on.
  printPx /= uPixelScale;
  if (uScanLines > 0.0) {
    float row = floor(printPx.y);
    float rowGain = (hash11(row * 0.017 + uScanSeed) - 0.5) * 2.0;
    // A slow ripple from the transport, on top of the per-row offset.
    float banding = sin(printPx.y * 0.11 + uScanSeed) * 0.45
                  + sin(printPx.y * 0.031 + uScanSeed * 2.3) * 0.3;
    c *= 1.0 + (rowGain * 0.7 + banding) * uScanLines * 0.055;
  }
  if (uScanStreaks > 0.0) {
    float col = floor(printPx.x);
    float h = hash11(col * 0.031 + uScanSeed * 3.7);
    // A little variation on every column, and the occasional hard streak.
    float subtle = (h - 0.5) * 2.0 * 0.35;
    float streak = step(0.988, hash11(col * 0.013 + uScanSeed * 7.1)) * (h - 0.5) * 6.0;
    c *= 1.0 + (subtle + streak) * uScanStreaks * 0.05;
  }
  return c;
}

/**
 * Lens falloff, in linear light: it darkens the light arriving at the film,
 * so it belongs before the film's own response, not on top of the result.
 */
vec3 applyVignette(vec3 linear, vec2 basePx) {
  if (uVignette <= 0.0) return linear;
  vec2 centred = (basePx / uBaseSize - 0.5) * 2.0;
  // Correct for aspect so the falloff is circular rather than stretched.
  float aspect = uBaseSize.x / uBaseSize.y;
  centred.x *= aspect > 1.0 ? aspect : 1.0;
  centred.y *= aspect < 1.0 ? 1.0 / aspect : 1.0;
  float r = length(centred) / length(vec2(aspect > 1.0 ? aspect : 1.0, aspect < 1.0 ? 1.0 / aspect : 1.0));
  return linear * (1.0 - uVignette * smoothstep(0.35, 1.0, r));
}

/**
 * Highlight roll-off. A sensor clips at white; film's density saturates, so the
 * last stop of highlight compresses instead of ending in a hard edge. Zero
 * shoulder is the identity, and the curve stays continuous at the knee.
 */
vec3 applyShoulder(vec3 linear) {
  if (uShoulder <= 0.0) return linear;
  const float knee = 0.55;
  float power = 1.0 + 3.0 * uShoulder;
  // Rolled on the brightest channel and the whole colour scaled to match, so
  // a bright orange stays orange as it rolls off. Rolling each channel on its
  // own squeezed the brightest one most and drained the colour toward peach
  // and white; this keeps every hue and saturation the photo had.
  float top = max(linear.r, max(linear.g, linear.b));
  if (top <= knee) return linear;
  float t = clamp((top - knee) / (1.0 - knee), 0.0, 1.0);
  float rolled = knee + (1.0 - knee) * (1.0 - pow(1.0 - t, power));
  return linear * (rolled / top);
}

float fbm2(vec2 p) {
  float sum = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    sum += amp * valueNoise2(p);
    p = p * 2.07 + vec2(17.3, 9.1);
    amp *= 0.5;
  }
  return sum / 0.9375;
}

/**
 * Light leaks and burns at this point: the leaked light's colour (already
 * weighted by coverage), how much leaked light there is, and how much burn.
 *
 * Each spot is an ellipse placed by the user, with its outline broken up by
 * noise so it never reads as a gradient tool, and streaked along its long
 * axis the way light through a slot in the camera back is. Each light spot
 * has its own tint, deeper at its fringe and paler at its core. Distances are
 * in units of the print's short side, so a spot is the same shape at any
 * resolution.
 */
float maskCover(int i, vec2 q, vec3 photo);
float maskCoverGrown(int i, vec2 q, float own);
float maskGlow(int i, vec2 q, float reach, float own);
float maskAt(int i, vec2 q, vec3 photo, float glowReach, out float own);


/**
 * Where the lens shows the scene from: a print position moved as the lens
 * bends the photo about its middle. Barrel (k above 0) draws the edges in
 * from nearer the middle; pincushion pushes them out, zoomed so no edge
 * comes in from outside. As the UI's lensView.ts.
 */
vec2 lensScene(vec2 p) {
  vec2 uv = (p - uImageOffset) / uBaseSize;
  float aspect = uBaseSize.x / uBaseSize.y;
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  float r2 = dot(d, d) / (0.25 * (aspect * aspect + 1.0));
  float s = 1.0 - uLensK * r2;
  if (uLensK < 0.0) s /= 1.0 - uLensK;
  return uImageOffset + (0.5 + (uv - 0.5) * s) * uBaseSize;
}

void leakAt(vec2 printPx, vec2 mqHere, vec3 photoHere, float streaked, vec2 lightShift, out vec3 lightColour, out float light, out float burn, out vec3 tintColour, out float tintAmt, out vec3 litOut, vec2 lensHere) {
  float shortSide = min(uPrintSize.x, uPrintSize.y);
  vec2 qHere = printPx / shortSide;
  // Lighting's lights are on the photo, so through the lens; leaks are on the film.
  vec2 qLit = lensHere / shortSide;
  lightColour = vec3(0.0);
  light = 0.0;
  burn = 0.0;
  tintColour = vec3(0.0);
  tintAmt = 0.0;
  // Lighting's lights (uLeakAxis.w 2, or 3 to tint only): their own sums,
  // apart from the leaks' cap and the grain the leaks push.
  vec3 litColour = vec3(0.0);
  // A count the compiler cannot see (never more than MAX_LEAK_SPOTS): a loop, not eight copies.
  for (int i = 0; i < uLeakCount; i++) {
    float fi = float(i);
    // A light behind the streaks is read as far on along a bar, past its
    // end, as the bar falls short of the longest (see gLightShift): its edge
    // there follows the bars' uneven ends, not its own line across them.
    vec2 shiftPx = uLeakAxis[i].w > 1.5 && uLeakHold[i].y > 0.5 ? lightShift : vec2(0.0);
    vec2 q = (uLeakAxis[i].w > 1.5 ? qLit : qHere) + shiftPx / shortSide;
    vec2 mq = mqHere + shiftPx / uShapeUnit;
    vec4 geo = uLeakGeo[i];
    vec4 axis = uLeakAxis[i];
    vec2 pathInfo = uLeakPath[i];
    bool fromMask = pathInfo.y < -0.5 && pathInfo.y > -1.5;
    int mi = int(pathInfo.x + 0.5);
    // The masks this one reads, in one place (see maskAt): a light's own
    // (with its glow), and for Lighting's lights the one it is held behind
    // (or only in), which with the streaks decides how much is let through.
    vec4 h = uLeakHold[i];
    float cov = 0.0;
    float held = 1.0;
    for (int r = 0; r < 2 + min(uMaskCount, 0); r++) {
      int m = r == 0 ? (fromMask && axis.z > 0.0 ? mi : -1) : (axis.w > 1.5 && h.x >= 0.0 ? int(h.x + 0.5) : -1);
      if (m < 0 || m >= uMaskCount) continue;
      float own;
      float c = maskAt(m, r == 0 ? mq : mqHere, photoHere, r == 0 ? geo.y : 0.0, own);
      if (r == 0) cov = c;
      else held = h.z > 0.5 ? c : 1.0 - c;
    }
    if (axis.w > 1.5 && h.y > 0.5) held *= 1.0 - clamp(streaked, 0.0, 1.0);
    // A light: exactly what its mask covers (outline, feather, key, grow),
    // even, fading away from the side it comes from by its falloff. No
    // noise: it lands where it is drawn.
    if (fromMask) {
      if (mi >= uMaskCount || axis.z <= 0.0) continue;
      // Lighting's light softened (geo.z): its mask averaged over a disc
      // that wide, so it fades in and out over its edge as a drawn one does.
      if (geo.z > 0.0 && axis.w > 1.5 && geo.y <= 0.0) {
        float sum = 0.0;
        float spin = hash21(mq * 517.3) * 6.2831853;
        for (int k = 0; k < 40 + min(uMaskCount, 0); k++) {
          float fk = float(k);
          float rr = geo.z * sqrt((fk + 0.5) / 40.0);
          float ang = spin + fk * 2.3999632;
          sum += maskCover(mi, mq + rr * vec2(cos(ang), sin(ang)), photoHere);
        }
        cov = sum / 40.0;
      }
      if (cov <= 0.0) continue;
      vec4 r = uMaskRect[mi];
      vec2 centre = r.xy + 0.5 * r.zw;
      float toward = dot(mq - centre, axis.xy) / max(0.35 * r.z, 1e-4);
      float lit = 1.0 - geo.x * (1.0 - smoothstep(-1.0, 1.0, toward));
      float cl = cov * lit * axis.z;
      if (axis.w > 0.5 && axis.w < 1.5) {
        burn += cl;
      } else {
        vec3 tint = uLeakTint[i];
        // Paler where it is strongest, as a leak's core is.
        vec3 col = mix(tint * mix(tint, vec3(1.0), 0.4), mix(tint, vec3(1.0), 0.3), lit * 0.6);
        if (axis.w > 1.5) cl *= held;
        if (axis.w > 2.5) {
          tintColour += tint * cl;
          tintAmt += cl;
        } else if (axis.w > 1.5) {
          litColour += col * cl;
        } else {
          lightColour += col * cl;
          light += cl;
        }
      }
      continue;
    }
    float size = max(geo.z, 1e-3);
    float shape;       // 0 at the core, 1 at the edge, before the noise
    float alongCoord;  // position along the spot, for the streaks
    float streakScale;
    vec2 noiseAt;      // where the edge noise is read
    float patches = 1.0;
    bool isShape = false;
    float signedDist = 0.0;
    if (pathInfo.y > 2.5 || pathInfo.y < -1.5) {
      // An area drawn as an outline, lit like a blotch: its normalised
      // distance runs from 0 at the deepest point inside to 1 at the outline
      // (depth, geo.x, is the largest inscribed distance), and everything
      // after this — the noise-broken edge, the falloff, the hot core, the
      // streaks — is the same as for a round spot. Inside-ness is the
      // even-odd crossing count over the sampled outline.
      float best = 1e9;
      bool inside = false;
      if (pathInfo.y < -1.5) {
        // A drawn shape: its distance field, in the masks' layers after them
        // (straight lines between its points, any number of them).
        vec4 lr = uLeakRect[i];
        vec2 luv = (mq - lr.xy) / lr.zw;
        float sdv = ${SDF_RANGE.toFixed(3)};
        if (luv.x >= 0.0 && luv.y >= 0.0 && luv.x <= 1.0 && luv.y <= 1.0) {
          vec2 e = textureLod(uMaskShapes, vec3(luv, pathInfo.x), 0.0).rg;
          sdv = ((e.r * 65280.0 + e.g * 255.0) / 65535.0 - 0.5) * ${(2 * SDF_RANGE).toFixed(3)};
        }
        inside = sdv < 0.0;
        best = abs(sdv);
      }
      int first = int(pathInfo.x);
      int count = pathInfo.y < -1.5 ? 0 : int(pathInfo.y);
      for (int j = 0; j < min(count, ${PATH_SAMPLES}); j++) {
        vec2 pa = uLeakPoints[first + j];
        vec2 pb = uLeakPoints[first + (j + 1 == count ? 0 : j + 1)];
        vec2 ab = pb - pa;
        float t = clamp(dot(q - pa, ab) / max(dot(ab, ab), 1e-10), 0.0, 1.0);
        best = min(best, length(q - (pa + ab * t)));
        if ((pa.y > q.y) != (pb.y > q.y) && q.x < pa.x + (q.y - pa.y) * ab.x / (pb.y - pa.y)) inside = !inside;
      }
      // Everything inside is measured at a blotch's scale, capped at a quarter
      // of the short side: a small shape is one blotch, a big one is full
      // across its interior with the fade only near its edge, and more
      // wobbles and hot patches rather than bigger, blurrier ones. Scaling by
      // the whole shape instead spread one blotch thinner as it grew.
      float blotch = min(max(geo.x, 1e-3), 0.25);
      signedDist = inside ? -best : best;
      shape = max(0.85 * (1.0 + signedDist / blotch), 0.0);
      alongCoord = dot(q, axis.xy) / blotch;
      streakScale = 1.6;
      // Offset by the shape's own seed, which is what rerolling changes.
      noiseAt = q / blotch * 0.9 + vec2(geo.y * 1.37, geo.y * 0.71);
      // Uneven hot patches inside, rather than one smooth dome.
      patches = 0.55 + 0.9 * fbm2(q / blotch * 1.1 + vec2(geo.y * 0.53 + 11.0, geo.y * 1.9));
      isShape = true;
    } else {
      vec2 along = axis.xy;
      vec2 across = vec2(-along.y, along.x);
      vec2 rel = q - geo.xy;
      float a = dot(rel, along) / (size * max(geo.w, 0.2));
      float b = dot(rel, across) / size;
      shape = sqrt(a * a + b * b);
      alongCoord = dot(q, along);
      streakScale = 5.0 / max(geo.w, 0.5);
      noiseAt = q * 2.4;
    }
    float warp = (fbm2(noiseAt + vec2(uLeakSeed * 0.37 + fi * 5.1, fi * 3.3)) - 0.5) * 0.9;
    float d = max(shape + warp, 0.0);
    // Streaks along the spot: the leak is brighter where the gap was wider.
    float streak = (0.65 + 0.7 * fbm2(vec2(alongCoord * streakScale, fi * 7.0 + uLeakSeed))) * patches;
    float c = exp(-d * d * 2.2) * streak * axis.z;
    // A shape's even glow (Texture toward 0): exactly the outline, soft over
    // its edge width either side of it, a little brighter well inside, with
    // no noise anywhere, so it lands where it is drawn. Mixed with the
    // broken-up leak above by the shape's texture; at 1 it is that alone.
    float cleanHeat = 0.0;
    float breakup = isShape ? clamp(geo.z, 0.0, 1.0) : 1.0;
    if (breakup < 1.0) {
      float w = max(geo.w, 0.002);
      float fill = smoothstep(-w, w, -signedDist);
      float deep = clamp(-signedDist / max(geo.x, 1e-3), 0.0, 1.0);
      float clean = fill * (0.8 + 0.2 * smoothstep(0.0, 0.6, deep)) * axis.z;
      cleanHeat = fill * 0.6 * smoothstep(0.1, 0.9, deep);
      c = mix(clean, c, breakup);
    }
    // A drawn shape lit like a light: fading away from where it comes from,
    // and keyed to the photo's darker or lighter pixels, as a mask is.
    if (pathInfo.y < -1.5) {
      vec4 ll = uLeakLight[i];
      if (ll.x > 0.0) {
        vec4 lr = uLeakRect[i];
        vec2 from = vec2(cos(ll.y), sin(ll.y));
        float toward = dot(mq - (lr.xy + 0.5 * lr.zw), from) / max(0.35 * lr.z, 1e-4);
        c *= 1.0 - ll.x * (1.0 - smoothstep(-1.0, 1.0, toward));
      }
      if (ll.z != 0.0) {
        float code = abs(ll.z);
        bool blueKey = code > 3.5;
        float level = (blueKey ? code - 4.0 : code) - 1.0;
        float v = blueKey ? photoHere.b : dot(photoHere, vec3(0.2126, 0.7152, 0.0722));
        float lighter = smoothstep(level - ll.w, level + ll.w, v);
        c *= ll.z > 0.0 ? 1.0 - lighter : lighter;
      }
    }
    if (axis.w > 0.5 && axis.w < 1.5) {
      burn += c;
    } else {
      vec3 tint = uLeakTint[i];
      vec3 outer = tint * mix(tint, vec3(1.0), 0.4);
      vec3 inner = mix(tint, vec3(1.0), 0.35);
      // In a shape the hot core comes in patches, so a big area is not one
      // flat pale wash.
      float heat = exp(-d * d * 7.0) * (isShape ? smoothstep(0.7, 1.3, patches) : 1.0);
      heat = mix(cleanHeat, heat, breakup);
      if (axis.w > 1.5) c *= held;
      if (axis.w > 2.5) {
        tintColour += tint * c;
        tintAmt += c;
      } else if (axis.w > 1.5) {
        litColour += mix(outer, inner, heat) * c;
      } else {
        lightColour += mix(outer, inner, heat) * c;
        light += c;
      }
    }
  }
  // Overlapping leaks add up, but not without limit.
  float capped = min(light, 1.6);
  lightColour *= capped / max(light, 1e-4);
  light = capped;
  burn = min(burn, 1.6);
  litOut = litColour;
  tintAmt = min(tintAmt, 1.0);
}

vec3 applyLeak(vec3 linear, vec3 lightColour, float burn, vec3 tintColour, float tintAmt, vec3 lit) {
  if (uLeak <= 0.0) return linear;
  linear += lightColour * uLeak;
  // Lighting's lights ease off as they near white rather than clipping: each
  // channel gains a share of the room it has left, so a light over a bright
  // sky warms and lifts it without a flat white blob, and over dark it adds
  // nearly as much as it is strong.
  vec3 l = lit * uLeak;
  if (l.r + l.g + l.b > 0.0) linear += max(1.0 - linear, 0.0) * (1.0 - exp(-l));
  // A light that only tints: what is there, in its colour, as bright as it was.
  if (tintAmt > 0.0) {
    vec3 t = tintColour / max(tintAmt, 1e-4);
    vec3 tn = t / max(dot(t, vec3(0.2126, 0.7152, 0.0722)), 1e-4);
    linear = mix(linear, linear * tn, clamp(tintAmt * uLeak, 0.0, 1.0));
  }
  float b = burn * uLeak;
  if (b > 0.0) {
    // A burn: fogged and over-developed, so the edge goes dark and smoky red.
    linear = mix(linear, linear * vec3(0.3, 0.09, 0.05) + vec3(0.012, 0.002, 0.0), clamp(b * 1.2, 0.0, 1.0));
  }
  return linear;
}

/**
 * Where the dither and palette checker may show, 0..1. How much the colour
 * is changing here is the difference between two blurs at nearby scales,
 * measured in bands (steps): an area flat to within a fraction of a band
 * would only show a uniform checker, so with Transitions only it gets none
 * and snaps to a solid band; where the colour moves by a band or more, the
 * pattern stays and reads as a blend.
 */
float ditherMask(vec2 uv, float l, float steps) {
  float m = 1.0;
  if (uDitherTransitions > 0.0) {
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    vec2 calm = texture(uCalm, uv).rg;
    float fine = calm.r;
    float wide = calm.g;
    float change = abs(fine - wide) * max(steps - 1.0, 1.0);
    m *= mix(1.0, smoothstep(0.12, 0.5, change), uDitherTransitions);
  }
  return m;
}

/** The tone range the dither is kept to, with soft edges. */
float toneAllowed(float l) {
  if (uDitherTone.x <= 0.0 && uDitherTone.y >= 1.0) return 1.0;
  return smoothstep(uDitherTone.x - 0.06, uDitherTone.x + 0.06, l) * (1.0 - smoothstep(uDitherTone.y - 0.06, uDitherTone.y + 0.06, l));
}

/**
 * Streaks and masks are measured in short-side units of the photo, from its
 * corner, so a border round it changes nothing about them (see shapeMeasure).
 */
vec2 toShapeUnits(vec2 printPx) {
  return (printPx - uShapeOrigin) / uShapeUnit;
}

vec2 fromShapeUnits(vec2 q) {
  return uShapeOrigin + q * uShapeUnit;
}

/**
 * A streak shape, looked up in its own layer of uStreakShapes rather than
 * tested edge by edge, so an outline can have any number of points at no
 * extra cost here. r is the inside, antialiased: its 0.5 line is the outline.
 */
vec4 streakShape(int i, vec2 p) {
  // Past the frame's sides — the edges running along the flow — a shape
  // carries on as it is at the edge: one drawn out to a side is cut by the
  // frame, not ended by it. A wavy flow takes the lines near the sides out
  // past the photo and back in; ended there, their bars stopped short. The
  // frame's ends (across the flow) still end it, or a bar measured across
  // the shape would have no far side.
  // Fills only: a trail's shape is the subject itself, and carried on past
  // the frame it made one there, so trails came in from the screen's side.
  if (uStreakExtra[i].w < 0.5) {
    vec2 flow = abs(uStreakInfo[i].zw);
    if (flow.y >= flow.x) p.x = clamp(p.x, uShapeFrame.x, uShapeFrame.z);
    else p.y = clamp(p.y, uShapeFrame.y, uShapeFrame.w);
  }
  vec4 r = uStreakRect[i];
  vec2 uv = (p - r.xy) / r.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return vec4(0.0);
  return textureLod(uStreakShapes, vec3(uv, float(i)), 0.0);
}

bool insideStreak(int i, vec2 p) {
  return streakShape(i, p).r > 0.5;
}

/**
 * How far a shape covers p, its outline softened over its feather: the soft
 * edge sits inside the outline (0 on it, 1 a feather in), across it (half a
 * feather either side), or outside it (0 a feather out, 1 on it). The
 * layer's green is the distance from the outline over the feather: 0.5 on
 * it, 1 a feather in, 0 a feather out.
 */
float featherAt(float at, float g) {
  if (at > 1.5) return smoothstep(0.0, 0.5, g);
  if (at > 0.5) return smoothstep(0.25, 0.75, g);
  return smoothstep(0.5, 1.0, g);
}

float featherCover(int i, vec2 p) {
  return featherAt(uStreakFlags[i].z, streakShape(i, p).g);
}

/**
 * A blur of the photo as a streaked pixel sees it: at its colour's source,
 * at the pixel itself, or, partly streaked, a mix of the two in the same
 * share as its colour.
 */
vec3 streakedBlur(sampler2D s, vec2 here, vec2 src, float w) {
  // Blurred from the streaked photo, the streak is already in them.
  if (uPassesStreaked == 1) return texture(s, here).rgb;
  if (w >= 1.0) return texture(s, src).rgb;
  if (w <= 0.0) return texture(s, here).rgb;
  return mix(texture(s, here).rgb, texture(s, src).rgb, w);
}

/**
 * A grain edge: in a soft edge each pixel is wholly streak or wholly photo,
 * picked against a grain pattern, never a mix of the two. Mixed, a dark
 * photo and a light streak make mid-tones that a gradient map paints a
 * colour of their own (a glow round the edge); dissolved, there are none.
 * The pattern is fixed to the photo, so a crop matches the export and a
 * border does not move it.
 */
float grainCut(float w, vec2 printPx) {
  if (w <= 0.0 || w >= 1.0) return w;
  float cell = max(1.0, uShapeUnit / 900.0);
  vec2 at = printPx - uShapeOrigin;
  float n = valueNoise2(at / cell + 31.7) * 0.6 + hash21(floor(at / cell) + 7.3) * 0.4;
  return w > clamp((n - 0.5) * 1.6 + 0.5, 0.0, 1.0) ? 1.0 : 0.0;
}

/** The bars fix f covers: those whose centre is in its span. */
void fixBars(vec4 span, float band, out float k0, out float k1) {
  k0 = ceil(span.y / band - 0.5);
  k1 = floor(span.z / band - 0.5);
  if (k0 > k1) {
    k0 = floor(0.5 * (span.y + span.z) / band);
    k1 = k0;
  }
}

/**
 * How far fix f covers the line t across the flow: wholly over its stretch,
 * as wide as it was drawn (not whole bars: the colours come from the lines,
 * which the bars only cut into lengths), fading over its feather, which
 * straddles its two sides.
 */
float fixCover(int f, float t, float band) {
  float first = uFixSpan[f].y;
  float past = uFixSpan[f].z;
  float fe = uFixTone[f].w;
  if (fe <= 0.0) return t >= first && t < past ? 1.0 : 0.0;
  return smoothstep(first - 0.5 * fe, first + 0.5 * fe, t) * (1.0 - smoothstep(past - 0.5 * fe, past + 0.5 * fe, t));
}

/**
 * How far mask i covers this pixel: its outline softened by its feather
 * (placed inside, across or outside the line, as for streaks), then, with a
 * tone key, only where the photo is darker (or lighter) than the key's level
 * — in brightness, or in its blue
 * — so the mask takes the subject's own edge and the outline can be loose.
 */
/** How far the photo here passes mask i's tone key: darker (or lighter) than its level, in brightness or blue. */
float maskKeyed(int i, vec2 uv, vec3 photo) {
  vec4 f = uMaskFlags[i];
  vec2 k = uMaskKey[i];
  // Measured as brightness, or as how blue the photo is here.
  float v = f.y > 0.5 ? photo.b : dot(photo, vec3(0.2126, 0.7152, 0.0722));
  // Under a collage: where the photo here is not what it was (a sky laid
  // in), the key reads it as it was, kept in the layer's blue.
  if (uCollageOwn == 1) {
    float was = textureLod(uMaskShapes, vec3(uv, float(i)), 0.0).b;
    v = mix(v, was, smoothstep(0.04, 0.12, abs(v - was)));
  }
  float lighter = smoothstep(k.x - k.y, k.x + k.y, v);
  return f.z > 1.5 ? lighter : 1.0 - lighter;
}

float maskCover(int i, vec2 q, vec3 photo) {
  vec4 r = uMaskRect[i];
  vec2 uv = (q - r.xy) / r.zw;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 0.0;
  vec4 f = uMaskFlags[i];
  float c;
  vec4 sh = uMaskShape[i];
  // A drawn mask's layer; and its key, worked out in one place (kept in the
  // layer's blue when matched at the edge by colour, with the layer).
  vec4 t = sh.x > 0.5 ? vec4(0.0) : textureLod(uMaskShapes, vec3(uv, float(i)), 0.0);
  float keyed = f.z > 0.5 ? (sh.x <= 0.5 && sh.w > 0.5 ? t.b : maskKeyed(i, uv, photo)) : 1.0;
  if (sh.x > 1.5) {
    // A gradient: full at its start, nothing at its end.
    vec2 a = sh.yz;
    vec2 ab = uMaskShape2[i].xy - a;
    float t = dot(q - a, ab) / max(dot(ab, ab), 1e-8);
    c = 1.0 - smoothstep(0.0, 1.0, t);
  } else if (sh.x > 0.5) {
    // A soft ellipse: full inside, fading to nothing at its edge.
    vec4 s2 = uMaskShape2[i];
    vec2 d = q - sh.yz;
    float ca = cos(sh.w);
    float sa = sin(sh.w);
    vec2 e = vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / max(s2.xy, vec2(1e-5));
    c = 1.0 - smoothstep(1.0 - max(s2.z, 0.002), 1.0, length(e));
  } else {
    if (sh.y > 0.5 && f.z > 0.5) {
      // Keyed at the edge: the ramp spans a band along it. Well inside, the
      // mask is solid and well outside empty; in the band, the photo's own
      // colours decide, on either side of the line.
      c = max(smoothstep(0.85, 1.0, t.g), keyed * smoothstep(0.0, 0.15, t.g));
    } else c = featherAt(f.x, t.g) * keyed;
    if (sh.z > 0.5) {
      // A selection's painting, in red: none at half, painted in as the photo
      // decides at three quarters, simply in at full; out (none) always wins.
      c = max(c, smoothstep(0.6, 0.7, t.r) * mix(keyed, 1.0, smoothstep(0.85, 0.95, t.r)));
      c *= 1.0 - smoothstep(0.45, 0.05, t.r);
    }
    return c;
  }
  if (f.z > 0.5) c *= keyed;
  return c;
}

/**
 * A mask grown by its margin: the most it covers anywhere within that reach
 * of q, from rings of reads round it (each with the photo there, for a key),
 * so a keyed subject gets a band of empty space round it — past the outline
 * too. Read once per pixel, in the main pass; colour skipping (streakHeld)
 * uses the mask as it is.
 */
/**
 * A glow round mask i, reaching \`reach\` out from its edge: what it covers
 * nearby, blurred (nearer counting more), so the light is brightest at the
 * edge and fades away from it, and nothing where the mask itself is.
 */
float maskGlow(int i, vec2 q, float reach, float own) {
  if (own >= 1.0) return 0.0;
  vec4 r = uMaskRect[i];
  vec2 off = max(max(r.xy - q, q - (r.xy + r.zw)), vec2(0.0));
  if (length(off) > reach) return 0.0;
  // A spiral over the disc, turned per pixel (interleaved gradient noise) so
  // its few samples leave a fine even dither, not rings.
  float spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
  float sum = 0.0;
  float total = 0.0;
  for (int n = 0; n < 40; n++) {
    float t = (float(n) + 0.5) / 40.0;
    float rad = reach * sqrt(t);
    float a = spin + float(n) * 2.39996323;
    vec2 p = q + rad * vec2(cos(a), sin(a));
    float w = exp(-3.0 * sqrt(t));
    vec2 uv = clamp((fromShapeUnits(p) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
    sum += w * maskCover(i, p, textureLod(uBase, uv, 0.0).rgb);
    total += w;
  }
  // Half covered at a straight edge: full there.
  return clamp(2.0 * sum / total, 0.0, 1.0) * (1.0 - own);
}

float maskCoverGrown(int i, vec2 q, float own) {
  float c = own;
  float g = uMaskGrow[i];
  if (g <= 0.0 || c >= 1.0) return c;
  // Turned at random per pixel: fixed rings left the band's edge in chunks.
  float spin = hash21(q * 913.7) * 6.2831853;
  for (int n = 0; n < 96; n++) {
    float ring = float(n / 24 + 1);
    float a = spin + (float(n - (n / 24) * 24) + 0.5 * ring) * 0.26179939;
    vec2 p = q + g * ring / 4.0 * vec2(cos(a), sin(a));
    vec2 uv = clamp((fromShapeUnits(p) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
    c = max(c, maskCover(i, p, textureLod(uBase, uv, 0.0).rgb));
    if (c >= 1.0) break;
  }
  return c;
}

/**
 * Mask i at q (with the photo there, for a key): what it covers grown by its
 * margin, as maskCoverGrown(i, q, maskCover(i, q, photo)); with glowReach,
 * the glow round that, as maskGlow. own: what it covers at q itself.
 *
 * Every read of the mask is at one place, in one loop (q itself, then the
 * margin's rings, then the glow's spiral), and the look's shader calls this
 * in loops whose counts the compiler cannot see: Direct3D's compiler copies
 * a function wherever it is called and unrolls loops it can count, and its
 * copies of the mask took it 26 of the 31 seconds the shader took to build.
 */
float maskAt(int i, vec2 q, vec3 photo, float glowReach, out float own) {
  float g = uMaskGrow[i];
  float c = 0.0;
  own = 0.0;
  float sum = 0.0;
  float total = 0.0;
  float spin = 0.0;
  // -1: q; 0-95: the margin's rings (maskCoverGrown); 96-135: the glow's spiral (maskGlow).
  int last = glowReach > 0.0 ? 135 : g > 0.0 ? 95 : -1;
  for (int n = -1; n <= last; n++) {
    vec2 p = q;
    vec3 ph = photo;
    float w = 0.0;
    if (n >= 0 && n < 96) {
      if (g <= 0.0 || c >= 1.0) continue;
      // Turned at random per pixel: fixed rings left the band's edge in chunks.
      if (n == 0) spin = hash21(q * 913.7) * 6.2831853;
      float ring = float(n / 24 + 1);
      float a = spin + (float(n - (n / 24) * 24) + 0.5 * ring) * 0.26179939;
      p = q + g * ring / 4.0 * vec2(cos(a), sin(a));
      ph = textureLod(uBase, clamp((fromShapeUnits(p) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
    } else if (n >= 96) {
      int k = n - 96;
      if (k == 0) {
        // No glow where the mask covers all, or far past its box.
        vec4 r = uMaskRect[i];
        vec2 off = max(max(r.xy - q, q - (r.xy + r.zw)), vec2(0.0));
        if (c >= 1.0 || length(off) > glowReach) break;
        spin = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) * 6.2831853;
      }
      float t = (float(k) + 0.5) / 40.0;
      float rad = glowReach * sqrt(t);
      float a = spin + float(k) * 2.39996323;
      p = q + rad * vec2(cos(a), sin(a));
      w = exp(-3.0 * sqrt(t));
      ph = textureLod(uBase, clamp((fromShapeUnits(p) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
    }
    float m = maskCover(i, p, ph);
    if (n < 0) {
      own = m;
      c = m;
    } else if (n < 96) {
      c = max(c, m);
    } else {
      sum += w * m;
      total += w;
    }
  }
  if (glowReach <= 0.0) return c;
  // Half covered at a straight edge: full there.
  return total > 0.0 ? clamp(2.0 * sum / total, 0.0, 1.0) * (1.0 - c) : 0.0;
}

/**
 * A streak's own coordinates: s runs with the flow, t across it. Straight
 * streaks use their direction; in perspective, lines through a point. A
 * path makes the flow follow its curve: t is the distance out from it. A
 * line far off a tight bend would fold back on itself there, so it follows
 * a smoother version of the path, one whose bends are wider than its
 * distance (see pathFlow in streaks.ts): uStreakPaths holds PATH_LEVELS
 * versions per streak, a row each, and a line |t| off follows the two
 * whose reach brackets it, mixed. Every version is measured along as the
 * drawn path is.
 */
vec4 pathSample(int i, int side, int level, int k) {
  return texelFetch(uStreakPaths, ivec2(k, (i * 2 + side) * ${PATH_LEVELS} + level), 0);
}

/**
 * Sample k (point, unit tangent) of shape i's path on a side (0: t >= 0,
 * 1: below; each eases only the bends toward it) between versions a and a + 1.
 */
vec4 pathAt(int i, int side, int a, float f, int k) {
  vec4 p = pathSample(i, side, a, k);
  if (f <= 0.0) return p;
  vec4 q = pathSample(i, side, min(a + 1, ${PATH_LEVELS - 1}), k);
  vec4 m = mix(p, q, f);
  return vec4(m.xy, normalize(m.zw));
}

float pathReach(int i, int k) {
  vec4 v = uStreakPathReach[i * 2 + k / 4];
  return v[k % 4];
}

/** The versions a line d off the path follows: a and the next, f of the way. */
void pathLevel(int i, float d, out int a, out float f) {
  for (int k = 1; k < ${PATH_LEVELS}; k++) {
    float r1 = pathReach(i, k);
    if (d <= r1) {
      float r0 = pathReach(i, k - 1);
      a = k - 1;
      f = clamp((d - r0) / max(r1 - r0, 1e-6), 0.0, 1.0);
      return;
    }
  }
  a = ${PATH_LEVELS - 1};
  f = 0.0;
}

/** Where a point of the photo would be through a perfect lens (lensBend.ts unbend). */
vec2 bendUndo(int i, vec2 q) {
  vec4 b = uStreakBend[i];
  if (b.x == 0.0) return q;
  vec2 d = q - b.yz;
  return b.yz + d * (1.0 + b.x * dot(d, d) / (b.w * b.w));
}

/** Where a point through a perfect lens lands through this one (lensBend.ts bend). */
vec2 bendDo(int i, vec2 p) {
  vec4 b = uStreakBend[i];
  if (b.x == 0.0) return p;
  vec2 d = p - b.yz;
  float f = 1.0;
  for (int n = 0; n < 5; n++) f = 1.0 + b.x * dot(d, d) / (f * f * b.w * b.w);
  return b.yz + d / f;
}

vec2 streakPos(int i, vec2 st) {
  vec4 path = uStreakPathInfo[i];
  if (path.y < 2.0) {
    vec2 dir = uStreakInfo[i].zw;
    vec4 v = uStreakVanish[i];
    if (v.w != 0.0) {
      // In perspective: out from the point along the line at angle t.
      vec2 e = v.w * dir;
      float th = v.w * st.y / v.z;
      return bendDo(i, v.xy + v.w * st.x * (e * cos(th) + vec2(-e.y, e.x) * sin(th)));
    }
    return bendDo(i, dir * st.x + vec2(-dir.y, dir.x) * st.y);
  }
  int count = int(path.y);
  float x = st.x / path.z;
  // The segment x falls in, the first or last past either end, where the
  // path carries on straight: one pair of reads for all three cases, as
  // this is compiled in full at every call.
  int k = clamp(int(floor(x)), 0, count - 2);
  float g = x - float(k);
  if (path.x > 0.5) {
    // Swept: the path itself, moved straight across its start-to-end direction.
    vec2 d = uStreakSweep[i].xy;
    vec4 s0 = pathSample(i, 0, 0, k);
    vec4 s1 = pathSample(i, 0, 0, k + 1);
    vec2 p = g <= 0.0 ? s0.xy + s0.zw * (g * path.z)
      : g >= 1.0 ? s1.xy + s1.zw * ((g - 1.0) * path.z)
      : mix(s0.xy, s1.xy, g);
    return p + vec2(-d.y, d.x) * st.y;
  }
  int a;
  float f;
  pathLevel(i, abs(st.y), a, f);
  int side = st.y >= 0.0 ? 0 : 1;
  vec4 p0 = pathAt(i, side, a, f, k);
  vec4 p1 = pathAt(i, side, a, f, k + 1);
  vec4 e = g <= 0.0 ? p0 : p1;
  if (g <= 0.0 || g >= 1.0) {
    float past = g <= 0.0 ? g : g - 1.0;
    return e.xy + e.zw * (past * path.z) + vec2(-e.w, e.z) * st.y;
  }
  vec2 tg = normalize(mix(p0.zw, p1.zw, g));
  return mix(p0.xy, p1.xy, g) + vec2(-tg.y, tg.x) * st.y;
}

float cross2(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}

/**
 * The (s, t) of the line through q on shape i's path between versions a
 * and a + 1, looking at samples j0..j1: the exact reverse of streakPos.
 * Within a segment, streakPos goes out from the path along a normal blended
 * between the segment's two ends; q lies on that line where the vector from
 * the path to q is parallel to the normal, a quadratic in the position along
 * the segment. Taking the nearest point on the segments instead put kinks in
 * every line at the joints, and on the outside of a bend turned bar edges into
 * arcs round each joint.
 */
vec3 projectPath(int i, int side, int a, float f, vec2 q, int count, float ds, int j0, int j1, out vec3 other) {
  float best = 1e9;
  vec2 st = vec2(0.0);
  // The best answer from another arm of the path too (z 1 if there is one):
  // between two arms of a winding path a point is reached from either.
  other = vec3(0.0);
  const float arm = ${OTHER_ARM}.0;
  // Before the start and past the end the path carries on straight.
  if (j0 == 0) {
    vec4 p = pathAt(i, side, a, f, 0);
    vec2 d = q - p.xy;
    if (dot(d, p.zw) < 0.0) {
      st = vec2(dot(d, p.zw), dot(d, vec2(-p.w, p.z)));
      best = abs(st.y);
    }
  }
  if (j1 == count - 1) {
    vec4 p = pathAt(i, side, a, f, count - 1);
    vec2 d = q - p.xy;
    float t = dot(d, vec2(-p.w, p.z));
    if (dot(d, p.zw) > 0.0 && abs(t) < best) {
      st = vec2(float(count - 1) * ds + dot(d, p.zw), t);
      best = abs(t);
    }
  }
  vec4 pa = pathAt(i, side, a, f, j0);
  for (int m = 0; m < ${STREAK_PATH_SAMPLES - 1}; m++) {
    int j = j0 + m;
    if (j >= j1) break;
    vec4 pb = pathAt(i, side, a, f, j + 1);
    vec2 ab = pb.xy - pa.xy;
    vec2 n0 = vec2(-pa.w, pa.z);
    vec2 dn = vec2(-pb.w, pb.z) - n0;
    vec2 d = q - pa.xy;
    // cross(d - ab f, n0 + dn f) = 0
    float c2 = -cross2(ab, dn);
    float c1 = cross2(d, dn) - cross2(ab, n0);
    float c0 = cross2(d, n0);
    vec2 roots = vec2(-1.0);
    if (abs(c2) < 1e-7) {
      if (abs(c1) > 1e-9) roots.x = -c0 / c1;
    } else {
      float disc = c1 * c1 - 4.0 * c2 * c0;
      if (disc >= 0.0) {
        float h = -0.5 * (c1 + (c1 < 0.0 ? -1.0 : 1.0) * sqrt(disc));
        roots = vec2(h / c2, abs(h) > 1e-12 ? c0 / h : -1.0);
      }
    }
    for (int k = 0; k < 2; k++) {
      float g = roots[k];
      if (g < -1e-4 || g > 1.0001) continue;
      g = clamp(g, 0.0, 1.0);
      float t = dot(d - ab * g, normalize(n0 + dn * g));
      vec2 c = vec2((float(j) + g) * ds, t);
      if (abs(t) < best) {
        if (best < 1e8 && abs(st.x - c.x) > arm * ds) other = vec3(st, 1.0);
        else if (other.z > 0.5 && abs(other.x - c.x) <= arm * ds) other = vec3(0.0);
        best = abs(t);
        st = c;
      } else if (abs(st.x - c.x) > arm * ds && (other.z < 0.5 || abs(t) < abs(other.y))) other = vec3(c, 1.0);
    }
    pa = pb;
  }
  return vec3(st, best < 1e8 ? 1.0 : 0.0);
}

/** Newton's method on streakPos for the line through q, from st. */
vec2 pathNewton(int i, vec2 q, vec2 st) {
  const float h = ${PATH_NEWTON_STEP};
  for (int it = 0; it < ${PATH_NEWTON}; it++) {
    vec2 r = streakPos(i, st) - q;
    if (dot(r, r) < 1e-14) break;
    vec2 p = r + q;
    vec2 js = (streakPos(i, st + vec2(h, 0.0)) - p) / h;
    vec2 jt = (streakPos(i, st + vec2(0.0, h)) - p) / h;
    float det = js.x * jt.y - jt.x * js.y;
    if (abs(det) < 1e-9) break;
    vec2 d = -vec2(jt.y * r.x - jt.x * r.y, -js.y * r.x + js.x * r.y) / det;
    float len = length(d);
    if (len > 0.5) d *= 0.5 / len;
    st += d;
  }
  return st;
}

/**
 * The exact reverse of streakPos: the (s, t) whose line passes through q.
 * On a path: found on the drawn path, then by Newton's method on streakPos.
 */
vec2 streakCoords(int i, vec2 q) {
  vec4 path = uStreakPathInfo[i];
  if (path.y < 2.0) {
    // Measured as through a perfect lens: the streak's lines are straight there.
    q = bendUndo(i, q);
    vec2 dir = uStreakInfo[i].zw;
    vec4 v = uStreakVanish[i];
    if (v.w != 0.0) {
      // In perspective: s the distance along a line through the point, t
      // its angle round it, as a distance at the shape's middle.
      vec2 e = v.w * dir;
      vec2 d = q - v.xy;
      return vec2(v.w * length(d), v.w * v.z * atan(cross2(e, d), dot(e, d)));
    }
    return vec2(dot(q, dir), dot(q, vec2(-dir.y, dir.x)));
  }
  int count = int(path.y);
  float ds = path.z;
  if (path.x > 0.5) {
    // Swept: where along the start-to-end direction q is picks the place on
    // the path (they rise together); t is how far across from it.
    vec2 d = uStreakSweep[i].xy;
    vec2 n = vec2(-d.y, d.x);
    vec4 s0 = pathSample(i, 0, 0, 0);
    float a = dot(q - s0.xy, d);
    if (a <= 0.0) {
      float e = a / dot(s0.zw, d);
      return vec2(e, dot(q - (s0.xy + s0.zw * e), n));
    }
    vec4 s1 = pathSample(i, 0, 0, count - 1);
    float aEnd = dot(s1.xy - s0.xy, d);
    if (a >= aEnd) {
      float e = (a - aEnd) / dot(s1.zw, d);
      return vec2(float(count - 1) * ds + e, dot(q - (s1.xy + s1.zw * e), n));
    }
    int lo = 0;
    int hi = count - 1;
    for (int it = 0; it < 8; it++) {
      if (hi - lo <= 1) break;
      int mid = (lo + hi) / 2;
      if (dot(pathSample(i, 0, 0, mid).xy - s0.xy, d) <= a) lo = mid;
      else hi = mid;
    }
    vec2 pl = pathSample(i, 0, 0, lo).xy;
    vec2 ph = pathSample(i, 0, 0, hi).xy;
    float al = dot(pl - s0.xy, d);
    float g = (a - al) / max(dot(ph - s0.xy, d) - al, 1e-12);
    return vec2((float(lo) + g) * ds, dot(q - mix(pl, ph, g), n));
  }
  vec3 other;
  vec2 st = projectPath(i, 0, 0, 0.0, q, count, ds, 0, count - 1, other).xy;
  // Newton's method on streakPos itself, from the drawn path's answer (see
  // pathCoords in streaks.ts): exactly its reverse wherever no line folds.
  // From the nearest arm and the next: of what each settles on, the line
  // nearer its path.
  vec2 a = pathNewton(i, q, st);
  if (other.z < 0.5) return a;
  vec2 b = pathNewton(i, q, other.xy);
  bool fitsA = length(streakPos(i, a) - q) < 1e-4;
  bool fitsB = length(streakPos(i, b) - q) < 1e-4;
  st = fitsB && (!fitsA || abs(b.y) < abs(a.y)) ? b : a;
  return st;
}

/**
 * How far along streak line st of shape i, looking back against the flow
 * (back) or ahead with it, before the line is inside the shape (wantInside)
 * or outside it; -1 if not within limit.
 *
 * The coarse steps sit on a grid fixed along the line, so every pixel on a
 * line sees the same steps: stepped from each pixel instead, whether a thin
 * part of the shape is caught changes with the pixel's position and edges
 * come out dashed. Where the shape's near-edge channel (blue) says an edge
 * may be within a step, the steps in between are checked closely, so thin
 * parts are not stepped over; the last stretch is checked out to exactly
 * the limit, so a distance is never rounded down to the grid. The crossing is
 * then refined by bisection.
 */
/**
 * Each line's crossings of each streak's shape, found once per shape by the
 * lean table program (streakLean.ts) and kept in uStreakPaths below the paths:
 * for streak i, line j (t from uCrossRange[i].z to .w), four texels of
 * entries and exits along s, in pairs (inside from the first to the second),
 * 1e9 where unused, -1e6 / 1e6 where the line starts or ends inside. A
 * search along a line is then a look-up (leanCross); streakCrossing below
 * still marches, for the full shader where the table cannot be drawn.
 */
const int CROSS_LINES = 2048;
const int CROSS_STEPS = 1536;
const int CROSS_ROW = ${MAX_STREAKS * 2 * PATH_LEVELS};

int crossLine(int i, float t) {
  vec4 r = uCrossRange[i];
  if (r.w <= r.z) return -1;
  float f = (t - r.z) / (r.w - r.z);
  if (f < 0.0 || f > 1.0) return -1;
  return int(f * float(CROSS_LINES - 1) + 0.5);
}

/** One interval's say in a look-up: inside, and the nearest edges either way. */
void crossPair(vec2 iv, float s, inout bool inside, inout vec2 span, inout float exitBehind, inout float entryAhead) {
  if (iv.x > 1e8) return;
  if (s >= iv.x && s < iv.y) {
    inside = true;
    span = iv;
  }
  if (iv.y <= s) exitBehind = max(exitBehind, iv.y);
  if (iv.x > s) entryAhead = min(entryAhead, iv.x);
}

float streakCrossing(int i, vec2 st, bool back, float limit, bool wantInside) {
  float stepLen = max(limit / 64.0, 1e-5);
  float dir = back ? 1.0 : -1.0;
  float first = back ? st.x - floor(st.x / stepLen) * stepLen : ceil(st.x / stepLen) * stepLen - st.x;
  float lo = 0.0;
  float hit = -1.0;
  // The steps, the close checks between two of them and the last stretch to
  // the limit share one loop and one read, and the bisection has the other:
  // the read is compiled in full at every call site, and this is called from
  // many. Written as five loops it was most of the shader's compile time;
  // as one, the bisection's branching slowed every render.
  bool close = false; // checking closely from 'from' to 'to'
  int k = 0;
  int m = 0;
  float from = 0.0;
  float to = 0.0;
  bool atLimit = false; // the steps are done, the limit itself read
  for (int it = 0; it < 620; it++) {
    float x;
    if (close) {
      x = from + (to - from) * float(m) / 8.0;
    } else {
      x = first + stepLen * float(k);
      if (x > limit) {
        if (atLimit || lo >= limit) break;
        x = limit;
        atLimit = true;
      } else if (x <= 0.0) {
        k++;
        continue;
      }
    }
    vec4 here = streakShape(i, streakPos(i, st - vec2(x * dir, 0.0)));
    bool found = (here.r > 0.5) == wantInside;
    if (close) {
      if (found) {
        hit = x;
        break;
      }
      lo = x;
      if (++m > 8) {
        if (atLimit) break;
        close = false;
        k++;
      }
    } else if (atLimit) {
      if (!found && here.b <= 0.02) break;
      from = lo;
      to = limit;
      close = true;
      m = 1;
    } else if (found) {
      hit = x;
      break;
    } else if (here.b > 0.02) {
      from = max(x - stepLen, lo);
      to = x;
      close = true;
      m = 1;
    } else {
      lo = x;
      k++;
    }
  }
  if (hit < 0.0) return -1.0;
  for (int b = 0; b < 8; b++) {
    float mid = 0.5 * (lo + hit);
    if (insideStreak(i, streakPos(i, st - vec2(mid * dir, 0.0))) == wantInside) hit = mid;
    else lo = mid;
  }
  return hit;
}

/** Sets component c of o to v (no array: an array written in a loop makes Direct3D's compiler unroll it). */
void crossSet(inout vec4 o, int c, float v) {
  if (c == 0) o.x = v;
  else if (c == 1) o.y = v;
  else if (c == 2) o.z = v;
  else if (c == 3) o.w = v;
}


/**
 * The longest gap outside its shape a fill's line carries its colour across,
 * fraction of the short side. Small: enough for the slivers an overhanging or
 * notched outline leaves, not for something standing up into the shape (a
 * tree into a sky), whose bars should start from it as they always did. At
 * 0.15 a tree's top was bridged in places and not others, and the bars over
 * it came out as one odd dark line.
 */
const float FILL_BRIDGE = 0.03;

/**
 * The first crossing along line st (back or ahead) to inside or outside
 * shape i, as streakCrossing; with bridge, carried on through a short gap
 * the other way, as a fill's line carries its colour (see fillEntry). One
 * call to streakCrossing, in a loop, for all three legs: each call site is
 * compiled in full.
 */
float edgeCross(int i, vec2 st, bool back, float limit, bool wantInside, bool bridge) {
  float dir = back ? 1.0 : -1.0;
  float first = 0.0;
  float gap = 0.0;
  // Not a constant bound, so the loop stays one copy rather than three.
  int legs = (bridge ? 3 : 1) + min(uStreakCount, 0);
  for (int leg = 0; leg < legs; leg++) {
    float off = leg == 0 ? 0.0 : leg == 1 ? first : first + gap;
    float lim = leg == 0 ? limit : leg == 1 ? min(FILL_BRIDGE, limit - first) : limit - first - gap;
    if (leg == 1 && lim <= 0.0) return first;
    float r = streakCrossing(i, st - vec2(off * dir, 0.0), back, lim, leg == 1 ? !wantInside : wantInside);
    if (leg == 0) {
      if (r < 0.0 || !bridge) return r;
      first = r;
    } else if (leg == 1) {
      if (r < 0.0) return first;
      gap = r;
    } else {
      return r < 0.0 ? limit : first + gap + r;
    }
  }
  return first;
}

/**
 * How far back along line st a fill's colour comes from: where the line
 * entered shape i — carried on through a short gap outside it. Where the
 * outline leans back over the flow or has a notch, a line leaves the shape
 * and comes back in a little further on; taken at that second edge, its
 * colour is whatever the photo has right against the outline, and a sliver
 * of it runs up beside the rest as a stray bar. Across a gap no longer than
 * FILL_BRIDGE the colour is the one from further back, as its neighbours'
 * is; a longer gap is another part of the shape, and starts afresh. -1 if
 * the line does not leave the shape within reach.
 */
float fillEntry(int i, vec2 st, float reach) {
  return edgeCross(i, st, true, reach, false, true);
}

/**
 * How far ahead from point from (just inside shape i) a fill's line runs before it
 * reaches the far side — across a short gap outside, as fillEntry carries
 * the colour back across one. -1 if it does not leave within reach.
 */
float fillRun(int i, vec2 from, float reach) {
  return edgeCross(i, from, false, reach, false, true);
}

/**
 * Where a bar's centre line crosses the same edge that line st crossed at
 * crossAt (its distance back from the pixel), as a distance back from the
 * pixel. Bar lengths are measured from here rather than from each line's own
 * crossing, so a bar ends level (or at its tip angle) instead of copying
 * every wiggle of the outline into its end. Falls back to the line's own
 * crossing if the centre line does not meet the edge nearby.
 */
float barCrossing(int i, vec2 st, float centre, float crossAt, float limit, bool edgeEntersShape) {
  vec2 c = vec2(st.x - crossAt, centre);
  // The edge is where the shape starts (trail: looking back, the shape is
  // behind) or ends (fill: looking back, the outside is behind).
  bool behindInside = edgeEntersShape;
  bool here = insideStreak(i, streakPos(i, c));
  // Already past the edge on the centre line: it is further ahead. Behind,
  // a fill's centre line carries on across a short gap, as its lines do.
  bool past = here == behindInside;
  float r = edgeCross(i, c, !past, limit, past != behindInside, !past && !behindInside);
  return r < 0.0 ? crossAt : past ? crossAt - r : crossAt + r;
}

/**
 * Which line across the flow y reads its colour from, for streak i: in the
 * colour stripe it falls in (about the middle width, each edge moved by up
 * to half its share either way, so they run between the thinnest and
 * thickest), the stripe's middle line, or with texture a slice of the edge
 * around it that much as wide as the stripe, spread across it — the edge's
 * own fine lines, wider. Without stripes, y itself: every line its own.
 */
float stripeRead(int i, float y) {
  vec4 sp = uStreakStripe[i];
  if (sp.x <= 0.0) return y;
  float seed = uStreakExtra[i].y * 0.71 + 3.0;
  float k = floor(y / sp.x);
  float b0 = (k + (hash11(k * 5.13 + seed) - 0.5) * sp.y) * sp.x;
  float b1 = (k + 1.0 + (hash11((k + 1.0) * 5.13 + seed) - 0.5) * sp.y) * sp.x;
  if (y < b0) {
    b1 = b0;
    b0 = (k - 1.0 + (hash11((k - 1.0) * 5.13 + seed) - 0.5) * sp.y) * sp.x;
  } else if (y >= b1) {
    b0 = b1;
    b1 = (k + 2.0 + (hash11((k + 2.0) * 5.13 + seed) - 0.5) * sp.y) * sp.x;
  }
  float mid = 0.5 * (b0 + b1);
  return mid + (y - mid) * sp.z;
}

/** What a streak does to one pixel. */
struct StreakHit {
  vec2 src;     // where to read the streaked colour, print px
  float weight; // 0 keeps the photo here, 1 takes the streaked colour
  vec2 tone;    // the streak's brightness (stops) and contrast
  vec4 paint;   // a colour fix recolouring what is read at src: its source's darkest and lightest, the fix, how much (0: none)
  vec3 across;  // across the flow at src (unit, xy) and how many times wider a pixel's share of the source is there (z)
  vec4 echo;    // Repeat: where the repeated stretch is read (xy, print px), how much of its detail (z), how coarse a blur it is measured against (w, a level)
  float echoCopy; // Repeat: how much of the stretch itself, as it is (1 at a bar's start: the subject carried on)
  vec3 echo2;   // Repeat: the next copy's read where one hands over to it (xy, print px), and how much of it (z)
};

const float PHI = 0.6180339887;

/**
 * How much the streaks are held back at q (short-side units): by a mask the
 * streaks section is kept off, or inside a streak mask. A colour read there
 * belongs to something kept in front of the smear.
 */
float streakHeld(vec2 q) {
  // Loops whose counts the compiler cannot see: one copy of each test, not one per streak or mask.
  for (int j = 0; j < uStreakCount; j++) {
    if (uStreakExtra[j].w > 1.5 && insideStreak(j, q)) return 1.0;
  }
  ivec2 use = uSectionMask[5];
  if (use.y != 1 || uMaskCount == 0) return 0.0;
  vec2 uv = clamp((fromShapeUnits(q) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
  vec3 photo = textureLod(uBase, uv, 0.0).rgb;
  float clear = 1.0;
  for (int k = 0; k < uMaskCount; k++) {
    if (((use.x >> k) & 1) == 1) clear *= 1.0 - maskCover(k, q, photo);
  }
  return 1.0 - clear;
}

/**
 * A colour counts as clear of the masks only well clear of them: just past a
 * tone key's level the photo is still nearly as dark as what it keeps, and
 * bars borrowing from there stayed dark.
 */
const float HELD_CLEAR = 0.04;

/** How far back past a held colour a fill's line looks for a clear one, short-side units. */
const float STREAK_MARCH = ${STREAK_MARCH.toFixed(4)};

/**
 * Whether a keyed mask the streaks keep off would take the photo at q for
 * its subject, wherever its outline is: a dark trunk running on below the
 * outline drawn round the tree is still the tree, and no colour for the
 * sky beside it.
 */
bool keyedLikeSubject(vec2 q) {
  ivec2 use = uSectionMask[5];
  if (use.y != 1 || uMaskCount == 0) return false;
  vec2 uv = clamp((fromShapeUnits(q) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
  vec3 photo = textureLod(uBase, uv, 0.0).rgb;
  for (int k = 0; k < ${MAX_MASKS}; k++) {
    if (k >= uMaskCount) break;
    if (((use.x >> k) & 1) == 0) continue;
    vec4 f = uMaskFlags[k];
    if (f.z < 0.5) continue;
    vec2 key = uMaskKey[k];
    float v = f.y > 0.5 ? photo.b : dot(photo, vec3(0.2126, 0.7152, 0.0722));
    float lighter = smoothstep(key.x - key.y, key.x + key.y, v);
    if ((f.z > 1.5 ? lighter : 1.0 - lighter) > 0.5) return true;
  }
  return false;
}

/**
 * The line table, one texel per line across each shape: the along position
 * where the line takes its colour (16 bits of its along range, in red and
 * green), whether the colour there is held back (blue) and whether the line
 * meets the shape at all (alpha). A fill's colour is where the line first
 * enters the shape; a trail's where it last leaves it. Worked out once per
 * render, so a bar can look along many other lines for a clear colour for
 * the price of a texture read each.
 */
vec4 lineTablePass() {
  int i = int(gl_FragCoord.y);
  int k = int(gl_FragCoord.x);
  vec4 info = uLineInfo[i];
  if (i >= uStreakCount || float(k) >= info.z) return vec4(0.0);
  float y = info.x + (float(k) + 0.5) * info.y;
  float span = uLineSpan[i];
  bool trail = uStreakExtra[i].w > 0.5;
  const int STEPS = 384;
  float stepLen = span / float(STEPS);
  float hit = -1.0;
  float prev = 0.0;
  for (int m = 0; m <= STEPS; m++) {
    float x = float(m) * stepLen;
    float s = trail ? info.w + span - x : info.w + x;
    if (insideStreak(i, streakPos(i, vec2(s, y)))) {
      hit = x;
      break;
    }
    prev = x;
  }
  if (hit < 0.0) return vec4(0.0);
  for (int m = 0; m < 10; m++) {
    float mid = 0.5 * (prev + hit);
    float s = trail ? info.w + span - mid : info.w + mid;
    if (insideStreak(i, streakPos(i, vec2(s, y)))) hit = mid;
    else prev = mid;
  }
  // Just outside a fill (as its look-back finds it), just inside a trail.
  float at = trail ? info.w + span - hit : info.w + prev;
  float pull = uStreakEdge[i].y;
  vec2 src = streakPos(i, vec2(trail ? at - 0.002 - pull : at - pull, y));
  // A fill whose colour there is held back (a subject the streak starts
  // against) looks on back along its own line, past the subject, for the
  // first clear colour: the sky beneath it, not a dark rim. The table's
  // range starts STREAK_MARCH before the shape for this (see GrainEngine).
  if (!trail && uStreakInfo[i].x > 0.5 && streakHeld(src) > HELD_CLEAR) {
    const int MARCH_STEPS = 48;
    // Clear there and a little to either side: a line running alongside the
    // subject (beside a tower's shaft) would otherwise take its dark rim.
    const float SIDE = 0.006;
    for (int m = 1; m <= MARCH_STEPS; m++) {
      float back = at - float(m) * (STREAK_MARCH / float(MARCH_STEPS));
      if (back < info.w) break;
      vec2 p = streakPos(i, vec2(back - pull, y));
      // Not past the photo: no mask reaches there, but the colour read is
      // the photo's edge, which may be the subject running out of frame.
      vec2 puv = (fromShapeUnits(p) - uImageOffset) / uBaseSize;
      if (puv.x < 0.0 || puv.y < 0.0 || puv.x > 1.0 || puv.y > 1.0) break;
      if (streakHeld(p) <= HELD_CLEAR && !keyedLikeSubject(p) && streakHeld(streakPos(i, vec2(back - pull, y - SIDE))) <= HELD_CLEAR &&
          streakHeld(streakPos(i, vec2(back - pull, y + SIDE))) <= HELD_CLEAR) {
        // A little further, clear of the subject's own soft rim, if that is clear too.
        float beyond = back - 4.0 * (STREAK_MARCH / float(MARCH_STEPS));
        vec2 q = streakPos(i, vec2(beyond - pull, y));
        vec2 quv = (fromShapeUnits(q) - uImageOffset) / uBaseSize;
        bool on = beyond >= info.w && streakHeld(q) <= HELD_CLEAR && !keyedLikeSubject(q) && all(greaterThanEqual(quv, vec2(0.0))) && all(lessThanEqual(quv, vec2(1.0)));
        at = on ? beyond : back;
        src = on ? q : p;
        break;
      }
    }
  }
  float f = clamp((at - info.w) / max(span, 1e-6), 0.0, 1.0) * 65535.0;
  vec2 uv = clamp((fromShapeUnits(src) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0));
  float lum = dot(textureLod(uBase, uv, 0.0).rgb, vec3(0.2126, 0.7152, 0.0722));
  return vec4(floor(f / 256.0) / 255.0, mod(f, 256.0) / 255.0, lum, streakHeld(src) > HELD_CLEAR ? 0.5 : 1.0);
}

/** Line k of shape i in the table: its colour's along position, that colour's brightness, held back (z), met at all (w). */
vec4 tableLine(int i, int k) {
  vec4 info = uLineInfo[i];
  if (k < 0 || float(k) >= info.z) return vec4(0.0);
  vec4 c = texelFetch(uLineTable, ivec2(k, i), 0);
  if (c.a < 0.25) return vec4(0.0);
  float f = (floor(c.r * 255.0 + 0.5) * 256.0 + floor(c.g * 255.0 + 0.5)) / 65535.0;
  return vec4(info.w + f * uLineSpan[i], c.b, c.a < 0.75 ? 1.0 : 0.0, 1.0);
}

/** A slice of a bar's width from a bar at start: this line's place in it, stretched and maybe flipped. */
float barSlice(float start, float w, float band, float h) {
  float stretch = mix(0.65, 1.45, fract(h * 13.7));
  float x = h > 0.5 ? band - w : w;
  return start + x * stretch;
}

/**
 * Skipping masked colours: line w across bar bandIdx of shape i, whose colour
 * (own) lies under something kept in front of the streaks, takes a clear
 * bar's instead — the nearest clear bars either way found in the line
 * table, then one of the next few dozen clear ones past them, a golden-ratio
 * step on from the bar beside this one's pick, so the bars of a masked run
 * spread over many sources instead of all copying its edge. The colour is
 * read off along its line from its edge, as own is. own if there is none.
 */
vec2 skipRemap(int i, float bandIdx, float w, float off, float band, vec2 own) {
  vec4 info = uLineInfo[i];
  if (info.z <= 0.0) return own;
  // Its own line, if that found a clear colour further back (past the
  // subject, see lineTablePass): the colour just behind it.
  {
    vec4 l = tableLine(i, int(floor(((bandIdx + 0.5) * band - info.x) / info.y)));
    if (l.w > 0.5 && l.z < 0.5) {
      vec2 there = streakPos(i, vec2(l.x + off, bandIdx * band + w));
      if (streakHeld(there) <= HELD_CLEAR) return there;
    }
  }
  // The nearest clear bar each way, judged on its middle line.
  float nearB = -1.0;
  float nearA = -1.0;
  for (int d = 1; d <= 96; d++) {
    float fd = float(d);
    if (nearB < 0.0) {
      vec4 l = tableLine(i, int(floor(((bandIdx - fd + 0.5) * band - info.x) / info.y)));
      if (l.w > 0.5 && l.z < 0.5) nearB = fd;
    }
    if (nearA < 0.0) {
      vec4 l = tableLine(i, int(floor(((bandIdx + fd + 0.5) * band - info.x) / info.y)));
      if (l.w > 0.5 && l.z < 0.5) nearA = fd;
    }
    if (nearB > 0.0 && nearA > 0.0) break;
  }
  if (nearB < 0.0 && nearA < 0.0) return own;
  // A side, the nearer more often; then a bar among the clear ones past
  // the masked run, a golden-ratio step on from the bar beside this one's
  // pick, so the bars of the run spread over many sources.
  float h = hash11(bandIdx * 4.77 + 3.1);
  bool after = nearB < 0.0 || (nearA > 0.0 && h < nearB / (nearA + nearB));
  float side = after ? 1.0 : -1.0;
  float near = after ? nearA : nearB;
  // Which of the next clear bars that way: up to CLEAR_PICKS of them,
  // skipping any masked between.
  const int CLEAR_PICKS = 24;
  int found = 0;
  for (int d = 0; d < 128; d++) {
    float k = bandIdx + side * (near + float(d));
    vec4 l = tableLine(i, int(floor(((k + 0.5) * band - info.x) / info.y)));
    if (l.w > 0.5 && l.z < 0.5) found++;
    if (found >= CLEAR_PICKS) break;
  }
  float u = fract(bandIdx * PHI + (after ? 0.37 : 0.71) + (hash11(bandIdx * 6.13) - 0.5) * 0.18);
  for (int m = 0; m < 2; m++) {
    int want = m == 0 ? int(floor(u * float(found))) : 0;
    int seen = 0;
    float k = bandIdx + side * near;
    for (int d = 0; d < 128; d++) {
      float kk = bandIdx + side * (near + float(d));
      vec4 l = tableLine(i, int(floor(((kk + 0.5) * band - info.x) / info.y)));
      if (l.w > 0.5 && l.z < 0.5) {
        if (seen == want) {
          k = kk;
          break;
        }
        seen++;
      }
    }
    // A slice of it, stretched and maybe flipped; the plain bar if that
    // reaches over a mask's edge.
    for (int n = 0; n < 2; n++) {
      float y2 = n == 0 ? barSlice(k * band, w, band, hash11(bandIdx * 9.13 + float(m))) : k * band + w;
      vec4 line = tableLine(i, int(floor((y2 - info.x) / info.y)));
      if (line.w < 0.5) continue;
      // Read as far on from its edge as this bar reads from its own.
      vec2 there = streakPos(i, vec2(line.x + off, y2));
      if (streakHeld(there) <= HELD_CLEAR || (n == 1 && streakHeld(there) < 0.5)) return there;
    }
  }
  // Last, the nearest clear bar itself, plainly: better its colour than the
  // held one (a dark subject drawn up the sky).
  {
    float kk = bandIdx + side * near;
    float y2 = kk * band + w;
    vec4 line = tableLine(i, int(floor((y2 - info.x) / info.y)));
    if (line.w > 0.5 && line.z < 0.5) {
      vec2 there = streakPos(i, vec2(line.x + off, y2));
      if (streakHeld(there) < 0.5) return there;
    }
  }
  return own;
}

/**
 * Where bar bandIdx of shape i takes its colour, when it does not take its
 * own: a colour fix the bar is in, or (skipping masked colours) a source
 * held back by a mask. own is where it would read, off along its line
 * from its edge at near; a borrowed colour is read as far from its own
 * line's edge. The bar's tone may be nudged (tone.x, stops) and its colour
 * recoloured (paint).
 */
vec2 fixedSource(int i, vec2 st, vec2 own, float near, float off, float reach, bool trail, float bandIdx, float band,
                 inout vec2 tone, inout vec4 paint) {
  float w = st.y - bandIdx * band;
  for (int f = 0; f < ${MAX_STREAK_FIXES}; f++) {
    if (f >= uFixCount) break;
    vec4 span = uFixSpan[f];
    if (int(span.x) != i) continue;
    // Keeping the colours, a fix only changes the tone (see streakAt).
    if (span.w > 1.5) continue;
    // Its bars, and those its feather reaches: there a bar is the fix's or
    // the streak's, more of them the fix's the further in, as one bar
    // cannot be part one source and part another.
    float k0;
    float k1;
    fixBars(span, band, k0, k1);
    float fe = uFixTone[f].w;
    if (fe > 0.0) {
      k0 = floor((k0 * band - 0.5 * fe) / band + 1e-4);
      k1 = ceil(((k1 + 1.0) * band + 0.5 * fe) / band - 1e-4) - 1.0;
      if (bandIdx < k0 || bandIdx > k1) continue;
      float c = fixCover(f, (bandIdx + 0.5) * band, band);
      if (c < 1.0 && c <= hash11(bandIdx * 4.17 + uFixInfo[f].x * 53.0 + 11.0)) continue;
    }
    if (bandIdx < k0 || bandIdx > k1) continue;
    vec4 info = uFixInfo[f];
    vec4 table = uLineInfo[i];
    if (table.z <= 0.0) return own;
    float sd = info.x;
    float vary = info.y;
    bool takeMasked = mod(info.w, 2.0) > 0.5;
    // The source: one stretch across the flow, or the two beside the span,
    // taken as one strip of length total.
    vec4 from = uFixFrom[f];
    float lenB = max(from.y - from.x, 0.0);
    float lenA = max(from.w - from.z, 0.0);
    float total = lenB + lenA;
    if (total < band * 0.5) return own;
    // The span is rebuilt in runs of whole bars, two to six (none longer
    // than the source), each copied from somewhere in the source: so the
    // lines keep the source's texture and how often its colours change, and
    // the seams fall where bars meet. Each run is a little stretched or
    // squeezed, maybe reversed: never a plain copy. Where in the source:
    // each run a golden-ratio step on from the last, jittered, so runs near
    // each other come from far apart and the steps do not read as a rhythm;
    // of a few places near that step, one whose first line is not far in
    // brightness from where the run before ended, so a seam does not add a
    // hard change of its own.
    float most = max(1.0, floor(total / band));
    float runStart = k0;
    float runLen = 1.0;
    float run = 0.0;
    float need = band;
    float start = 0.0;
    bool reversed = false;
    float prevLum = -1.0;
    for (int r = 0; r < 256; r++) {
      float fr = float(r);
      runLen = min(most, 2.0 + floor(hash11(fr * 3.71 + sd * 19.3) * 5.0));
      float stretch = mix(0.85, 1.15, hash11(fr * 5.31 + sd * 7.7));
      need = min(runLen * band * stretch, total);
      reversed = hash11(fr * 8.93 + sd * 3.1) > 0.5;
      float u = fract(sd + fr * PHI + (hash11(fr * 3.17 + sd * 91.3) - 0.5) * 0.18);
      float best = 1e9;
      for (int m = 0; m < 4; m++) {
        float sm = fract(u + float(m) * 0.13) * max(total - need, 0.0);
        if (sm < lenB && sm + need > lenB) sm = lenA >= need ? lenB : max(lenB - need, 0.0);
        if (prevLum < 0.0) {
          start = sm;
          break;
        }
        float q0 = reversed ? sm + need : sm;
        float t0 = q0 < lenB ? from.x + q0 : from.z + q0 - lenB;
        // Only a hard jump counts against a place: steering every seam to a
        // near match would keep the runs to one brightness of the source.
        float cost = max(abs(tableLine(i, int(floor((t0 - table.x) / table.y))).y - prevLum) - 0.1, 0.0) + float(m) * 0.03;
        if (cost < best) {
          best = cost;
          start = sm;
        }
      }
      if (bandIdx < runStart + runLen) break;
      float q1 = reversed ? start : start + need;
      float t1 = q1 < lenB ? from.x + q1 : from.z + q1 - lenB;
      prevLum = tableLine(i, int(floor((t1 - table.x) / table.y))).y;
      runStart += runLen;
      run += 1.0;
    }
    float len = runLen * band;
    float stretch = need / max(len, 1e-6);
    float x = st.y - runStart * band;
    if (reversed) x = len - x;
    float q = start + clamp(x * stretch, 0.0, need);
    float t2 = q < lenB ? from.x + q : from.z + q - lenB;
    vec4 line = tableLine(i, int(floor((t2 - table.x) / table.y)));
    if (line.w < 0.5) return own;
    tone.x += (hash11(run * 6.71 + sd * 29.0) - 0.5) * 0.5 * vary;
    if (span.w > 0.5 && info.z > 0.5) {
      // Recoloured: the source's light and dark, from its darkest to its
      // lightest, pick among the colours (see main).
      float lo = 1.0;
      float hi = 0.0;
      for (int c = 0; c < 48; c++) {
        float qc = total * (float(c) + 0.5) / 48.0;
        float tc = qc < lenB ? from.x + qc : from.z + qc - lenB;
        vec4 l = tableLine(i, int(floor((tc - table.x) / table.y)));
        if (l.w < 0.5 || (!takeMasked && l.z > 0.5)) continue;
        lo = min(lo, l.y);
        hi = max(hi, l.y);
      }
      if (hi < lo) {
        lo = 0.0;
        hi = 1.0;
      }
      paint = vec4(lo, hi, float(f), 1.0);
    }
    // The source line's colour as the streak shows it: one under a mask
    // borrows a clear bar's, just as that bar of the streak does, unless the
    // fix takes masked colours as they are.
    vec2 there = streakPos(i, vec2(line.x + off, t2));
    if (!takeMasked && streakHeld(there) > 0.25) {
      float b2 = floor(t2 / band);
      there = skipRemap(i, b2, t2 - b2 * band, off, band, there);
    }
    return there;
  }
  if (uStreakInfo[i].x > 0.5 && streakHeld(own) > 0.25) return skipRemap(i, bandIdx, w, off, band, own);
  return own;
}

/**
 * In perspective, how many times a length at the shape's middle a bar is
 * whose edge is at s along its line: its distance to the point over the
 * middle's. v is uStreakVanish's entry (distance from the middle in z,
 * toward -1 / away 1 in w, with s = w times the distance).
 */
/** Where line t of shape i meets its drawn end line, along it (s). */
float endLineAt(int i, float t) {
  vec4 info = uStreakEndInfo[i];
  float x = clamp((t - info.x) / info.y, 0.0, ${END_SAMPLES - 1}.0);
  int k = int(floor(x));
  int k1 = min(k + 1, ${END_SAMPLES - 1});
  int base = i * ${END_SAMPLES};
  float a = uStreakEndS[(base + k) / 4][(base + k) % 4];
  float b = uStreakEndS[(base + k1) / 4][(base + k1) % 4];
  return mix(a, b, x - float(k));
}

float perspectiveLength(vec4 v, float s) {
  return max(v.w * s, 0.0) / v.z;
}

/**
 * How far back from a pixel r from the point a bar of length L (at the
 * middle) can have started: toward the point it started further out, so
 * reached further; away, nearer in.
 */
float perspectiveReach(vec4 v, float L, float r) {
  return min(v.w < 0.0 ? L * r / max(v.z - L, 0.05 * v.z) : L * r / (v.z + L), 4.0);
}

/**
 * A keyed mask's edge pixels are part subject, part what is behind it: a
 * needle's edge is partly the sky between needles. Kept in front of a
 * streak, that sky came with them, a pale ring round the subject. Here, a
 * pixel kept from the streaks is taken as a mix of the colours nearby that
 * are surely behind (streaked) and surely in front (kept): how much of it is
 * the one behind, along the line between them, and that colour itself. Near
 * where both are, as fine as the edge allows and wider where it does not.
 * 0 when the two colours are too alike to tell apart, or the pixel is not a
 * mix of them (a third colour off the line between them is the subject's).
 * In linear light, where a soft edge mixes.
 */
vec4 matteMean(sampler2D matte, vec2 uv) {
  vec4 m = vec4(0.0);
  float g = 1.0;
  for (int k = 0; k < 5; k++) {
    m += g * textureLod(matte, uv, uMatteLod + float(k));
    g *= 0.35;
  }
  return m.a < 1e-4 ? vec4(0.0) : vec4(srgbToLinear(clamp(m.rgb / m.a, 0.0, 1.0)), 1.0);
}

float edgeBehind(vec2 uv, vec3 here, out vec3 back) {
  vec4 b = matteMean(uMatteBack, uv);
  vec4 f = matteMean(uMatteFore, uv);
  back = b.rgb;
  if (b.a == 0.0 || f.a == 0.0) return 0.0;
  vec3 fore = f.rgb;
  vec3 i = srgbToLinear(here);
  vec3 d = fore - back;
  float dd = dot(d, d);
  float a = clamp(dot(i - back, d) / max(dd, 1e-6), 0.0, 1.0);
  float off = length(i - (back + a * d));
  float sure = smoothstep(0.002, 0.01, dd) * (1.0 - smoothstep(0.12, 0.3, off));
  return (1.0 - a) * sure;
}

/**
 * Streaks: inside a streak shape, a pixel takes the colour from where its
 * line — run backwards against the flow — entered the shape, so the entering
 * edge is dragged across the inside. The streak is cut into bars across the
 * flow; each bar has its own length between the shortest and longest, and
 * its end is cut at its own angle.
 */
// Per streak, how much its own masks and key let it through at this pixel
// (set in main), and the flow at the last hit, for the prism's split.
/**
 * Repeat (StreakShape.carry): which copy a distance d out from a line's
 * colour edge falls in (k, from 0) and how far through it (u, 0 at its end
 * by the edge, 1 at its far end). Copies can shrink (or grow) each by the
 * same share, as repeats going away would. k below 0: none (past where
 * shrinking copies run out).
 */
vec2 repeatCopy(int i, float d, float L) {
  float g = clamp(uStreakRepeat[i].w, 0.3, 3.0);
  if (abs(g - 1.0) < 1e-3) {
    float k = floor(d / L);
    return vec2(k, d / L - k);
  }
  // Copies L, Lg, Lg^2...: copy k starts L(1 - g^k)/(1 - g) out.
  float x = 1.0 - d * (1.0 - g) / L;
  if (x <= 1e-4) return vec2(-1.0, 0.0);
  float k = max(floor(log(x) / log(g)), 0.0);
  float gk = pow(g, k);
  return vec2(k, clamp((d - L * (1.0 - gk) / (1.0 - g)) / (L * gk), 0.0, 1.0));
}

/**
 * How deep into the subject a mirrored copy k reads, u through it: every
 * other copy flipped, the first included, so each join meets. It reads a
 * whole copy's length, a little in from the edge itself, whose fringe of
 * what is beyond would draw a line at every join. Varied, each copy comes
 * from a stretch further in than the last, four in turn.
 */
float mirrorDepth(int i, float k, float u, float L, float F) {
  float f = mod(k, 2.0) < 0.5 ? u : 1.0 - u;
  float shift = uStreakRepeat[i].z > 1.5 ? mod(k, 4.0) : 0.0;
  return F + (0.04 + f + shift) * L;
}

/**
 * Both depths a pixel d out reads, and how much of the second.
 *
 * Unmirrored, each copy is the stretch from F (Copy from) to a whole copy's
 * length deeper, its deep end against the edge, read whole: with Copy
 * length the subject's own repeat, one join meets the next. Where the
 * first copy meets the subject at the edge is set by Copy from: a whole
 * number of the subject's repeats in, the subject carries straight on;
 * anything else starts the copies part way through one. F is kept a
 * little in from the edge's fringe, which would draw a line at every
 * join. Varied, each copy comes from a whole number of copies further in,
 * four in turn, so the same floors are not stacked up again and again.
 * Toward its far end a copy hands over to the next one carried on below
 * its start, so there is no cut where they join. Mirrored copies meet
 * already.
 */
vec3 repeatDepths(int i, float d, float L, float F) {
  if (uStreakRepeat[i].x < 0.5 || d <= 0.0) return vec3(0.0);
  L = max(L, 1e-9);
  bool varied = uStreakRepeat[i].z > 1.5;
  if (mod(uStreakRepeat[i].z, 2.0) > 0.5) {
    vec2 km = repeatCopy(i, d, L);
    if (km.x < 0.0) return vec3(0.0);
    float m = mirrorDepth(i, km.x, km.y, L, F);
    return vec3(m, m, 0.0);
  }
  float from = max(F, 0.04 * L);
  vec2 ku = repeatCopy(i, d, L);
  if (ku.x < 0.0) return vec3(0.0);
  float a = from + (1.0 - ku.y + (varied ? mod(ku.x, 4.0) : 0.0)) * L;
  float b = from + (2.0 - ku.y + (varied ? mod(ku.x + 1.0, 4.0) : 0.0)) * L;
  return vec3(a, b, smoothstep(0.75, 1.0, ku.y));
}

/**
 * Where along its line a pixel at s reads the repeated stretch, the line's
 * colour edge at e: the two reads of repeatDepths and how much of the
 * second. In perspective the copies are spaced as the subject's own floors
 * would be, carried on toward the point: evenly in one over the distance to
 * it, not in the distance, so each copy is smaller the nearer the point, as
 * the subject is. The first is the set length either way.
 */
vec3 repeatRead(int i, float e, float s) {
  float L = uStreakRepeat[i].y;
  // Copy from: how far in from the edge the copied stretch starts.
  float F = uStreakRepeat2[i].y;
  vec4 vp = uStreakVanish[i];
  if (vp.w == 0.0 || uStreakPathInfo[i].y >= 2.0) {
    vec3 dd = repeatDepths(i, s - e, L, F);
    return vec3(e - dd.x, e - dd.y, dd.z);
  }
  // Distances to the copies' own point (the streak's, moved along the line
  // when the subject's floors shrink faster or slower than its lines meet).
  float g = vp.w;
  float shift = uStreakRepeat3[i].x;
  float re = max(g * e + shift, 1e-4);
  float rp = max(g * s + shift, 1e-4);
  float D = -g * (1.0 / rp - 1.0 / re);
  vec3 dd = repeatDepths(i, D, L / (re * re), F / (re * re));
  float wa = 1.0 / re + g * dd.x;
  float wb = 1.0 / re + g * dd.y;
  return vec3(wa > 1e-6 ? g * (1.0 / wa - shift) : e, wb > 1e-6 ? g * (1.0 / wb - shift) : e, dd.z);
}

float gStreakKeep[${MAX_STREAKS}] = float[${MAX_STREAKS}](${Array(MAX_STREAKS).fill('1.0').join(', ')});
vec2 gFlow = vec2(1.0, 0.0);
/** Two values in one float of the streak cache: each 12 bits, -2048..2047 over scale. */
float pack12(vec2 v, float scale) {
  vec2 k = clamp(floor(v * scale + 0.5) + 2048.0, 0.0, 4095.0);
  return k.x * 4096.0 + k.y;
}
vec2 unpack12(float p, float scale) {
  float hi = floor(p / 4096.0);
  return (vec2(hi, p - hi * 4096.0) - 2048.0) / scale;
}
// Past the end of a trail's bar (or in its soft end): how far on along the
// bar, print px, a light held behind the streaks is read from, so its edge
// moves with each bar's own length. Set by streakAt when uLightBehind is on.
vec2 gLightShift = vec2(0.0);
// How far past the longest bars the search looks for that, short-side units.
const float LIGHT_REACH = 0.2;

StreakHit streakAt(vec2 printPx, float keep) {
  StreakHit none = StreakHit(printPx, 0.0, vec2(0.0), vec4(0.0), vec3(0.0, 0.0, 1.0), vec4(0.0), 0.0, vec3(0.0));
  if (uStreakAmount <= 0.0 || uStreakCount == 0) return none;
#ifdef NO_STREAKS
  // Built without streaks (see FRAGMENT_SHADER_LIGHT): the rest is left out, so not compiled at all.
  return none;
#else
  vec2 q = toShapeUnits(printPx);
  gLightShift = vec2(0.0);
  bool lightAsk = uLightBehind == 1 && (uLinePass == 0 || uLinePass == 5);
  // keep: how much of the streaks the masks let through here (see main).
  if (keep <= 0.0) return none;
  for (int i = 0; i < ${MAX_STREAKS}; i++) {
    if (i >= uStreakCount) break;
    vec4 extra = uStreakExtra[i];
    if (extra.w > 1.5) continue;
    float own = gStreakKeep[i];
    if (own <= 0.0) continue;
    vec4 ends = uStreakEnds[i];
    vec4 edge = uStreakEdge[i];
    float feather = edge.x;
    // The bar ends' own softness, apart from the outline's feather.
    float endSoft = uStreakEndSoft[i];
    float pull = edge.y;
    float band = max(extra.x, 1e-4);
    vec4 ring = uStreakSweep[i];
    if (ring.w > 0.5) {
      // Around (radial): bars are arcs orbiting the middle, in rings a band
      // wide stacked out from the edge, circle radius ring.z. Each starts at
      // its own angle and sweeps round for its length (at the edge, the
      // streak's length; further out the same turn); its lines read the
      // subject inward from where it starts, so a bar keeps the edge's
      // texture. Concentric, so nothing spirals and no ring has a seam.
      vec2 cen = uStreakVanish[i].xy;
      vec2 d = q - cen;
      float r = length(d);
      float R = max(ring.z, 1e-3);
      if (r < R || (ring.y > 0.0 && r > ring.y)) continue;
      float b = floor((r - R) / band);
      float th0 = hash11(b * 7.31 + extra.y * 1.37 + 3.0) * 6.2831853;
      float vary = hash11(b * 3.17 + extra.y * 0.71 + 9.0);
      float sweep = min(edge.z * mix(ends.y, ends.x, vary) / R, 6.2831853);
      float into = mod(atan(d.y, d.x) - th0, 6.2831853);
      if (into > sweep) continue;
      float w = endSoft > 0.0 ? 1.0 - smoothstep(sweep - endSoft / R, sweep, into) : 1.0;
      float rr = max(R - 0.002 - pull - (r - (R + b * band)), 0.0);
      vec2 src = cen + rr * vec2(cos(th0), sin(th0));
      vec4 toneA = uStreakToneStart[i];
      vec4 toneB = uStreakToneEnd[i];
      float ta = into / max(sweep, 1e-4);
      float ch = toneB.w > 0.0 ? smoothstep(toneA.w, toneA.w + toneB.w, ta) : step(toneA.w, ta);
      vec3 tn = mix(toneA.xyz, toneB.xyz, ch);
      w *= keep * own * clamp(tn.z, 0.0, 1.0);
      if (w <= 0.0) continue;
      vec2 fl = vec2(-d.y, d.x);
      gFlow = normalize(fl + vec2(1e-6, 0.0));
      return StreakHit(mix(printPx, fromShapeUnits(src), uStreakAmount), w, tn.xy, vec4(0.0), vec3(0.0, 0.0, 1.0), vec4(0.0), 0.0, vec3(0.0));
    }
    vec2 st = streakCoords(i, q);
    float bandIdx = floor(st.y / band);
    // (This shader keeps its bars where they are and mirrors about the
    // edge between them nearest the middle; the lean programs move them.)
    float mi = floor(uStreakMirror[i].x / band + 0.5);
    // Uneven bar widths: each edge between bars moved by up to half the
    // share either way, so bars run from narrow to wide and the comb of
    // their ends stops reading as a ruled pattern.
    float barMid = (bandIdx + 0.5) * band;
    float barVary = uStreakStripe[i].w;
    if (barVary > 0.0) {
      float k = bandIdx;
      float e0 = (k + barEdgeShift(i, k, mi) * barVary) * band;
      float e1 = (k + 1.0 + barEdgeShift(i, k + 1.0, mi) * barVary) * band;
      if (st.y < e0) {
        k -= 1.0;
        e1 = e0;
        e0 = (k + barEdgeShift(i, k, mi) * barVary) * band;
      } else if (st.y >= e1) {
        k += 1.0;
        e0 = e1;
        e1 = (k + 1.0 + barEdgeShift(i, k + 1.0, mi) * barVary) * band;
      }
      bandIdx = k;
      barMid = 0.5 * (e0 + e1);
    }
    // A path's width: whole bars either side of it, so the side ends along a line.
    float pathWidth = uStreakInfo[i].y;
    if (pathWidth > 0.0 && abs(barMid) > pathWidth) continue;
    // This bar's length: on its own, or following a slow wave across bars.
    vec4 picks = barPicks(i, bandIdx, mi);
    float frac = mix(ends.x, ends.y, mix(picks.y, picks.x, ends.z));
    // Its end is cut at an angle: further along on one side of the bar.
    float turn = picks.z * uStreakPathInfo[i].w;
    float tip = tan(clamp(picks.w * (edge.w + turn), -1.45, 1.45)) * (st.y - barMid);
    // Given values (some GPUs' compilers keep whatever was there before).
    float weight = 0.0;
    vec2 src = q;
    // How far along its bar this pixel is: 0 where the bar takes its
    // colour, 1 where it ends. The streak's tone changes along it.
    float along = 0.0;
    float centre = barMid;
    // A colour fix's nudge to the bar's brightness, and its own colour.
    vec2 nudge = vec2(0.0);
    vec4 paint = vec4(0.0);
    // Repeat: where the repeated stretch is read, and whether it is.
    vec2 echoSrc = vec2(0.0);
    vec2 echoSrc2 = vec2(0.0);
    float echoHand = 0.0;
    float echoAmt = 0.0;
    if (extra.w > 0.5) {
      // Trail: outside the shape, look back along the flow for it; if the
      // bar is within its length, take the colour where this line left it.
      if (insideStreak(i, q)) continue;
      float len = edge.z * frac + tip;
      // A drawn end line: the bar runs to it, its share of the way there.
      bool drawnEnd = uStreakEndInfo[i].w > 0.5;
      float endAt = drawnEnd ? endLineAt(i, centre) : 0.0;
      // Past the end line nothing is streaked, but a light behind the
      // streaks still needs the bar's length there: searched from the line.
      float over = 0.0;
      if (drawnEnd && st.x > endAt + band) {
        over = st.x - endAt - band;
        if (!lightAsk || over > LIGHT_REACH) continue;
        st.x -= over;
      }
      if (len <= 0.0 && !drawnEnd) continue;
      // Search a little past the length: the bar's end is set by its centre
      // line, which may leave the shape nearer than this line does.
      float limit = len * 1.25 + band;
      // In perspective the length is how far a bar would reach at the shape's
      // middle; nearer the point it is shorter, so the search reaches only
      // as far as a bar from here could.
      vec4 vp = uStreakVanish[i];
      bool persp = vp.w != 0.0 && uStreakPathInfo[i].y < 2.0;
      if (drawnEnd) limit = max(st.x - uStreakEndInfo[i].z, 0.0) + band;
      else if (persp) limit = perspectiveReach(vp, len, vp.w * st.x) * 1.25 + band;
      if (lightAsk && !drawnEnd) limit += LIGHT_REACH;
      float hi = streakCrossing(i, st, true, limit, true);
      if (hi < 0.0) continue;
      // The bar's centre line, and in stripes the line this one reads from:
      // one call site, as each is compiled in full.
      float sy = stripeRead(i, st.y);
      float run = hi;
      float leaves = hi;
      int lines = sy == st.y ? 1 : 2;
      for (int c = 0; c < lines; c++) {
        float r = barCrossing(i, st, c == 0 ? centre : sy, hi, limit, true);
        if (c == 0) run = r;
        else leaves = r;
      }
      float soft = endSoft;
      if (drawnEnd) {
        len = max(endAt - (st.x - run), 0.0) * frac + tip;
      } else if (persp) {
        // Each bar as long as its distance to the point allows: the ends
        // are the edge it leaves, drawn smaller toward the point, as the
        // shape carried on in depth would be — not the edge moved along.
        float k = perspectiveLength(vp, st.x - run);
        len *= k;
        soft *= k;
        if (vp.w < 0.0) len = min(len, 0.98 * vp.w * (st.x - run));
      }
      run += over;
      weight = over > 0.0 ? 0.0 : soft > 0.0 ? 1.0 - smoothstep(len - soft, len, run) : step(run, len);
      along = run / max(len, 1e-4);
      // A light behind the streaks, past this bar's end: read as far on as
      // the bar falls short of the longest, so the light's edge keeps the
      // same distance from every bar's end. The first streak found decides.
      if (lightAsk && weight < 1.0 && gLightShift == vec2(0.0) && frac > 1e-3) {
        float longest = max(ends.x, ends.y);
        float shortBy = max(len - tip, 0.0) * max(longest - frac, 0.0) / frac;
        if (shortBy > 0.0) gLightShift = fromShapeUnits(streakPos(i, vec2(st.x + over + shortBy, st.y))) - printPx;
      }
      if (weight <= 0.0) continue;
      // Read a hair inside the shape, so the colour is the subject's; pull
      // reads from deeper inside it. In stripes, where the line it reads
      // from leaves the shape.
      src = streakPos(i, vec2(st.x - leaves - 0.002 - pull, sy));
      if (uStreakRepeat[i].x > 0.5) {
        vec3 rr = repeatRead(i, st.x - leaves - 0.002, st.x);
        echoSrc = streakPos(i, vec2(rr.x - pull, sy));
        echoSrc2 = streakPos(i, vec2(rr.y - pull, sy));
        echoHand = rr.z;
        echoAmt = 1.0;
      }
      src = fixedSource(i, st, src, st.x - hi, -0.002 - pull, extra.z, true, bandIdx, band, nudge, paint);
    } else {
      // Fill: colour from where the line entered the shape, carried along it.
      bool clipped = uStreakFlags[i].x > 0.5;
      bool across = uStreakFlags[i].y > 0.5;
      // Unclipped, bars always grow from the colour edge: there is no far
      // edge to hang them from.
      bool fromEdge = !clipped || ends.w > 0.5;
      float reach = extra.z;
      bool inside = insideStreak(i, q);
      // A clipped fill's soft edge; set to centre or outside, it reaches past
      // the outline, so the streak runs right up to the line and fades out
      // beyond it instead of starting a feather inside.
      float cover = clipped && feather > 0.0 ? featherCover(i, q) : 1.0;
      if (!inside && clipped && cover <= 0.0) continue;
      float depth = 0.0; // back along this line to where it entered the shape
      if (inside) {
        depth = fillEntry(i, st, reach);
        if (depth < 0.0) depth = reach;
      } else {
        // Past the shape, an unclipped fill runs on — and a clipped one's
        // soft edge reaches a little way: look back for the shape, then on
        // back through it to where the line entered.
        vec4 vpr = uStreakVanish[i];
        float runOn = edge.z * max(ends.x, ends.y);
        if (vpr.w != 0.0 && uStreakPathInfo[i].y < 2.0) runOn = perspectiveReach(vpr, runOn, vpr.w * st.x) * 1.25;
        float exitAt = streakCrossing(i, st, true, clipped ? 2.0 * feather : runOn + 4.5 * band, true);
        if (exitAt >= 0.0) {
          float through = fillEntry(i, st - vec2(exitAt, 0.0), reach);
          depth = exitAt + (through < 0.0 ? reach : through);
        } else {
          // Just before the edge the colour comes from: that edge's colour,
          // carried back over the feather.
          if (!clipped) continue;
          float ahead = streakCrossing(i, st, false, 2.0 * feather, true);
          if (ahead < 0.0) continue;
          depth = -ahead;
        }
      }
      // The same, to where the bar's centre line entered: bars are measured
      // from there, so each ends level.
      // In stripes, also where the line this one reads from entered.
      float sy = stripeRead(i, st.y);
      float barDepth = depth;
      float enters = depth;
      int lines = sy == st.y ? 1 : 2;
      for (int c = 0; c < lines; c++) {
        float r = barCrossing(i, st, c == 0 ? centre : sy, depth, reach, false);
        if (c == 0) barDepth = r;
        else enters = r;
      }
      // How far the bar's centre line runs across the shape, edge to edge.
      float run = reach;
      if (clipped && (across || !fromEdge)) {
        // From a hair inside the edge: the crossing found going back is the
        // first point outside, so measured from there the look ahead could
        // take the near edge itself for the far one wherever its first step
        // falls short of the line — a run of nothing, and a whole bar left
        // empty top to bottom.
        const float INTO = 5e-4;
        float r = fillRun(i, vec2(st.x - barDepth + INTO, centre), reach);
        if (r > 0.0) run = r + INTO;
        // A bar is as long as the longest way across it, not just its centre
        // line's: beside an edge that leans over the bar, the centre line
        // runs out through the side early, and measured on it alone the bar
        // came out a fraction of its neighbours' length, its tone running
        // dark to light over that little way. Its lines that do leave early
        // are clipped by the outline as before.
        for (int side = -1; side <= 1; side += 2) {
          float other = fillRun(i, vec2(st.x - barDepth + INTO, centre + float(side) * 0.35 * band), reach);
          if (other > 0.0) run = max(run, other + INTO);
        }
        // Inside, yet past where the bar's centre line leaves the shape: the
        // outline cuts across this bar (a step, or an edge leaning across
        // the flow), and measured on the centre line all of the bar beyond
        // the cut would be left empty. Measure it on this pixel's own line.
        if (inside && barDepth > run) {
          barDepth = depth;
          float own = fillRun(i, vec2(st.x - depth + INTO, st.y), reach);
          run = own > 0.0 ? own + INTO : reach;
        }
      }
      float full = (clipped && across ? run : edge.z) * frac;
      // In perspective a bar's length is as for a trail: drawn smaller the
      // nearer its colour edge is to the point.
      vec4 vpf = uStreakVanish[i];
      if (vpf.w != 0.0 && uStreakPathInfo[i].y < 2.0 && !(clipped && across)) {
        full *= perspectiveLength(vpf, st.x - barDepth);
        if (vpf.w < 0.0) full = min(full, 0.98 * vpf.w * (st.x - barDepth));
      }
      float readAt = st.x - depth - pull;
      if (fromEdge) {
        // The bar grows from the colour edge and stops at its length. One
        // that reaches the far side is not cut there by its own length: the
        // outline's soft edge decides, so set outside it fades out past it.
        float stop = full + tip;
        along = barDepth / max(full + tip, 1e-4);
        if (clipped && full >= run * 0.999) stop += 2.0 * feather;
        weight = endSoft > 0.0 ? 1.0 - smoothstep(stop - endSoft, stop, barDepth) : step(barDepth, stop);
      } else {
        // The bar hangs from the far edge and starts this far in, with the
        // colour from where it starts; before that the picture shows.
        float start = max(run - full, 0.0);
        weight = endSoft > 0.0 ? smoothstep(start + tip, start + tip + endSoft, barDepth) : step(start + tip, barDepth);
        along = (barDepth - start) / max(run - start, 1e-4);
        readAt = st.x - barDepth + start - pull;
      }
      // The outline's soft edge is for streaks kept inside it.
      weight *= cover;
      // Inside its shape a fill has the say here; past it, another streak may.
      if (weight <= 0.0) {
        if (inside) return none;
        continue;
      }
      // In stripes, from the line it reads from: where that entered the
      // shape, as far on from there as this line reads from its own entry.
      // Repeat: deeper into the subject the further this pixel is along from
      // where its colour is read.
      if (uStreakRepeat[i].x > 0.5) {
        float edgeAt = readAt + pull + depth - enters;
        vec3 rr = repeatRead(i, edgeAt, edgeAt + st.x - pull - readAt);
        echoSrc = streakPos(i, vec2(rr.x - pull, sy));
        echoSrc2 = streakPos(i, vec2(rr.y - pull, sy));
        echoHand = rr.z;
        echoAmt = 1.0;
      }
      src = streakPos(i, vec2(readAt + depth - enters, sy));
      src = fixedSource(i, st, src, st.x - depth, readAt - (st.x - depth), reach, false, bandIdx, band, nudge, paint);
    }
    // The tone along the bar: the start's brightness, contrast and opacity
    // until the change begins, easing to the end's over the change's length
    // (a step when that is 0).
    vec4 toneA = uStreakToneStart[i];
    vec4 toneB = uStreakToneEnd[i];
    float t = clamp(along, 0.0, 1.0);
    float change = toneB.w > 0.0 ? smoothstep(toneA.w, toneA.w + toneB.w, t) : step(toneA.w, t);
    vec3 tone = mix(toneA.xyz, toneB.xyz, change);
    // Each fix's own tone, on its bars, easing in over its feather; and what
    // its bars carry, if it says: the subject copied, or the streak's colour.
    float carryCopy = uStreakRepeatMask[i] < -1.5 ? 0.0 : 1.0;
    for (int f = 0; f < ${MAX_STREAK_FIXES}; f++) {
      if (f >= uFixCount) break;
      if (int(uFixSpan[f].x) != i) continue;
      vec4 ft = uFixTone[f];
      float c = fixCover(f, st.y, band);
      if (c <= 0.0) continue;
      tone += c * vec3(ft.x, ft.y, 0.0);
      tone.z *= mix(1.0, ft.z, c);
      float carry = floor(uFixInfo[f].w / 2.0 + 0.01);
      if (carry > 0.5) carryCopy = mix(carryCopy, carry < 1.5 ? 1.0 : 0.0, c);
    }
    weight *= keep * own * clamp(tone.z, 0.0, 1.0);
    if (uStreakFlags[i].w > 0.5) weight = grainCut(weight, printPx);
    if (weight <= 0.0) return none;
    {
      vec2 fl = fromShapeUnits(src) - printPx;
      gFlow = dot(fl, fl) > 4.0 ? normalize(fl) : normalize(uStreakInfo[i].zw + vec2(1e-6, 0.0));
    }
    // In perspective the lines spread apart going back to their colour, so a
    // pixel here covers a wider stretch across them there: read narrowly,
    // the source's fine detail aliased into hairline stripes.
    vec3 across = vec3(0.0, 0.0, 1.0);
    vec4 v = uStreakVanish[i];
    if (v.w != 0.0 && uStreakPathInfo[i].y < 2.0) {
      vec2 away = src - v.xy;
      float spread = length(away) / max(length(q - v.xy), 1e-5);
      across = vec3(normalize(vec2(-away.y, away.x)), mix(1.0, spread, uStreakAmount));
    }
    // Repeat: its detail fades along the bar, into the smear.
    // At the bar's start, the stretch itself as it is — the subject carried
    // on — until Hold, then easing into the streak's colour with its lines.
    vec4 echo = vec4(0.0);
    float echoCopy = 0.0;
    if (echoAmt > 0.0) {
      vec4 r2 = uStreakRepeat2[i];
      float a = clamp(along, 0.0, 1.0);
      echo = vec4(mix(printPx, fromShapeUnits(echoSrc), uStreakAmount), echoAmt * r2.x * mix(1.0, 0.2, a), r2.z);
      // Held all the way, the copy never gives way: the subject carried on, no streak.
      echoCopy = r2.w >= 0.999 ? 1.0 : r2.w > 0.0 ? 1.0 - smoothstep(r2.w * 0.35, r2.w, a) : 0.0;
      // Kept to part of the subject: by the mask where this bar takes its
      // colour, so a bar copies or keeps the streak's colour whole.
      echo.z *= carryCopy;
      echoCopy *= carryCopy;
      int rm = int(uStreakRepeatMask[i] + 0.5);
      if (uStreakRepeatMask[i] >= 0.0 && rm < uMaskCount) {
        vec3 there = textureLod(uBase, clamp((fromShapeUnits(src) - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
        float part = maskCover(rm, src, there);
        echo.z *= part;
        echoCopy *= part;
      }
    }
    vec3 echo2 = echoAmt > 0.0 ? vec3(mix(printPx, fromShapeUnits(echoSrc2), uStreakAmount), echoHand) : vec3(0.0);
    return StreakHit(mix(printPx, fromShapeUnits(src), uStreakAmount), weight, tone.xy + nudge, paint * vec4(1.0, 1.0, 1.0, uStreakAmount), across, echo, echoCopy, echo2);
  }
#endif
  return none;
}

/** 4x4 Bayer threshold for a cell, centred: -0.47 .. +0.47. */
float bayer4(vec2 cell) {
  int idx = int(mod(cell.y, 4.0)) * 4 + int(mod(cell.x, 4.0));
  float m[16] = float[16](0.0, 8.0, 2.0, 10.0, 12.0, 4.0, 14.0, 6.0, 3.0, 11.0, 1.0, 9.0, 15.0, 7.0, 13.0, 5.0);
  return (m[idx] + 0.5) / 16.0 - 0.5;
}

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-6)), d / (q.x + 1e-6), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

/**
 * A colour stock (engine/stocks.ts), on encoded values: anchored hue moves,
 * saturation, a split tone and an S-curve. Grey stays grey through the hue
 * moves — a pixel with no saturation has no hue to move.
 */
vec3 applyStock(vec3 c) {
  vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
  float shift = 0.0;
  float sat = 1.0;
  for (int i = 0; i < ${MAX_HUE_MOVES}; i++) {
    if (i >= uHueMoveCount) break;
    vec4 m = uHueMoves[i];
    float d = abs(fract(hsv.x - m.x + 0.5) - 0.5);
    float w = exp(-(d * d) / max(m.w * m.w, 1e-4));
    shift += m.y * w;
    sat *= mix(1.0, m.z, w);
  }
  hsv.x = fract(hsv.x + shift);
  hsv.y = clamp(hsv.y * sat * uStockSat, 0.0, 1.0);
  vec3 g = hsv2rgb(hsv);
  float l = dot(g, vec3(0.2126, 0.7152, 0.0722));
  g = g * mix(vec3(1.0), uStockGain, smoothstep(0.25, 1.0, l)) + uStockLift * pow(1.0 - clamp(l, 0.0, 1.0), 2.0);
  g = clamp(g, 0.0, 1.0);
  vec3 sCurve = g * g * (3.0 - 2.0 * g);
  g += (sCurve - g) * uStockContrast;
  // Keep the photo's own brightness, taking only the stock's colour.
  float before = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float after = dot(g, vec3(0.2126, 0.7152, 0.0722));
  vec3 toned = g * (before + 1e-3) / (after + 1e-3);
  // Where holding the brightness would push a channel past white, give up
  // saturation instead of brightness: pull toward grey until it fits.
  float top = max(toned.r, max(toned.g, toned.b));
  if (top > 1.0) toned = vec3(before) + (toned - vec3(before)) * (1.0 - before) / max(top - before, 1e-4);
  g = mix(g, clamp(toned, 0.0, 1.0), uStockKeepTone);
  return mix(c, g, uStockStrength);
}

/**
 * The Sabattier effect: above a threshold, brightness first flattens and then
 * falls, so the brightest tones partly reverse — the middle of a white area
 * goes darker than its edges. Reversed tones take on the glow colour, as the
 * re-exposed dye layers do unevenly.
 */
// Black & white film: the filter decides how bright each colour prints.
vec3 applyMono(vec3 c) {
  float y = dot(srgbToLinear(c), uMonoMix);
  float s = clamp(linearToSrgb(vec3(y)).r, 0.0, 1.0);
  if (uMonoContrast > 0.0) s = mix(s, s * s * (3.0 - 2.0 * s), uMonoContrast);
  else if (uMonoContrast < 0.0) s = mix(s, 0.5 - sin(asin(1.0 - 2.0 * s) / 3.0), -uMonoContrast);
  if (uMonoToneAmount <= 0.0) return vec3(s);
  // Toned the way a print is: the colour in the shadows and mids, the
  // paper's white left white.
  float tl = max(dot(uMonoTone, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
  vec3 toned = clamp(s * uMonoTone / tl, 0.0, 1.0);
  return mix(vec3(s), toned, uMonoToneAmount * (1.0 - s * s * 0.7));
}

// One screen of a halftone: how much ink covers this point, for a tone
// needing \`cover\` of the cell inked. Dots grow from the cell's middle;
// lines thicken across it.
float screenAt(vec2 p, float cell, float angle, float cover, int lines) {
  float ca = cos(angle);
  float sa = sin(angle);
  vec2 q = vec2(ca * p.x + sa * p.y, -sa * p.x + ca * p.y) / cell;
  vec2 f = fract(q) - 0.5;
  float aa = 0.7 / cell;
  if (lines == 1) {
    float w = cover * 0.5;
    return 1.0 - smoothstep(w - aa, w + aa, abs(f.y));
  }
  float r = sqrt(clamp(cover, 0.0, 1.0)) * 0.71;
  return 1.0 - smoothstep(r - aa, r + aa, length(f));
}

// Halftone and riso print: the picture as ink dots on paper.
vec3 applyHalftone(vec3 c, vec2 p) {
  float l = clamp(dot(c, vec3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  if (uHalftoneStyle == 2) {
    // Two inks, two screens at their own angles, the second plate slipped a
    // little as a riso's drums never quite line up. The dark ink for the
    // shadows, the light one through the midtones.
    float coverA = smoothstep(0.3, 0.95, 1.0 - l);
    float coverB = clamp((1.0 - l) * 1.25, 0.0, 1.0) * 0.85;
    float a = screenAt(p, uHalftoneCell, uHalftoneAngle, coverA, 0);
    float b = screenAt(p + vec2(uHalftoneSlip, uHalftoneSlip * 0.6), uHalftoneCell, uHalftoneAngle + 0.5236, coverB, 0);
    return uHalftonePaper * mix(vec3(1.0), uInkB, b) * mix(vec3(1.0), uInkA, a);
  }
  float ink = screenAt(p, uHalftoneCell, uHalftoneAngle, 1.0 - l, uHalftoneStyle);
  return mix(uHalftonePaper, uInkA, ink);
}

vec3 applySolarize(vec3 c) {
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  float l = dot(c, W);
  float t = uSolarizeFrom;
  float u = clamp((l - t) / max(1.0 - t, 1e-3), 0.0, 1.0);
  float drop = uSolarize * (1.0 - t) * 1.1 * u * u;
  if (drop <= 0.0) return c;
  vec3 reversed = c * max(l - drop, 0.0) / max(l, 1e-4);
  vec3 tint = pow(uGlowTint, vec3(1.0 / 2.2));
  tint /= max(max(tint.r, tint.g), tint.b);
  // A hint of the glow colour in the reversed tones, not a wash of it.
  return mix(reversed, reversed * tint, clamp(drop * 1.6, 0.0, 0.45));
}

/**
 * Colour on top of the photo's own, on encoded values. Every control is zero
 * by default and none of them moves brightness: vibrance and the tints are
 * chroma moves, and warmth and tint are rebalanced to keep luminance.
 */
vec3 applyGrade(vec3 c) {
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  float l = dot(c, W);
  // How much each pixel is the standout colour: a band of hues around the
  // chosen one, faded out for near-greys, whose hue means nothing.
  float keep = 0.0;
  if (uIsolateAmount > 0.0 || uPopAmount > 0.0 || uPopKeep > 0.0 || uDitherSparePop > 0.0) {
    vec3 hsv0 = rgb2hsv(clamp(c, 0.0, 1.0));
    float d0 = abs(fract(hsv0.x - uIsolateHue + 0.5) - 0.5);
    keep = exp(-(d0 * d0) / max(uIsolateWidth * uIsolateWidth * 0.06, 1e-5)) * smoothstep(0.04, 0.2, hsv0.y);
  }
  gStandout = keep;
  if (uIsolateAmount > 0.0 || uPopAmount > 0.0) {
    // Keep a band of hues around the chosen one; everything else loses its
    // saturation.
    vec3 hsv = rgb2hsv(clamp(c, 0.0, 1.0));
    if (uPopAmount > 0.0) {
      // The kept colour takes the pop colour's hue, with its own brightness
      // and saturation (scaled by how deep the pop colour is: grey greys it).
      vec3 pop = rgb2hsv(clamp(uPopColour, 0.0, 1.0));
      vec3 recoloured = hsv2rgb(vec3(pop.x, hsv.y * min(1.0, pop.y * 1.6), hsv.z));
      c = mix(c, recoloured, keep * uPopAmount);
    }
    if (uIsolateAmount > 0.0) {
      // The rest goes to its own brightness in the rest colour: plain grey for
      // a neutral one. Where holding the brightness would clip, it gives up
      // saturation, as the gradient map does.
      float lm = clamp(dot(c, W), 0.0, 1.0);
      vec3 rest = uRestColour * (lm + 1e-3) / (dot(uRestColour, W) + 1e-3);
      float top = max(rest.r, max(rest.g, rest.b));
      if (top > 1.0) rest = vec3(lm) + (rest - vec3(lm)) * (1.0 - lm) / max(top - lm, 1e-4);
      c = mix(clamp(rest, 0.0, 1.0), c, mix(1.0 - uIsolateAmount, 1.0, keep));
    }
  }
  if (uBlobCount > 0) {
    // Colour blobs: the pixel's point on the wheel is pulled toward the blobs
    // that reach it, on the tones they are set to; it keeps its brightness.
    vec3 hsv = rgb2hsv(c);
    float ang = hsv.x * 6.28318531;
    vec2 p = hsv.y * vec2(sin(ang), cos(ang));
    float lb = clamp(dot(c, W), 0.0, 1.0);
    float tb = clamp((lb - uMapRange.x) / max(uMapRange.y - uMapRange.x, 0.05), 0.0, 1.0);
    vec2 pull = vec2(0.0);
    float total = 0.0;
    for (int i = 0; i < ${MAX_BLOBS}; i++) {
      if (i >= uBlobCount) break;
      vec4 a = uBlobA[i];
      vec4 b = uBlobB[i];
      float d = length(p - a.xy);
      float w = a.z >= 2.0 ? 1.0 : exp(-(d * d) / (a.z * a.z));
      if (b.y < 1.0) w *= exp(-((tb - b.x) * (tb - b.x)) / (b.y * b.y));
      w *= a.w;
      pull += w * (a.xy - p);
      total += w;
    }
    if (total > 1e-4) {
      vec2 q = p + pull / max(1.0, total);
      float hue = fract(atan(q.x, q.y) / 6.28318531 + 1.0);
      vec3 raw = hsv2rgb(vec3(hue, min(1.0, length(q)), 1.0));
      vec3 moved = raw * (lb + 1e-3) / (dot(raw, W) + 1e-3);
      float top = max(moved.r, max(moved.g, moved.b));
      if (top > 1.0) moved = vec3(lb) + (moved - vec3(lb)) * (1.0 - lb) / max(top - lb, 1e-4);
      c = clamp(moved, 0.0, 1.0);
    }
  }
  if (uMapAmount > 0.0) {
    // Three-colour ramp by brightness, then rescaled to the pixel's own
    // brightness: the tones stay, the colour is replaced.
    float lm = clamp(dot(c, W), 0.0, 1.0);
    // Position along the ramp is relative to the photo's own range, so every
    // photo uses all three colours.
    float t = clamp((lm - uMapRange.x) / max(uMapRange.y - uMapRange.x, 0.05), 0.0, 1.0);
    // Balance: the midtone colour slides toward the shadows or the light.
    t = pow(t, exp2(-uMapShape.y));
    // Contrast: the brightness handed back, pulled apart (or drawn together)
    // about the middle of the photo's range. A power curve each side of it,
    // so it never clips and never reverses a tone.
    float m = clamp((uMapRange.x + uMapRange.y) * 0.5, 0.05, 0.95);
    float k = exp2(uMapShape.x * 1.2);
    vec3 mapped = t < 0.5 ? mix(uMapShadow, uMapMid, t * 2.0) : mix(uMapMid, uMapHigh, t * 2.0 - 1.0);
    float lt = lm < m ? m * pow(lm / m, k) : 1.0 - (1.0 - m) * pow((1.0 - lm) / (1.0 - m), k);
    mapped *= (lt + 1e-3) / (dot(mapped, W) + 1e-3);
    // Where holding the brightness would clip, give up saturation instead.
    float top = max(mapped.r, max(mapped.g, mapped.b));
    if (top > 1.0) mapped = vec3(lt) + (mapped - vec3(lt)) * (1.0 - lt) / max(top - lt, 1e-4);
    // The standout colour can be shielded from it (Pop → Keep).
    c = mix(c, clamp(mapped, 0.0, 1.0), uMapAmount * (1.0 - keep * uPopKeep));
  }
  // Overall: on everything above (the palette included), so they always
  // show. Warmth and tint keep each pixel's brightness.
  if (uWarmth != 0.0 || uTint != 0.0) {
    float lw = dot(c, W);
    vec3 shifted = c * vec3(1.0 + uWarmth * 0.1, 1.0 - uTint * 0.07, 1.0 - uWarmth * 0.1);
    c = shifted * (lw + 1e-4) / (dot(shifted, W) + 1e-4);
  }
  if (uVibrance != 0.0) {
    // Up, the muted colours gain most, so a sunset cannot be pushed into
    // clipping; down, the dullest lose most and the most vivid least, so
    // the strongest still stand out.
    float lv = dot(c, W);
    float sat = clamp(max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b)), 0.0, 1.0);
    float gain = uVibrance < 0.0 ? 1.0 + uVibrance * (1.0 - 0.85 * sat) : 1.0 + uVibrance * (1.0 - sat) * 1.2;
    c = mix(vec3(lv), c, max(gain, 0.0));
  }
  if (uShadowAmount > 0.0) {
    vec3 chroma = uShadowTint - vec3(dot(uShadowTint, W));
    c += chroma * uShadowAmount * 0.3 * pow(1.0 - clamp(l, 0.0, 1.0), 2.0);
  }
  if (uHighlightAmount > 0.0) {
    vec3 chroma = uHighlightTint - vec3(dot(uHighlightTint, W));
    c += chroma * uHighlightAmount * 0.3 * smoothstep(0.35, 1.0, l);
  }
  return clamp(c, 0.0, 1.0);
}

/**
 * The colour a streak hit brings: read where its line comes from (across
 * the flow as wide as a pixel's share of it there), recoloured by a colour
 * fix, in the streak's own tone — before it is blended into the photo.
 */
/**
 * Where a streak reads the photo, folded back in at its edges. A line that
 * starts past the photo (a flow leaning off a side) read the edge's one
 * pixel, and its bars came out a flat strip; mirrored, they carry on the
 * bars just inside instead.
 */
/**
 * Glass in front of the lens (uGlass): where this print pixel sees the photo
 * from through it, how far red and blue are bent apart there (split: red
 * reads at -split, blue at +split), and the light and shade its ribs throw.
 * The ribs are fixed to the print, so a crop matches the export.
 */
vec2 glassAt(vec2 p, out vec2 split, out float shade) {
  float amount = uGlass.x;
  float w = max(uGlass.z, 1.0);
  vec2 across = uGlassAxis.xy;
  vec2 along = vec2(-across.y, across.x);
  float u = dot(p, across) / w;
  float v = dot(p, along) / w;
  float rib = floor(u);
  float t = u - rib - 0.5; // -0.5..0.5 across a rib
  float d;                 // how far it is bent across, in rib widths
  if (uGlass.y < 0.5) {
    // Reeded: each rib a half-cylinder lens, bending the strip behind it
    // toward its middle and, strongly, flipping it.
    d = -amount * 0.9 * sin(3.14159265 * t);
    shade = uGlassAxis.z * (0.22 * smoothstep(0.32, 0.5, -t) - 0.3 * smoothstep(0.3, 0.5, t) + 0.06 * (1.0 - 4.0 * t * t));
  } else if (uGlass.y < 1.5) {
    // Facets: flat-cut strips, each shifting what is behind by its own
    // amount and tilting it a little.
    d = amount * ((hash11(rib * 1.731 + 0.37) - 0.5) * 1.6 - t * 0.5);
    shade = uGlassAxis.z * (0.12 * (hash11(rib * 4.13 + 1.9) - 0.5) - 0.35 * smoothstep(0.44, 0.5, abs(t)));
  } else {
    // Ripple: poured glass, a soft wave that drifts along its length.
    float phase = 6.2831853 * (u + 0.18 * sin(v * 1.7) + 0.08 * sin(v * 4.3 + 1.3));
    d = amount * 0.35 * sin(phase);
    shade = uGlassAxis.z * 0.16 * cos(phase);
  }
  vec2 bend = across * d * w;
  split = bend * uGlass.w * 0.12;
  return p + bend;
}

vec2 streakUv(vec2 uv) {
  return clamp(1.0 - abs(1.0 - abs(uv)), vec2(0.0), vec2(1.0));
}

vec3 streakColour(StreakHit h, float baseLod) {
  vec2 baseUv = (h.src - uImageOffset) / uBaseSize;
  vec3 base = textureLod(uBase, streakUv(baseUv), baseLod).rgb;
  // Repeat: the repeated stretch's detail on the smear — the copy less a
  // blur of itself, so its lines and edges come along and its broad light
  // (a highlight across a wall) does not. Kept small, so no one bright spot
  // is copied out bar after bar.
  vec3 echoDetail = vec3(0.0);
  vec3 e = vec3(0.0);
  if (h.echo.z > 0.0 || h.echoCopy > 0.0) {
    vec2 eUv = streakUv((h.echo.xy - uImageOffset) / uBaseSize);
    e = textureLod(uBase, eUv, baseLod).rgb;
    // Measured against a blur of a set size in the photo's pixels, so a view zoomed out shows what the export has.
    vec3 soft = textureLod(uBase, eUv, max(h.echo.w, baseLod + 1.0)).rgb;
    // Handing over to the next copy: both, mixed.
    if (h.echo2.z > 0.0) {
      vec2 bUv = streakUv((h.echo2.xy - uImageOffset) / uBaseSize);
      e = mix(e, textureLod(uBase, bUv, baseLod).rgb, h.echo2.z);
      soft = mix(soft, textureLod(uBase, bUv, max(h.echo.w, baseLod + 1.0)).rgb, h.echo2.z);
    }
    echoDetail = clamp(e - soft, -0.22, 0.22) * h.echo.z;
  }
  if (h.weight > 0.0 && h.across.z > 1.25) {
    // A pixel's share of a spread-out source: taps across the flow there,
    // each as fine as a pixel's own read, along it not at all, so the read
    // stays on its side of the shape's edge.
    float width = h.across.z * max(1.0, exp2(baseLod));
    int n = int(clamp(ceil(h.across.z * 1.5), 2.0, 8.0));
    vec3 sum = vec3(0.0);
    for (int k = 0; k < 8; k++) {
      if (k >= n) break;
      vec2 at = h.src + h.across.xy * ((float(k) + 0.5) / float(n) - 0.5) * width;
      sum += textureLod(uBase, streakUv((at - uImageOffset) / uBaseSize), baseLod).rgb;
    }
    base = sum / float(n);
  }
  base = clamp(base + echoDetail, 0.0, 1.0);
  // Near a bar's start, the stretch itself: the subject carried on.
  if (h.echoCopy > 0.0) base = mix(base, e, h.echoCopy);
  if (h.paint.w > 0.0) {
    // A colour fix's own colours, darkest to lightest, picked by where this
    // colour sits between its source's darkest and lightest: the source's
    // pattern of light and dark, in them, blended smoothly between, so the
    // texture across each bar comes through as it is.
    int f = int(h.paint.z + 0.5);
    int n = int(uFixInfo[f].z + 0.5);
    float l = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float p = clamp((l - h.paint.x) / max(h.paint.y - h.paint.x, 0.02), 0.0, 1.0);
    vec3 c;
    if (n <= 1) {
      c = uFixColours[f * ${MAX_FIX_COLOURS}] * mix(0.7, 1.25, p);
    } else {
      float x = p * float(n - 1);
      int a = min(int(floor(x)), n - 2);
      float t = x - float(a);
      c = mix(uFixColours[f * ${MAX_FIX_COLOURS} + a], uFixColours[f * ${MAX_FIX_COLOURS} + a + 1], t);
    }
    base = mix(base, clamp(c, 0.0, 1.0), h.paint.w);
  }
  // The streak's own tone: brightness in stops, in linear light; contrast
  // about mid-grey, on encoded values. Only the streaked colour, before it
  // is blended into the photo, so the photo around it is untouched.
  if (h.weight > 0.0 && h.tone != vec2(0.0)) {
    base = linearToSrgb(srgbToLinear(base) * exp2(h.tone.x));
    base = clamp((base - 0.5) * (1.0 + h.tone.y) + 0.5, 0.0, 1.0);
  }
  return base;
}


void main() {
  if (uLinePass == 1) {
#ifndef NO_STREAKS
    outColor = lineTablePass();
#endif
    return;
  }
  // Coordinates are in print space: with no border the print is the photo and
  // every stage below behaves exactly as it did before.
  vec2 printPx = uRegionOrigin + vUv * uRegionSize;
  // The photo's mip level comes from the true position, before any snapping:
  // the fit view still needs it, and a snapped position has no gradient.
  vec2 rawBasePx = printPx - uImageOffset;
  float baseLod = max(0.0, log2(max(max(length(dFdx(rawBasePx)), length(dFdy(rawBasePx))), 1e-6)));
  // Three places the masks are read, in order, each needing the last: Pixel
  // art's (where the blocks are), the glass's (where the sheet is) and every
  // other module's. One loop over the three, with the masks read in one
  // place (see maskAt): Direct3D's compiler copies the mask read wherever it
  // is written, and three copies took it seconds.
  //
  // Pixelate: everything below is computed once per block, at its centre.
  // Pixel art's mask decides where the blocks are, at each block's middle,
  // so its edge is in blocks too.
  //
  // Glass in front of the lens: everything on the photo is seen where the
  // glass bends it from. What is on the film or the print (grain, leaks,
  // dust, the paper) is not behind it, and keeps printPx. Not in the passes
  // drawn for the wide blurs (2) or the matte (3, 4): they are the photo as
  // it is, read later at the bent position. Masked glass: the sheet is only
  // where its masks let it be. They are read where the pixel is, not where
  // the glass bends it from — the sheet's edge is a place on the photo, and
  // a key reads the subject as the photo shows it — and the bending eases
  // to nothing across their soft edges.
  //
  // The lens: what is on the photo is seen where the lens bends it from,
  // all of it alike (the photo, streaks, masks, lights, copies), the glass
  // in front of it included. Film and print keep printPx, as for the glass.
  //
  // Masks for each section: how much of it the masks let through here — 1
  // everywhere a section is not masked. Keys read the photo's own brightness
  // here, before anything is done to it. Each mask is read once, with its
  // margin, into what each section and each streak's own masks let through;
  // what it covers itself (own) for Clean edges (its subject's own edge, not
  // a grown margin, where the photo is what is behind by design).
  vec2 block = (floor(printPx / uPixelate) + 0.5) * uPixelate;
  vec2 lensPx = printPx;
  vec2 scenePx = printPx;
  vec2 split = vec2(0.0);
  float glassShade = 0.0;
  vec2 bent = printPx;
  bool glassOn = uGlass.x > 0.0 && (uLinePass == 0 || uLinePass == 5);
  float keepSection[${MASK_SECTIONS.length}];
  for (int k = 0; k < ${MASK_SECTIONS.length}; k++) keepSection[k] = 1.0;
  // How strongly the streaks' masks clean their edges here (see edgeBehind).
  float cleanHere = 0.0;
  vec3 keyed = vec3(0.0);
  // The open mask's cover here, for showing it (RenderRequest.showMask).
  float shownCover = 0.0;
  float clearSection[${MASK_SECTIONS.length}];
  for (int k = 0; k < ${MASK_SECTIONS.length}; k++) clearSection[k] = 1.0;
  float clearStreak[${MAX_STREAKS}];
  for (int s = 0; s < ${MAX_STREAKS}; s++) clearStreak[s] = 1.0;
  ivec2 su = uSectionMask[5];
  for (int phase = 0; phase < 3 + min(uMaskCount, 0); phase++) {
    // 0: Pixel art's blocks; 1: the glass; 2: every other module.
    ivec2 use = uSectionMask[phase == 0 ? ${MASK_SECTIONS.indexOf('pixel')} : 6];
    bool read = uMaskCount > 0;
    vec2 at;
    vec3 photo;
    if (phase == 0) {
      read = read && uPixelate > 1.0 && use.y != 0;
      at = block;
      photo = textureLod(uBase, clamp((block - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb;
    } else if (phase == 1) {
      // From the block's centre, where Pixel art put it.
      lensPx = printPx;
      if (uLensK != 0.0 && (uLinePass == 0 || uLinePass == 5)) lensPx = lensScene(printPx);
      scenePx = lensPx;
      if (glassOn) bent = glassAt(lensPx, split, glassShade);
      read = read && glassOn && use.y != 0;
      at = lensPx;
      photo = textureLod(uBase, clamp((lensPx - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
    } else {
      if (glassOn) scenePx = bent;
      if (read) keyed = textureLod(uBase, clamp((scenePx - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
      at = scenePx;
      photo = keyed;
    }
    vec2 q = toShapeUnits(at);
    float clear = 1.0;
    for (int i = 0; i < (read ? uMaskCount : 0); i++) {
      if (phase < 2 && ((use.x >> i) & 1) == 0) continue;
      float own;
      float c = maskAt(i, q, photo, 0.0, own);
      if (phase < 2) {
        clear *= 1.0 - c;
        continue;
      }
      if (i == int(uShowMask.x + 0.5)) shownCover = c;
      for (int k = 0; k < ${MASK_SECTIONS.length}; k++)
        if (k != 6 && ((uSectionMask[k].x >> i) & 1) == 1) clearSection[k] *= 1.0 - c;
      for (int s = 0; s < ${MAX_STREAKS}; s++)
        if (((uStreakMask[s].x >> i) & 1) == 1) clearStreak[s] *= 1.0 - c;
      if (uMatteOn == 1 && su.y != 0 && ((su.x >> i) & 1) == 1 && (su.y == 2 || own > 1e-3)) cleanHere = max(cleanHere, uMaskFlags[i].w);
    }
    // Unread (no masks on it): all of it.
    float keep = !read ? 1.0 : use.y == 2 ? 1.0 - clear : clear;
    if (phase == 0) {
      // Keep lines: a pixel much unlike its block (a wire, a branch, an
      // edge) keeps its own colour; flat areas go to blocks.
      bool sharp = false;
      vec2 from = block;
      if (uPixelate > 1.0 && uPixelKeep != 0.0) {
        // The block's colour from whichever of five points in it is most
        // like the five together, so a wire across the block's middle does
        // not colour the whole block.
        const vec3 W3 = vec3(0.2126, 0.7152, 0.0722);
        vec2 off[5] = vec2[5](vec2(0.0), vec2(-0.25, -0.25), vec2(0.25, -0.25), vec2(-0.25, 0.25), vec2(0.25, 0.25));
        float lum[5];
        float mean = 0.0;
        for (int j = 0; j < 5; j++) {
          vec2 q = block + off[j] * uPixelate;
          lum[j] = dot(textureLod(uBase, clamp((q - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb, W3);
          mean += lum[j] * 0.2;
        }
        int best = 0;
        for (int j = 1; j < 5; j++) if (abs(lum[j] - mean) < abs(lum[best] - mean)) best = j;
        from = block + off[best] * uPixelate;
        if (uPixelKeep < 0.0) {
          // Dither's blocks: whole where the photo is smooth across the
          // block, which is where the dither's pattern shows; a block with
          // detail in it (an edge, leaves, a window) keeps every pixel its
          // own, so only the pattern is made of blocks, not the picture.
          float lo = min(min(lum[0], lum[1]), min(min(lum[2], lum[3]), lum[4]));
          float hi = max(max(lum[0], lum[1]), max(max(lum[2], lum[3]), lum[4]));
          sharp = hi - lo > mix(0.4, 0.02, -uPixelKeep);
        } else {
          float own = dot(textureLod(uBase, clamp((printPx - uImageOffset) / uBaseSize, vec2(0.0), vec2(1.0)), 0.0).rgb, W3);
          sharp = abs(own - lum[best]) > mix(0.5, 0.04, uPixelKeep);
        }
      }
      if (uPixelate > 1.0 && keep >= 0.5 && !sharp) printPx = from;
    } else if (phase == 1 && glassOn && read) {
      bent = mix(lensPx, bent, keep);
      split *= keep;
      glassShade *= keep;
    }
  }
  if (uMaskCount > 0) {
    // Glass (6) bends the photo before this, read where it is.
    for (int k = 0; k < ${MASK_SECTIONS.length}; k++) {
      ivec2 use = uSectionMask[k];
      if (k != 6 && use.y != 0) keepSection[k] = use.y == 2 ? 1.0 - clearSection[k] : clearSection[k];
    }
    for (int s = 0; s < ${MAX_STREAKS}; s++) {
      ivec2 sm = uStreakMask[s];
      if (sm.y != 0) gStreakKeep[s] = sm.y == 2 ? 1.0 - clearStreak[s] : clearStreak[s];
    }
  }
  vec2 basePx = scenePx - uImageOffset;
  vec2 flatPx = printPx - uImageOffset;
  // The colours surely behind the streaks' masks (3) and surely kept in
  // front of them (4), for edgeBehind: premultiplied by how surely. What a
  // key keeps includes its edge pixels, part behind: counted in, they made
  // the subject's colour nearer the sky's and its edges look less mixed
  // than they are. Kept pixels count by how far they are from the colour
  // behind them (read from 3, drawn first), steeply, so the subject's own
  // colours outweigh its edges'.
  if (uLinePass == 3 || uLinePass == 4) {
    float k5 = keepSection[5];
    float sure = uLinePass == 3 ? smoothstep(0.9, 0.99, k5) : 1.0 - smoothstep(0.01, 0.1, k5);
    if (uLinePass == 4 && sure > 0.0) {
      vec4 b = matteMean(uMatteBack, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)));
      if (b.a > 0.0) {
        float far = length(srgbToLinear(keyed) - b.rgb);
        sure *= far * far * far * far + 1e-6;
      }
    }
    outColor = vec4(keyed * sure, sure);
    return;
  }
  // Each streak's own key: kept to the photo's darker (or lighter) pixels
  // here, by brightness or blue, as a mask's key is.
  if (uStreakKeyed == 1) {
    vec3 under = textureLod(uBase, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
    for (int s = 0; s < ${MAX_STREAKS}; s++) {
      vec4 k = uStreakKey[s];
      if (k.x < 0.5) continue;
      float v = k.y > 0.5 ? under.b : dot(under, vec3(0.2126, 0.7152, 0.0722));
      float lighter = smoothstep(k.z - k.w, k.z + k.w, v);
      gStreakKeep[s] *= k.x > 1.5 ? lighter : 1.0 - lighter;
    }
  }
  float kGrain = keepSection[0];
  float kColour = keepSection[1];
  float kTone = keepSection[2];
  float kLight = keepSection[3];
  float kEdges = keepSection[7];
  float kSolar = keepSection[8];
  float kLeaks = keepSection[4];
  float kLighting = keepSection[${MASK_SECTIONS.indexOf('lighting')}];
  float kMono = keepSection[${MASK_SECTIONS.indexOf('mono')}];
  float kDither = keepSection[${MASK_SECTIONS.indexOf('dither')}];
  float kPixel = keepSection[${MASK_SECTIONS.indexOf('pixel')}];
  float kHalftone = keepSection[${MASK_SECTIONS.indexOf('halftone')}];
  float kDust = keepSection[${MASK_SECTIONS.indexOf('dust')}];
  float kSurge = keepSection[${MASK_SECTIONS.indexOf('surge')}];
  vec2 hereUv = basePx / uBaseSize;
  vec2 baseUv;
  vec3 base;
  float streakW;
  // How far a light behind the streaks is moved here (see gLightShift).
  vec2 lightShift = vec2(0.0);
  // The prism's and the glass's colour fringes: how much brighter red's and
  // blue's own reads are than here. Added after the look's colour (below),
  // so a look that recolours everything (a gradient map) keeps them.
  vec2 fringeLum = vec2(0.0);
  if (uStreakCacheOn == 1) {
    // The search below is the slow part of a render, and it is the same
    // until the streaks, the masks or the view change: kept from the last
    // render of this view, one texel per output pixel.
    ivec2 at = ivec2(gl_FragCoord.xy) - uCacheOffset;
    vec4 kept = texelFetch(uMatteBack, at, 0);
    base = kept.rgb;
    streakW = kept.a;
    vec4 kept2 = texelFetch(uMatteFore, at, 0);
    baseUv = kept2.xy;
    fringeLum = unpack12(kept2.z, 2047.0);
    lightShift = unpack12(kept2.w, 1.0);
  } else {
    // One call site for the search and one for its colour, run a second
    // time only when needed: each call is compiled in full, and a second
    // copy of the search took the shader past what WebKit allows a compile
    // before it drops the context.
    float keep5 = keepSection[5];
    float behind = 0.0;
    vec3 back = vec3(0.0);
    StreakHit streak;
    float under = 0.0;
    vec3 brought = vec3(0.0);
    int calls = 1;
    // Red's and blue's own reads, for the prism and the glass's dispersion:
    // a bar's red from a little to one side of it, its blue the other.
    bool fringes = false;
    vec2 fringe = vec2(0.0);
    vec3 colR = vec3(0.0);
    vec3 colB = vec3(0.0);
    float wR = 0.0;
    float wB = 0.0;
    for (int c = 0; c < 4; c++) {
      // 0: here; 1: here, unmasked (Clean edges); 2, 3: red's and blue's reads.
      if (c == 1 && calls < 2) continue;
      if (c >= 2 && !fringes) break;
      vec2 at = c < 2 ? scenePx : scenePx + (c == 2 ? -fringe : fringe);
      StreakHit h = streakAt(at, c == 1 ? 1.0 : keep5);
      if (c == 0) lightShift = gLightShift;
      if (c == 0) {
        if (h.weight > 0.0 && uLinePass != 2) {
          vec2 acrossBars = vec2(-gFlow.y, gFlow.x);
          vec2 dir = uPrismTurn.x * acrossBars + uPrismTurn.y * gFlow;
          fringe = split + dir * uPrism * 0.5;
          fringes = dot(fringe, fringe) > 0.01;
        }
        streak = h;
        // Kept in front of the streaks by a keyed mask with Clean edges: the
        // part of an edge pixel that is what is behind becomes the streak, as
        // if the subject had been photographed in front of it (see edgeBehind).
        if (cleanHere > 0.0 && keep5 < 1.0)
          behind = cleanHere * edgeBehind(hereUv, textureLod(uBase, clamp(hereUv, vec2(0.0), vec2(1.0)), baseLod).rgb, back);
        // Held off here: the streak as it would be here unmasked.
        if (h.weight <= 0.0 && behind > 0.01) calls = 2;
        else if (h.weight > 0.0) under = min(h.weight / max(keep5, 1e-4), 1.0);
      } else if (c == 1) {
        under = h.weight;
      }
      // One call site for the colour too.
      vec3 col = h.weight > 0.0 || c == 0 ? streakColour(h, baseLod) : vec3(0.0);
      if (c == 0) base = col;
      if (c < 2 && (c == 0 || under > 0.0)) brought = col;
      if (c == 2) {
        colR = col;
        wR = clamp(h.weight, 0.0, 1.0);
      } else if (c == 3) {
        colB = col;
        wB = clamp(h.weight, 0.0, 1.0);
      }
    }
    baseUv = (streak.src - uImageOffset) / uBaseSize;
    // The look's wide passes (glow, halo, structure, detail) are blurs of the
    // photo. A streaked pixel reads them where its colour came from, so a bar
    // carries its source's glow along; one only partly streaked (a mask's or
    // the outline's soft edge, a bar's soft end) is that much of each, as its
    // colour is. Read at the source alone, a soft edge over a dark subject
    // compared it with the bright sky the bar came from and darkened it.
    streakW = clamp(streak.weight, 0.0, 1.0);
    if ((streak.weight > 0.0 && streak.weight < 1.0) || behind > 0.01) {
      vec3 here = textureLod(uBase, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
      if (behind > 0.01 && under > 0.0) {
        here = linearToSrgb(clamp(srgbToLinear(here) + behind * under * (srgbToLinear(brought) - back), 0.0, 1.0));
        streakW += (1.0 - streakW) * behind * under;
      }
      base = streak.weight > 0.0 ? mix(here, base, streak.weight) : here;
    }
    // Red and blue from their own reads: the bars' where they found one, the
    // photo's where not — so a fringe runs along every edge between bars,
    // and the glass splits the photo's own edges.
    if (fringes || dot(split, split) > 0.01) {
      vec2 sp = fringes ? fringe : split;
      vec3 r = textureLod(uBase, streakUv((basePx - sp) / uBaseSize), baseLod).rgb;
      vec3 b = textureLod(uBase, streakUv((basePx + sp) / uBaseSize), baseLod).rgb;
      if (fringes) {
        r = mix(r, colR, wR);
        b = mix(b, colB, wB);
      }
      if (fringes || streak.weight <= 0.0) {
        const vec3 W = vec3(0.2126, 0.7152, 0.0722);
        float l = dot(base, W);
        fringeLum = vec2(dot(r, W) - l, dot(b, W) - l);
      }
    }
  }
  // A module's mask picks out parts of the photo, and a streak over them is
  // not part of it: where streaked, each module takes the pixel as outside
  // its masks (kept off them: it applies; only on them: it does not), so a
  // subject the streak covers no longer shows through it, in its own colours.
  // (The streaks' own section and the glass, which bent the photo first, are
  // left as they are.)
  if (uMaskCount > 0 && streakW > 0.0) {
    for (int k = 0; k < ${MASK_SECTIONS.length}; k++) {
      ivec2 use = uSectionMask[k];
      if (k == 5 || k == 6 || use.y == 0) continue;
      keepSection[k] = mix(keepSection[k], use.y == 2 ? 0.0 : 1.0, clamp(streakW, 0.0, 1.0));
    }
  }
  // The streak cache: what the search found, for the next render of this view.
  if (uLinePass == 5) {
    outColor = vec4(base, streakW);
    outUv = vec4(baseUv, pack12(fringeLum, 2047.0), pack12(lightShift, 1.0));
    return;
  }
  vec3 photo = base; // as it came in, for measuring what the look changed
  kGrain = keepSection[0];
  kColour = keepSection[1] * (1.0 - uStreakUngraded * streakW);
  kTone = keepSection[2];
  kLight = keepSection[3];
  kEdges = keepSection[7];
  kSolar = keepSection[8];
  kLeaks = keepSection[4];
  kLighting = keepSection[${MASK_SECTIONS.indexOf('lighting')}];
  kMono = keepSection[${MASK_SECTIONS.indexOf('mono')}];
  kDither = keepSection[${MASK_SECTIONS.indexOf('dither')}];
  kPixel = keepSection[${MASK_SECTIONS.indexOf('pixel')}];
  kHalftone = keepSection[${MASK_SECTIONS.indexOf('halftone')}];
  kDust = keepSection[${MASK_SECTIONS.indexOf('dust')}];
  kSurge = keepSection[${MASK_SECTIONS.indexOf('surge')}];
  // The photo as streaked, for the wide passes to blur (see buildStreaked).
  if (uLinePass == 2) {
    // Its alpha is how much of it is bars, for the light off them.
    outColor = vec4(base, streakW);
    return;
  }

  // Soft over one pixel so the cut is not a stair-stepped line. With no border
  // there is nothing to cut against, and feathering the outermost ring into
  // paper that is not there would alter every edge pixel of the photograph.
  float onPhoto = 1.0;
  float edgeShade = 0.0; // 1 at the edge of the photo, falling off inward
  float inside = 1e5;    // how far into the photo, px (negative on the paper)
  if (uHasBorder == 1) {
    // A soft penumbra rather than a cut: the transition is a few pixels wide
    // and broken up by fine noise, so it dissolves the way a printed edge does.
    inside = insideImage(flatPx, uBaseSize);
    // (A clean cut, not rough at all, is not broken up: see uEdgeSoftness.)
    float ragged = uEdgeIrregularity > 0.0 ? (valueNoise2(printPx / uPixelScale * 0.7 + uBorderSeed) - 0.5) * uEdgeSoftness * 1.2 : 0.0;
    onPhoto = smoothstep(-uEdgeSoftness, uEdgeSoftness, inside + ragged);
    edgeShade = exp(-max(inside, 0.0) / max(uEdgeSoftness * 5.0, 1.0));
  }

  vec3 leakColour = vec3(0.0);
  float leakLight = 0.0;
  float leakBurn = 0.0;
  vec3 leakTint = vec3(0.0);
  float leakTintAmt = 0.0;
  vec3 leakLit = vec3(0.0);
  if (uLeak > 0.0) {
    // The photo's own colour here, for shapes keyed to it (keyed is only read when masks are on).
    vec3 photoHere = uMaskCount > 0 ? keyed : textureLod(uBase, clamp(basePx / uBaseSize, vec2(0.0), vec2(1.0)), baseLod).rgb;
    leakAt(printPx, toShapeUnits(scenePx), photoHere, streakW, lightShift, leakColour, leakLight, leakBurn, leakTint, leakTintAmt, leakLit, lensPx);
    // Leaks & burns' mask keeps its leaks and burns; Lighting's lights (lit,
    // tinted) are their own module and keep only their own masks (in leakAt).
    leakColour *= kLeaks;
    leakLight *= kLeaks;
    leakBurn *= kLeaks;
    leakLit *= kLighting;
    leakTintAmt *= kLighting;
  }

  // --- light-transport stages, all in linear light -------------------------
  if (onPhoto > 0.0 && (uVignette > 0.0 || uHalation > 0.0 || uBloom > 0.0 || uShoulder > 0.0 || uFade > 0.0
      || uRim > 0.0 || uCrunch > 0.0 || uLeak > 0.0 || uStockStrength > 0.0 || uExposure != 0.0 || uHasGrade == 1
      || uHaloAmount > 0.0 || uSolarize > 0.0 || uStructureAmount > 0.0 || uStreakGlowAmount > 0.0 || uMonoAmount > 0.0)) {
    vec3 detail = (uRim > 0.0 || uCrunch > 0.0) ? streakedBlur(uDetail, hereUv, baseUv, streakW) : vec3(0.0);

    // Crunch on encoded values, where "local contrast" means what it looks like.
    if (uCrunch > 0.0) {
      base = clamp(base + (base - linearToSrgb(detail)) * uCrunch * kEdges * 1.6, 0.0, 1.0);
    }

    vec3 linear = srgbToLinear(base) * exp2(uExposure * kTone);
    linear = mix(linear, applyVignette(linear, flatPx), kTone);
    linear = applyLeak(linear, leakColour, leakBurn, leakTint, leakTintAmt, leakLit);

    // Edge glow: only where the neighbourhood is brighter than the pixel, so
    // flat areas are untouched and a dark shape against light gets a burning
    // outline. The spill is measured as a share of the neighbourhood's light
    // and squared, which keeps it a line hugging the edge instead of a haze
    // that softens it; its colour is the neighbourhood's, pushed warm.
    if (uRim > 0.0) {
      vec3 here = srgbToLinear(photo);
      vec3 bleed = max(detail - here, 0.0);
      float detailLuma = dot(detail, vec3(0.2126, 0.7152, 0.0722));
      float share = clamp(dot(bleed, vec3(0.2126, 0.7152, 0.0722)) / (detailLuma + 0.002), 0.0, 1.0);
      float line = share * share;
      vec3 light = mix(detail, detailLuma * uGlowTint * (1.0 / max(dot(uGlowTint, vec3(0.2126, 0.7152, 0.0722)), 0.05)), 0.55);
      linear += light * line * uRim * kEdges * 2.5;
      // The bright side of the same edge flares toward a hot yellow-white
      // contour, which is what makes it read as an outline drawn in light.
      float hereLuma = dot(here, vec3(0.2126, 0.7152, 0.0722));
      float over = clamp(dot(max(here - detail, 0.0), vec3(0.2126, 0.7152, 0.0722)) / (hereLuma + 0.002), 0.0, 1.0);
      // Warm only while the look's light has a colour: with Colour off the
      // glow tint is neutral, and so is this.
      float warm = clamp((max(uGlowTint.r, max(uGlowTint.g, uGlowTint.b)) - min(uGlowTint.r, min(uGlowTint.g, uGlowTint.b))) * 4.0, 0.0, 1.0);
      linear += mix(vec3(1.0), vec3(1.0, 0.82, 0.5), warm) * hereLuma * over * over * uRim * kEdges * 4.0;
    }

    if (uHalation > 0.0 || uBloom > 0.0) {
      vec3 glow = streakedBlur(uGlow, hereUv, baseUv, streakW);
      // Neutral veiling glare, then the warm reflection off the film base.
      linear += glow * uBloom * kLight;
      float glowLuma = dot(glow, vec3(0.2126, 0.7152, 0.0722));
      linear += glowLuma * uGlowTint * uHalation * kLight;
    }
    // Light off the streaks' bars, in their own colour (see buildStreakGlow).
    if (uStreakGlowAmount > 0.0) linear += texture(uStreakGlow, hereUv).rgb * uStreakGlowAmount;

    linear = mix(linear, applyShoulder(linear), kTone);
    base = linearToSrgb(linear);

    // Development effects, on the developed image: the halo's rims, then the
    // Sabattier reversal of the brightest tones.
    if (uHaloAmount > 0.0) {
      const vec3 W = vec3(0.2126, 0.7152, 0.0722);
      float around = dot(linearToSrgb(streakedBlur(uHalo, hereUv, baseUv, streakW)), W);
      // Luminance only, so the rim is pale rather than a colour fringe; the
      // same term darkens the middles of big bright areas, whose surroundings
      // are as bright as they are.
      base = clamp(base + (dot(base, W) - around) * uHaloAmount * kSolar * 2.2, 0.0, 1.0);
    }
    if (uStructureAmount > 0.0) {
      // Texture-scale local contrast, brightness only. Weighted to the
      // midtones and shadows (where water, bark and foliage live), and the
      // difference is soft-limited so a hard silhouette edge does not halo.
      const vec3 W = vec3(0.2126, 0.7152, 0.0722);
      float l = dot(base, W);
      float around = dot(linearToSrgb(streakedBlur(uStructure, hereUv, baseUv, streakW)), W);
      float d = l - around;
      d = d / (1.0 + abs(d) * 6.0);
      float weight = smoothstep(0.0, 0.12, l) * (1.0 - smoothstep(0.6, 0.95, l));
      float lifted = clamp(l + d * uStructureAmount * kTone * 3.0 * weight, 0.0, 1.0);
      base = clamp(base * (lifted + 1e-3) / (l + 1e-3), 0.0, 1.0);
    }
    if (uSolarize > 0.0) base = mix(base, applySolarize(base), kSolar);
    if (uStockStrength > 0.0) base = mix(base, applyStock(base), kColour);
    if (uHasGrade == 1) base = mix(base, applyGrade(base), kColour);
    // Black & white after the colour, so it is black and white whatever the
    // palette did; its own toner tints it as a print is toned.
    if (uMonoAmount > 0.0) base = mix(base, applyMono(base), uMonoAmount * kMono);

    // The toe: lift the shadows, fading to nothing by the highlights, so the
    // midtones barely move and white stays white. Done in encoded values so
    // "fade 0.05" puts black at 13/255, which is how it was measured. The
    // brightest channel is lifted and the colour scaled with it, so a dark
    // blue sky stays blue as it lifts: lifting each channel on its own raised
    // the low ones most and greyed every dark colour. Near black, where there
    // is no colour to keep, it lifts to grey as before; greys lift exactly as
    // they did.
    float topIn = max(base.r, max(base.g, base.b));
    float lift = uFade * kTone * pow(1.0 - clamp(topIn, 0.0, 1.0), 2.5);
    base = mix(base + lift, base * ((topIn + lift) / max(topIn, 1e-4)), smoothstep(0.0, 0.06, topIn));
  }
  // The colour fringes, on the look's colour: red where red's read is
  // brighter than here, blue where blue's is.
  if (fringeLum != vec2(0.0)) base = clamp(base + vec3(fringeLum.x, 0.0, fringeLum.y) * 2.2, 0.0, 1.0);
  // The glass's ribs: light along one edge of each, shade along the other.
  if (glassShade != 0.0) base = clamp(base * (1.0 + glassShade), 0.0, 1.0);
  // Collage pieces keep their own colour: the look's light, tone and colour
  // are taken back out over them, as far as each piece asks (the base's
  // alpha, written by the collage pass). Grain, dust and paper still follow.
  if (uCollageOwn == 1) {
    // Read where the colour came from: for a streaked pixel, its bar's
    // source; for one only partly streaked (a bar's soft tip over the sky),
    // that much of the source and the rest here. Read at the source alone,
    // the sky showing through a fading tip took the source's full look, a
    // bright rim along the top of the streaks over a piece that keeps its own.
    float atSource = textureLod(uBase, clamp(baseUv, vec2(0.0), vec2(1.0)), baseLod).a;
    float atHere = textureLod(uBase, clamp(hereUv, vec2(0.0), vec2(1.0)), baseLod).a;
    float takesLook = mix(atHere, atSource, clamp(streakW, 0.0, 1.0));
    base = mix(photo, base, takesLook);
  }
  // The photo darkens a little into its edge, as the blade's shadow does.
  // (Not on a clean digital cut.)
  if (uEdgeIrregularity > 0.0) base *= 1.0 - 0.18 * edgeShade * clamp(uEdgeIrregularity / 6.0, 0.25, 1.0);
  // The photo set into the paper: shade along its inside edge.
  if (uHasBorder == 1 && uInset > 0.0) base *= 1.0 - uInset * 0.6 * exp(-max(inside, 0.0) / max(uInsetSize, 1.0));
  // The paper is part of the print, so it goes in before the grain.
  vec3 paper = paperAt(printPx);
  if (uHasBorder == 1) paper = dressPaper(paper, flatPx, inside);
  base = mix(paper, base, onPhoto);

  // Surge marks are in the emulsion, so they mark the photograph and not the
  // paper around it. Mostly they coarsen the grain; the small density lift is
  // the developer having worked further there.
  float surge = surgeAt(printPx) * onPhoto * kSurge;
  base *= 1.0 + surge * uSurgeStrength * 0.05;

  // Halftone and riso: the finished picture printed as ink on paper. Grain
  // and dust still go on top, as they would on a scan of the print.
  if (uHalftoneStyle >= 0 && onPhoto > 0.0)
    base = mix(base, applyHalftone(clamp(base, 0.0, 1.0), printPx), uHalftoneAmount * onPhoto * kHalftone);

  vec3 encodedBase = base;

  // Grain is keyed to the print, not the photo, so the same emulsion texture
  // runs across the picture edge and onto the border.
  vec3 grain = sampleGrain(printPx);

  // Dither: quantise to a few steps per channel, offsetting each pixel by the
  // grain before rounding. Where a gradient crosses a step the grain decides
  // which side each pixel falls, so the band edge dissolves into a stipple of
  // grain-sized dots — the pattern is the grain, so its size is the grain's.
  // Done before the grain is blended, so the grain still sits on top.
  if (uDitherAmount > 0.0 && onPhoto > 0.0) {
    // Brightness is stepped and the colour rescaled to match, so the bands are
    // bands of light with smooth colour through them; stepping each channel
    // separately flipped them at different thresholds into colour speckle.
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    // Dots of uDitherPixel print pixels: every pixel in a block shares its
    // dither value, so the stipple is made of blocks that survive shrinking.
    vec2 cell = floor(printPx / uDitherPixel);
    float n;
    float offset; // where between two steps a dot rounds up, 0.5 = plain rounding
    if (uDitherOrdered == 1) {
      // 4x4 Bayer: thresholds spread evenly over each 4x4 group of dots.
      offset = 0.5 + bayer4(cell) * clamp(uDitherSpread, 0.0, 2.0);
      n = 0.0;
    } else {
      // One read of the grain (one copy of it in the compiled shader): at the
      // dot's block, or larger and smooth for clumps.
      vec3 g = grain;
      if (uDitherPixel > 1.0 || uDitherClumps > 1.0) {
        gSoftRead = uDitherPixel <= 1.0;
        g = sampleGrain(uDitherPixel > 1.0 ? (cell + 0.5) * uDitherPixel : printPx / uDitherClumps);
        gSoftRead = false;
      }
      n = (dot(g, W) - 0.5) * uDitherNoise;
      offset = 0.5;
    }
    float levels = uDitherSteps - 1.0;
    float l = clamp(dot(base, W), 0.0, 1.0);
    // Where the bands fall. Following brightness they ring round a bright
    // glow; following a direction they run straight across the frame. The
    // field that is quantised blends the two, and only its quantisation error
    // is added to the picture, so the picture's own tones stay underneath.
    vec2 axis = uDitherTo - uDitherFrom;
    float along = dot(printPx - uDitherFrom, axis) / max(dot(axis, axis), 1.0);
    if (uDitherOval == 1) {
      // Distance from the centre in units of the oval: 1 along the axis at
      // the end handle, 1 across it at stretch times that.
      float len = max(length(axis), 1.0);
      vec2 nAxis = axis / len;
      vec2 rel = printPx - uDitherFrom;
      float a = dot(rel, nAxis) / len;
      float b = dot(rel, vec2(-nAxis.y, nAxis.x)) / (len * max(uDitherStretch, 0.05));
      along = sqrt(a * a + b * b);
    }
    float ramp = clamp(along, 0.0, 1.0);
    float field = mix(l, ramp, uDitherFollow);
    // Guides nudge the field the bands are cut from, softly, so the bands
    // still follow the picture and only shift where they are guided.
    if (uBandGuideCount > 0) {
      vec2 gq = printPx / min(uPrintSize.x, uPrintSize.y);
      for (int g = 0; g < ${MAX_BAND_GUIDES}; g++) {
        if (g >= uBandGuideCount) break;
        vec4 gd = uBandGuides[g];
        vec2 d = (gq - gd.xy) / max(gd.z, 1e-3);
        field += gd.w * 0.5 * exp(-dot(d, d) * 2.0);
      }
    }
    // A quarter of a step per unit of grain at Spread 1: most of each band
    // stays flat and only its edge dissolves, which is what reads as dither.
    // Outside transitions the pattern is withheld but the step still applies,
    // so a flat area becomes a solid band rather than going back to smooth.
    float allowed = ditherMask(baseUv, l, uDitherSteps);
    float qf = floor(field * levels + mix(0.5, offset, allowed) + n * uDitherSpread * 0.25 * allowed) / levels;
    float ql = clamp(l + (qf - field), 0.0, 1.0);
    // Following a direction, the banding belongs to the line: it fades out
    // just past its end, so the rest of the picture stays clean.
    float reach = mix(1.0, 1.0 - smoothstep(1.0, 1.12, along), uDitherFollow);
    vec3 stepped = base * (ql + 1e-3) / (l + 1e-3);
    float top = max(stepped.r, max(stepped.g, stepped.b));
    if (top > 1.0) stepped = vec3(ql) + (stepped - vec3(ql)) * (1.0 - ql) / max(top - ql, 1e-4);
    float spare = 1.0 - gStandout * uDitherSparePop;
    base = mix(base, clamp(stepped, 0.0, 1.0), uDitherAmount * kDither * reach * toneAllowed(l) * spare);
    encodedBase = base;
  }

  // Palette: each block becomes its nearest palette colour, offset first by
  // a Bayer threshold so the in-betweens turn into checker blends of the two
  // nearest colours. Distance is weighted toward green, as the eye is.
  if (uPaletteCount > 0 && uPaletteAmount > 0.0 && onPhoto > 0.0) {
    vec2 pcell = floor(printPx / max(uPixelate, 1.0));
    float paletteLuma = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float paletteAllowed = ditherMask(baseUv, paletteLuma, float(uPaletteCount)) * toneAllowed(paletteLuma);
    vec3 probe = base + vec3(bayer4(pcell)) * uPaletteDither * uPaletteSpacing * paletteAllowed;
    vec3 nearest = uPalette[0];
    float best = 1e9;
    for (int i = 0; i < ${MAX_PALETTE}; i++) {
      if (i >= uPaletteCount) break;
      vec3 d = probe - uPalette[i];
      float dist = dot(d * d, vec3(0.3, 0.59, 0.11));
      if (dist < best) {
        best = dist;
        nearest = uPalette[i];
      }
    }
    base = mix(base, nearest, uPaletteAmount * kPixel);
    encodedBase = base;
  }

  // The grain plate is a *modulation signal*, not a light measurement: every
  // blend mode here is neutral at 0.5, so the plate stays in its encoded range
  // and only the base is decoded to linear light. Linearising the plate too
  // would move its neutral to 0.214 and crush the whole frame.
  if (uLinearBlend == 1) {
    base = srgbToLinear(base);
  }

  // Response is judged on the encoded image: "shadows" should mean what the
  // photographer sees as shadows, not a linear-light fraction.
  float luma = dot(encodedBase, vec3(0.2126, 0.7152, 0.0722));
  // On the photo the response curve decides; on the paper it does not apply,
  // so the border gets a flat share of Amount instead of the highlight's.
  float amount = mix(
    clamp(uAmount * uBorderGrain, 0.0, 1.0),
    clamp(uAmount * responseAt(luma), 0.0, 1.0),
    onPhoto);
  amount = clamp(amount * (1.0 + surge * uSurgeStrength * 1.8), 0.0, 1.0);
  // Leaked light fogs the film, and fogged emulsion shows its grain harder.
  amount = clamp(amount * (1.0 + (leakLight + leakBurn) * uLeak * 0.9 * onPhoto), 0.0, 1.0);

  // Grain that follows colour: strongest where the look moved the colour
  // (hue or saturation, not brightness) and where the result is richly
  // coloured; quieter over neutral, untouched areas.
  if (uFollowColour > 0.0 && onPhoto > 0.0) {
    const vec3 W = vec3(0.2126, 0.7152, 0.0722);
    vec3 before = photo - vec3(dot(photo, W));
    vec3 after = encodedBase - vec3(dot(encodedBase, W));
    float moved = smoothstep(0.02, 0.22, length(after - before));
    float chroma = max(encodedBase.r, max(encodedBase.g, encodedBase.b)) - min(encodedBase.r, min(encodedBase.g, encodedBase.b));
    float rich = smoothstep(0.08, 0.5, chroma);
    float focus = max(moved, rich * 0.75);
    amount = clamp(amount * mix(1.0, 0.3 + 1.25 * focus, uFollowColour), 0.0, 1.0);
  }

  // Per-channel response: read the curve against each channel's own value
  // rather than against overall brightness. Shifting the three curves apart
  // stands in for the three dye layers responding at different densities, and
  // it is what stops the grain reading as a layer laid over the picture.
  // Grain is a section like the others: masked, it is held back here.
  amount *= kGrain;
  vec3 channelAmount = vec3(amount);
  if (uPerChannelResponse == 1 && onPhoto > 0.0) {
    vec3 shifted = clamp(encodedBase - uLayerShift, 0.0, 1.0);
    vec3 perChannel = vec3(responseAt(shifted.r), responseAt(shifted.g), responseAt(shifted.b));
    float reference = max(responseAt(luma), 1e-4);
    // Keep the Amount slider meaning the same thing: scale the per-channel
    // curve by how it compares with the luminance reading it was calibrated on.
    channelAmount = clamp(amount * perChannel / reference, 0.0, 1.0);
    channelAmount = mix(vec3(amount), channelAmount, onPhoto);
  }

  vec3 blended = applyBlend(uBlendMode, base, grain);
  vec3 result = mix(base, blended, channelAmount);

  if (uLinearBlend == 1) {
    result = linearToSrgb(result);
  }

  // Defects sit on the film and the scanner's glass: they are in front of the
  // emulsion, so they go on after the grain rather than being modulated by it.
  if (uDefectStrength > 0.0) {
    vec4 defect = texture(uDefects, printPx / uPrintSize);
    result = mix(result, defect.rgb, defect.a * uDefectStrength * kDust);
  }

  result = applyScanArtefacts(result, printPx);

  // An open mask on the photo (RenderRequest.showMask): what it covers, as
  // the modules get it, as a wash with a white line where it crosses half,
  // or the mask alone.
  if (uShowMask.x >= 0.0 && uMaskCount > 0 && uLinePass == 0) {
    int mi = int(uShowMask.x + 0.5);
    vec2 mq = toShapeUnits(scenePx);
    float cov = mi < uMaskCount ? shownCover * onPhoto : 0.0;
    float fw = max(fwidth(cov), 1e-4);
    if (uShowMask.y > 1.5) result = vec3(cov);
    else {
      vec3 wash = uShowMask.y > 0.5 ? vec3(0.16, 0.9, 0.35) : vec3(1.0, 0.16, 0.16);
      result = mix(result, wash, cov * 0.55);
      float line = (1.0 - smoothstep(0.5 * fw, 1.5 * fw, abs(cov - 0.5))) * smoothstep(0.01, 0.05, fw);
      result = mix(result, vec3(1.0), line);
    }
  }

  outColor = vec4(clamp(result, 0.0, 1.0), 1.0);
}`

/**
 * The same shader without the streaks' search, which is nearly all of its
 * compile time: for renders with no streaks.
 */
export const FRAGMENT_SHADER_LIGHT = FRAGMENT_SHADER.replace('#version 300 es\n', '#version 300 es\n#define NO_STREAKS 1\n')
