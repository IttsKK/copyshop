import type { Palette } from './palette'
import { glowFitGain } from './glowFit'
import { ruleColours } from './recipe'
import { activeBorder, type BlendParams, type ColourChoice, type Rgb } from './types'

/**
 * Turn stored settings into the numbers the shader runs on: apply the key
 * controls and replace every "from the photo" colour with the photo's.
 *
 * Done inside the engine, once per render, so the preview, a single export and
 * a batch cannot resolve a look differently — and a batch resolves "from the
 * photo" against each photo in turn, which is the point of it.
 */
export function resolveParams(params: BlendParams, palette: Palette): BlendParams {
  const k = params.keys
  const on = params.modules
  // A module that is off scales to zero exactly like a key control at 0%.
  const all = k.look
  const grain = k.grain * all * (on.grain ? 1 : 0)
  const colour = k.colour * all * (on.colour ? 1 : 0)
  const glow = k.glow * all * (on.light ? 1 : 0)
  // Edges and solarize have their own switches, and follow the dial of the
  // section they came out of: the Glow dial for edges and halo lines, Wash
  // for the reversal.
  const edges = k.glow * all * (on.edges ? 1 : 0)
  const solar = on.solarize ? 1 : 0
  const leaks = k.leaks * all * (on.leaks ? 1 : 0)
  const wash = k.wash * all * (on.tone ? 1 : 0)
  const fx = params.effects
  // On a photo that is mostly highlight, less of it (glowFit.ts).
  const fit = fx.glowFit === true ? glowFitGain(palette, fx.glowThreshold) : 1
  // The Colour key also sets how coloured the look's own light is. Below 100%
  // glow and leaks fade toward neutral light; above, they saturate further. A
  // look that adds no grade still has a Colour dial that does something.
  // With Colour off the look adds no colour at all: glows and leaks are
  // neutral light, so the photo keeps its own colours.
  const tint = on.colour ? k.colour * all : 0
  const saturate = (c: Rgb): Rgb => {
    const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return c.map((v) => Math.min(1, Math.max(0, grey + (v - grey) * tint))) as Rgb
  }
  const muted = (c: Rgb, s: number): Rgb => {
    if (s === 1) return c
    const grey = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    return c.map((v) => Math.min(1, Math.max(0, grey + (v - grey) * s))) as Rgb
  }
  const pick = (c: ColourChoice): ColourChoice => ({
    source: 'manual',
    colour: saturate(muted(c.source === 'manual' ? c.colour : palette[c.source], c.saturation ?? 1)),
  })
  // Above 100% the key also saturates the photo itself, gently, through
  // vibrance, so muted colours move and rich ones do not clip.
  const extraVibrance = Math.max(0, tint - 1) * 0.5
  // A recipe builds the palette from this photo's colours (recipe.ts).
  const fromRule = fx.grade.recipe ? ruleColours(fx.grade.recipe, palette) : null
  const mapColour = (c: ColourChoice, i: number): ColourChoice =>
    fromRule ? { source: 'manual', colour: fromRule[i] } : c
  return {
    ...params,
    amount: Math.min(1, params.amount * grain),
    border: activeBorder(params),
    effects: {
      ...fx,
      // Tone's switch covers the film's response too, not just what Wash scales.
      shoulder: on.tone ? fx.shoulder : 0,
      defects: on.defects ? fx.defects : { ...fx.defects, strength: 0, scanLines: 0, scanStreaks: 0 },
      surge: on.surge ? fx.surge : { ...fx.surge, strength: 0 },
      halation: fx.halation * glow * fit,
      bloom: fx.bloom * glow * fit,
      rim: fx.rim * edges,
      crunch: Math.min(1.5, fx.crunch * edges),
      halo: Math.min(1, fx.halo * k.glow * all * solar),
      // Texture belongs with tone, so the Wash dial and Tone switch carry it.
      structure: Math.min(1, fx.structure * wash),
      // A development effect: Solarize's own switch, Tone's Wash dial.
      solarize: Math.min(1, fx.solarize * k.wash * all * solar),
      // Dither and pixel art have switches of their own: each works whatever
      // else is on (the dither still reads the grain plate for its stipple).
      dither: {
        ...fx.dither,
        amount: fx.dither.enabled ? Math.min(1, fx.dither.amount * k.look) : 0,
        guides: fx.dither.guidesOn ? fx.dither.guides : [],
      },
      streaks: { ...fx.streaks, amount: fx.streaks.enabled ? fx.streaks.amount : 0 },
      pixelArt: {
        ...fx.pixelArt,
        pixelate: fx.pixelArt.enabled ? fx.pixelArt.pixelate : 1,
        amount: fx.pixelArt.enabled ? Math.min(1, fx.pixelArt.amount * Math.min(1, k.look)) : 0,
      },
      exposure: fx.exposure * wash,
      fade: Math.min(0.3, fx.fade * wash),
      vignette: Math.min(1, fx.vignette * wash),
      stock: { ...fx.stock, strength: fx.stock.strength * colour },
      grade: {
        ...fx.grade,
        vibrance: Math.max(-1, Math.min(1, fx.grade.vibrance * colour + extraVibrance)),
        warmth: fx.grade.warmth * colour,
        tint: fx.grade.tint * colour,
        shadowTint: pick(fx.grade.shadowTint),
        shadowAmount: fx.grade.shadowAmount * colour,
        highlightTint: pick(fx.grade.highlightTint),
        highlightAmount: fx.grade.highlightAmount * colour,
        mapAmount: Math.min(1, fx.grade.mapAmount * colour),
        blobs: fx.grade.blobs.map((b) => ({ ...b, strength: Math.min(1, b.strength * colour) })),
        mapShadow: pick(mapColour(fx.grade.mapShadow, 0)),
        mapMid: pick(mapColour(fx.grade.mapMid, 1)),
        mapHigh: pick(mapColour(fx.grade.mapHigh, 2)),
        isolateAmount: Math.min(1, fx.grade.isolateAmount * colour),
        // The hue to keep is not a tint: the Colour key must not grey it out.
        isolateColour: {
          source: 'manual',
          colour:
            fx.grade.isolateColour.source === 'manual'
              ? fx.grade.isolateColour.colour
              : palette[fx.grade.isolateColour.source],
        },
        popAmount: Math.min(1, fx.grade.popAmount * colour),
        popColour: pick(fx.grade.popColour),
        restColour: pick(fx.grade.restColour),
      },
      glowColour: pick(fx.glowColour),
      leaks: {
        ...fx.leaks,
        amount: fx.leaks.amount * leaks,
        colour: pick(fx.leaks.colour),
        spots: fx.leaks.spots.map((spot) => (spot.colour ? { ...spot, colour: pick(spot.colour) } : spot)),
      },
      // Recolour's colours are the photo's own scene, not the look's tint: the Colour key leaves them.
      ...(fx.recolour
        ? {
            recolour: {
              ...fx.recolour,
              items: fx.recolour.items.map((it) => ({
                ...it,
                colour: { source: 'manual' as const, colour: muted(it.colour.source === 'manual' ? it.colour.colour : palette[it.colour.source], it.colour.saturation ?? 1) },
              })),
            },
          }
        : {}),
    },
  }
}

export function srgbToLinear(c: Rgb): Rgb {
  const f = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  return [f(c[0]), f(c[1]), f(c[2])]
}

/** A colour as a light tint: linear, brightest channel 1. */
export function tintOf(c: Rgb): Rgb {
  const l = srgbToLinear(c)
  const m = Math.max(l[0], l[1], l[2], 1e-6)
  return [l[0] / m, l[1] / m, l[2] / m]
}
