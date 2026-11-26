import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { Harmony, Trio } from '../../engine/harmony'
import type { Palette } from '../../engine/palette'
import { stockById, STOCKS } from '../../engine/stocks'
import type { BlendParams, ColourChoice, GradeParams, Rgb, StockParams } from '../../engine/types'
import type { GrainTexture } from '../../sources/GrainSource'
import { ColourField } from '../ColourField'
import { PaletteWheel } from '../PaletteWheel'
import { RecipeEditor, RecipeGrid } from '../RecipePicker'
import { Disclosure, Module, percent, Slider, TRACKS } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'
import type { PaletteFit } from '../paletteFit'
import { SAMPLE_FOR, signed } from './shared'
import { ColourPicks } from './ColourPicks'

const POP_SWATCHES: { label: string; colour: Rgb }[] = [
  { label: 'Ember', colour: [1, 0.42, 0.12] },
  { label: 'Gold', colour: [1, 0.72, 0.2] },
  { label: 'Red', colour: [0.9, 0.12, 0.12] },
  { label: 'Magenta', colour: [0.9, 0.2, 0.6] },
  { label: 'Teal', colour: [0.1, 0.65, 0.7] },
]

const REST_SWATCHES: { label: string; colour: Rgb }[] = [
  { label: 'Graphite', colour: [0.5, 0.5, 0.5] },
  { label: 'Silver', colour: [0.42, 0.5, 0.62] },
  { label: 'Teal', colour: [0.25, 0.5, 0.55] },
  { label: 'Navy', colour: [0.25, 0.3, 0.6] },
  { label: 'Sepia', colour: [0.62, 0.5, 0.38] },
]

const SHADOW_SWATCHES: { label: string; colour: Rgb }[] = [
  { label: 'Navy', colour: [0.2, 0.3, 0.75] },
  { label: 'Teal', colour: [0.1, 0.5, 0.55] },
  { label: 'Violet', colour: [0.45, 0.25, 0.7] },
]

const LIGHT_SWATCHES: { label: string; colour: Rgb }[] = [
  { label: 'Amber', colour: [1, 0.7, 0.4] },
  { label: 'Rose', colour: [1, 0.6, 0.65] },
  { label: 'Cream', colour: [1, 0.92, 0.75] },
]

interface Props {
  grade: GradeParams
  palette: Palette
  image: LoadedImage | null
  applyRecipe: (patch: Partial<GradeParams>, label: string) => void
  setPreviewGrade: Dispatch<SetStateAction<Partial<GradeParams> | null>>
  setStatus: Dispatch<SetStateAction<string | null>>
  recipeName: string | undefined
  offWheel: string[]
  grain: GrainTexture | null
  setPreviewBlend: Dispatch<SetStateAction<BlendParams | null>>
  fitNow: () => PaletteFit | null
  history: EditHistory
  setBlend: (next: SetStateAction<BlendParams>) => void
  shownColour: (c: ColourChoice) => Rgb
  wheelShown: GradeParams
  onWheel: (colours: Trio<Rgb>, mapHarmony: Harmony) => void
  setGrade: (patch: Partial<GradeParams>) => void
  blend: BlendParams
  setStock: (patch: Partial<StockParams>) => void
}

/** Colour: grading with a palette from the photo or set by hand, a film stock, tints and pop. */
export function ColourModule({ grade, palette, image, applyRecipe, setPreviewGrade, setStatus, recipeName, offWheel, grain, setPreviewBlend, fitNow, history, setBlend, shownColour, wheelShown, onWheel, setGrade, blend, setStock }: Props) {
  // What is set under More colour, so it shows instead of hiding in a fold.
  const moreSet = [
    grade.popAmount > 0 && 'Pop',
    grade.isolateAmount > 0 && 'Rest faded',
    grade.shadowAmount > 0 && 'Shadow tint',
    grade.highlightAmount > 0 && 'Light tint',
  ].filter((x): x is string => !!x)
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null)
  return (
    <Module
      id="colour"
      title="Colour"
      summary={grade.recipe ? 'Palette' : grade.mapAmount > 0 ? `Palette ${percent(grade.mapAmount)}` : undefined}
    >
      <div className="colour-group">
        <h3 title="A gradient map: the three colours the picture is recoloured through, by brightness: shadows, midtones, light">
          Gradient map
          <span className="muted">{grade.mapAmount <= 0 ? ' · off' : recipeName ? ` · ${recipeName}` : ' · set by hand'}</span>
        </h3>
        {grade.mapAmount > 0 ? (
          <>
            {offWheel.length > 0 && (
              <div className="palette-note">
                <span>
                  Also coloured by the {offWheel.join(', ').replace(/, ([^,]*)$/, ' and $1')}
                </span>
                {image && grain && (
                  <button
                    className="link"
                    title="Work out that colour as a palette, so the wheel shows and edits all of it. Point to preview."
                    onPointerEnter={() => setPreviewBlend(fitNow()?.blend ?? null)}
                    onPointerLeave={() => setPreviewBlend(null)}
                    onClick={() => {
                      const fit = fitNow()
                      setPreviewBlend(null)
                      if (!fit) return
                      history.hint(`${WHOLE_STEP}the colour onto the palette`)
                      setBlend(fit.blend)
                    }}
                  >
                    Move it onto the palette
                  </button>
                )}
              </div>
            )}
            <div>
              <PaletteWheel
                colours={[shownColour(wheelShown.mapShadow), shownColour(wheelShown.mapMid), shownColour(wheelShown.mapHigh)]}
                harmony={grade.mapHarmony}
                balance={grade.mapBalance}
                contrast={grade.mapContrast}
                onChange={onWheel}
              />
            </div>
          </>
        ) : null}
        <Slider
          label="Strength"
          title="How much of the photo's own colour the palette replaces. 0 is off."
          value={grade.mapAmount} def={FACTORY.effects.grade.mapAmount}
          min={0}
          max={1}
          step={0.01}
          onChange={(mapAmount) => setGrade({ mapAmount })}
        />
        {grade.mapAmount > 0 && (
          <>
            <Slider
              label="Contrast"
              title="Pulls the tones apart (or draws them together) along with the palette: deeper shadows, brighter light"
              value={grade.mapContrast} def={FACTORY.effects.grade.mapContrast}
              min={-1}
              max={1}
              step={0.01}
              format={signed}
              onChange={(mapContrast) => setGrade({ mapContrast })}
            />
            <Slider
              label="Balance"
              title="Where the midtone colour sits: toward the shadows, so more of the picture takes the light colour, or toward the light"
              value={grade.mapBalance} def={FACTORY.effects.grade.mapBalance}
              min={-1}
              max={1}
              step={0.01}
              format={signed}
              onChange={(mapBalance) => setGrade({ mapBalance })}
            />
            {grade.recipe && (
              <Disclosure id="colour-recipe" title="Palette settings" summary="Where its colours come from">
                <RecipeEditor grade={grade} palette={palette} onApply={applyRecipe} onStatus={setStatus} />
              </Disclosure>
            )}
          </>
        )}
      </div>
      <ColourPicks picks={grade.picks ?? []} palette={palette} setBlend={setBlend} />
      <div className="colour-group">
        <h3 title="Palettes built from the photo's own colours: each one comes out differently on every photo. Point to preview, click to use.">Other palettes from the photo</h3>
        <RecipeGrid
          compact
          grade={grade}
          palette={palette}
          hasImage={!!image}
          onApply={applyRecipe}
          onPreview={setPreviewGrade}
          onStatus={setStatus}
        />
      </div>
      <div className="colour-group">
        <h3 title="On everything above, the palette included: the picture's colour as it now is">Overall</h3>
        <Slider
          track={TRACKS.colour}
          label="Vibrance"
          title="More or less colour, the palette's included. Up, the muted colours gain most and rich ones stay as they are. Down, the dullest lose most and the most vivid least, so the strongest still stand out."
          value={grade.vibrance} def={FACTORY.effects.grade.vibrance}
          min={-1}
          max={1}
          step={0.01}
          format={signed}
          onChange={(vibrance) => setGrade({ vibrance })}
        />
        <Slider
          track={TRACKS.warmth}
          label="Warmth"
          title="Blue to amber, on everything above, the palette included. Keeps brightness."
          value={grade.warmth} def={FACTORY.effects.grade.warmth}
          min={-1}
          max={1}
          step={0.01}
          format={signed}
          onChange={(warmth) => setGrade({ warmth })}
        />
        <Slider
          track={TRACKS.tint}
          label="Tint"
          title="Green to magenta, on everything above, the palette included. Keeps brightness."
          value={grade.tint} def={FACTORY.effects.grade.tint}
          min={-1}
          max={1}
          step={0.01}
          format={signed}
          onChange={(tint) => setGrade({ tint })}
        />
      </div>
      <div className="colour-group">
        <h3 title="The colour response of a real film, laid over the photo">
          Film stock
          <span className="muted"> · {stockById(blend.effects.stock.id).label}</span>
        </h3>
          <div className="chips">
            {STOCKS.map((stock) => (
              <button
                key={stock.id}
                className={blend.effects.stock.id === stock.id ? 'on' : ''}
                title={stock.hint}
                onClick={() => setStock({ id: stock.id })}
              >
                {stock.label}
              </button>
            ))}
          </div>
            <Slider idle={blend.effects.stock.id === 'none' && 'Natural has no stock to strengthen: pick another'}
              label="Strength"
              value={blend.effects.stock.strength} def={FACTORY.effects.stock.strength}
              min={0}
              max={1.5}
              step={0.01}
              onChange={(strength) => setStock({ strength })}
            />
            <Slider idle={blend.effects.stock.id === 'none' && 'Natural has no stock: pick another'}
              label="Keep tones"
              title="100 keeps your photo's brightness everywhere and takes only the stock's colour"
              value={blend.effects.stock.keepTone} def={FACTORY.effects.stock.keepTone}
              min={0}
              max={1}
              step={0.01}
              onChange={(keepTone) => setStock({ keepTone })}
            />
      </div>
      <Disclosure
        id="colour-more"
        title="More colour"
        summary={moreSet.length ? moreSet.join(', ') : 'Pop, fade the rest, exact colours, tints'}
        // Opens by itself when something in it is set, so nothing a recipe does is hidden; it still folds.
        open={moreOpen ?? (moreSet.length ? true : undefined)}
        onOpenChange={setMoreOpen}
      >
        <div className="colour-group">
          <h3 title="The colour that stands out in the photo: which one it is, what it becomes">Pop</h3>
          <ColourField
            label="Which colour"
            title="The colour in the photo that should stand out. Vivid finds the photo's most vivid colour by itself; the Dropper picks one."
            value={grade.isolateColour}
            palette={palette}
            onChange={(isolateColour) => setGrade({ isolateColour })}
            sampleWithout={SAMPLE_FOR.isolate}
          />
          <ColourField
            label="Becomes"
            title="Turn the standout colour into this one; it keeps its own brightness"
            value={grade.popColour}
            palette={palette}
            swatches={POP_SWATCHES}
            onChange={(popColour) => setGrade({ popColour })}
            sampleWithout={SAMPLE_FOR.isolate}
          />
          <Slider
            label="Recolour"
            title="0 keeps the standout colour as it is; 100 turns it fully into Becomes"
            value={grade.popAmount} def={FACTORY.effects.grade.popAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(popAmount) => setGrade({ popAmount })}
          />
          <Slider
            label="Keep"
            title="Shields the standout colour from the gradient map, so it keeps its own colour (or its Becomes colour) while the map recolours everything else. Only does something when Gradient map is on."
            value={grade.popKeep} def={FACTORY.effects.grade.popKeep}
            min={0}
            max={1}
            step={0.01}
            onChange={(popKeep) => setGrade({ popKeep })}
          />
          <Slider
            label="Range"
            title="How many neighbouring colours count as the standout one"
            value={grade.isolateWidth} def={FACTORY.effects.grade.isolateWidth}
            min={0.05}
            max={1}
            step={0.01}
            onChange={(isolateWidth) => setGrade({ isolateWidth })}
          />
        </div>
        <div className="colour-group">
          <h3 title="Everything that is not the standout colour">Rest</h3>
          <Slider
            label="Fade"
            title="How much colour everything else loses. 100 leaves only the standout colour."
            value={grade.isolateAmount} def={FACTORY.effects.grade.isolateAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(isolateAmount) => setGrade({ isolateAmount })}
          />
          <ColourField
            label="Fades to"
            title="The tint the faded colours take: grey for graphite, a blue for silver, a teal for cyanotype"
            value={grade.restColour}
            palette={palette}
            swatches={REST_SWATCHES}
            photoSources={false}
            onChange={(restColour) => setGrade({ restColour })}
            sampleWithout={SAMPLE_FOR.isolate}
          />
        </div>
        <div className="colour-group">
          <h3 title="The palette's three colours set exactly, or read from this photo. Setting one lets go of the palette.">Exact palette colours</h3>
          <ColourField
            label="Shadows"
            value={grade.mapShadow}
            palette={palette}
            onChange={(mapShadow) => setGrade({ mapShadow })}
            sampleWithout={SAMPLE_FOR.map}
          />
          <ColourField
            label="Midtones"
            value={grade.mapMid}
            palette={palette}
            onChange={(mapMid) => setGrade({ mapMid })}
            sampleWithout={SAMPLE_FOR.map}
          />
          <ColourField
            label="Highlights"
            value={grade.mapHigh}
            palette={palette}
            onChange={(mapHigh) => setGrade({ mapHigh })}
            sampleWithout={SAMPLE_FOR.map}
          />
        </div>
        {(grade.shadowAmount > 0 || grade.highlightAmount > 0) && (
          <>
        <div className="colour-group">
          <h3 title="Colour laid over the dark tones">Shadows</h3>
          <ColourField
            label="Colour"
            value={grade.shadowTint}
            palette={palette}
            swatches={SHADOW_SWATCHES}
            onChange={(shadowTint) => setGrade({ shadowTint })}
            sampleWithout={SAMPLE_FOR.shadowTint}
          />
          <Slider
            label="Strength"
            value={grade.shadowAmount} def={FACTORY.effects.grade.shadowAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(shadowAmount) => setGrade({ shadowAmount })}
          />
        </div>
        <div className="colour-group">
          <h3 title="Colour laid over the bright tones">Light</h3>
          <ColourField
            label="Colour"
            value={grade.highlightTint}
            palette={palette}
            swatches={LIGHT_SWATCHES}
            onChange={(highlightTint) => setGrade({ highlightTint })}
            sampleWithout={SAMPLE_FOR.highlightTint}
          />
          <Slider
            label="Strength"
            value={grade.highlightAmount} def={FACTORY.effects.grade.highlightAmount}
            min={0}
            max={1}
            step={0.01}
            onChange={(highlightAmount) => setGrade({ highlightAmount })}
          />
        </div>
          </>
        )}
        {grade.blobs.length > 0 && (
          <p className="hint-line">
            Old colour magnets in use.{' '}
            <button className="link" onClick={() => setGrade({ blobs: [] })}>
              Clear them
            </button>
          </p>
        )}
      </Disclosure>
    </Module>
  )
}
