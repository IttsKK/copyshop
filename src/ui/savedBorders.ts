import { useEffect, useState } from 'react'
import { DEFAULT_BLEND_PARAMS, type BorderParams } from '../engine/types'
import { PARTS_CHANGED, applyPart, listParts, type StoredPart } from '../storage/parts'
import { STARTING_LOOK } from './looks'

/** A saved border preset of your own, with the border it sets. */
export interface SavedBorder {
  part: StoredPart
  border: BorderParams
}

/** Your own saved border presets (the Border module's ⋯ menu saves them), kept up to date. */
export function useSavedBorders(): SavedBorder[] {
  const [saved, setSaved] = useState<SavedBorder[]>([])
  useEffect(() => {
    let live = true
    const read = () =>
      void listParts('border')
        .then((parts) => {
          if (!live) return
          setSaved(
            parts
              .filter((p) => !p.builtIn && p.data.blend.border)
              // As applying it gives it, brought up to date and filled in, so it matches the border it sets.
              .map((p) => ({ part: p, border: applyPart(p.data, DEFAULT_BLEND_PARAMS, STARTING_LOOK.doc.grainSource).blend.border })),
          )
        })
        .catch(() => {})
    read()
    window.addEventListener(PARTS_CHANGED, read)
    return () => {
      live = false
      window.removeEventListener(PARTS_CHANGED, read)
    }
  }, [])
  return saved
}

/** `current` is the border `saved` sets: every setting the saved one has, the same (its seed aside). */
export function sameBorder(saved: BorderParams, current: BorderParams): boolean {
  const have = current as unknown as Record<string, unknown>
  return Object.entries(saved).every(([k, v]) => k === 'seed' || JSON.stringify(v) === JSON.stringify(have[k]))
}
