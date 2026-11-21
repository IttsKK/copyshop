import { useState } from 'react'
import { activeBorder, printSizeOf, type BlendParams, type Size } from '../engine/types'
import { BUILT_IN_EXPORTS, matches, type ExportPreset, type ExportSettings } from '../pipeline/exportPresets'
import { exportCanvas, exportPhotoSize, matchedFormat, type ExportFormat } from '../pipeline/exportSize'
import { extOf } from '../pipeline/formats'
import { isDesktop } from '../platform/desktop'
import type { OutputSettings } from '../storage/presets'
import { Slider } from './controls'
import { NameField } from './NameField'
import { useLocalStorage } from './useLocalStorage'
import { track } from '../platform/usage'

interface Props {
  output: OutputSettings
  onOutput: (o: OutputSettings) => void
  /** The open photo, to say what the export will come out as. */
  photo: { name: string; size: Size } | null
  blend: BlendParams
  /** Your own presets, kept by the app (useExportPresets) so the export button knows them too. */
  yours: ExportPreset[]
  onYours: (p: ExportPreset[]) => void
}

export type FormatName = 'JPEG' | 'PNG' | 'TIFF' | 'WebP'
const FORMAT_NAMES: Record<Exclude<ExportFormat, 'match'>, FormatName> = { jpeg: 'JPEG', png: 'PNG', tiff: 'TIFF', webp: 'WebP' }

/** The file format an export of this photo comes out in. */
export function exportFormatOf(output: OutputSettings, name: string): FormatName {
  return FORMAT_NAMES[output.format === 'match' ? matchedFormat(extOf(name)) : output.format]
}

/** Whether the quality setting applies to a format: the lossy ones. */
export const hasQuality = (format: FormatName): boolean => format === 'JPEG' || format === 'WebP'

/** The pixel size an export of this photo comes out at. */
export function exportSizeOf(output: OutputSettings, photo: Size, blend: BlendParams): Size {
  const sized = exportPhotoSize(photo, activeBorder(blend), output) ?? photo
  return exportCanvas(printSizeOf(sized, blend), output)
}

/** The preset the settings are, if any. */
export function presetOf(output: OutputSettings, yours: ExportPreset[]): ExportPreset | null {
  return [...BUILT_IN_EXPORTS, ...yours].find((p) => matches(p.settings, output)) ?? null
}

export function useExportPresets() {
  return useLocalStorage<ExportPreset[]>('ui.export.presets', [])
}

/** The browser version exports JPEGs and WebPs up to this long edge; bigger, and PNGs and TIFFs, are the desktop app's. */
export const WEB_LONG_EDGE = 2048

/** The browser's starting export: the Web preset. */
export const WEB_EXPORT: ExportSettings = BUILT_IN_EXPORTS.find((p) => p.id === 'web')!.settings

/**
 * In the browser, what of these settings only the desktop app exports: a
 * lossless file, PNG or TIFF. (A size over WEB_LONG_EDGE still exports,
 * smaller: see webCap.) Empty in the desktop app. Without a photo, judged by
 * the settings alone ('match' then needs nothing).
 */
export function desktopNeeds(output: OutputSettings, photo: { name: string } | null): ('PNG' | 'TIFF')[] {
  if (isDesktop()) return []
  const format = photo ? exportFormatOf(output, photo.name) : output.format === 'match' ? null : FORMAT_NAMES[output.format]
  return format === 'PNG' || format === 'TIFF' ? [format] : []
}

/**
 * In the browser, when these settings would make a picture longer than
 * WEB_LONG_EDGE: the settings it exports with instead (that long edge), the
 * size that comes out, and the full size the desktop app would export. Null
 * in the desktop app, or when the picture is within it.
 */
export function webCap(output: OutputSettings, photo: Size, blend: BlendParams): { output: OutputSettings; size: Size; full: Size } | null {
  // Instagram's size is its own (1080 wide): exported as it is, even when a tall picture runs past the limit.
  if (isDesktop() || output.shape === 'instagram') return null
  const full = exportSizeOf(output, photo, blend)
  if (Math.max(full.width, full.height) <= WEB_LONG_EDGE) return null
  const capped: OutputSettings = { ...output, shape: 'original', longEdge: WEB_LONG_EDGE }
  return { output: capped, size: exportSizeOf(capped, photo, blend), full }
}

/** The settings an export of this photo really uses: in the browser, no longer than WEB_LONG_EDGE. */
export function outputFor(output: OutputSettings, photo: Size, blend: BlendParams): OutputSettings {
  return webCap(output, photo, blend)?.output ?? output
}

const WEB_ONLY_NOTE = ' · desktop'

/**
 * The file an export makes: preset, format, size and quality, one row each,
 * every row always there (a setting that doesn't apply is greyed, not taken
 * away), so changing one never moves the others. Exports never crop; the Crop
 * module frames the picture. In the browser, PNG and TIFF are marked but can
 * be chosen (Export then says they're in the desktop app), and a size over
 * WEB_LONG_EDGE exports at that, the result line saying so.
 */
export function ExportPresets({ output, onOutput, photo, blend, yours, onYours: setYours }: Props) {
  const [naming, setNaming] = useState(false)
  /** The long edge as it's being typed: committed as it goes when it's a size, and put right on leaving. */
  const [edgeDraft, setEdgeDraft] = useState<string | null>(null)
  const web = !isDesktop()
  const current = presetOf(output, yours)
  const apply = (p: ExportPreset) => {
    track('export_preset', p.builtIn ? p.id : 'own')
    onOutput({ ...output, ...p.settings })
  }
  const cap = photo ? webCap(output, photo.size, blend) : null
  const result = photo ? (cap?.size ?? exportSizeOf(output, photo.size, blend)) : null
  const format: FormatName = photo ? exportFormatOf(output, photo.name) : output.format === 'match' ? 'JPEG' : FORMAT_NAMES[output.format]
  const sizeMode = output.shape === 'instagram' ? 'instagram' : output.longEdge === null ? 'full' : 'long'
  /** What the px box shows when it isn't yours to type in: the long edge this comes out at. */
  const shownEdge = sizeMode === 'long' ? output.longEdge! : result ? Math.max(result.width, result.height) : sizeMode === 'instagram' ? 1080 : ''
  const presetNeedsDesktop = (p: ExportPreset) => web && desktopNeeds({ ...output, ...p.settings }, photo).length > 0
  const save = (name: string) =>
    setYours([
      ...yours,
      { id: Date.now().toString(36), name, hint: '', settings: { shape: output.shape, longEdge: output.longEdge, format: output.format, jpegQuality: output.jpegQuality } },
    ])
  const formats: { id: ExportFormat; label: string; title: string }[] = [
    { id: 'match', label: 'Same as photo', title: 'The photo’s own format: JPEG, PNG, TIFF and WebP stay as they are; RAW, HEIC, AVIF, GIF and BMP come out as JPEG' },
    { id: 'jpeg', label: 'JPEG', title: 'Small files that open anywhere' },
    { id: 'png', label: 'PNG', title: 'Nothing lost to compression: for printing or editing further' },
    { id: 'tiff', label: 'TIFF', title: 'Nothing lost to compression, 8 bits a channel: for print shops and editing in other programs. Larger files' },
    { id: 'webp', label: 'WebP', title: 'Smaller than a JPEG of the same quality; opens in browsers and most apps' },
  ]
  const chosenFormat = formats.find((f) => f.id === output.format)!
  /** In the browser, a format only the desktop app exports: marked, still choosable. */
  const formatNeedsDesktop = (id: ExportFormat) => web && desktopNeeds({ ...output, format: id }, photo).length > 0
  return (
    <div className="export-presets">
      <div className="field valued export-row">
        <span title="A starting point: pick one, then change anything below">Preset</span>
        {naming ? (
          <NameField
            label="Name for the export preset"
            placeholder="Name this preset"
            onDone={(name) => {
              setNaming(false)
              if (name) save(name)
            }}
          />
        ) : (
          <select
            value={current?.id ?? 'custom'}
            aria-label="Export preset"
            title={current?.hint || undefined}
            onChange={(e) => {
              const p = [...BUILT_IN_EXPORTS, ...yours].find((x) => x.id === e.target.value)
              if (p) apply(p)
            }}
          >
            {BUILT_IN_EXPORTS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {presetNeedsDesktop(p) ? WEB_ONLY_NOTE : ''}
              </option>
            ))}
            {yours.length > 0 && (
              <optgroup label="Yours">
                {yours.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {presetNeedsDesktop(p) ? WEB_ONLY_NOTE : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {!current && <option value="custom">Custom</option>}
          </select>
        )}
        {current && !current.builtIn ? (
          <button className="icon" title={`Delete “${current.name}”`} aria-label={`Delete ${current.name}`} onClick={() => setYours(yours.filter((x) => x.id !== current.id))}>
            ×
          </button>
        ) : (
          <button
            className="icon"
            disabled={!!current || naming}
            title={current ? 'Change a setting below to save your own preset' : 'Save these settings as a preset'}
            aria-label="Save as a preset"
            onClick={() => setNaming(true)}
          >
            +
          </button>
        )}
      </div>

      <div className="field valued export-row">
        <span>Format</span>
        <select
          value={output.format}
          aria-label="Format"
          title={formatNeedsDesktop(output.format) ? `${chosenFormat.title}. In the desktop app.` : chosenFormat.title}
          onChange={(e) => onOutput({ ...output, format: e.target.value as ExportFormat })}
        >
          {formats.map((f) => (
            <option key={f.id} value={f.id} title={f.title}>
              {f.label}
              {formatNeedsDesktop(f.id) ? WEB_ONLY_NOTE : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="field valued export-row">
        <span title="The whole picture scaled, never cropped or stretched: frame it with the Crop module. Never enlarged, except to Instagram's width.">Size</span>
        <select
          value={sizeMode}
          aria-label="Size"
          onChange={(e) =>
            onOutput(
              e.target.value === 'instagram'
                ? { ...output, shape: 'instagram', longEdge: null }
                : e.target.value === 'full'
                  ? { ...output, shape: 'original', longEdge: null }
                  : { ...output, shape: 'original', longEdge: output.longEdge ?? (web ? WEB_LONG_EDGE : 2048) },
            )
          }
        >
          <option value="full">Full size</option>
          <option value="long">Long edge</option>
          <option value="instagram" title="1080 pixels wide, as Instagram shows it">Instagram (1080)</option>
        </select>
      </div>
      <div className={`field valued export-row${sizeMode === 'long' ? '' : ' is-off'}`}>
        <span title={sizeMode === 'long' ? 'The long edge in pixels' : 'The long edge it comes out at; choose Long edge in Size to set it'}>Long edge</span>
        <label className="export-px">
          <input
            type="number"
            min={64}
            max={20000}
            step={1}
            disabled={sizeMode !== 'long'}
            value={edgeDraft ?? shownEdge}
            aria-label="Long edge in pixels"
            onChange={(e) => {
              setEdgeDraft(e.target.value)
              const v = Math.round(Number(e.target.value))
              if (Number.isFinite(v) && v >= 64) onOutput({ ...output, longEdge: Math.min(20000, v) })
            }}
            onBlur={() => setEdgeDraft(null)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
          />
          px
        </label>
      </div>

      <div
        className={`export-quality${hasQuality(format) ? '' : ' is-off'}`}
        title={
          !hasQuality(format)
            ? `${format} keeps everything; quality is for JPEG and WebP`
            : format === 'WebP'
              ? 'WebP keeps colour at half resolution at any quality, so fine colour grain softens; higher keeps more detail'
              : 'Below 100, JPEG keeps colour at half resolution, so fine colour grain softens'
        }
      >
        <Slider label="Quality" value={output.jpegQuality} min={0.5} max={1} step={0.01} onChange={(jpegQuality) => onOutput({ ...output, jpegQuality })} />
      </div>

      <p className="hint-line export-result">
        {result ? `${result.width} × ${result.height} ${format}` : 'Open a photo to see its size'}
        {/* In the browser the line is always there, empty or not, so nothing below moves. */}
        {web && (
          <span className="export-cap" title={cap ? `The desktop app exports this at full size, ${cap.full.width} × ${cap.full.height}` : undefined}>
            {cap ? `Full size ${cap.full.width} × ${cap.full.height} in the desktop app` : '\u00a0'}
          </span>
        )}
      </p>

    </div>
  )
}
