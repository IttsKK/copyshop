import type { BaseParams } from '../engine/base'
import type { BlendParams } from '../engine/types'
import type { SerializedGrainSource } from '../sources/GrainSource'
import { applyPart, extractPart } from '../storage/parts'
import { MODULES, inUse, presetKind, stopModule, type StackModuleId } from './moduleCatalog'

/**
 * The copied edit, darktable's way: one photo's edit, copied whole, and a
 * choice of its parts to paste onto other photos (the Library's selection,
 * or the photo in the editor). One clipboard for the whole app: a module's
 * ⋯ Copy settings copies its edit with just that module chosen.
 */
export interface EditClip {
  /** The photo it was copied from, by name. */
  from: string
  blend: BlendParams
  grainSource: SerializedGrainSource
  /** The parts chosen to paste. */
  parts: ClipPart[]
}

/** A part of an edit: a module, or the masks in the Masks list (and which modules use them). */
export type ClipPart = StackModuleId | 'masks'

/**
 * Parts that belong to where things are on one photo (its crop, its streaks
 * and their subjects, its repeats and their pieces, its lights, its masks,
 * pieces and a second photo laid in): offered, but not chosen unless asked for.
 */
export const PLACED: readonly ClipPart[] = ['crop', 'streaks', 'repeat', 'lighting', 'collage', 'double', 'masks']

/** The base photo's modules share one set of settings: each one's own. */
export const BASE_SETTINGS: Partial<Record<StackModuleId, (keyof BaseParams)[]>> = {
  exposure: ['exposure', 'contrast', 'highlights', 'shadows', 'whites', 'blacks', 'lightOn'],
  balance: ['temperature', 'tint', 'saturation', 'colourOn'],
  curve: ['curve', 'curveOn'],
}

/** What an edit has to copy: the modules it uses, in the panel's order, and its listed masks. */
export function partsOf(blend: BlendParams): ClipPart[] {
  const parts: ClipPart[] = MODULES.filter((m) => inUse(m.id, blend)).map((m) => m.id)
  if (blend.effects.masks.some((m) => !m.owner)) parts.push('masks')
  return parts
}

/** An edit copied, with its look chosen to paste (or only `only`, from a module's ⋯ menu). */
export function clipOf(from: string, edit: { blend: BlendParams; grainSource: SerializedGrainSource }, only?: ClipPart[]): EditClip {
  const all = partsOf(edit.blend)
  return { from, blend: structuredClone(edit.blend), grainSource: structuredClone(edit.grainSource), parts: only ?? all.filter((p) => !PLACED.includes(p)) }
}

/**
 * The copied parts pasted onto an edit. A module chosen takes the copied
 * photo's settings for it; one not chosen stays as it is, except that with
 * the whole look chosen (every module of it), the modules the copied photo
 * doesn't use are switched off, so the photo takes its look as it is. What
 * is placed on a photo comes only when chosen, with its own masks.
 */
export function pasteClip(clip: EditClip, into: { blend: BlendParams; grainSource: SerializedGrainSource }): { blend: BlendParams; grainSource: SerializedGrainSource } {
  let blend = into.blend
  let grainSource = into.grainSource
  const from = clip.blend
  const fx = (patch: Partial<BlendParams['effects']>) => (blend = { ...blend, effects: { ...blend.effects, ...patch } })
  const look = partsOf(from).filter((p) => !PLACED.includes(p))
  if (look.length && look.every((p) => clip.parts.includes(p)))
    for (const m of MODULES) if (!PLACED.includes(m.id) && !look.includes(m.id) && inUse(m.id, blend)) blend = stopModule(m.id, blend)
  // A module's own masks (a streak's subject, a repeat's piece), swapped for the copied photo's.
  const owned = (owner: 'streak' | 'repeat') => fx({ masks: [...blend.effects.masks.filter((m) => m.owner !== owner), ...structuredClone(from.effects.masks.filter((m) => m.owner === owner))] })
  for (const p of clip.parts) {
    const base = p !== 'masks' ? BASE_SETTINGS[p] : undefined
    const kind = p !== 'masks' ? presetKind(p) : null
    if (p === 'masks') fx({ masks: [...blend.effects.masks.filter((m) => m.owner), ...structuredClone(from.effects.masks.filter((m) => !m.owner))], maskUse: structuredClone(from.effects.maskUse) })
    else if (base) fx({ base: { ...blend.effects.base, ...Object.fromEntries(base.map((k) => [k, structuredClone(from.effects.base[k])])) } })
    else if (kind) ({ blend, grainSource } = applyPart(extractPart(kind, from, clip.grainSource), blend, grainSource))
    else if (p === 'streaks') {
      fx({ streaks: structuredClone(from.effects.streaks) })
      owned('streak')
    } else if (p === 'repeat') {
      fx({ repeat: structuredClone(from.effects.repeat) })
      owned('repeat')
    } else if (p === 'crop') fx({ crop: structuredClone(from.effects.crop) })
    else if (p === 'lighting') fx({ lighting: structuredClone(from.effects.lighting) })
    else if (p === 'collage') fx({ collage: structuredClone(from.effects.collage) })
    else if (p === 'double') fx({ double: structuredClone(from.effects.double) })
  }
  // Placed things are measured as the copied photo's were.
  if (clip.parts.some((p) => PLACED.includes(p))) fx({ shapeSpace: from.effects.shapeSpace, shapeUnits: from.effects.shapeUnits })
  return { blend, grainSource }
}
