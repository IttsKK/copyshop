import { DEFAULT_EFFECTS, type BlendParams, type ModuleToggles } from './types'

/**
 * "Show original": the photo as it came in. Every effect is back at its
 * default, which is off, so a module added later is left out too. Only the
 * framing stays: the border, so the picture does not jump while the key is
 * held, and the crop, which is done before the effects.
 */
export function originalOf(params: BlendParams): BlendParams {
  const off = Object.fromEntries(Object.keys(params.modules).map((k) => [k, false])) as unknown as ModuleToggles
  return {
    ...params,
    effects: {
      ...DEFAULT_EFFECTS,
      crop: params.effects.crop,
      // Where placed things are measured: kept so the print's size is worked out the same way.
      shapeSpace: params.effects.shapeSpace,
      shapeUnits: params.effects.shapeUnits,
    },
    modules: { ...off, border: params.modules.border },
  }
}
