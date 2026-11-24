import type { ComponentProps } from 'react'
import type { BlendParams } from '../engine/types'
import { hasPlaced, keepOwn } from '../storage/parts'
import { DEFAULT_OUTPUT, PRESET_SCHEMA_VERSION, type PresetDoc, type StoredPreset } from '../storage/presets'
import type { GrainSource } from '../sources/GrainSource'
import { Disclosure } from './controls'
import { LookPicker } from './LookPicker'
import { LISTED_LOOKS, NONE_LOOK, suggestedLooks, type Look } from './looks'
import type { Palette } from '../engine/palette'
import { MODULES, inUse, type StackModuleId } from './moduleCatalog'
import { RecipeContents } from './RecipeContents'
import { RecipeColoursRow } from './RecipeColoursRow'
import { RECIPE_COLOURS, coloursOf, withColours } from './recipeColours'
import { usePanelPage } from './state/layout'

type PickerProps = ComponentProps<typeof LookPicker>

interface Props {
  presets: StoredPreset[]
  activeLook: Look | null
  activePresetId: string
  /** The look or saved preset the settings came from, as it was designed or saved. */
  activeDoc: PresetDoc | null
  /** The settings no longer match it. */
  lookEdited: boolean
  source: GrainSource | null
  blend: BlendParams
  setBlend: (blend: BlendParams) => void
  image: { bitmap: ImageBitmap; seed: number } | null
  /** The open photo's own colours, for the recipes suggested for it. */
  palette?: Palette
  applyLook: PickerProps['onApplyLook']
  setRecipeHover: PickerProps['onHover']
  applyPreset: PickerProps['onApplyPreset']
  onSavePreset: (name: string, existingId?: string, includePlaced?: boolean) => Promise<void>
  onUpdatePreset: () => void
  onRenamePreset: (name: string, id?: string) => Promise<void>
  onExportPreset: () => void
  onImportPreset: PickerProps['onImport']
  onDeletePreset: (id?: string) => Promise<void>
  onDescribePreset: (description: string) => Promise<void>
  startFresh: (step: string) => Promise<void>
  addModule: (id: StackModuleId) => void
  onMix: PickerProps['onMix']
  mixed: PickerProps['mixed']
  changedParts?: PickerProps['changedParts']
}

/** The right panel's Recipes page: the recipes, what the one in use holds and how strong. */
export function RecipesPage({
  presets,
  activeLook,
  activePresetId,
  activeDoc,
  lookEdited,
  source,
  blend,
  setBlend,
  image,
  palette,
  applyLook,
  setRecipeHover,
  applyPreset,
  onSavePreset,
  onUpdatePreset,
  onRenamePreset,
  onExportPreset,
  onImportPreset,
  onDeletePreset,
  onDescribePreset,
  startFresh,
  addModule,
  onMix,
  mixed,
  changedParts,
}: Props) {
  const panelPage = usePanelPage()
  // The modules the recipe card lists.
  const recipeParts = MODULES.filter((m) => m.id !== 'border' && inUse(m.id, blend)).length
  // The recipe as designed, in the Colours set the edit is in: picking colours isn't changing the recipe.
  const set = RECIPE_COLOURS.find((c) => c.id === coloursOf(blend))
  const inSet = (b: BlendParams) => (set ? withColours(b, set) : b)
  return (
    <section className="recipes-page" hidden={panelPage !== 'recipes'}>
      <div className="stack-title" style={{ ['--tint' as string]: 'var(--accent)' }}>
        <div className="stack-title-row">
          <b>Recipes</b>
        </div>
      </div>
      <div className="module-body">
      <LookPicker
        // A retired recipe still shows while it is the one in use (an edit made with it).
        looks={[NONE_LOOK, ...LISTED_LOOKS, ...(activeLook?.retired ? [activeLook] : [])]}
        presets={presets}
        activeLookId={activeLook?.id ?? null}
        activePresetId={activePresetId}
        edited={lookEdited}
        canSave={!!source}
        onApplyLook={applyLook}
        onHover={setRecipeHover}
        onApplyPreset={applyPreset}
        hasPlaced={hasPlaced(blend)}
        onSaveNew={(name, include) => void onSavePreset(name, undefined, include)}
        onUpdate={onUpdatePreset}
        onRename={(name, id) => void onRenamePreset(name, id)}
        onExport={onExportPreset}
        onImport={onImportPreset}
        onDelete={(id) => void onDeletePreset(id)}
        onStartOver={() => void startFresh('starting over')}
        description={activePresetId ? (presets.find((p) => p.id === activePresetId)?.data.description ?? null) : (activeLook?.hint ?? null)}
        onDescribe={activePresetId ? (text) => void onDescribePreset(text) : undefined}
        photo={image ? { bitmap: image.bitmap, seed: image.seed } : null}
        paramsFor={(doc) => keepOwn(blend, doc.blend, doc.placed)}
        onMix={onMix}
        mixed={mixed}
        changedParts={changedParts}
        suggested={image && palette ? suggestedLooks(LISTED_LOOKS, palette) : undefined}
        colourName={set?.name ?? null}
        contents={(doc, active) =>
          active ? (
            <RecipeContents blend={blend} recipe={keepOwn(blend, inSet(doc.blend), doc.placed)} designed={inSet(doc.blend)} onGo={addModule} />
          ) : (
            <RecipeContents blend={doc.blend} recipe={null} onGo={addModule} empty="Nothing in it: the photo as it is." />
          )
        }
      >
      {/* The recipe in use in other colours: only the gradient map changes. */}
      {image && (
        <RecipeColoursRow
          blend={blend}
          setBlend={setBlend}
          palette={palette}
          onPreview={(c) =>
            setRecipeHover?.(
              c && source
                ? {
                    key: `colours:${c.id}:${JSON.stringify(c.blend.effects.grade)}`,
                    name: c.name,
                    doc: { schemaVersion: PRESET_SCHEMA_VERSION, name: c.name, grainSource: source.serialize(), blend: c.blend, output: DEFAULT_OUTPUT },
                  }
                : null,
            )
          }
        />
      )}
      {/* An edit of your own: what is changed from the photo as it came. (A recipe's contents open under its row.) */}
      {!activeDoc && recipeParts > 0 && (
        <Disclosure id="edit-contents" defaultOpen title="What you changed" summary={`${recipeParts} module${recipeParts === 1 ? '' : 's'}`}>
          <RecipeContents blend={blend} recipe={null} onGo={addModule} />
        </Disclosure>
      )}
      </LookPicker>
                      </div>
    </section>
  )
}
