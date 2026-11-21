import { keyLabel } from './shortcuts'
import { showInFilesLabel } from '../platform/os'
import type { BlendParams, Size } from '../engine/types'
import type { CropParams } from '../engine/crop'
import { cropActive, cropRect } from '../engine/crop'
import type { ExportPreset } from '../pipeline/exportPresets'
import { IN_DESKTOP_APP, isDesktop } from '../platform/desktop'
import { isNative, revealInFinder } from '../platform/native'
import { ARCHIVE_DIR, chooseExportFolder } from '../storage/archive'
import type { OutputSettings } from '../storage/presets'
import { supportsFolders, type Folder } from '../batch/fsAccess'
import type { GrainSource } from '../sources/GrainSource'
import { BatchPanel } from './BatchPanel'
import type { ExportTo } from './state/settings'
import { ExportPresets, WEB_LONG_EDGE, desktopNeeds, exportSizeOf } from './ExportPresets'
import { instagramOverflow } from '../pipeline/exportSize'
import { Disclosure } from './controls'
import { useState } from 'react'
import { WHOLE_STEP } from './history'
import { usePanelPage } from './state/layout'
import type { BorderParams, Rgb } from '../engine/types'
import type { Palette } from '../engine/palette'
import type { StoredPart } from '../storage/parts'
import { BORDER_STYLES, borderStyleOf } from './borderStyles'
import { ColourField } from './ColourField'
import { sameBorder, useSavedBorders } from './savedBorders'

/** "Download" in a browser; in the app, where it opens a Save dialog. */

interface Props {
  output: OutputSettings
  setOutput: (output: OutputSettings) => void
  image: { name: string; size: Size } | null
  blend: BlendParams
  setBlend: (blend: BlendParams) => void
  source: GrainSource | null
  /** Your export presets, and the one the settings match, if any. */
  exportPresets: ExportPreset[]
  setExportPresets: (presets: ExportPreset[]) => void
  exportPreset: ExportPreset | null
  cropTo: (aspect: CropParams['aspect'], turned?: boolean, step?: string) => void
  exportFolder: Folder | null
  setExportFolder: (folder: Folder | null) => void
  /** Where Export saves, in the app: next to the photo or the export folder. */
  exportTo: ExportTo
  onExportTo: (to: ExportTo) => void
  /** The folder the open photo was opened from, if it was opened by path. */
  photoFolder: { name: string; path: string } | null
  /** The photo was opened by hand, not from a library folder: Export asks where, with a Save dialog. */
  byHand: boolean
  /** The last export saved into the folder, to show in the Finder. */
  lastExport: string | null
  exporting: boolean
  onExportImage: () => void
  /** Export as…: this one export wherever you choose, with a Save dialog. */
  exportAs: () => void
  keepBorderColour: boolean
  setKeepBorderColour: (keep: boolean) => void
  setStatus: (status: string | null) => void
  setError: (error: string | null) => void
  /** The browser version: what to do when an export needs the desktop app. */
  onGetDesktop: () => void
  /** The border, shown here too: the same module as on the Print page. */
  border: {
    set: (patch: Partial<BorderParams>) => void
    palette: Palette
    /** Paper colours from the finished picture (as the Border module offers them). */
    papers: { label: string; colour: Rgb }[] | null
    onApplyPart: (part: StoredPart) => void
    /** Go to the Border module, on the Print page. */
    onEdit: () => void
  }
}

/** The right panel's Export page: the file, where it goes, Export, and batches. */
export function ExportPage({
  output,
  setOutput,
  image,
  blend,
  setBlend,
  source,
  exportPresets,
  setExportPresets,
  exportPreset,
  cropTo,
  exportFolder,
  setExportFolder,
  exportTo,
  onExportTo,
  photoFolder,
  byHand,
  lastExport,
  exporting,
  onExportImage,
  exportAs,
  keepBorderColour,
  setKeepBorderColour,
  setStatus,
  setError,
  onGetDesktop,
  border,
}: Props) {
  const panelPage = usePanelPage()
  const desktop = isDesktop()
  /** In the browser, a folder was asked for: only the desktop app saves into one. */
  const [webFolder, setWebFolder] = useState(false)
  const photo = image ? { name: image.name, size: cropActive(blend.effects.crop) ? cropRect(image.size, blend.effects.crop) : image.size } : null
  const needs = [...desktopNeeds(output, photo), ...(webFolder ? (['folder'] as const) : [])]
  /** Where it goes: next to the photo (the app, opened from a folder), the export folder, or asked / downloaded. */
  const dest: 'photo' | 'folder' | 'none' =
    exportTo === 'ask' ? 'none' : isNative() && exportTo === 'photo' && photoFolder ? 'photo' : exportFolder ? 'folder' : 'none'
  // The photo already sits in the export folder: one choice, not two that write the same file.
  const sameFolder = !!photoFolder && !!exportFolder?.path && photoFolder.path === exportFolder.path
  const savesTo = dest === 'photo' ? photoFolder : dest === 'folder' && exportFolder ? { name: exportFolder.name, path: exportFolder.path ?? '' } : null
  const NONE = isNative() ? 'Ask where each time' : 'Downloads'
  const chooseFolder = async () => {
    try {
      setExportFolder(await chooseExportFolder())
      onExportTo('folder')
    } catch {
      /* picker cancelled */
    }
  }
  /** Frame the picture for Instagram's feed with Crop, so Instagram doesn't crop it itself. */
  const cropFor = (overflow: 'tall' | 'wide') => {
    const step = `${WHOLE_STEP}cropping for Instagram`
    if (overflow === 'tall') cropTo('4:3', true, step)
    else cropTo('16:9', false, step)
    setStatus(`Cropped to ${overflow === 'tall' ? '3:4' : '16:9'} so Instagram shows all of it. Move it in Crop.`)
  }
  const overflow = photo && output.shape === 'instagram' ? instagramOverflow(exportSizeOf(output, photo.size, blend)) : null
  const note =
    !desktop
      ? webFolder
        ? 'Folders are in the desktop app'
        : 'Downloads as a file'
      : dest === 'photo'
        ? `Takes the photo's place in ${photoFolder!.name}; the original moves to ${ARCHIVE_DIR}/ there.`
        : dest === 'folder'
          ? `Saved under the photo's name in ${exportFolder!.name}; originals go to ${ARCHIVE_DIR}/ there.`
          : isNative()
            ? 'Asks where to save. Opening the file again picks the edit up.'
            : 'Downloads as a file. Opening it again picks the edit up.'
  return (
    <section className="export-page" id="module-export" hidden={panelPage !== 'export'}>
      <div className="stack-title" style={{ ['--tint' as string]: 'var(--text)' }}>
        <div className="stack-title-row">
          <b>Export</b>
        </div>
      </div>
      <div className="module-body">
        <ExportBorder blend={blend} {...border} />
        <ExportPresets
          output={output}
          onOutput={setOutput}
          photo={photo}
          blend={blend}
          yours={exportPresets}
          onYours={setExportPresets}
        />

        {desktop && byHand ? (
          <div className="field valued export-row export-dest">
            <span>Save to</span>
            <span className="export-dest-asks" title="A photo opened by hand: Export opens a Save dialog to choose where, starting where the last one went. Photos in a library folder save into folders instead">
              Choose on Export
            </span>
          </div>
        ) : (
        <div className="field valued export-row export-dest">
          <span>Save to</span>
          <select
            aria-label="Save to"
            value={!desktop ? (webFolder ? 'web-folder' : 'none') : dest}
            onChange={(e) => {
              const v = e.target.value
              if (!desktop) return setWebFolder(v === 'web-folder')
              if (v === 'photo') onExportTo('photo')
              else if (v === 'folder') onExportTo('folder')
              else if (v === 'choose') void chooseFolder()
              // Asked each time; the export folder stays in the list for next time.
              else if (v === 'none') onExportTo('ask')
            }}
          >
            {isNative() && photoFolder && !(sameFolder && dest !== 'photo') && <option value="photo">The photo’s folder</option>}
            {exportFolder && !(sameFolder && dest === 'photo') && <option value="folder">{exportFolder.name}</option>}
            <option value="none">{NONE}</option>
            {desktop ? (
              supportsFolders() && <option value="choose">{exportFolder ? 'Another folder…' : 'A folder…'}</option>
            ) : (
              <option value="web-folder">A folder · desktop</option>
            )}
          </select>
        </div>
        )}
        {!(desktop && byHand) && <p className="hint-line export-note">{note}</p>}

        {/* In the browser, a choice only the desktop app exports greys Export out and
            says why; the way to get the app is right below, and the browser's
            limits are always written there, so none of it comes as a surprise. */}
        <button className="primary export-go" disabled={!image || !source || exporting || needs.length > 0} onClick={onExportImage}>
          {needs.length
            ? needs.length > 1
              ? 'Needs the desktop app'
              : needs[0] === 'folder'
                ? 'Folders are in the desktop app'
                : `${needs[0]} is in the desktop app`
            : exporting
              ? 'Rendering…'
              : `Export${exportPreset ? ` · ${exportPreset.name}` : ''}`}
        </button>
        {/* Saving into a folder (a library photo): this one export somewhere else instead, chosen in a Save dialog. */}
        {desktop && !byHand && (
          <button className="export-as" disabled={!image || !source || exporting} title={`Save this export wherever you choose, with a Save dialog; nothing is moved (${keyLabel('cmd+alt+e')})`} onClick={exportAs}>
            Export as…
          </button>
        )}
        {desktop && lastExport && !savesTo && (
          <div className="row export-after">
            <button className="link" title={`${showInFilesLabel()}, with the last export selected`} onClick={() => revealInFinder(lastExport, true).catch((err: Error) => setError(`Could not show it: ${err.message}`))}>
              {showInFilesLabel()}: {lastExport.split('/').pop()}
            </button>
          </div>
        )}
        {!desktop && (
          <div className={`export-desktop${needs.length ? ' is-needed' : ''}`}>
            <p className="hint-line" title="Full size, PNG, TIFF and saving into folders are in the desktop app">
              Browser: JPEG and WebP, up to {WEB_LONG_EDGE} px
            </p>
            <button className={needs.length ? 'primary export-buy' : 'link'} onClick={onGetDesktop}>
              Get the desktop app
            </button>
          </div>
        )}
        {/* Below Export, so it never pushes the rows above around. */}
        {overflow && (
          <div className="export-warn">
            <span>
              {overflow === 'tall'
                ? 'Taller than Instagram’s feed shows (3:4): Instagram will crop the top and bottom itself.'
                : 'Wider than Instagram’s feed shows (1.91:1): Instagram will crop the sides itself.'}
            </span>
            <button className="link" onClick={() => cropFor(overflow)}>
              {overflow === 'tall' ? 'Crop to 3:4' : 'Crop to 16:9'}
            </button>
          </div>
        )}
        {savesTo && (
          <div className="row export-after">
            <button
              className="link"
              disabled={!savesTo.path}
              title={savesTo.path ? `${showInFilesLabel()}: ${savesTo.name}` : IN_DESKTOP_APP}
              onClick={() => savesTo.path && revealInFinder(savesTo.path).catch((err: Error) => setError(`Could not open the folder: ${err.message}`))}
            >
              Open folder
            </button>
            {lastExport && (
              <button
                className="link"
                title={`${showInFilesLabel()}, with the last export selected`}
                onClick={() => revealInFinder(lastExport, true).catch((err: Error) => setError(`Could not show it: ${err.message}`))}
              >
                Show last export
              </button>
            )}
          </div>
        )}

        <Disclosure id="export-more" title="More" summary={output.suffix ? `Name + ${output.suffix}` : undefined}>
          <label className="field">
            <span title="Added to the photo's own name: IMG_2041 becomes IMG_2041_grain">Name suffix</span>
            <input type="text" value={output.suffix} placeholder="none" onChange={(e) => setOutput({ ...output, suffix: e.target.value })} onKeyDown={(e) => e.stopPropagation()} />
          </label>
          <label
            className="check-row"
            title="Each photo gets its own grain pattern, paper edge, dust and surge marks, worked out from the photo itself: the same every time you export it. Off, every photo gets the identical pattern."
          >
            <input type="checkbox" checked={blend.varyPerPhoto} onChange={(e) => setBlend({ ...blend, varyPerPhoto: e.target.checked })} />
            Vary grain, edges and dust per photo
          </label>
        </Disclosure>

        <BatchPanel
          source={source}
          blend={blend}
          output={output}
          exportFolder={exportFolder}
          keepBorderColour={keepBorderColour}
          onKeepBorderColour={setKeepBorderColour}
          onStatus={setStatus}
          onError={setError}
        />
      </div>
    </section>
  )
}

const WARM_WHITE: Rgb = [0.94, 0.925, 0.895]
const BLACK: Rgb = [0.07, 0.07, 0.075]

/**
 * The border, the last thing most people set before exporting: which one
 * (your saved ones, the ready-made styles, or none) and its colour. The
 * rest of its settings are in the Border module, on the Print page.
 */
function ExportBorder({ blend, set, palette, papers, onApplyPart, onEdit }: { blend: BlendParams } & Props['border']) {
  const b = blend.border
  const saved = useSavedBorders()
  const on = blend.modules.border && (b.width > 0 || b.bottomExtra > 0)
  const mine = on ? saved.find((s) => sameBorder(s.border, b)) : undefined
  const style = on && !mine ? borderStyleOf(b) : null
  const value = !on ? 'none' : mine ? `part:${mine.part.id}` : style ? `style:${style}` : 'own'
  const swatches = [...(papers ?? []), { label: 'Warm white', colour: WARM_WHITE }, { label: 'Black', colour: BLACK }]
  return (
    <div className="export-border">
      <label className="field valued wide" title="The border round the photo. Everything else about it is in Border, on the Print page.">
        <span>Border</span>
        <select
          value={value}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'none') return set({ width: 0, bottomExtra: 0 })
            if (v.startsWith('part:')) {
              const s = saved.find((x) => `part:${x.part.id}` === v)
              if (s) onApplyPart(s.part)
              return
            }
            const st = BORDER_STYLES.find((x) => `style:${x.id}` === v)
            if (st) set(st.patch)
          }}
        >
          <option value="none">None</option>
          {saved.length > 0 && (
            <optgroup label="Yours">
              {saved.map((s) => (
                <option key={s.part.id} value={`part:${s.part.id}`}>
                  {s.part.name}
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Styles">
            {BORDER_STYLES.map((s) => (
              <option key={s.id} value={`style:${s.id}`}>
                {s.name}
              </option>
            ))}
          </optgroup>
          {value === 'own' && <option value="own">As set in Border</option>}
        </select>
      </label>
      {on && (b.fill ?? 'solid') === 'solid' && (
        <ColourField
          label="Colour"
          title="The paper's colour. The first colours are taken from the finished picture: its ink, shade, midtone, light and accent."
          value={{ source: 'manual', colour: b.colour }}
          palette={palette}
          photoSources={false}
          swatches={swatches}
          onChange={(c) => set({ colour: [...c.colour] as [number, number, number] })}
        />
      )}
      <button className="link export-border-more" onClick={onEdit}>
        All border settings
      </button>
    </div>
  )
}
