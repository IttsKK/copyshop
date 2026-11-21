import type { BlendMode } from './types'

/**
 * Blend modes are data, not branches. Each entry contributes one GLSL function
 * `vec3 blend_<id>(vec3 base, vec3 grain)`; the fragment shader dispatches on a
 * uniform. Adding a mode means adding an entry here and nothing else.
 */
export interface BlendModeDef {
  id: BlendMode
  label: string
  /** Stable index used as the shader uniform. Never reorder these. */
  index: number
  glsl: string
}

export const BLEND_MODES: BlendModeDef[] = [
  {
    id: 'overlay',
    label: 'Overlay',
    index: 0,
    glsl: `
vec3 blend_overlay(vec3 b, vec3 s) {
  return mix(2.0 * b * s, 1.0 - 2.0 * (1.0 - b) * (1.0 - s), step(0.5, b));
}`,
  },
  {
    id: 'softLight',
    label: 'Soft Light',
    index: 1,
    glsl: `
// W3C compositing soft-light, the same curve Photoshop uses.
vec3 blend_softLight(vec3 b, vec3 s) {
  vec3 d = mix(((16.0 * b - 12.0) * b + 4.0) * b, sqrt(max(b, 0.0)), step(0.25, b));
  return mix(b - (1.0 - 2.0 * s) * b * (1.0 - b),
             b + (2.0 * s - 1.0) * (d - b),
             step(0.5, s));
}`,
  },
  {
    id: 'linearLight',
    label: 'Linear Light',
    index: 2,
    glsl: `
vec3 blend_linearLight(vec3 b, vec3 s) {
  return clamp(b + 2.0 * s - 1.0, 0.0, 1.0);
}`,
  },
]

export const BLEND_MODE_BY_ID: Record<BlendMode, BlendModeDef> = Object.fromEntries(
  BLEND_MODES.map((m) => [m.id, m]),
) as Record<BlendMode, BlendModeDef>

export function isBlendMode(value: unknown): value is BlendMode {
  return typeof value === 'string' && value in BLEND_MODE_BY_ID
}

/** All mode functions plus the dispatcher, assembled for the fragment shader. */
export function buildBlendDispatch(): string {
  const fns = BLEND_MODES.map((m) => m.glsl).join('\n')
  const branches = BLEND_MODES.map((m) => `  if (mode == ${m.index}) return blend_${m.id}(b, s);`).join('\n')
  return `${fns}

vec3 applyBlend(int mode, vec3 b, vec3 s) {
${branches}
  return b;
}`
}
