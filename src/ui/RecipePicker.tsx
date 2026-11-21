import { useEffect, useState } from 'react'
import type { Palette } from '../engine/palette'
import { MAX_RICHNESS, RECIPE_FROM, ruleColours, sameRule, type ColourRule } from '../engine/recipe'
import type { GradeParams, Rgb } from '../engine/types'
import { confirmWith } from '../platform/native'
import { deleteRecipe, listRecipes, lookOf, saveRecipe, type ColourRecipe } from '../storage/recipes'
import { Slider } from './controls'
import { NameField } from './NameField'
import { track } from '../platform/usage'

interface Props {
  grade: GradeParams
  palette: Palette
  /** Whether a photo is open: recipes are shown in its colours. */
  hasImage: boolean
  /** Sets grade settings, one undo step. */
  onApply: (patch: Partial<GradeParams>, label: string) => void
  onPreview: (patch: Partial<GradeParams> | null) => void
  onStatus: (message: string) => void
}

const css = (c: Rgb) => `rgb(${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255)).join(',')})`
const hex = (c: Rgb) => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`
const fromHex = (h: string): Rgb => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb

/** The grade settings a rule sets on this photo: the rule itself, and the colours it comes to here. */
export function rulePatch(rule: ColourRule, palette: Palette): Partial<GradeParams> {
  const [s, m, h] = ruleColours(rule, palette)
  return {
    recipe: rule,
    mapHarmony: rule.harmony,
    mapShadow: { source: 'manual', colour: s },
    mapMid: { source: 'manual', colour: m },
    mapHigh: { source: 'manual', colour: h },
  }
}

const recipePatch = (r: ColourRecipe, palette: Palette): Partial<GradeParams> => ({ ...r.look, ...rulePatch(r.rule, palette) })

/** The recipes, kept in step wherever they are shown: saving or deleting one refreshes them all. */
export function useRecipes(): ColourRecipe[] {
  const [recipes, setRecipes] = useState<ColourRecipe[]>([])
  useEffect(() => {
    const load = () => void listRecipes().then(setRecipes)
    load()
    window.addEventListener('grain:recipes', load)
    return () => window.removeEventListener('grain:recipes', load)
  }, [])
  return recipes
}
const recipesChanged = () => window.dispatchEvent(new Event('grain:recipes'))

const LEADS: { id: 0 | 1 | 2; label: string }[] = [
  { id: 0, label: 'Shadows' },
  { id: 1, label: 'Midtones' },
  { id: 2, label: 'Light' },
]

/**
 * Colour recipes: palettes built from the photo's own colours. Each card is
 * shown in this photo's colours; point to preview, click to use.
 */
export function RecipeGrid({ grade, palette, hasImage, onApply, onPreview, onStatus, compact }: Props & { compact?: boolean }) {
  const recipes = useRecipes()
  const active = grade.recipe ? recipes.find((r) => sameRule(r.rule, grade.recipe)) : undefined
  const remove = async (r: ColourRecipe) => {
    if (!(await confirmWith(`Delete the palette “${r.name}”?`))) return
    await deleteRecipe(r.id)
    recipesChanged()
    onStatus(`Deleted the palette “${r.name}”.`)
  }
  return (
    <div className={`palette-grid${compact ? ' compact' : ''}`} onPointerLeave={() => onPreview(null)}>
      {recipes.map((r) => {
        const cols = ruleColours(r.rule, palette)
        const on = active?.id === r.id
        return (
          <div key={r.id} className={`palette-card${on ? ' on' : ''}`}>
            <button
              className="palette-pick"
              title={`${r.hint ?? r.name}${hasImage ? '' : ' (shown in neutral colours: open a photo to see it in its own)'}. Point to preview.`}
              onPointerEnter={() => onPreview(recipePatch(r, palette))}
              onClick={() => {
                onPreview(null)
                track('palette', r.builtIn ? r.name : 'own')
                onApply(recipePatch(r, palette), `the ${r.name} palette`)
              }}
            >
              <span className="palette-ramp" style={{ background: `linear-gradient(90deg, ${cols.map(css).join(', ')})` }} />
              <span className="palette-name">{r.name}</span>
            </button>
            {!r.builtIn && (
              <button className="palette-del" title={`Delete “${r.name}”`} aria-label={`Delete ${r.name}`} onClick={() => void remove(r)}>
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/** The name of the recipe in use, or undefined when the palette is set by hand. */
export function useRecipeName(grade: GradeParams): string | undefined {
  const recipes = useRecipes()
  if (!grade.recipe) return undefined
  return recipes.find((r) => sameRule(r.rule, grade.recipe))?.name ?? 'Your palette'
}

/**
 * The recipe in use, reshaped: where its colour comes from, which tones it
 * leads, how far it is turned and how rich it is. Kept as a recipe of your
 * own, it builds its colours afresh on each photo.
 */
export function RecipeEditor({ grade, palette, onApply, onStatus }: Omit<Props, 'hasImage' | 'onPreview'>) {
  const [naming, setNaming] = useState(false)
  const rule = grade.recipe
  if (!rule) return null
  const setRule = (patch: Partial<ColourRule>, label: string) => onApply(rulePatch({ ...rule, ...patch }, palette), label)
  return (
    <div className="recipe-rule">
      <div className="recipe-row">
        <span title="Which of the photo's colours the palette is built from">Built from</span>
        <div className="recipe-chips">
          {RECIPE_FROM.map((f) => {
            const c = f.id === 'fixed' ? (rule.fixed ?? [1, 0.6, 0.35]) : palette[f.id]
            return (
              <button
                key={f.id}
                className={`swatch-btn${rule.from === f.id ? ' on' : ''}`}
                title={f.hint}
                onClick={() => setRule({ from: f.id, ...(f.id === 'fixed' && !rule.fixed ? { fixed: c } : {}) }, 'where the palette’s colour comes from')}
              >
                <i style={{ background: css(c) }} />
                {f.label}
              </button>
            )
          })}
          {rule.from === 'fixed' && (
            <input
              type="color"
              className="recipe-fixed"
              title="The fixed colour"
              value={hex(rule.fixed ?? [1, 0.6, 0.35])}
              onChange={(e) => setRule({ fixed: fromHex(e.target.value) }, 'the palette’s colour')}
            />
          )}
        </div>
      </div>
      <div className="field valued">
        <span title="Which tones the photo's colour goes on; the others follow from it">Goes on</span>
        <div className="segmented">
          {LEADS.map((l) => (
            <button key={l.id} className={rule.lead === l.id ? 'on' : ''} onClick={() => setRule({ lead: l.id }, 'where the palette leads')}>
              {l.label}
            </button>
          ))}
        </div>
      </div>
      <Slider
        label="Turn"
        title="Turns the photo's colour round the wheel before the palette is built from it"
        value={rule.turn}
        min={-0.5}
        max={0.5}
        step={1 / 360}
        format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 360)}°`}
        onChange={(turn) => setRule({ turn }, 'the palette’s turn')}
      />
      <Slider
        label="Richness"
        title="How deep the palette's colours are"
        value={rule.richness}
        min={0}
        max={MAX_RICHNESS}
        step={0.01}
        onChange={(richness) => setRule({ richness }, 'the palette’s richness')}
      />
      <div className="recipe-save">
        {naming ? (
          <NameField
            label="Palette name"
            placeholder="Palette name"
            className="name-field small"
            onDone={async (name) => {
              setNaming(false)
              if (!name) return
              const saved = await saveRecipe(name, rule, lookOf(grade))
              recipesChanged()
              onStatus(`Saved the palette “${saved.name}”. It builds its colours from each photo it is used on.`)
            }}
          />
        ) : (
          <button title="Keep this palette: where its colours come from and how strongly it is laid on" onClick={() => setNaming(true)}>
            Save as recipe…
          </button>
        )}
      </div>
    </div>
  )
}
