import type { BlendParams } from '../engine/types'
import { borderStyleOf } from './borderStyles'
import type { Look } from './looks'
import { MODULES, inUse } from './moduleCatalog'
import { paletteOf, palettesFor } from './recipePalettes'
import { kindOf } from './streakKinds'
import { styleOf } from './streakStyles'

/**
 * What an exported edit has in it, as usage counts (platform/usage.ts): each
 * module in use, with the built-in style it uses where it has one, each kind
 * of streak, listed masks, and the recipe it started from. Built-in names
 * only; a recipe or border someone saved themselves is "own".
 */
export function editUsage(blend: BlendParams, look: Look | null, presetId: string): [a: string, b: string | null][] {
  const out: [string, string | null][] = []
  const fx = blend.effects
  for (const m of MODULES) {
    if (!inUse(m.id, blend)) continue
    if (m.id === 'streaks') {
      const seen = new Set<string>()
      for (const s of fx.streaks.shapes) {
        const key = `${kindOf(s)}/${styleOf(s) ?? 'custom'}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push([`streak ${kindOf(s)}`, styleOf(s) ?? 'custom'])
      }
      continue
    }
    const detail = m.id === 'border' ? (borderStyleOf(blend.border) ?? 'custom') : m.id === 'stamp' ? fx.stamp.theme : m.id === 'crop' ? String(fx.crop.aspect) : null
    out.push([m.id, detail])
  }
  if (fx.masks.some((m) => !m.owner)) out.push(['masks', String(fx.masks.filter((m) => !m.owner).length)])
  out.push(['recipe', look && look.id !== 'none' ? look.id : presetId ? 'own' : 'none'])
  // The palette the recipe is in, of its own: which colours people keep.
  if (look && !presetId && palettesFor(look.id).length) out.push(['palette', `${look.id}/${paletteOf(blend, palettesFor(look.id))?.id ?? 'custom'}`])
  return out
}
