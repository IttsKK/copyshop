import { MONO_TONES } from '../engine/extras'
import { DEFAULT_SURFACE, SURFACE_KINDS } from '../engine/surface'
import { STOCK_BY_ID } from '../engine/stocks'
import { repeatCopyCount } from '../engine/repeatParams'
import type { BlendParams } from '../engine/types'
import type { StackModuleId } from './moduleCatalog'

const pct = (v: number) => `${Math.round(v * 100)}`
const signed = (v: number, digits = 0) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(digits)}`
const join = (parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' · ')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * One line on what a module is doing to a photo, from its main settings: the
 * Recipe's "What's in it" list, and how it tells whether you have changed a
 * module since the recipe set it. Not every setting, only the ones that say
 * what it is: a reader should be able to picture the effect from it.
 */
export function moduleSummary(id: StackModuleId, b: BlendParams): string {
  const e = b.effects
  const g = e.grade
  switch (id) {
    case 'exposure':
      return join([
        e.base.exposure !== 0 && `Exposure ${signed(e.base.exposure, 1)}`,
        e.base.contrast !== 0 && `Contrast ${signed(e.base.contrast * 100)}`,
        e.base.highlights !== 0 && `Highlights ${signed(e.base.highlights * 100)}`,
        e.base.shadows !== 0 && `Shadows ${signed(e.base.shadows * 100)}`,
      ])
    case 'balance':
      return join([
        e.base.temperature !== 0 && `Temp ${signed(e.base.temperature * 100)}`,
        e.base.tint !== 0 && `Tint ${signed(e.base.tint * 100)}`,
        e.base.saturation !== 0 && `Saturation ${signed(e.base.saturation * 100)}`,
      ])
    case 'curve':
      return `${e.base.curve.length} points`
    case 'crop': {
      const c = e.crop
      const aspect = c.aspect === 'free' ? 'Free' : c.aspect === 'original' ? 'Original shape' : c.turned ? c.aspect.split(':').reverse().join(':') : c.aspect
      const q = ((Math.round(c.quarter ?? 0) % 4) + 4) % 4
      return join([aspect, q ? (q === 2 ? 'upside down' : q === 1 ? 'turned right' : 'turned left') : '', Math.abs(c.angle ?? 0) > 0.005 ? `straightened ${(c.angle ?? 0) > 0 ? '+' : ''}${(c.angle ?? 0).toFixed(1)}°` : '', `${Math.round(c.width * c.height * 100)}% of the photo`])
    }
    case 'prism':
      return join([`Split ${pct(e.prism.split)}`, e.prism.colours === 'spectrum' ? 'rainbow' : 'red & blue', e.prism.shape === 'radial' && 'radial', e.prism.light > 0 && 'the light only'])
    case 'lens':
      return join([
        e.lens.distortion !== 0 && (e.lens.distortion > 0 ? `Bulge ${pct(e.lens.distortion)}` : `Pinch ${pct(-e.lens.distortion)}`),
        e.lens.fringe > 0 && `Fringes ${pct(e.lens.fringe)}`,
        e.lens.softEdges > 0 && `Soft corners ${pct(e.lens.softEdges)}`,
        e.lens.diffusion > 0 && `Diffusion ${pct(e.lens.diffusion)}`,
        e.lens.tilt > 0 && `Tilt-shift ${pct(e.lens.tilt)}`,
      ])
    case 'double':
      return join([cap(e.double.mode), `${pct(e.double.amount)}%`])
    case 'stamp':
      return join([e.stamp.theme === 'digicam' ? 'Digital camera' : 'Film camera', e.stamp.corner.replace('-', ' ')])
    case 'mono': {
      const tone = MONO_TONES.find((t) => t.id === e.mono.tone)
      return join([e.mono.filter !== 'none' && `${cap(e.mono.filter)} filter`, tone && tone.id !== 'none' && `${tone.label} tone`, `${pct(e.mono.amount)}%`])
    }
    case 'halftone':
      return join([e.halftone.style === 'riso' ? 'Riso' : cap(e.halftone.style), `${pct(e.halftone.amount)}%`])
    case 'surface': {
      const s = e.surface ?? DEFAULT_SURFACE
      return join([s.kind === 'image' ? (s.imageName ?? 'Image') : SURFACE_KINDS.find((k) => k.id === s.kind)?.label, `${pct(s.amount)}%`, s.relief > 0 && `Relief ${pct(s.relief)}`])
    }
    case 'tone':
      return join([
        e.exposure !== 0 && `Film exposure ${signed(e.exposure, 1)}`,
        e.fade > 0 && `Fade ${pct(e.fade)}`,
        e.shoulder > 0 && `Soft highlights ${pct(e.shoulder)}`,
        e.vignette > 0 && `Vignette ${pct(e.vignette)}`,
        e.structure > 0 && `Clarity ${pct(e.structure)}`,
      ])
    case 'colour': {
      const stock = e.stock.id !== 'none' ? STOCK_BY_ID[e.stock.id]?.label : null
      return join([
        g.mapAmount > 0 && `Palette ${pct(g.mapAmount)}`,
        stock && `${stock} stock`,
        g.vibrance !== 0 && `Vibrance ${signed(g.vibrance * 100)}`,
        g.warmth !== 0 && `Warmth ${signed(g.warmth * 100)}`,
        (g.popAmount ?? 0) > 0 && `One colour ${pct(g.popAmount ?? 0)}`,
      ])
    }
    case 'light':
      return join([e.halation > 0 && `Halation ${pct(e.halation)}`, e.bloom > 0 && `Bloom ${pct(e.bloom)}`])
    case 'edges':
      return join([e.rim > 0 && `Glow ${pct(e.rim)}`, e.crunch > 0 && `Crunch ${pct(e.crunch)}`])
    case 'solarize':
      return join([e.solarize > 0 && `Reverse ${pct(e.solarize)}`, e.halo > 0 && `Lines ${pct(e.halo)}`])
    case 'leaks':
      return join([`${e.leaks.spots.length} ${e.leaks.spots.length === 1 ? 'spot' : 'spots'}`, `${pct(e.leaks.amount)}%`])
    case 'grain':
      // As the sliders read: Strength on its square-root scale.
      return join([`Strength ${Math.round(Math.sqrt(b.amount) * 100)}`, b.grainScale !== 1 && `Pattern scale ${b.grainScale.toFixed(2)}×`, b.chroma < 1 && `Colour ${pct(b.chroma)}`])
    case 'dither':
      return join([e.dither.pattern === 'ordered' ? 'Ordered' : 'Stipple', `${e.dither.steps} steps`, `${pct(e.dither.amount)}%`])
    case 'pixel':
      return join([e.pixelArt.pixelate > 1 && `${Math.round(e.pixelArt.pixelate)} px blocks`, e.pixelArt.palette !== 'off' && `${e.pixelArt.colours} colours`])
    case 'streaks':
      return e.streaks.shapes.length
        ? join([`${e.streaks.shapes.length} ${e.streaks.shapes.length === 1 ? 'streak' : 'streaks'}`, `${pct(e.streaks.amount)}%`])
        : 'No streaks yet'
    case 'glass': {
      const glass = e.glass
      return glass ? join([cap(glass.kind), `${pct(glass.amount)}%`]) : ''
    }
    case 'collage':
      return e.collage.pieces.length ? `${e.collage.pieces.length} ${e.collage.pieces.length === 1 ? 'piece' : 'pieces'}` : 'No pieces yet'
    case 'lighting': {
      const n = e.lighting?.lights.filter((l) => l.enabled !== false).length ?? 0
      return n ? `${n} ${n === 1 ? 'light' : 'lights'}` : 'No lights yet'
    }
    case 'repeat': {
      const items = (e.repeat?.items ?? []).filter((r) => r.enabled && !!r.source && e.masks.some((m) => m.id === r.source))
      if (!items.length) return 'Nothing to copy yet'
      if (items.length > 1) return `${items.length} repeats, ${items.reduce((n, r) => n + repeatCopyCount(r), 0)} copies`
      const r = items[0]
      const n = repeatCopyCount(r)
      const where = r.layout === 'grid' ? 'on a grid' : r.layout === 'path' ? 'along a path' : 'placed'
      return `${n} ${n === 1 ? 'copy' : 'copies'} ${where}`
    }
    case 'recolour': {
      const items = (e.recolour?.items ?? []).filter((it) => it.enabled && e.masks.some((m) => m.id === it.source))
      if (!items.length) return 'Nothing recoloured yet'
      const kept = items.filter((it) => it.mode === 'asShot').length
      const changed = items.length - kept
      return join([changed > 0 && `${changed} ${changed === 1 ? 'part' : 'parts'} recoloured`, kept > 0 && `${kept} kept as shot`])
    }
    case 'kaleido': {
      const k = e.kaleido
      if (!k) return ''
      const piece = !!k.source && e.masks.some((m) => m.id === k.source)
      return join([
        `${k.copies} ${piece ? 'copies of a part' : 'slices'}`,
        k.mirror && 'mirrored',
        k.rings > 1 && `${k.rings} rings`,
        k.rings > 1 && k.twist !== 0 && `twist ${signed(k.twist)}°`,
      ])
    }
    case 'border':
      return join([`Width ${pct(b.border.width)}`, b.border.bottomExtra > 0 && 'deeper at the foot'])
    case 'dust':
      return join([`${pct(e.defects.strength)}%`, e.defects.scratches > 0 && 'scratches'])
    case 'surge':
      return join([`${e.surge.count} marks`, `${pct(e.surge.strength)}%`])
  }
}

/**
 * Whether a module switched on still needs something done before it shows:
 * a streak drawn, a light placed, a piece chosen. Switched on, such a
 * module opens to show where to begin.
 */
export function needsSetup(id: StackModuleId, b: BlendParams): boolean {
  const s = moduleSummary(id, b)
  return /yet$/.test(s) || (id === 'glass' && !s) || (id === 'leaks' && b.effects.leaks.spots.length === 0)
}
