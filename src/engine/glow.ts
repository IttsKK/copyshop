/**
 * The glow pre-pass: bright areas of the image, blurred, used for halation and
 * bloom in the main pass.
 *
 * Built from the whole image at a fixed working resolution, never from the
 * region being rendered. Halation depends on light from outside whatever crop
 * you happen to be previewing, so computing it per-crop would both truncate the
 * glow at the crop edge and break the guarantee that a preview crop matches the
 * export exactly.
 */

export const GLOW_VERTEX = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  // Not flipped, unlike the main pass: a render target's row 0 is read back at
  // v = 0, so writing source row v into target row v keeps the blurred frame
  // the same way up as the photo it is sampled against. Flipping here mirrored
  // every glow top to bottom.
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`

/** Isolates the highlights, in linear light, at the working resolution. */
export const GLOW_THRESHOLD_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform float uThreshold;
uniform float uSourceLod;
uniform int uPassThrough;     // 1 = keep the whole picture, not just highlights
uniform int uAlphaWeight;     // 1 = weighted by the source's alpha (the streaked photo's: how much is bars)

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}

void main() {
  vec4 s = textureLod(uSource, vUv, uSourceLod);
  vec3 c = srgbToLinear(s.rgb);
  if (uAlphaWeight == 1) c *= s.a;
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // Soft knee: a hard threshold makes the glow pop on as a gradient crosses it.
  float knee = uPassThrough == 1 ? 1.0 : smoothstep(uThreshold, min(1.0, uThreshold + 0.18), luma);
  outColor = vec4(c * knee, 1.0);
}`

/** One separable Gaussian pass over the small highlight texture. */
export const GLOW_BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uSource;
uniform vec2 uStep;   // texel step along the axis being blurred

void main() {
  // Nine taps with Gaussian weights; run twice per axis for a wider, smoother
  // falloff than a single pass gives.
  float w[5];
  w[0] = 0.2270270270;
  w[1] = 0.1945945946;
  w[2] = 0.1216216216;
  w[3] = 0.0540540541;
  w[4] = 0.0162162162;
  vec3 sum = texture(uSource, vUv).rgb * w[0];
  for (int i = 1; i < 5; i++) {
    vec2 offset = uStep * float(i);
    sum += texture(uSource, vUv + offset).rgb * w[i];
    sum += texture(uSource, vUv - offset).rgb * w[i];
  }
  outColor = vec4(sum, 1.0);
}`

/** Packs the two calm blurs into one texture: each one's brightness, encoded. */
export const CALM_PACK_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uFine;
uniform sampler2D uWide;

vec3 linearToSrgb(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

void main() {
  const vec3 W = vec3(0.2126, 0.7152, 0.0722);
  outColor = vec4(dot(linearToSrgb(texture(uFine, vUv).rgb), W), dot(linearToSrgb(texture(uWide, vUv).rgb), W), 0.0, 1.0);
}`
