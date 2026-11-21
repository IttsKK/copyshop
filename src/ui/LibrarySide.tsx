import { useState } from 'react'
import type { PhotoFile } from '../platform/native'
import { CATEGORY_BY_ID, MODULE_BY_ID } from './moduleCatalog'
import { ModuleGlyph } from './ModuleGlyph'
import { PLACED, partsOf, type ClipPart, type EditClip } from './editClip'
import { keyLabel } from './shortcuts'
import { EXPORT_STATE_LABEL } from './exportState'
import type { ExportState } from '../storage/exports'

interface Props {
  chosen: PhotoFile[]
  total: number
  /** Photos here whose latest edit is not in their file yet. */
  changed: PhotoFile[]
  onSelectAll: () => void
  onSelectNone: () => void
  onSelectChanged: () => void
  onView: () => void
  onEdit: () => void
  edited: (f: PhotoFile) => boolean
  /** How each photo's edit stands against its file: what its dot in the grid means. */
  stateOf: (f: PhotoFile) => ExportState | null
  onReveal: () => void
  /** For one export saved in its photo's place: its original shown in the Finder. */
  onRevealOriginal: (() => void) | null
  /** The one photo chosen, edited: its edit put on a better copy of it (LibraryView's Replace photo…). */
  onReplace?: (() => void) | null
  /** The copied edit (App's, the same as the editor's), and its parts chosen. */
  clip: EditClip | null
  onClipParts: (parts: ClipPart[]) => void
  onCopy: () => void
  onPaste: () => void
  recipes: { id: string; label: string }[]
  onRecipe: (id: string) => void
  onExport: () => void
  exporting: boolean
  undoLabel: string | null
  onUndo: () => void
}

const partName = (p: ClipPart) => (p === 'masks' ? 'Masks' : MODULE_BY_ID[p].title)
const photos = (n: number) => `${n} ${n === 1 ? 'photo' : 'photos'}`

/**
 * The Library's sidebar: what to do with the photos selected, in the order
 * it is usually done. See or edit one; copy a photo's edit and paste the
 * parts of it you choose onto the rest (darktable's selective copy and
 * paste, ⌘C and ⌘V); give them a recipe; export them. The last change
 * made here can be taken back at the foot.
 */
/** What Replace photo… does, for its tooltip in the Library's menu and sidebar. */
export const REPLACE_HINT =
  'Put its edit on a better copy of the photo (larger, less compressed, or the RAW): everything stays where it is, and exports are made from the better copy. A new version saved over it in its folder is matched on its own.'

export function LibrarySide({ chosen, total, changed, onSelectAll, onSelectNone, onSelectChanged, onView, onEdit, edited, stateOf, onReveal, onRevealOriginal, onReplace, clip, onClipParts, onCopy, onPaste, recipes, onRecipe, onExport, exporting, undoLabel, onUndo }: Props) {
  const n = chosen.length
  const withEdits = chosen.filter(edited).length
  const [recipe, setRecipe] = useState(recipes[0]?.id ?? '')
  const parts = clip ? partsOf(clip.blend) : []
  // What the dots in the grid mean, for the photos selected: in words, beside the same dot.
  const STATES: (ExportState | null)[] = ['unexported', 'changed', 'exported', null]
  const states = STATES.map((st) => ({ st, count: chosen.filter((f) => stateOf(f) === st).length })).filter((x) => x.count)
  const stateWords = (st: ExportState | null) => (st ? EXPORT_STATE_LABEL[st] : 'not edited')
  const look = parts.filter((p) => !PLACED.includes(p))
  const placed = parts.filter((p) => PLACED.includes(p))
  const toggle = (p: ClipPart) => clip && onClipParts(clip.parts.includes(p) ? clip.parts.filter((x) => x !== p) : [...clip.parts, p])
  const check = (p: ClipPart) => {
    const m = p === 'masks' ? null : MODULE_BY_ID[p]
    return (
      <label key={p} className="ltools-part">
        <input type="checkbox" checked={!!clip?.parts.includes(p)} onChange={() => toggle(p)} />
        {m ? <ModuleGlyph id={m.id} tint={CATEGORY_BY_ID[m.category].tint} size={13} /> : <span className="ltools-mask-mark" aria-hidden />}
        <span>{partName(p)}</span>
      </label>
    )
  }

  return (
    <aside className="ltools" aria-label="Selected photos">
      <section>
        <h3>Selected</h3>
        <p className="ltools-count">{n ? `${photos(n)} of ${total}` : 'None'}</p>
        <div className="ltools-links">
          <button className="link" onClick={onSelectAll} title={`Select every photo here (${keyLabel('cmd+a')})`}>
            All
          </button>
          <button className="link" disabled={!n} onClick={onSelectNone} title="Select none (Esc)">
            None
          </button>
          {changed.length > 0 && (
            <button className="link" onClick={onSelectChanged} title="The photos whose latest edit is not in their file yet">
              Changed ({changed.length})
            </button>
          )}
        </div>
        {n > 0 && (
          <ul className="ltools-states">
            {states.map(({ st, count }) => (
              <li key={st ?? 'none'}>
                {st ? <i className={`library-dot ${st}`} aria-hidden /> : <i className="ltools-nodot" aria-hidden />}
                {n === 1 ? stateWords(st)[0].toUpperCase() + stateWords(st).slice(1) : `${count} ${stateWords(st)}`}
              </li>
            ))}
          </ul>
        )}
        {n > 0 && (
          <div className="ltools-links">
            <button className="link" onClick={onReveal} title="Show the file in the Finder">
              Show in Finder
            </button>
            {onRevealOriginal && (
              <button className="link" onClick={onRevealOriginal} title="This file is an export of it; the original is in Originals beside it">
                Show original
              </button>
            )}
            {onReplace && (
              <button className="link" onClick={onReplace} title={REPLACE_HINT}>
                Replace photo…
              </button>
            )}
          </div>
        )}
        <div className="ltools-row">
          <button disabled={!n} onClick={onView} title="See it full screen (F or Space)">
            Full screen
          </button>
          <button disabled={n !== 1} onClick={onEdit} title={n > 1 ? 'Select one photo to edit it' : 'Edit it (Enter)'}>
            Edit
          </button>
        </div>
      </section>

      <section>
        <h3>Copy and paste</h3>
        <button
          className="ltools-wide"
          disabled={n !== 1 || !withEdits}
          onClick={onCopy}
          title={n !== 1 ? 'Select one photo to copy its edit' : !withEdits ? 'This photo has no edit yet' : `Copy this photo’s edit (${keyLabel('cmd+c')})`}
        >
          Copy edit
        </button>
        {clip ? (
          <>
            <p className="ltools-from">
              From <b>{clip.from}</b>
            </p>
            {look.length > 0 && (
              <div className="ltools-parts">
                <div className="ltools-parts-head">
                  <span>Look</span>
                  <span>
                    <button className="link" onClick={() => onClipParts([...new Set([...clip.parts, ...look])])}>
                      All
                    </button>
                    <button className="link" onClick={() => onClipParts(clip.parts.filter((p) => !look.includes(p)))}>
                      None
                    </button>
                  </span>
                </div>
                {look.map(check)}
              </div>
            )}
            {placed.length > 0 && (
              <div className="ltools-parts">
                <div className="ltools-parts-head" title="Where things are on that photo: chosen, they are put in the same places on these">
                  <span>Placed on the photo</span>
                </div>
                {placed.map(check)}
              </div>
            )}
            <button className="primary ltools-wide" disabled={!n || !clip.parts.length} onClick={onPaste} title={`Give them the parts chosen (${keyLabel('cmd+v')}); the rest of each edit stays`}>
              {n ? `Paste onto ${photos(n)}` : 'Paste'}
            </button>
          </>
        ) : (
          <p className="ltools-hint">No edit copied</p>
        )}
      </section>

      <section>
        <h3>Recipe</h3>
        <select className="ltools-wide" value={recipe} aria-label="Recipe" onChange={(e) => setRecipe(e.target.value)}>
          {recipes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.label}
            </option>
          ))}
        </select>
        <button className="ltools-wide" disabled={!n || !recipe} onClick={() => onRecipe(recipe)} title="Their crops, streaks and masks stay their own">
          {n ? `Apply to ${photos(n)}` : 'Apply'}
        </button>
      </section>

      <section>
        <h3>Export</h3>
        <button
          className="ltools-wide"
          disabled={!withEdits || exporting}
          onClick={onExport}
          title={n && !withEdits ? 'None of these has an edit to export' : 'With your export settings, each where Export saves it. Photos with no edit are left as they are.'}
        >
          {exporting ? 'Exporting…' : withEdits ? `Export ${photos(withEdits)}` : 'Export'}
        </button>
      </section>

      {undoLabel && (
        <div className="ltools-undo">
          <button className="link" onClick={onUndo} title="Every photo it changed goes back">
            Undo {undoLabel}
          </button>
        </div>
      )}
    </aside>
  )
}
