import { createContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NewTag } from './WhatsNewDialog'
import type { SectionMaskProps } from './controls'
import { CategoryIcon } from './CategoryIcon'
import { ModuleGlyph } from './ModuleGlyph'
import { CATEGORIES, CATEGORY_BY_ID, MODULES, type CategoryId, type StackModuleId } from './moduleCatalog'
import { keyLabel } from './shortcuts'

/** What a Module needs from the panel's stack: to stay put when switched off, and to be taken off. */
export interface StackApi {
  pin: (id: StackModuleId) => void
  /** A switched-off module's control is being touched: its change switches it on. */
  wake: (id: StackModuleId) => void
  sleep: () => void
  /** A module's own controls are being used (null when let go): a change it makes to nothing keeps it switched on. */
  touch: (id: StackModuleId | null) => void
  /** An action in a switched-off module (Draw a streak, Draw glass area…): on now, and back off if it ends with nothing made. */
  startFrom: (id: StackModuleId) => void
  /** Whether the module is doing something to this photo: what its switch shows. */
  isOn: (id: StackModuleId) => boolean
  /** The switch: on starts it (as adding it does), off stops it; it stays where it is either way. */
  toggle: (id: StackModuleId) => 'setup' | void
  /** Its mask menu (SectionMaskMenu), for one that can be masked (MASKABLE). */
  maskFor: (id: StackModuleId) => SectionMaskProps
  /** Its presets menu (PartPresets), for one with presets (WITH_PRESETS). */
  presetsFor: (id: StackModuleId) => ReactNode
  /** Its settings back to how it starts (resetModule), as one step to undo. */
  reset: (id: StackModuleId) => void
  /** What it does to this photo, for its help (ModuleExample), or null where there is nothing to show. */
  example: (id: StackModuleId) => ReactNode
  /**
   * Copy settings and Paste settings, in its ⋯ menu, for a module whose
   * settings carry from photo to photo (not one of things placed on this
   * photo): `copied` names the photo its settings were copied from, if any.
   */
  settings: (id: StackModuleId) => { copy: () => void; paste: () => void; copied: string | null } | null
  /**
   * A page that lists modules from every category (In use, one of your
   * groups): its modules start folded, a list of what each is doing, and
   * each is folded or open there on its own, apart from its category page.
   */
  listView?: string
  /** What a module is doing, in a line (moduleSummary), for a header whose module gives none of its own. */
  summaryOf?: (id: StackModuleId) => string
}
export const StackContext = createContext<StackApi | null>(null)

/** A set of modules you made for quick access, like darktable's module groups. */
export interface ModuleGroup {
  id: string
  name: string
  colour: string
  modules: StackModuleId[]
}

/**
 * Which modules the panel shows, one choice down the rail beside them: the
 * ones this photo uses (active), every module (all), one category, or one of
 * your groups. Modules always sit in the order they are applied; the rail
 * only chooses which are in view.
 */
export type StackTab = 'active' | CategoryId | `group:${string}`

export const GROUP_COLOURS = ['#e48aa6', '#7fcdc4', '#f2a65e', '#a9c27a', '#9fb3c8', '#c9a0e8']

export const groupOf = (tab: StackTab, groups: ModuleGroup[]) =>
  tab.startsWith('group:') ? (groups.find((g) => `group:${g.id}` === tab) ?? null) : null

/** Whether a module belongs in a tab, used or not. */
export function inTab(id: StackModuleId, tab: StackTab, groups: ModuleGroup[]): boolean {
  if (tab === 'active') return true
  const group = groupOf(tab, groups)
  if (group) return group.modules.includes(id)
  return MODULES.find((m) => m.id === id)!.category === tab
}

/** The rail lists categories in the order they are applied, so it reads as the pipeline. */
const RAIL_CATEGORIES = CATEGORIES.filter((c) => c.id !== 'base')

interface RailProps {
  tab: StackTab
  onTab: (t: StackTab) => void
  groups: ModuleGroup[]
  /** How many modules of a category the photo uses. */
  usedIn: (c: CategoryId) => number
  activeCount: number
  onEditGroup: (id: string) => void
  /** Whether the export page is showing in place of the modules. */
  exporting: boolean
  onExport: () => void
  /** Whether the recipes page is showing in place of the modules. */
  recipes: boolean
  onRecipes: () => void
  /** The recipe the photo started from, for the tooltip. */
  recipeName: string | null
}

function RailButton({
  on,
  tint,
  name,
  label,
  hint,
  onClick,
  onContextMenu,
  children,
  className = '',
  used = false,
}: {
  on: boolean
  /** Something on this page is switched on: a dot in the corner. */
  used?: boolean
  tint: string
  name: string
  /** Under the icon: short, so the rail reads without hovering. */
  label: string
  hint: string
  onClick: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  children: React.ReactNode
  className?: string
}) {
  return (
    <button
      className={`rail-tab${on ? ' on' : ''}${used ? ' used' : ''} ${className}`}
      style={{ ['--tint' as string]: tint }}
      aria-label={name}
      aria-pressed={on}
      title={hint ? `${name}: ${hint}` : name}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className="rail-icon">{children}</span>
      <span className="rail-label">{label}</span>
    </button>
  )
}

const inUseText = (n: number) => (n ? `${n} in use` : 'none in use')

/** Down the edge of the modules: what this photo uses, each category in the order applied, then your groups if you made any. */
export function StackRail({ tab, onTab, groups, usedIn, activeCount, onEditGroup, exporting, onExport, recipes, onRecipes, recipeName }: RailProps) {
  const base = CATEGORY_BY_ID.base
  // A module tab is lit only while the modules are showing.
  const modulesShown = !exporting && !recipes
  return (
    <nav className="stack-rail" aria-label="Which modules to show">
      <RailButton
        on={recipes}
        tint="var(--accent)"
        name="Recipes"
        label="Recipes"
        hint={recipeName ? `starting points; this photo uses ${recipeName}` : 'starting points to begin from'}
        onClick={onRecipes}
      >
        <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden>
          <rect x="4.5" y="1.8" width="9" height="11" rx="1.4" fill="none" stroke="currentColor" strokeWidth="1.3" opacity="0.55" />
          <rect x="2.5" y="3.6" width="9" height="11" rx="1.4" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" />
          <path d="M5 7h4M5 9.6h4M5 12.2h2.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </RailButton>
      <span className="rail-sep" />
      <RailButton on={modulesShown && tab === 'active'} tint="var(--accent)" name="In use" label="In use" hint={`the modules turned on for this photo (${activeCount})`} onClick={() => onTab('active')}>
        <CategoryIcon tab="active" size={17} />
      </RailButton>
      <span className="rail-sep" />
      <RailButton on={modulesShown && tab === 'base'} tint={base.tint} name={base.label} label={base.short} hint={`correcting the photo's brightness and colour, before the look (a photo already edited needs little here); ${inUseText(usedIn('base'))}`} used={usedIn('base') > 0} className="base" onClick={() => onTab('base')}>
        <CategoryIcon tab="base" size={17} />
      </RailButton>
      {RAIL_CATEGORIES.map((c) => (
        <RailButton key={c.id} on={modulesShown && tab === c.id} tint={c.tint} name={c.label} label={c.short} hint={`${c.brief.toLowerCase()}; ${inUseText(usedIn(c.id))}`} used={usedIn(c.id) > 0} onClick={() => onTab(c.id)}>
          <CategoryIcon tab={c.id} size={17} />
        </RailButton>
      ))}
      {groups.length > 0 && <span className="rail-sep" />}
      {groups.map((g) => (
        <RailButton
          key={g.id}
          on={modulesShown && tab === `group:${g.id}`}
          tint={g.colour}
          name={g.name}
          label={g.name}
          hint={`your group of ${g.modules.length} module${g.modules.length === 1 ? '' : 's'}; right-click to edit`}
          onClick={() => onTab(`group:${g.id}`)}
          onContextMenu={(e) => {
            e.preventDefault()
            onEditGroup(g.id)
          }}
        >
          <span className="rail-letter" style={{ background: g.colour }}>
            {(g.name.trim()[0] ?? '?').toUpperCase()}
          </span>
        </RailButton>
      ))}
      <span className="rail-fill" />
      <span className="rail-sep" />
      <RailButton on={exporting} tint="var(--accent)" name="Export" label="Export" hint={`save the finished photo, or a whole batch (${keyLabel('cmd+e')})`} className="export" onClick={onExport}>
        <svg width="17" height="17" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 2v7.5M4.8 6.4 8 9.6l3.2-3.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M2.5 10.5v2.2c0 .7.5 1.3 1.3 1.3h8.4c.8 0 1.3-.6 1.3-1.3v-2.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </RailButton>
    </nav>
  )
}

interface TitleProps {
  tab: StackTab
  group: ModuleGroup | null
  /** Whether that group's editor is open under the title. */
  editing: boolean
  onEditGroup: (id: string) => void
  onNewGroup: () => void
  /** On a page listing modules from every category (In use, a group): fold them all. */
  onFoldAll?: () => void
}

/** Over the modules: the name of what is in view and what it is for. */
export function StackTitle({ tab, group, editing, onEditGroup, onNewGroup, onFoldAll }: TitleProps) {
  let name: string
  let tint: string
  if (tab === 'active') {
    name = 'In use'
    tint = 'var(--accent)'
  } else if (group) {
    name = group.name
    tint = group.colour
  } else {
    const c = CATEGORY_BY_ID[tab as CategoryId]
    name = c.label
    tint = c.tint
  }
  // Open modules' headers stick just under this title (styles: --stack-title-h).
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    const host = el?.parentElement
    if (!el || !host) return
    const set = () => host.style.setProperty('--stack-title-h', `${el.offsetHeight}px`)
    set()
    const watch = new ResizeObserver(set)
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  return (
    <div ref={ref} className="stack-title" style={{ ['--tint' as string]: tint }}>
      <div className="stack-title-row">
        <b>{name}</b>
        {group && !editing && (
          <button className="link" onClick={() => onEditGroup(group.id)}>
            Edit
          </button>
        )}
        {!group && (
          <button className="link quiet" title="Your own set of modules, shown on the rail" onClick={onNewGroup}>
            New group…
          </button>
        )}
        {onFoldAll && (
          <button className="link fold-all" title="Fold every module here, leaving the list of what each is doing" onClick={onFoldAll}>
            Fold all
          </button>
        )}
      </div>
    </div>
  )
}

interface AddProps {
  /** Whether each module is already in the panel. */
  shown: (id: StackModuleId) => boolean
  onAdd: (id: StackModuleId) => void
}

/** Closed, the tray is just its field. */
const TRAY_CLOSED = 46

/**
 * Add an effect: a field at the top of the modules, always there, and a
 * click on it slides the tray down over the panel, every module listed under
 * the field (in use or not, by category, with what each does), narrowed as
 * you type by what it does as well as its name ("blur", "frame", "date").
 * Picking one adds it, or goes to it if it is in use. Esc, a pick, or a click
 * elsewhere closes it.
 */
export function StackAdd({ shown, onAdd }: AddProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [height, setHeight] = useState(TRAY_CLOSED)
  const root = useRef<HTMLElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const found = useMemo(
    () => (q ? MODULES.filter((m) => `${m.title} ${m.blurb} ${m.keywords} ${CATEGORY_BY_ID[m.category].label}`.toLowerCase().includes(q)) : MODULES),
    [q],
  )
  // By category, in the rail's order, the base photo's corrections last.
  const cats = [...RAIL_CATEGORIES, CATEGORY_BY_ID.base]
  const groups = cats.map((c) => ({ c, mods: found.filter((m) => m.category === c.id) })).filter((g) => g.mods.length)
  const first = groups[0]?.mods[0]
  const openTray = () => {
    if (open) return
    // Up to most of the panel's height, whatever it is now.
    const body = root.current?.closest('.panel-body') as HTMLElement | null
    setHeight(Math.max(220, Math.round((body?.clientHeight ?? 600) * 0.72)))
    setOpen(true)
  }
  const close = () => {
    setOpen(false)
    setQuery('')
    input.current?.blur()
  }
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => !root.current?.contains(e.target as Node) && close()
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])
  const pick = (id: StackModuleId) => {
    close()
    onAdd(id)
  }
  return (
    <section className={`stack-tray${open ? ' open' : ''}`} ref={root} aria-label="Add an effect">
      <div className="stack-tray-sheet" style={{ height: open ? height : TRAY_CLOSED }}>
        <div className="stack-tray-head">
        <label className="search-field">
          {open ? (
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
              <circle cx="7" cy="7" r="4.6" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 16 16" aria-hidden>
              <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          )}
          <input
            ref={input}
            type="text"
            className="stack-search"
            aria-label="Add an effect"
            aria-expanded={open}
            placeholder={open ? 'Search: grain, blur, frame…' : 'Add an effect'}
            value={query}
            onFocus={openTray}
            onPointerDown={openTray}
            onChange={(e) => {
              openTray()
              setQuery(e.target.value)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Escape') close()
              if (e.key === 'Enter' && first) pick(first.id)
            }}
          />
        </label>
        {/* Outside the label: a click on it would focus the field, and open the tray again. */}
        {open && (
          <button
            className="link stack-tray-close"
            title="Close (Esc)"
            onMouseDown={(e) => e.preventDefault()}
            onClick={close}
          >
            Close
          </button>
        )}
        </div>
        <div className="stack-tray-list" aria-hidden={!open}>
          {groups.map(({ c, mods }) => (
            <div key={c.id} className="stack-tray-group">
              <span className="grid-cat" title={c.hint}>
                <i style={{ background: c.tint }} />
                {c.label}
              </span>
              {mods.map((m) => {
                const here = shown(m.id)
                return (
                  <button key={m.id} className={`stack-result${m === first ? ' first' : ''}`} tabIndex={open ? 0 : -1} onClick={() => pick(m.id)} title={here ? `${m.title} is in use: go to it` : `Add ${m.title.toLowerCase()}`}>
                    <ModuleGlyph id={m.id} tint={c.tint} size={13} />
                    <b>
                      {m.title}
                      <NewTag id={m.id} />
                    </b>
                    <small>{here ? 'In use' : m.blurb}</small>
                  </button>
                )
              })}
            </div>
          ))}
          {!groups.length && <p className="hint-line">Nothing does that yet.</p>}
        </div>
      </div>
    </section>
  )
}

interface SlimProps {
  id: StackModuleId
  order: number
  onAdd: (id: StackModuleId) => void
}

/** A module not in use, in its place: its name and what it does, one click from added. */
export function SlimModule({ id, order, onAdd }: SlimProps) {
  const m = MODULES.find((x) => x.id === id)!
  const c = CATEGORY_BY_ID[m.category]
  return (
    <button className="module-slim" style={{ order }} title={`Add ${m.title.toLowerCase()} to this photo`} onClick={() => onAdd(id)}>
      <ModuleGlyph id={id} tint={c.tint} size={14} />
      <b>
        {m.title}
        <NewTag id={id} />
      </b>
      <small>{m.blurb}</small>
      <span className="slim-add">+</span>
    </button>
  )
}

interface GroupEditorProps {
  group: ModuleGroup
  onChange: (g: ModuleGroup) => void
  onDelete: () => void
  onDone: () => void
}

/** Making or changing a group: its name, its colour and which modules are in it. */
export function GroupEditor({ group, onChange, onDelete, onDone }: GroupEditorProps) {
  const name = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!group.modules.length) name.current?.select()
  }, [group.id])
  const toggle = (id: StackModuleId, on: boolean) =>
    onChange({ ...group, modules: on ? [...group.modules, id] : group.modules.filter((x) => x !== id) })
  return (
    <section className="group-editor" aria-label={`Edit ${group.name}`}>
      <div className="group-editor-head">
        <input
          ref={name}
          type="text"
          className="group-name"
          value={group.name}
          aria-label="Group name"
          onChange={(e) => onChange({ ...group, name: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter' || e.key === 'Escape') name.current?.blur()
          }}
        />
        <div className="group-colours" role="radiogroup" aria-label="Colour">
          {GROUP_COLOURS.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={group.colour === c}
              aria-label={c}
              className={group.colour === c ? 'on' : ''}
              style={{ background: c }}
              onClick={() => onChange({ ...group, colour: c })}
            />
          ))}
        </div>
      </div>
      <div className="group-checks">
        {CATEGORIES.map((c) => (
          <div key={c.id} className="group-cat">
            <span className="grid-cat">
              <i style={{ background: c.tint }} />
              {c.label}
            </span>
            {MODULES.filter((m) => m.category === c.id).map((m) => (
              <label key={m.id} className="check-row" title={m.blurb}>
                <input type="checkbox" checked={group.modules.includes(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
                {m.title}
              </label>
            ))}
          </div>
        ))}
      </div>
      <div className="group-editor-foot">
        <button className="link danger" onClick={onDelete}>
          Delete group
        </button>
        <button className="primary" onClick={onDone}>
          Done
        </button>
      </div>
    </section>
  )
}
