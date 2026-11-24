import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { BlendParams } from '../engine/types'
import type { PresetDoc, StoredPreset } from '../storage/presets'
import type { PartKind } from '../storage/parts'
import { Disclosure } from './controls'
import { ModuleGlyph } from './ModuleGlyph'
import { CATEGORY_BY_ID, MODULES, inUse, presetKind } from './moduleCatalog'
import { moduleSummary } from './moduleSummary'
import type { Look } from './looks'
import { NameField } from './NameField'
import { RecipeThumb } from './RecipeThumb'
import { useLocalStorage } from './useLocalStorage'

interface Props {
  looks: Look[]
  presets: StoredPreset[]
  activeLookId: string | null
  activePresetId: string
  /** The settings no longer match the active look or preset as saved. */
  edited: boolean
  canSave: boolean
  /** Streaks, masks or a collage are on the photo: saving offers to include them. */
  hasPlaced: boolean
  onApplyLook: (look: Look) => void
  /** Pointing at one: show it against the photo, as pointing at a snapshot does; null when the pointer leaves. */
  onHover?: (item: { key: string; name: string; doc: Look['doc'] } | null) => void
  onApplyPreset: (preset: StoredPreset) => void
  onSaveNew: (name: string, includePlaced: boolean) => void
  onUpdate: () => void
  /** Rename one of yours: the one in use, or the one with this id. */
  onRename: (name: string, id?: string) => void
  onExport: () => void
  onImport: (files: FileList | null) => void
  /** Delete one of yours: the one in use, or the one with this id. */
  onDelete: (id?: string) => void
  /** What the active recipe is for: a built-in's own line, or what you wrote for yours. */
  description: string | null
  /** Your own recipe is active, so its description can be written. */
  onDescribe?: (text: string) => void
  /** Back to how the app starts, on this photo. */
  onStartOver: () => void
  /** Everything off, placed things too: the photo as it is. */
  /** For the small previews: the photo, and a recipe's settings on it as applying it would give. */
  photo: { bitmap: ImageBitmap; seed?: number } | null
  paramsFor: (doc: PresetDoc) => BlendParams
  /** Under the recipe in use: what it is made of, how strong. */
  children?: ReactNode
  /** Add these modules from a recipe to the edit, leaving the rest as it is. */
  onMix?: (doc: PresetDoc, name: string, kinds: PartKind[]) => void
  /** The edit with those modules added, to show while pointing at the button. */
  mixed?: (doc: PresetDoc, kinds: PartKind[]) => PresetDoc
  /** Which of a recipe's parts the edit no longer has as the recipe does: marked, and listed first, in Put back. */
  changedParts?: (doc: PresetDoc) => PartKind[]
  /** What a recipe holds, shown when its row is opened out: the one in use, marked against the edit. */
  contents?: (doc: PresetDoc, active: boolean) => ReactNode
  /** Built-in recipes that suit the open photo (suggestedLooks), shown first in a section of their own. */
  suggested?: Look[]
  /** The Colours set the edit is in, named after the recipe in use ("Stipple · Tide"). */
  colourName?: string | null
}

/** One recipe in the list, whichever kind. */
interface Entry {
  key: string
  name: string
  hint: string
  doc: PresetDoc
  on: boolean
  apply: () => void
  /** A saved one of yours. */
  preset?: StoredPreset
}

/**
 * The recipes page. At the top the recipe in use: its name, Reset and Update
 * when it has been changed, what it is for, and (children) what it is made
 * of. Under it every recipe, built to grow: a search, then folding sections
 * (your favourites, the built-in ones, yours), each recipe a row with this
 * photo in it, small. Point at one to compare it on the photo; click to use
 * it; the star keeps it in Favourites.
 */
export function LookPicker(props: Props) {
  const { looks, presets, activeLookId, activePresetId, edited, canSave } = props
  const [naming, setNaming] = useState(false)
  // Saving a look leaves out what is placed on this photo unless this is ticked.
  const [includePlaced, setIncludePlaced] = useState(false)
  /** The recipe of yours being renamed: true for the one in use (from ⋯), or its id (from its own menu). */
  const [renaming, setRenaming] = useState<boolean | string>(false)
  /** A recipe of yours' own menu (right-click or its ⋯), where it was opened. */
  const [rowMenu, setRowMenu] = useState<{ preset: StoredPreset; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!rowMenu) return
    const away = () => setRowMenu(null)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setRowMenu(null)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [rowMenu])
  // Mixing in part of a recipe: which one, and the modules ticked.
  const [mixing, setMixing] = useState<{ key: string; kinds: PartKind[]; doc: PresetDoc; name: string } | null>(null)
  /**
   * Recipes opened out to show what is in them, by row key. The one in use
   * shows its modules (each a link to it) unless closed: `opened` holds the
   * others opened, and the one in use once closed.
   */
  const [opened, setOpened] = useState<Set<string>>(() => new Set())
  const toggleOpened = (key: string) =>
    setOpened((was) => {
      const next = new Set(was)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  // (None has nothing to list, so it shows nothing unless opened.)
  const showsContents = (e: { key: string; on: boolean }) => (e.on && e.key !== 'look:none' ? !opened.has(e.key) : opened.has(e.key))
  // The one in use shows them under its first row only (it can be listed twice, as suggested and built in).
  const contentsHere = (e: { key: string; on: boolean }, first: boolean) => showsContents(e) && (!e.on || first)
  // Mixing in: the photo shows the mix as it is ticked, before it is added.
  const mixPreview = () =>
    mixing && mixing.kinds.length && props.mixed
      ? { key: `${mixing.key}:mix:${mixing.kinds.join(',')}`, name: mixing.name, doc: props.mixed(mixing.doc, mixing.kinds) }
      : null
  useEffect(() => {
    props.onHover?.(mixPreview())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mixing])
  // Esc closes the mix-in panel (and its preview); so does applying another recipe.
  useEffect(() => {
    if (!mixing) return
    const esc = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[role="dialog"]')) return
      e.stopPropagation()
      setMixing(null)
    }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [mixing])
  useEffect(() => setMixing(null), [activeLookId, activePresetId])
  /** Pointing at a recipe previews it; pointing away goes back to the mix being ticked, if any. */
  const hover = (h: { key: string; name: string; doc: PresetDoc } | null) => props.onHover?.(h ?? mixPreview())
  const [menuOpen, setMenuOpen] = useState(false)
  const [describing, setDescribing] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const activePreset = presets.find((p) => p.id === activePresetId)
  const activeLook = looks.find((l) => l.id === activeLookId)
  const activeName = activePreset?.data.name ?? activeLook?.label ?? null
  const [query, setQuery] = useState('')
  const [favourites, setFavourites] = useLocalStorage<string[]>('ui.recipes.favourites', [])
  // The sections' folding, held here so the recipe in use opens in the first one showing it.
  const [favOpen, setFavOpen] = useLocalStorage('ui.disclosure.recipes-favourites', true)
  const [builtInOpen, setBuiltInOpen] = useLocalStorage('ui.disclosure.recipes-builtin', true)
  const [suggestedOpen, setSuggestedOpen] = useLocalStorage('ui.disclosure.recipes-suggested', true)
  const [yoursOpen, setYoursOpen] = useLocalStorage('ui.disclosure.recipes-yours', true)

  useEffect(() => {
    if (!menuOpen) return
    const away = (e: MouseEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMenuOpen(false)
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [menuOpen])

  const item = (label: string, action: () => void, disabled = false) => (
    <button
      className="menu-item"
      disabled={disabled}
      onClick={() => {
        setMenuOpen(false)
        action()
      }}
    >
      {label}
    </button>
  )

  const builtIn: Entry[] = looks.map((look) => ({
    key: `look:${look.id}`,
    name: look.label,
    hint: look.hint,
    doc: look.doc,
    on: activeLookId === look.id,
    apply: () => props.onApplyLook(look),
  }))
  // The few that suit this photo, by its own colours (suggestedLooks), listed again first.
  const suggested = (props.suggested ?? []).map((l) => builtIn.find((e) => e.key === `look:${l.id}`)).filter((e): e is Entry => !!e)
  const yours: Entry[] = presets.map((preset) => ({
    key: `preset:${preset.id}:${preset.updatedAt}`,
    name: preset.data.name,
    hint: preset.data.description ?? `Saved ${new Date(preset.updatedAt).toLocaleDateString()}`,
    doc: preset.data,
    on: activePresetId === preset.id,
    apply: () => props.onApplyPreset(preset),
    preset,
  }))
  // A favourite is kept by its key without the saved time, so updating one keeps its star.
  const starKey = (e: Entry) => e.key.replace(/:\d+$/, '')
  const isFav = (e: Entry) => favourites.includes(starKey(e))
  // The recipe in use opens under its row, once, with what belongs to it.
  let detailShown = false

  const detail = () => (
    <div className="recipe-detail">
      {edited && (
        <div className="recipe-edited">
          <span>Changed since you applied it</span>
          <button
            className="link"
            title={`Back to ${activeName} as ${activePreset ? 'saved' : 'designed'}`}
            onClick={() => (activePreset ? props.onApplyPreset(activePreset) : activeLook && props.onApplyLook(activeLook))}
          >
            Reset
          </button>
          {activePreset && (
            <button className="link" title={`Save the current settings into ${activePreset.data.name}`} onClick={props.onUpdate}>
              Update
            </button>
          )}
        </div>
      )}
      {describing && props.onDescribe ? (
        <textarea
          className="look-description-edit"
          autoFocus
          rows={2}
          maxLength={400}
          defaultValue={props.description ?? ''}
          placeholder="What it's for, what it does: shown to anyone you share it with"
          onBlur={(e) => {
            setDescribing(false)
            if (e.target.value.trim() !== (props.description ?? '')) props.onDescribe!(e.target.value)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey)) {
              e.preventDefault()
              ;(e.target as HTMLTextAreaElement).blur()
            }
          }}
        />
      ) : props.description && props.onDescribe ? (
        <p className="look-description editable" title="Click to change what it says" onClick={() => setDescribing(true)}>
          {props.description}
        </p>
      ) : (
        props.onDescribe && (
          <button className="link look-describe" onClick={() => setDescribing(true)}>
            Add a description
          </button>
        )
      )}
      {props.children}
    </div>
  )

  const row = (e: Entry) => {
    if (e.preset && (renaming === e.preset.id || (renaming === true && e.preset.id === activePresetId)))
      return (
        <NameField
          key={e.key}
          label="Rename this recipe"
          initial={e.name}
          onDone={(name) => {
            setRenaming(false)
            if (name && name !== e.name) props.onRename(name, e.preset!.id)
          }}
        />
      )
    const open = e.on && !detailShown
    if (open) detailShown = true
    return (
      <div
        key={e.key}
        className={`recipe-item${e.on ? ' on' : ''}${e.on && props.onDescribe ? ' describable' : ''}`}
        onContextMenu={
          e.preset
            ? (ev) => {
                ev.preventDefault()
                setRowMenu({ preset: e.preset!, x: ev.clientX, y: ev.clientY })
              }
            : undefined
        }
      >
        <div className="recipe-row">
          <button
            className="recipe-pick"
            title={e.hint}
            onPointerEnter={() => hover({ key: e.key, name: e.name, doc: e.doc })}
            onPointerLeave={() => hover(null)}
            onClick={() => {
              props.onHover?.(null)
              e.apply()
            }}
          >
            <RecipeThumb id={e.key} doc={e.doc} photo={props.photo} params={() => props.paramsFor(e.doc)} />
            <b>
              {e.name}
              {e.on && props.colourName ? ` · ${props.colourName}` : null}
              {e.on && edited ? <em> · edited</em> : null}
            </b>
            <small>{e.hint}</small>
          </button>
          {props.contents ? (
            <button
              // Lit (kept over the row's text) only when opened by hand; the one in use shows its modules anyway.
              className={`recipe-expand${contentsHere(e, open) ? ' open' : ''}${contentsHere(e, open) && !e.on ? ' on' : ''}`}
              title={contentsHere(e, open) ? 'Hide what is in it' : "What's in it"}
              aria-label={`What's in ${e.name}`}
              aria-expanded={contentsHere(e, open)}
              onClick={() => toggleOpened(e.key)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden>
                <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          ) : (
            <span className="recipe-mix-gap" aria-hidden />
          )}
          {/* Any other recipe's modules can be added; the one in use, once you've changed it, can give some of its modules back. */}
          {props.onMix && (!e.on || edited) ? (
            <button
              className={`recipe-mix-toggle${mixing?.key === e.key ? ' on' : ''}`}
              title={e.on ? "Put back some of this recipe's modules as it has them, keeping the rest of your changes" : "Mix in: add some of this recipe's modules to your edit, keeping the rest"}
              aria-label={e.on ? `Put back from ${e.name}` : `Mix in from ${e.name}`}
              aria-expanded={mixing?.key === e.key}
              onClick={() => setMixing(mixing?.key === e.key ? null : { key: e.key, kinds: [], doc: e.doc, name: e.name })}
            >
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
                <path d="M8 2.2l5.6 2.9L8 8 2.4 5.1z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                <path d="M2.6 8.2L8 11l2-1" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M12.6 9.4v4.4M10.4 11.6h4.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
            </button>
          ) : (
            <span className="recipe-mix-gap" aria-hidden />
          )}
          <button
            className={`recipe-star${isFav(e) ? ' on' : ''}`}
            title={isFav(e) ? 'Take out of Favourites' : 'Keep in Favourites'}
            aria-label={isFav(e) ? `Take ${e.name} out of Favourites` : `Add ${e.name} to Favourites`}
            aria-pressed={isFav(e)}
            onClick={() => setFavourites(isFav(e) ? favourites.filter((k) => k !== starKey(e)) : [...favourites, starKey(e)])}
          >
            {isFav(e) ? '★' : '☆'}
          </button>
        </div>
        {open && detail()}
        {contentsHere(e, open) && props.contents && <div className="recipe-opened">{props.contents(e.doc, e.on)}</div>}
        {mixing?.key === e.key && mixPanel(e)}
      </div>
    )
  }

  /** The modules of a recipe that can be added on their own, ticked to add. */
  const mixPanel = (e: Entry) => {
    const changed = e.on && props.changedParts ? props.changedParts(e.doc) : []
    const parts = MODULES.filter((m) => m.id !== 'border' && presetKind(m.id) && inUse(m.id, e.doc.blend)).sort(
      (a, b) => Number(changed.includes(presetKind(b.id)!)) - Number(changed.includes(presetKind(a.id)!)),
    )
    const kinds = mixing?.kinds ?? []
    const toggle = (k: PartKind) => setMixing({ key: e.key, doc: e.doc, name: e.name, kinds: kinds.includes(k) ? kinds.filter((x) => x !== k) : [...kinds, k] })
    const add = () => {
      props.onHover?.(null)
      props.onMix?.(e.doc, e.name, kinds)
      setMixing(null)
    }
    return (
      <div className="recipe-mix">
        <div className="recipe-mix-head">
          <span>{e.on ? `Put back from ${e.name}` : `Add from ${e.name}`}</span>
          <button className="recipe-mix-close" title="Close" aria-label="Close" onClick={() => setMixing(null)}>
            ×
          </button>
        </div>
        <div className="recipe-mix-parts">
          {parts.map((m) => {
            const k = presetKind(m.id)!
            return (
              <label key={m.id} className={`recipe-mix-part${kinds.includes(k) ? ' on' : ''}`}>
                <input type="checkbox" checked={kinds.includes(k)} onChange={() => toggle(k)} />
                <ModuleGlyph id={m.id} tint={CATEGORY_BY_ID[m.category].tint} size={13} />
                <b>
                  {m.title}
                  {changed.includes(k) && <em className="recipe-mix-changed"> · changed</em>}
                </b>
                <small>{moduleSummary(m.id, e.doc.blend) || m.blurb}</small>
              </label>
            )
          })}
        </div>
        <button
          className="primary recipe-mix-add"
          disabled={!kinds.length}
          title="The photo shows the mix as you tick it; the rest of your edit stays as it is"
          onClick={add}
        >
          {kinds.length
            ? `${e.on ? 'Put back' : 'Add'} ${kinds.length === 1 ? '1 module' : `${kinds.length} modules`}`
            : e.on
              ? 'Tick what to put back'
              : 'Tick what to add'}
        </button>
      </div>
    )
  }

  const q = query.trim().toLowerCase()
  const favs = [...builtIn, ...yours].filter(isFav)

  return (
    <>
      <div className="recipe-tools">
        <label className="search-field">
          <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            placeholder="Search recipes"
            aria-label="Search recipes"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') setQuery('')
            }}
          />
          {query && (
            <button className="search-clear" aria-label="Clear the search" onClick={() => setQuery('')}>
              ×
            </button>
          )}
        </label>
        <span className="menu-anchor" ref={menuRef}>
          <button className="icon wide" title="More recipe actions" aria-label="More recipe actions" onClick={() => setMenuOpen((v) => !v)}>
            ⋯
          </button>
          {menuOpen && (
            <div className="menu">
              {item('Share the recipe in use as a file…', props.onExport, !canSave)}
              {item('Add a recipe from a file…', () => fileInput.current?.click())}
              {item(activePreset ? `Rename “${activePreset.data.name}”` : 'Rename the recipe in use', () => setRenaming(true), !activePreset)}
              {item(activePreset ? `Delete “${activePreset.data.name}”` : 'Delete the recipe in use', () => props.onDelete(), !activePreset)}
              {item('Start over: no recipe, every module reset', props.onStartOver)}
            </div>
          )}
        </span>
      </div>
      <div className="recipe-library">
        {q ? (
          (() => {
            const found = [...builtIn, ...yours].filter((e) => `${e.name} ${e.hint}`.toLowerCase().includes(q))
            return found.length ? <div className="recipe-rows">{found.map(row)}</div> : <p className="hint-line">No recipe matches “{query.trim()}”.</p>
          })()
        ) : (
          <>
            {favs.length > 0 && (
              <Disclosure id="recipes-favourites" title="Favourites" summary={`${favs.length}`} open={favOpen} onOpenChange={setFavOpen}>
                {favOpen && <div className="recipe-rows">{favs.map(row)}</div>}
              </Disclosure>
            )}
            {suggested.length > 0 && (
              <Disclosure id="recipes-suggested" title="Suggested for this photo" summary={`${suggested.length}`} open={suggestedOpen} onOpenChange={setSuggestedOpen}>
                {suggestedOpen && <div className="recipe-rows">{suggested.map(row)}</div>}
              </Disclosure>
            )}
            <Disclosure id="recipes-builtin" title="Built-in" summary={`${builtIn.length}`} open={builtInOpen} onOpenChange={setBuiltInOpen}>
              {builtInOpen && <div className="recipe-rows">{builtIn.map(row)}</div>}
            </Disclosure>
            <Disclosure id="recipes-yours" title="Yours" summary={`${yours.length}`} open={yoursOpen} onOpenChange={setYoursOpen}>
              {yoursOpen && yours.length > 0 && <div className="recipe-rows">{yours.map(row)}</div>}
              {naming ? (
                <NameField
                  label="Name for the new recipe"
                  placeholder="Name this recipe"
                  onDone={(name) => {
                    setNaming(false)
                    if (name) props.onSaveNew(name, includePlaced && props.hasPlaced)
                    setIncludePlaced(false)
                  }}
                />
              ) : (
                <button className="recipe-add" disabled={!canSave} title="Keep the current settings as a recipe of your own" onClick={() => setNaming(true)}>
                  + Save as a recipe
                </button>
              )}
              {naming && props.hasPlaced && (
                <label
                  className="check-row look-include"
                  title="Streaks, masks and the collage are drawn round things in this photo, so a recipe leaves them out unless this is ticked"
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <input type="checkbox" checked={includePlaced} onChange={(e) => setIncludePlaced(e.target.checked)} />
                  Include streaks, masks &amp; collage
                </label>
              )}
            </Disclosure>
          </>
        )}
        {/* Edited from no recipe, or from one not in the list: its controls still have a home. */}
        {!detailShown &&
          (props.children || edited) &&
          (activeName ? (
            // From a recipe no longer in the list: its controls under its name.
            <div className="recipe-item on loose">
              <div className="recipe-loose-head">{`${activeName}${edited ? ' · edited' : ''}`}</div>
              {detail()}
            </div>
          ) : (
            // An edit of your own: not a recipe, so no card; just what applies to the whole edit.
            <div className="recipe-own">{props.children}</div>
          ))}
      </div>
      {rowMenu && (
        <div
          className="menu row-menu"
          role="menu"
          style={{ position: 'fixed', left: Math.min(rowMenu.x, window.innerWidth - 170), top: Math.min(rowMenu.y, window.innerHeight - 120) }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setRowMenu(null)
              props.onApplyPreset(rowMenu.preset)
            }}
          >
            Apply
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setRowMenu(null)
              setRenaming(rowMenu.preset.id)
            }}
          >
            Rename…
          </button>
          <button
            className="menu-item"
            role="menuitem"
            onClick={() => {
              setRowMenu(null)
              props.onDelete(rowMenu.preset.id)
            }}
          >
            Delete…
          </button>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => {
          props.onImport(e.target.files)
          e.target.value = ''
        }}
      />
    </>
  )
}
