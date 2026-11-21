import type { RepeatParams } from '../engine/repeatParams'

/**
 * What belongs to where a repeat is, and stays with it when another's
 * settings are pasted on: which repeat it is, whether it is on, its piece,
 * and the points it was given on the photo (its path, its placed copies,
 * its perspective point), which are about its own piece's place.
 */
const PLACE: readonly (keyof RepeatParams)[] = ['id', 'enabled', 'source', 'path', 'placed', 'vanish', 'fitPending']

/** A repeat's settings, to paste onto another: its layout, spacing, sizes, turn, opacity and blend. */
export function repeatSettingsOf(r: RepeatParams): Partial<RepeatParams> {
  const out = structuredClone(r) as Partial<RepeatParams>
  for (const k of PLACE) delete out[k]
  return out
}

/**
 * Settings pasted onto a repeat. A path or placed layout comes over only
 * when this repeat has points of its own for it: copies need somewhere to
 * go, and the other's points are about the other's piece.
 */
export function pasteRepeatSettingsOnto(r: RepeatParams, settings: Partial<RepeatParams>): RepeatParams {
  const next = { ...r, ...structuredClone(settings) } as Record<string, unknown>
  // What the other did not have set (Both sides, an angle), this one does not either.
  for (const k of Object.keys(r)) if (!(PLACE as readonly string[]).includes(k) && !(k in settings)) delete next[k]
  const out = next as unknown as RepeatParams
  if ((out.layout === 'path' && r.path.length < 2) || (out.layout === 'placed' && !r.placed.length)) out.layout = r.layout
  return out
}
