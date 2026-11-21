import { useContext, useEffect, useRef, useState } from 'react'
import { ModuleMenuContext } from './controls'
import { confirmWith } from '../platform/native'
import { NameField } from './NameField'
import {
  PART_LABELS,
  deletePart,
  listParts,
  savePart,
  type PartData,
  type PartKind,
  type StoredPart,
} from '../storage/parts'

/** A recipe's settings for this section: a recipe that uses it. */
export interface RecipePart {
  id: string
  name: string
  data: PartData
}

interface Props {
  kind: PartKind
  /** The current settings of this section, for saving. */
  current: () => PartData
  onApply: (part: StoredPart, step?: string) => void
  onStatus: (message: string) => void
  /** The recipes that use this section, each with its settings for it (read when the list opens). */
  fromRecipes?: () => RecipePart[]
}

/**
 * A section's own presets, in a menu in its header: the built-in ones
 * (storage/partBuiltins.ts), then yours, each of yours with its own rename
 * and delete. Pick one to apply just this section, as it is; save the
 * section as a new preset, or save changes to the one of yours it came
 * from. Nothing outside the section is read or written. In a module's ⋯
 * menu, it is that menu's first items instead of a menu of its own.
 */
export function PartPresets({ kind, current, onApply, onStatus, fromRecipes }: Props) {
  const [parts, setParts] = useState<StoredPart[]>([])
  const [activeId, setActiveId] = useState('')
  const [open, setOpen] = useState(false)
  // Typing a name in the menu: for a new preset, or a new name for one of yours (its id).
  const [naming, setNaming] = useState<'new' | string | null>(null)
  // The recipes' settings for this section, listed in place of the presets while open.
  const [recipes, setRecipes] = useState<RecipePart[] | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const label = PART_LABELS[kind]
  const inMenu = useContext(ModuleMenuContext)

  const refresh = () => listParts(kind).then(setParts)
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind])

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return
      setOpen(false)
      setNaming(null)
      setRecipes(null)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const active = parts.find((p) => p.id === activeId)
  const mine = active && !active.builtIn ? active : undefined
  const builtIns = parts.filter((p) => p.builtIn)
  const yours = parts.filter((p) => !p.builtIn)
  const close = () => {
    setOpen(false)
    setNaming(null)
    setRecipes(null)
    inMenu?.close()
  }

  const save = async (name: string, existing?: StoredPart) => {
    const saved = await savePart(kind, name, current(), existing?.id)
    await refresh()
    setActiveId(saved.id)
    onStatus(existing ? `Updated ${label} “${name}”.` : `Saved ${label} “${name}”.`)
  }
  const rename = async (id: string, name: string) => {
    const p = parts.find((q) => q.id === id)
    if (!p) return
    await savePart(kind, name, p.data, p.id)
    await refresh()
    onStatus(`Renamed ${label} preset to “${name}”.`)
  }
  const remove = async (p: StoredPart) => {
    if (!(await confirmWith(`Delete the ${label} preset “${p.name}”?`))) return
    await deletePart(p.id)
    if (activeId === p.id) setActiveId('')
    await refresh()
  }

  const apply = (p: StoredPart) => (
    <button
      role="menuitem"
      className={`menu-item${p.id === activeId ? ' current' : ''}`}
      onClick={() => {
        setActiveId(p.id)
        onApply(p)
        onStatus(`Applied ${label} “${p.name}”.`)
        close()
      }}
    >
      {p.name}
    </button>
  )
  // Yours: its name to apply it, then rename and delete, always shown.
  const yourRow = (p: StoredPart) =>
    naming === p.id ? (
      <NameField
        key={p.id}
        label={`Rename the ${label} preset “${p.name}”`}
        placeholder="Name, then Enter"
        initial={p.name}
        onDone={(name) => {
          setNaming(null)
          if (name) void rename(p.id, name)
        }}
      />
    ) : (
      <div key={p.id} className="preset-row">
        {apply(p)}
        <button className="preset-row-tool" title={`Rename “${p.name}”`} aria-label={`Rename ${p.name}`} onClick={() => setNaming(p.id)}>
          <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
            <path d="M3 13l1-3.5 7-7 2.5 2.5-7 7z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        </button>
        <button className="preset-row-tool" title={`Delete “${p.name}”`} aria-label={`Delete ${p.name}`} onClick={() => void remove(p)}>
          ×
        </button>
      </div>
    )

  // A recipe's settings for this section: its name applies them; + keeps them as one of yours.
  const recipeRow = (r: RecipePart) => (
    <div key={r.id} className="preset-row">
      <button
        role="menuitem"
        className="menu-item"
        title={`Set the ${label} as the recipe “${r.name}” has it; nothing else changes`}
        onClick={() => {
          onApply({ id: r.id, kind, name: r.name, data: r.data, builtIn: true, updatedAt: 0 }, `the ${label} from the recipe “${r.name}”`)
          setActiveId('')
          onStatus(`Set the ${label} from the recipe “${r.name}”.`)
          close()
        }}
      >
        {r.name}
      </button>
      <button
        className="preset-row-tool"
        title={`Save the ${label} from “${r.name}” as one of your ${label} presets`}
        aria-label={`Save ${r.name} as a preset`}
        onClick={() => {
          void savePart(kind, r.name, r.data).then(async (saved) => {
            await refresh()
            setRecipes(null)
            onStatus(`Saved ${label} “${saved.name}” from the recipe.`)
          })
        }}
      >
        +
      </button>
    </div>
  )
  const recipeItems = recipes && (
    <>
      <button role="menuitem" className="menu-item menu-back" onClick={() => setRecipes(null)}>
        ‹ {inMenu ? 'Presets' : 'Back'}
      </button>
      <div className="menu-label">The {label} in recipes</div>
      {recipes.length ? recipes.map(recipeRow) : <p className="menu-empty">No recipe uses the {label}.</p>}
    </>
  )

  // The menu's items: its presets, yours, and saving.
  const items = recipeItems || (
    <>
      {builtIns.length > 0 && (
        <>
          <div className="menu-label">{inMenu ? 'Built-in presets' : 'Built-in'}</div>
          {builtIns.map((p) => (
            <div key={p.id} className="preset-row">
              {apply(p)}
            </div>
          ))}
        </>
      )}
      <div className="menu-label">{inMenu ? 'Your presets' : 'Yours'}</div>
      {yours.length ? yours.map(yourRow) : <p className="menu-empty">None saved yet.</p>}
      {fromRecipes && (
        <button
          role="menuitem"
          className="menu-item"
          title={`The ${label} as each recipe has it: set it from one, or keep it as a preset of yours`}
          onClick={() => {
            setNaming(null)
            setRecipes(fromRecipes())
          }}
        >
          From a recipe…
        </button>
      )}
      <div className="menu-rule" />
      {naming === 'new' ? (
        <NameField
          label={`Name for the new ${label} preset`}
          placeholder="Name, then Enter"
          initial=""
          onDone={(name) => {
            setNaming(null)
            if (name) void save(name)
          }}
        />
      ) : (
        <button role="menuitem" className="menu-item" onClick={() => setNaming('new')}>
          Save as new preset…
        </button>
      )}
      {mine && naming !== 'new' && (
        <button
          role="menuitem"
          className="menu-item"
          title={`Save the ${label} as it is now into “${mine.name}”`}
          onClick={() => {
            void save(mine.name, mine)
            close()
          }}
        >
          Save changes to “{mine.name}”
        </button>
      )}
    </>
  )
  if (inMenu) return items

  return (
    <div className="menu-anchor preset-anchor" ref={menuRef}>
      <button
        className={`section-presets${open ? ' open' : ''}`}
        title={`${label[0].toUpperCase()}${label.slice(1)} presets: apply one to change only the ${label}, or save it as it is now`}
        aria-label={`${label} presets`}
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
          <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="5" cy="4" r="1.9" fill="currentColor" />
          <circle cx="11" cy="8" r="1.9" fill="currentColor" />
          <circle cx="7" cy="12" r="1.9" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className="menu preset-menu" role="menu">
          {items}
        </div>
      )}
    </div>
  )
}
