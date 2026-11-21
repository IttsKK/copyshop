import type { BlendParams } from '../engine/types'
import { ModuleGlyph } from './ModuleGlyph'
import { CATEGORY_BY_ID, MODULES, inUse, presetKind, type StackModuleId } from './moduleCatalog'
import { extractPart } from '../storage/parts'
import { moduleSummary } from './moduleSummary'

interface Props {
  /** The settings now. */
  blend: BlendParams
  /** The settings as the recipe set them, on this photo; null with no recipe. */
  recipe: BlendParams | null
  /** The recipe as it was designed, without what belongs to this photo: a module it never had is one you added. */
  designed?: BlendParams
  onGo: (id: StackModuleId) => void
  /** Shown when nothing is in it. */
  empty?: string
}

/** A module's own settings, to tell whether any of them is changed (not only what its summary says). */
const settingsOf = (id: StackModuleId, b: BlendParams): string => {
  const kind = presetKind(id)
  return kind ? JSON.stringify(extractPart(kind, b, null)) : (moduleSummary(id, b) ?? '')
}

/**
 * What the recipe is made of: each module it uses, in the order applied, with
 * one line on what it does. Modules you have changed, added or taken off since
 * say so, so a recipe never hides what it did. Clicking one goes to it.
 */
export function RecipeContents({ blend, recipe, designed, onGo, empty = 'Nothing yet: pick a recipe, or find a module.' }: Props) {
  const rows = MODULES.filter((m) => m.id !== 'border' && (inUse(m.id, blend) || (recipe && inUse(m.id, recipe)))).map((m) => {
    const now = inUse(m.id, blend)
    const was = recipe ? inUse(m.id, recipe) && (!designed || inUse(m.id, designed)) : false
    const state = !recipe ? null : !now ? 'taken off' : !was ? 'added' : settingsOf(m.id, blend) !== settingsOf(m.id, recipe) ? 'changed' : null
    return { m, now, state, line: moduleSummary(m.id, now ? blend : recipe!) }
  })
  if (!rows.length) return <p className="hint-line">{empty}</p>
  return (
    <ol className="recipe-contents">
      {rows.map(({ m, now, state, line }) => {
        const c = CATEGORY_BY_ID[m.category]
        return (
          <li key={m.id}>
            <button className={`recipe-part${now ? '' : ' gone'}`} title={`${m.blurb}. Click to go to ${m.title.toLowerCase()}.`} onClick={() => onGo(m.id)}>
              <ModuleGlyph id={m.id} tint={c.tint} size={13} />
              <b>{m.title}</b>
              <small>{line || m.blurb}</small>
              {state && <em>{state}</em>}
            </button>
          </li>
        )
      })}
    </ol>
  )
}
