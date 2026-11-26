import { OFFICIAL } from '../platform/build'
import { keyWords, showInFilesLabel } from '../platform/os'
import { plainGpuError } from '../engine/gpuMessage'
import { moduleSummary, needsSetup } from './moduleSummary'
import { CollageFillWindow, regionOf } from './CollageArrange'
import { decodeRaster, rasterToPoints } from '../engine/maskRaster'
import { type SetStateAction, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { graphicsState } from '../engine/renderClient'
import { GrainEngine } from '../engine/GrainEngine'
import { CommandPalette } from './CommandPalette'
import { onMenuAction, setMenuEnabled, type MenuAction } from '../platform/menu'
import { keepUntilWritten, onBeforeQuit, settleWrites, startQuitHandling } from '../platform/quit'
import { startDeepLinks } from '../platform/deepLink'
import {
  MAX_LEAK_SPOTS,
  type BorderParams,
  type EffectParams,
  type GradeParams,
  type LeakKind,
  type LeakParams,
  type LeakSpot,
  type StreakParams,
  type StreakShape,
  MAX_STREAK_FIXES,
  type MaskShape,
  type MaskSection,
  type SectionMask,
  DEFAULT_MASK,
  DEFAULT_GLASS,
  MAX_MASKS,
  MAX_STREAKS,
  STREAK_DEFAULTS,
  NEW_STREAK_ANGLE,
  MAX_BAND_GUIDES,
  type ColourChoice,
  type Rgb,
  activeBorder,
  printSizeOf,
  photoFrameOf,
  shapeFrame,
  shapeMeasure,
  type StreakGuide,
  type StockParams,
  type SurgeParams,
  type CollageParams,
  type CollagePiece,
  DEFAULT_BLEND_PARAMS,
  DEFAULT_BORDER,
  DEFAULT_COLLAGE,
  DEFAULT_COLLAGE_PIECE,
  DEFAULT_ARRANGE,
  type CollageArrange,
  MAX_COLLAGE_PIECES,
  type Rect,
  type MaskOwner,
} from '../engine/types'
import { constrainPlacement, coverPlacement, gapsAt, pieceAt, pieceMaps, setCollagePhoto } from '../engine/collage'
import { ARRANGED_ID, arrangement, cellArea, cellAt } from '../engine/arrange'
import { collageImageNow, hasCollageImage, onCollageImage } from '../storage/collageImages'
import { newFix, type FixEditing } from './StreakFixes'
import { Guide, type GuidePage } from './Guide'
import { BASE_SETTINGS, clipOf, partsOf, pasteClip, type EditClip } from './editClip'
import { topic } from './guideTopics'
import type { StreakTab } from './StreakSettings'
import { pasteStreakSettingsOnto, repeatLayers, streakSettingsOf, vanishWords } from './streakClip'
import { pasteRepeatSettingsOnto, repeatSettingsOf } from './repeatClip'
import { HistogramContext, ToneHighlightContext, type ToneRange } from './toneHighlight'
import type { LeakStyle as LeakStyleDef } from '../engine/leakStyles'
import { MIN_OUTLINE_POINTS, isRounded, type Point } from '../engine/leaks'
import type { StreakEditor, StreakTool } from './StreakOverlay'
import { DRAWING_STREAK_HINT, streakEditParts, STREAK_TOOL_NAMES } from './streakEdit'
import { EditViewContext, type EditView } from './EditBox'
import { extractPalette, NEUTRAL_PALETTE } from '../engine/palette'
import { DropperContext, type DropFrom, type Dropper } from './ColourField'
import type { DefectParams } from '../sources/defects'
import {
  type BlendParams,
  type Size,
} from '../engine/types'
import { photoSeed, renderFile } from '../pipeline/render'
import { galleryJpeg, galleryTools } from './gallery'
import { GalleryDialog } from './GalleryDialog'
import { DEFAULT_PROCEDURAL_PARAMS } from '../sources/generateGrain'
import type { GrainSource, GrainTexture, SerializedGrainSource } from '../sources/GrainSource'
import type { ProceduralGrainParams } from '../sources/generateGrain'
import { hydrateGrainSource } from '../sources/GrainSource'
import { newId, onSaveFailed, onStorageBlocked, storageUnavailableReason } from '../storage/db'
import { defaultReading, prepareSegmenter, segment, segmentingDone, type Selection } from '../ml/segment'
import { cleanSelection } from '../ml/trace'
import {
  ARCHIVE_DIR,
  exportToFolder,
  canReadFolder,
  findArchivedOriginal,
  findOriginalOnDisk,
  getExportFolder,
} from '../storage/archive'
import { readRecipe, sha256, type CollageImageRef, type Recipe } from '../storage/recipe'
import { recoverCollageImages } from '../storage/collageRecovery'
import { shapeSpaceFromExport, shapeSpaceUnknown } from '../pipeline/shapeSpace'
import { ensureWritePermission, nativeFolder, type Folder } from '../batch/fsAccess'
import { loadExports, originalOf, recordExport, rememberFinal } from '../storage/exports'
import { previewKey, readPreview, writePreview } from '../storage/previews'
import { confirmWith, isNative, joinPath, moveFile, trashFile, photoStats, pickFolder, pickPhotos, revealInFinder, saveAs, saveFileAs, baseName, type PhotoFile } from '../platform/native'
import { PHOTO_EXTENSIONS, RECENT, addRecent, folderChanged, knownSha, shaOf, libraryAvailable, loadLibrary, loadRecent, onRecent, readPhoto, rememberSha, saveLibrary, type Library } from '../storage/library'
import { Filmstrip, shownThumb, stepStrip } from './Filmstrip'
import { LibraryView } from './LibraryView'
import {
  loadPhoto,
  loadSession,
  loadSnapshotRecords,
  savePhoto,
  savePhotoPath,
  saveSession,
  saveSnapshotRecords,
} from '../storage/session'
import {
  DEFAULT_OUTPUT,
  PRESET_SCHEMA_VERSION,
  deletePreset,
  listPresets,
  parsePreset,
  presetToJson,
  savePreset,
  type OutputSettings,
  type PresetDoc,
  type StoredPreset,
} from '../storage/presets'
import { BaselineContext } from './controls'
import { useGrainGenerator } from './GrainSourcePanel'
import { LISTED_LOOKS, LOOKS, NONE_LOOK, STARTING_LOOK, type Look } from './looks'
import { PartPresets } from './PartPresets'
import { PART_LABELS, applyPart as applyPartData, extractPart, hasPlaced, keepOwn, placedOf, withPlaced, withoutPlaced, type PartKind, type StoredPart } from '../storage/parts'
import { changeSavedEdit, restoreSavedEdit, type EditChange } from './libraryEdits'
import { createProceduralSource } from '../sources/ProceduralSource'
import { PreviewCanvas, type PreviewLayer } from './PreviewCanvas'
import { autoBase, neutralise, type BaseParams } from '../engine/base'
import { readPhotoDate } from '../pipeline/photoDate'
import { LENS_K, lensOn } from '../engine/extras'
import { maskKind, withOutline } from '../engine/maskShapes'
import { developRaw, isRawName } from '../pipeline/raw'
import { cannotOpenMessage, photoAccept } from '../pipeline/formats'
import { isDesktop } from '../platform/desktop'
import { fitPalette, lookPapers, offWheelColour, picturePapers } from './paletteFit'
import { SESSION_STEP, WHOLE_STEP, useEditHistory, type EditState } from './history'
import { OPENED_EDITED } from './historySteps'
import { draftPoints, OUTLINE_POINTS } from './state/draft'
import { useStore } from './state/store'
import { Resizer } from './Resizer'
import { TopBar } from './TopBar'
import { LeftPanel } from './LeftPanel'
import { ExportPage } from './ExportPage'
import { RecipesPage } from './RecipesPage'
import { ViewBar } from './ViewBar'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { IntroDialog } from './IntroDialog'
import { Tour, type TourStep } from './Tour'
import { GetDesktopDialog } from './GetDesktopDialog'
import { WhatsNewDialog } from './WhatsNewDialog'
import { releasesSince, updatedFromStore, whatsNewSeen } from './whatsNew'
import { FeedbackDialog } from './FeedbackDialog'
import { ActivateDialog } from './ActivateDialog'
import { SendToAppDialog } from './SendToAppDialog'
import { checkLicense, onLicense, type LicenseState } from '../transfer/license'
import { pairingFromAppLink, pairingFromHash, photoOnly, receivePairing } from '../transfer/transfer'
import { TimelapsePanel } from './TimelapsePanel'
import { buildTimeline, makeTimelapseVideo, useTimelapseRecorder, type TimelapseFocus, type TimelapseFrame } from './timelapse'
import { SettingsDialog } from './SettingsDialog'
import { fitRepeatLength, matchStreakLines, perspectiveFromGuides, snapToEdge } from './streakLines'
import { repeatLineUp } from './repeatLines'
import type { GuideState, StreakGuideEditor } from './StreakGuideOverlay'
import type { LightEditor } from './LightOverlay'
import { DEFAULT_LIGHT, DEFAULT_LIGHTING, type LightShape, type LightingParams } from '../engine/lighting'
import type { RepeatEditor } from './RepeatOverlay'
import type { KaleidoEditor } from './KaleidoOverlay'
import { DEFAULT_KALEIDO, type KaleidoParams } from '../engine/kaleido'
import { KaleidoModule } from './modules/KaleidoModule'
import { defaultColourLine, hasColourLine, streakCoordsOf } from '../engine/colourLine'
import type { ColourLineEditor } from './ColourLineOverlay'
import { RecolourModule } from './modules/RecolourModule'
import { DEFAULT_RECOLOUR, MAX_RECOLOURS, newRecolourItem, type RecolourItem } from '../engine/recolour'
import { pieceBoxOf, pieceCentreOf } from '../engine/repeat'
import { DEFAULT_REPEAT_MODULE, NEW_REPEAT_PARAMS, fitRepeat as fitRepeatToPiece, MAX_REPEATS, newRepeat, repeatsActive, type RepeatModule as RepeatModuleParams, type RepeatParams } from '../engine/repeatParams'
import { ModuleExample, bigOf, editThumb } from './RecipeThumb'
import { loadEdit, saveEdit, thumbKey, type PhotoEdit } from '../storage/photoEdits'
import { MaskSettings, type PickStep, type Picking, type PickingState, BrushBox } from './MasksPanel'
import { setLensView } from './lensView'
import { MaskOverlayContext, type AddKind, type NewMaskTarget } from './maskKinds'
import { traceKeyOutline } from './traceKey'
import type { TraceOutline } from './TraceToKey'
import { createSnapshot, nextSnapshotName, type Snapshot } from './snapshots'
import { PANEL_KEYS, inTextField, keyLabel, useShortcuts, type Shortcut } from './shortcuts'
import { useLocalStorage } from './useLocalStorage'
import { useSettled } from './useSettled'
import {
  DEFAULT_RIGHT,
  leftOpenStore,
  panelPageStore,
  rightOpenStore,
  setGroups,
  setLeftOpen,
  setLibraryShown,
  setPanelPage,
  setPinned,
  setRightOpen,
  setRightWidth,
  setStripOpen,
  stackTabStore,
  useGroups,
  useLeftOpen,
  useLeftWidth,
  useLibraryShown,
  usePanelPage,
  usePinned,
  useRightOpen,
  useRightWidth,
  useStackTab,
  useStripOpen,
} from './state/layout'
import { launchStore, setExportTo, setTimelapse, startLookStore, useExportTo, useReduceMotion, useTimelapseSettings } from './state/settings'
import { GeneralSettings } from './GeneralSettings'
import { StrengthControls } from './StrengthControls'
import { QuickEffects, REPEAT_QUICK, type QuickEffect } from './quickEffects'
import { useLingering } from './useLingering'
import { setBypass, setLoupe, setSmall, setZoom, setZoomState, stepZoom, useBypass, useFitAsked, useIgSim, useLoupe, useSmall, useZoom } from './state/view'
import { CATEGORIES, MODULES, MODULE_BY_ID, categoryOrder, inUse, isStackModule, presetKind, resetModule, startModule, stopModule, switchOn, moduleOrder, type CategoryId, type StackModuleId } from './moduleCatalog'
import { GROUP_COLOURS, GroupEditor, SlimModule, StackAdd, StackContext, StackRail, StackTitle, groupOf, inTab, type ModuleGroup, type StackApi, type StackTab } from './StackNav'
import { rulePatch, useRecipeName } from './RecipePicker'
import { RASTER_SIDE, encodeRaster, rasterBounds, shrinkGrid } from '../engine/maskRaster'
import { PRECISE_SIDE } from '../ml/precise/side'
import { checkPrecise, downloadPrecise, preciseWantedStore } from '../ml/precise/models'
import { findKey, KEY_BAND, type MaskView } from './maskKey'
import { brushRange, cellColours, paintRaster, rasterOutline } from './maskBrush'
import { cropActive, cropAngle, cropBitmap, cropRatio, cropRect, fitRatio, keepInside, turnQuarter, type CropParams } from '../engine/crop'
import { cropFraction, shapesOnCrop } from '../pipeline/instagram'
import { grayOf } from '../engine/alignPhoto'
import { moveEditOnto } from '../pipeline/betterCopy'
import { keepReference, loadReference } from '../storage/references'
import type { NewCopy, NewVersion } from './useFolderPhotos'
import { NewVersionsDialog, ReplacedVersionDialog, type NewVersionChoice } from './NewVersionsDialog'
import { markSeen } from '../storage/versions'
import type { CropEditor } from './CropOverlay'
import { WEB_EXPORT, desktopNeeds, exportFormatOf, outputFor, presetOf, useExportPresets, webCap } from './ExportPresets'
import { isFullSize } from '../pipeline/exportSize'
import { mergeGrade, ruleMatching } from '../engine/recipe'
import type { Harmony, Trio } from '../engine/harmony'
import { openModule } from './CommandPalette'
import { decodePhoto } from '../pipeline/decode'
import { reportIssue, scrub, stepTimer } from '../platform/telemetry'
import { track, trackOnce } from '../platform/usage'
import { editUsage } from './usageSummary'
import type { LoadedImage } from './loadedImage'
import { SurgeModule } from './modules/SurgeModule'
import { DustModule } from './modules/DustModule'
import { BorderModule } from './modules/BorderModule'
import { CollageModule } from './modules/CollageModule'
import { RepeatModule } from './modules/RepeatModule'
import { LightingModule } from './modules/LightingModule'
import { SolarizeModule } from './modules/SolarizeModule'
import { EdgesModule } from './modules/EdgesModule'
import { HalftoneModule } from './modules/HalftoneModule'
import { SurfaceModule } from './modules/SurfaceModule'
import { DEFAULT_SURFACE } from '../engine/surface'
import { MonoModule } from './modules/MonoModule'
import { StampModule } from './modules/StampModule'
import { DoubleModule } from './modules/DoubleModule'
import { LensModule } from './modules/LensModule'
import { PrismModule } from './modules/PrismModule'
import { CropModule } from './modules/CropModule'
import { CurveModule } from './modules/CurveModule'
import { BalanceModule } from './modules/BalanceModule'
import { ExposureModule } from './modules/ExposureModule'
import { PixelModule } from './modules/PixelModule'
import { GlassModule } from './modules/GlassModule'
import { StreaksModule } from './modules/StreaksModule'
import { SUBJECT_INSET, guessFlow, subjectOutline } from './streakSubject'
import { STREAK_STYLES, firstStreakPatch, variedBars } from './streakStyles'
import { designedIn, palettesFor } from './recipePalettes'
import { LeaksModule } from './modules/LeaksModule'
import { GlowModule } from './modules/GlowModule'
import { ToneModule } from './modules/ToneModule'
import { DitherModule } from './modules/DitherModule'
import { ColourModule } from './modules/ColourModule'
import { GrainModule } from './modules/GrainModule'

/** JSON with sorted keys, so two equal settings compare equal whatever order they were built in. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(
          Object.keys(v)
            .sort()
            .map((k) => [k, (v as Record<string, unknown>)[k]]),
        )
      : v,
  )
}

/*
 * The last few photos opened, decoded, by their SHA-256: going back to one
 * skips decoding it, and as the same picture the render engine's work on it
 * is reused. One that drops out is freed a moment later (a render may still
 * be drawing from it), unless it is open.
 */
const KEEP_DECODED = 4
const decodedPhotos = new Map<string, ImageBitmap>()
function keepDecoded(sha: string, bitmap: ImageBitmap) {
  decodedPhotos.delete(sha)
  decodedPhotos.set(sha, bitmap)
  while (decodedPhotos.size > KEEP_DECODED) {
    const [old, gone] = decodedPhotos.entries().next().value!
    decodedPhotos.delete(old)
    setTimeout(() => {
      if (![...decodedPhotos.values()].includes(gone) && openBitmap !== gone) gone.close()
    }, 2000)
  }
}
const isKeptDecoded = (bitmap: ImageBitmap) => [...decodedPhotos.values()].includes(bitmap)
/** The photo on show, which is never freed from under it. */
let openBitmap: ImageBitmap | null = null

/** The folder a photo opened by path is in. */
const dirOf = (f: PhotoFile) => f.path.slice(0, f.path.length - f.name.length - 1)
/** The walk round has been seen. */
const TOUR_SEEN = 'ui.tourSeen'
const markShown = (key: string) => {
  try {
    localStorage.setItem(key, '1')
  } catch {
    /* shown again next time */
  }
}
/** Where the last photo opened by hand was exported to: its Save dialog starts there. */
const LAST_SAVE_DIR = 'export.lastSaveDir'
/** Something has been exported (from Export, or once it was shown): Cmd+E exports at once from then on. */
const EXPORT_SEEN = 'export.seen'
const exportSeen = () => {
  try {
    return localStorage.getItem(EXPORT_SEEN) === '1'
  } catch {
    return true
  }
}
const markExportSeen = () => markShown(EXPORT_SEEN)

/** Coarse luminance histogram of the loaded image, drawn behind the curve. */
function computeHistogram(bitmap: ImageBitmap, bins = 48): number[] {
  const w = 200
  const h = Math.max(1, Math.round((bitmap.height / bitmap.width) * w))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  // Not willReadFrequently: that makes the canvas the CPU's, and shrinking a
  // big photo there took longer than everything else in opening it.
  const ctx = canvas.getContext('2d')
  if (!ctx) return []
  ctx.drawImage(bitmap, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  const counts = new Array(bins).fill(0)
  for (let i = 0; i < data.length; i += 4) {
    const luma = (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255
    counts[Math.min(bins - 1, Math.floor(luma * bins))]++
  }
  const peak = Math.max(...counts) || 1
  return counts.map((c) => c / peak)
}

/**
 * Hand a file to the user: a download in a browser, a Save dialog in the app
 * (which has no downloads). False if they cancel the dialog.
 */
async function downloadBlob(blob: Blob, filename: string): Promise<boolean> {
  if (isNative()) return saveAs(blob, filename)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
  return true
}

/**
 * Grain parameters with the generator's defaults filled in, for comparing: a
 * look saved before a setting existed (Definition) leaves it out, and the
 * same grain made now spells it out; neither is an edit.
 */
function withGrainDefaults(params: unknown): unknown {
  if (!params || typeof params !== 'object') return params ?? null
  // Definition came later and is optional, read as 0 where it is missing.
  return { ...DEFAULT_PROCEDURAL_PARAMS, definition: 0, ...(params as object) }
}

/** How long a status stays: a few seconds, longer for a longer message; one ending in … stays until replaced. */
export function statusDuration(text: string): number {
  if (text.endsWith('…')) return Infinity
  return Math.min(9000, 2600 + Math.max(0, text.length - 50) * 45)
}

/** Sample photos, in public/samples. */
/** The repeat about to be made, before it is in Repeat's list. */
const NEW_REPEAT: RepeatParams = NEW_REPEAT_PARAMS

const SAMPLES = ['sample-lake.jpg', 'sample-street.jpg', 'sample-moon.jpg']

export function App() {
  const [image, setImage] = useState<LoadedImage | null>(null)
  /** An export opened: its own name, and the original being edited from it (shown beside the original's name while that one is open). */
  const [openedExport, setOpenedExport] = useState<{ name: string; sha: string } | null>(null)
  // The open photo's date, for the date stamp of an edit started on it.
  const photoDate = useRef('')
  const [histogram, setHistogram] = useState<number[] | null>(null)
  const [editingLeaks, setEditingLeaks] = useState(false)
  // The crop being set on the whole photo. As in darktable, it is while Crop
  // has focus: from opening it or clicking in it until a click anywhere else
  // outside the photo, Enter or Esc (the crop focus effect below). All the
  // changes made in that time are one step to undo.
  const [editingCrop, setEditingCropState] = useState(false)
  const cropSession = useRef(0)
  const editingCropNow = useRef(false)
  const setEditingCrop = (on: boolean) => {
    if (on && !editingCropNow.current) cropSession.current++
    editingCropNow.current = on
    setEditingCropState(on)
  }
  // Repeat's path or placed copies being set on the photo.
  const [editingRepeat, setEditingRepeat] = useState(false)
  // The on-photo tools' Cancel (cancelFamily, defined further down), for key handlers set up before it.
  const cancelFamilyRef = useRef<(f: OnPhotoFamily) => void>(() => undefined)
  /** The outline being drawn is Repeat's own piece. */
  const [drawingPiece, setDrawingPiece] = useState(false)
  // The Kaleidoscope's own part being drawn, and its centre being moved on the photo.
  const [drawingKaleido, setDrawingKaleido] = useState(false)
  const [editingKaleido, setEditingKaleido] = useState(false)
  // A streak's colour line being edited on the photo: which streak.
  const [editingColourLine, setEditingColourLine] = useState<number | null>(null)
  // A Recolour part being drawn: a new one, or (`again`) the open one's outline replaced.
  const [drawingRecolour, setDrawingRecolour] = useState<{ again: boolean } | null>(null)
  // The Recolour part open in its list.
  const [recolourOpen, setRecolourOpen] = useState<number | null>(null)
  // The selected streak's guides being laid on the photo.
  const [guidingStreak, setGuidingStreak] = useState(false)
  // What laying them is doing, for the bar over the photo (StreakGuideOverlay).
  const [guideState, setGuideState] = useState<GuideState>('idle')
  // Guide points snap onto the photo's edges, unless turned off (remembered).
  const [guideSnap, setGuideSnapState] = useState(() => {
    try {
      return localStorage.getItem('guides.snap') !== '0'
    } catch {
      return true
    }
  })
  const setGuideSnap = (on: boolean) => {
    setGuideSnapState(on)
    try {
      localStorage.setItem('guides.snap', on ? '1' : '0')
    } catch {
      /* kept for this run only */
    }
  }
  // Lighting: drawing a new light, the lights shown on the photo, the open one.
  const [lightDrawing, setLightDrawing] = useState(false)
  const [lightEditing, setLightEditing] = useState(false)
  const [selectedLight, setSelectedLight] = useState<number | null>(null)
  // Painting a subject mask by hand: which mask, in or out, how big (share of the short side).
  const [brushing, setBrushing] = useState<{ index: number; mode: 'add' | 'remove' } | null>(null)
  const brushingNow = useRef(false)
  brushingNow.current = !!brushing
  const [brushSize, setBrushSize] = useLocalStorage('ui.mask.brushSize', 0.04)
  // How an open mask shows on the photo (maskKey.ts MaskView).
  const [maskView, setMaskView] = useLocalStorage<MaskView>('ui.mask.view', 'red')
  // Whether masks show on the photo at all while worked on (O), and the one a
  // module's mask menu shows while it is open (SectionMaskMenu).
  const [maskOverlay, setMaskOverlayKept] = useLocalStorage('ui.mask.overlay', true)
  const [peekMask, setPeekMask] = useState<string | null>(null)
  const overlayRef = useRef(maskOverlay)
  overlayRef.current = maskOverlay
  const setMaskOverlay = useCallback(
    (on: boolean) => {
      setMaskOverlayKept(on)
      setStatus(on ? 'Mask overlay on' : 'Mask overlay off')
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [setMaskOverlayKept],
  )
  const maskOverlayApi = useMemo(() => ({ on: maskOverlay, set: setMaskOverlay }), [maskOverlay, setMaskOverlay])
  // Brushing in on a mask matched to the photo: simply in, or where the photo's colours say so.
  const [brushByColour, setBrushByColour] = useLocalStorage('ui.mask.brushByColour', false)
  /**
   * Match a mask to the photo: off, along its edge or all over it. Turned on
   * (or asked again), the photo along its edge is read for the settings that
   * best tell the subject from what is round it (ui/maskKey.ts).
   */
  const matchMask = (i: number, to: 'off' | 'edge' | 'all' | 'again') => {
    const m = blend.effects.masks[i]
    if (!m) return
    let patch: Partial<MaskShape>
    if (to === 'off') patch = m.key === 'off' ? {} : { key: 'off', keyWas: m.key }
    else if (to === 'edge') {
      // At the edge the colours either side decide (maskCover.ts edgeColours):
      // nothing to read off the photo first.
      patch = { keyAt: 'edge', keyBand: m.keyBand ?? KEY_BAND, key: m.key !== 'off' ? m.key : (m.keyWas ?? 'darker') }
    } else {
      const keyAt = to === 'again' ? (m.keyAt ?? 'all') : to
      // Switched back on, it is as it was; only a mask never matched reads the photo.
      const back = m.key === 'off' && m.keyWas && to !== 'again' ? m.keyWas : null
      const found = image && !back && (to === 'again' || m.key === 'off') ? findKey(image.bitmap, m, photoFrameOf(image.size, blend), shapeFrame(image.size, blend), m.keyBand ?? KEY_BAND) : null
      patch = {
        keyAt,
        keyBand: m.keyBand ?? KEY_BAND,
        ...(back
          ? { key: back }
          : found
            ? { key: found.key, keyOn: found.keyOn, keyLevel: found.keyLevel, keySoftness: found.keySoftness }
            : m.key === 'off'
              ? { key: 'darker' as const }
              : {}),
      }
      if (to === 'again' && !found) setStatus('Could not tell the subject from what is round it here.')
    }
    setMasks(blend.effects.masks.map((x, j) => (j === i ? { ...x, ...patch } : x)), `${WHOLE_STEP}matching ${m.name} to the photo`)
  }
  /**
   * The photo's colour in each cell of a mask's raster, for the brush that
   * paints only over similar colours: drawn once per raster (and photo),
   * when a stroke starts, and kept while it is painted.
   */
  const cellLab = useRef<{ key: string; lab: Float32Array } | null>(null)
  const labOf = (m: MaskShape): Float32Array | null => {
    const r = m.raster
    if (!r || !image) return null
    const photo = photoFrameOf(image.size, blend)
    const shapes = shapeFrame(image.size, blend)
    const key = JSON.stringify([image.sha, r.w, r.h, r.x, r.y, r.width, r.height, photo, shapes])
    if (cellLab.current?.key === key) return cellLab.current.lab
    const bw = image.bitmap.width
    const bh = image.bitmap.height
    // A cell's edge, as a pixel of the photo (the inverse of the brush's toCell).
    const px = (cx: number) => ((shapes.x + (r.x + (cx / r.w) * r.width) * shapes.width - photo.x) / photo.width) * bw
    const py = (cy: number) => ((shapes.y + (r.y + (cy / r.h) * r.height) * shapes.height - photo.y) / photo.height) * bh
    try {
      const c = new OffscreenCanvas(r.w, r.h)
      const g = c.getContext('2d', { willReadFrequently: true })
      if (!g) return null
      g.drawImage(image.bitmap, px(0), py(0), px(r.w) - px(0), py(r.h) - py(0), 0, 0, r.w, r.h)
      const lab = cellColours(g.getImageData(0, 0, r.w, r.h).data, r.w * r.h)
      cellLab.current = { key, lab }
      return lab
    } catch {
      return null
    }
  }
  /** The mask being painted as it was when the stroke began. */
  const strokeBase = useRef<MaskShape | null>(null)
  const strokeCount = useRef(0)
  const paintStroke = (points: { x: number; y: number }[], done: boolean) => {
    if (!brushing || !image) return
    const i = brushing.index
    const now = blend.effects.masks[i]
    if (!now?.raster) return
    const fresh = strokeBase.current?.id !== now.id
    const base = fresh ? now : strokeBase.current!
    if (fresh) strokeCount.current++
    strokeBase.current = done ? null : base
    const lab = brushByColour ? labOf(base) : null
    const painted = paintRaster(base, points, brushing.mode, brushSize, photoFrameOf(image.size, blend), shapeFrame(image.size, blend), lab ? { lab, range: brushRange() } : undefined)
    setMasks(
      blend.effects.masks.map((x, j) => (j === i ? painted : x)),
      // Its own step, named, the rest of the stroke folding into it: two
      // strokes in a row are two undos.
      fresh ? `${WHOLE_STEP}painting ${now.name}` : `mask${i}:paint${strokeCount.current}`,
    )
  }
  // Precise selection: whether its models are here; a download asked for on the welcome sheet and not finished goes on (after a moment, so opening stays quick).
  useEffect(() => {
    if (!isNative()) return
    void checkPrecise().then((s) => {
      if (s.kind === 'none' && preciseWantedStore.get()) setTimeout(() => void downloadPrecise(), 8000)
    })
  }, [])
  // Enter or Esc puts the brush down; [ and ] size it, as in other editors.
  useEffect(() => {
    if (!brushing) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Typing, or a dialog open over the photo: its keys are the dialog's.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Enter' || e.key === 'Escape') setBrushing(null)
      else if (e.key === '[') setBrushSize(Math.max(0.004, Math.round(brushSize * 0.8 * 1000) / 1000))
      else if (e.key === ']') setBrushSize(Math.min(0.25, Math.round(brushSize * 1.25 * 1000) / 1000))
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [brushing, brushSize, setBrushSize])
  // Enter, Esc or Return finish setting the crop, as they do placing anything.
  useEffect(() => {
    if (!editingCrop) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      const el = e.target as HTMLElement | null
      // Typing, or a dialog open over the photo: its keys are the dialog's.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      setEditingCrop(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editingCrop])
  // And editing lights on the photo (drawing has its own keys, in LightOverlay).
  useEffect(() => {
    if (!lightEditing || lightDrawing) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      // Typing, or a dialog open over the photo: its keys are the dialog's.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'Enter' || e.key === 'Escape') setLightEditing(false)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [lightEditing, lightDrawing])
  // (Laying a streak's guides has its keys in StreakGuideOverlay: Enter
  // finishes the guide being placed, then guiding.)
  // And setting Repeat's points.
  useEffect(() => {
    if (!editingRepeat) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      // Cancel sends its own Esc to what is being drawn (a piece): that one is not ours.
      if (!e.isTrusted) return
      const el = e.target as HTMLElement | null
      // Typing, or a dialog open over the photo: its keys are the dialog's.
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return
      if (document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      e.stopImmediatePropagation()
      // Enter is Done; Esc is Cancel, as everywhere else: the points and moves made go back.
      if (e.key === 'Escape') cancelFamilyRef.current('repeat')
      else setEditingRepeat(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [editingRepeat])
  const [editingBands, setEditingBands] = useState(false)
  // Collage: editing on the photo, the selected piece, an image waiting for a gap.
  const [editingCollage, setEditingCollage] = useState(false)
  const [selectedPiece, setSelectedPiece] = useState<number | null>(null)
  const [armedImage, setArmedImage] = useState<string | null>(null)
  // Arrange: clicks on the photo choose the cells (see CollageArrange).
  const [arranging, setArranging] = useState(false)
  // Bumped when a collage image loads or the photo is analysed, to render again.
  const [collageTick, setCollageTick] = useState(0)
  // The brightness a slider (or the tone strip) is pointing at, tinted on the photo.
  const [toneHighlight, setToneHighlight] = useState<ToneRange | null>(null)
  useEffect(() => onCollageImage(() => setCollageTick((t) => t + 1)), [])
  const [editingGuides, setEditingGuides] = useState(false)
  const [editingStreaks, setEditingStreaks] = useState(false)
  const [keepBorderColour, setKeepBorderColour] = useLocalStorage('ui.keepBorderColour', true)
  const [previewGrade, setPreviewGrade] = useState<Partial<GradeParams> | null>(null)
  const [drawingStreak, setDrawingStreak] = useState(false)
  // Masks (left panel): drawing a new one, showing them on the photo to
  // select and reshape, and which is open.
  const [maskDrawing, setMaskDrawing] = useState(false)
  // The module whose Mask menu started the mask being drawn or placed, and
  // on which side: the new mask is used there as soon as it is made.
  const [newTarget, setNewTarget] = useState<NewMaskTarget | null>(null)
  const [maskEditing, setMaskEditing] = useState(false)
  // A radial or gradient mask being placed: drag on the photo to make it.
  const [maskPlacing, setMaskPlacing] = useState<'radial' | 'gradient' | null>(null)
  // Reshaping one mask on its own, the others' outlines out of the way.
  const [maskSolo, setMaskSolo] = useState(false)
  const [selectedMask, setSelectedMask] = useState<number | null>(null)
  // Drawing a path for the selected streak to flow along.
  const [drawingPath, setDrawingPath] = useState(false)
  // What is drawn while drawingPath: the flow's path, or a trail's end line.
  const [pathKind, setPathKind] = useState<'path' | 'ends'>('path')
  const [selectedStreak, setSelectedStreak] = useState<number | null>(null)
  /**
   * Editing one streak on the photo (StreakSessionBar): which, with which
   * tool, from which history row (Cancel goes back to it, Done makes what
   * was done one step), on which photo. Its tool runs on the on-photo modes
   * below (editingStreaks, drawingPath, fixEditing, guidingStreak).
   */
  const [streakSession, setStreakSession] = useState<{ index: number; tool: StreakTool; row: number; photo: string | null } | null>(null)
  // The selected streak's colour fix, and placing a new one on the photo.
  const [selectedFix, setSelectedFix] = useState<number | null>(null)
  const [fixEditing, setFixEditing] = useState<FixEditing>(null)
  useEffect(() => {
    setSelectedFix(null)
    setFixEditing(null)
  }, [selectedStreak])
  // Which of a streak's settings tabs is showing; the same for every streak.
  const [streakTab, setStreakTab] = useState<StreakTab>('way')
  const [selectedGuide, setSelectedGuide] = useState<number | null>(null)
  const [guideSign, setGuideSign] = useState<1 | -1>(1)
  // Bumped when a look, preset or snapshot is applied: sliders reset to the
  // values they showed at that moment.
  const [baseline, setBaseline] = useState(0)
  const [selectedSpot, setSelectedSpot] = useState<number | null>(null)
  // A leak shape being drawn with the shape editor.
  const [drawingLeakShape, setDrawingLeakShape] = useState(false)
  const [placeKind, setPlaceKind] = useState<LeakKind>('light')
  // Leaks are placed as round spots; shapes where light falls are drawn in Lighting.
  const placeShape = 'spot' as 'spot' | 'shape'
  const [draft, setDraft] = useState<Point[] | null>(null)
  const [dropperTarget, setDropperTarget] = useState<{
    id: string
    apply: (c: Rgb | null) => void
    without?: (b: BlendParams) => BlendParams
    /** What this field reads, when it asks for one (a colour picked to keep reads the original). */
    from?: DropFrom
  } | null>(null)
  const [chosenFrom, setDropFrom] = useLocalStorage<DropFrom>('ui.dropFrom', 'edited')
  const dropFrom: DropFrom = dropperTarget?.from ?? chosenFrom
  // The edited picture the dropper reads, rendered once when sampling starts.
  // Frozen, so a held preview does not sample its own result.
  const dropFrame = useRef<ImageData | null>(null)
  const dropEngine = useRef<GrainEngine | null>(null)
  // Set once a held sample has previewed a colour, so Esc knows to put the
  // original back.
  const previewing = useRef(false)
  const dropper = useMemo<Dropper>(
    () => ({
      activeId: dropperTarget?.id ?? null,
      start: (id, apply, without, from) => {
        previewing.current = false
        setDropperTarget({ id, apply, without, from })
      },
      cancel: () => {
        if (previewing.current) dropperTarget?.apply(null)
        previewing.current = false
        setDropperTarget(null)
      },
      from: dropFrom,
      setFrom: setDropFrom,
    }),
    [dropperTarget, dropFrom, setDropFrom],
  )
  // The same palette the engine reads for "from the photo" colours, for the
  // swatches in the panel.
  const [source, setSource] = useState<GrainSource | null>(null)
  const [grain, setGrain] = useState<GrainTexture | null>(null)
  /** The source `grain` was made from: until it is the current one, the preview waits. */
  const [grainFrom, setGrainFrom] = useState<GrainSource | null>(null)
  // Read once, synchronously, so the first render is already the restored look.
  const [restored] = useState(loadSession)
  const [exportFolder, setExportFolder] = useState<Folder | null>(null)
  // The last export saved into the folder, to show in the Finder.
  const [lastExport, setLastExport] = useState<string | null>(null)
  // An opened export whose original still has to be found.
  const [pendingRecipe, setPendingRecipe] = useState<Recipe | null>(null)
  // The export that was opened while its recipe waits for an original, so it
  // can still be opened as a plain image; `locked` when the export folder just
  // needs its permission confirmed again.
  const [pendingFile, setPendingFile] = useState<{ file: File | Blob; name: string; locked: boolean } | null>(null)
  const locateInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    getExportFolder().then(setExportFolder)
  }, [])
  // Set when the page is served by the launcher, which can be quit from here.
  const [launcher, setLauncher] = useState(false)
  const [stopped, setStopped] = useState(false)
  const restoreDone = useRef(false)
  const [blend, setBlendNow] = useState<BlendParams>(restored?.doc.blend ?? STARTING_LOOK.doc.blend)
  // A switched-off module whose control was just touched: the change it
  // makes switches it back on too, in the same step (see Module's wake).
  const waking = useRef<StackModuleId | null>(null)
  /** The module whose controls are being used right now (pointer or key down in its body), if any. */
  const touching = useRef<StackModuleId | null>(null)
  /** Modules turned down to nothing by their own controls: their switch stays on (see setBlend). */
  const keptOn = useRef<Set<StackModuleId>>(new Set())
  const [, setKeptVersion] = useState(0)
  /** See stackApi.startFrom: the module switched on, the history row it made, and whether its photo mode began. */
  const startedFor = useRef<{ index: number; modes: string[]; at: number } | null>(null)
  const setBlend = useCallback((next: SetStateAction<BlendParams>) => {
    const id = waking.current
    waking.current = null
    const t = touching.current
    setBlendNow((prev) => {
      const value = typeof next === 'function' ? next(prev) : next
      // A module's own control taking it to nothing (a strength dragged to 0)
      // leaves its switch on: you turned it down, not off. Any other change
      // (a recipe, undo, another photo) goes back to what the settings say.
      const kept = t && inUse(t, prev) && !inUse(t, value)
      if (kept || (!t && keptOn.current.size)) {
        const nextKept = new Set(t ? keptOn.current : [])
        if (kept) nextKept.add(t)
        keptOn.current = nextKept
        queueMicrotask(() => setKeptVersion((v) => v + 1))
      }
      if (!id) return value
      // Touched while off: on with the change. A module never used whose
      // change alone does nothing yet (a radius with no strength) starts as
      // adding it would, keeping the change.
      const on = switchOn(id, value)
      return inUse(id, on) ? on : startModule(id, on)
    })
  }, [])
  /** The edit as of the last render, for callbacks that run after it (stackApi.startFrom). */
  const blendRef = useRef(blend)
  blendRef.current = blend
  // The browser starts at the size it exports (WEB_EXPORT); the app at the photo's own.
  const [output, setOutput] = useState<OutputSettings>(restored?.doc.output ?? (isDesktop() ? DEFAULT_OUTPUT : { ...DEFAULT_OUTPUT, ...WEB_EXPORT }))
  const [presets, setPresets] = useState<StoredPreset[]>([])
  const [activePresetId, setActivePresetId] = useState<string>(restored?.presetId ?? '')
  const [activeLook, setActiveLook] = useState<Look | null>(() =>
    restored ? (LOOKS.find((l) => l.id === restored.lookId) ?? null) : STARTING_LOOK,
  )
  /**
   * Undo and redo (Cmd+Z, Cmd+Shift+Z or Cmd+Y) over the whole edit: every
   * setting, the grain, export options and the look or preset it came from.
   * Selections that no longer exist after a step are let go.
   */
  const applyEdit = (to: EditState) => {
    setBlend(to.blend)
    setSource(to.source)
    setOutput(to.output)
    setActiveLook(to.look)
    setActivePresetId(to.presetId)
    const fx = to.blend.effects
    setSelectedStreak((i) => (i !== null && i < fx.streaks.shapes.length ? i : null))
    setSelectedMask((i) => (i !== null && i < fx.masks.length ? i : null))
    setSelectedSpot((i) => (i !== null && i < fx.leaks.spots.length ? i : null))
    setSelectedGuide((i) => (i !== null && i < fx.dither.guides.length ? i : null))
  }
  const editState: EditState = { blend, source, output, look: activeLook, presetId: activePresetId }
  const history = useEditHistory(editState, applyEdit)
  // The timelapse: every change since the photo was opened (see timelapse.ts),
  // played back here or made into a video.
  const [replaying, setReplaying] = useState(false)
  const replay = useRef<{ stop: boolean } | null>(null)
  const [makingVideo, setMakingVideo] = useState<number | null>(null)
  const videoAbort = useRef<AbortController | null>(null)
  // The shape being edited on the photo goes in the recording too, to show on the video.
  const editFocus: TimelapseFocus | null =
    maskEditing || maskDrawing
      ? { kind: 'mask', index: maskDrawing ? null : selectedMask }
      : editingStreaks || drawingStreak || drawingPath || fixEditing
        ? { kind: 'streak', index: drawingStreak ? null : selectedStreak }
        : null
  // Off until turned on in Settings; then it records in the background.
  const timelapse = useTimelapseSettings()
  const timelapseOn = timelapse.on
  const recorder = useTimelapseRecorder(editState, image, replaying || !timelapseOn, editFocus)
  /** Played back: the shape being edited then is selected on the photo now. */
  const showFocus = (focus: TimelapseFocus | null) => {
    if (focus?.kind === 'streak') {
      setMaskEditing(false)
      setEditingStreaks(true)
      setSelectedStreak(focus.index)
    } else if (focus?.kind === 'mask') {
      setEditingStreaks(false)
      setMaskEditing(true)
      setSelectedMask(focus.index)
    } else {
      setEditingStreaks(false)
      setMaskEditing(false)
    }
  }
  const playTimelapse = async (frames: TimelapseFrame[], seconds: number) => {
    if (frames.length < 2 || replay.current) return
    const now = editState
    const run = { stop: false }
    replay.current = run
    history.suspend()
    setReplaying(true)
    setStatus('Playing the timelapse: Esc stops')
    try {
      for (const step of buildTimeline(frames, seconds)) {
        if (run.stop) break
        applyEdit(step.state)
        showFocus(step.focus)
        await new Promise((r) => setTimeout(r, Math.max(16, step.ms)))
      }
      showFocus(null)
      if (!run.stop) await new Promise((r) => setTimeout(r, 1200))
    } finally {
      showFocus(null)
      replay.current = null
      history.resume(now)
      setReplaying(false)
      setStatus(null)
    }
  }
  useEffect(() => {
    if (!replaying) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && replay.current) replay.current.stop = true
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [replaying])
  /**
   * Render a take to an MP4. Saved into the export folder when `folder` is
   * given (beside an export), otherwise downloaded or saved through a dialog.
   */
  const makeVideo = async (
    frames: TimelapseFrame[],
    opts: { seconds: number; shape: 'reel' | 'photo'; fromOriginal: boolean },
    folder: { dir: Folder; stem: string } | null = null,
  ) => {
    if (!image) return
    const abort = new AbortController()
    videoAbort.current = abort
    setMakingVideo(0)
    try {
      const blob = await makeTimelapseVideo({
        ...opts,
        frames,
        photo: { bitmap: image.bitmap, size: image.size, seed: image.seed },
        onProgress: setMakingVideo,
        signal: abort.signal,
      })
      const mb = (blob.size / 1e6).toFixed(1)
      if (folder) {
        const name = `${folder.stem}-timelapse.mp4`
        await folder.dir.write(name, blob)
        setStatus(`Saved ${name} to ${folder.dir.name} (${mb} MB)`)
      } else {
        const stem = image.name.replace(/\.[^.]+$/, '')
        if (await downloadBlob(blob, `${stem}-timelapse.mp4`)) setStatus(`Saved the timelapse (${mb} MB)`)
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError(`Could not make the video: ${(err as Error).message}`)
    } finally {
      videoAbort.current = null
      setMakingVideo(null)
    }
  }
  // Read by the export, which is memoised.
  const withExportVideo = useRef(timelapse)
  withExportVideo.current = timelapse
  const recorderRef = useRef(recorder)
  recorderRef.current = recorder
  const makeVideoRef = useRef(makeVideo)
  makeVideoRef.current = makeVideo
  /** File › Export Timelapse Video: this photo's edit so far. */
  const exportTimelapse = async () => {
    const frames = recorder.frames()
    if (frames.length < 2) return setStatus('No timelapse yet: it records from the first change once it is on.')
    await makeVideo(frames, timelapse)
  }
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  /** Snapshots, all in one list on every photo, as they always were (each still notes the photo it was taken on). */
  const photoSnapshots = useMemo(() => (image ? snapshots : []), [snapshots, image])
  const [compareId, setCompareId] = useState<string | null>(null)
  const [wipe, setWipe] = useState(0.5)
  // How the photo is shown (state/view.ts).
  const zoom = useZoom()
  const small = useSmall()
  const igSim = useIgSim()
  const fitAsked = useFitAsked()
  const bypass = useBypass()
  const [status, setStatus] = useState<string | null>(null)
  /** The file the status line is about (an export just saved), for its Show in Finder. */
  const [statusFile, setStatusFile] = useState<{ text: string; path: string } | null>(null)
  // A notice over the photo, not a bar: it says its piece and goes, given
  // time to be read (longer ones stay longer). One for something still going
  // ("Rendering…") stays until what comes next replaces it.
  const revealable = !!status && statusFile?.text === status && isNative()
  // With Show in Finder beside it, it stays long enough to use.
  const statusMs = status ? (revealable ? Math.max(12000, statusDuration(status)) : statusDuration(status)) : 0
  useEffect(() => {
    if (!status || !Number.isFinite(statusMs)) return
    const timer = setTimeout(() => setStatus(null), statusMs)
    return () => clearTimeout(timer)
  }, [status, statusMs])
  const [error, setError] = useState<string | null>(null)
  // An error stays until dismissed, but a new message from a later action
  // replaces it (one set together with the error doesn't).
  const errorAt = useRef(0)
  useEffect(() => {
    if (error) errorAt.current = performance.now()
  }, [error])
  useEffect(() => {
    if (status && error && performance.now() - errorAt.current > 500) setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])
  const [exporting, setExporting] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  // The panels and pages around the photo (state/layout.ts).
  const leftOpen = useLeftOpen()
  const rightOpen = useRightOpen()
  const [settingsOpen, setSettingsOpen] = useState(false)
  /** The browser version: Export's way to the desktop app (GetDesktopDialog). */
  const [getDesktopOpen, setGetDesktopOpen] = useState(false)
  // What's new: the releases since the version updated from, or (from Settings) every one.
  const [whatsNewOpen, setWhatsNewOpen] = useState<'since' | 'all' | null>(null)
  /** Report a problem (Help menu, the palette, Settings, the shortcuts sheet). */
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  // The GPU still building the shaders (Windows can take minutes): said on the
  // photo, after a moment, so a quick build elsewhere shows nothing.
  const graphics = useSyncExternalStore(graphicsState.subscribe, graphicsState.get)
  const graphicsBusy = graphics.look === 'preparing' ? 'look' : graphics.streaks === 'preparing' ? 'streaks' : graphics.streaks === 'failed' ? 'failed' : null
  const [graphicsNote, setGraphicsNote] = useState<typeof graphicsBusy>(null)
  useEffect(() => {
    if (!graphicsBusy) return setGraphicsNote(null)
    if (graphicsBusy === 'failed') return setGraphicsNote('failed')
    const t = setTimeout(() => setGraphicsNote(graphicsBusy), 1500)
    return () => clearTimeout(t)
  }, [graphicsBusy])
  /**
   * The desktop app asks for a license before anything else (not in development
   * builds). 'checking' is the moment it reads the saved one.
   */
  // A build from the source asks for no key (platform/build.ts).
  const needsLicense = isNative() && !import.meta.env.DEV && OFFICIAL
  const [license, setLicense] = useState<LicenseState>(needsLicense ? 'checking' : 'valid')
  const [changingLicense, setChangingLicense] = useState(false)
  useEffect(() => {
    if (!isNative()) return
    if (needsLicense) void checkLicense().then(setLicense)
    return onLicense((e) => {
      if (e === 'change') setChangingLicense(true)
      else if (needsLicense && e !== 'checking') setLicense(e)
    })
  }, [needsLicense])
  const licenseGate = needsLicense && (license === 'none' || license === 'invalid')
  /** The browser version opened by the desktop app's "Bring in…": a link with #send=. */
  const [sendPairing, setSendPairing] = useState(() => (isNative() ? null : pairingFromHash(location.hash)))
  useEffect(() => {
    if (sendPairing) window.history.replaceState(null, '', location.pathname + location.search)
  }, [sendPairing])
  /** How the app works: shown the first time, and from Help. */
  /** The walk round the app (Tour.tsx). */
  const [tourOpen, setTourOpen] = useState(false)
  /** The Guide, open on a page (a module's from its ⋯ menu, Getting started from Help and ⌘K). */
  const [guidePage, setGuidePage] = useState<GuidePage | null>(null)
  useEffect(() => {
    const open = (e: Event) => {
      const page = (e as CustomEvent<GuidePage>).detail
      track('guide', page)
      setGuidePage(page)
    }
    window.addEventListener('grain:open-guide', open)
    return () => window.removeEventListener('grain:open-guide', open)
  }, [])
  const [introOpen, setIntroOpen] = useState(() => {
    try {
      return localStorage.getItem('ui.introSeen') !== '1'
    } catch {
      return false
    }
  })
  const closeIntro = useCallback(() => {
    setIntroOpen(false)
    try {
      localStorage.setItem('ui.introSeen', '1')
    } catch {
      /* shown again next time */
    }
  }, [])
  const leftWidth = useLeftWidth()
  const rightWidth = useRightWidth()
  const imageInput = useRef<HTMLInputElement>(null)
  /*
   * The filmstrip (Filmstrip.tsx): folders of photos, desktop app only. None
   * until a folder is added; then it can be shown or hidden (PANEL_KEYS.strip).
   */
  const [library, setLibraryState] = useState<Library>({ folders: [], current: RECENT })
  useEffect(() => {
    if (libraryAvailable()) void loadLibrary().then(setLibraryState)
  }, [])
  const setLibrary = (lib: Library) => {
    setLibraryState(lib)
    void saveLibrary(lib)
  }
  const stripOpen = useStripOpen()
  const libraryShown = useLibraryShown()
  // Recent's size, so the filmstrip and Library have something to show before any folder is added.
  const [recentCount, setRecentCount] = useState(0)
  useEffect(() => {
    if (!libraryAvailable()) return
    void loadRecent().then((list) => setRecentCount(list.length))
    return onRecent((list) => setRecentCount(list.length))
  }, [])
  // Opening on the Library, when Settings says so (the photo still opens
  // underneath), and the first time the app opens: the welcome over it.
  useEffect(() => {
    if (libraryAvailable() && (launchStore.get() === 'library' || introOpen)) setLibraryShown(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const reduceMotion = useReduceMotion()
  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion)
  }, [reduceMotion])
  // The side panels and filmstrip animate out before their space is given back (useLingering).
  const leftPanel = useLingering(leftOpen)
  const rightPanel = useLingering(rightOpen)
  /** The desktop app has a library, empty or not; a browser has none. */
  const hasLibrary = libraryAvailable()
  const libraryHasPhotos = library.folders.length > 0 || recentCount > 0
  const inLibrary = libraryShown && hasLibrary
  const stripShown = hasLibrary && libraryHasPhotos && stripOpen
  const strip = useLingering(stripShown)
  /** Where the open photo came from in the strip; null if opened another way. */
  const [openPath, setOpenPath] = useState<string | null>(null)
  /** A photo being opened: the preview waits for its edit (see openImage). */
  const [openingPhoto, setOpeningPhoto] = useState(false)
  /** A photo being opened from the filmstrip or library: its thumbnail, shown until its first picture is in. */
  const [cover, setCover] = useState<string | null>(null)
  const opening = useRef<PhotoFile | null>(null)

  useEffect(() => {
    const reason = storageUnavailableReason()
    if (reason) setStatus(reason)
    onStorageBlocked((blocked) => setStatus(blocked ?? 'Storage is available again — your work is being saved.'))
    // A save that didn't go through: said once a minute at most, as an error that stays until dismissed.
    let saidAt = 0
    onSaveFailed((store, reason) => {
      // What failed, for fixing it: the store and the error, never a record's name (a folder's path can be in it).
      reportIssue(`Save failed: ${store}`, 'warning', { store, reason: scrub(reason) }, ['save-failed', store])
      if (Date.now() - saidAt < 60_000) return
      saidAt = Date.now()
      setError(
        isNative()
          ? "Couldn't save to copyshop's data folder just now. Your latest changes may not be kept: export anything you need."
          : "Couldn't save in this browser just now (its storage may be full, or this is a private window). Your latest changes may not be kept: export anything you need.",
      )
    })
    listPresets().then(setPresets)
    // Start on the starting look's generated grain rather than whichever plate
    // happens to be first in the library: it is the one the defaults are tuned
    // for, and it works before the user has any scans.
    // A restored session brings its own source back; a plate that has since
    // been deleted from the library falls back to the starting look's grain.
    const start = restored?.doc.grainSource ?? STARTING_LOOK.doc.grainSource
    hydrateGrainSource(start)
      .catch(() => hydrateGrainSource(STARTING_LOOK.doc.grainSource))
      .then((src) => setSource((current) => current ?? src))
    // And the photo that was open, then the snapshots taken of it.
    loadPhoto().then(async (photo) => {
      try {
        if (!photo) return
        // A photo kept by its path opens as opening it from the library
        // would: an export finds its original, and the photo's own saved
        // edit comes back. (Opened as it is, an export in place of its
        // photo came back with the look baked in, and the edit on top.)
        const [file] = photo.path && isNative() ? await photoStats([photo.path]) : []
        if (file) {
          opening.current = file
          await openImage(photo.blob, photo.name)
          opening.current = null
        } else {
          const loaded = await loadImageFile(photo.blob, photo.name, false)
          // The edit the session kept is this photo's edit.
          if (loaded) {
            editBase.current = { sha: loaded.sha, saved: true }
            history.reset(OPENED_EDITED)
          }
        }
        const records = loadSnapshotRecords()
        const rebuilt: Snapshot[] = []
        for (const r of records) {
          try {
            // Its grain is made when it is first compared (snapGrain), not now.
            const snapSource = await hydrateGrainSource(r.doc.grainSource)
            rebuilt.push({
              id: r.id,
              name: r.name,
              createdAt: r.createdAt,
              blend: r.doc.blend,
              source: snapSource,
              grain: null,
              thumb: r.thumb,
              photo: r.photo,
              photoName: r.photoName,
            })
          } catch {
            /* its plate is gone from the library; skip it */
          }
        }
        // Ones taken before snapshots kept their photo's name: it is looked up from that photo's edit.
        for (const snap of rebuilt)
          if (snap.photo && !snap.photoName) snap.photoName = (await loadEdit(snap.photo).catch(() => null))?.name
        if (rebuilt.length) setSnapshots((current) => (current.length ? current : rebuilt))
      } finally {
        restoreDone.current = true
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save the session as it changes, lightly debounced so dragging a slider
  // does not write on every frame.
  useEffect(() => {
    if (!source) return
    const timer = setTimeout(
      () =>
        saveSession({
          doc: {
            schemaVersion: PRESET_SCHEMA_VERSION,
            name: 'Session',
            grainSource: source.serialize(),
            blend,
            output,
          },
          lookId: activeLook?.id ?? null,
          presetId: activePresetId,
        }),
      250,
    )
    return () => clearTimeout(timer)
  }, [blend, output, source, activeLook, activePresetId])

  /*
   * Each photo's edit, saved as it changes, under the photo's SHA-256
   * (storage/photoEdits.ts): opening it again brings the edit back. A photo
   * opened and left as it started is not saved. `editBase` is the open
   * photo; `saved` once its edit has been kept (or came from a saved edit).
   */
  const editBase = useRef<{ sha: string; saved: boolean; sig?: string; edited?: boolean } | null>(null)
  const pendingEdit = useRef<(() => void) | null>(null)
  const editVersion = useRef(0)
  const editThumbs = useRef(new Map<string, string>())
  const writeEdit = (img: LoadedImage, b: BlendParams, src: GrainSource, look: Look | null, presetId: string) => {
    // The photo as it was edited, kept small in the app's data: what a new
    // version written over it is matched against (handleNewVersion).
    void keepReference(img.sha, img.bitmap).catch(() => undefined)
    // Made small now: the photo itself is closed soon after another opens.
    const small = bigOf(img.bitmap)
    const doc: PresetDoc = { schemaVersion: PRESET_SCHEMA_VERSION, name: img.name, grainSource: src.serialize(), blend: b, output: DEFAULT_OUTPUT }
    const edit: PhotoEdit = {
      id: img.sha,
      name: img.name,
      doc,
      lookId: look?.id ?? null,
      presetId,
      thumb: editThumbs.current.get(img.sha) ?? '',
      updatedAt: Date.now(),
    }
    const version = ++editVersion.current
    // The app waits for it before quitting (platform/quit.ts).
    void keepUntilWritten(saveEdit(edit)).then(() =>
      editThumb(small, b.photoSeed ?? img.seed, doc, b)
        .then((thumb) => {
          // A later save of the edit carries its own thumbnail; this one is out of date.
          if (version !== editVersion.current) return
          editThumbs.current.set(img.sha, thumb)
          return saveEdit({ ...edit, thumb, thumbFor: thumbKey(edit.updatedAt) })
        })
        .catch(() => undefined),
    )
  }
  /** Save the open photo's edit now, if a save is waiting: before another photo opens. */
  const flushEdit = () => pendingEdit.current?.()
  useEffect(() => {
    if (!image || !source || replaying) return
    const base = editBase.current
    if (!base || base.sha !== image.sha) return
    // Saved only when it changed from what was opened or last saved, and
    // only once something has been done to it: what opening a photo sets by
    // itself (its palette, its grain's size) is not an edit, and saving it
    // again marked a photo merely looked at as changed since its export.
    const sig = stableJson({ blend, grain: source.serialize(), look: activeLook?.id ?? null, preset: activePresetId })
    if (sig === base.sig) return
    if (!base.edited && !history.steps()) {
      base.sig = sig
      return
    }
    base.edited = true
    const save = () => {
      base.sig = sig
      pendingEdit.current = null
      base.saved = true
      writeEdit(image, blend, source, activeLook, activePresetId)
    }
    pendingEdit.current = save
    const timer = setTimeout(save, 700)
    return () => {
      clearTimeout(timer)
      // Overtaken by the next change: this save is not waiting any more. Left
      // waiting, a change taken back within the wait (Cancel, Esc, undo) to
      // what was saved left nothing new to save, and quitting or opening
      // another photo then wrote the change that was taken back.
      if (pendingEdit.current === save) pendingEdit.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend, source, activeLook, activePresetId, image, replaying])
  // copyshop://open#… from the playground's Desktop app button: the photo and
  // edit it is sending, waited for, then opened (the open photo's edit saved first).
  useEffect(() => {
    const seen = new Set<string>()
    startDeepLinks((url) => {
      const pair = pairingFromAppLink(url)
      if (!pair || seen.has(pair.id)) return
      seen.add(pair.id)
      setStatus('Getting the photo from the playground…')
      const before = async () => {
        flushEdit()
        await settleWrites(1500)
        // A session save waiting on its moment goes before the playground's is written.
        await new Promise((r) => setTimeout(r, 300))
      }
      receivePairing(pair, AbortSignal.timeout(180_000), { only: photoOnly, before })
        .then(() => {
          setStatus('Opening the photo from the playground.')
          setTimeout(() => location.reload(), 300)
        })
        .catch((e: Error) =>
          setError(e.name === 'TimeoutError' ? "The photo from the playground didn't arrive. Press Desktop app there again." : `The photo from the playground didn't come across: ${e.message}`),
        )
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    const leave = () => flushEdit()
    window.addEventListener('pagehide', leave)
    // The desktop app never gets pagehide: it asks before quitting instead.
    const stop = onBeforeQuit(leave)
    startQuitHandling()
    return () => {
      window.removeEventListener('pagehide', leave)
      stop()
    }
  }, [])

  const generator = useGrainGenerator(source, setSource)
  const setGen = (patch: Partial<ProceduralGrainParams>) => generator.setParams({ ...generator.params, ...patch })

  // A recipe chosen, its grain still being made: the picture says it is updating.
  const [lookPending, setLookPending] = useState(false)
  const applyLook = async (look: Look) => {
    setLookPending(true)
    try {
      const next = await hydrateGrainSource(look.doc.grainSource)
      track('recipe', look.id)
      history.hint(`${WHOLE_STEP}the ${look.label} recipe`)
      setSource(next)
      // Export settings and the border are the user's, not part of a look.
      setBlend(keepOwn(blend, look.doc.blend, look.doc.placed))
      setBaseline((g) => g + 1)
      setSelectedSpot(null)
      setActiveLook(look)
      setActivePresetId('')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLookPending(false)
    }
  }

  /** This section's current settings, for saving as a section preset. */
  const partOf = (kind: PartKind) => extractPart(kind, blend, source?.serialize() ?? null)

  /** Apply a section preset: only that section changes. */
  const applyPart = async (part: StoredPart, step?: string) => {
    // A preset that comes with the app by its name, or one from a built-in recipe; one of yours is "own".
    track('module_preset', part.kind, part.builtIn && !part.id.startsWith('preset:') ? part.name : 'own')
    try {
      const current = source?.serialize() ?? STARTING_LOOK.doc.grainSource
      // As the preset has it, its paper colour too.
      const next = applyPartData(part.data, blend, current)
      const grainNext = part.data.grainSource ? await hydrateGrainSource(next.grainSource) : null
      history.hint(`${WHOLE_STEP}${step ?? `the ${PART_LABELS[part.kind]} preset “${part.name}”`}`)
      if (grainNext) setSource(grainNext)
      setBlend(next.blend)
      setBaseline((g) => g + 1)
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** The edit with some of a recipe's modules put in, each as its module preset would. */
  const withParts = (doc: PresetDoc, kinds: PartKind[]) => {
    let next = { blend, grainSource: source?.serialize() ?? STARTING_LOOK.doc.grainSource }
    for (const kind of kinds) next = applyPartData(extractPart(kind, doc.blend, doc.grainSource), next.blend, next.grainSource)
    return next
  }
  /** Mix in: those modules from a recipe, the rest of the edit kept. One step. */
  const mixRecipe = async (doc: PresetDoc, name: string, kinds: PartKind[]) => {
    try {
      const next = withParts(doc, kinds)
      const grainNext = kinds.includes('grain') ? await hydrateGrainSource(next.grainSource) : null
      history.hint(`${WHOLE_STEP}${kinds.map((k) => PART_LABELS[k]).join(', ')} from ${name}`)
      if (grainNext) setSource(grainNext)
      setBlend(next.blend)
      setBaseline((g) => g + 1)
      // From the recipe in use, it's putting its own modules back.
      const own = doc === (activeLook?.doc ?? presets.find((p) => p.id === activePresetId)?.data)
      setStatus(`${own ? 'Put back' : 'Added'} ${kinds.map((k) => PART_LABELS[k]).join(', ')} from ${name}.`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** The look or saved preset the settings came from, as it was designed or saved. */
  const activeDoc = activeLook?.doc ?? presets.find((p) => p.id === activePresetId)?.data ?? null
  const lookEdited = useMemo(() => {
    if (!activeDoc) return false
    // The recipe in another of its palettes is still the recipe.
    const designed = activePresetId ? activeDoc.blend : designedIn(activeDoc.blend, blend, palettesFor(activeLook?.id))
    return (
      // An edit saved before glow was fitted to the photo has no say on it: not a change from the recipe.
      stableJson(keepOwn(designed, blend.effects.glowFit === undefined ? { ...blend, effects: { ...blend.effects, glowFit: designed.effects.glowFit } } : blend, activeDoc.placed)) !==
        stableJson(designed) ||
        stableJson(withGrainDefaults(source?.serialize().params)) !== stableJson(withGrainDefaults(activeDoc.grainSource.params))
    )
  }, [activeDoc, activeLook, activePresetId, blend, source])

  // Every source kind resolves to a texture through this one call.
  useEffect(() => {
    let cancelled = false
    if (!source) {
      setGrain(null)
      return
    }
    source
      .getTexture(image ? { targetSize: image.size } : undefined)
      .then((tex) => {
        if (cancelled) return
        setGrain(tex)
        setGrainFrom(source)
      })
      .catch((err) => !cancelled && setError((err as Error).message))
    return () => {
      cancelled = true
    }
  }, [source, image])

  /** An export's original is being loaded in its place (restoreFromRecipe): see LoadedImage.fromExport. */
  const loadingOriginal = useRef(false)
  /** How the next photo is being opened, for usage counts: sample, drop, open (the desktop Open dialog), file. */
  const openVia = useRef('file')
  /** The photo just decoded, for redrawing its library thumbnail as its edit comes back. */
  const lastLoaded = useRef<{ bitmap: ImageBitmap; seed: number; sha: string } | null>(null)
  const loadImageFile = useCallback(async (file: File | Blob, name: string, remember = true): Promise<(Size & { sha: string }) | null> => {
    // Read now: the open has moved on by the time React shows the photo.
    const from = opening.current ?? undefined
    const via = openVia.current !== 'file' ? openVia.current : from ? 'library' : 'file'
    openVia.current = 'file'
    const fromExport = loadingOriginal.current
    // How long each step takes, reported when opening is slow (telemetry.ts).
    const timing = stepTimer()
    try {
      // A RAW file is developed first, as the camera set it (pipeline/raw.ts).
      const raw = isRawName(name)
      const sha = await sha256(file)
      timing.step('hash')
      // In sRGB, with the photo's own colour profile applied (see decodePhoto).
      // Decoded already if it was one of the last few open: the same picture,
      // so the render engine's work on it (its texture, its masks) is reused.
      const bitmap = decodedPhotos.get(sha) ?? (await decodePhoto(raw ? await developRaw(file, name, sha) : file, name))
      timing.step(raw ? 'develop and decode' : 'decode')
      keepDecoded(sha, bitmap)
      const seed = photoSeed(sha)
      lastLoaded.current = { bitmap, seed, sha }
      const date = await readPhotoDate(file)
      timing.step('date')
      photoDate.current = date
      if (remember) track('photo_open', via, raw ? 'raw' : null)
      // Kept for the next reload; the restore path passes remember = false.
      if (remember) void (from ? savePhotoPath(from.path, name) : savePhoto(file, name))
      setImage((prev) => {
        // Freed a moment later, not now: a render or palette read already
        // queued for the old photo would otherwise draw a closed bitmap
        // ("the image source is detached"), as when two loads overlap.
        if (prev && prev.bitmap !== bitmap && !isKeptDecoded(prev.bitmap)) setTimeout(() => prev.bitmap.close(), 2000)
        openBitmap = bitmap
        return {
          bitmap,
          size: { width: bitmap.width, height: bitmap.height },
          name,
          file,
          seed,
          sha,
          raw,
          date,
          ...(from ? { from } : {}),
          ...(from && fromExport ? { fromExport } : {}),
        }
      })
      setHistogram(computeHistogram(bitmap))
      timing.step('histogram')
      timing.reportIfSlow('Slow photo open', { megapixels: Math.round((bitmap.width * bitmap.height) / 1e5) / 10, raw, bytesMB: Math.round(file.size / 1e5) / 10 })
      setError(null)
      return { width: bitmap.width, height: bitmap.height, sha }
    } catch (err) {
      // decodePhoto's errors are already written for people (pipeline/formats.ts).
      setError(
        isRawName(name) && !isDesktop()
          ? cannotOpenMessage(name)
          : isRawName(name)
          ? `Could not open ${name}: ${(err as Error).message}`
          : (err as Error).message || cannotOpenMessage(name),
      )
      return null
    }
  }, [])

  // Snapshots belong to the photo, so they are kept with it. Nothing is saved
  // until the restore has finished, or the empty list at startup would
  // overwrite the saved one.
  useEffect(() => {
    if (!restoreDone.current) return
    saveSnapshotRecords(
      snapshots.map((snap) => ({
        id: snap.id,
        name: snap.name,
        createdAt: snap.createdAt,
        thumb: snap.thumb,
        ...(snap.photo ? { photo: snap.photo } : {}),
        ...(snap.photoName ? { photoName: snap.photoName } : {}),
        doc: {
          schemaVersion: PRESET_SCHEMA_VERSION,
          name: snap.name,
          grainSource: snap.source.serialize(),
          blend: snap.blend,
          output: DEFAULT_OUTPUT,
        },
      })),
    )
  }, [snapshots, image])

  const [exportPresets, setExportPresets] = useExportPresets()
  const exportPreset = presetOf(output, exportPresets)

  const currentDoc = useCallback(
    (name: string): PresetDoc | null =>
      source
        ? {
            schemaVersion: PRESET_SCHEMA_VERSION,
            name,
            grainSource: source.serialize(),
            blend,
            output,
          }
        : null,
    [blend, output, source],
  )

  /** Keep the current settings as a look: a new one, or into the active one of yours. */
  const onSavePreset = async (name: string, existingId?: string, includePlaced = false) => {
    const doc = currentDoc(name)
    if (!doc) {
      setError('Select or generate a grain source before saving a recipe.')
      return
    }
    // Streaks, masks and the collage are placed on this photo: a look leaves
    // them out unless asked to keep them.
    if (includePlaced && hasPlaced(doc.blend)) doc.placed = true
    else doc.blend = withoutPlaced(doc.blend)
    // Updating keeps what you wrote about it.
    const described = existingId ? presets.find((p) => p.id === existingId)?.data.description : undefined
    if (described) doc.description = described
    const saved = await savePreset(doc, existingId)
    setPresets(await listPresets())
    setActivePresetId(saved.id)
    setActiveLook(null)
    setStatus(existingId ? `Updated “${doc.name}”.` : `Saved “${doc.name}”.`)
  }

  const onUpdatePreset = () => {
    const active = presets.find((p) => p.id === activePresetId)
    if (active) void onSavePreset(active.data.name, active.id, active.data.placed)
  }

  /** What your recipe is for, written beside it and carried when it is shared. */
  const onDescribePreset = async (description: string) => {
    const active = presets.find((p) => p.id === activePresetId)
    if (!active) return
    const { description: _old, ...rest } = active.data
    await savePreset(description.trim() ? { ...rest, description: description.trim() } : rest, active.id)
    setPresets(await listPresets())
  }

  /** A new name only: what the look holds stays as it was saved. */
  const onRenamePreset = async (name: string, id = activePresetId) => {
    const active = presets.find((p) => p.id === id)
    if (!active) return
    await savePreset({ ...active.data, name }, active.id)
    setPresets(await listPresets())
    setStatus(`Renamed to “${name}”.`)
  }

  const applyPreset = async (preset: StoredPreset) => {
    try {
      const next = await hydrateGrainSource(preset.data.grainSource)
      track('recipe', 'own')
      history.hint(`${WHOLE_STEP}the recipe “${preset.data.name}”`)
      setSource(next)
      // Look presets leave the border alone; it has its own presets.
      setBlend(keepOwn(blend, preset.data.blend, preset.data.placed))
      setBaseline((g) => g + 1)
      // How it is exported is yours, not the recipe's: see the export presets.
      setActivePresetId(preset.id)
      setActiveLook(null)
      setError(null)
      setStatus(`Applied “${preset.data.name}”.`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const onImportPreset = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file) return
    try {
      const doc = parsePreset(JSON.parse(await file.text()))
      const saved = await savePreset(doc)
      setPresets(await listPresets())
      await applyPreset({ ...saved, data: doc })
    } catch (err) {
      setError(`That recipe file couldn't be read: ${(err as Error).message}`)
    }
  }

  const onExportPreset = () => {
    const active = presets.find((p) => p.id === activePresetId)
    const doc = currentDoc(active?.data.name ?? activeLook?.label ?? 'Untitled')
    if (!doc) return
    const description = active?.data.description ?? activeLook?.hint
    if (description) doc.description = description
    // A recipe to share: without what is placed on this photo.
    doc.blend = withoutPlaced(doc.blend)
    void downloadBlob(new Blob([presetToJson(doc)], { type: 'application/json' }), `${doc.name}.json`)
  }

  const onDeletePreset = async (id = activePresetId) => {
    const active = presets.find((p) => p.id === id)
    if (!active || !(await confirmWith(`Delete the recipe “${active.data.name}”? ${id === activePresetId ? 'The current settings stay as they are.' : 'Photos edited with it keep their edits.'}`))) return
    await deletePreset(active.id)
    setPresets(await listPresets())
    if (id === activePresetId) setActivePresetId('')
    setStatus(`Deleted “${active.data.name}”.`)
  }

  const exportTo = useExportTo()
  /** Opened by hand in the app (Open, a drop), not from one of the library's folders: its exports ask where to go. */
  const byHand = (from: PhotoFile | undefined): boolean =>
    isNative() && !library.folders.some((d) => !!from && from.path.startsWith(d.path.replace(/\/+$/, '') + '/'))
  /**
   * Where Export saves: next to the photo (it takes the photo's place, the
   * original kept in Originals/ beside it), when the photo was opened by
   * path in the app and that is the choice; else the export folder; else
   * nowhere, and the file downloads (or the app asks where).
   */
  const exportDir = (from: PhotoFile | undefined): { folder: Folder; nextTo: boolean } | null => {
    // A photo opened by hand, not from a folder in the library: a Save dialog, as any app's Export has.
    if (byHand(from)) return null
    const mode = exportTo ?? (exportFolder ? 'folder' : 'photo')
    if (mode === 'ask') return null
    if (mode === 'photo' && from && isNative()) return { folder: nativeFolder(dirOf(from)), nextTo: true }
    return exportFolder ? { folder: exportFolder, nextTo: false } : null
  }
  /** An export, for usage counts: its format and size, and what its edit has in it (usageSummary.ts). */
  const countExport = (via: string, rendered: { ext: string; width: number; height: number }) => {
    track('export', rendered.ext, via, Math.max(rendered.width, rendered.height))
    for (const [a, b] of editUsage(blend, activeLook, activePresetId)) track('export_has', a, b)
  }
  const onExportImage = useCallback(async () => {
    if (!image) return setStatus('Open a photo first.')
    if (!source || exporting) return
    markExportSeen()
    // In the browser, a PNG or TIFF goes to Export, which says it's in the desktop app
    // (a shortcut or the menu land here too). A size over the browser's limit
    // exports at that limit, and says so.
    const crop = cropActive(blend.effects.crop) ? cropRect(image.size, blend.effects.crop) : image.size
    const needs = desktopNeeds(output, image)
    if (needs.length) {
      setPanelPage('export')
      setStatus(`${needs[0]} is in the desktop app`)
      return
    }
    const cap = webCap(output, crop, blend)
    setExporting(true)
    // The edit saved first, so the library knows the export is of it.
    flushEdit()
    const dest = exportDir(image.from)
    const exportFolder = dest?.folder ?? null
    // Ask for the export folder first. After a restart the browser has to
    // confirm access again, and it only shows that prompt in answer to a
    // click: asked after the render, the click has expired and the request
    // never resolves.
    if (exportFolder) {
      // Only a browser asks; the desktop app has the folder already.
      if (!isNative()) setStatus(`Waiting for permission to save in ${exportFolder.name}…`)
      const allowed = await ensureWritePermission(exportFolder).catch(() => false)
      if (!allowed) {
        setStatus(null)
        setError(`No permission to save in ${exportFolder.name}. Export again and choose Allow when the browser asks.`)
        setExporting(false)
        return
      }
    }
    setStatus('Rendering the export…')
    // Made inside the try: a graphics failure here must not leave Export stuck.
    let engine: GrainEngine | null = null
    try {
      engine = new GrainEngine()
      const rendered = await renderFile(engine, image.file, image.name, source, blend, cap?.output ?? output)
      countExport('single', rendered)
      if (exportFolder) {
        const result = await exportToFolder(
          exportFolder,
          image.file,
          image.name,
          rendered.originalHash,
          rendered.blob,
          rendered.ext,
        )
        void recordExport(image.sha, rendered.blob).then(folderChanged)
        const text =
          `Saved ${result.finalName} ${dest?.nextTo ? 'in place of the photo' : `to ${exportFolder.name}`} (${rendered.width}×${rendered.height}); ` +
          (result.original === 'archived' ? `original moved to ${ARCHIVE_DIR}/` : `original already in ${ARCHIVE_DIR}/`) +
          (result.kept ? `; the different ${result.finalName} that was there is kept as ${ARCHIVE_DIR}/${result.kept}` : '')
        if (exportFolder.path) savedAt(text, joinPath(exportFolder.path, result.finalName))
        else setStatus(text)
      } else if (byHand(image.from) && isNative()) {
        const path = await saveByDialog(rendered.blob, rendered.filename, image.from)
        // Saved anywhere, it is exported: the Library's dot says so.
        if (path) void recordExport(image.sha, rendered.blob).then(folderChanged)
        if (path) savedAt(`Exported ${baseName(path)} (${rendered.width}×${rendered.height})`, path)
        else setStatus('Export not saved')
      } else {
        const saved = await downloadBlob(rendered.blob, rendered.filename)
        if (saved) void recordExport(image.sha, rendered.blob).then(folderChanged)
        setStatus(
          !saved
            ? 'Export not saved.'
            : cap
              ? `Exported ${rendered.filename} at ${rendered.width}×${rendered.height}, the browser's limit. Full size (${cap.full.width}×${cap.full.height}) is in the desktop app.`
              : `Exported ${rendered.filename} (${rendered.width}×${rendered.height}).`,
        )
      }
      // Its timelapse beside it, when Settings asks for that.
      const tl = withExportVideo.current
      if (tl.on && tl.withExports && recorderRef.current.frames().length >= 2) {
        const stem = (exportFolder ? image.name : rendered.filename).replace(/\.[^.]+$/, '')
        void makeVideoRef.current(recorderRef.current.frames(), tl, exportFolder ? { dir: exportFolder, stem } : null)
      }
    } catch (err) {
      setError((err as Error).message)
      setStatus(null)
    } finally {
      engine?.dispose()
      setExporting(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend, exporting, image, output, source, exportFolder, exportTo, library])

  /**
   * Export several library photos at once (the Library's Export changed):
   * each one's saved edit, rendered from its original with the export
   * settings now chosen, saved where Export saves it.
   */
  const [exportingMany, setExportingMany] = useState(false)
  // As a ref too: a new version's export may run from an earlier render's closure.
  const exportingManyNow = useRef(false)
  /**
   * A change made to several photos at once, from the Library: a recipe, a
   * border style, an edit pasted. The photo open in the editor changes
   * there (one step to undo); the rest have their saved edits changed and
   * their thumbnails drawn again (libraryEdits.ts).
   */
  const editingPhotosNow = useRef(false)
  /** The last change made from the Library, to undo: each photo's edit as it was, and the open one's settings. */
  const [bulkUndo, setBulkUndo] = useState<{ what: string; saved: { sha: string; was: PhotoEdit | null }[]; open: { sha: string; blend: BlendParams; grainSource: SerializedGrainSource } | null } | null>(null)
  const editPhotos = async (files: PhotoFile[], change: EditChange, what: string) => {
    if (editingPhotosNow.current || !files.length) return
    editingPhotosNow.current = true
    flushEdit()
    const first = what.charAt(0).toUpperCase() + what.slice(1)
    const undo: NonNullable<typeof bulkUndo> = { what, saved: [], open: null }
    const start = [NONE_LOOK, ...LOOKS].find((l) => l.id === startLookStore.get()) || STARTING_LOOK
    const finals = (await loadExports()).finals
    let done = 0
    const failed: string[] = []
    try {
      for (const f of files) {
        setStatus(`${first}: ${done + failed.length + 1} of ${files.length}…`)
        try {
          const own = await shaOf(f)
          const sha = originalOf(finals, own)
          if (image && image.sha === sha && source) {
            undo.open = { sha, blend, grainSource: source.serialize() }
            const next = change({ blend, grainSource: source.serialize() })
            history.hint(`${WHOLE_STEP}${what}`)
            if (JSON.stringify(next.grainSource) !== JSON.stringify(source.serialize())) setSource(await hydrateGrainSource(next.grainSource))
            setBlend(next.blend)
            setBaseline((g) => g + 1)
          } else undo.saved.push({ sha, was: await changeSavedEdit(f, sha, own, change, start) })
          done++
        } catch {
          failed.push(f.name)
        }
      }
      setStatus(`${first}: ${done} ${done === 1 ? 'photo' : 'photos'}${failed.length ? `; not ${failed.join(', ')}` : ''}.`)
    } finally {
      editingPhotosNow.current = false
      if (undo.saved.length || undo.open) setBulkUndo(undo)
    }
  }
  /** The last change from the Library taken back, every photo it changed. */
  const undoBulk = async () => {
    const u = bulkUndo
    if (!u || editingPhotosNow.current) return
    setBulkUndo(null)
    for (const s of u.saved) await restoreSavedEdit(s.sha, s.was).catch(() => undefined)
    if (u.open && image?.sha === u.open.sha) {
      history.hint(`${WHOLE_STEP}undoing ${u.what}`)
      setSource(await hydrateGrainSource(u.open.grainSource))
      setBlend(u.open.blend)
      setBaseline((g) => g + 1)
    }
    setStatus(`Undid ${u.what} on ${u.saved.length + (u.open ? 1 : 0)} photos.`)
  }
  /** A recipe, from the Library, for each photo chosen: its crops, streaks and masks stay its own. */
  const recipeChange = (id: string): { change: EditChange; what: string } | null => {
    const look = LOOKS.find((l) => l.id === id) ?? (id === NONE_LOOK.id ? NONE_LOOK : null)
    const doc = look?.doc ?? presets.find((p) => p.id === id)?.data
    if (!doc) return null
    track('recipe', look?.id ?? 'own', 'library')
    return { what: `the ${look?.label ?? doc.name} recipe`, change: (was) => ({ blend: keepOwn(was.blend, doc.blend, doc.placed), grainSource: doc.grainSource }) }
  }
  /** A photo's edit copied from the Library: the one open as it is now, another as saved. */
  const copyFromPhoto = async (f: PhotoFile) => {
    const own = await shaOf(f)
    const sha = originalOf((await loadExports()).finals, own)
    if (image && image.sha === sha && source) return copyEditHere()
    const saved = await loadEdit(sha)
    if (!saved) return setStatus(`${f.name} has no edit to copy`)
    const name = saved.name || f.name
    setClip(clipOf(name, { blend: saved.doc.blend, grainSource: saved.doc.grainSource }))
    setStatus(`Copied the edit of ${name}`)
  }
  const exportPhotos = async (files: PhotoFile[], given?: Map<string, { sha: string; original: Blob; name: string }>) => {
    if (exportingManyNow.current || !files.length) return
    exportingManyNow.current = true
    setExportingMany(true)
    flushEdit()
    const engine = new GrainEngine()
    const failed: string[] = []
    const kept: string[] = []
    let done = 0
    try {
      for (const f of files) {
        setStatus(`Exporting ${done + failed.length + 1} of ${files.length}: ${f.name}…`)
        try {
          const g = given?.get(f.path)
          const own = g?.sha ?? (await shaOf(f))
          const sha = g?.sha ?? originalOf((await loadExports()).finals, own)
          // The open photo's edit as it is now; the others' as saved.
          const open = image && image.sha === sha && source ? { blend, source, name: image.name } : null
          const edit = open ? null : await loadEdit(sha)
          if (!open && !edit) continue
          const name = g?.name ?? open?.name ?? edit!.name ?? f.name
          // An export in the photo's place: its original is in Originals/ beside it.
          const original = g
            ? g.original
            : sha === own
              ? await readPhoto(f)
              : await findArchivedOriginal(nativeFolder(dirOf(f)), name, sha)
          const dest = exportDir(f)
          if (!original || !dest) {
            failed.push(f.name)
            continue
          }
          const src = open?.source ?? (await hydrateGrainSource(edit!.doc.grainSource))
          const rendered = await renderFile(engine, original, name, src, open?.blend ?? edit!.doc.blend, output)
          // Only ever drawn on the photo the edit was made on, never on an export of it.
          if (rendered.originalHash !== sha) {
            failed.push(f.name)
            continue
          }
          if (!(await ensureWritePermission(dest.folder).catch(() => false))) throw new Error('no permission')
          const result = await exportToFolder(dest.folder, original, name, rendered.originalHash, rendered.blob, rendered.ext)
          if (result.kept) kept.push(`${ARCHIVE_DIR}/${result.kept}`)
          await recordExport(sha, rendered.blob)
          done++
        } catch {
          failed.push(f.name)
        }
      }
    } finally {
      engine.dispose()
      exportingManyNow.current = false
      setExportingMany(false)
      folderChanged()
    }
    track('export', output.format, 'library', done)
    setStatus(
      `Exported ${done} photo${done === 1 ? '' : 's'}.` +
        (kept.length ? ` Different files that were in their places are kept as ${kept.join(', ')}.` : ''),
    )
    if (failed.length)
      setError(
        `${failed.length} could not be exported: ${failed.slice(0, 4).join(', ')}${failed.length > 4 ? '…' : ''}. ${
          exportDir(undefined) ? 'Their originals were not found.' : 'Choose an export folder, or export next to the photo.'
        }`,
      )
  }

  /**
   * Export as…: this one export wherever you choose, with a Save dialog (a
   * download in the browser), whatever Save to says; nothing is moved.
   */
  const exportAs = async () => {
    if (!image || !source || exporting) return
    setExporting(true)
    flushEdit()
    setStatus('Rendering the export…')
    const engine = new GrainEngine()
    try {
      const crop = cropActive(blend.effects.crop) ? cropRect(image.size, blend.effects.crop) : image.size
      const rendered = await renderFile(engine, image.file, image.name, source, blend, outputFor(output, crop, blend))
      countExport('export_as', rendered)
      if (isNative()) {
        const path = await saveByDialog(rendered.blob, rendered.filename, image.from)
        // Saved anywhere, it is exported: the Library's dot says so.
        if (path) void recordExport(image.sha, rendered.blob).then(folderChanged)
        if (path) savedAt(`Exported ${baseName(path)} (${rendered.width}×${rendered.height})`, path)
        else setStatus('Export not saved')
      } else {
        const saved = await downloadBlob(rendered.blob, rendered.filename)
        if (saved) void recordExport(image.sha, rendered.blob).then(folderChanged)
        setStatus(saved ? `Exported ${rendered.filename} (${rendered.width}×${rendered.height})` : 'Export not saved')
      }
    } catch (err) {
      setError((err as Error).message)
      setStatus(null)
    } finally {
      engine.dispose()
      setExporting(false)
    }
  }
  /**
   * The Save dialog for an export, starting where the last one chosen went,
   * or beside the photo; never offering the photo's own name. Where it was
   * saved, or null if cancelled.
   */
  const saveByDialog = async (blob: Blob, filename: string, from: PhotoFile | undefined): Promise<string | null> => {
    let dir = from ? dirOf(from) : ''
    try {
      dir = localStorage.getItem(LAST_SAVE_DIR) || dir
    } catch {
      /* beside the photo */
    }
    const name = from && filename === from.name ? filename.replace(/(\.[^.]+)$/, '-edit$1') : filename
    const path = await saveFileAs(blob, dir ? joinPath(dir, name) : name)
    if (!path) return null
    try {
      // Windows answers with backslashes.
      localStorage.setItem(LAST_SAVE_DIR, path.slice(0, Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))))
    } catch {
      /* asked beside the photo next time */
    }
    return path
  }
  /** Saved to a file: the status says so with Show in Finder beside it, and Export's Show last export finds it. */
  const savedAt = (text: string, path: string) => {
    setLastExport(path)
    setStatusFile({ text, path })
    setStatus(text)
  }

  /**
   * Open a file. An export from this app carries its recipe: find the
   * original it was made from and restore the edit on it, so re-editing
   * starts from the original, not from a copy with the look already baked in.
   */
  /**
   * One of the sample photos (public/samples: originals from the landing page),
   * for trying the app without a photo of your own to hand. A different one
   * each time.
   */
  const sampleTurn = useRef(Math.floor(Math.random() * SAMPLES.length))
  const openSample = async () => {
    const name = SAMPLES[sampleTurn.current++ % SAMPLES.length]
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}samples/${name}`)
      if (!res.ok) throw new Error(String(res.status))
      openVia.current = 'sample'
      void openImage(new File([await res.blob()], name, { type: 'image/jpeg' }), name)
    } catch {
      setError('The sample photo could not be loaded. Check your connection, or open one of your own.')
    }
  }
  /**
   * The walk round the app: the editor, then (in the app) the Library, then
   * Your turn, which opens a photo of theirs or adds a folder. On the open
   * photo, or with none open, on a sample photo, so there is something to
   * show before they have opened anything.
   */
  const tourAfterOpen = useRef(false)
  const startTour = () => {
    track('tour_start')
    setShowHelp(false)
    setSettingsOpen(false)
    if (introOpen) closeIntro()
    if (image) {
      setLibraryShown(false)
      setTourOpen(true)
      return
    }
    tourAfterOpen.current = true
    void openSample()
  }
  useEffect(() => {
    if (!image || !tourAfterOpen.current) return
    tourAfterOpen.current = false
    setStatus(null)
    setTourOpen(true)
  }, [image])
  const railTo = (label: string) => () =>
    [...document.querySelectorAll<HTMLButtonElement>('.stack-rail button')].find((b) => b.querySelector('.rail-label')?.textContent?.trim() === label)?.click()
  // A module's category page, the module open: whole, in use or not.
  const tourShow = (id: StackModuleId) => () => {
    setStackTabNow(MODULE_BY_ID[id].category)
    setPanelPage('modules')
    requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('grain:open-module', { detail: id })))
  }
  const editorTourSteps: TourStep[] = [
    {
      target: '.panel.right',
      before: railTo('Recipes'),
      title: topic('recipes').title,
      text: topic('recipes').text(),
    },
    {
      // The pages, and Grain open, so its switch and sliders are there to see.
      target: ['.stack-rail', '.panel.right'],
      before: tourShow('grain'),
      title: topic('modules').title,
      text: (
        <>
          {topic('modules').text()} {topic('editing').text()}
        </>
      ),
    },
    {
      target: '.panel.right',
      before: tourShow('streaks'),
      title: topic('effects').title,
      text: topic('effects').text(),
    },
    {
      target: '.masks-panel',
      before: tourShow('grain'),
      also: '#module-grain .section-mask-button',
      title: topic('masks').title,
      text: topic('masks').text(),
    },
    {
      target: ['.snapshots-panel', '.history-panel'],
      title: topic('history').title,
      text: topic('history').text(),
    },
    {
      target: '.panel.right',
      before: railTo('Export'),
      title: topic('export').title,
      text: topic('export').text(),
    },
    {
      target: '.topbar-actions',
      before: railTo('Recipes'),
      title: topic('help').title,
      text: topic('help').text(),
    },
  ]
  // On the tour's sample folder (LibraryView demo): photos to point at, one with each mark.
  const [libraryDemo, setLibraryDemo] = useState(false)
  const libraryTourSteps: TourStep[] = [
    {
      target: ['.library-side', '.library-grid'],
      title: 'Your folders',
      text: (
        <>
          Photos stay where they are on your computer, each with its own edit.
          <TourKeys
          rows={[
            ['Double-click', 'Edit'],
            [keyLabel('space'), 'See it large'],
            ['F', 'Full screen'],
          ]}
          />
        </>
      ),
    },
    {
      target: ['.library-grid .library-item:nth-child(2)', '.library-grid .library-item:nth-child(3)', '.library-grid .library-item:nth-child(4)'],
      title: 'The dots',
      text: (
        <span className="tour-dots">
          <span>
            <i className="library-dot unexported" /> Edited, not exported yet
          </span>
          <span>
            <i className="library-dot changed" /> Changed since its export
          </span>
          <span>
            <i className="library-dot exported" /> Exported
          </span>
        </span>
      ),
    },
    {
      target: '.ltools',
      title: 'Copy, paste and switch',
      text: (
        <TourKeys
          rows={[
            [keyLabel('cmd+c'), 'Copy a photo’s edit'],
            [keyLabel('cmd+v'), 'Paste all or part of it onto others'],
            [keyLabel('g'), 'Library'],
            [keyLabel('d'), 'Editor'],
          ]}
        />
      ),
    },
  ]
  const endTour = (then?: () => void) => {
    track('tour_end')
    setTourOpen(false)
    setLibraryDemo(false)
    markShown(TOUR_SEEN)
    then?.()
  }
  const tourSteps: TourStep[] = [
    // The editor's steps with the editor in view (coming Back from the Library too).
    ...editorTourSteps.map((st) => ({
      ...st,
      before: () => {
        setLibraryShown(false)
        setLibraryDemo(false)
        if (st.before) requestAnimationFrame(st.before)
      },
    })),
    ...(libraryAvailable()
      ? libraryTourSteps.map((st) => ({
          ...st,
          before: () => {
            setLibraryDemo(true)
            setLibraryShown(true)
          },
        }))
      : []),
    {
      title: 'Your turn',
      text: libraryAvailable() ? 'Add a folder of your photos, or open photos one at a time.' : 'Open a photo of your own.',
      before: () => {
        setLibraryDemo(false)
        setLibraryShown(libraryAvailable())
      },
      actions: (
        <>
          {libraryAvailable() && (
            <button className="primary" onClick={() => endTour(() => void addFolder())}>
              Add a folder…
            </button>
          )}
          <button className={libraryAvailable() ? '' : 'primary'} onClick={() => endTour(() => actionsRef.current.open())}>
            {libraryAvailable() ? 'Open photos…' : 'Open a photo…'}
          </button>
          <button className="link" onClick={() => endTour(() => setLibraryShown(false))}>
            Keep trying the sample
          </button>
        </>
      ),
    },
  ]
  const openImage = async (file: File | Blob, name: string, ask = false) => {
    // Nothing is drawn until the photo and its edit are both in: drawn in
    // between, the new photo showed with the last one's look for a moment.
    setOpeningPhoto(true)
    try {
      // A subject half-picked on this photo: put its masks back first, so the
      // edit saved for it isn't left with a selection nobody kept.
      if (picking) {
        finishPicking(false)
        await new Promise((r) => setTimeout(r, 30))
      }
      await openImageInner(file, name, ask)
    } catch (err) {
      setError(`Could not open ${name}: ${(err as Error).message}`)
    } finally {
      setOpeningPhoto(false)
    }
  }

  /**
   * Open: in the app, the system's dialog, by path, so the photos are kept
   * in Recent (the first opens; with several, the filmstrip shows Recent to
   * step through them). In a browser, the file input.
   */
  const openPhotos = async () => {
    if (!libraryAvailable()) {
      imageInput.current?.click()
      return
    }
    const paths = await pickPhotos('Open photos', PHOTO_EXTENSIONS)
    if (!paths.length) return
    const files = await photoStats(paths)
    if (!files.length) return
    // Oldest first, so the first chosen ends up at the top with the one opened.
    for (const f of files.slice(1).reverse()) await addRecent(f.path, f.name)
    if (files.length > 1) setLibrary({ ...library, current: RECENT })
    setLibraryShown(false)
    openVia.current = 'open'
    await openFromStrip(files[0])
  }
  /*
   * Each photo's finished picture, the whole print at about the screen's
   * size, kept as it is left (by path, the newest few): opening it again
   * shows exactly that at once, the same as its render, until the render is
   * in. Only a picture of the look as it was left is kept, never an older one.
   */
  const wholePictures = useRef(new Map<string, string>())
  /** The photo the cover is for, so a preview found late never covers another. */
  const coverFor = useRef<string | null>(null)
  const lastWhole = useRef<{ path: string; layer: unknown; picture: HTMLCanvasElement } | null>(null)
  const keepWholePicture = () => {
    const w = lastWhole.current
    const path = image?.from?.path
    if (!w || !path || w.path !== path || w.layer !== viewLayerRef.current) return
    // Kept on disk too, under the photo and its edit, for the Library's large view.
    const sha = image?.sha
    const doc = source ? { blend, grainSource: source.serialize() } : null
    w.picture.toBlob(
      (blob) => {
        if (!blob) return
        if (sha && doc) void previewKey(sha, doc).then((key) => writePreview(key, blob))
        const kept = wholePictures.current
        const old = kept.get(path)
        if (old) URL.revokeObjectURL(old)
        kept.delete(path)
        kept.set(path, URL.createObjectURL(blob))
        while (kept.size > 16) {
          const [first, url] = kept.entries().next().value!
          URL.revokeObjectURL(url)
          kept.delete(first)
        }
      },
      'image/jpeg',
      0.95,
    )
  }
  // The open photo's finished picture kept as the Library opens, for its large view.
  useEffect(() => {
    if (inLibrary) keepWholePicture()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inLibrary])
  /** A photo from the filmstrip opened, as opening it any other way would. */
  const openFromStrip = async (f: PhotoFile) => {
    keepWholePicture()
    // Its finished picture if it was open before, else its thumbnail, at
    // once: never the photo being left while it loads.
    const kept = wholePictures.current.get(f.path)
    coverFor.current = f.path
    setCover(kept ?? shownThumb(f.path))
    // Else its preview on disk (storage/previews.ts), if the Library or the
    // editor drew this edit before: sharper than the thumbnail, in its place.
    if (!kept)
      void (async () => {
        const own = await knownSha(f)
        if (!own) return
        const sha = originalOf((await loadExports()).finals, own)
        const ed = await loadEdit(sha)
        const url = ed ? await readPreview(await previewKey(sha, ed.doc)) : null
        // Only for the photo still opening: another may have been clicked since.
        if (url && coverFor.current === f.path) setCover((c) => (c ? url : c))
      })()
    const blob = await readPhoto(f)
    if (!blob) {
      setCover(null)
      setError(`${f.name} is not in ${baseName(f.path.slice(0, -f.name.length - 1))} any more.`)
      return
    }
    opening.current = f
    await openImage(blob, f.name)
    opening.current = null
  }
  // Nothing opened after all: the photo that is open shows again.
  useEffect(() => {
    if (error) setCover(null)
  }, [error])
  useEffect(() => {
    if (!cover) return
    const t = setTimeout(() => setCover(null), 10000)
    return () => clearTimeout(t)
  }, [cover])
  /** A folder added to the filmstrip, and shown. */
  const addFolder = async () => {
    const path = await pickFolder('Add a folder to the library')
    if (!path) return
    const folders = library.folders.some((f) => f.path === path) ? library.folders : [...library.folders, { path, name: baseName(path) }]
    setLibrary({ folders, current: path })
    setStripOpen(true)
    setLibraryShown(true)
  }
  // A new photo opens at Fit, whatever the last one was zoomed to: the
  // picture shown while it loads is at Fit, and the photo then stays so.
  const lastOpenSha = useRef<string | null>(null)
  useEffect(() => {
    if (!image || image.sha === lastOpenSha.current) return
    const first = lastOpenSha.current === null
    lastOpenSha.current = image.sha
    if (!first || zoom !== 'fit') setZoomState('fit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.sha])
  // The photo opened from the strip is marked there; its hash is remembered for next time.
  useEffect(() => {
    if (!image) return
    const f = image.from
    setOpenPath(f?.path ?? null)
    if (f) {
      // Opened as an export's original, the file is the export, not this photo.
      if (!image.fromExport) void rememberSha(f, image.sha)
      void addRecent(f.path, f.name)
    }
  }, [image?.sha, image?.from])

  /**
   * Back to how the app starts: the starting look, its border, nothing placed
   * on the photo. A new photo starts here, not with the last one's edit — a
   * look, a preset or a snapshot brings one across when wanted. Export
   * settings and snapshots stay. One step to undo.
   */
  const startFresh = async (step: string, sha?: string) => {
    // A new photo starts with the recipe chosen in Settings; starting over, with nothing.
    const look = (sha && [NONE_LOOK, ...LOOKS].find((l) => l.id === startLookStore.get())) || STARTING_LOOK
    try {
      const next = await hydrateGrainSource(look.doc.grainSource)
      // A new photo has its own history; starting over on one is a step.
      if (sha) history.reset()
      else history.hint(`${WHOLE_STEP}${step}`)
      setSource(next)
      // The date stamp prints the new photo's own date.
      const start = look.doc.blend
      const fresh = { ...start, effects: { ...start.effects, stamp: { ...start.effects.stamp, date: photoDate.current } } }
      setBlend(fresh)
      if (sha) editBase.current = { sha, saved: false }
      setActiveLook(look)
      setActivePresetId('')
      setBaseline((g) => g + 1)
      setCompareId(null)
      setSelectedStreak(null)
      setSelectedMask(null)
      setSelectedSpot(null)
      setSelectedGuide(null)
      setSelectedPiece(null)
      setArmedImage(null)
      setPreviewGrade(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /** A photo opened with the edit it was left with (storage/photoEdits.ts). */
  const restoreEdit = async (saved: PhotoEdit, name: string) => {
    // Its thumbnail redrawn from the edit as it is (one drawn before a
    // collage's images had loaded showed none of it). The edit is not saved
    // again, so it is not marked as changed.
    const li = lastLoaded.current
    if (li?.sha === saved.id)
      void editThumb(bigOf(li.bitmap), li.seed, saved.doc, saved.doc.blend)
        .then(async (thumb) => {
          editThumbs.current.set(saved.id, thumb)
          if (thumb === saved.thumb && saved.thumbFor === thumbKey(saved.updatedAt)) return
          // Changed since it opened: that change saves its own (this would put the old edit back).
          const now = await loadEdit(saved.id)
          if (now && now.updatedAt === saved.updatedAt) return saveEdit({ ...now, thumb, thumbFor: thumbKey(now.updatedAt) })
        })
        .catch(() => undefined)
    try {
      const next = await hydrateGrainSource(saved.doc.grainSource).catch(() => hydrateGrainSource(STARTING_LOOK.doc.grainSource))
      history.reset(OPENED_EDITED)
      setSource(next)
      setBlend(saved.doc.blend)
      editBase.current = { sha: saved.id, saved: true }
      if (saved.thumb) editThumbs.current.set(saved.id, saved.thumb)
      setActiveLook(saved.lookId ? (LOOKS.find((l) => l.id === saved.lookId) ?? null) : null)
      setActivePresetId(saved.presetId)
      setBaseline((g) => g + 1)
      setCompareId(null)
      setSelectedStreak(null)
      setSelectedMask(null)
      setSelectedSpot(null)
      setSelectedGuide(null)
      setSelectedPiece(null)
      setArmedImage(null)
      setPreviewGrade(null)
      setStatus(`Opened ${name} with its edit.`)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  /**
   * Everything off: no recipe, no modules, nothing placed on the photo (crop,
   * masks, streaks, collage, corrections). The photo as it is; Cmd+Z brings
   * the edit back.
   */
  const openImageInner = async (file: File | Blob, name: string, ask: boolean) => {
    let recipe = await readRecipe(file).catch(() => null)
    // The app's own record of what this export was made from comes first: an
    // export drawn over an older export (before 1.0.8, see library.ts
    // INDEX_CHECKED) names that export as its original in its recipe.
    if (recipe) {
      const fileSha = await sha256(file)
      const finals = (await loadExports()).finals
      const recorded = finals.has(fileSha) ? originalOf(finals, fileSha) : undefined
      if (recorded && recorded !== recipe.original.sha256 && (await loadEdit(recorded)))
        recipe = { ...recipe, original: { ...recipe.original, sha256: recorded } }
    }
    if (!recipe) {
      setPendingRecipe(null)
      setPendingFile(null)
      flushEdit()
      const loaded = await loadImageFile(file, name)
      if (!loaded) return
      const saved = await loadEdit(loaded.sha)
      if (saved) await restoreEdit(saved, name)
      else await startFresh(`a new photo, ${name}`, loaded.sha)
      return
    }
    let original: Blob | null = null
    // Exported in place: its original is in Originals/ beside it.
    const from = opening.current
    if (from && isNative())
      original = await findArchivedOriginal(nativeFolder(dirOf(from)), recipe.original.name, recipe.original.sha256)
    if (!original && exportFolder)
      original = await findArchivedOriginal(exportFolder, recipe.original.name, recipe.original.sha256, ask)
    // The browser may not read the folder without asking; the launcher can.
    if (!original) original = await findOriginalOnDisk(recipe.original.name, recipe.original.size, recipe.original.sha256)
    if (!original) {
      const photo = await loadPhoto()
      if (photo && (await sha256(photo.blob)) === recipe.original.sha256) original = photo.blob
    }
    if (!original) {
      // Never refuse to open it: open the export as it is, and offer to
      // re-edit from the original once it is found.
      const locked = !!exportFolder && !(await canReadFolder(exportFolder))
      flushEdit()
      const loaded = await loadImageFile(file, name)
      if (!loaded) return
      const saved = await loadEdit(loaded.sha)
      if (saved) await restoreEdit(saved, name)
      else await startFresh(`a new photo, ${name}`, loaded.sha)
      setPendingRecipe(recipe)
      setPendingFile({ file, name, locked })
      setError(null)
      setStatus(
        locked
          ? `${name} is an export. To edit it from its original, allow access to ${exportFolder!.name} again.`
          : `${name} is an export. Its original, ${recipe.original.name}, wasn't found${exportFolder ? ` in ${exportFolder.name}/${ARCHIVE_DIR}` : ''}. Locate it to edit from the original.`,
      )
      return
    }
    await restoreFromRecipe(original, recipe, file)
    // The export's own name, as it was opened, beside the original's.
    const sha = lastLoaded.current?.sha
    if (sha) {
      setOpenedExport({ name, sha })
      setStatus(`Opened ${name}, an export: editing its original, ${recipe.original.name}.`)
    }
  }

  const restoreFromRecipe = async (original: Blob, recipe: Recipe, exported?: Blob) => {
    flushEdit()
    const from = opening.current
    loadingOriginal.current = !!exported
    const loaded = await loadImageFile(original, recipe.original.name).finally(() => (loadingOriginal.current = false))
    if (loaded && exported) void rememberFinal(exported, loaded.sha, from?.modified ?? Date.now())
    // The photo's own edit as it was left, when there is one: it may be
    // newer than the edit the export carries.
    const saved = loaded ? await loadEdit(loaded.sha) : null
    if (saved) {
      await restoreEdit(saved, recipe.original.name)
      setPendingRecipe(null)
      setPendingFile(null)
      setError(null)
      return
    }
    const next = await hydrateGrainSource(recipe.doc.grainSource)
    let doc = recipe.doc
    // An edit from before it said what its shapes are fractions of: the
    // export shows which (see pipeline/shapeSpace.ts).
    if (exported && shapeSpaceUnknown(doc.blend, recipe.shapeSpaceSaved)) {
      setStatus(`Matching ${recipe.original.name}’s streaks and masks to its export…`)
      const space = await shapeSpaceFromExport(original, recipe.original.name, exported, next, doc)
      if (space && space !== doc.blend.effects.shapeSpace)
        doc = { ...doc, blend: { ...doc.blend, effects: { ...doc.blend.effects, shapeSpace: space } } }
      setStatus((now) => (now?.startsWith('Matching ') ? null : now))
    }
    history.reset(OPENED_EDITED)
    setSource(next)
    setBlend(doc.blend)
    if (loaded) editBase.current = { sha: loaded.sha, saved: true }
    setOutput(doc.output)
    setActiveLook(null)
    setActivePresetId('')
    setBaseline((g) => g + 1)
    setPendingRecipe(null)
    setPendingFile(null)
    setError(null)
    setStatus(`Re-editing ${recipe.original.name} with the edit from its export.`)
    const ids = doc.blend.effects.collage.pieces.map((p) => p.image)
    if (ids.length) void bringBackCollage(ids, recipe.collage ?? [], doc.blend.effects.collage.photo)
  }

  /** The collage's images that left the library, found on disk and put back. */
  const bringBackCollage = async (ids: string[], refs: CollageImageRef[], photo: number | null) => {
    const missingBefore = await Promise.all([...new Set(ids)].map(hasCollageImage))
    const count = missingBefore.filter((has) => !has).length
    if (!count) return
    setStatus(`Looking for the collage’s ${count === 1 ? 'image' : `${count} images`}, which ${count === 1 ? 'is' : 'are'} no longer in your images…`)
    const { found, missing } = await recoverCollageImages(ids, refs, exportFolder?.path ?? null, photo)
    if (!missing) {
      setStatus(`Found the collage’s ${found === 1 ? 'image' : `${found} images`} and put ${found === 1 ? 'it' : 'them'} back in your images.`)
      return
    }
    setStatus(null)
    setError(
      `${missing} of the collage’s ${count === 1 ? 'image wasn’t' : 'images weren’t'} found${found ? ` (${found} found and put back)` : ''}. Add ${missing === 1 ? 'it' : 'them'} again in Collage (+) and the pieces come back as they were.`,
    )
  }

  const locateOriginal = async (file: File) => {
    if (!pendingRecipe) return
    if (
      (await sha256(file)) !== pendingRecipe.original.sha256 &&
      !(await confirmWith(`${file.name} isn't the exact original this was exported from. Apply the edit to it anyway?`))
    )
      return
    await restoreFromRecipe(file, { ...pendingRecipe, original: { ...pendingRecipe.original, name: file.name } }, pendingFile?.file)
  }

  /**
   * A better copy of the open photo (larger, less compressed, or the RAW)
   * put under its edit, so an export is made from it: found in the new
   * copy (the same framing, or a crop of it, engine/alignPhoto.ts), every
   * placed thing moved onto it and, for a crop, the crop set to match, and
   * what is sized in pixels and what varies per photo kept as it was
   * (BlendParams.pixelScale, photoSeed). The edit is saved for the new copy
   * and the new copy opened; the old photo keeps its own.
   */
  // Submit to Gallery (File menu, the Library's menu): the photo with its edit as the gallery takes it, made while the form is filled in.
  const [gallery, setGallery] = useState<{ photo: Promise<Blob>; tools: string[] } | null>(null)
  const openGallery = () => {
    if (!image || !source) return setStatus('Open a photo first.')
    flushEdit()
    const photo = (async () => {
      const engine = new GrainEngine()
      try {
        const crop = cropActive(blend.effects.crop) ? cropRect(image.size, blend.effects.crop) : image.size
        const rendered = await renderFile(engine, image.file, image.name, source, blend, outputFor(output, crop, blend))
        return await galleryJpeg(rendered.blob)
      } finally {
        engine.dispose()
      }
    })()
    track('share_open', 'desktop')
    setGallery({ photo, tools: galleryTools(blend, activeLook) })
  }
  // From the Library: the photo opens, and once it and its edit are in, the form.
  const pendingGallery = useRef<string | null>(null)
  const [galleryTick, setGalleryTick] = useState(0)
  useEffect(() => {
    const path = pendingGallery.current
    if (!path || !image || !source || openingPhoto || openPath !== path) return
    pendingGallery.current = null
    openGallery()
    // openGallery is this render's, with this photo's edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, source, openingPhoto, openPath, galleryTick])
  // Replace photo… from the Library: the photo opens, and once it and its edit are in, the edit moves onto the better copy.
  const pendingReplace = useRef<{ path: string; file: File } | null>(null)
  const [replaceTick, setReplaceTick] = useState(0)
  useEffect(() => {
    const p = pendingReplace.current
    if (!p || !image || openingPhoto || openPath !== p.path) return
    pendingReplace.current = null
    void replacePhoto(p.file)
    // replacePhoto is this render's, with this photo's edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, openingPhoto, openPath, replaceTick])
  const replacePhoto = async (file: File) => {
    if (!image) return
    const was = image
    const name = file.name
    try {
      setStatus(`Finding ${was.name} in ${name}…`)
      const sha = await sha256(file)
      if (sha === was.sha) return setStatus(`${name} is the photo that is open.`)
      const bitmap = decodedPhotos.get(sha) ?? (await decodePhoto(isRawName(name) ? await developRaw(file, name, sha) : file, name))
      keepDecoded(sha, bitmap)
      // Let the status show before the search holds the page for a moment.
      await new Promise((r) => setTimeout(r, 30))
      const moved = moveEditOnto(blend, grayOf(was.bitmap, 2048), was.size, was.seed, grayOf(bitmap, 2048), { width: bitmap.width, height: bitmap.height })
      const found = moved.found
      if (found.score < 0.5 && !(await confirmWith(`${name} doesn't look like the same photo as ${was.name}. Put the edit on it anyway?`))) {
        setStatus(null)
        return
      }
      if (moved.lost > 0.02 && !(await confirmWith(`${name} shows less than ${was.name} at its edges (up to ${Math.round(moved.lost * 100)}% of it). Use it anyway?`))) {
        setStatus(null)
        return
      }
      flushEdit()
      const b = moved.blend
      const existing = await loadEdit(sha)
      if (existing && !(await confirmWith(`${name} has an edit of its own. Replace it with this one?`))) {
        setStatus(null)
        return
      }
      const doc: PresetDoc = { schemaVersion: PRESET_SCHEMA_VERSION, name, grainSource: (source?.serialize() ?? STARTING_LOOK.doc.grainSource), blend: b, output }
      await saveEdit({ id: sha, name, doc, lookId: activeLook?.id ?? null, presetId: activePresetId, thumb: '', updatedAt: Date.now() })
      await openImage(file, name)
      setStatus(
        `The edit is on ${name} now (${bitmap.width}×${bitmap.height}${found.whole ? '' : ', cropped to where ' + was.name + ' was in it'}). ${was.name} keeps its own edit.` +
          (isRawName(name) ? ' A RAW opens as the camera made it: for the colours of a photo corrected elsewhere, use a full-size TIFF or JPEG exported from there.' : ''),
      )
    } catch (err) {
      setError(`Couldn't replace the photo: ${(err as Error).message}`)
      setStatus(null)
    }
  }

  /**
   * How a photo's new version matches it: where the old one is in it
   * (engine/alignPhoto.ts) and, for a photo with an edit, the edit moved
   * onto it as Replace photo moves one (same grain and patterns, the
   * framing found). `old` is the photo the edit was made on, or null to use
   * the reference kept of it when it was edited (storage/references.ts).
   */
  const matchVersion = async (old: { blob: Blob | null; name: string; sha: string }, neu: { blob: Blob; name: string; sha: string }, editSha: string | null) => {
    const edit = editSha ? await loadEdit(editSha) : null
    let oldBlob = old.blob
    let oldSize: Size | null = null
    if (!oldBlob && editSha) {
      const ref = await loadReference(editSha)
      if (ref) {
        oldBlob = ref.blob
        oldSize = { width: ref.width, height: ref.height }
      }
    }
    if (!oldBlob) return null
    const decode = async (blob: Blob, n: string, sha: string) => decodePhoto(isRawName(n) ? await developRaw(blob, n, sha) : blob, n)
    const oldBitmap = await decode(oldBlob, old.name, old.sha)
    const newBitmap = await decode(neu.blob, neu.name, neu.sha)
    const moved = moveEditOnto(
      edit?.doc.blend ?? DEFAULT_BLEND_PARAMS,
      grayOf(oldBitmap, 2048),
      oldSize ?? { width: oldBitmap.width, height: oldBitmap.height },
      photoSeed(editSha ?? old.sha),
      grayOf(newBitmap, 2048),
      { width: newBitmap.width, height: newBitmap.height },
    )
    const sizes = { old: oldSize ?? { width: oldBitmap.width, height: oldBitmap.height }, neu: { width: newBitmap.width, height: newBitmap.height } }
    oldBitmap.close()
    newBitmap.close()
    return { edit, moved, sizes }
  }
  const sizeText = (s: Size) => `${s.width}×${s.height}`

  /**
   * A new version of an edited photo written over it in a library folder
   * (darktable exporting it again, larger: useFolderPhotos' NewVersion),
   * matched against the old photo (its original in Originals/ when the file
   * written over was an export, or the reference kept when it was edited).
   * Its edit moves over and, exported before, it is exported again with the
   * export settings now, once asked (ReplacedVersionDialog): the new version
   * goes to Originals/, and the old original goes to the Trash (Replace) or
   * stays beside it (Keep both); Cancel leaves the new file as it is. A
   * picture that isn't the same photo is left alone.
   */
  const handleNewVersion = async (v: NewVersion) => {
    const name = v.file.name
    try {
      // Open, its edit as it is now.
      if (image?.sha === v.editSha) flushEdit()
      const edit = await loadEdit(v.editSha)
      if (!edit || (await loadEdit(v.sha))) return
      const dir = dirOf(v.file)
      const original = v.exported ? await findArchivedOriginal(nativeFolder(dir), edit.name, v.editSha) : null
      const newBlob = await readPhoto(v.file)
      if (!newBlob) return
      // copyshop's own export carries its edit (darktable's never does): not a new version.
      if (await readRecipe(newBlob).catch(() => null)) return void markSeen(v.sha)
      setStatus(`${name} has a new version: moving its edit over…`)
      const match = await matchVersion({ blob: original, name: edit.name, sha: v.editSha }, { blob: newBlob, name, sha: v.sha }, v.editSha)
      if (!match) {
        setStatus(`${name} has a new version, but it couldn't be matched to its edit here: right-click it in the Library and choose Replace photo….`)
        return void markSeen(v.sha)
      }
      if (match.moved.found.score < 0.5) {
        setStatus(null)
        return void markSeen(v.sha)
      }
      // Exported before: asked first, since the old original would go and the file be written again.
      let choice: 'replace' | 'keep' | 'cancel' = 'replace'
      if (v.exported) {
        setStatus(null)
        choice = await new Promise((resolve) => setAskingReplace({ name, size: match.sizes.neu, ...(match.edit?.thumb ? { thumb: match.edit.thumb } : {}), resolve }))
        setAskingReplace(null)
        if (choice === 'cancel') {
          setStatus(`${name}'s new version was left as it is.`)
          return void markSeen(v.sha)
        }
      }
      await saveEdit({ ...match.edit!, id: v.sha, name, doc: { ...match.edit!.doc, name, blend: match.moved.blend }, thumb: '', updatedAt: Date.now() })
      await markSeen(v.sha)
      let trashed = false
      if (v.exported) {
        // Replace: the old original makes way for the new one in Originals/. Keep both: it stays.
        if (original && choice === 'replace') {
          await trashFile(joinPath(dir, ARCHIVE_DIR, (original as File).name || edit.name))
            .then(() => (trashed = true))
            .catch(() => undefined)
        }
        await exportPhotos([v.file])
      }
      // Open, it is the new version now.
      if (image?.sha === v.editSha) await openImage(new File([newBlob], name), name)
      setStatus(
        `${name} has a new version (${sizeText(match.sizes.neu)}): its edit moved over${v.exported ? ' and it was exported again' : ''}.` +
          (trashed ? ' The old original is in the Trash.' : choice === 'keep' && original ? ' The old original is still in Originals.' : ''),
      )
    } catch (err) {
      setError(`Couldn't move ${name}'s edit to its new version: ${(err as Error).message}`)
    }
  }

  /**
   * New copies of photos beside them under names of their own (darktable's
   * PB065305_01: useFolderPhotos' NewCopy). Each is matched against its
   * photo (one that isn't the same picture is left out), and one question
   * asks about them all: use each in its photo's place, or keep both. Used,
   * the copy takes the photo's place (the original's, in Originals/, when
   * the photo is copyshop's export, which is then exported again), the
   * edit moves over, and the old files go to the Trash. Kept, they are not
   * asked about again.
   */
  const handleNewCopies = async (copies: NewCopy[]) => {
    const found: { c: NewCopy; blob: Blob; original: File | null; match: NonNullable<Awaited<ReturnType<typeof matchVersion>>> }[] = []
    for (const c of copies) {
      try {
        const blob = await readPhoto(c.file)
        if (!blob || (await readRecipe(blob).catch(() => null))) {
          await markSeen(c.sha)
          continue
        }
        const edit = c.editSha ? await loadEdit(c.editSha) : null
        const original = c.exported && edit ? ((await findArchivedOriginal(nativeFolder(dirOf(c.of)), edit.name, c.editSha!)) as File | null) : null
        const oldBlob = original ?? (c.exported ? null : await readPhoto(c.of))
        const match = await matchVersion({ blob: oldBlob, name: edit?.name ?? c.of.name, sha: c.editSha ?? c.ofSha }, { blob, name: c.file.name, sha: c.sha }, c.editSha)
        if (!match || match.moved.found.score < 0.5) {
          await markSeen(c.sha)
          continue
        }
        found.push({ c, blob, original, match })
      } catch {
        /* unreadable: left as it is */
      }
    }
    if (!found.length) return
    // Asked in the app, each with its photo beside it, each ticked to use.
    const use = new Set(
      await new Promise<string[]>((resolve) =>
        setAskingVersions({
          items: found.map(({ c, match }) => ({
            id: c.sha,
            photo: c.of,
            photoSize: match.sizes.old,
            copy: c.file,
            copySize: match.sizes.neu,
            edited: !!match.edit,
            exported: c.exported,
            ...(match.edit?.thumb ? { thumb: match.edit.thumb } : {}),
          })),
          resolve,
        }),
      ),
    )
    setAskingVersions(null)
    const kept = found.filter((f) => !use.has(f.c.sha))
    if (kept.length) await markSeen(...kept.map((f) => f.c.sha))
    if (!use.size) return
    let used = 0
    let exported = 0
    const failed: string[] = []
    for (const { c, blob, original, match } of found.filter((f) => use.has(f.c.sha))) {
      try {
        const dir = dirOf(c.of)
        const edit = match.edit
        if (c.exported && edit) {
          // The copy becomes the original, in Originals/; the old export of the old one goes.
          const at = joinPath(dir, ARCHIVE_DIR, edit.name)
          if (original) await trashFile(joinPath(dir, ARCHIVE_DIR, original.name || edit.name))
          await moveFile(c.file.path, at)
          await trashFile(c.of.path)
          await saveEdit({ ...edit, id: c.sha, name: edit.name, doc: { ...edit.doc, name: edit.name, blend: match.moved.blend }, thumb: '', updatedAt: Date.now() })
          await exportPhotos([c.of], new Map([[c.of.path, { sha: c.sha, original: blob, name: edit.name }]]))
          exported++
        } else {
          await trashFile(c.of.path)
          await moveFile(c.file.path, c.of.path)
          if (edit) await saveEdit({ ...edit, id: c.sha, name: c.of.name, doc: { ...edit.doc, name: c.of.name, blend: match.moved.blend }, thumb: '', updatedAt: Date.now() })
        }
        await markSeen(c.sha)
        used++
        if (image && (image.sha === c.editSha || image.sha === c.ofSha)) {
          opening.current = c.of
          await openImage(new File([blob], c.of.name), c.of.name).finally(() => (opening.current = null))
        }
      } catch (err) {
        failed.push(`${c.file.name} (${(err as Error).message})`)
      }
    }
    folderChanged()
    setStatus(
      `Used the new version${used === 1 ? '' : 's'} of ${used} photo${used === 1 ? '' : 's'}` +
        (exported ? `, ${exported} exported again` : '') +
        '. The old files are in the Trash.',
    )
    if (failed.length) setError(`Couldn't use ${failed.join(', ')}.`)
  }

  const [askingVersions, setAskingVersions] = useState<{ items: NewVersionChoice[]; resolve: (use: string[]) => void } | null>(null)
  const [askingReplace, setAskingReplace] = useState<{ name: string; size: Size; thumb?: string; resolve: (choice: 'replace' | 'keep' | 'cancel') => void } | null>(null)
  const newVersionRef = useRef(handleNewVersion)
  newVersionRef.current = handleNewVersion
  const newCopiesRef = useRef(handleNewCopies)
  newCopiesRef.current = handleNewCopies
  useEffect(() => {
    if (!isNative()) return
    // One at a time: each may export.
    let chain = Promise.resolve()
    const on = (e: Event) => {
      const v = (e as CustomEvent<NewVersion>).detail
      chain = chain.then(() => newVersionRef.current(v)).catch(() => undefined)
    }
    const onCopies = (e: Event) => {
      const list = (e as CustomEvent<NewCopy[]>).detail
      chain = chain.then(() => newCopiesRef.current(list)).catch(() => undefined)
    }
    window.addEventListener('grain:new-version', on)
    window.addEventListener('grain:new-copies', onCopies)
    return () => {
      window.removeEventListener('grain:new-version', on)
      window.removeEventListener('grain:new-copies', onCopies)
    }
  }, [])

  const takeSnapshot = useCallback(() => {
    if (!image) return setStatus('Open a photo first.')
    if (!source || !grain) return
    const snap = createSnapshot(
      nextSnapshotName(photoSnapshots),
      source,
      grain,
      blend,
      image.bitmap,
      image.size,
      image.seed,
    )
    setSnapshots((list) => [{ ...snap, photo: image.sha, photoName: image.name }, ...list])
    setStatus(`Took ${snap.name}.`)
  }, [blend, grain, image, photoSnapshots, source])

  // A variation (Try) being pointed at, shown on the photo until the pointer leaves.
  const [previewBlend, setPreviewBlend] = useState<BlendParams | null>(null)
  // Cmd+K: find a setting or action by name.
  const [paletteOpen, setPaletteOpen] = useState(false)
  const loupe = useLoupe()
  // Pointing at a snapshot in the strip compares it for as long as you point.
  const [hoverCompareId, setHoverCompareId] = useState<string | null>(null)
  const compare = useMemo(
    () => snapshots.find((s) => s.id === (hoverCompareId ?? compareId)) ?? null,
    [compareId, hoverCompareId, snapshots],
  )
  // One layer object per snapshot, for as long as it lives, so the preview's
  // render of it is kept and reused (PreviewCanvas caches by layer).
  // Snapshots keep everything; whether comparing and restoring use their
  // streaks, masks and collage or the photo's as they are now is a switch.
  // Going back to a snapshot puts back the picture as it was, streaks and masks too, unless turned off.
  const [snapshotPlaced, setSnapshotPlaced] = useLocalStorage('ui.snapshotPlaced', true)
  const placedKey = useMemo(() => stableJson(placedOf(blend)), [blend])
  const snapshotLayers = useRef(new WeakMap<Snapshot, { key: string; layer: PreviewLayer }>())
  // A snapshot's grain, made when first wanted and shared by snapshots with the same grain.
  const snapGrains = useRef(new Map<string, Promise<GrainTexture>>())
  const snapGrain = (snap: Snapshot) => {
    if (snap.grain || !image) return
    const key = `${stableJson(snap.source.serialize())}@${image.size.width}x${image.size.height}`
    let made = snapGrains.current.get(key)
    if (!made) {
      made = snap.source.getTexture({ targetSize: image.size })
      snapGrains.current.set(key, made)
    }
    made
      .then((grain) => setSnapshots((list) => list.map((s) => (s.id === snap.id && !s.grain ? { ...s, grain } : s))))
      .catch(() => snapGrains.current.delete(key))
  }
  const layerOf = (snap: Snapshot): PreviewLayer | null => {
    if (!snap.grain) return null
    const key = snapshotPlaced ? 'own' : placedKey
    let kept = snapshotLayers.current.get(snap)
    if (!kept || kept.key !== key) {
      kept = { key, layer: { grain: snap.grain, params: snapshotPlaced ? snap.blend : withPlaced(blend, snap.blend) } }
      snapshotLayers.current.set(snap, kept)
    }
    return kept.layer
  }
  /*
   * Pointing at a recipe shows it against the photo in the compare wipe, as
   * pointing at a snapshot does: its own settings and grain, with this photo's
   * own crop, corrections and placed things kept, as applying it would.
   */
  const [recipeHover, setRecipeHover] = useState<{ key: string; name: string; doc: PresetDoc } | null>(null)
  const [recipeHoverLayer, setRecipeHoverLayer] = useState<{ key: string; layer: PreviewLayer } | null>(null)
  const recipeGrains = useRef(new Map<string, Promise<GrainTexture>>())
  useEffect(() => {
    if (!recipeHover || !image) {
      setRecipeHoverLayer(null)
      return
    }
    let cancelled = false
    const key = `${recipeHover.key}@${image.seed}`
    let texture = recipeGrains.current.get(key)
    if (!texture) {
      texture = hydrateGrainSource(recipeHover.doc.grainSource).then((src) => src.getTexture({ targetSize: image.size }))
      recipeGrains.current.set(key, texture)
    }
    texture
      .then((grain) => {
        if (!cancelled) setRecipeHoverLayer({ key, layer: { grain, params: keepOwn(blend, recipeHover.doc.blend, recipeHover.doc.placed) } })
      })
      .catch(() => recipeGrains.current.delete(key))
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipeHover, image])
  const compareLayer = compare ? layerOf(compare) : null
  // Compared before its grain is made: make it, and it shows when ready.
  useEffect(() => {
    if (compare && !compare.grain) snapGrain(compare)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compare, image])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prefetchLayers = useMemo(() => photoSnapshots.map(layerOf).filter((l): l is PreviewLayer => !!l), [photoSnapshots, snapshotPlaced, placedKey])

  /**
   * Put a snapshot's settings back. A snapshot holds the blend parameters and
   * the grain source it was taken with, so restoring is just assigning both —
   * the same state the panels and the engine already read from. Export
   * settings are deliberately left alone: they are output preferences, not
   * part of the look.
   */
  const restoreSnapshot = useCallback(
    (id: string) => {
      const snap = snapshots.find((s) => s.id === id)
      if (!snap) return
      history.hint(`${WHOLE_STEP}Snapshot: ${snap.name}`)
      setBlend(snapshotPlaced ? snap.blend : withPlaced(blend, snap.blend))
      setBaseline((g) => g + 1)
      setSource(snap.source)
      // Comparing against the look you just restored would wipe between two
      // identical images.
      setCompareId((current) => (current === id ? null : current))
      setStatus(`Restored ${snap.name}.`)
    },
    [blend, snapshots, source, snapshotPlaced],
  )


  /**
   * Everything the menu bar and the keyboard can ask for, in one place: a
   * menu click and its key run the same thing. Read through a ref so the
   * shortcut list doesn't change with every edit.
   */
  const actions: Record<MenuAction, () => void> = {
    settings: () => setSettingsOpen(true),
    open: () => void openPhotos(),
    'open-folder': () => libraryAvailable() && void addFolder(),
    export: () => {
      // The first export by its key or the menu: Export shows first, so its size and where it saves are seen once.
      if (image && !exportSeen() && panelPageStore.get() !== 'export') {
        setRightOpen(true)
        setPanelPage('export')
        setStatus(`Check the size and where it saves, then Export. After this, ${keyWords('Cmd+E')} exports at once`)
        return
      }
      void onExportImage()
    },
    'export-as': () => void exportAs(),
    'export-timelapse': () => timelapseOn && void exportTimelapse(),
    'submit-gallery': () => openGallery(),
    undo: () => (inTextField(document.activeElement) ? document.execCommand('undo') : (trackOnce('undo'), stepHistoryRef.current(true))),
    redo: () => (inTextField(document.activeElement) ? document.execCommand('redo') : (trackOnce('redo'), stepHistoryRef.current(false))),
    snapshot: () => takeSnapshot(),
    'reset-all': () => image && (track('start_over'), void startFresh('starting over')),
    'command-palette': () => setPaletteOpen((v) => !v),
    'zoom-fit': () => setZoom('fit'),
    'zoom-100': () => setZoom(1),
    'zoom-200': () => setZoom(2),
    'zoom-in': () => setZoom((z) => stepZoom(z, 1)),
    'zoom-out': () => setZoom((z) => stepZoom(z, -1)),
    'show-original': () => setBypass((v) => !v),
    'phone-preview': () => setSmall((v) => !v),
    'toggle-left': () => setLeftOpen(!leftOpen),
    'toggle-right': () => setRightOpen(!rightOpen),
    'toggle-filmstrip': () => libraryHasPhotos && setStripOpen(!stripOpen),
    library: () => hasLibrary && setLibraryShown(!libraryShown),
    shortcuts: () => setShowHelp(true),
    intro: () => setIntroOpen(true),
    feedback: () => setFeedbackOpen(true),
  }
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const act = (id: MenuAction) => () => actionsRef.current[id]()
  useEffect(() => onMenuAction((id) => actionsRef.current[id]?.()), [])
  // Menu items that would do nothing now are greyed.
  useEffect(() => {
    setMenuEnabled('export', !!image)
    setMenuEnabled('export-as', !!image)
    setMenuEnabled('reset-all', !!image)
    setMenuEnabled('snapshot', !!image)
    setMenuEnabled('export-timelapse', !!image && timelapseOn)
    setMenuEnabled('submit-gallery', !!image)
    setMenuEnabled('open-folder', libraryAvailable())
    setMenuEnabled('toggle-filmstrip', libraryHasPhotos)
    setMenuEnabled('library', hasLibrary)
  }, [image, timelapseOn, libraryHasPhotos, hasLibrary])

  const shortcuts = useMemo<Shortcut[]>(
    () => [
      { key: 'cmd+o', group: 'File', label: 'Open photos', onDown: act('open'), inFields: true },
      ...(libraryAvailable() ? [{ key: 'cmd+shift+o', group: 'File', label: 'Add folder to library', onDown: act('open-folder'), inFields: true }] : []),
      { key: 'cmd+e', group: 'File', label: 'Export', onDown: act('export'), inFields: true },
      { key: 'cmd+alt+e', group: 'File', label: 'Export as… (choose where)', onDown: act('export-as'), inFields: true },
      ...(timelapseOn ? [{ key: 'cmd+shift+e', group: 'File', label: 'Export the timelapse video', onDown: act('export-timelapse'), inFields: true }] : []),
      { key: 'cmd+,', group: 'File', label: 'Settings', onDown: act('settings'), inFields: true },
      // Cmd+Z itself is handled with the undo history, which leaves typing its own undo.
      { key: 'cmd+z', group: 'Edit', label: 'Undo', displayOnly: true },
      { key: 'cmd+shift+z', group: 'Edit', label: 'Redo', displayOnly: true },
      { key: 'cmd+shift+n', group: 'Edit', label: 'Take a snapshot', onDown: act('snapshot'), inFields: true },
      // The page's copy and paste events do these (the Edit menu's Copy and Paste, and the keys).
      { key: 'cmd+c', group: 'Edit', label: 'Copy the photo’s edit (in the Library, the photo selected)', displayOnly: true },
      { key: 'cmd+v', group: 'Edit', label: 'Paste the copied edit (in the Library, onto the photos selected)', displayOnly: true },
      { key: 'cmd+shift+r', group: 'Edit', label: 'Start over (no recipe, every module reset)', onDown: act('reset-all'), inFields: true },
      { key: 'cmd+k', group: 'Edit', label: 'Find a setting or action', onDown: act('command-palette'), inFields: true },
      { key: '\\', display: '\\', group: 'View', label: 'Show the original', onDown: () => setBypass(true), onUp: () => setBypass(false) },
      { key: 'z', group: 'View', label: 'Switch between Fit and 100%', onDown: () => setZoom((v) => (v === 'fit' ? 1 : 'fit')) },
      { key: 'w', group: 'View', label: 'Loupe: the photo under the pointer at 100%, as exported', onDown: () => setLoupe(true), onUp: () => setLoupe(false) },
      { key: 'o', group: 'View', label: 'Show or hide the mask overlay', onDown: () => setMaskOverlay(!overlayRef.current) },
      { key: 'cmd+0', group: 'View', label: 'Fit', onDown: act('zoom-fit') },
      { key: 'cmd+1', group: 'View', label: '100%', onDown: act('zoom-100') },
      { key: 'cmd+2', group: 'View', label: '200%', onDown: act('zoom-200') },
      { key: 'cmd+=', display: keyLabel('cmd++'), group: 'View', label: 'Zoom in (or scroll)', onDown: act('zoom-in') },
      { key: 'cmd+-', display: keyLabel('cmd+-'), group: 'View', label: 'Zoom out', onDown: act('zoom-out') },
      {
        key: 'tab',
        display: 'Tab',
        group: 'View',
        label: 'Hide or show the panels',
        // Tab still moves between controls once one has focus.
        when: () => !document.activeElement || document.activeElement === document.body,
        onDown: () => {
          const show = !(leftOpenStore.get() || rightOpenStore.get())
          setLeftOpen(show)
          setRightOpen(show)
        },
      },
      { key: PANEL_KEYS.left, group: 'View', label: 'Left panel', onDown: act('toggle-left') },
      { key: PANEL_KEYS.right, group: 'View', label: 'Right panel', onDown: act('toggle-right') },
      ...(hasLibrary
        ? [
            { key: PANEL_KEYS.strip, group: 'View', label: 'Filmstrip', onDown: act('toggle-filmstrip') },
            { key: 'g', group: 'View', label: 'Library', onDown: () => setLibraryShown(true) },
            { key: 'd', group: 'View', label: 'Editor (in the Library: edit the photo picked or shown large)', onDown: () => setLibraryShown(false) },
            { key: ' ', display: 'Space', group: 'View', label: 'Hold and drag to move the photo, whatever tool is out (as the middle button does); in the Library, the photo large and back', displayOnly: true },
            { key: 'f', group: 'View', label: 'In the Library: the photo filling the screen, and back', displayOnly: true },
            { key: 'arrowright', display: '← →', group: 'View', label: 'In the Library: previous and next photo', displayOnly: true },
            { key: 'cmd+]', display: keyLabel('cmd+]'), group: 'View', label: 'Next photo', onDown: () => stepStrip(1) },
            { key: 'cmd+[', display: keyLabel('cmd+['), group: 'View', label: 'Previous photo', onDown: () => stepStrip(-1) },
          ]
        : []),
      { key: '[', display: '[  ]', group: 'Edit', label: 'Brush smaller, bigger (while painting a mask)', displayOnly: true },
      { key: 'enter', display: 'Enter', group: 'Edit', label: 'Finish what you are drawing or placing on the photo', displayOnly: true },
      { key: '?', display: `? or ${keyLabel('cmd+/')}`, group: 'Help', label: 'Keyboard shortcuts', onDown: act('shortcuts') },
      { key: 'cmd+/', group: 'Help', label: 'Keyboard shortcuts', onDown: act('shortcuts'), inFields: true, unlisted: true },
      {
        key: 'escape',
        group: 'Help',
        label: 'Close a window, or stop what is going on: comparing, drawing, placing',
        inFields: true,
        // One thing per press: the window on top if there is one, else comparing.
        onDown: () => {
          if (document.querySelector('.overlay [role="dialog"]')) {
            setShowHelp(false)
            setSettingsOpen(false)
            setGetDesktopOpen(false)
          } else setCompareId(null)
        },
      },
    ],
    // act() reads the latest through a ref; only the list's own shape changes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hasLibrary, timelapseOn],
  )

  // Behind the license sheet, nothing else answers.
  useShortcuts(shortcuts, !licenseGate)
  // One window at a time: opening one closes whichever was open, so none hides behind another.
  const windows = { showHelp, settingsOpen, paletteOpen, introOpen, getDesktopOpen, feedbackOpen, tourOpen }
  const lastWindows = useRef(windows)
  useEffect(() => {
    const before = lastWindows.current
    lastWindows.current = windows
    const opened = (Object.keys(windows) as (keyof typeof windows)[]).find((k) => windows[k] && !before[k])
    if (!opened) return
    track('window', opened.replace(/Open$/, '').replace(/^show/, '').toLowerCase())
    if (opened !== 'showHelp') setShowHelp(false)
    if (opened !== 'settingsOpen') setSettingsOpen(false)
    if (opened !== 'paletteOpen') setPaletteOpen(false)
    if (opened !== 'introOpen' && introOpen) closeIntro()
    if (opened !== 'getDesktopOpen') setGetDesktopOpen(false)
    if (opened !== 'feedbackOpen') setFeedbackOpen(false)
    if (opened !== 'tourOpen') setTourOpen(false)
  })

  const setEffects = (patch: Partial<EffectParams>) => setBlend({ ...blend, effects: followSubjects(blend.effects, { ...blend.effects, ...patch }) })
  /**
   * A streak's subject changed (brushed, selected again, matched to the
   * photo): its outline, where the bars start, traced again from it, in the
   * same change.
   */
  const followSubjects = (was: EffectParams, next: EffectParams): EffectParams => {
    if (next.masks === was.masks || !streakSpace) return next
    let changed = false
    const shapes = next.streaks.shapes.map((sh) => {
      if (!sh.subject) return sh
      const now = next.masks.find((m) => m.id === sh.subject!.mask)
      const before = was.masks.find((m) => m.id === sh.subject!.mask)
      if (!now) return sh
      // A drawn outline as its subject: the streak's own outline is it.
      if (!now.raster) {
        if (now.outline === before?.outline || now.outline.length < 3) return sh
        changed = true
        return { ...sh, outline: now.outline }
      }
      if (now.raster === before?.raster) return sh
      const outline = subjectOutline(now.raster, sh.subject.inset, streakSpace)
      if (!outline || outline.length < 3) return sh
      changed = true
      return { ...sh, outline }
    })
    return changed ? { ...next, streaks: { ...next.streaks, shapes } } : next
  }
  const setDefects = (patch: Partial<DefectParams>) => setEffects({ defects: { ...blend.effects.defects, ...patch } })
  const setLeaks = (patch: Partial<LeakParams>) => setEffects({ leaks: { ...blend.effects.leaks, ...patch } })
  const lighting = blend.effects.lighting ?? DEFAULT_LIGHTING
  const setLighting = (patch: Partial<LightingParams>, step: string | null = null) => {
    history.hint(step)
    setEffects({ lighting: { ...lighting, ...patch } })
  }
  const setLight = (i: number, patch: Partial<LightShape>, step: string) =>
    setLighting({ lights: lighting.lights.map((l, j) => (j === i ? { ...l, ...patch } : l)), ...(lighting.enabled ? {} : { enabled: true }) }, step)
  const kaleido = blend.effects.kaleido ?? DEFAULT_KALEIDO
  const setKaleido = (patch: Partial<KaleidoParams>, step: string | null = null) => {
    history.hint(step)
    setEffects({ kaleido: { ...kaleido, ...patch } })
  }
  const recolour = blend.effects.recolour ?? DEFAULT_RECOLOUR
  const recolourItems = recolour.items
  /** Recolour part `i` changed (switching the module on with it). */
  const setRecolourItem = (i: number, patch: Partial<RecolourItem>, step: string | null = null) => {
    history.hint(step)
    setEffects({ recolour: { enabled: true, items: recolourItems.map((it, j) => (j === i ? { ...it, ...patch } : it)) } })
  }
  /** Where the Kaleidoscope's own part is in the masks; -1: none (a slice of the photo). */
  const kaleidoPieceAt = kaleido.source ? blend.effects.masks.findIndex((m) => m.id === kaleido.source) : -1
  const repeats = blend.effects.repeat ?? DEFAULT_REPEAT_MODULE
  /**
   * The repeat open in Repeat's list; past the end (or none open), the one
   * about to be made: its piece being picked, drawn or painted, or a Start
   * from chosen. It joins the list once something is set on it (repeatWith).
   */
  const [repeatOpen, setRepeatOpen] = useState<number | null>(null)
  /**
   * A piece being made for a new repeat (Repeat's Select subject, Draw
   * outline, Paint): it goes to a new one in the list even if the change
   * lands before the list shows that one as open.
   */
  const newRepeatNow = useRef(false)
  const repeatAt = repeatOpen !== null && repeatOpen < repeats.items.length ? repeatOpen : repeats.items.length
  const repeat = repeats.items[repeatAt] ?? NEW_REPEAT
  /** Repeat with the open repeat changed; the one about to be made is added to the list, and opened. */
  const repeatWith = (patch: Partial<RepeatParams>): RepeatModuleParams => {
    const at = newRepeatNow.current ? repeats.items.length : repeatAt
    if (at < repeats.items.length) return { ...repeats, items: repeats.items.map((r, i) => (i === at ? { ...r, ...patch } : r)) }
    newRepeatNow.current = false
    setRepeatOpen(repeats.items.length)
    return { enabled: true, items: [...repeats.items, { ...newRepeat(newId('repeat')), ...patch }] }
  }
  const [repeatPieceShown, setRepeatPieceShown] = useState(false)
  // Where Repeat's piece is: its path starts or runs through there (RepeatParams.pieceOnPath).
  const repeatSourceMask = blend.effects.masks.find((m) => m.id === repeat.source) ?? null
  const repeatStart = useMemo(() => (repeatSourceMask ? pieceCentreOf(repeatSourceMask) : null), [repeatSourceMask])
  // A ready-made start or a new Repeat fitted to its piece once there is one
  // (RepeatParams.fitPending): the way there is room, spaced to the edge.
  useEffect(() => {
    if (!repeat.fitPending || !repeatSourceMask) return
    const patch = fitRepeatToPiece(repeat, pieceBoxOf(repeatSourceMask), false, repeat.fitPending === 'within', repeat.fitPending === 'any')
    setRepeat({ ...patch, fitPending: undefined })
    // A path given to start from: it shows on the photo at once, its points there to drag or add to. A
    // moment later, so making the original is a step of its own (Cancel on the path keeps it); not while
    // the original is still being painted or selected.
    // (Not cleared with the effect: clearing fitPending runs it again at once.)
    if (patch.path)
      setTimeout(() => {
        if (!brushingNow.current && !pickingNow.current) setEditingRepeat(true)
      }, 60)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeat.fitPending, repeatSourceMask])
  /**
   * Line up with the photo (the panel's button): the subject's own straight
   * edges found round it, as a streak's are (matchStreakLines), running the
   * way the copies go; where they meet is the copies' vanishing point, so
   * they carry the subject on in its own perspective. Edges that do not
   * meet (seen straight on) turn the line of copies to run along them.
   */
  const lineUpRepeat = () => {
    if (!image || !repeatSourceMask || !streakSpace) return
    const got = repeatLineUp(image.bitmap, repeat, pieceBoxOf(repeatSourceMask), streakSpace, photoFrameOf(image.size, blend))
    if (!got) {
      setStatus('No straight edges found along the subject')
      return
    }
    history.hint(`${WHOLE_STEP}lining repeat up with the photo`)
    setRepeat(got.patch)
    setStatus(
      got.patch.vanish
        ? `Lined up with ${got.edges} edges in the photo: the copies run toward where they meet. Adjust on photo moves its lines.`
        : 'Its edges run parallel: the copies turned to run along them.',
    )
  }
  /** Perspective on, before it is lined up: the point well along the way the copies go, the lines parallel-ish, to drag onto the edges. */
  const perspectiveRepeat = (on: boolean) => {
    if (!repeatSourceMask) return
    if (!on) return setRepeat({ vanish: null }, `${WHOLE_STEP}repeat without perspective`)
    const box = pieceBoxOf(repeatSourceMask)
    const a = (((repeat.up !== 0 ? (repeat.up > 0 ? -90 : 90) : repeat.across >= 0 ? 0 : 180) + (repeat.angle ?? 0)) * Math.PI) / 180
    const far = 6 * Math.max(box.width, box.height)
    setRepeat({ vanish: { x: box.x + box.width / 2 + Math.cos(a) * far, y: box.y + box.height / 2 + Math.sin(a) * far }, angle: 0 }, `${WHOLE_STEP}repeat in perspective`)
    setEditingRepeat(true)
  }
  /** Fit to the photo (the panel's button): spaced so the last copy reaches the edge, the way they go now. */
  const fitRepeatNow = () => {
    if (!repeatSourceMask) return
    // (An edit from before Spacing takes it up now.)
    const spacing = repeat.spacing ?? [1, 1]
    setRepeat({ spacing, ...fitRepeatToPiece({ ...repeat, spacing }, pieceBoxOf(repeatSourceMask), true) }, `${WHOLE_STEP}fitting repeat to the photo`)
  }
  const setRepeat = (patch: Partial<RepeatParams>, step: string | null = null) => {
    history.hint(step)
    setEffects({ repeat: repeatWith(patch) })
  }
  /**
   * The crop as you last set it before turning the photo, and the crop that
   * turning made from it: each turn fits that crop inside the turned photo,
   * so turning back gives it back rather than only ever shrinking it.
   */
  const turnFrom = useRef<{ base: CropParams; made: CropParams } | null>(null)
  /**
   * While the crop is set on the photo, changes of one kind in a row are one
   * step (SESSION_STEP): dragging the frame about, or straightening by
   * degrees. Another kind (a shape chosen, then the photo turned) is a step
   * of its own, so undo takes back one at a time.
   */
  const setCrop = (patch: Partial<CropParams>, step?: string | null) => {
    const now = blend.effects.crop
    if (step === undefined) {
      const differs = (k: keyof CropParams) => k in patch && (patch[k] ?? 0) !== (now[k] ?? 0)
      const kind = differs('quarter') ? 'turn' : differs('angle') ? 'straighten' : differs('aspect') || differs('turned') ? 'shape' : 'frame'
      step = editingCropNow.current ? `${SESSION_STEP}crop:${cropSession.current}:${kind}` : null
    }
    history.hint(step)
    const turning = 'angle' in patch && Object.keys(patch).every((k) => k === 'angle' || k === 'enabled')
    const same = (a: CropParams, b: CropParams) => a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height && (a.angle ?? 0) === (b.angle ?? 0)
    // Turning on from a crop made by turning: from the crop it was made from. Anything else (moved, sized, undone) is the crop to turn from next.
    const base = turning && turnFrom.current && same(now, turnFrom.current.made) ? turnFrom.current.base : now
    const next = { ...base, ...patch }
    // Turned, it keeps inside the turned photo: no empty corner.
    const made = image && cropAngle(next) ? keepInside(next, image.size) : next
    turnFrom.current = turning ? { base, made } : null
    setEffects({ crop: made })
  }
  /** An aspect chosen: the crop becomes the largest of that shape around where it is. */
  const cropTo = (aspect: CropParams['aspect'], turned = blend.effects.crop.turned, step?: string) => {
    track('crop_aspect', String(aspect))
    const c = { ...blend.effects.crop, aspect, turned, enabled: true }
    const r = image ? cropRatio(c, image.size) : null
    setCrop({ ...c, ...(r && image ? fitRatio(c, image.size, r) : {}) }, step)
  }
  /**
   * `step` names a streak or mask edit so the whole of it is one step to
   * undo: further changes with the same step fold into it (see history.ts).
   */
  const remember = (step: string | null) => history.hint(step)
  const setStreaks = (patch: Partial<StreakParams>, step: string | null = null) => {
    remember(step)
    setEffects({ streaks: { ...blend.effects.streaks, ...patch } })
  }
  const setMasks = (masks: MaskShape[], step: string | null = null, made: MadeFor = { maskUse: blend.effects.maskUse }) => {
    remember(step)
    setEffects({ masks, ...made })
  }
  type MadeFor = { maskUse: EffectParams['maskUse']; streaks?: StreakParams }
  /**
   * A new mask used by what it was made for, if anything: the module's
   * masks, or the streak's (ticked, on the side asked for unless the streak
   * already has masks on a side). Goes in the same change as the mask.
   */
  const usedBy = (target: NewMaskTarget | null, id: string, name?: string): MadeFor => {
    const maskUse = { ...blend.effects.maskUse }
    if (target?.section) {
      const use = maskUse[target.section]
      const mode = use?.ids.length ? use.mode : target.mode
      maskUse[target.section] = { ids: [...(use?.ids ?? []).filter((x) => x !== id), id], mode }
      // Says where the module now works, so the new mask's use is plain.
      const def = MODULE_BY_ID[target.section as StackModuleId]
      if (def && name) setStatus(`${def.title} ${mode === 'only' ? 'only inside' : 'everywhere but'} ${name}`)
    }
    const streak = target?.streak !== undefined ? blend.effects.streaks.shapes[target.streak] : undefined
    if (!streak) return { maskUse }
    const masked = streak.maskMode !== 'off' && streak.maskIds.some((x) => blend.effects.masks.some((m) => m.id === x))
    const shapes = blend.effects.streaks.shapes.map((sh, j) =>
      j === target!.streak ? { ...sh, maskMode: masked ? sh.maskMode : target!.mode, maskIds: [...sh.maskIds.filter((x) => x !== id), id] } : sh,
    )
    return { maskUse, streaks: { ...blend.effects.streaks, shapes } }
  }
  /**
   * A mask just made for a module (from its Mask menu, Draw glass area…): the
   * module switches on with it, in the same step, so the mask shows at once.
   */
  const switchOnFor = (target: NewMaskTarget | null | undefined) => {
    const id = (target?.streak !== undefined ? 'streaks' : target?.section) as StackModuleId | undefined
    if (!id || !MODULE_BY_ID[id]) return
    setBlend((prev) => (inUse(id, prev) ? prev : startModule(id, prev)))
  }
  /** What History calls a mask made for a module: "Mask for grain". */
  const maskStepFor = (target: NewMaskTarget | null | undefined): string | null => {
    if (target?.streak !== undefined) return `${WHOLE_STEP}a mask for streak ${target.streak + 1}`
    const def = target?.section ? MODULE_BY_ID[target.section as StackModuleId] : undefined
    return def ? `${WHOLE_STEP}a mask for ${def.title.toLowerCase()}` : null
  }
  /** A mask made for a streak (its Mask tab) is the streak's own, kept in it and out of the Masks list. */
  const ownedFor = (target: NewMaskTarget | null | undefined) => (target?.streak !== undefined ? { owner: 'streak' as const } : {})
  /** The masks in the Masks list: not a module's own piece (Repeat's). */
  const listedMasks = blend.effects.masks.filter((m) => !m.owner)
  /** A copy of a mask, next after it, named as one; used by nothing until it is chosen somewhere. */
  const duplicateMask = (i: number) => {
    const m = blend.effects.masks[i]
    if (!m || blend.effects.masks.length >= MAX_MASKS) return
    const copy = { ...structuredClone(m), id: newId('mask'), name: `${m.name} copy` }
    history.hint(`${WHOLE_STEP}copying ${m.name}`)
    setEffects({ masks: [...blend.effects.masks.slice(0, i + 1), copy, ...blend.effects.masks.slice(i + 1)] })
    setSelectedMask(i + 1)
    setStatus(`${copy.name} made: choose it where it should apply.`)
  }
  const removeMask = (i: number) => {
    setBrushing(null)
    const m = blend.effects.masks[i]
    if (!m) return
    // Removed while it (or any mask) is edited on the photo: that edit is
    // over, kept as it is. Left open, the next mask edited would carry on in
    // it, and its Cancel would go back to before this one was removed.
    if (maskEditing || maskDrawing || maskPlacing || brushing) endFamily('masks')
    const maskUse = { ...blend.effects.maskUse }
    for (const section of Object.keys(maskUse) as MaskSection[]) {
      const ids = maskUse[section]!.ids.filter((x) => x !== m.id)
      if (ids.length) maskUse[section] = { ...maskUse[section]!, ids }
      else delete maskUse[section]
    }
    history.hint(`${WHOLE_STEP}removing ${m.name}`)
    setEffects({ masks: blend.effects.masks.filter((_, j) => j !== i), maskUse })
    setSelectedMask(null)
    setStatus(`Removed ${m.name}.`)
  }
  // Which masks the photo shows while editing: every one, or the one being
  // reshaped on its own. Drawn ones on the outline editor, made ones on theirs.
  const maskShownIdx = blend.effects.masks
    .map((_, i) => i)
    .filter((i) => (!maskSolo || i === selectedMask) && (!blend.effects.masks[i].owner || i === selectedMask))
  const drawnShown = maskShownIdx.filter((i) => maskKind(blend.effects.masks[i]) === 'outline')
  const madeShown = maskShownIdx.filter((i) => ['radial', 'gradient'].includes(maskKind(blend.effects.masks[i])))
  const setMaskUse = (section: MaskSection, use: SectionMask | undefined) => setMaskUses([[section, use]])
  /** Several modules' masks at once: one change, one step to undo. */
  const setMaskUses = (changes: [MaskSection, SectionMask | undefined][]) => {
    remember(null)
    const next = { ...blend.effects.maskUse }
    for (const [section, use] of changes) {
      if (use) next[section] = use
      else delete next[section]
    }
    setEffects({ maskUse: next })
  }
  /**
   * Select subject: clicks on the photo, a small segmentation model on this
   * machine (ml/segment.ts) finds what they point at, and its edge becomes
   * the mask's outline — so feather, grow, the tone key and reshaping all
   * work on it as on a drawn one. `index` null makes a new mask on the first
   * selection.
   */
  const [picking, setPicking] = useState<Picking | null>(null)
  const pickingNow = useRef(false)
  pickingNow.current = !!picking
  // Esc with nothing being edited lets go of a module's own mask left selected (a streak's subject,
  // Repeat's piece): it is shown on the photo only while open, and it has no row in the Masks list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || brushing || maskEditing || maskDrawing || picking) return
      if (selectedMask === null || !blend.effects.masks[selectedMask]?.owner) return
      setSelectedMask(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [brushing, maskEditing, maskDrawing, picking, selectedMask, blend.effects.masks])
  const pickSelection = useRef<Selection | null>(null)
  const pickRun = useRef(0)
  // The pick as it is now, for precise selection's sharper answer arriving later.
  const pickingRef = useRef(picking)
  pickingRef.current = picking
  const startPicking = (index: number | null, owner?: MaskOwner, target?: NewMaskTarget, streak?: number) => {
    if (!image) return
    // A pick already going is put back first, and the new one starts from the masks as they were before it.
    const earlier = picking
    if (earlier) finishPicking(false)
    // Where the edit was before this pick (or the Start from that began it): a cancel goes back there.
    if (pickStartIndex.current === null) pickStartIndex.current = history.view().current
    setBrushing(null)
    setEditingRepeat(false)
    setMaskEditing(false)
    setMaskDrawing(false)
    setEditingStreaks(false)
    setDrawingStreak(false)
    setDrawingPath(false)
    setEditingLeaks(false)
    setEditingGuides(false)
    setEditingBands(false)
    setEditingKaleido(false)
    setDrawingKaleido(false)
    setDrawingRecolour(null)
    pickSelection.current = null
    setPicking({ index, picks: [], box: null, past: [], future: [], reading: null, shown: 0, busy: false, before: earlier ? earlier.before : blend.effects.masks, beforeUse: earlier ? earlier.beforeUse : blend.effects.maskUse, ...(owner ? { owner } : {}), ...(target ? { target } : {}), ...(streak !== undefined ? { streak } : {}) })
    setStatus('Getting the selection model ready…')
    // The instruction only if this pick is still going when the model is ready.
    const run = pickRun.current
    prepareSegmenter(image.bitmap)
      .then(() =>
        setStatus((now) =>
          pickRun.current === run
            ? owner === 'streak'
              ? 'Click the thing to streak, or box it'
              : owner === 'kaleido'
                ? 'Click the part to copy round, or box it'
                : owner === 'recolour'
                  ? 'Click the part to recolour, or box it'
                : 'Click the subject, or box it'
            : now === 'Getting the selection model ready…'
              ? null
              : now,
        ),
      )
      .catch((err: Error) => setError(`Could not start selecting: ${err.message}`))
  }
  /**
   * The chosen reading as the mask (making it if it is new): the selection
   * itself, tidied and kept as a grid (engine/maskRaster.ts), so a subject in
   * pieces or with holes is exactly what was picked. Its outline is just its
   * bounds, for working out where its layer goes.
   */
  const applySelection = (p: NonNullable<typeof picking>, sel: Selection, reading: number) => {
    if (!image) return p
    // Precise selection's edge is the subject's own: only specks and pinholes are cleared, no corners rounded or edge grown.
    const cleaned = sel.precise ? cleanSelection(sel.masks[reading], sel.width, sel.height, false, false) : cleanSelection(sel.masks[reading], sel.width, sel.height)
    // Its sharper answer kept finer than a click's grid, so a full-size export has a clean edge.
    const small = shrinkGrid(cleaned, sel.width, sel.height, sel.sharp ? PRECISE_SIDE : RASTER_SIDE)
    const bounds = rasterBounds(small.grid, small.w, small.h)
    if (!bounds) return p
    // Photo fractions to the fractions masks are kept in.
    const pf = photoFrameOf(image.size, blend)
    const sf = shapeFrame(image.size, blend)
    const toShape = (q: { x: number; y: number }) => ({ x: (pf.x + q.x * pf.width - sf.x) / sf.width, y: (pf.y + q.y * pf.height - sf.y) / sf.height })
    const tl = toShape({ x: 0, y: 0 })
    const br = toShape({ x: 1, y: 1 })
    const raster = { w: small.w, h: small.h, runs: encodeRaster(small.grid, small.w, small.h), x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y }
    const a = toShape({ x: bounds.x, y: bounds.y })
    const b = toShape({ x: bounds.x + bounds.width, y: bounds.y + bounds.height })
    const outline = [
      { x: a.x, y: a.y },
      { x: b.x, y: a.y },
      { x: b.x, y: b.y },
      { x: a.x, y: b.y },
    ]
    const masks = blend.effects.masks
    if (p.index === null || !masks[p.index]) {
      if (masks.length >= MAX_MASKS) return p
      if (p.owner === 'repeat') {
        // Repeat's own piece: copied from as soon as it is made.
        const id = newId('mask')
        remember(null)
        setEffects({ masks: [...masks, { ...DEFAULT_MASK, id, name: 'Original', outline, raster, owner: 'repeat' }], repeat: { ...repeatWith({ source: id, enabled: true }), enabled: true } })
        return { ...p, index: masks.length, shown: reading }
      }
      // The Kaleidoscope's part: copied round as soon as it is made.
      if (p.owner === 'kaleido') {
        const id = newId('mask')
        history.hint(`${WHOLE_STEP}selecting the Kaleidoscope's part`)
        // A part drawn before goes: it has one part at a time.
        const kept = masks.filter((m) => !(m.owner === 'kaleido' && m.id === kaleido.source))
        setEffects({ masks: [...kept, { ...DEFAULT_MASK, id, name: 'Kaleidoscope part', outline, raster, owner: 'kaleido' }], kaleido: { ...kaleido, source: id, enabled: true } })
        return { ...p, index: kept.length, shown: reading }
      }
      // A part to recolour: a new one in Recolour's list, in the next colour, at once.
      if (p.owner === 'recolour') {
        if (recolourItems.length >= MAX_RECOLOURS) return p
        const id = newId('mask')
        let n = 1
        while (masks.some((m) => m.owner === 'recolour' && m.name === `Part ${n}`)) n++
        history.hint(`${WHOLE_STEP}selecting part ${n} to recolour`)
        setEffects({
          masks: [...masks, { ...DEFAULT_MASK, id, name: `Part ${n}`, outline, raster, owner: 'recolour' }],
          recolour: { enabled: true, items: [...recolourItems, newRecolourItem(newId('recolour'), id, recolourItems.length)] },
        })
        setRecolourOpen(recolourItems.length)
        return { ...p, index: masks.length, shown: reading }
      }
      // A streak's subject is its own, kept in the streak, not the Masks list.
      if (p.owner === 'streak') {
        const id = newId('mask')
        setMasks([...masks, { ...DEFAULT_MASK, id, name: 'Subject', outline, raster, owner: 'streak' }], null)
        return { ...p, index: masks.length, shown: reading }
      }
      let n = 1
      while (masks.some((m) => m.name === `Subject ${n}`)) n++
      const id = newId('mask')
      setMasks([...masks, { ...DEFAULT_MASK, id, name: `Subject ${n}`, outline, raster, ...ownedFor(p.target) }], maskStepFor(p.target), usedBy(p.target ?? null, id, `Subject ${n}`))
      switchOnFor(p.target)
      // A subject to streak stays in Streaks; the mask is there in Masks to refine later.
      if (p.owner !== 'streak') setSelectedMask(masks.length)
      return { ...p, index: masks.length, shown: reading }
    }
    // The selection is the subject's edge: an old tone key would only cut
    // holes in it (a lit spire keyed away).
    setMasks(masks.map((m, i) => (i === p.index ? { ...m, kind: undefined, outline, raster, key: 'off' as const } : m)), null)
    return { ...p, shown: reading }
  }
  const runPicks = (p: NonNullable<typeof picking>) => {
    if (!image) return
    const run = ++pickRun.current
    if (!p.picks.length && !p.box) {
      pickSelection.current = null
      // Nothing left to leave out of: clicks add again.
      setPicking({ ...p, leaveOut: false })
      return
    }
    setPicking({ ...p, busy: true })
    const stages = ['Sharpening the selection…', 'Finding the edge…']
    segment(image.bitmap, p.picks, p.box, {
      // Precise selection's sharper answer, seconds later: the same reading, if it is still this pick.
      onBetter: (sel) => {
        const cur = pickingRef.current
        if (run !== pickRun.current || !cur) return
        pickSelection.current = sel
        const reading = Math.min(cur.reading ?? sel.best, sel.masks.length - 1)
        setPicking({ ...applyLatest.current(cur, sel, reading), busy: false })
        setStatus('Selection sharpened')
      },
      onStage: (message) => {
        if (run !== pickRun.current) return
        setStatus((now) => message ?? (now && stages.includes(now) ? null : now))
      },
    })
      .then((sel) => {
        if (run !== pickRun.current || !sel) return
        pickSelection.current = sel
        // A box says what is meant: the model's own best reading; precise selection's best is its own pick.
        const reading = Math.min(p.reading ?? (p.box || sel.precise ? sel.best : defaultReading(sel, p.picks.length)), sel.masks.length - 1)
        setPicking({ ...applyLatest.current(p, sel, reading), busy: false })
      })
      .catch((err: Error) => {
        if (run !== pickRun.current) return
        setPicking({ ...p, busy: false })
        setError(`Could not select: ${err.message}`)
      })
  }
  /** A change to the clicks or box, kept so Cmd+Z can take it back. */
  const editPicks = (p: NonNullable<typeof picking>, step: PickStep, reading = p.reading) =>
    runPicks({ ...p, ...step, reading, past: [...p.past, { picks: p.picks, box: p.box }], future: [] })
  /** Cmd+Z / Shift-Cmd+Z while selecting: the clicks, not the edit. */
  const stepPicks = (back: boolean) => {
    if (!picking) return
    const from = back ? picking.past : picking.future
    const to = from[from.length - 1]
    if (!to) {
      setStatus(back ? 'No clicks to take back.' : 'Nothing to put back.')
      return
    }
    const now = { picks: picking.picks, box: picking.box }
    runPicks({
      ...picking,
      ...to,
      past: back ? picking.past.slice(0, -1) : [...picking.past, now],
      future: back ? [...picking.future, now] : picking.future.slice(0, -1),
    })
  }
  const choosePickReading = (reading: number) => {
    if (!picking) return
    const sel = pickSelection.current
    const next = { ...picking, reading }
    if (sel) setPicking(applySelection(next, sel, reading))
    else setPicking(next)
  }
  /** The History row the edit was at when the current pick (or its Start from) began. */
  const pickStartIndex = useRef<number | null>(null)
  const finishPicking = (keep: boolean) => {
    if (!picking) return
    pickRun.current++
    // No sharper selection after Done or Cancel; the models let go when unused.
    segmentingDone()
    const from = pickStartIndex.current
    pickStartIndex.current = null
    if (!keep && from !== null && history.view().current > from) {
      // Back to before the pick, in one go: its clicks, and a Start from that
      // began it, are undone with it, and nothing is left in History.
      history.jumpTo(from)
      history.dropRedo()
      if (picking.index !== null && picking.index >= picking.before.length) setSelectedMask(null)
    } else if (!keep) {
      // Put back as it was; Repeat lets go of a piece that is gone again, and
      // a "Start from" cancelled here takes its settings back with it.
      const lost = repeats.items.some((r) => !!r.source && !picking.before.some((m) => m.id === r.source))
      const kaleidoLost = !!kaleido.source && !picking.before.some((m) => m.id === kaleido.source)
      const recolourLost = recolourItems.some((it) => !!it.source && !picking.before.some((m) => m.id === it.source))
      // Nothing picked: no step for it.
      if (lost || kaleidoLost || recolourLost || blend.effects.masks !== picking.before || blend.effects.maskUse !== picking.beforeUse) {
        remember(null)
        // A repeat whose piece was made in this pick goes with it; the Kaleidoscope goes back to its slice.
        setEffects({
          masks: picking.before,
          maskUse: picking.beforeUse,
          ...(lost ? { repeat: { ...repeats, items: repeats.items.filter((r) => !r.source || picking.before.some((m) => m.id === r.source)) } } : {}),
          ...(kaleidoLost ? { kaleido: { ...kaleido, source: null } } : {}),
          ...(recolourLost ? { recolour: { ...recolour, items: recolourItems.filter((it) => !it.source || picking.before.some((m) => m.id === it.source)) } } : {}),
        })
        if (recolourLost) setRecolourOpen(null)
      }
      if (picking.index !== null && picking.index >= picking.before.length) setSelectedMask(null)
    } else if (picking.index !== null) {
      // Open on its list, its selection tinted on the photo (see maskTint):
      // a subject has no outline to reshape. Repeat's piece stays in Repeat.
      setSelectedMask(picking.owner ? null : picking.index)
      // The photo's colours take the edge, along it: the selection only has
      // to be near. Where the two sides are too alike to tell apart, the
      // selection's own edge stays (maskCover.ts colourKeyOf).
      const m = blend.effects.masks[picking.index]
      const masks =
        m && m.key === 'off'
          ? blend.effects.masks.map((x, j) => (j === picking.index ? { ...x, keyAt: 'edge' as const, keyBand: x.keyBand ?? KEY_BAND, key: 'darker' as const } : x))
          : blend.effects.masks
      if (picking.owner === 'streak') {
        streakFromSubject(picking, masks)
        setPicking(null)
        return
      }
      if (masks !== blend.effects.masks) {
        setMasks(masks, null)
        setPicking(null)
        setStatus(null)
        return
      }
    } else if (picking.owner === 'streak') {
      setPicking(null)
      setStatus(null)
      return
    }
    setPicking(null)
    setStatus(null)
  }
  /**
   * Streak a subject, done: the subject's mask (masks, with its edge key)
   * keeps it in front, and a trail comes off it, its outline a little inside
   * the subject's edge so the bars take the subject's own colours. A new
   * streak guesses its way and length (streakSubject.ts) and starts as a
   * smear; picked again, an existing one keeps everything but its outline.
   */
  const streakFromSubject = (p: NonNullable<typeof picking>, masks: MaskShape[]) => {
    const mask = p.index !== null ? masks[p.index] : undefined
    const shapes = blend.effects.streaks.shapes
    const again = p.streak !== undefined && shapes[p.streak] ? p.streak : null
    const inset = again !== null ? (shapes[again].subject?.inset ?? SUBJECT_INSET) : SUBJECT_INSET
    const outline = mask?.raster && streakSpace ? subjectOutline(mask.raster, inset, streakSpace) : null
    if (!mask || !outline || outline.length < 3) {
      // A new streak's own subject that came to nothing goes with it.
      setEffects({ masks: again === null && mask?.owner === 'streak' ? masks.filter((m) => m !== mask) : masks })
      setStatus('Subject too thin to streak')
      return
    }
    const own = { maskIds: [mask.id], maskMode: 'exclude' as const, subject: { mask: mask.id, inset } }
    let next: StreakShape[]
    if (again !== null) {
      history.hint(`${WHOLE_STEP}selecting the streak's subject again`)
      next = shapes.map((x, j) => (j === again ? { ...x, outline, ...own } : x))
    } else {
      if (shapes.length >= MAX_STREAKS) return
      history.hint(`${WHOLE_STEP}streaking a subject`)
      const quick = pendingStreakStyle.current
      pendingStreakStyle.current = null
      if (quick === 'extend') pendingExtend.current = shapes.length
      const flow = guessFlow(mask.raster!, streakSpace!)
      const seed = Math.floor(Math.random() * 99991)
      const style = quick && quick !== 'extend' ? quick : (firstStreakPatch(shapes.length) ?? STREAK_STYLES[0].patch)
      next = [
        ...shapes,
        {
          ...STREAK_DEFAULTS,
          // Extend fits its copies to the subject: its bars stay as it sets them.
          ...(quick === 'extend' ? style : variedBars(style, seed)),
          mode: 'trail',
          angle: flow.angle,
          length: flow.length,
          outline,
          seed,
          ...own,
        },
      ]
    }
    setEffects({ masks, streaks: { ...blend.effects.streaks, enabled: true, shapes: next } })
    const i = again ?? shapes.length
    setSelectedStreak(i)
    setStreakTab('way')
    // The result, not a crowd of handles over it: the pencil shows them.
    setEditingStreaks(false)
    setStatus(again !== null ? null : 'Streaked. Its kind and direction are in Direction, its length and style in Bars.')
  }
  /** A quick streak's look, waiting for its subject (QuickEffects in Streaks). */
  const pendingStreakStyle = useRef<Partial<StreakShape> | 'extend' | null>(null)
  const pendingExtend = useRef<number | null>(null)
  useEffect(() => {
    const i = pendingExtend.current
    if (i === null || !blend.effects.streaks.shapes[i]) return
    pendingExtend.current = null
    extendSubject(i, { radial: false, radialAround: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend.effects.streaks.shapes.length])
  /** Start picking a subject to streak: a new streak (in a quick streak's look, if one was picked), or `streak` again. */
  const streakSubject = (streak?: number, style?: Partial<StreakShape> | 'extend') => {
    pendingStreakStyle.current = style ?? null
    if (picking?.owner === 'streak') return finishPicking(false)
    const sh = streak !== undefined ? blend.effects.streaks.shapes[streak] : undefined
    const at = sh?.subject ? blend.effects.masks.findIndex((m) => m.id === sh.subject!.mask) : -1
    setFixEditing(null)
    setGuidingStreak(false)
    startPicking(at >= 0 ? at : null, 'streak', undefined, streak)
  }
  /**
   * A selected subject made into points: its edge followed round and kept as
   * an outline, the selection itself gone, so it is reshaped by dragging its
   * points like one drawn by hand. Its feather and how it follows the photo
   * stay. One step.
   */
  const maskToPoints = (i: number) => {
    const m = blend.effects.masks[i]
    if (!m?.raster) return
    const got = rasterToPoints(m.raster)
    if (!got || got.points.length < 3) return setStatus('Nothing is selected in this mask to make into points.')
    const { raster: _raster, ...rest } = m
    void _raster
    if (brushing?.index === i) setBrushing(null)
    history.hint(`${WHOLE_STEP}${m.name || 'mask'} made into points`)
    setMasks(blend.effects.masks.map((x, j) => (j === i ? { ...rest, kind: 'outline' as const, outline: got.points } : x)), null)
    const left = [got.pieces ? `${got.pieces} smaller ${got.pieces === 1 ? 'piece' : 'pieces'} left out` : '', got.holes ? 'holes filled' : ''].filter(Boolean).join(', ')
    setStatus(`${m.name || 'Mask'} made into ${got.points.length} points${left ? `: the largest piece only, ${left}` : ''}.`)
  }
  /**
   * A streak's own subject (its Subject tab) or one of its own masks (its
   * Mask tab): brushed in and out on the photo (a subject brushed out past
   * a ledge, the streak starts below it), selected again, matched to the
   * photo's edge, as any selection is; copied to the Masks list.
   */
  const subjectSettings = (streak: number, maskId: string, what: 'subject' | 'mask' = 'subject') => {
    const i = blend.effects.masks.findIndex((m) => m.id === maskId)
    const m = blend.effects.masks[i]
    if (!m || m.owner !== 'streak') return null
    return (
      <>
      <div className="row">
        {!m.raster && (
          <button className={maskEditing && maskSolo && selectedMask === i ? 'on' : ''} disabled={!image} title={what === 'subject' ? 'Drag its points on the photo: the streak starts from its edge' : 'Drag its points on the photo'} onClick={() => editMaskShape(i)}>
            {maskEditing && maskSolo && selectedMask === i ? 'Done' : 'Reshape on the photo'}
          </button>
        )}
        {m.raster && (
          <button title={`Make this ${what} into points round its edge, to reshape by dragging them`} onClick={() => maskToPoints(i)}>
            Turn into points
          </button>
        )}
      </div>
      <MaskSettings
        mask={m}
        index={i}
        hasImage={!!image}
        picking={!!picking}
        brushing={brushing}
        brushSize={brushSize}
        onBrushSize={setBrushSize}
        onByColour={setBrushByColour}
        onBrush={(idx, mode) => {
          setBrushing(brushing?.index === idx && brushing.mode === mode ? null : { index: idx, mode })
          setMaskDrawing(false)
          setMaskPlacing(null)
        }}
        // A subject selected again re-makes the streak off it; one of its masks is only a mask.
        onPick={(idx) =>
          what === 'subject'
            ? startPicking(idx, 'streak', undefined, streak)
            : startPicking(idx, undefined, { streak, mode: blend.effects.streaks.shapes[streak]?.maskMode === 'only' ? 'only' : 'exclude' })
        }
        editing={false}
        onMatch={matchMask}
        onChange={(idx, patch, step) => setMasks(blend.effects.masks.map((x, j) => (j === idx ? { ...x, ...patch } : x)), step)}
        trace={traceOutline}
        cleanEdges
        named={false}
        view={maskView}
        onView={setMaskView}
        byColour={brushByColour}

      />
      </>
    )
  }
  /** A streak's own masks (its subject, the masks made in its Mask tab): kept in it, not in the Masks list. */
  const ownMasksOf = (sh: StreakShape | undefined) =>
    sh ? blend.effects.masks.filter((m) => m.owner === 'streak' && (m.id === sh.subject?.mask || sh.maskIds.includes(m.id) || m.id === sh.repeatMask)) : []
  /** A copy of streak i, next after it: its own masks copied too, so the two are changed apart. */
  const copyStreak = (i: number): boolean => {
    const shapes = blend.effects.streaks.shapes
    const sh = shapes[i]
    if (!sh || shapes.length >= MAX_STREAKS) return false
    const own = ownMasksOf(sh)
    if (blend.effects.masks.length + own.length > MAX_MASKS) {
      setStatus(`Can’t duplicate: its masks would go over the limit of ${MAX_MASKS}`)
      return false
    }
    const copy = structuredClone(sh)
    const ids = new Map(own.map((m) => [m.id, newId('mask')]))
    const swap = (id: string) => ids.get(id) ?? id
    if (copy.subject) copy.subject = { ...copy.subject, mask: swap(copy.subject.mask) }
    copy.maskIds = copy.maskIds.map(swap)
    if (copy.repeatMask) copy.repeatMask = swap(copy.repeatMask)
    const masks = [...blend.effects.masks, ...own.map((m) => ({ ...structuredClone(m), id: swap(m.id) }))]
    history.hint(`${WHOLE_STEP}copying streak ${i + 1}`)
    setEffects({ masks, streaks: { ...blend.effects.streaks, shapes: [...shapes.slice(0, i + 1), copy, ...shapes.slice(i + 1)] } })
    return true
  }
  /** Streak i removed, and its own masks with it. */
  const removeStreak = (i: number) => {
    // An edit on the photo is over, kept as it is: its streak's place in the
    // list may change, and its Cancel would bring this one back.
    if (streakSession) endStreakSession(true)
    const shapes = blend.effects.streaks.shapes
    const rest = shapes.filter((_, j) => j !== i)
    const used = (id: string) => rest.some((x) => x.subject?.mask === id || x.maskIds.includes(id) || x.repeatMask === id)
    const gone = new Set(ownMasksOf(shapes[i]).filter((m) => !used(m.id)).map((m) => m.id))
    history.hint(`${WHOLE_STEP}removing streak ${i + 1}`)
    setEffects({ streaks: { ...blend.effects.streaks, shapes: rest }, ...(gone.size ? { masks: blend.effects.masks.filter((m) => !gone.has(m.id)) } : {}) })
  }
  /** One of streak i's own masks (not its subject) removed: from the streak, and gone. */
  const removeStreakMask = (i: number, id: string) => {
    const shapes = blend.effects.streaks.shapes
    const sh = shapes[i]
    if (!sh) return
    const maskIds = sh.maskIds.filter((x) => x !== id)
    const next = { ...sh, maskIds, maskMode: maskIds.length ? sh.maskMode : ('off' as const), ...(sh.repeatMask === id ? { repeatMask: null } : {}) }
    if (brushing && blend.effects.masks[brushing.index]?.id === id) setBrushing(null)
    history.hint(`${WHOLE_STEP}removing a mask from streak ${i + 1}`)
    setEffects({ masks: blend.effects.masks.filter((m) => m.id !== id), streaks: { ...blend.effects.streaks, shapes: shapes.map((x, j) => (j === i ? next : x)) } })
  }
  /**
   * Streaks put in another order (dragged in the list): where they cross,
   * the one higher in the list is in front. What is open or being edited
   * stays with its streak.
   */
  const moveStreak = (from: number, to: number) => {
    const shapes = [...blend.effects.streaks.shapes]
    const [moved] = shapes.splice(from, 1)
    if (!moved) return
    shapes.splice(to, 0, moved)
    const follow = (k: number) => (k === from ? to : from < to && k > from && k <= to ? k - 1 : from > to && k >= to && k < from ? k + 1 : k)
    history.hint(`${WHOLE_STEP}moving streak ${from + 1} to ${to + 1}`)
    setStreaks({ shapes })
    if (selectedStreak !== null) setSelectedStreak(follow(selectedStreak))
    if (streakSession) setStreakSession({ ...streakSession, index: follow(streakSession.index) })
  }
  /** A streak's settings, copied to paste onto another (Copy settings, in its … menu); kept from photo to photo. */
  const [streakClip, setStreakClip] = useState<{ from: string; settings: Partial<StreakShape> } | null>(null)
  const copyStreakSettings = (i: number) => {
    const sh = blend.effects.streaks.shapes[i]
    if (!sh) return
    setStreakClip({ from: `Streak ${i + 1}`, settings: streakSettingsOf(sh) })
    setStatus(`Copied settings from Streak ${i + 1}`)
  }
  const pasteStreakSettings = (i: number) => {
    const sh = blend.effects.streaks.shapes[i]
    if (!sh || !streakClip) return
    history.hint(`${WHOLE_STEP}pasting ${streakClip.from.toLowerCase()}'s settings onto streak ${i + 1}`)
    setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? pasteStreakSettingsOnto(x, streakClip.settings) : x)) })
    setStatus(`Pasted settings from ${streakClip.from} onto Streak ${i + 1}`)
  }
  /** A subject streak's outline taken in (or out) to `inset`, from its subject as it now is. */
  const setSubjectInset = (i: number, inset: number) => {
    const sh = blend.effects.streaks.shapes[i]
    const mask = sh?.subject ? blend.effects.masks.find((m) => m.id === sh.subject!.mask) : undefined
    if (!sh?.subject || !mask?.raster || !streakSpace) return
    const outline = subjectOutline(mask.raster, inset, streakSpace)
    if (!outline || outline.length < 3) return
    setStreakShape(i, { outline, subject: { ...sh.subject, inset } })
  }
  /**
   * A quick repeat (QuickEffects in Repeat): its layout set, then the subject
   * to click (unless there is a piece already), then for one along a path,
   * the path to draw.
   */
  const pendingRepeatPath = useRef(false)
  const quickRepeat = (q: QuickEffect<Partial<RepeatParams>>) => {
    if (!image) return
    track('repeat_quick', q.id)
    const hasPiece = !!repeat.source && blend.effects.masks.some((m) => m.id === repeat.source)
    // A cancelled pick goes back to before this start too (finishPicking).
    if (!hasPiece) pickStartIndex.current = history.view().current
    setRepeat({ ...q.patch, enabled: true }, `${WHOLE_STEP}${q.name.toLowerCase()}`)
    pendingRepeatPath.current = !!q.path
    if (!hasPiece) {
      startPicking(null, 'repeat')
      return
    }
    if (q.path) {
      pendingRepeatPath.current = false
      setEditingRepeat(true)
      setStatus('Click points along the path, out from the subject, then Done.')
    }
  }
  useEffect(() => {
    if (!pendingRepeatPath.current || picking) return
    pendingRepeatPath.current = false
    // Picked: on to the path. Cancelled: nothing more to do.
    if (!repeat.source) return
    setEditingRepeat(true)
    setStatus('Now click points along the path, out from the subject, then Done.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picking, repeat.source])
  // The newest edit's version: a selection lands after the model has run, by
  // when the edit may have moved on.
  const applyLatest = useRef(applySelection)
  applyLatest.current = applySelection
  // Enter keeps the selection, Esc puts the masks back as they were.
  useEffect(() => {
    if (!picking) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      const key = e.key.toLowerCase()
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (key === 'z' || key === 'y')) stepPicks(key === 'z' && !e.shiftKey)
      else if (e.key === 'Enter') finishPicking(true)
      else if (e.key === 'Escape') finishPicking(false)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /**
   * Start or stop drawing a mask. From a section's Mask menu the new mask is
   * used by that section straight away. One thing on the photo at a time.
   */
  const drawMask = (target: NewMaskTarget | null) => {
    const stop = maskDrawing && newTarget?.section === target?.section && newTarget?.streak === target?.streak && !drawingPiece && !drawingKaleido
    setDrawingPiece(false)
    setDrawingKaleido(false)
    setEditingKaleido(false)
    setDrawingRecolour(null)
    // One way of making a mask at a time: a radial or gradient being placed, or a brush, stops.
    setMaskPlacing(null)
    setBrushing(null)
    setMaskDrawing(!stop)
    setNewTarget(stop ? null : target)
    setMaskEditing(true)
    setEditingStreaks(false)
    setDrawingStreak(false)
    setDrawingPath(false)
    setEditingLeaks(false)
    setEditingGuides(false)
    setEditingBands(false)
    setEditingCollage(false)
    setStatus(stop ? null : 'Click round the area')
  }
  // A placed mask's instructions ("Enter or Esc finishes…") go once it is finished.
  useEffect(() => {
    if (!maskEditing && !maskPlacing) setStatus((s) => (s && / mask placed/.test(s) ? null : s))
  }, [maskEditing, maskPlacing])
  /** Start or stop drawing Repeat's own piece, an outline round what it copies. */
  const drawPiece = () => {
    const stop = maskDrawing && drawingPiece
    drawMask(null)
    setDrawingPiece(!stop)
    setMaskDrawing(!stop)
    setMaskEditing(!stop)
    setEditingRepeat(false)
    if (!stop) setStatus('Click points round what to copy. Double-click or Done closes it.')
  }
  /** Start or stop drawing the Kaleidoscope's own part, an outline round what it copies round. */
  const drawKaleidoPiece = () => {
    const stop = maskDrawing && drawingKaleido
    if (picking) finishPicking(false)
    drawMask(null)
    setDrawingKaleido(!stop)
    setMaskDrawing(!stop)
    setMaskEditing(!stop)
    if (!stop) setStatus('Click points round the part to copy round. Double-click or Done closes it.')
  }
  /** The Kaleidoscope back on a slice of the photo: its own part, if it has one, goes. */
  const kaleidoSlice = () => {
    if (picking?.owner === 'kaleido') finishPicking(false)
    if (drawingKaleido) {
      setDrawingKaleido(false)
      setMaskDrawing(false)
      setMaskEditing(false)
    }
    const masks = blend.effects.masks.filter((m) => !(m.id === kaleido.source && m.owner === 'kaleido'))
    history.hint(`${WHOLE_STEP}copying a slice round`)
    setEffects({ masks, kaleido: { ...kaleido, source: null, enabled: true } })
  }
  /** Start or stop drawing a part to recolour: a new one, or (`again`) the open one's outline. */
  const drawRecolourPart = (again: boolean) => {
    const stop = maskDrawing && !!drawingRecolour && drawingRecolour.again === again
    if (picking) finishPicking(false)
    drawMask(null)
    setDrawingRecolour(stop ? null : { again })
    setMaskDrawing(!stop)
    setMaskEditing(!stop)
    if (!stop) setStatus('Click points round the part to recolour. Double-click or Done closes it.')
  }
  /** Select a part to recolour: a new one, or the open one again. Again while it is under way stops it. */
  const selectRecolourPart = (again: boolean) => {
    if (picking?.owner === 'recolour') {
      finishPicking(false)
      return
    }
    const it = again && recolourOpen !== null ? recolourItems[recolourOpen] : undefined
    const at = it ? blend.effects.masks.findIndex((m) => m.id === it.source) : -1
    if (!again) setRecolourOpen(null)
    startPicking(at >= 0 ? at : null, 'recolour')
  }
  /** Recolour part `i` gone, its own mask with it. */
  const removeRecolour = (i: number) => {
    const it = recolourItems[i]
    if (!it) return
    const at = blend.effects.masks.findIndex((m) => m.id === it.source && m.owner === 'recolour')
    setBrushing(null)
    if (at >= 0 && selectedMask === at) {
      setSelectedMask(null)
      setMaskEditing(false)
      setMaskSolo(false)
    }
    history.hint(`${WHOLE_STEP}removing a recoloured part`)
    setEffects({
      ...(at >= 0 ? { masks: blend.effects.masks.filter((_, j) => j !== at) } : {}),
      recolour: { ...recolour, items: recolourItems.filter((_, j) => j !== i) },
    })
    setRecolourOpen((o) => (o === null || o < i ? o : o === i ? null : o - 1))
  }
  /** A copy of part `i` after it, with a copy of its own mask. */
  const duplicateRecolour = (i: number) => {
    const it = recolourItems[i]
    const m = blend.effects.masks.find((x) => x.id === it?.source)
    if (!it || !m || recolourItems.length >= MAX_RECOLOURS || blend.effects.masks.length >= MAX_MASKS) return
    const id = newId('mask')
    let n = 1
    while (blend.effects.masks.some((x) => x.owner === 'recolour' && x.name === `Part ${n}`)) n++
    history.hint(`${WHOLE_STEP}duplicating a recoloured part`)
    setEffects({
      masks: [...blend.effects.masks, { ...m, id, name: `Part ${n}` }],
      recolour: { ...recolour, items: [...recolourItems.slice(0, i + 1), { ...it, id: newId('recolour'), source: id }, ...recolourItems.slice(i + 1)] },
    })
    setRecolourOpen(i + 1)
  }
  const toggleRecolour = (i: number) => {
    const it = recolourItems[i]
    if (!it) return
    history.hint(`${WHOLE_STEP}recoloured part ${it.enabled ? 'off' : 'on'}`)
    setEffects({ recolour: { ...recolour, ...(it.enabled ? {} : { enabled: true }), items: recolourItems.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)) } })
  }
  const openRecolour = (i: number | null) => {
    if (i === recolourOpen) return
    if (picking?.owner === 'recolour') finishPicking(false)
    if (drawingRecolour) {
      setDrawingRecolour(null)
      setMaskDrawing(false)
      setMaskEditing(false)
    }
    setBrushing(null)
    setRecolourOpen(i)
  }
  /** Where parts overlap, the one higher in the list is in front. */
  const moveRecolour = (from: number, to: number) => {
    const items = [...recolourItems]
    const [it] = items.splice(from, 1)
    items.splice(to, 0, it)
    history.hint(`${WHOLE_STEP}moving a recoloured part`)
    setEffects({ recolour: { ...recolour, items } })
    setRecolourOpen((o) => (o === from ? to : o === null ? o : o > from && o <= to ? o - 1 : o < from && o >= to ? o + 1 : o))
  }
  /** A new mask painted by hand from nothing: for the Masks list, or Repeat's own piece. */
  const newPainted = (owner?: 'repeat', target?: NewMaskTarget) => {
    if (!image || blend.effects.masks.length >= MAX_MASKS) return
    const masks = blend.effects.masks
    let n = 1
    while (masks.some((x) => x.name === `Painted ${n}`)) n++
    // An empty selection over the whole photo, to paint into.
    const pf = photoFrameOf(image.size, blend)
    const sf = shapeFrame(image.size, blend)
    const w = Math.round(RASTER_SIDE * Math.min(1, image.size.width / image.size.height))
    const h = Math.round(RASTER_SIDE * Math.min(1, image.size.height / image.size.width))
    const raster = {
      w,
      h,
      runs: encodeRaster(new Uint8Array(w * h), w, h),
      x: (pf.x - sf.x) / sf.width,
      y: (pf.y - sf.y) / sf.height,
      width: pf.width / sf.width,
      height: pf.height / sf.height,
    }
    const id = newId('mask')
    const made = { ...DEFAULT_MASK, id, name: owner ? 'Painted original' : `Painted ${n}`, outline: rasterOutline(raster), raster, ...(owner ? { owner } : ownedFor(target)) }
    history.hint(`${WHOLE_STEP}a painted mask`)
    setEffects({ masks: [...masks, made], ...(owner ? { repeat: { ...repeatWith({ source: id, enabled: true }), enabled: true } } : usedBy(target ?? null, id, made.name)) })
    if (!owner) switchOnFor(target)
    if (!owner) setSelectedMask(masks.length)
    setEditingRepeat(false)
    // Painting replaces any outline being drawn or shape being placed.
    setMaskDrawing(false)
    setDrawingPiece(false)
    setMaskPlacing(null)
    setBrushing({ index: masks.length, mode: 'add' })
    setStatus(owner ? 'Paint over what to copy' : 'Paint over what the mask covers')
  }
  /** Place a radial or gradient mask: dragged out on the photo. From a module's Mask menu, that module uses it. */
  const addShapeMask = (kind: 'gradient' | 'radial', target: NewMaskTarget | null) => {
    if (!image || blend.effects.masks.length >= MAX_MASKS) return
    setNewTarget(target)
    setMaskPlacing(kind)
    setMaskEditing(true)
    setMaskDrawing(false)
    setSelectedMask(null)
    setEditingStreaks(false)
    setDrawingStreak(false)
    setDrawingPath(false)
    setEditingLeaks(false)
    setEditingGuides(false)
    setEditingBands(false)
    setStatus(
      kind === 'radial'
        ? 'Drag on the photo from the middle out to the edge. Esc cancels.'
        : 'Drag on the photo from where the mask is full to where it fades away. Esc cancels.',
    )
  }
  /** Repeat stops copying its piece: its own is removed, a mask from the list only let go. One step. */
  // A painted piece put down without a stroke (Esc, or another tool) copies
  // nothing: it goes, so Repeat is back to its start rather than holding an empty piece.
  const lastBrushing = useRef(brushing)
  useEffect(() => {
    const was = lastBrushing.current
    lastBrushing.current = brushing
    if (!was || brushing) return
    const m = blend.effects.masks[was.index]
    if (!m?.owner || !m.raster || m.id !== repeat.source) return
    // Anything in it: the selection, or a brush stroke (kept in its own layers).
    const r = m.raster
    const filled = [r.runs, r.paintSure, r.paintIn].some((runs) => runs && decodeRaster({ w: r.w, h: r.h, runs }).some((v) => v > 0))
    if (filled) return
    // Made just now and nothing done with it: the step that made it is taken
    // back, so Repeat is exactly as before (switch, settings), with no steps left.
    const v = history.view()
    if (/painted/i.test(v.steps[v.current]?.title ?? '')) {
      history.step(true)
      history.dropRedo()
    }
    else removePiece()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brushing])
  const removePiece = () => {
    const i = blend.effects.masks.findIndex((m) => m.id === repeat.source)
    const m = blend.effects.masks[i]
    setBrushing(null)
    if (m?.owner && selectedMask === i) {
      setSelectedMask(null)
      setMaskEditing(false)
      setMaskSolo(false)
    }
    history.hint(`${WHOLE_STEP}removing Repeat's original`)
    setEffects({
      ...(m?.owner ? { masks: blend.effects.masks.filter((_, j) => j !== i) } : {}),
      repeat: repeatWith({ source: null }),
    })
  }
  /** A repeat taken out of the list, with its own piece. One step. */
  const removeRepeat = (i: number) => {
    const r = repeats.items[i]
    if (!r) return
    const pieceAt = blend.effects.masks.findIndex((m) => m.id === r.source && m.owner === 'repeat')
    setBrushing(null)
    setEditingRepeat(false)
    if (pieceAt >= 0 && selectedMask === pieceAt) {
      setSelectedMask(null)
      setMaskEditing(false)
      setMaskSolo(false)
    }
    history.hint(`${WHOLE_STEP}removing a repeat`)
    setEffects({
      ...(pieceAt >= 0 ? { masks: blend.effects.masks.filter((_, j) => j !== pieceAt) } : {}),
      repeat: { ...repeats, items: repeats.items.filter((_, j) => j !== i) },
    })
    setRepeatOpen((o) => (o === null || o < i ? o : o === i ? null : o - 1))
  }
  /** A copy of repeat `i` after it, with a copy of its own piece (so changing one leaves the other). */
  const duplicateRepeat = (i: number) => {
    const r = repeats.items[i]
    if (!r || repeats.items.length >= MAX_REPEATS) return
    const piece = blend.effects.masks.find((m) => m.id === r.source)
    const ownPiece = piece?.owner === 'repeat'
    if (ownPiece && blend.effects.masks.length >= MAX_MASKS) return
    const pieceId = ownPiece ? newId('mask') : r.source
    history.hint(`${WHOLE_STEP}duplicating a repeat`)
    setEffects({
      ...(ownPiece ? { masks: [...blend.effects.masks, { ...piece!, id: pieceId! }] } : {}),
      repeat: { ...repeats, items: [...repeats.items.slice(0, i + 1), { ...r, id: newId('repeat'), source: pieceId }, ...repeats.items.slice(i + 1)] },
    })
    setRepeatOpen(i + 1)
  }
  /** A repeat's settings, copied to paste onto another (Copy settings, in its … menu); kept from photo to photo. */
  const [repeatClip, setRepeatClip] = useState<{ from: string; settings: Partial<RepeatParams> } | null>(null)
  const copyRepeatSettings = (i: number) => {
    const r = repeats.items[i]
    if (!r) return
    setRepeatClip({ from: `Repeat ${i + 1}`, settings: repeatSettingsOf(r) })
    setStatus(`Copied settings from Repeat ${i + 1}`)
  }
  const pasteRepeatSettings = (i: number) => {
    const r = repeats.items[i]
    if (!r || !repeatClip) return
    const next = pasteRepeatSettingsOnto(r, repeatClip.settings)
    history.hint(`${WHOLE_STEP}pasting ${repeatClip.from.toLowerCase()}'s settings onto repeat ${i + 1}`)
    setEffects({ repeat: { ...repeats, items: repeats.items.map((x, j) => (j === i ? next : x)) } })
    setStatus(`Pasted settings from ${repeatClip.from} onto Repeat ${i + 1}`)
  }
  /** Repeat `i` switched on or off in the list, kept either way. */
  const toggleRepeat = (i: number) => {
    const r = repeats.items[i]
    if (!r) return
    history.hint(`${WHOLE_STEP}repeat ${r.enabled ? 'off' : 'on'}`)
    setEffects({ repeat: { ...repeats, ...(r.enabled ? {} : { enabled: true }), items: repeats.items.map((x, j) => (j === i ? { ...x, enabled: !x.enabled } : x)) } })
  }
  /** A repeat opened in the list (or none): what was being done on the photo for another stops. */
  const openRepeat = (i: number | null) => {
    newRepeatNow.current = false
    if (i === repeatOpen) return
    if (picking?.owner === 'repeat') finishPicking(false)
    if (maskDrawing && drawingPiece) drawPiece()
    setEditingRepeat(false)
    setBrushing(null)
    setRepeatOpen(i)
  }
  /** Where repeats overlap, the one higher in the list is in front: dragging one moves it up or down. */
  const moveRepeat = (from: number, to: number) => {
    const items = [...repeats.items]
    const [it] = items.splice(from, 1)
    items.splice(to, 0, it)
    history.hint(`${WHOLE_STEP}moving a repeat`)
    setEffects({ repeat: { ...repeats, items } })
    setRepeatOpen((o) => (o === from ? to : o === null ? o : o > from && o <= to ? o - 1 : o < from && o >= to ? o + 1 : o))
  }
  /** Another repeat: opened as the one about to be made, its piece to pick, draw or paint. */
  /**
   * A new repeat, from the buttons over the list: its piece selected, drawn
   * round or painted; it joins the list when the piece is made. Again while
   * it is under way stops it.
   */
  const makeRepeat = (kind: 'subject' | 'outline' | 'paint') => {
    const pickingNew = picking?.owner === 'repeat' && picking.index === null
    const drawingNew = maskDrawing && drawingPiece
    if ((kind === 'subject' && pickingNew) || (kind === 'outline' && drawingNew)) {
      if (pickingNew) finishPicking(false)
      else drawPiece()
      newRepeatNow.current = false
      return
    }
    if (repeats.items.length >= MAX_REPEATS) return
    openRepeat(repeats.items.length)
    if (drawingNew) drawPiece()
    newRepeatNow.current = true
    if (kind === 'subject') startPicking(null, 'repeat')
    else if (kind === 'outline') drawPiece()
    else newPainted('repeat')
  }
  /** Reshape a drawn mask on the photo, on its own; again stops. */
  const editMaskShape = (i: number) => {
    const on = !(maskEditing && maskSolo && selectedMask === i)
    setSelectedMask(i)
    setMaskEditing(on && !!image)
    setMaskSolo(on)
    setMaskPlacing(null)
    setMaskDrawing(false)
    if (on) {
      setEditingStreaks(false)
      setDrawingStreak(false)
      setDrawingPath(false)
      setEditingLeaks(false)
      setEditingGuides(false)
      setEditingBands(false)
      setLightEditing(false)
      setEditingRepeat(false)
    }
  }
  // Collage. Its pieces are found in the photo, which is analysed once, when
  // a collage needs it.
  const collage = blend.effects.collage
  const collageHere = !!image && collage.photo === image.seed
  const wantsAnalysis = !!image && ((collageHere && collage.pieces.length > 0) || editingCollage)
  useEffect(() => {
    if (!image || !wantsAnalysis) return
    setCollagePhoto(image.seed, image.bitmap, image.size)
    setCollageTick((t) => t + 1)
  }, [image, wantsAnalysis])
  const setCollage = (next: CollageParams, step: string | null = null) => {
    remember(step)
    setEffects({ collage: next })
  }
  /** Held to cover its piece (see constrainPlacement). */
  const held = (p: CollagePiece): CollagePiece => {
    const maps = image ? pieceMaps(image.seed, p) : null
    const img = collageImageNow(p.image)
    return maps && img && image ? { ...p, ...constrainPlacement(p, maps, img.bitmap, image.size) } : p
  }
  /**
   * A piece changed, its image held so it always covers the piece. A size
   * given to one piece is also the size the next new piece starts at, so
   * once one looks right the rest start identical (CollageParams.scale).
   */
  const setPiece = (i: number, patch: Partial<CollagePiece>, step: string | null = null) => {
    const pieces = collage.pieces.map((p, j) => (j === i ? held({ ...p, ...patch }) : p))
    setCollage({ ...collage, ...(patch.scale !== undefined ? { scale: patch.scale } : {}), pieces }, step)
  }
  /** Every piece at this one's size, once (each still held to cover its gap). */
  const matchSizes = (i: number) => {
    const size = collage.pieces[i]?.scale
    if (size === undefined) return
    setCollage({ ...collage, scale: size, pieces: collage.pieces.map((p) => held({ ...p, scale: size })) }, null)
    setStatus(`Every piece is now the size of piece ${i + 1}.`)
  }
  // While a piece's image is being moved or sized, the whole image shows
  // faintly over the photo, to see what is outside the piece.
  const [collageMoving, setCollageMoving] = useState(false)
  const [collageGhost, setCollageGhost] = useLocalStorage('ui.collageGhost', true)
  const movingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markMoving = () => {
    setCollageMoving(true)
    if (movingTimer.current) clearTimeout(movingTimer.current)
    movingTimer.current = setTimeout(() => setCollageMoving(false), 900)
  }
  /** Collage on the photo; one thing on the photo at a time. */
  // An image armed to lay into a gap switches Collage on, so the next click on the photo lays it in.
  useEffect(() => {
    if (armedImage && image && !collage.enabled) setCollage({ ...collage, enabled: true }, null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armedImage])
  const editCollage = (on: boolean) => {
    setEditingCollage(on)
    if (!on) {
      setArmedImage(null)
      setArranging(false)
      return
    }
    setMaskDrawing(false)
    setMaskEditing(false)
    setEditingStreaks(false)
    setDrawingStreak(false)
    setDrawingPath(false)
    setEditingLeaks(false)
    setEditingGuides(false)
    setEditingBands(false)
  }
  const arrangeNow = collageHere ? (collage.arrange ?? DEFAULT_ARRANGE) : DEFAULT_ARRANGE
  /**
   * Arrange's settings or cells changed. `run`: lay the images out again —
   * the pieces it made before are replaced, and gaps that are now cells
   * leave the pieces they were part of (a piece left with none goes).
   */
  const setArrange = (a: CollageArrange, run: boolean, step: string | null = null) => {
    if (!image) return
    setCollagePhoto(image.seed, image.bitmap, image.size)
    const base = collageHere ? collage : { ...DEFAULT_COLLAGE, photo: image.seed }
    if (!run) {
      setCollage({ ...base, enabled: true, photo: image.seed, arrange: a }, step)
      return
    }
    const made = arrangement(image.seed, image.size, a, collageImageNow) ?? []
    const kept = base.pieces
      .filter((p) => !p.id.startsWith(ARRANGED_ID))
      .map((p) => ({ ...p, seeds: p.seeds.filter((q) => cellAt(image.seed, a.cells, q.x, q.y) < 0) }))
      .filter((p) => p.seeds.length > 0)
    const room = MAX_COLLAGE_PIECES - kept.length
    if (made.length > room) setStatus(`Up to ${MAX_COLLAGE_PIECES} pieces: ${made.length - room} cells left out`)
    setCollage({ ...base, enabled: true, photo: image.seed, arrange: a, pieces: [...kept, ...made.slice(0, Math.max(0, room))] }, step)
    setSelectedPiece(null)
  }
  const arranged = collageHere && collage.pieces.some((p) => p.id.startsWith(ARRANGED_ID))
  // Fill gaps' Cancel: back to the row History was at when it opened.
  const fillStartRow = useRef<number | null>(null)
  const startArranging = (on: boolean) => {
    fillStartRow.current = on ? history.view().current : null
    if (on) {
      editCollage(true)
      setSelectedPiece(null)
      setArmedImage(null)
    }
    setArranging(on)
  }

  /** Filling gaps: the region chosen on the photo (its group). */
  const [fillRegion, setFillRegion] = useState<number | null>(null)
  const onCollageClick = (x: number, y: number, shift: boolean) => {
    if (!image) return
    setCollagePhoto(image.seed, image.bitmap, image.size)
    if (arranging) {
      // Filling gaps: a gap clicked is a region of its own (Shift: joined to
      // the region chosen, one image across them); a chosen gap clicked
      // chooses its region, and clicked again in it is taken off (Shift, on a
      // gap of another region: moved into the region chosen). Filled again
      // at once.
      const cells = arrangeNow.cells
      const k = cellAt(image.seed, cells, x, y)
      const hasRegion = fillRegion !== null && cells.some((c, i) => regionOf(c, i) === fillRegion)
      const imageOf = (g: number) => cells.find((c, i) => regionOf(c, i) === g && c.image)?.image
      const joined = (c: { x: number; y: number }, g: number) => ({ x: c.x, y: c.y, group: g, ...(imageOf(g) ? { image: imageOf(g) } : {}) })
      let next = cells
      if (k < 0) {
        if (!cellArea(image.seed, { x, y })) {
          setStatus('Nothing to fill there: click inside a gap.')
          return
        }
        const g = shift && hasRegion ? fillRegion! : Math.max(0, ...cells.map((c) => c.group ?? 0)) + 1
        next = [...cells, joined({ x, y }, g)]
        setFillRegion(g)
      } else {
        const g = regionOf(cells[k], k)
        if (shift && hasRegion && g !== fillRegion) next = cells.map((c, i) => (i === k ? joined(c, fillRegion!) : c))
        else if (g === fillRegion) {
          next = cells.filter((_, i) => i !== k)
          if (!next.some((c, i) => regionOf(c, i) === g)) setFillRegion(null)
        } else {
          setFillRegion(g)
          return
        }
      }
      setArrange({ ...arrangeNow, cells: next }, true)
      return
    }
    const pieces = collageHere ? collage.pieces : []
    if (armedImage) {
      const img = collageImageNow(armedImage)
      if (!img) return
      if (pieces.length >= MAX_COLLAGE_PIECES) {
        setStatus(`A collage holds up to ${MAX_COLLAGE_PIECES} pieces.`)
        return
      }
      const piece: CollagePiece = {
        ...DEFAULT_COLLAGE_PIECE,
        id: newId('piece'),
        image: armedImage,
        seeds: [{ x, y }],
        x: 0.5,
        y: 0.5,
        scale: 1,
      }
      const maps = pieceMaps(image.seed, piece)
      if (!maps) {
        setStatus('Nothing to fill there: click inside a gap.')
        return
      }
      // At the collage's shared size, so its clouds match the other pieces';
      // centred on the gap, and grown only if the gap is wider than that.
      const shared = collageHere ? collage.scale : 1
      const centre = coverPlacement(maps, img.bitmap, image.size)
      Object.assign(piece, constrainPlacement({ x: centre.x, y: centre.y, scale: shared, rotation: 0 }, maps, img.bitmap, image.size))
      history.hint(`${WHOLE_STEP}a collage piece`)
      setEffects({ collage: { enabled: true, photo: image.seed, scale: shared, pieces: [...pieces, piece] } })
      setSelectedPiece(pieces.length)
      setArmedImage(null)
      setStatus('Laid in')
      return
    }
    if (shift && selectedPiece !== null && collage.pieces[selectedPiece]) {
      const p = collage.pieces[selectedPiece]
      const maps = pieceMaps(image.seed, p)
      if (maps && pieceAt(image.seed, { ...collage, pieces: [p] }, x, y) === 0) return
      setPiece(selectedPiece, { seeds: [...p.seeds, { x, y }] })
      return
    }
    setSelectedPiece(pieceAt(image.seed, collage, x, y))
  }
  const collageEditor =
    editingCollage && image && collage.enabled
      ? {
          collage: collageHere ? collage : { ...collage, pieces: [] },
          seed: image.seed,
          selected: arranging ? null : selectedPiece,
          cells: arranging ? arrangeNow.cells : undefined,
          region: arranging ? fillRegion : null,
          armed: !!armedImage,
          version: collageTick,
          onClick: onCollageClick,
          moving: collageMoving,
          ghost: collageGhost,
          onTransform: (patch: { scale?: number; rotation?: number }) => {
            const p = selectedPiece !== null ? collage.pieces[selectedPiece] : undefined
            if (!p) return
            markMoving()
            if (patch.scale === undefined && patch.rotation === undefined) return
            // Sizing a piece sizes that piece alone: it leaves the shared size.
            setPiece(selectedPiece!, patch, `collage-transform-${p.id}`)
          },
          onMove: (dx: number, dy: number) => {
            const p = selectedPiece !== null ? collage.pieces[selectedPiece] : undefined
            if (!p) return
            markMoving()
            if (dx === 0 && dy === 0) return
            setPiece(selectedPiece!, { x: p.x + dx, y: p.y + dy }, `collage-move-${p.id}`)
          },
          // Double-click: the selected image taken out of the gap there
          // (out of its only gap, the piece goes). On a piece that was not
          // already selected before the double-click, it only selects it.
          onReset: (x: number, y: number, selectedBefore: number | null) => {
            if (arranging || armedImage) return
            const i = selectedPiece
            const p = i !== null ? collage.pieces[i] : undefined
            if (i === null || !p || selectedBefore !== i) return
            const here = gapsAt(image.seed, p, x, y)
            if (!here.length) {
              if (pieceAt(image.seed, collage, x, y) === i) setStatus('Double-click a gap to take it out')
              return
            }
            const seeds = p.seeds.filter((_, k) => !here.includes(k))
            if (!seeds.length) {
              setCollage({ ...collage, pieces: collage.pieces.filter((_, j) => j !== i) }, `collage-remove-${p.id}`)
              setSelectedPiece(null)
              setStatus('Image taken out (it was in that gap only)')
              return
            }
            setPiece(i, { seeds }, `collage-gap-${p.id}`)
            setStatus(`Image taken out of that gap: in ${seeds.length} ${seeds.length === 1 ? 'gap' : 'gaps'} now`)
          },
          onZoom: (f: number, x: number, y: number) => {
            const p = selectedPiece !== null ? collage.pieces[selectedPiece] : undefined
            if (!p) return
            markMoving()
            const scale = Math.min(20, Math.max(0.02, p.scale * f))
            const k = scale / p.scale
            const at = { x: x + (p.x - x) * k, y: y + (p.y - y) * k }
            setPiece(selectedPiece!, { scale, ...at }, `collage-size-${p.id}`)
          },
        }
      : null

  /**
   * Making a new mask for something (a module, a streak): which kind is being
   * made for it now, and starting or stopping one. `is` tells its target.
   */
  const maskMaker = (is: (t: NewMaskTarget | null | undefined) => boolean, target: (mode: 'only' | 'exclude') => NewMaskTarget) => ({
    making: (picking && is(picking.target) && picking.index === null
      ? 'subject'
      : maskDrawing && is(newTarget)
        ? 'outline'
        : maskPlacing && is(newTarget)
          ? maskPlacing
          : null) as AddKind | null,
    canMake: !!image && blend.effects.masks.length < MAX_MASKS,
    // A subject being selected for it: Part, More, Whole and Done show where it was started.
    pick: picking && is(picking.target) && pickingView ? { view: pickingView, onReading: choosePickReading, onDone: finishPicking } : null,
    onNew: (kind: AddKind, mode: 'only' | 'exclude') => {
      track('mask_add', kind, 'module')
      if (kind === 'subject') {
        if (picking && is(picking.target) && picking.index === null) finishPicking(false)
        else startPicking(null, undefined, target(mode))
      } else if (kind === 'outline') drawMask(target(mode))
      else if (kind === 'paint') newPainted(undefined, target(mode))
      else if (maskPlacing === kind && is(newTarget)) {
        setMaskPlacing(null)
        setNewTarget(null)
      } else addShapeMask(kind, target(mode))
    },
  })
  /** What a module's Mask row (and the mark in its header) needs. */
  /** A mask opened in the Masks list, its settings showing (from a module's mask panel). */
  const openMaskInList = (id: string) => {
    const i = blend.effects.masks.findIndex((m) => m.id === id)
    if (i < 0) return
    if (!leftOpen) setLeftOpen(true)
    setSelectedMask(i)
    setMaskEditing(false)
    setMaskSolo(false)
  }
  const maskFor = (section: MaskSection) => ({
    masks: listedMasks,
    use: blend.effects.maskUse[section],
    onChange: (use: SectionMask | undefined) => setMaskUse(section, use),
    onOpenMask: openMaskInList,
    onPeek: setPeekMask,
    ...maskMaker((t) => t?.section === section, (mode) => ({ section, mode })),
  })
  /** What streak `i`'s Mask tab needs to make a mask of its own. */
  const streakMaskFor = (i: number) => ({ ...maskMaker((t) => t?.streak === i, (mode) => ({ streak: i, mode })), onOpenMask: openMaskInList, onPeek: setPeekMask })
  const setStreakShape = (i: number, patch: Partial<StreakShape>) =>
    setStreaks(
      { shapes: blend.effects.streaks.shapes.map((s, j) => (j === i ? { ...s, ...patch } : s)) },
      `shape${i}:${Object.keys(patch).sort().join(',')}`,
    )
  /** Selecting a subject, as the panels show it. */
  const pickingView: PickingState | null =
    picking
      ? {
          index: picking.index,
          owner: picking.owner,
          forTarget: !!picking.target,
          clicks: picking.picks.length + (picking.box ? 1 : 0),
          shown: picking.shown,
          busy: picking.busy,
          leaveOut: !!picking.leaveOut,
          onLeaveOut: (on: boolean) => setPicking((p) => (p ? { ...p, leaveOut: on } : p)),
          // How much of the photo each reading takes, so Part, More and Whole say what they mean.
          areas:
            (picking.picks.length || picking.box) && pickSelection.current
              ? pickSelection.current.masks.map((m) => {
                  let on = 0
                  for (let j = 0; j < m.length; j += 16) on += m[j]
                  return (on * 16) / m.length
                })
              : undefined,
        }
      : null
  const stepHistoryRef = useRef<(back: boolean) => boolean>(() => false)
  stepHistoryRef.current = (back) => {
    const what = history.step(back)
    if (what === null) {
      setStatus(back ? 'Nothing to undo.' : 'Nothing to redo.')
      return true
    }
    setStatus(`${back ? 'Undid' : 'Redid'} ${what}.`)
    return true
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      const redo = (key === 'z' && e.shiftKey) || key === 'y'
      if (key !== 'z' && key !== 'y') return
      // Typing keeps its own undo.
      const el = (document.activeElement ?? e.target) as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) && (el as HTMLInputElement).type !== 'range')
        return
      if (stepHistoryRef.current(!redo)) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const streakSel = selectedStreak !== null ? blend.effects.streaks.shapes[selectedStreak] : undefined
  /** Where streak shapes are kept and measured, on the open photo (see streakLines.ts). */
  const streakSpace = image
    ? { frame: shapeFrame(image.size, blend), measure: shapeMeasure(image.size, activeBorder(blend), blend.effects.shapeUnits) }
    : null
  /**
   * Streak i's colour line (StreakShape.colourLine), edited on the photo; with
   * none yet, made first where its bars read now (along the shape's edge).
   */
  const colourLineFor = (i: number) => ({
    editing: editingColourLine === i,
    onEdit: () => {
      if (editingColourLine === i) return setEditingColourLine(null)
      const sh = blend.effects.streaks.shapes[i]
      if (!sh || !streakSpace) return
      if (!hasColourLine(sh.colourLine)) {
        const { frame, measure } = streakSpace
        const toShort = (p: { x: number; y: number }) => ({ x: (frame.x + p.x * frame.width - measure.x) / measure.unit, y: (frame.y + p.y * frame.height - measure.y) / measure.unit })
        const line = defaultColourLine(sh.outline, streakCoordsOf(sh, toShort), sh.mode === 'trail')
        if (!line.length) return setStatus("Couldn't find the streak's edge to start the line from")
        history.hint(`${WHOLE_STEP}streak ${i + 1}: colours from a sample line`)
        setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? { ...x, colourLine: line } : x)) }, null)
      }
      setEditingColourLine(i)
    },
  })
  // Its line gone (Edge chosen, the streak removed, undone): nothing left to edit.
  useEffect(() => {
    if (editingColourLine === null) return
    if (!hasColourLine(blend.effects.streaks.shapes[editingColourLine]?.colourLine)) setEditingColourLine(null)
  }, [editingColourLine, blend.effects.streaks.shapes])
  /** A streak's guides changed: its angle and perspective follow them once there are two. */
  const setStreakGuides = (i: number, guides: StreakGuide[], step: string) => {
    const sh = blend.effects.streaks.shapes[i]
    if (!sh || !streakSpace) return
    const got = image ? perspectiveFromGuides(sh, guides, streakSpace, photoFrameOf(image.size, blend)) : null
    setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? { ...x, guides, ...(got ?? {}) } : x)) }, `shape${i}:${step}`)
  }
  /** Repeat's copy length fitted to the subject along the streak, or null. */
  const repeatFit = (sh: StreakShape) => (image && streakSpace ? fitRepeatLength(image.bitmap, sh, streakSpace, photoFrameOf(image.size, blend)) : null)
  const fitRepeat = (i: number, say: boolean) => {
    const sh = blend.effects.streaks.shapes[i]
    if (!sh) return
    const fit = repeatFit(sh)
    if (!fit) {
      if (say) setStatus('No repeating pattern found along this streak')
      return
    }
    const L = fit.length
    // As many layers of it as the copies had (one, the first time).
    const n = repeatLayers(sh)
    // Copy from on a whole layer, so the first copy carries straight on from
    // the subject at the edge: past a lip it was set to skip, the nearest
    // whole layer at or beyond it.
    const from = sh.repeatFrom ?? 0
    const fromLayers = from > 0.002 ? Math.max(1, Math.ceil(from / L - 0.15)) : 0
    const repeatFrom = Math.min(0.5, Math.round(fromLayers * L * 10000) / 10000)
    setStreakShape(i, { repeatPeriod: L, repeatLength: Math.min(1, L * n), repeatFrom, repeatVanish: fit.vanish || undefined })
    if (say)
      setStatus(
        `Copy length set to ${(Math.min(1, L * n) * 100).toFixed(1)}% (${n} ${n === 1 ? 'layer' : 'layers'})${fromLayers ? `, Copy from set to ${(repeatFrom * 100).toFixed(1)}% (${fromLayers} ${fromLayers === 1 ? 'layer' : 'layers'})` : ''}${fit.vanish ? `, Copy perspective set to ${vanishWords(fit.vanish)}` : ''}`,
      )
  }
  /**
   * The streak set to carry its subject on as it is, with no streak to it:
   * the copy held all the way along every bar, the bars all alike and long
   * enough to run off the photo, no tone change along them.
   */
  /** A streak extended: the settings Extend changes, kept as they were (unless it already was extended) for Stop extending. */
  const withBeforeExtend = (x: StreakShape, ext: Partial<StreakShape>): StreakShape => ({
    ...x,
    ...ext,
    beforeExtend:
      x.beforeExtend ??
      (Object.fromEntries(Object.keys(ext).filter((k) => k !== 'lengthBeforeExtend').map((k) => [k, x[k as keyof StreakShape]]).filter(([, v]) => v !== undefined)) as StreakShape['beforeExtend']),
  })
  const extendSubject = (i: number, extra: Partial<StreakShape> = {}) => {
    const sh = blend.effects.streaks.shapes[i]
    if (!sh) return
    const fit = repeatFit({ ...sh, carry: 'repeat' })
    const L = fit?.length ?? sh.repeatLength ?? 0.08
    setStreaks({
      shapes: blend.effects.streaks.shapes.map((x, j) =>
        j === i
          ? withBeforeExtend(x, {
              carry: 'repeat' as const,
              repeatLength: L,
              ...(fit ? { repeatPeriod: fit.length, repeatVanish: fit.vanish || undefined } : {}),
              repeatHold: 1,
              repeatMirror: false,
              repeatScale: 1,
              // Kept, so another style afterwards gives the streak its own length back.
              lengthBeforeExtend: x.lengthBeforeExtend ?? x.length,
              length: 2,
              lengthMin: 1,
              lengthMax: 1,
              variation: 0,
              endSoftness: 0,
              tipAngle: 0,
              tipRange: 0,
              barVary: 0,
              stripeMax: 0,
              brightness: 0,
              contrast: 0,
              opacity: 1,
              endBrightness: 0,
              endContrast: 0,
              endOpacity: 1,
              ...extra,
            })
          : x,
      ),
    }, `${WHOLE_STEP}extending the subject`)
    setStatus(
      sh.converge
        ? `The subject carried on, in copies ${(L * 100).toFixed(1)}% deep.`
        : 'The subject carried on. For a building shot from below, use Line up with the photo too, so it narrows as it rises.',
    )
  }
  /**
   * Streak i lined up with the photo's lines; `base` first (Building chosen
   * as its kind: no curve, not radial). From Line up with the photo, its
   * guides open on the photo, in an edit begun before the change so Cancel
   * takes the lining up back too; `quiet` (choosing Building) is one step to
   * undo and opens nothing.
   */
  const matchLines = (i: number, base: Partial<StreakShape> = {}, quiet = false) => {
    const was = blend.effects.streaks.shapes[i]
    if (!was || !image || !streakSpace) return
    const sh = { ...was, ...base }
    const got = matchStreakLines(image.bitmap, sh, streakSpace, photoFrameOf(image.size, blend))
    if (!quiet) startStreakSession(i, 'guides')
    if (!got) {
      if (Object.keys(base).length) setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? { ...x, ...base } : x)) })
      setStatus(
        quiet
          ? 'No straight lines found around this streak to line it up with. Set Perspective, or lay lines along its edges with Guides.'
          : 'No straight lines found around this streak. Place guides along its edges by hand.',
      )
      return
    }
    history.hint(`${WHOLE_STEP}matching ${sh.mode === 'trail' ? 'the trail' : 'the streak'} to the photo's lines`)
    setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? { ...x, ...base, ...got } : x)) })
    setStatus(`Lined up with ${got.guides.length} lines in the photo${quiet ? '. Guides shows them on the photo to adjust.' : ', shown as guides'}`)
  }
  const glass = blend.effects.glass ?? DEFAULT_GLASS
  /** An outline traced to a key on the open photo (Trace outline to key, in streaks and masks). */
  const traceOutline: TraceOutline | undefined = image
    ? (outline, key, points) => traceKeyOutline(image.bitmap, image.size, outline, key, points)
    : undefined

  /** A module back to how it starts (resetModule), as one step to undo; what it had selected lets go. */
  const resetStackModule = (id: StackModuleId) => {
    const def = MODULE_BY_ID[id]
    history.hint(`${WHOLE_STEP}resetting ${def.title.toLowerCase()}`)
    // Its switch as it shows: on (doing something, or switched on with
    // nothing to do yet, keptOn) stays on; off stays off. As the module's
    // own control, so a switch kept on stays kept (setBlend).
    const on = inUse(id, blend) || keptOn.current.has(id)
    const was = touching.current
    touching.current = id
    setBlend(resetModule(id, blend, on))
    touching.current = was
    if (id === 'grain') setSource(createProceduralSource())
    if (id === 'leaks') setSelectedSpot(null)
    if (id === 'streaks') setSelectedStreak(null)
    if (id === 'lighting') setSelectedLight(null)
    setBaseline((g) => g + 1)
    setStatus(`${def.title} reset.`)
  }
  /**
   * The module stack: the panel shows the modules this photo uses, plus any
   * you added or switched off (pinned, so they stay put), grouped by
   * category; the rest wait on a shelf under them, one click from added.
   */
  const pinned = usePinned()
  // Which modules are in view, chosen on the rail: the photo's, a category or one of your groups.
  const stackTab = useStackTab()
  const setStackTabNow = stackTabStore.set
  const groups = useGroups()
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const tabGroup = groupOf(stackTab, groups)
  // A deleted group's tab falls back to the photo's modules.
  // So does the All tab, which is gone: the categories show every module.
  const tab: StackTab = (stackTab.startsWith('group:') && !tabGroup) || (stackTab as string) === 'all' ? 'active' : stackTab
  // The rail's last entry swaps the modules for the export settings.
  const panelPage = usePanelPage()
  // Usage counts: which parts of the app a visit gets to, once each.
  useEffect(() => {
    trackOnce('view', inLibrary ? 'library' : image ? `editor ${panelPage}` : 'start')
  }, [inLibrary, panelPage, !!image])
  // Another photo, its edit in: the modules kept in view for the last one (switched off there, added
  // with nothing to do yet) go, so In use and the rail's counts are this photo's.
  const prunedFor = useRef<string | null>(null)
  useEffect(() => {
    if (!image || openingPhoto || prunedFor.current === image.sha) return
    prunedFor.current = image.sha
    const keep = pinned.filter((id) => inUse(id, blend))
    if (keep.length !== pinned.length) setPinned(keep)
    if (keptOn.current.size) {
      keptOn.current = new Set()
      setKeptVersion((v) => v + 1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.sha, openingPhoto])
  const setStackTab = (t: StackTab) => {
    // In use lists what is in use: modules switched off there stay put while
    // it is in view, and are gone from it next time.
    setPinned(pinned.filter((id) => inUse(id, blend)))
    setStackTabNow(t)
    setPanelPage('modules')
    if (editingGroup && t !== `group:${editingGroup}`) setEditingGroup(null)
  }
  // A RAW file starts unedited, so its exposure and white balance are in view.
  const shownInStack = (id: StackModuleId) =>
    inUse(id, blend) || pinned.includes(id) || (!!image?.raw && (id === 'exposure' || id === 'balance'))
  // Every tab but the photo's own shows every module it holds, whole, in use or
  // not: off ones are greyed, and using one switches it on. Where categories
  // are listed (In use, a group), their names are labels over their modules,
  // which start folded there (StackApi.listView).
  const wouldShow = (id: StackModuleId) => (tab === 'active' ? shownInStack(id) : inTab(id, tab, groups))
  const showModule = wouldShow
  /*
   * Crop focus. A click in Crop's body, or opening it, sets the crop on the
   * photo; a click anywhere else outside the photo, folding it, switching it
   * off or leaving its page shows the cropped picture again. The photo and
   * its overlay keep it, so the crop can be dragged.
   */
  const cropShown = !!image && showModule('crop')
  useEffect(() => {
    if (!cropShown) {
      if (editingCropNow.current) setEditingCrop(false)
      return
    }
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const el = e.target as Element | null
      if (!el?.closest) return
      const mod = el.closest('#module-crop')
      if (!mod) {
        if (!el.closest('.stage')) setEditingCrop(false)
        return
      }
      if (el.closest('[data-crop-done]')) return
      if (el.closest('.section-toggle')) return setEditingCrop(mod.classList.contains('collapsed'))
      if (el.closest('.module-switch')) return setEditingCrop(false)
      if (el.closest('.section-head')) return
      setEditingCrop(true)
    }
    const onOpen = (e: Event) => (e as CustomEvent<string>).detail === 'crop' && setEditingCrop(true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('grain:open-module', onOpen)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('grain:open-module', onOpen)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cropShown])
  /*
   * Collage follows its module as Crop does: opening it, or clicking in it,
   * makes the photo answer the collage's clicks (choose a piece, lay an
   * image into a gap, add or take out gaps); a click in another module, or
   * folding it, puts that away. Only once it has pieces or an image ready
   * to lay in: before that there is nothing on the photo to click.
   */
  const collageShown = !!image && showModule('collage')
  const collageReady = collageHere && collage.enabled && collage.pieces.length > 0
  const collageFocus = useRef({ ready: false, editing: false })
  collageFocus.current = { ready: collageReady, editing: editingCollage }
  useEffect(() => {
    if (!collageShown) return
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return
      const el = e.target as Element | null
      if (!el?.closest) return
      const mod = el.closest('#module-collage')
      const { ready, editing } = collageFocus.current
      if (!mod) {
        if (editing && !el.closest('.stage') && el.closest('.stack, .module')) editCollage(false)
        return
      }
      if (el.closest('.section-toggle')) return void (ready && mod.classList.contains('collapsed') && editCollage(true))
      if (el.closest('.module-switch') || el.closest('.section-head')) return
      // Removing something (a piece, an image) or its menu: just that, without starting to edit.
      // A piece's edit button starts and stops editing itself.
      if (el.closest('.item-remove, .item-more, .item-menu, .item-edit, .collage-tile-remove')) return
      if (ready && !editing) editCollage(true)
    }
    const onOpen = (e: Event) => (e as CustomEvent<string>).detail === 'collage' && collageFocus.current.ready && editCollage(true)
    window.addEventListener('pointerdown', onDown, true)
    window.addEventListener('grain:open-module', onOpen)
    return () => {
      window.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('grain:open-module', onOpen)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collageShown])
  // A new photo starts with the cropped picture.
  useEffect(() => {
    if (editingCropNow.current) setEditingCrop(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image?.bitmap])
  /*
   * One thing on the photo at a time. Each module's on-photo modes are a
   * family (a streak's drawing, path, handles, guides and fixes go together;
   * a mask's drawing, placing, handles and brush). When any mode switches on,
   * every other family that was already on ends, whichever button started it,
   * so two tools never fight over clicks and no button stays lit for a mode
   * that has gone. A family also ends when its module is folded or out of
   * view, and everything ends when another photo opens.
   */
  type OnPhotoFamily = 'streaks' | 'colourLine' | 'masks' | 'repeat' | 'kaleido' | 'recolour' | 'picking' | 'lighting' | 'leaks' | 'dither' | 'collage' | 'crop' | 'dropper'
  const onPhotoModes: Record<OnPhotoFamily, Record<string, boolean>> = {
    streaks: { drawingStreak, drawingPath, editingStreaks, guidingStreak, fixEditing: !!fixEditing },
    masks: { maskDrawing, maskEditing, maskPlacing: !!maskPlacing, brushing: !!brushing },
    repeat: { editingRepeat, drawingPiece },
    kaleido: { editingKaleido, drawingKaleido },
    colourLine: { editingColourLine: editingColourLine !== null },
    recolour: { drawingRecolour: !!drawingRecolour },
    picking: { picking: !!picking },
    lighting: { lightDrawing, lightEditing },
    leaks: { editingLeaks, drawingLeakShape },
    dither: { editingGuides, editingBands },
    collage: { editingCollage, arranging, armedImage: !!armedImage },
    crop: { editingCrop },
    dropper: { dropper: !!dropperTarget },
  }
  const endFamily = (f: OnPhotoFamily, photoChanged = false) => {
    if (f === 'streaks') {
      setDrawingStreak(false)
      setDrawingPath(false)
      setEditingStreaks(false)
      setGuidingStreak(false)
      setFixEditing(null)
    } else if (f === 'masks') {
      setMaskDrawing(false)
      setMaskEditing(false)
      setMaskPlacing(null)
      setMaskSolo(false)
      setBrushing(null)
      setNewTarget(null)
    } else if (f === 'repeat') {
      setEditingRepeat(false)
      setDrawingPiece(false)
    } else if (f === 'colourLine') {
      setEditingColourLine(null)
    } else if (f === 'recolour') {
      if (drawingRecolour) {
        setDrawingRecolour(null)
        setMaskDrawing(false)
        setMaskEditing(false)
      }
    } else if (f === 'kaleido') {
      setEditingKaleido(false)
      if (drawingKaleido) {
        setDrawingKaleido(false)
        setMaskDrawing(false)
        setMaskEditing(false)
      }
    } else if (f === 'picking') {
      // Cancelled, the masks go back as they were; but not onto another photo.
      if (photoChanged) {
        pickRun.current++
        pickStartIndex.current = null
        setPicking(null)
      } else finishPicking(false)
    } else if (f === 'lighting') {
      setLightDrawing(false)
      setLightEditing(false)
    } else if (f === 'leaks') {
      setEditingLeaks(false)
      setDrawingLeakShape(false)
      setDraft(null)
    } else if (f === 'dither') {
      setEditingGuides(false)
      setEditingBands(false)
    } else if (f === 'collage') {
      setEditingCollage(false)
      setArranging(false)
      setArmedImage(null)
    } else if (f === 'crop') {
      setEditingCrop(false)
    } else if (f === 'dropper') {
      setDropperTarget(null)
    }
  }
  const familiesOn = (Object.keys(onPhotoModes) as OnPhotoFamily[]).filter((f) => Object.values(onPhotoModes[f]).some(Boolean))
  /**
   * Done and Cancel on the photo's status bar while anything is being drawn,
   * placed or edited there, so nothing needs a key. They press Enter and Esc,
   * which every on-photo mode already answers (its overlay closes what is
   * half-drawn, App puts the mode away), so a button and its key never differ.
   * Cancel only while something new is being made: when editing, Esc keeps
   * the changes as Enter does. Crop has its own Done on the photo.
   */
  // An edit session on a streak: its tool set on the on-photo modes.
  const applyStreakTool = (index: number, tool: StreakTool, draw = false) => {
    const sh = blend.effects.streaks.shapes[index]
    if (!sh) return
    const drawPath = tool === 'path' && (draw || !(sh.path && sh.path.length >= 2))
    const drawEnds = tool === 'ends' && (draw || !(sh.ends && sh.ends.length >= 2))
    setSelectedStreak(index)
    setDrawingStreak(false)
    setGuidingStreak(tool === 'guides')
    setFixEditing((f) => (tool === 'fixes' ? (f ?? 'edit') : null))
    setDrawingPath(drawPath || drawEnds)
    if (drawPath) setPathKind('path')
    if (drawEnds) setPathKind('ends')
    setEditingStreaks(tool !== 'fixes' && tool !== 'guides')
    setMaskEditing(false)
    setMaskDrawing(false)
    setEditingLeaks(false)
    setEditingGuides(false)
    setEditingBands(false)
    setLightEditing(false)
    setLightDrawing(false)
  }
  /** Streak i's subject on the photo, to brush in or out (or put away again); nothing else being edited. */
  const brushStreakSubject = (i: number, mode: 'add' | 'remove' = 'add') => {
    const k = blend.effects.masks.findIndex((m) => m.id === blend.effects.streaks.shapes[i]?.subject?.mask)
    if (k < 0) return setStatus(`Streak ${i + 1}'s subject is missing: select it again in its Mask tab`)
    if (!blend.effects.masks[k].raster) return editStreakSubjectShape(i)
    // Its subject on the photo, to brush in or out; nothing else being edited.
    if (streakSession) endStreakSession(true)
    if (picking) finishPicking(false)
    setSelectedStreak(i)
    setMaskDrawing(false)
    setMaskPlacing(null)
    setBrushing({ index: k, mode })
  }
  /** Streak i's subject made of points (no selection to brush): its points on the photo, to drag. */
  const editStreakSubjectShape = (i: number) => {
    const k = blend.effects.masks.findIndex((m) => m.id === blend.effects.streaks.shapes[i]?.subject?.mask)
    if (k < 0) return
    if (streakSession) endStreakSession(true)
    if (picking) finishPicking(false)
    setSelectedStreak(i)
    editMaskShape(k)
  }
  /** Streak i's subject selected again by tapping, the streak re-made off it. */
  const pickStreakSubject = (i: number) => {
    const k = blend.effects.masks.findIndex((m) => m.id === blend.effects.streaks.shapes[i]?.subject?.mask)
    if (k < 0) return
    if (streakSession) endStreakSession(true)
    setSelectedStreak(i)
    startPicking(k, 'streak', undefined, i)
  }
  const startStreakSession = (index: number, tool: StreakTool, draw = false) => {
    if (!image) return
    setStreakSession((s) => (s && s.index === index && s.photo === (image?.sha ?? null) ? { ...s, tool } : { index, tool, row: history.view().current, photo: image?.sha ?? null }))
    applyStreakTool(index, tool, draw)
  }
  /** Done (keep: what was done becomes one step) or Cancel (back to how it was when the session began). */
  const endStreakSession = (keep: boolean) => {
    const s = streakSession
    setStreakSession(null)
    setEditingStreaks(false)
    setDrawingPath(false)
    setFixEditing(null)
    setGuidingStreak(false)
    if (!s || s.photo !== (image?.sha ?? null)) return
    const now = history.view().current
    if (!keep) {
      if (now > s.row) {
        history.jumpTo(s.row)
        history.dropRedo()
      }
      setStatus(null)
    } else if (now > s.row + 1) history.squashFrom(s.row + 1)
  }
  const endStreakSessionRef = useRef(endStreakSession)
  endStreakSessionRef.current = endStreakSession
  // Its modes put away some other way (another module's tool, the panel
  // closed, another photo): the session is over, as it is.
  useEffect(() => {
    if (!streakSession) return
    const shapes = blend.effects.streaks.shapes
    if (streakSession.photo !== (image?.sha ?? null) || streakSession.index >= shapes.length) setStreakSession(null)
    else if (!(editingStreaks || drawingPath || fixEditing || guidingStreak)) endStreakSessionRef.current(true)
  }, [streakSession, editingStreaks, drawingPath, fixEditing, guidingStreak, image?.sha, blend.effects.streaks.shapes])
  // Enter is Done and Esc Cancel, unless something is being drawn or placed
  // in it (an end line, a path, a fix): that answers first, and Esc stops
  // just that.
  useEffect(() => {
    if (!streakSession) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
      if (e.key !== 'Enter' && e.key !== 'Escape') return
      if (inTextField(e.target) || document.querySelector('dialog[open], [role="dialog"]')) return
      // Guides answer their own keys: a guide being laid first, then Done or Cancel (onDone).
      if (streakSession.tool === 'guides') return
      const sub = drawingPath || fixEditing === 'add' || fixEditing === 'source'
      if (sub) {
        if (e.key === 'Escape')
          setTimeout(() => {
            setDrawingPath(false)
            if (fixEditing === 'add' || fixEditing === 'source') setFixEditing('edit')
          }, 0)
        return
      }
      e.preventDefault()
      e.stopImmediatePropagation()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      endStreakSessionRef.current(e.key === 'Enter')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [streakSession, drawingPath, fixEditing])
  const makingNew = drawingStreak || drawingPath || maskDrawing || !!maskPlacing || drawingPiece || drawingKaleido || !!drawingRecolour || lightDrawing || drawingLeakShape || !!picking || !!dropperTarget
  const pressKey = (key: 'Enter' | 'Escape' | 'Delete') => window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))

  // A straight streak bent by its arrow's middle has a curve and no arrow:
  // its edit carries on with the curve's points to drag (the Path tool).
  const sessionShape = streakSession ? blend.effects.streaks.shapes[streakSession.index] : undefined
  const sessionCurved = !!sessionShape?.path && sessionShape.path.length >= 2
  useEffect(() => {
    if (streakSession?.tool === 'direction' && sessionCurved) setStreakSession({ ...streakSession, tool: 'path' })
  }, [streakSession, sessionCurved])

  // Streak modes on with no session (put on some way other than the
  // session, which should not happen): a session for them all the same,
  // so they finish in the same box as every other edit.
  useEffect(() => {
    if (streakSession || drawingStreak || selectedStreak === null || !image) return
    if (!(editingStreaks || guidingStreak || drawingPath || fixEditing)) return
    const tool: StreakTool = guidingStreak ? 'guides' : fixEditing ? 'fixes' : drawingPath ? (pathKind === 'ends' ? 'ends' : 'path') : 'shape'
    setStreakSession({ index: selectedStreak, tool, row: history.view().current, photo: image.sha })
  }, [streakSession, drawingStreak, selectedStreak, editingStreaks, guidingStreak, drawingPath, fixEditing, pathKind, image, history])

  /*
   * Edit sessions for the other on-photo tools, as streaks have theirs:
   * from when a tool comes on to when it goes, Cancel goes back to how it
   * was when it came on, and what was done in it is one step to undo.
   * (Subject picking keeps its own: it holds the masks from before.)
   */
  const SESSION_FAMILIES: OnPhotoFamily[] = ['masks', 'repeat', 'kaleido', 'recolour', 'colourLine', 'lighting', 'leaks', 'dither', 'collage']
  const familySessions = useRef(new Map<OnPhotoFamily, { row: number; photo: string | null; cancelled?: boolean }>())
  const familiesKey = familiesOn.join(',')
  useEffect(() => {
    const open = familySessions.current
    const photo = image?.sha ?? null
    for (const f of SESSION_FAMILIES) {
      const on = familiesOn.includes(f)
      const was = open.get(f)
      if (on && !was) open.set(f, { row: history.view().current, photo })
      else if (!on && was) {
        open.delete(f)
        if (was.cancelled || was.photo !== photo) continue
        if (history.view().current > was.row + 1) history.squashFrom(was.row + 1)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [familiesKey, image?.sha])
  /** Cancel: something half made is dropped (Esc, as its overlay has it); an edit goes back to how it began. */
  const cancelFamily = (f: OnPhotoFamily) => {
    if (makingNew) {
      pressKey('Escape')
      return
    }
    const s = familySessions.current.get(f)
    if (s && s.photo === (image?.sha ?? null)) {
      s.cancelled = true
      if (history.view().current > s.row) {
        history.jumpTo(s.row)
        history.dropRedo()
      }
    }
    endFamily(f)
  }
  cancelFamilyRef.current = cancelFamily
  /** Done: something half made is closed (Enter, as its overlay has it); an edit is kept. */
  const doneFamily = (f: OnPhotoFamily) => (makingNew ? pressKey('Enter') : endFamily(f))

  /** The one thing being edited on the photo, as its box in the panel shows it (EditBox), or none. */
  // An outline being drawn: Done waits for enough points to close it, and says so.
  const drawnPoints = useStore(draftPoints)
  const outlineDone = (where: string): Partial<EditView> =>
    drawnPoints >= OUTLINE_POINTS ? {} : { doneDisabled: true, doneTitle: `Click at least ${OUTLINE_POINTS} points ${where} first` }
  const editView: EditView | null = (() => {
    if (openingPhoto || !image) return null
    const masks = blend.effects.masks
    if (picking) {
      const home = picking.owner === 'repeat' ? 'repeat' : picking.owner === 'kaleido' ? 'kaleido' : picking.owner === 'recolour' ? 'recolour' : picking.owner === 'streak' || picking.target?.streak !== undefined ? 'streaks' : (picking.target?.section ?? 'masks')
      return {
        at: 'pick',
        home,
        // Again: a mask in the list, or a streak's subject, selected over.
        name:
          picking.owner === 'kaleido'
            ? picking.index !== null && picking.index < picking.before.length
              ? 'Selecting the part again'
              : 'Selecting the part to copy'
            : picking.owner === 'recolour'
              ? picking.index !== null && picking.index < picking.before.length
                ? `Selecting ${masks[picking.index]?.name ?? 'the part'} again`
                : 'Selecting a part to recolour'
            : picking.index !== null && (picking.owner !== 'streak' || picking.streak !== undefined)
            ? `Selecting ${picking.owner === 'streak' ? 'the subject' : (masks[picking.index]?.name ?? 'the subject')} again`
            : 'Selecting a subject',
        // Its module's own output is left out while its part is selected (hideOwnOutput): said here.
        hint:
          picking.owner === 'kaleido' && kaleido.enabled
            ? 'Kaleidoscope hidden while you select'
            : picking.owner === 'recolour' && recolour.enabled && recolourItems.length
              ? 'Recolour hidden while you select'
            : picking.owner === 'repeat' && repeats.enabled && repeats.items.length
              ? 'Copies hidden while you select'
              : picking.owner === 'streak' && blend.effects.streaks.enabled && blend.effects.streaks.shapes.length
                ? 'Streaks hidden while you select'
                : undefined,
        onCancel: () => finishPicking(false),
        cancelTitle: 'Stop selecting; nothing changes (Esc)',
        onDone: () => finishPicking(true),
        doneDisabled: !(picking.picks.length || picking.box),
        doneTitle: 'Keep the selection (Enter)',
      }
    }
    if (dropperTarget)
      return {
        at: `dropper:${dropperTarget.id}`,
        home: '',
        name: 'Picking a colour',
        hint: dropFrom === 'original' ? 'Click it on the original photo' : 'Click the colour on the photo',
        // What it reads, here by the field: the edit, or the original (shown on the photo while picking).
        extras: dropperTarget.from ? undefined : (
          <span className="segmented edit-box-from" role="radiogroup" aria-label="Take a colour from">
            {(
              [
                ['edited', 'The edit', 'The colour as you see it, with the look'],
                ['original', 'The original', 'The colour in the photo itself, before the look: the photo shows it while you pick'],
              ] as const
            ).map(([from, text, title]) => (
              <button key={from} role="radio" aria-checked={dropFrom === from} className={dropFrom === from ? 'on' : ''} title={title} onClick={() => setDropFrom(from)}>
                {text}
              </button>
            ))}
          </span>
        ),
        onCancel: () => pressKey('Escape'),
        cancelTitle: 'Stop picking (Esc)',
      }
    if (drawingStreak && !streakSession)
      return {
        at: 'streaks',
        home: 'streaks',
        name: 'Drawing a new streak',
        hint: DRAWING_STREAK_HINT,
        onCancel: () => pressKey('Escape'),
        cancelTitle: 'Stop drawing it (Esc)',
        onDone: () => pressKey('Enter'),
        doneTitle: 'Close the shape (Enter)',
        ...outlineDone('for its shape'),
      }
    const sh = streakSession ? blend.effects.streaks.shapes[streakSession.index] : undefined
    if (streakSession && sh)
      return {
        // The shape (its pencil) over the streak's tabs; every other tool
        // under the button in its tab that began it (an end line, guides…).
        at: streakSession.tool === 'shape' || streakSession.tool === 'all' ? `streaks/${streakSession.index}` : `streaks/${streakSession.index}/${streakSession.tool}`,
        home: 'streaks',
        name:
          streakSession.tool === 'all'
            ? `Editing ${sh.mode === 'mask' ? 'Mask' : 'Streak'} ${streakSession.index + 1}`
            : `${sh.mode === 'mask' ? 'Mask' : 'Streak'} ${streakSession.index + 1}: ${sh.radial && streakSession.tool === 'direction' ? 'its middle' : STREAK_TOOL_NAMES[streakSession.tool].toLowerCase()}`,
        ...streakEditParts({
          shape: sh,
          tool: streakSession.tool,
          onTool: (tool, draw) => startStreakSession(streakSession.index, tool, draw),
          drawing: drawingPath,
          fixEditing,
          onAddFix: () => setFixEditing('add'),
          guideState: guidingStreak ? guideState : 'idle',
          onGuideKey: pressKey,
          guideSnap,
          onGuideSnap: setGuideSnap,
        }),
        // One tool to a box: each is begun from its own button.
        tools: undefined,
        // The pencil on a streak off a subject: its handles on the photo, and
        // its subject (the streak's shape) changed from here, as buttons.
        ...(streakSession.tool === 'all' && sh.subject
          ? {
              hint: 'Drag the handles, or change its subject',
              extras: (() => {
                const m = blend.effects.masks.find((x) => x.id === sh.subject?.mask)
                const at = streakSession.index
                return m?.raster ? (
                  <div className="edit-box-row">
                    <button title="Paint more of the photo into the subject" onClick={() => brushStreakSubject(at, 'add')}>Brush in</button>
                    <button title="Paint part of the subject out" onClick={() => brushStreakSubject(at, 'remove')}>Brush out</button>
                    <button title="Tap the subject again: the streak is re-made off it" onClick={() => pickStreakSubject(at)}>Select again</button>
                  </div>
                ) : (
                  <div className="edit-box-row">
                    <button title="Drag its points on the photo: the streak starts from its edge" onClick={() => editStreakSubjectShape(at)}>Reshape subject</button>
                    <button title="Tap the subject again: the streak is re-made off it" onClick={() => pickStreakSubject(at)}>Select again</button>
                  </div>
                )
              })(),
            }
          : {}),
        onCancel: () => endStreakSession(false),
        onDone: () => endStreakSession(true),
      }
    const newMaskAt = newTarget ? (newTarget.section ? `newmask:${newTarget.section}` : `newmask:streak${newTarget.streak}`) : 'masks'
    const newMaskHome = newTarget ? (newTarget.section ?? 'streaks') : 'masks'
    const family = (f: OnPhotoFamily) => ({
      onCancel: () => cancelFamily(f),
      cancelTitle: makingNew ? 'Stop making it (Esc)' : 'Put it back as it was when you started',
      onDone: () => doneFamily(f),
      doneTitle: makingNew ? 'Finish it (Enter)' : 'Keep the changes (Enter)',
    })
    if (editingColourLine !== null)
      return {
        at: `streaks/${editingColourLine}/colours`,
        home: 'streaks',
        name: `Streak ${editingColourLine + 1}: sample line`,
        hint: 'Drag the points',
        ...family('colourLine'),
      }
    if (drawingRecolour)
      return {
        at: drawingRecolour.again && recolourOpen !== null ? `recolour/${recolourOpen}` : 'recolour',
        home: 'recolour',
        name: drawingRecolour.again ? 'Drawing the part again' : 'Drawing a part to recolour',
        hint: recolour.enabled && recolourItems.length ? 'Recolour hidden while you draw' : 'Click round the part',
        ...family('recolour'),
        ...outlineDone('round the part'),
      }
    if (drawingKaleido) return { at: 'kaleido/piece', home: 'kaleido', name: 'Drawing the part to copy', hint: kaleido.enabled ? 'Kaleidoscope hidden while you draw' : 'Click round the part', ...family('kaleido'), ...outlineDone('round the part') }
    if (maskDrawing) return { at: newMaskAt, home: newMaskHome, name: 'Drawing a new mask', hint: 'Click round it', ...family('masks'), ...outlineDone('round it') }
    if (maskPlacing) return { at: newMaskAt, home: newMaskHome, name: maskPlacing === 'radial' ? 'Placing a radial mask' : 'Placing a gradient mask', hint: maskPlacing === 'radial' ? 'Drag from the middle out' : 'Drag from full to faded', ...family('masks') }
    // Brushing: the mask brushed (a streak's subject or Repeat's piece is not the one open in the Masks list).
    const mask = brushing ? masks[brushing.index] : selectedMask !== null ? masks[selectedMask] : undefined
    if ((maskEditing || brushing) && mask)
      return {
        // A module's own mask (Repeat's piece, a streak's) is edited in that module.
        at: mask.owner === 'recolour' ? `recolour/${recolourOpen ?? 0}` : mask.owner === 'repeat' ? `repeat/${repeatAt}` : mask.owner === 'streak' && selectedStreak !== null ? `streaks/${selectedStreak}` : `masks/${mask.id}`,
        home: mask.owner === 'recolour' ? 'recolour' : mask.owner === 'repeat' ? 'repeat' : mask.owner === 'streak' ? 'streaks' : 'masks',
        // A streak's subject is named as the streak's, as its pencil began it.
        name:
          brushing && mask.owner === 'streak' && selectedStreak !== null && blend.effects.streaks.shapes[selectedStreak]?.subject?.mask === mask.id
            ? `Streak ${selectedStreak + 1}: subject`
            : `${brushing ? 'Painting' : 'Editing'} ${mask.name}`,
        // Painting: the brush itself, in the box (which way, size, similar colours).
        extras: brushing ? (
          <BrushBox
            mode={brushing.mode}
            onMode={(mode) => setBrushing({ index: brushing.index, mode })}
            what={mask.owner === 'recolour' ? 'part' : mask.owner === 'repeat' ? 'original' : mask.owner === 'streak' ? 'subject' : 'mask'}
            size={brushSize}
            onSize={setBrushSize}
            similar={brushByColour}
            onSimilar={setBrushByColour}
            // A streak's subject, begun from its pencil, has Select again here (its panel's is in its Mask tab).
            onSelectAgain={
              mask.owner === 'streak' && selectedStreak !== null && blend.effects.streaks.shapes[selectedStreak]?.subject?.mask === mask.id
                ? () => {
                    setBrushing(null)
                    streakSubject(selectedStreak)
                  }
                : undefined
            }
          />
        ) : undefined,
        ...family('masks'),
      }
    if (editingKaleido) return { at: 'kaleido/centre', home: 'kaleido', name: 'Kaleidoscope: centre', hint: 'Drag the centre', ...family('kaleido') }
    if (drawingPiece) return { at: repeatAt < repeats.items.length ? `repeat/${repeatAt}` : 'repeat', home: 'repeat', name: 'Drawing what to copy', hint: 'Click round what to copy', ...family('repeat'), ...outlineDone('round what to copy') }
    if (editingRepeat) {
      const r = repeats.items[repeatAt]
      const hint = !r
        ? undefined
        : r.layout === 'path'
          ? 'Click to add points'
          : r.layout === 'placed'
            ? 'Click to place a copy'
            : 'Drag the lines onto its edges'
      // A path or placed copies: the box where its button is, under Layout; a grid's lines: over the repeat's tabs.
      const at = r && r.layout !== 'grid' ? `repeat/${repeatAt}/path` : `repeat/${repeatAt}`
      return { at, home: 'repeat', name: r?.layout === 'path' ? `Repeat ${repeatAt + 1}: path` : `Editing Repeat ${repeatAt + 1}`, hint, ...family('repeat') }
    }
    if (lightDrawing) return { at: 'lighting', home: 'lighting', name: 'Drawing a light', hint: 'Click round where light falls', ...family('lighting') }
    const light = selectedLight !== null ? lighting.lights[selectedLight] : undefined
    if (lightEditing && light) return { at: `lighting/${light.id}`, home: 'lighting', name: `Editing ${light.name}`, ...family('lighting') }
    if (drawingLeakShape) return { at: 'leaks', home: 'leaks', name: 'Drawing a leak', ...family('leaks') }
    if (editingLeaks) return { at: 'leaks', home: 'leaks', name: 'Editing the leaks', hint: 'Click the photo to add one', ...family('leaks') }
    if (editingGuides) return { at: 'dither/guides', home: 'dither', name: 'Editing the band guides', hint: 'Click the photo to add one', ...family('dither') }
    if (editingBands) return { at: 'dither/bands', home: 'dither', name: 'Editing the band shape', ...family('dither') }
    // Setting up an automatic fill has its own Fill and Close (CollageArrange).
    if (arranging) return null
    if (editingCollage || armedImage)
      return {
        at: 'collage',
        home: 'collage',
        name: 'Editing the collage pieces',
        hint: armedImage
          ? 'Click a gap to fill it'
          : arranging || selectedPiece !== null
            ? undefined
            : 'Click a piece',
        ...family('collage'),
      }
    return null
  })()
  /** Every on-photo mode that is on, as "family.mode". */
  const activeModes = (Object.keys(onPhotoModes) as OnPhotoFamily[]).flatMap((f) =>
    Object.entries(onPhotoModes[f])
      .filter(([, on]) => on)
      .map(([k]) => `${f}.${k}`),
  )
  const activeModesRef = useRef(activeModes)
  activeModesRef.current = activeModes
  // A module switched on by one of its action buttons (stackApi.startFrom):
  // if the mode it started (drawing, picking…) ends with nothing made
  // (cancelled, Esc), the switching on is taken back, so cancelling leaves
  // the module as it was.
  useEffect(() => {
    const s = startedFor.current
    if (!s) return
    if (!s.modes.length) {
      if (activeModes.length) s.modes = activeModes
      else if (Date.now() - s.at > 2000) startedFor.current = null
      return
    }
    // Over as soon as one of the modes it started stops (drawing ends, the pick is done or cancelled).
    if (s.modes.every((m) => activeModes.includes(m))) return
    startedFor.current = null
    // Taken back and forgotten: no greyed step left that redo could bring back.
    if (history.view().current === s.index) {
      history.step(true)
      history.dropRedo()
    }
    // Something was made: switching on and making it are one step to undo.
    else if (history.view().current === s.index + 1) history.squashFrom(s.index)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModes.join()])
  const lastOnPhoto = useRef(onPhotoModes)
  useLayoutEffect(() => {
    const before = lastOnPhoto.current
    lastOnPhoto.current = onPhotoModes
    // The families with a mode that has just switched on.
    const started = new Set(
      (Object.keys(onPhotoModes) as OnPhotoFamily[]).filter((f) => Object.entries(onPhotoModes[f]).some(([k, on]) => on && !before[f][k])),
    )
    // What each on-photo mode said when it started (its instructions), so they
    // go when another mode takes over, unless that one has said something since.
    for (const f of started) familyStatus.current[f] = status
    if (!started.size) {
      // A mode that has ended takes its instructions with it, unless something has been said since.
      for (const f of Object.keys(familyStatus.current) as OnPhotoFamily[]) {
        if (familiesOn.includes(f)) continue
        if (status !== null && familyStatus.current[f] === status) setStatus(null)
        delete familyStatus.current[f]
      }
      return
    }
    for (const f of familiesOn) {
      if (started.has(f)) continue
      if (status !== null && familyStatus.current[f] === status && ![...started].some((g) => familyStatus.current[g] !== status)) setStatus(null)
      delete familyStatus.current[f]
      endFamily(f)
    }
  })
  const familyStatus = useRef<Partial<Record<OnPhotoFamily, string | null>>>({})
  // Another photo: nothing carries over.
  const photoKey = image?.sha ?? null
  const lastPhotoKey = useRef(photoKey)
  useEffect(() => {
    if (lastPhotoKey.current === photoKey) return
    lastPhotoKey.current = photoKey
    for (const f of familiesOn) endFamily(f, true)
    // Snapshots are the photo's own: comparing one ends with it.
    setCompareId(null)
    setHoverCompareId(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey])
  // Its module folded, out of view on another tab, or the panel on Recipes or Export.
  const FAMILY_MODULE: Partial<Record<OnPhotoFamily, StackModuleId>> = { streaks: 'streaks', colourLine: 'streaks', repeat: 'repeat', kaleido: 'kaleido', recolour: 'recolour', lighting: 'lighting', leaks: 'leaks', dither: 'dither', collage: 'collage' }
  const hiddenFamilies = familiesOn.filter((f) => {
    // Picking a subject for Streaks or Repeat goes with that module (its panel is in it).
    const id = f === 'picking' ? (picking?.owner === 'repeat' ? 'repeat' : picking?.owner === 'kaleido' ? 'kaleido' : picking?.owner === 'recolour' ? 'recolour' : picking?.owner === 'streak' ? 'streaks' : undefined) : FAMILY_MODULE[f]
    return id && (panelPage !== 'modules' || !showModule(id))
  })
  useEffect(() => {
    for (const f of hiddenFamilies) endFamily(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenFamilies.join()])
  useEffect(() => {
    const folded = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      for (const [f, m] of Object.entries(FAMILY_MODULE)) if (m === id) endFamily(f as OnPhotoFamily)
    }
    window.addEventListener('grain:module-folded', folded)
    return () => window.removeEventListener('grain:module-folded', folded)
  })
  const slimModules: StackModuleId[] = []
  // Category headers wherever more than one category can be in view.
  const multiCategory = tab === 'active' || !!tabGroup
  const usedIn = (c: CategoryId) => MODULES.filter((m) => m.category === c && shownInStack(m.id)).length
  const newGroup = () => {
    const g: ModuleGroup = {
      id: Date.now().toString(36),
      name: groups.length ? `Group ${groups.length + 1}` : 'My modules',
      colour: GROUP_COLOURS[groups.length % GROUP_COLOURS.length],
      modules: [],
    }
    setGroups([...groups, g])
    setStackTabNow(`group:${g.id}`)
    setPanelPage('modules')
    setEditingGroup(g.id)
  }
  const editGroup = (id: string) => {
    setStackTabNow(`group:${id}`)
    setPanelPage('modules')
    setEditingGroup(id)
  }
  const pinModule = (id: StackModuleId) => {
    if (!pinned.includes(id)) setPinned([...pinned, id])
  }
  const addModule = (id: StackModuleId) => {
    const def = MODULE_BY_ID[id]
    if (!shownInStack(id)) {
      history.hint(`${WHOLE_STEP}adding ${def.title.toLowerCase()}`)
      track('module_on', id, 'add')
      setBlend(startModule(id, blend))
      pinModule(id)
      setStatus(`Added ${def.title.toLowerCase()}.`)
    }
    showModuleNow(id)
  }
  /**
   * A module a mask applies to, from that mask's row: shown and open with its
   * mask panel, without switching it on (on its category's page if it is off).
   */
  const goToModuleMask = (id: StackModuleId) => {
    if (!rightOpen) setRightOpen(true)
    showModuleNow(id, 'grain:open-module-mask')
  }
  // Another module from a module's own link (SeeAlso): shown where it lives, open.
  const showModuleRef = useRef<(id: StackModuleId) => void>(() => undefined)
  showModuleRef.current = (id) => {
    if (!rightOpen) setRightOpen(true)
    showModuleNow(id)
  }
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (isStackModule(id)) showModuleRef.current(id)
    }
    window.addEventListener('grain:show-module', on)
    return () => window.removeEventListener('grain:show-module', on)
  }, [])
  const showModuleNow = (id: StackModuleId, opening = 'grain:open-module') => {
    const def = MODULE_BY_ID[id]
    // Found outside what is in view (search, Cmd+K, a recipe's list): show it
    // where it lives, its category unfolded, the module itself open.
    const target: StackTab = inTab(id, tab, groups) ? tab : tabGroup ? 'active' : def.category
    // Straight there: by the rail, the modules kept in view would go, this one with them if it is off.
    if (target !== tab) setStackTabNow(target)
    setPanelPage('modules')
    // Opened once the panel has drawn it (before, a module on another tab
    // was not there to hear it), then brought into view.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (opening === 'grain:open-module') openModule(id)
        else window.dispatchEvent(new CustomEvent(opening, { detail: id }))
        requestAnimationFrame(() => document.getElementById(`module-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
      }),
    )
  }
  /**
   * The copied edit (editClip.ts): one clipboard for the whole app, kept
   * from photo to photo. ⌘C copies the photo's edit (in the Library, the
   * selected photo's) and ⌘V pastes its chosen parts (in the Library, onto
   * the selected photos); a module's ⋯ Copy settings copies with just that
   * module chosen. The parts are chosen in the Library's sidebar.
   */
  const [clip, setClip] = useState<EditClip | null>(null)
  /** This photo's edit, now. */
  const currentEdit = () => ({ blend, grainSource: source?.serialize() ?? STARTING_LOOK.doc.grainSource })
  /** Parts of the copied edit pasted onto the photo in the editor, as one step. */
  const pasteHere = async (c: EditClip, what: string) => {
    if (!image || !source) return
    const next = pasteClip(c, currentEdit())
    track('paste_edit', null, null, c.parts.length)
    history.hint(`${WHOLE_STEP}${what}`)
    if (JSON.stringify(next.grainSource) !== JSON.stringify(source.serialize())) setSource(await hydrateGrainSource(next.grainSource))
    setBlend(next.blend)
    setBaseline((g) => g + 1)
  }
  const copyEditHere = () => {
    if (!image) return
    const c = clipOf(image.name, currentEdit())
    track('copy_edit')
    setClip(c)
    setStatus(`Copied the edit of ${image.name}`)
  }
  const pasteEditHere = () => {
    if (!clip) return setStatus('Copy a photo’s edit first')
    if (!clip.parts.length) return setStatus('Nothing chosen to paste')
    void pasteHere(clip, `pasting the edit of ${clip.from}`)
    setStatus(`Pasted ${clip.parts.length === 1 ? 'one part' : `${clip.parts.length} parts`} of the edit of ${clip.from}`)
  }
  /** A module's settings, for its ⋯ menu: those with settings that carry from photo to photo. */
  const moduleSettings = (id: StackModuleId) => {
    if (!presetKind(id) && !BASE_SETTINGS[id]) return null
    const lower = MODULE_BY_ID[id].title.toLowerCase()
    return {
      copied: clip && partsOf(clip.blend).includes(id) ? clip.from : null,
      copy: () => {
        setClip(clipOf(image?.name ?? 'this photo', currentEdit(), [id]))
        setStatus(`Copied ${lower} settings`)
      },
      paste: () => {
        if (!clip) return
        void pasteHere({ ...clip, parts: [id] }, `pasting ${lower} settings`)
        pinModule(id)
        setStatus(`Pasted ${lower} settings from ${clip.from}`)
      },
    }
  }
  // ⌘C and ⌘V (and the Edit menu's Copy and Paste) in the editor: the edit,
  // unless text is being copied. The Library has its own while it shows.
  const clipKeys = useRef({ copy: copyEditHere, paste: pasteEditHere })
  clipKeys.current = { copy: copyEditHere, paste: pasteEditHere }
  useEffect(() => {
    if (inLibrary) return
    const textual = (e: Event) => inTextField(e.target) || !!window.getSelection()?.toString() || !!document.querySelector('[role="dialog"]')
    const copy = (e: ClipboardEvent) => {
      if (textual(e)) return
      e.preventDefault()
      clipKeys.current.copy()
    }
    const paste = (e: ClipboardEvent) => {
      if (textual(e)) return
      e.preventDefault()
      clipKeys.current.paste()
    }
    document.addEventListener('copy', copy)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('paste', paste)
    }
  }, [inLibrary])
  const stackApi: StackApi = {
    listView: multiCategory ? tab : undefined,
    summaryOf: (id) => moduleSummary(id, blend),
    settings: moduleSettings,
    pin: pinModule,
    wake: (id) => {
      waking.current = id
    },
    sleep: () => {
      waking.current = null
    },
    touch: (id) => {
      touching.current = id
    },
    startFrom: (id) => {
      const def = MODULE_BY_ID[id]
      // Already on (the button's own change switched it on): nothing to do.
      if (inUse(id, blendRef.current) || keptOn.current.has(id)) return
      // The row before switching on: switching on makes the next one.
      const before = history.view().current
      history.hint(`${WHOLE_STEP}switching ${def.title.toLowerCase()} on`)
      track('module_on', id, 'control')
      setBlend((prev) => (inUse(id, prev) ? prev : startModule(id, prev)))
      pinModule(id)
      startedFor.current = { index: before + 1, modes: activeModesRef.current, at: Date.now() }
    },
    isOn: (id) => inUse(id, blend) || keptOn.current.has(id),
    toggle: (id) => {
      const def = MODULE_BY_ID[id]
      if (inUse(id, blend) || keptOn.current.has(id)) {
        keptOn.current = new Set([...keptOn.current].filter((k) => k !== id))
        history.hint(`${WHOLE_STEP}switching ${def.title.toLowerCase()} off`)
        track('module_off', id)
        setBlend(stopModule(id, blend))
      } else {
        history.hint(`${WHOLE_STEP}switching ${def.title.toLowerCase()} on`)
        track('module_on', id, 'switch')
        const next = startModule(id, blend)
        // On with nothing to do yet (a straight curve, exposure at 0, no
        // second photo chosen): its switch stays on, as one turned down to
        // nothing does, until its settings do something. Made as its own
        // change, so setBlend keeps it rather than clearing what is kept.
        if (!inUse(id, next)) {
          keptOn.current = new Set([...keptOn.current, id])
          setKeptVersion((v) => v + 1)
        }
        touching.current = id
        setBlend(next)
        touching.current = null
        // Either way it stays where it is.
        pinModule(id)
        // Its module opens to show what it still needs.
        if (!inUse(id, next) || needsSetup(id, next)) return 'setup'
        return
      }
      // Either way it stays where it is.
      pinModule(id)
    },
    maskFor: (id) => maskFor(id as MaskSection),
    presetsFor: (id) => {
      const kind = presetKind(id)
      if (!kind) return null
      return (
        <PartPresets
          kind={kind}
          current={() => partOf(kind)}
          onApply={applyPart}
          onStatus={setStatus}
          fromRecipes={() =>
            [
              ...LISTED_LOOKS.filter((l) => l.id !== NONE_LOOK.id).map((l) => ({ id: `look:${l.id}`, name: l.label, doc: l.doc })),
              ...presets.map((p) => ({ id: `preset:${p.id}`, name: p.name, doc: p.data })),
            ]
              .filter((r) => inUse(id, r.doc.blend))
              .map((r) => ({ id: r.id, name: r.name, data: extractPart(kind, r.doc.blend, r.doc.grainSource) }))
          }
        />
      )
    },
    reset: resetStackModule,
    example: (id) => {
      // This photo without the module and with it: as it is now if it is in
      // use, or as adding it would start it. Nothing to show for one that
      // does nothing until something is placed (streaks, lights, a piece).
      if (!image || !source) return null
      const withIt = inUse(id, blend) ? blend : startModule(id, blend)
      if (!inUse(id, withIt)) return null
      if (id === 'repeat' && !repeatsActive(withIt.effects.repeat, withIt.effects.masks.map((m) => m.id))) return null
      const fx = withIt.effects
      if ((id === 'streaks' && !fx.streaks.shapes.length) || (id === 'collage' && !fx.collage.pieces.length) || (id === 'lighting' && !fx.lighting?.lights.length)) return null
      return <ModuleExample photo={{ bitmap: image.bitmap, seed: image.seed }} grainSource={source.serialize()} without={stopModule(id, withIt)} with={withIt} />
    },
  }

  /** Grade settings. Setting the palette's colours by hand lets go of a recipe's rule. */
  const setGrade = (patch: Partial<GradeParams>) => setEffects({ grade: mergeGrade(blend.effects.grade, patch) })
  const setStock = (patch: Partial<StockParams>) => setEffects({ stock: { ...blend.effects.stock, ...patch } })
  /** One of the newer modules' settings (engine/extras.ts). */
  const setExtra = <K extends 'lens' | 'prism' | 'double' | 'stamp' | 'mono' | 'halftone'>(key: K, patch: Partial<EffectParams[K]>) =>
    setEffects({ [key]: { ...blend.effects[key], ...patch } } as Partial<EffectParams>)
  const secondInput = useRef<HTMLInputElement>(null)
  const second = blend.effects.double.image ? collageImageNow(blend.effects.double.image) : null
  /** The base photo's corrections (engine/base.ts). */
  const baseFx = blend.effects.base
  const setBase = (patch: Partial<BaseParams>) => setEffects({ base: { ...blend.effects.base, ...patch } })
  /** The photo's pixels, small, for the automatic corrections. */
  const photoPixels = (): Uint8ClampedArray | null => {
    if (!image) return null
    const k = Math.min(1, 256 / Math.max(image.size.width, image.size.height))
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(image.size.width * k))
    c.height = Math.max(1, Math.round(image.size.height * k))
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(image.bitmap, 0, 0, c.width, c.height)
    return ctx.getImageData(0, 0, c.width, c.height).data
  }
  const autoExposure = () => {
    const px = photoPixels()
    if (!px) return
    const a = autoBase(px)
    history.hint(`${WHOLE_STEP}automatic exposure`)
    setBase({ exposure: a.exposure, contrast: a.contrast, highlights: a.highlights, shadows: a.shadows, lightOn: true })
    setStatus('Set the exposure from the photo.')
  }
  const autoBalance = () => {
    const px = photoPixels()
    if (!px) return
    const a = autoBase(px)
    history.hint(`${WHOLE_STEP}automatic white balance`)
    setBase({ temperature: a.temperature, tint: a.tint, colourOn: true })
    setStatus('Set the white balance from the photo.')
  }
  /** Click something that should be grey or white: the light is balanced to make it so. */
  const pickGrey = () => {
    const before = { temperature: baseFx.temperature, tint: baseFx.tint }
    dropper.start(
      'base-grey',
      (c) => setBase(c ? { ...neutralise(c), colourOn: true } : before),
      // Read with nothing else on, so it is the photo's own colour that is greyed.
      (b) => ({
        ...b,
        modules: Object.fromEntries(Object.keys(b.modules).map((k) => [k, false])) as unknown as BlendParams['modules'],
        effects: { ...b.effects, base: { ...b.effects.base, colourOn: false, curveOn: false } },
      }),
    )
  }
  const grade = blend.effects.grade

  // Paper colours from the finished look (paletteFit.ts, lookPapers): read
  // again only when the look's colour or tone changes.
  const paperKey = stableJson([
    blend.effects.grade,
    blend.effects.stock,
    blend.effects.exposure,
    blend.effects.fade,
    blend.effects.shoulder,
    blend.effects.vignette,
    blend.effects.solarize,
    blend.modules.colour,
    blend.modules.tone,
    blend.keys,
  ])
  // Read once the colour stops moving: it renders the look on this thread,
  // and doing it on every step of a drag kept the photo from keeping up.
  // Only made for Border, the one place they are used: on screen, or when
  // paper first appears (papersNow).
  const paperKeySettled = useSettled(paperKey, 300)
  const papersKept = useRef<{ key: string; image: unknown; grain: unknown; value: ReturnType<typeof lookPapers> } | null>(null)
  const papersNow = (key = paperKey) => {
    if (!image || !grain) return null
    const kept = papersKept.current
    if (kept && kept.key === key && kept.image === image && kept.grain === grain) return kept.value
    const value = lookPapers(blend, image.bitmap, grain, image.seed)
    papersKept.current = { key, image, grain, value }
    return value
  }
  const borderShown = showModule('border')
  // Better, once the preview has drawn the finished picture: read from it,
  // with everything the look does (picturePapers).
  const [seenPapers, setSeenPapers] = useState<{ image: unknown; value: ReturnType<typeof lookPapers> } | null>(null)
  const seen = seenPapers?.image === image ? seenPapers.value : null
  const papers = seen ?? (borderShown ? papersNow(paperKeySettled) : (papersKept.current?.value ?? null))

  // The wheels edit the palette. When a look colours the picture other ways
  // too (a film stock, tints, Isolate, Pop), what it adds up to on this photo
  // is worked out as palette colours (paletteFit.ts), so the wheels show the
  // look's real colours, and moving them carries on from there.
  const offWheel = offWheelColour(blend)
  // Worked out when asked for (pointing at or clicking Move it onto the
  // palette): it renders the look several times on this thread, and doing
  // it on every change held up opening photos and applying recipes.
  const fitKept = useRef<{ blend: BlendParams; image: unknown; grain: unknown; value: ReturnType<typeof fitPalette> } | null>(null)
  const fitNow = () => {
    if (!offWheel.length || !image || !grain) return null
    const kept = fitKept.current
    if (kept && kept.blend === blend && kept.image === image && kept.grain === grain) return kept.value
    const value = fitPalette(blend, image.bitmap, grain, image.seed)
    fitKept.current = { blend, image, grain, value }
    return value
  }
  const spots = blend.effects.leaks.spots
  const selected = selectedSpot !== null ? spots[selectedSpot] : undefined
  const setSpot = (index: number, patch: Partial<LeakSpot>) =>
    setLeaks({
      spots: spots.map((s, i) => {
        if (i !== index) return s
        const next = { ...s, ...patch }
        if ('colour' in patch && patch.colour === undefined) delete next.colour
        return next
      }),
    })
  /** A style's leaks, in the style's colour. Choosing the style already chosen leaves them as they are: Shuffle lays them out anew. */
  const applyLeakStyle = (style: LeakStyleDef) => {
    if (blend.effects.leaks.style === style.id && blend.effects.leaks.spots.length && blend.effects.leaks.amount > 0) return
    track('leak_style', style.id)
    const layoutSeed = Math.floor(Math.random() * 2 ** 31)
    setLeaks({
      style: style.id,
      layoutSeed,
      colour: style.colour,
      spots: style.generate(layoutSeed, style.count),
      amount: blend.effects.leaks.amount > 0 ? blend.effects.leaks.amount : style.amount,
    })
    setSelectedSpot(null)
  }
  const setSurge = (patch: Partial<SurgeParams>) => setEffects({ surge: { ...blend.effects.surge, ...patch } })
  /**
   * A border appearing (Width or Bottom up from nothing) on paper that was
   * never chosen starts in the look's own ink rather than the default white,
   * which rarely suits these pictures.
   */
  const unchosenPaper = (b: BorderParams) => b.colour.every((v, i) => Math.abs(v - DEFAULT_BORDER.colour[i]) < 1e-6)
  /** `step` names the change in History (a border style chosen: "the Instant border"). */
  const setBorder = (patch: Partial<BorderParams>, step?: string) => {
    if (step) history.hint(`${WHOLE_STEP}${step}`)
    const was = blend.border
    const next = { ...was, ...patch }
    const appears = was.width <= 0 && was.bottomExtra <= 0 && (next.width > 0 || next.bottomExtra > 0)
    const paper = appears && !patch.colour && unchosenPaper(was) ? (seen ?? papersNow()) : null
    if (paper) next.colour = paper[0].colour
    setBlend({ ...blend, border: next })
  }

  // One number the canvases can watch instead of measuring on every render.
  const layoutVersion = useMemo(
    // What takes space now: a closing panel keeps its space until it has gone (useLingering).
    () => ((leftPanel.shown ? leftWidth : 0) * 10000 + (rightPanel.shown ? rightWidth : 0)) * 2 + (strip.shown ? 1 : 0),
    [leftPanel.shown, leftWidth, rightPanel.shown, rightWidth, strip.shown],
  )

  const palette = useMemo(
    () => (image ? extractPalette(image.bitmap, image.size.width, image.size.height) : NEUTRAL_PALETTE),
    [image],
  )
  /** The palette as the wheel shows it: a recipe's colours as they come out on this photo. */
  const wheelShown: GradeParams = grade.recipe ? { ...grade, ...rulePatch(grade.recipe, palette) } : grade
  const recipeName = useRecipeName(grade)
  /** A recipe, or a change to the one in use: one undo step, and Colour on. */
  const applyRecipe = (patch: Partial<GradeParams>, label: string) => {
    history.hint(`${WHOLE_STEP}${label}`)
    setBlend({ ...blend, modules: { ...blend.modules, colour: true }, effects: { ...blend.effects, grade: { ...blend.effects.grade, ...patch } } })
  }
  /**
   * The wheel moved. With a recipe in use, and a harmony, the recipe is
   * reshaped (its turn and richness) so it still builds its colours from the
   * photo; Free, or no recipe, sets the three colours by hand.
   */
  const onWheel = (colours: Trio<Rgb>, mapHarmony: Harmony) => {
    const mapAmount = grade.mapAmount > 0 ? grade.mapAmount : 0.9
    const rule = grade.recipe
    if (rule && mapHarmony !== 'free') {
      setGrade({ ...rulePatch(ruleMatching(rule, palette, colours, mapHarmony), palette), mapAmount })
      return
    }
    const [shadow, mid, high] = colours
    setGrade({
      mapShadow: { source: 'manual', colour: shadow },
      mapMid: { source: 'manual', colour: mid },
      mapHigh: { source: 'manual', colour: high },
      mapHarmony,
      mapAmount,
    })
  }
  /** A colour as it shows: its own, or the one it reads from this photo. */
  const shownColour = (c: ColourChoice): Rgb => (c.source === 'manual' ? c.colour : palette[c.source])


  /**
   * Close the shape being drawn. A double-click lands two clicks on the same
   * spot before it, so near-duplicate points are dropped first.
   */
  // Lights drawn as masks (for a while, LeakSpot.mask) become ordinary drawn
  // shapes, keeping their key, falloff and look; their masks go from Masks
  // unless something else uses them.
  useEffect(() => {
    if (!image) return
    const leaks = blend.effects.leaks
    if (!leaks.spots.some((s) => s.mask)) return
    const frame = photoFrameOf(image.size, blend)
    const print = printSizeOf(image.size, blend)
    const masks = blend.effects.masks
    const usedElsewhere = (id: string) =>
      Object.values(blend.effects.maskUse).some((u) => u?.ids.includes(id)) ||
      blend.effects.streaks.shapes.some((sh) => sh.maskMode && sh.maskMode !== 'off' && (sh.maskIds ?? []).includes(id))
    const drop = new Set<string>()
    const next = leaks.spots.flatMap((s): LeakSpot[] => {
      if (!s.mask) return [s]
      const m = masks.find((mk) => mk.id === s.mask)
      if (!m) return []
      if (!usedElsewhere(m.id)) drop.add(m.id)
      const { mask: _gone, ...rest } = s
      return [
        {
          ...rest,
          outline: m.outline.map((p) => ({ x: (frame.x + p.x * frame.width) / print.width, y: (frame.y + p.y * frame.height) / print.height })),
          polygon: true,
          rounded: false,
          texture: 0,
          edge: Math.max(0.002, m.feather * 0.5),
          // (A light keyed on a colour can't be one: leak shapes key on brightness or blue only.)
          ...(m.key !== 'off' && m.keyOn !== 'colour' ? { key: m.key, keyOn: m.keyOn, keyLevel: m.keyLevel, keySoftness: m.keySoftness } : {}),
        },
      ]
    })
    setEffects({ leaks: { ...leaks, spots: next }, masks: masks.filter((m) => !drop.has(m.id)) })
    setSelectedMask(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, blend.effects.leaks.spots])

  // Leak shapes in the editor masks and streaks use: their indices among the spots.
  const leakShapeIdx = spots.flatMap((s, i) => (!s.mask && s.outline && s.outline.length >= MIN_OUTLINE_POINTS ? [i] : []))
  useEffect(() => {
    if (!editingLeaks) setDrawingLeakShape(false)
  }, [editingLeaks])
  const leakShapeEditor: StreakEditor | null =
    editingLeaks && image
      ? {
          shapes: leakShapeIdx.map((i) => ({ ...STREAK_DEFAULTS, outline: spots[i].outline!, mode: 'mask' as const, seed: 0 })),
          selected: selectedSpot !== null && leakShapeIdx.includes(selectedSpot) ? leakShapeIdx.indexOf(selectedSpot) : null,
          rounded: leakShapeIdx.map((i) => isRounded(spots[i])),
          drawing: drawingLeakShape,
          drawingPath: false,
          onChange: (shapes, step) => {
            remember(step ?? null)
            setLeaks({
              spots: spots.map((sp, i) => {
                const k = leakShapeIdx.indexOf(i)
                // Editing keeps how it is drawn: a shape from before stays rounded.
                return k >= 0 && shapes[k] ? { ...sp, outline: shapes[k].outline, polygon: true, rounded: isRounded(sp) } : sp
              }),
            })
          },
          onSelect: (k) => setSelectedSpot(k === null ? null : (leakShapeIdx[k] ?? null)),
          onFinishDraw: (outline) => {
            setDrawingLeakShape(false)
            if (spots.length >= MAX_LEAK_SPOTS) return
            const amount = blend.effects.leaks.amount > 0 ? blend.effects.leaks.amount : 0.5
            setLeaks({
              amount,
              spots: [
                ...spots,
                // An even glow in exactly the shape drawn (Texture 0); the Texture slider breaks it up.
                { x: 0, y: 0, size: 0.05, stretch: 1, angle: 0, strength: 1, kind: placeKind, outline, polygon: true, rounded: true, texture: 0, edge: 0.03 },
              ],
            })
            setSelectedSpot(spots.length)
          },
          onFinishPath: () => {},
        }
      : null

  const finishDraft = () => {
    if (!draft) return
    const points = draft.filter((p, i) => i === 0 || Math.hypot(p.x - draft[i - 1].x, p.y - draft[i - 1].y) > 0.008)
    if (points.length < MIN_OUTLINE_POINTS || spots.length >= MAX_LEAK_SPOTS) return
    const amount = blend.effects.leaks.amount > 0 ? blend.effects.leaks.amount : 0.5
    setLeaks({
      amount,
      spots: [
        ...spots,
        // Drawn by hand: an even glow in exactly the shape drawn (Texture 0),
        // which the Texture slider can break up.
        { x: 0, y: 0, size: 0.05, stretch: 1, angle: 0, strength: 1, kind: placeKind, outline: points, texture: 0, edge: 0.03 },
      ],
    })
    setSelectedSpot(spots.length)
    setDraft(null)
  }

  // Enter closes a shape being drawn, Esc drops it.
  useEffect(() => {
    if (!draft) return
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e.target)) return
      if (e.key === 'Enter') finishDraft()
      if (e.key === 'Escape') setDraft(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Enter finishes whatever is being edited on the photo — a streak, a mask,
  // a fix, leaks, guides, bands, the collage: what was being drawn is closed
  // (the overlays close it on the same key) and the editor put away.
  const editorOpen =
    editingStreaks ||
    drawingStreak ||
    drawingPath ||
    maskDrawing ||
    maskEditing ||
    fixEditing !== null ||
    editingLeaks ||
    editingGuides ||
    editingBands ||
    editingCollage
  useEffect(() => {
    if (!editorOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return
      // A streak's edit session has its own Enter and Esc (endStreakSession).
      if (streakSession) return
      if (inTextField(e.target) || document.querySelector('dialog[open], [role="dialog"]')) return
      // Esc leaves what is going on in Streaks, Leaks, Dither and Collage, as
      // it does for masks, lights and Repeat (their own handlers). Anything
      // half-drawn goes too.
      if (e.key === 'Escape') {
        if (!(editingStreaks || drawingStreak || drawingPath || fixEditing !== null || editingLeaks || editingGuides || editingBands || editingCollage)) return
        setTimeout(() => {
          for (const f of ['streaks', 'leaks', 'dither', 'collage'] as const) endFamily(f)
          setStatus(null)
        }, 0)
        return
      }
      if (e.key !== 'Enter') return
      // A focused button would otherwise press itself and open it again.
      e.preventDefault()
      ;(document.activeElement as HTMLElement | null)?.blur?.()
      // After the overlays have closed what was being drawn.
      setTimeout(() => {
        setEditingStreaks(false)
        setDrawingStreak(false)
        setDrawingPath(false)
        setMaskDrawing(false)
        setMaskEditing(false)
        setMaskPlacing(null)
        setMaskSolo(false)
        setNewTarget(null)
        setFixEditing(null)
        setEditingLeaks(false)
        setEditingGuides(false)
        setEditingBands(false)
        setEditingCollage(false)
      }, 0)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editorOpen, editingStreaks, drawingStreak, drawingPath, fixEditing, editingLeaks, editingGuides, editingBands, editingCollage, streakSession])

  // Starting any other editing on the photo puts the fixes away: their
  // overlay would hide it.
  const editorsBefore = useRef({ drawingStreak, drawingPath, maskDrawing, maskEditing, editingStreaks })
  useEffect(() => {
    const now = { drawingStreak, drawingPath, maskDrawing, maskEditing, editingStreaks }
    const before = editorsBefore.current
    editorsBefore.current = now
    if ((Object.keys(now) as (keyof typeof now)[]).some((k) => now[k] && !before[k])) setFixEditing(null)
  }, [drawingStreak, drawingPath, maskDrawing, maskEditing, editingStreaks])

  // Leaving placement drops an unfinished shape.
  useEffect(() => {
    if (!editingLeaks) setDraft(null)
  }, [editingLeaks])

  // Check in with the launcher while the page is open; it stops itself once no
  // window has checked in for a while. Without a launcher the route is absent.
  useEffect(() => {
    const beat = () =>
      fetch('/__grain_emulator_alive')
        .then((r) => r.headers.get('content-type')?.includes('json') && setLauncher(true))
        .catch(() => {})
    beat()
    const timer = setInterval(beat, 60_000)
    return () => clearInterval(timer)
  }, [])

  const quitApp = async () => {
    if (!(await confirmWith('Stop copyshop? Your work is saved; open the app again to carry on.'))) return
    await fetch('/__grain_emulator_quit', { method: 'POST' }).catch(() => {})
    setStopped(true)
  }

  // Esc puts the dropper down without taking a colour.
  useEffect(() => {
    if (!dropperTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (previewing.current) dropperTarget.apply(null)
      previewing.current = false
      setDropperTarget(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dropperTarget])

  // Render the edit for the dropper when it starts reading the edited picture.
  // Only the target and the source re-render it: a held preview changes the
  // edit, and must not change what is being sampled.
  useEffect(() => {
    dropFrame.current = null
    if (!dropperTarget || dropFrom !== 'edited' || !image || !grain) return
    try {
      dropEngine.current ??= new GrainEngine()
      const params = dropperTarget.without ? dropperTarget.without(blend) : blend
      const print = printSizeOf(image.size, params)
      const scale = Math.min(1, 1600 / Math.max(print.width, print.height))
      const out = dropEngine.current.render({
        base: image.bitmap,
        baseSize: image.size,
        grain: grain.source,
        grainSize: grain.size,
        grainMean: grain.mean,
        grainSd: grain.sd,
        params,
        imageSeed: blend.photoSeed ?? image.seed,
        outputSize: {
          width: Math.max(1, Math.round(print.width * scale)),
          height: Math.max(1, Math.round(print.height * scale)),
        },
      })
      const c = document.createElement('canvas')
      c.width = out.width
      c.height = out.height
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(out as CanvasImageSource, 0, 0)
      dropFrame.current = ctx.getImageData(0, 0, c.width, c.height)
    } catch {
      dropFrame.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dropperTarget, dropFrom, image, grain])

  /**
   * The dropper reads either the edit as you see it (frozen when sampling
   * began) or the original photo — the colour that is really there, before
   * the look. A 5×5 average, so a single noisy pixel does not decide it.
   */
  const sampleAt = (fx: number, fy: number, phase: 'preview' | 'commit' = 'commit') => {
    if (!image || !dropperTarget) return
    const frame = dropFrom === 'edited' ? dropFrame.current : null
    if (frame) {
      const x = Math.round(fx * frame.width)
      const y = Math.round(fy * frame.height)
      if (x < 2 || y < 2 || x >= frame.width - 2 || y >= frame.height - 2) {
        if (phase === 'commit') {
          if (previewing.current) dropperTarget.apply(null)
          previewing.current = false
          setDropperTarget(null)
        }
        return
      }
      const sum = [0, 0, 0]
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const i = ((y + dy) * frame.width + x + dx) * 4
          for (let k = 0; k < 3; k++) sum[k] += frame.data[i + k]
        }
      dropperTarget.apply(sum.map((v) => v / 25 / 255) as Rgb)
      if (phase === 'preview') previewing.current = true
      else {
        previewing.current = false
        setDropperTarget(null)
      }
      return
    }
    const print = printSizeOf(image.size, blend)
    const edge = Math.round(activeBorder(blend).width * Math.min(image.size.width, image.size.height))
    const x = Math.round(fx * print.width - edge)
    const y = Math.round(fy * print.height - edge)
    if (x < 2 || y < 2 || x >= image.size.width - 2 || y >= image.size.height - 2) {
      // Released off the photo: put back what was there.
      if (phase === 'commit') {
        if (previewing.current) dropperTarget.apply(null)
        previewing.current = false
        setDropperTarget(null)
      }
      return
    }
    const c = document.createElement('canvas')
    c.width = 5
    c.height = 5
    const ctx = c.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(image.bitmap, x - 2, y - 2, 5, 5, 0, 0, 5, 5)
    const d = ctx.getImageData(0, 0, 5, 5).data
    const sum = [0, 0, 0]
    for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) sum[k] += d[i + k]
    dropperTarget.apply(sum.map((v) => v / 25 / 255) as Rgb)
    if (phase === 'preview') previewing.current = true
    else {
      previewing.current = false
      setDropperTarget(null)
    }
  }

  // Masks on the photo. Esc puts down one being placed or drawn without
  // making it, and finishes editing one (as Enter does). Delete takes away
  // the one being placed or drawn, or the mask being edited (Cmd+Z brings it
  // back). The outline editor sees its keys first: Delete takes back the
  // last point drawn, or the points picked, before it reaches here.
  useEffect(() => {
    if (!maskEditing && !maskDrawing && !maskPlacing) return
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inTextField(e.target) || document.querySelector('dialog[open], [role="dialog"]')) return
      const del = e.key === 'Delete' || e.key === 'Backspace'
      if (e.key !== 'Escape' && !del) return
      e.preventDefault()
      // Handled here: no list underneath (a collage piece, a light) acts on the same key.
      e.stopImmediatePropagation()
      if (maskPlacing) {
        setMaskPlacing(null)
        if (selectedMask === null) setMaskEditing(false)
        setStatus(null)
      } else if (maskDrawing) {
        setMaskDrawing(false)
        setNewTarget(null)
        // A module's piece being drawn (Repeat, the Kaleidoscope): stopped altogether, nothing left on the photo.
        if (drawingPiece || drawingKaleido || drawingRecolour) {
          setDrawingPiece(false)
          setDrawingKaleido(false)
          setDrawingRecolour(null)
          if (selectedMask === null) setMaskEditing(false)
        }
        setStatus(null)
      } else if (del && selectedMask !== null) removeMask(selectedMask)
      else if (!del) {
        setMaskEditing(false)
        setMaskSolo(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  // Delete removes the selected spot while placing; typing in a field must not.
  useEffect(() => {
    if (!editingLeaks || selectedSpot === null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return
      e.preventDefault()
      setLeaks({ spots: spots.filter((_, i) => i !== selectedSpot) })
      setSelectedSpot(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  /*
   * The crop (engine/crop.ts). The preview renders the cropped picture, as
   * the export does, except while anything is being placed or set on the
   * photo: those tools work on the whole photo, so the preview shows it whole
   * and they keep measuring on it.
   */
  const onPhoto =
    !!brushing ||
    editingCrop || editingRepeat || guidingStreak || lightDrawing || lightEditing || editingLeaks || editingBands || editingCollage || arranging || editingGuides || editingStreaks || drawingStreak ||
    maskDrawing || maskEditing || !!maskPlacing || drawingPath || !!fixEditing || drawingLeakShape || !!dropperTarget || !!picking
  // A turned crop (cropAngle): set on the photo, the whole photo is shown
  // as it is and turned on screen (turnBy), the crop upright over it;
  // otherwise the picture cut from it, turned.
  const turnNow = cropAngle(blend.effects.crop)
  const turnDeg = turnNow
  const cropWanted = image && cropActive(blend.effects.crop) && !onPhoto ? cropRect(image.size, blend.effects.crop) : null
  const cropKey = cropWanted ? `${cropWanted.x},${cropWanted.y},${cropWanted.width},${cropWanted.height},${turnDeg}` : ''
  const [cropped, setCropped] = useState<{ key: string; rect: Rect; deg: number; of: ImageBitmap; bitmap: ImageBitmap } | null>(null)
  useEffect(() => {
    if (!image || !cropWanted) return
    if (cropped && cropped.key === cropKey && cropped.of === image.bitmap) return
    let cancelled = false
    const rect = cropWanted
    const deg = turnDeg
    const c = blend.effects.crop
    void cropBitmap(image.bitmap, image.size, c).then((bitmap) => {
      if (!cancelled) setCropped({ key: cropKey, rect, deg, of: image.bitmap, bitmap })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, cropKey])
  // The last crop made stays up until the next is ready, so dragging never flashes the whole photo.
  const viewCrop = cropWanted && cropped && cropped.of === image?.bitmap ? cropped : null
  // Set on the photo, the whole photo on screen turned as the crop turns it: no render as it turns.
  const turnBy = editingCrop ? turnNow : 0
  // And the crop moved or sized on it renders nothing again: the picture
  // shown is the whole photo, which the crop does not change.
  const cropFrozen = useRef<BlendParams | null>(null)
  const viewBlend = (() => {
    const was = cropFrozen.current
    if (editingCrop && was && was !== blend && onlyCropDiffers(was, blend)) return was
    cropFrozen.current = blend
    return blend
  })()
  // The lens bends what is on the photo, so the editors on it draw through it too (lensView.ts).
  {
    const shown = viewCrop ? { width: viewCrop.rect.width, height: viewCrop.rect.height } : image?.size
    const lens = blend.effects.lens
    setLensView(shown && lens && lensOn(lens) ? lens.distortion * LENS_K : 0, shown ? photoFrameOf(shown, blend) : null)
  }
  const viewLayerOf = useCallback(
    (l: PreviewLayer | null): PreviewLayer | null => (l && viewCrop && image ? { ...l, params: shapesOnCrop(l.params, image.size, viewCrop.rect, viewCrop.deg) } : l),
    [viewCrop, image],
  )
  // Kept as the same object until what it shows changes, so the preview does
  // not render the photo again for every unrelated change in the app (a
  // status line, a selection, a hover).
  /** The module whose own part is being selected, drawn or painted (MaskOwner), or null. */
  const selectingFor: MaskOwner | null = picking?.owner
    ? picking.owner
    : drawingKaleido
      ? 'kaleido'
      : drawingRecolour
        ? 'recolour'
        : drawingPiece
        ? 'repeat'
        : brushing
          ? (blend.effects.masks[brushing.index]?.owner ?? null)
          : null
  const layer = useMemo(() => {
    const from = previewBlend ?? viewBlend
    const graded = previewGrade
      ? { ...from, effects: { ...from.effects, grade: mergeGrade(from.effects.grade, previewGrade) } }
      : from
    // Selecting, drawing or painting a module's own part: that module's own
    // output is left out, so the photo shows as it is under it (the copies,
    // the streaks, the kaleidoscope); everything else stays as it is.
    const shownBlend = hideOwnOutput(graded, selectingFor)
    // The open selected or painted mask, shown on the photo by the render
    // itself: exactly what the modules get, and no work here as a brush paints.
    // Repeat's own piece, while its row is open in Repeat.
    const pieceIndex = repeatPieceShown ? viewBlend.effects.masks.findIndex((m) => m.id === repeat.source) : -1
    // A module's own mask (a streak's subject, Repeat's piece) shows only while it is brushed or edited:
    // it is not in the Masks list, so nothing there would put it away again.
    const openOwned = selectedMask !== null && !!viewBlend.effects.masks[selectedMask]?.owner && !maskEditing
    const shownIndex = brushing ? brushing.index : selectedMask !== null && !openOwned ? selectedMask : pieceIndex >= 0 ? pieceIndex : null
    const shown = shownIndex !== null && !picking ? viewBlend.effects.masks[shownIndex] : undefined
    // While brushing, the mask always shows: it is what is being painted.
    const listed = shown?.raster && (maskOverlay || brushing) ? shown.id : null
    // A module's mask menu open: the mask it points at, any kind.
    const peeked =
      !listed && !brushing && !picking && maskOverlay && peekMask && viewBlend.effects.masks.some((m) => m.id === peekMask) ? peekMask : null
    const showId = listed ?? peeked
    const showMask = showId ? { id: showId, view: maskView } : undefined
    return grain ? { grain, params: shownBlend, ...(showMask ? { showMask } : {}) } : null
    // collageTick: a collage image or the photo's analysis became ready.
  }, [grain, viewBlend, previewBlend, previewGrade, collageTick, brushing, selectedMask, maskEditing, picking, maskView, repeatPieceShown, repeat.source, maskOverlay, peekMask, selectingFor])
  // Pointing at a recipe shows the whole picture in it, in place of the edit.
  const viewLayer = useMemo(
    () => viewLayerOf(recipeHover && recipeHoverLayer ? recipeHoverLayer.layer : layer),
    [layer, viewLayerOf, recipeHover, recipeHoverLayer],
  )
  const viewLayerRef = useRef(viewLayer)
  viewLayerRef.current = viewLayer
  const viewCompare = useMemo(() => (recipeHover && recipeHoverLayer ? null : viewLayerOf(compareLayer)), [compareLayer, viewLayerOf, recipeHover, recipeHoverLayer])
  // The small view shows what the file will lose: JPEG and WebP compress, PNG and TIFF don't.
  const exportFormat = image ? exportFormatOf(output, image.name) : null
  const exportCodec = useMemo(
    () =>
      exportFormat === 'JPEG' ? { format: 'jpeg' as const, quality: output.jpegQuality } : exportFormat === 'WebP' ? { format: 'webp' as const, quality: output.jpegQuality } : null,
    [exportFormat, output.jpegQuality],
  )
  const viewPrefetch = useMemo(() => prefetchLayers.map((l) => viewLayerOf(l)!), [prefetchLayers, viewLayerOf])

  return (
    <EditViewContext.Provider value={editView}>
    <MaskOverlayContext.Provider value={maskOverlayApi}>
    <ToneHighlightContext.Provider value={setToneHighlight}>
    <HistogramContext.Provider value={histogram}>
    <BaselineContext.Provider value={baseline}>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={[
          ...LOOKS.map((look) => ({ id: `look:${look.id}`, label: look.label, group: 'Recipe', run: () => void applyLook(look) })),
          ...presets.map((p) => ({ id: `preset:${p.id}`, label: p.data.name, group: 'Your recipe', run: () => void applyPreset(p) })),
          ...MODULES.map((m) => ({
            id: `add:${m.id}`,
            label: shownInStack(m.id) ? m.title : `Add ${m.title.toLowerCase()}`,
            group: shownInStack(m.id) ? 'In use' : 'Add an effect',
            run: () => addModule(m.id),
          })),
          { id: 'open', label: 'Open a photo', group: 'File', run: actions.open },
          ...(libraryAvailable() ? [{ id: 'open-folder', label: 'Add folder to library', group: 'File', run: actions['open-folder'] }] : []),
          { id: 'export', label: exportPreset ? `Export · ${exportPreset.name}` : 'Export', group: 'File', run: actions.export },
          { id: 'export-as', label: 'Export as… (choose where)', group: 'File', run: actions['export-as'] },
          { id: 'submit-gallery', label: 'Submit to Gallery…', group: 'File', run: actions['submit-gallery'] },
          ...(timelapseOn ? [{ id: 'export-timelapse', label: 'Export the timelapse video', group: 'File', run: actions['export-timelapse'] }] : []),
          { id: 'settings', label: 'Settings', group: 'File', run: actions.settings },
          { id: 'fresh', label: 'Start over', group: 'Edit', run: actions['reset-all'] },
          { id: 'snapshot', label: 'Take a snapshot', group: 'Edit', run: actions.snapshot },
          { id: 'small', label: small ? 'Leave the phone preview' : 'Phone preview', group: 'View', run: actions['phone-preview'] },
          { id: 'fit', label: 'Fit', group: 'View', run: actions['zoom-fit'] },
          { id: 'zoom1', label: '100%', group: 'View', run: actions['zoom-100'] },
          { id: 'help', label: 'Keyboard shortcuts', group: 'Help', run: actions.shortcuts },
          { id: 'feedback', label: 'Report a problem or send feedback', group: 'Help', run: actions.feedback },
          { id: 'tour', label: 'Show me around copyshop', group: 'Help', run: startTour },
          ...(image ? [{ id: 'copy-edit', label: 'Copy this photo’s edit', group: 'Edit', run: copyEditHere }] : []),
          ...(image && clip ? [{ id: 'paste-edit', label: `Paste the edit of ${clip.from}`, group: 'Edit', run: pasteEditHere }] : []),
          { id: 'guide', label: 'Open the guide', group: 'Help', run: () => setGuidePage('topic:photos') },
        ]}
      />
      <DropperContext.Provider value={dropper}>
        <div
          className="app"
          style={{
            gridTemplateColumns: `${leftPanel.shown ? leftWidth : 0}px 1fr ${rightPanel.shown ? rightWidth : 0}px`,
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={async (e) => {
            e.preventDefault()
            const files = [...e.dataTransfer.files]
            const file = files[0]
            if (!file) return
            openVia.current = 'drop'
            await openImage(file, file.name)
            // One photo opens at a time; say so rather than leave the rest unexplained.
            if (files.length > 1)
              setStatus(`Opened ${file.name}. Drop one photo at a time${hasLibrary ? ', or add their folder to the library' : ''}.`)
          }}
        >
          <TopBar
            image={image}
            fromExport={openedExport && image?.sha === openedExport.sha ? openedExport.name : null}
            hasLibrary={hasLibrary}
            onAddFolder={() => void addFolder()}
            onOpenPhotos={act('open')}
            launcher={launcher}
            onQuit={quitApp}
            onSettings={() => setSettingsOpen(true)}
            onHelp={() => setShowHelp(true)}
            imageInput={imageInput}
            onOpen={(f) => void openImage(f, f.name)}
            onWhatsNew={() => setWhatsNewOpen('since')}
          />

          {leftPanel.shown && <LeftPanel
            closing={leftPanel.closing}
            hasImage={!!image}
            blend={blend}
            onPinShapes={() => {
              history.hint(`${WHOLE_STEP}pinning the shapes to the photo`)
              setEffects({ shapeSpace: 'photo', shapeUnits: 'photo' })
            }}
            masks={{
              brushing,
              brushSize,
              onBrushSize: setBrushSize,
              onBrush: (index, mode) => {
                setBrushing(index === null || (brushing?.index === index && brushing.mode === mode) ? null : { index, mode })
                if (index !== null) {
                  setSelectedMask(index)
                  setMaskEditing(false)
                  setMaskDrawing(false)
                  setMaskPlacing(null)
                }
              },
              onNewPainted: () => newPainted(),
              onUse: setMaskUses,
              onMatch: matchMask,
              sectionInUse: (sec) => inUse(sec as StackModuleId, blend),
              masks: blend.effects.masks,
              maskUse: blend.effects.maskUse,
              hasImage: !!image,
              drawing: maskDrawing && !drawingPiece,
              selected: selectedMask,
              onDraw: () => drawMask(maskDrawing ? newTarget : null),
              onAddShape: (kind) => addShapeMask(kind, null),
              placing: maskPlacing,
              onToggle: (i) => {
                const m = blend.effects.masks[i]
                setMasks(blend.effects.masks.map((x, j) => (j === i ? { ...x, enabled: x.enabled === false } : x)), `${WHOLE_STEP}${m.enabled === false ? 'switching on' : 'switching off'} ${m.name}`)
              },
              onSelect: (i) => {
                // Opening a mask shows its settings; the pencil reshapes it on the photo.
                setSelectedMask(i)
                setMaskEditing(false)
                setMaskSolo(false)
              },
              editingIndex: maskEditing && maskSolo && !maskDrawing ? selectedMask : null,
              onEditShape: editMaskShape,
              maskView,
              onMaskView: setMaskView,
              brushByColour,
              onBrushByColour: setBrushByColour,
              trace: traceOutline,
              picking: pickingView,
              onPick: startPicking,
              onPickReading: choosePickReading,
              onPickDone: finishPicking,
              onGoToModule: goToModuleMask,
              streakUsers: (id) =>
                blend.effects.streaks.shapes.flatMap((sh, k) =>
                  sh.maskMode !== 'off' && (sh.maskIds ?? []).includes(id) ? [`Streak ${k + 1}`] : [],
                ),
              onChange: (i, patch, step) =>
                setMasks(blend.effects.masks.map((m, j) => (j === i ? { ...m, ...patch } : m)), step),
              onRemove: removeMask,
              onDuplicate: duplicateMask,
              onToPoints: maskToPoints,
              masksFull: blend.effects.masks.length >= MAX_MASKS,
            }}
            snapshots={{
              snapshots: photoSnapshots,
              photo: image?.sha,
              compareId,
              canTake: !!image && !!grain,
              onTake: takeSnapshot,
              includePlaced: snapshotPlaced,
              onIncludePlaced: setSnapshotPlaced,
              onHover: setHoverCompareId,
              onCompare: setCompareId,
              onRestore: restoreSnapshot,
              onDelete: (id) => {
                setSnapshots((list) => list.filter((s) => s.id !== id))
                setCompareId((current) => (current === id ? null : current))
                setHoverCompareId(null)
              },
            }}
            history={history}
          />}

          <main className="stage">
            {arranging && image && collageHere !== undefined && (
              <div className="fill-anchor">
                <CollageFillWindow
                  arrange={arrangeNow}
                  photo={image.seed}
                  region={fillRegion}
                  onArrange={setArrange}
                  onStatus={setStatus}
                  onClose={() => {
                    startArranging(false)
                    setFillRegion(null)
                  }}
                  onCancel={() => {
                    // What it filled goes: back to before Fill gaps opened.
                    const row = fillStartRow.current
                    if (row !== null && history.view().current > row) {
                      history.jumpTo(row)
                      history.dropRedo()
                    }
                    startArranging(false)
                    setFillRegion(null)
                    setStatus('Fill cancelled')
                  }}
                />
              </div>
            )}
            {image && graphicsNote && (
              <div className="graphics-note-row">
              <div className={`graphics-note${graphicsNote === 'failed' ? ' failed' : ''}`} role="status">
                {graphicsNote === 'look' ? (
                  <>
                    <span className="graphics-spinner" aria-hidden />
                    Your graphics card is preparing the editor. The photo is shown without its edit until it's done, which can take several seconds the first time on Windows.
                  </>
                ) : graphicsNote === 'streaks' ? (
                  <>
                    <span className="graphics-spinner" aria-hidden />
                    Your graphics card is still preparing streaks. Everything else is shown; the streaks appear when it's done.
                  </>
                ) : (
                  <>
                    Your graphics card couldn't prepare streaks, so they can't be shown on this computer yet. Everything else works.
                    <button className="link" onClick={() => setFeedbackOpen(true)}>
                      Report it
                    </button>
                  </>
                )}
              </div>
              </div>
            )}
            <PreviewCanvas
              cover={cover}
              onFresh={() => setCover(null)}
              onWhole={(picture, forLayer) => {
                const path = image?.from?.path
                if (path) lastWhole.current = { path, layer: forLayer, picture }
                // Paper colours from the picture as it is now, for Border.
                if (image) {
                  const size = viewCrop ? { width: viewCrop.rect.width, height: viewCrop.rect.height } : image.size
                  const print = printSizeOf(size, forLayer.params)
                  const f = photoFrameOf(size, forLayer.params)
                  const value = picturePapers(picture, { x: f.x / print.width, y: f.y / print.height, width: f.width / print.width, height: f.height / print.height })
                  setSeenPapers({ image, value })
                }
              }}
              hold={openingPhoto || (!!source && grainFrom !== source)}
              busy={lookPending}
              onOpen={act('open')}
              onTrySample={() => void openSample()}
              base={viewCrop ? viewCrop.bitmap : (image?.bitmap ?? null)}
              baseSize={viewCrop ? { width: viewCrop.rect.width, height: viewCrop.rect.height } : (image?.size ?? null)}
              photoCrop={viewCrop && image ? { ...cropFraction(image.size, viewCrop.rect), ...(viewCrop.deg ? { angle: viewCrop.deg } : {}) } : null}
              turnBy={turnBy}
              maskBrush={
                brushing && image && blend.effects.masks[brushing.index]?.raster
                  ? {
                      mode: brushing.mode,
                      size: brushSize,
                      // Each paint is the whole stroke so far on the mask as it was
                      // before the stroke, so the mask follows the brush and the
                      // stroke stays one step to undo.
                      onPaint: (points) => paintStroke(points, false),
                      onStroke: (points) => paintStroke(points, true),
                    }
                  : null
              }
              streakGuideEditor={
                guidingStreak && image && selectedStreak !== null && streakSel
                  ? ({
                      guides: streakSel.guides ?? [],
                      onChange: (guides, step) => setStreakGuides(selectedStreak, guides, step),
                      onDone: (keep) => (streakSession ? endStreakSession(keep) : setGuidingStreak(false)),
                      snap: (p) => (guideSnap && streakSpace ? snapToEdge(image.bitmap, p, streakSpace, photoFrameOf(image.size, blend)) : p),
                      onState: setGuideState,
                    } satisfies StreakGuideEditor)
                  : null
              }
              lightEditor={
                (lightDrawing || lightEditing) && image
                  ? ({
                      lights: lighting.lights,
                      selected: selectedLight,
                      drawing: lightDrawing,
                      onSelect: setSelectedLight,
                      onAdd: (outline) => {
                        let n = 1
                        while (lighting.lights.some((l) => l.name === `Light ${n}`)) n++
                        history.hint(`${WHOLE_STEP}a light`)
                        setLighting({ enabled: true, lights: [...lighting.lights, { ...DEFAULT_LIGHT, id: newId('light'), name: `Light ${n}`, outline }] })
                        // Drawn: open, its settings showing; the pencil edits it.
                        setSelectedLight(lighting.lights.length)
                        setLightDrawing(false)
                        setLightEditing(false)
                      },
                      onCancel: () => setLightDrawing(false),
                      onChange: (i, patch, step) => setLight(i, patch, step),
                    } satisfies LightEditor)
                  : null
              }
              repeatEditor={
                editingRepeat && image && (repeat.layout !== 'grid' || !!repeat.vanish)
                  ? ({
                      repeat,
                      start: repeatStart,
                      box: repeatSourceMask ? pieceBoxOf(repeatSourceMask) : null,
                      onChange: (patch, step) => setRepeat(patch, step),
                      onDone: () => setEditingRepeat(false),
                    } satisfies RepeatEditor)
                  : null
              }
              colourLineEditor={
                editingColourLine !== null && hasColourLine(blend.effects.streaks.shapes[editingColourLine]?.colourLine)
                  ? ({
                      points: blend.effects.streaks.shapes[editingColourLine].colourLine!,
                      onChange: (points, step) =>
                        setStreaks({ shapes: blend.effects.streaks.shapes.map((x, j) => (j === editingColourLine ? { ...x, colourLine: points } : x)) }, `shape${editingColourLine}:${step}`),
                      onDone: () => setEditingColourLine(null),
                    } satisfies ColourLineEditor)
                  : null
              }
              kaleidoEditor={
                editingKaleido && image && kaleido.enabled
                  ? ({
                      kaleido,
                      slice: kaleidoPieceAt < 0,
                      onChange: (patch, step) => setKaleido(patch, step),
                      onDone: () => setEditingKaleido(false),
                    } satisfies KaleidoEditor)
                  : null
              }
              cropEditor={
                editingCrop && image
                  ? ({
                      crop: blend.effects.crop,
                      ratio: cropRatio(blend.effects.crop, image.size),
                      photo: image.size,
                      onChange: (patch) => setCrop({ ...patch, enabled: true }),
                      onDone: () => setEditingCrop(false),
                    } satisfies CropEditor)
                  : null
              }
              imageSeed={blend.photoSeed ?? image?.seed}
              layer={viewLayer}
              compare={viewCompare}
              prefetch={viewPrefetch}
              loupe={loupe}
              compareLabel={compare?.name}
              wipe={wipe}
              onWipeChange={setWipe}
              zoom={zoom}
              fitAsked={fitAsked}
              // The view's own zooms (wheel, pinch, middle click) keep the point
              // they zoomed at: resting at Fit is not asking for Fit, which centres.
              onZoomChange={setZoomState}
              small={small}
              igSim={igSim}
              exportQuality={exportCodec}
              exportSizing={isFullSize(output) ? null : output}
              sampling={!!dropperTarget}
              onSample={sampleAt}
              // Picking from the original shows it.
              bypass={bypass || (!!dropperTarget && dropFrom === 'original')}
              layoutVersion={layoutVersion}
              onError={setError}
              leakEditor={
                editingLeaks
                  ? {
                      spots,
                      selected: selectedSpot,
                      onChange: (next) => setLeaks({ spots: next }),
                      onSelect: setSelectedSpot,
                      draft,
                    }
                  : null
              }
              onFinishDraft={finishDraft}
              leakShapeEditor={leakShapeEditor}
              picker={
                picking && image
                  ? {
                      picks: picking.picks,
                      outline: picking.index !== null && pickSelection.current ? blend.effects.masks[picking.index]?.outline ?? null : null,
                      raster: picking.index !== null && pickSelection.current ? blend.effects.masks[picking.index]?.raster ?? null : null,
                      busy: picking.busy,
                      leaveOut: picking.leaveOut,
                      onPick: (x, y, on) => editPicks(picking, { picks: [...picking.picks, { x, y, on }], box: picking.box }),
                      onUnpick: (k) => editPicks(picking, { picks: picking.picks.filter((_, j) => j !== k), box: picking.box }),
                      box: picking.box,
                      onBox: (box) => editPicks(picking, { picks: picking.picks, box }, null),
                    }
                  : null
              }
              collageEditor={collageEditor}
              toneHighlight={toneHighlight}
              streakEditor={
                fixEditing ||
                editingStreaks ||
                drawingStreak ||
                drawingPath
                  ? {
                      // Placing or adjusting fixes shows only the selected
                      // streak's fixes, none of its own handles. In an edit
                      // session, only its tool's handles (streakSession).
                      fixesOnly: !!fixEditing && !editingStreaks && !drawingStreak && !drawingPath,
                      // The pencil ('all'): every handle, as with no tool.
                      ...(streakSession && streakSession.tool !== 'all' ? { tool: streakSession.tool } : {}),
                      shapes: blend.effects.streaks.shapes,
                      selected: selectedStreak,
                      drawing: drawingStreak,
                      drawingPath: drawingPath && selectedStreak !== null && pathKind === 'path',
                      drawingEnds: drawingPath && selectedStreak !== null && pathKind === 'ends',
                      onFinishEnds: (ends) => {
                        if (selectedStreak !== null) setStreakShape(selectedStreak, { ends })
                        setDrawingPath(false)
                      },
                      onChange: (shapes, step) => setStreaks({ shapes }, step ?? null),
                      onSelect: setSelectedStreak,
                      onFinishDraw: (outline) => {
                        const shapes = blend.effects.streaks.shapes
                        if (shapes.length >= MAX_STREAKS) return
                        const seed = Math.floor(Math.random() * 99991)
                        setStreaks({
                          enabled: true,
                          shapes: [
                            ...shapes,
                            {
                              ...STREAK_DEFAULTS,
                              // Bars cut and softened as a streaked subject's are: the
                              // style picked for the first streak, or the plain one,
                              // a little the streak's own (variedBars).
                              ...variedBars(firstStreakPatch(shapes.length) ?? STREAK_STYLES[0].patch, seed),
                              angle: NEW_STREAK_ANGLE,
                              outline,
                              seed,
                              mode: 'fill',
                            },
                          ],
                        })
                        // Drawn: open, its settings showing; the pencil edits it. The drawing instructions go.
                        setStatus(null)
                        setSelectedStreak(shapes.length)
                        setStreakTab('way')
                        setDrawingStreak(false)
                        setEditingStreaks(false)
                      },
                      onFinishPath: (path) => {
                        if (selectedStreak !== null) setStreakShape(selectedStreak, { path })
                        setDrawingPath(false)
                      },
                      fixes: {
                        selected: selectedFix,
                        placing: selectedStreak === null ? null : fixEditing === 'add' ? 'span' : fixEditing === 'source' ? 'source' : null,
                        onSelect: setSelectedFix,
                        onPlace: (a, b) => {
                          if (selectedStreak === null) return
                          const shape = blend.effects.streaks.shapes[selectedStreak]
                          if (fixEditing === 'source' && selectedFix !== null && selectedFix < shape.fixes.length) {
                            setStreakShape(selectedStreak, {
                              fixes: shape.fixes.map((f, k) => (k === selectedFix ? { ...f, source: { a, b } } : f)),
                            })
                          } else {
                            if (shape.fixes.length >= MAX_STREAK_FIXES) return
                            setStreakShape(selectedStreak, { fixes: [...shape.fixes, newFix(a, b, shape)] })
                            setSelectedFix(shape.fixes.length)
                          }
                          // The fixes stay on the photo, their ends to drag, until Enter.
                          setFixEditing('edit')
                        },
                      },
                    }
                  : null
              }
              maskEditor={
                (maskEditing || maskDrawing) && !maskPlacing
                  ? {
                      // Drawn masks are shown and edited with the streak overlay,
                      // as outlines with no direction of their own; reshaping one
                      // on its own leaves the others' outlines out.
                      shapes: drawnShown.map((i) => ({
                        ...STREAK_DEFAULTS,
                        outline: blend.effects.masks[i].outline,
                        mode: 'mask' as const,
                        seed: 0,
                      })),
                      selected: selectedMask !== null && drawnShown.includes(selectedMask) ? drawnShown.indexOf(selectedMask) : null,
                      drawing: maskDrawing,
                      drawingPath: false,
                      onChange: (shapes, step) =>
                        setMasks(
                          blend.effects.masks.map((m, i) => {
                            const k = drawnShown.indexOf(i)
                            return k >= 0 ? { ...m, outline: shapes[k]?.outline ?? m.outline } : m
                          }),
                          step ?? null,
                        ),
                      onSelect: (k) => setSelectedMask(k === null ? null : (drawnShown[k] ?? null)),
                      onFinishDraw: (outline) => {
                        const masks = blend.effects.masks
                        if (masks.length >= MAX_MASKS) return
                        let n = 1
                        while (masks.some((m) => m.name === `Mask ${n}`)) n++
                        const id = newId('mask')
                        if (drawingRecolour) {
                          // A part to recolour: a new one in the next colour, or the open one's outline replaced.
                          const open = drawingRecolour.again && recolourOpen !== null ? recolourItems[recolourOpen] : undefined
                          const at = open ? masks.findIndex((m) => m.id === open.source) : -1
                          if (at < 0 && recolourItems.length >= MAX_RECOLOURS) return
                          history.hint(`${WHOLE_STEP}drawing a part to recolour`)
                          if (at >= 0) {
                            setMasks(
                              masks.map((m, j) => {
                                if (j !== at) return m
                                const { raster: _drop, ...rest } = m
                                return { ...rest, kind: undefined, outline, key: 'off' as const }
                              }),
                              null,
                            )
                          } else {
                            let n = 1
                            while (masks.some((m) => m.owner === 'recolour' && m.name === `Part ${n}`)) n++
                            setEffects({
                              masks: [...masks, { ...DEFAULT_MASK, id, name: `Part ${n}`, outline, owner: 'recolour' as const }],
                              recolour: { enabled: true, items: [...recolourItems, newRecolourItem(newId('recolour'), id, recolourItems.length)] },
                            })
                            setRecolourOpen(recolourItems.length)
                          }
                          setMaskDrawing(false)
                          setDrawingRecolour(null)
                          setMaskEditing(false)
                          setStatus(null)
                          return
                        }
                        if (drawingKaleido) {
                          // The Kaleidoscope's own part: copied round at once. Drawn again, the same part takes the new outline.
                          history.hint(`${WHOLE_STEP}drawing the Kaleidoscope's part`)
                          const at = kaleidoPieceAt
                          const made =
                            at >= 0
                              ? masks.map((m, j) => {
                                  if (j !== at) return m
                                  const { raster: _drop, ...rest } = m
                                  return { ...rest, kind: undefined, outline, key: 'off' as const }
                                })
                              : [...masks, { ...DEFAULT_MASK, id, name: 'Kaleidoscope part', outline, owner: 'kaleido' as const }]
                          setEffects({ masks: made, kaleido: { ...kaleido, source: at >= 0 ? masks[at].id : id, enabled: true } })
                          setMaskDrawing(false)
                          setDrawingKaleido(false)
                          setMaskEditing(false)
                          setStatus(null)
                          return
                        }
                        if (drawingPiece) {
                          // Repeat's own piece: copied from at once, its outline left to reshape.
                          history.hint(`${WHOLE_STEP}drawing Repeat's original`)
                          setEffects({ masks: [...masks, { ...DEFAULT_MASK, id, name: 'Original', outline, owner: 'repeat' }], repeat: { ...repeatWith({ source: id, enabled: true }), enabled: true } })
                          setSelectedMask(masks.length)
                          setMaskDrawing(false)
                          setDrawingPiece(false)
                          setMaskEditing(true)
                          setMaskSolo(true)
                          setStatus(null)
                          return
                        }
                        // Drawn from a module's Mask menu (or Draw glass area): that module uses it, and is on, at once.
                        setMasks([...masks, { ...DEFAULT_MASK, id, name: `Mask ${n}`, outline, ...ownedFor(newTarget) }], maskStepFor(newTarget), usedBy(newTarget, id, `Mask ${n}`))
                        switchOnFor(newTarget)
                        setSelectedMask(masks.length)
                        setMaskDrawing(false)
                        setNewTarget(null)
                        setMaskEditing(true)
                        setMaskSolo(true)
                      },
                      onFinishPath: () => {},
                    }
                  : null
              }
              shapeMaskEditor={
                (maskEditing && !maskDrawing) || maskPlacing
                  ? {
                      masks: blend.effects.masks,
                      shown: madeShown,
                      selected: selectedMask,
                      onSelect: setSelectedMask,
                      onChange: (i, patch, step) =>
                        setMasks(
                          blend.effects.masks.map((m, j) => (j === i && image ? withOutline({ ...m, ...patch }, shapeFrame(image.size, blend)) : m)),
                          step,
                        ),
                      placing: maskPlacing,
                      onPlace: (kind, shape) => {
                        const masks = blend.effects.masks
                        if (!image || masks.length >= MAX_MASKS) return
                        const word = kind === 'gradient' ? 'Gradient' : 'Radial'
                        let n = 1
                        while (masks.some((m) => m.name === `${word} ${n}`)) n++
                        const made = withOutline(
                          { ...DEFAULT_MASK, id: newId('mask'), name: `${word} ${n}`, kind, ...shape, outline: [], featherAt: 'centre', ...ownedFor(newTarget) },
                          shapeFrame(image.size, blend),
                        )
                        setMasks([...masks, made], maskStepFor(newTarget) ?? `${WHOLE_STEP}a ${word.toLowerCase()} mask`, usedBy(newTarget, made.id, made.name))
                        switchOnFor(newTarget)
                        setNewTarget(null)
                        setSelectedMask(masks.length)
                        setMaskPlacing(null)
                        setMaskSolo(true)
                        setMaskEditing(true)
                        setStatus(
                          newTarget?.streak !== undefined
                            ? `${word} mask placed, used by streak ${newTarget.streak + 1}. Drag to adjust it, then Done. Delete removes it.`
                            : newTarget?.section && MODULE_BY_ID[newTarget.section as StackModuleId]
                              ? `${word} mask placed, used by ${MODULE_BY_ID[newTarget.section as StackModuleId].title}. Drag to adjust it, then Done. Delete removes it.`
                              : `${word} mask placed. Use it from the Mask row at the foot of any module. Drag to adjust it, then Done. Delete removes it.`,
                        )
                      },
                    }
                  : null
              }
              guideEditor={
                editingGuides
                  ? {
                      guides: blend.effects.dither.guides,
                      selected: selectedGuide,
                      onChange: (guides) => setEffects({ dither: { ...blend.effects.dither, guides } }),
                      onSelect: setSelectedGuide,
                    }
                  : null
              }
              onPlaceGuide={(x, y) => {
                const d = blend.effects.dither
                if (d.guides.length >= MAX_BAND_GUIDES) return
                setEffects({
                  dither: {
                    ...d,
                    // A guide only steers bands that exist.
                    amount: d.amount || 0.5,
                    // Adding a guide switches guides (and the dither) back on.
                    enabled: true,
                    guidesOn: true,
                    guides: [...d.guides, { x, y, radius: 0.35, strength: 0.6 * guideSign }],
                  },
                })
                setSelectedGuide(d.guides.length)
              }}
              bandEditor={
                editingBands
                  ? {
                      from: blend.effects.dither.from,
                      to: blend.effects.dither.to,
                      steps: blend.effects.dither.steps,
                      onChange: (from, to) => setEffects({ dither: { ...blend.effects.dither, from, to } }),
                      shape: blend.effects.dither.shape,
                      stretch: blend.effects.dither.stretch,
                      onStretch: (stretch) => setEffects({ dither: { ...blend.effects.dither, stretch } }),
                    }
                  : null
              }
              onPlaceSpot={(x, y) => {
                if (spots.length >= MAX_LEAK_SPOTS) return
                // Shapes are drawn with the shape editor (Draw a shape).
                if (placeShape === 'shape') return
                // Placing something the user cannot see would be confusing.
                const amount = blend.effects.leaks.amount > 0 ? blend.effects.leaks.amount : 0.5
                setLeaks({
                  amount,
                  spots: [
                    ...spots,
                    {
                      x,
                      y,
                      size: 0.3,
                      stretch: 1.6,
                      angle: 0,
                      strength: 1,
                      kind: placeKind,
                    },
                  ],
                })
                setSelectedSpot(spots.length)
              }}
            />
            {image && (
            <ViewBar comparing={compare?.name ?? null} onStopComparing={() => setCompareId(null)} />
            )}
            {strip.shown && (
              <Filmstrip
                closing={strip.closing}
                library={library}
                onLibrary={setLibrary}
                onAddFolder={() => void addFolder()}
                openPath={openPath}
                openSha={image?.sha ?? null}
                onOpen={(f) => void openFromStrip(f)}
              />
            )}
          </main>

          {inLibrary && (
            <LibraryView
              demo={libraryDemo}
              library={library}
              onLibrary={setLibrary}
              onOpenPhotos={act('open')}
              onExportPhotos={(files) => void exportPhotos(files)}
              onRecipe={(files, id) => {
                const c = recipeChange(id)
                if (c) void editPhotos(files, c.change, c.what)
                else setStatus('That recipe is no longer there')
              }}
              clip={clip}
              onClipParts={(parts) => setClip((c) => (c ? { ...c, parts } : c))}
              onCopy={(f) => void copyFromPhoto(f)}
              onReveal={(f) => void revealInFinder(f.path, true).catch((err) => setStatus(String(err)))}
              onRevealOriginal={(f, sha) =>
                void (async () => {
                  // An export saved in its place: the original is in Originals beside it, under its own name.
                  const name = (await loadEdit(sha))?.name ?? f.name
                  const dir = f.path.slice(0, f.path.length - f.name.length - 1)
                  await revealInFinder(joinPath(joinPath(dir, ARCHIVE_DIR), name), true).catch(() => setStatus(`The original of ${f.name} is not in ${ARCHIVE_DIR} beside it`))
                })()
              }
              onPaste={(files) => {
                if (!clip) return setStatus('Copy a photo’s edit first')
                if (!clip.parts.length) return setStatus('Nothing chosen to paste')
                const c = clip
                void editPhotos(files, (was) => pasteClip(c, was), `the edit of ${c.from}`)
              }}
              recipes={[NONE_LOOK, ...LOOKS].map((l) => ({ id: l.id, label: l.label })).concat(presets.map((p) => ({ id: p.id, label: p.data.name })))}
              undoLabel={bulkUndo?.what ?? null}
              onUndo={() => void undoBulk()}
              pictureFor={(path) => wholePictures.current.get(path)}
              exporting={exportingMany}
              onAddFolder={() => void addFolder()}
              sidebar={leftOpen}
              openPath={openPath}
              openSha={image?.sha ?? null}
              onOpen={(f) => {
                setLibraryShown(false)
                if (f.path !== openPath) void openFromStrip(f)
              }}
              onSubmitGallery={(f) => {
                pendingGallery.current = f.path
                setGalleryTick((n) => n + 1)
                setLibraryShown(false)
                if (f.path !== openPath) void openFromStrip(f)
              }}
              onReplace={(f, better) => {
                // Opened, then its edit moved onto the better copy (once the edit is in: the effect by replacePhoto).
                pendingReplace.current = { path: f.path, file: better }
                setReplaceTick((n) => n + 1)
                setLibraryShown(false)
                if (f.path !== openPath) void openFromStrip(f)
              }}
              onClose={() => setLibraryShown(false)}
            />
          )}

          {rightPanel.shown && (
            <aside className={`panel right${rightPanel.closing ? ' closing' : ''}`}>
              <Resizer
                side="right"
                width={rightWidth}
                min={248}
                max={520}
                onResize={setRightWidth}
                onReset={() => setRightWidth(DEFAULT_RIGHT)}
              />
              <StackRail
                tab={tab}
                onTab={setStackTab}
                groups={groups}
                usedIn={usedIn}
                activeCount={MODULES.filter((m) => shownInStack(m.id)).length}
                onEditGroup={editGroup}
                exporting={panelPage === 'export'}
                onExport={() => setPanelPage('export')}
                recipes={panelPage === 'recipes'}
                onRecipes={() => setPanelPage('recipes')}
                recipeName={activeLook?.label ?? presets.find((p) => p.id === activePresetId)?.data.name ?? null}
              />
              <div className="panel-body">
                {/* Recipes: a page of their own, the starting point to look at first. */}
                <RecipesPage
                  palette={palette}
                  presets={presets}
                  activeLook={activeLook}
                  activePresetId={activePresetId}
                  activeDoc={activeDoc}
                  lookEdited={lookEdited}
                  source={source}
                  blend={blend}
                  setBlend={setBlend}
                  image={image}
                  applyLook={applyLook}
                  setRecipeHover={setRecipeHover}
                  applyPreset={applyPreset}
                  onSavePreset={onSavePreset}
                  onUpdatePreset={onUpdatePreset}
                  onRenamePreset={onRenamePreset}
                  onExportPreset={onExportPreset}
                  onImportPreset={onImportPreset}
                  onDeletePreset={onDeletePreset}
                  onDescribePreset={onDescribePreset}
                  startFresh={startFresh}
                  addModule={addModule}
                  onMix={(doc, name, kinds) => void mixRecipe(doc, name, kinds)}
                  mixed={(doc, kinds) => {
                    const next = withParts(doc, kinds)
                    return { ...doc, blend: next.blend, grainSource: next.grainSource }
                  }}
                  changedParts={(doc) =>
                    MODULES.flatMap((m) => {
                      const k = presetKind(m.id)
                      if (!k || m.id === 'border' || !inUse(m.id, doc.blend)) return []
                      return stableJson(extractPart(k, blend, null)) === stableJson(extractPart(k, doc.blend, null)) ? [] : [k]
                    })
                  }
                />
                <div className="panel-page" hidden={panelPage !== 'modules'}>

                <StackContext.Provider value={stackApi}>
                <StackAdd shown={shownInStack} onAdd={addModule} />
                <StackTitle
                  tab={tab}
                  group={tabGroup}
                  editing={!!tabGroup && editingGroup === tabGroup.id}
                  onEditGroup={editGroup}
                  onNewGroup={newGroup}
                  onFoldAll={() => window.dispatchEvent(new Event('grain:fold-all'))}
                />
                {tabGroup && editingGroup === tabGroup.id && (
                  <GroupEditor
                    group={tabGroup}
                    onChange={(g) => setGroups(groups.map((x) => (x.id === g.id ? g : x)))}
                    onDelete={() => {
                      setGroups(groups.filter((x) => x.id !== tabGroup.id))
                      setEditingGroup(null)
                      setStackTabNow('active')
                      setStatus(`Deleted the group ${tabGroup.name}. Its modules are untouched.`)
                    }}
                    onDone={() => setEditingGroup(null)}
                  />
                )}
                {/* How much of each part of the whole edit: on In use, above its modules. */}
                {tab === 'active' && !tabGroup && image && <StrengthControls blend={blend} setBlend={setBlend} />}
                <div className="stack">
                {slimModules.map((id) => (
                  <SlimModule key={id} id={id} order={moduleOrder(id)} onAdd={addModule} />
                ))}
                {multiCategory &&
                  CATEGORIES.filter((c) => MODULES.some((m) => m.category === c.id && wouldShow(m.id))).map((c) => (
                    // A label over its modules, not a row of its own: they fold on their own.
                    <div key={c.id} className="stack-cat label" title={c.hint} style={{ order: categoryOrder(c.id), ['--tint' as string]: c.tint }}>
                      {c.label}
                    </div>
                  ))}
                {showModule('grain') && (
                  <GrainModule
                    generator={generator}
                    image={image}
                    grain={grain}
                    layer={layer}
                    setError={setError}
                    blend={blend}
                    setBlend={setBlend}
                    setGen={setGen}
                    histogram={histogram}
                    layoutVersion={layoutVersion}
                    source={source}
                    setSource={setSource}
                  />
                )}

                {showModule('dither') && (
                  <DitherModule
                    blend={blend}
                    setEffects={setEffects}
                    setEditingGuides={setEditingGuides}
                    editingGuides={editingGuides}
                    image={image}
                    setEditingBands={setEditingBands}
                    setEditingLeaks={setEditingLeaks}
                    guideSign={guideSign}
                    setGuideSign={setGuideSign}
                    selectedGuide={selectedGuide}
                    setSelectedGuide={setSelectedGuide}
                    editingBands={editingBands}
                  />
                )}

                {showModule('pixel') && (
                  <PixelModule
                    blend={blend}
                    setEffects={setEffects}
                  />
                )}

                {showModule('recolour') && (
                  <RecolourModule
                    blend={blend}
                    items={recolourItems}
                    open={recolourOpen}
                    onOpen={openRecolour}
                    image={image}
                    palette={palette}
                    onSelect={selectRecolourPart}
                    onDraw={drawRecolourPart}
                    drawing={drawingRecolour}
                    pickingView={pickingView}
                    choosePickReading={choosePickReading}
                    finishPicking={finishPicking}
                    setItem={setRecolourItem}
                    onRemove={removeRecolour}
                    onToggle={toggleRecolour}
                    onDuplicate={duplicateRecolour}
                    onMove={moveRecolour}
                    keysOff={!!pickingView || maskDrawing || !!brushing}
                    partSettings={(() => {
                      const it = recolourOpen !== null ? recolourItems[recolourOpen] : undefined
                      const at = it ? blend.effects.masks.findIndex((m) => m.id === it.source) : -1
                      const part = at >= 0 ? blend.effects.masks[at] : undefined
                      if (!part || picking?.owner === 'recolour') return null
                      return (
                        <MaskSettings
                          mask={part}
                          index={at}
                          hasImage={!!image}
                          picking={!!picking}
                          brushing={brushing}
                          brushSize={brushSize}
                          onBrushSize={setBrushSize}
                          onByColour={setBrushByColour}
                          onBrush={(i, mode) => {
                            setBrushing(brushing?.index === i && brushing.mode === mode ? null : { index: i, mode })
                            setMaskDrawing(false)
                            setMaskPlacing(null)
                          }}
                          onPick={() => selectRecolourPart(true)}
                          editing={false}
                          onMatch={matchMask}
                          onChange={(i, patch, step) => setMasks(blend.effects.masks.map((m, j) => (j === i ? { ...m, ...patch } : m)), step)}
                          trace={traceOutline}
                          cleanEdges={false}
                          named={false}
                          view={maskView}
                          onView={setMaskView}
                          byColour={brushByColour}
                        />
                      )
                    })()}
                  />
                )}

                {showModule('colour') && (
                  <ColourModule
                    grade={grade}
                    palette={palette}
                    image={image}
                    applyRecipe={applyRecipe}
                    setPreviewGrade={setPreviewGrade}
                    setStatus={setStatus}
                    recipeName={recipeName}
                    offWheel={offWheel}
                    grain={grain}
                    setPreviewBlend={setPreviewBlend}
                    fitNow={fitNow}
                    history={history}
                    setBlend={setBlend}
                    shownColour={shownColour}
                    wheelShown={wheelShown}
                    onWheel={onWheel}
                    setGrade={setGrade}
                    blend={blend}
                    setStock={setStock}
                  />
                )}

                {showModule('exposure') && (
                  <ExposureModule
                    baseFx={baseFx}
                    setBase={setBase}
                    image={image}
                    autoExposure={autoExposure}
                  />
                )}

                {showModule('balance') && (
                  <BalanceModule
                    baseFx={baseFx}
                    setBase={setBase}
                    dropper={dropper}
                    image={image}
                    pickGrey={pickGrey}
                    autoBalance={autoBalance}
                  />
                )}

                {showModule('curve') && (
                  <CurveModule
                    baseFx={baseFx}
                    history={history}
                    setBase={setBase}
                    histogram={histogram}
                  />
                )}

                {showModule('crop') && (
                  <CropModule
                    blend={blend}
                    cropTo={cropTo}
                    onAngle={(angle) => setCrop({ angle, enabled: true })}
                    onQuarter={(by) => setCrop(turnQuarter({ ...blend.effects.crop, enabled: true }, by))}
                    editingCrop={editingCrop}
                    image={image}
                    setEditingCrop={setEditingCrop}
                  />
                )}
                {showModule('lens') && (
                  <LensModule
                    blend={blend}
                    setExtra={setExtra}
                  />
                )}
                {showModule('prism') && <PrismModule blend={blend} setExtra={setExtra} />}

                {showModule('double') && (
                  <DoubleModule
                    second={second}
                    secondInput={secondInput}
                    image={image}
                    history={history}
                    setExtra={setExtra}
                    setError={setError}
                    blend={blend}
                  />
                )}

                {showModule('stamp') && (
                  <StampModule
                    blend={blend}
                    history={history}
                    setExtra={setExtra}
                  />
                )}

                {showModule('mono') && (
                  <MonoModule
                    blend={blend}
                    setExtra={setExtra}
                  />
                )}

                {showModule('halftone') && (
                  <HalftoneModule
                    blend={blend}
                    setExtra={setExtra}
                  />
                )}

                {showModule('surface') && (
                  <SurfaceModule
                    blend={blend}
                    setSurface={(patch) => setEffects({ surface: { ...(blend.effects.surface ?? DEFAULT_SURFACE), ...patch } })}
                    say={setStatus}
                  />
                )}

                {showModule('tone') && (
                  <ToneModule
                    blend={blend}
                    setEffects={setEffects}
                  />
                )}

                {showModule('light') && (
                  <GlowModule
                    blend={blend}
                    setEffects={setEffects}
                    palette={palette}
                  />
                )}

                {showModule('edges') && (
                  <EdgesModule
                    blend={blend}
                    setEffects={setEffects}
                  />
                )}

                {showModule('solarize') && (
                  <SolarizeModule
                    blend={blend}
                    setEffects={setEffects}
                  />
                )}

                {showModule('lighting') && (
                  <LightingModule
                    blend={blend}
                    lighting={lighting}
                    image={image}
                    lightDrawing={lightDrawing}
                    setLightDrawing={setLightDrawing}
                    setLightEditing={setLightEditing}
                    lightEditing={lightEditing}
                    setEditingLeaks={setEditingLeaks}
                    setEditingStreaks={setEditingStreaks}
                    setMaskEditing={setMaskEditing}
                    selectedLight={selectedLight}
                    setSelectedLight={setSelectedLight}
                    setLight={setLight}
                    history={history}
                    setLighting={setLighting}
                    listedMasks={listedMasks}
                    palette={palette}
                  />
                )}

                {showModule('leaks') && (
                  <LeaksModule
                    blend={blend}
                    applyLeakStyle={applyLeakStyle}
                    setLeaks={setLeaks}
                    palette={palette}
                    spots={spots}
                    selectedSpot={selectedSpot}
                    setSelectedSpot={setSelectedSpot}
                    editingLeaks={editingLeaks}
                    image={image}
                    setEditingLeaks={setEditingLeaks}
                    setEditingBands={setEditingBands}
                    placeKind={placeKind}
                    setPlaceKind={setPlaceKind}
                    history={history}
                    selected={selected}
                    setSpot={setSpot}
                  />
                )}

                {showModule('streaks') && (
                  <StreaksModule
                    previewStreak={(i, patch) =>
                      setPreviewBlend(
                        patch
                          ? { ...blend, effects: { ...blend.effects, streaks: { ...blend.effects.streaks, shapes: blend.effects.streaks.shapes.map((x, j) => (j === i ? { ...x, ...patch } : x)) } } }
                          : null,
                      )
                    }
                    drawingStreak={drawingStreak}
                    image={image}
                    blend={blend}
                    setDrawingStreak={setDrawingStreak}
                    setDrawingPath={setDrawingPath}
                    setFixEditing={setFixEditing}
                    setStreaks={setStreaks}
                    setEditingStreaks={setEditingStreaks}
                    setSelectedStreak={setSelectedStreak}
                    setEditingLeaks={setEditingLeaks}
                    setEditingGuides={setEditingGuides}
                    setEditingBands={setEditingBands}
                    setMaskDrawing={setMaskDrawing}
                    setMaskEditing={setMaskEditing}
                    setStatus={setStatus}
                    selectedStreak={selectedStreak}
                    setGuidingStreak={setGuidingStreak}
                    setStreakShape={setStreakShape}
                    editingStreaks={editingStreaks}
                    drawingPath={drawingPath}
                    fixEditing={fixEditing}
                    setLightEditing={setLightEditing}
                    setLightDrawing={setLightDrawing}
                    history={history}
                    streakSel={streakSel}
                    traceOutline={traceOutline}
                    guidingStreak={guidingStreak}
                    matchLines={matchLines}
                    fitRepeat={fitRepeat}
                    extendSubject={extendSubject}
                    listedMasks={listedMasks}
                    newMaskFor={streakMaskFor}
                    repeatFit={repeatFit}
                    streakTab={streakTab}
                    session={streakSession}
                    startSession={startStreakSession}
                    endSession={endStreakSession}
                    setStreakTab={setStreakTab}
                    pathKind={pathKind}
                    setPathKind={setPathKind}
                    selectedFix={selectedFix}
                    setSelectedFix={setSelectedFix}
                    pickingView={pickingView?.owner === 'streak' ? pickingView : null}
                    pickingStreak={picking?.owner === 'streak' ? (picking.streak ?? null) : null}
                    choosePickReading={choosePickReading}
                    finishPicking={finishPicking}
                    onStreakSubject={streakSubject}
                    onSubjectInset={setSubjectInset}
                    copyStreak={copyStreak}
                    subjectSettings={subjectSettings}
                    removeStreak={removeStreak}
                    moveStreak={moveStreak}
                    copySettings={copyStreakSettings}
                    pasteSettings={pasteStreakSettings}
                    clip={streakClip?.from ?? null}
                    colourLineFor={colourLineFor}
                    ownMasks={(i) => {
                      const sh = blend.effects.streaks.shapes[i]
                      return {
                        masks: ownMasksOf(sh)
                          .filter((m) => m.id !== sh?.subject?.mask)
                          .map((m) => ({ id: m.id, name: m.name, body: subjectSettings(i, m.id, 'mask') })),
                        onRemove: (id) => removeStreakMask(i, id),
                      }
                    }}
                  />
                )}

                {showModule('glass') && (
                  <GlassModule
                    glass={glass}
                    blend={blend}
                    setEffects={setEffects}
                    maskDrawing={maskDrawing}
                    newTarget={newTarget}
                    image={image}
                    drawMask={drawMask}
                  />
                )}

                {showModule('repeat') && (
                  <RepeatModule
                    items={repeats.items}
                    open={repeatOpen !== null && repeatOpen < repeats.items.length ? repeatOpen : null}
                    onOpen={openRepeat}
                    onMake={makeRepeat}
                    onRemove={removeRepeat}
                    onToggle={toggleRepeat}
                    onDuplicate={duplicateRepeat}
                    copySettings={copyRepeatSettings}
                    pasteSettings={pasteRepeatSettings}
                    clip={repeatClip?.from ?? null}
                    onMove={moveRepeat}
                    onPieceToPoints={() => maskToPoints(blend.effects.masks.findIndex((m) => m.id === repeat.source))}
                    onFit={fitRepeatNow}
                    onLineUp={lineUpRepeat}
                    onPerspective={perspectiveRepeat}
                    quick={
                      // Ready-made starts only for the first repeat, as Streaks' style is for the first streak.
                      repeats.items.length ? null : <QuickEffects title="Start from" effects={REPEAT_QUICK} disabled={!image || !!picking} onPick={quickRepeat} />
                    }
                    blend={blend}
                    repeat={repeat}
                    pickingView={pickingView}
                    choosePickReading={choosePickReading}
                    finishPicking={finishPicking}
                    maskEditing={maskEditing}
                    maskSolo={maskSolo}
                    maskDrawing={maskDrawing}
                    selectedMask={selectedMask}
                    listedMasks={listedMasks}
                    image={image}
                    editingRepeat={editingRepeat}
                    setRepeat={setRepeat}
                    setEditingRepeat={setEditingRepeat}
                    setBrushing={setBrushing}
                    editMaskShape={editMaskShape}
                    drawingPiece={drawingPiece}
                    startPicking={startPicking}
                    drawPiece={drawPiece}
                    newPainted={newPainted}
                    brushing={brushing}
                    setRepeatPieceShown={setRepeatPieceShown}
                    picking={picking}
                    brushSize={brushSize}
                    setBrushSize={setBrushSize}
                    setMaskDrawing={setMaskDrawing}
                    setMaskPlacing={setMaskPlacing}
                    matchMask={matchMask}
                    setMasks={setMasks}
                    traceOutline={traceOutline}
                    maskView={maskView}
                    setMaskView={setMaskView}
                    brushByColour={brushByColour}
                    setBrushByColour={setBrushByColour}
                  />
                )}

                {showModule('kaleido') && (
                  <KaleidoModule
                    blend={blend}
                    kaleido={kaleido}
                    image={image}
                    setKaleido={setKaleido}
                    onSlice={kaleidoSlice}
                    onSelect={() => startPicking(kaleidoPieceAt >= 0 && blend.effects.masks[kaleidoPieceAt]?.raster ? kaleidoPieceAt : null, 'kaleido')}
                    onDraw={drawKaleidoPiece}
                    drawing={drawingKaleido}
                    pickingView={pickingView}
                    choosePickReading={choosePickReading}
                    finishPicking={finishPicking}
                    editingCentre={editingKaleido}
                    onEditCentre={() => {
                      if (!editingKaleido) {
                        if (picking) finishPicking(false)
                        if (!kaleido.enabled) setKaleido({ enabled: true })
                      }
                      setEditingKaleido(!editingKaleido)
                    }}
                  />
                )}

                {showModule('collage') && (
                  <CollageModule
                    collage={collage}
                    image={image}
                    collageHere={collageHere}
                    selectedPiece={selectedPiece}
                    armedImage={armedImage}
                    editingCollage={editingCollage}
                    setArmedImage={setArmedImage}
                    setSelectedPiece={setSelectedPiece}
                    markMoving={markMoving}
                    setPiece={setPiece}
                    matchSizes={matchSizes}
                    collageGhost={collageGhost}
                    setCollageGhost={setCollageGhost}
                    setCollage={setCollage}
                    editCollage={editCollage}
                    setStatus={setStatus}
                    setError={setError}
                    arranging={arranging}
                    startArranging={startArranging}
                    arrangeNow={arrangeNow}
                    arranged={arranged}
                    setArrange={setArrange}
                  />
                )}

                {showModule('border') && (
                  <BorderModule
                    blend={blend}
                    setBorder={setBorder}
                    palette={palette}
                    papers={papers}
                    onApplyPart={applyPart}
                  />
                )}

                {showModule('dust') && (
                  <DustModule
                    blend={blend}
                    setDefects={setDefects}
                  />
                )}

                {showModule('surge') && (
                  <SurgeModule
                    blend={blend}
                    setSurge={setSurge}
                  />
                )}
                {!MODULES.some((m) => wouldShow(m.id)) && !slimModules.length && (
                  <p className="stack-empty">
                    {tabGroup
                      ? editingGroup === tabGroup.id
                        ? 'Tick the modules this group holds.'
                        : 'Nothing in this group yet. Edit it to choose its modules.'
                      : 'Nothing on this photo yet'}
                  </p>
                )}
                </div>
                </StackContext.Provider>
                </div>

                {/* Hidden, not unmounted, so a batch keeps running while you go back to the modules. */}
                <ExportPage
                  output={output}
                  setOutput={setOutput}
                  image={image}
                  blend={blend}
                  setBlend={setBlend}
                  source={source}
                  exportPresets={exportPresets}
                  setExportPresets={setExportPresets}
                  exportPreset={exportPreset}
                  cropTo={cropTo}
                  exportFolder={exportFolder}
                  setExportFolder={setExportFolder}
                  exportTo={exportTo ?? (exportFolder ? 'folder' : 'photo')}
                  onExportTo={setExportTo}
                  photoFolder={image?.from ? { name: baseName(dirOf(image.from)), path: dirOf(image.from) } : null}
                  byHand={!!image && byHand(image.from)}
                  lastExport={lastExport}
                  exporting={exporting}
                  onExportImage={onExportImage}
                  exportAs={exportAs}
                  keepBorderColour={keepBorderColour}
                  setKeepBorderColour={setKeepBorderColour}
                  setStatus={setStatus}
                  setError={setError}
                  onGetDesktop={() => setGetDesktopOpen(true)}
                  border={{
                    // Picked here, a border switched off comes back on with it (as touching its module's controls does).
                    set: (patch) => {
                      if (!(patch.width === 0 && patch.bottomExtra === 0)) waking.current = 'border'
                      setBorder(patch)
                    },
                    palette,
                    papers,
                    onApplyPart: (part) => {
                      waking.current = 'border'
                      applyPart(part)
                    },
                    onEdit: tourShow('border'),
                  }}
                />
              </div>
            </aside>
          )}

          {(error || status || pendingRecipe) && (
          <footer
            key={error ?? status ?? 'pending'}
            className={`statusbar${!error && !pendingRecipe && Number.isFinite(statusMs) ? ' fleeting' : ''}${strip.shown ? ' over-strip' : ''}`}
            style={{ ['--status-ms' as string]: `${Number.isFinite(statusMs) ? statusMs : 0}ms` }}
            role="status"
          >
            {error ? (
              <span className="err">{plainGpuError(error) ?? error}</span>
            ) : status ? (
              <span>{status}</span>
            ) : pendingRecipe ? (
              <span>This is an export. Locate its original, {pendingRecipe.original.name}, to edit from it at full quality.</span>
            ) : null}
            {!error && revealable && statusFile && (
              <button onClick={() => void revealInFinder(statusFile.path, true).catch((err: Error) => setError(`Could not show it: ${err.message}`))}>{showInFilesLabel()}</button>
            )}
            {pendingRecipe && pendingFile?.locked && (
              <button onClick={() => void openImage(pendingFile.file, pendingFile.name, true)}>Allow access</button>
            )}
            {pendingRecipe && <button onClick={() => locateInput.current?.click()}>Locate original…</button>}
            {error?.endsWith('RAW files open in the desktop app.') && <button onClick={() => setGetDesktopOpen(true)}>Get the desktop app</button>}
            {(error || pendingRecipe) && (
              <button
                className="icon"
                title="Dismiss"
                onClick={() => {
                  setError(null)
                  setPendingRecipe(null)
                  setPendingFile(null)
                }}
              >
                ×
              </button>
            )}
          </footer>
          )}
            <input
              ref={locateInput}
              type="file"
              accept={photoAccept()}
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void locateOriginal(f)
                e.target.value = ''
              }}
            />

          {stopped && (
            <div className="stopped-overlay">
              <div>
                <h2>copyshop has stopped</h2>
                <p>Your work is saved. Open the app again to carry on, then close this tab.</p>
              </div>
            </div>
          )}
          {showHelp && (
            <ShortcutsOverlay
              shortcuts={shortcuts}
              onClose={() => setShowHelp(false)}
              onReport={() => setFeedbackOpen(true)}
              onTour={startTour}
              onGuide={() => {
                setShowHelp(false)
                setGuidePage('topic:photos')
              }}
              onIntro={() => {
                setShowHelp(false)
                setIntroOpen(true)
              }}
            />
          )}
          {introOpen && !licenseGate && !sendPairing && (
            <IntroDialog
              app={libraryAvailable()}
              hasImage={!!image}
              onOpen={act('open')}
              onTour={startTour}
              onClose={closeIntro}
            />
          )}
          {sendPairing && <SendToAppDialog pairing={sendPairing} onClose={() => setSendPairing(null)} />}
          {licenseGate && <ActivateDialog mode={license === 'invalid' ? 'invalid' : 'start'} onDone={() => setLicense('valid')} />}
          {changingLicense && (
            <ActivateDialog mode="change" onDone={() => setChangingLicense(false)} onClose={() => setChangingLicense(false)} />
          )}
          {getDesktopOpen && <GetDesktopDialog onClose={() => setGetDesktopOpen(false)} />}
          {gallery && <GalleryDialog photo={gallery.photo} tools={gallery.tools} onClose={() => setGallery(null)} />}
          {whatsNewOpen && (
            <WhatsNewDialog
              releases={whatsNewOpen === 'since' ? releasesSince(updatedFromStore.get()) : undefined}
              onShowModule={(id) => {
                if (isStackModule(id)) showModuleRef.current(id)
                setSettingsOpen(false)
              }}
              onClose={() => {
                whatsNewSeen()
                setWhatsNewOpen(null)
              }}
            />
          )}
          {tourOpen && <Tour steps={tourSteps} onClose={() => endTour()} />}
          {guidePage && (
            <Guide
              page={guidePage}
              onPage={setGuidePage}
              onClose={() => setGuidePage(null)}
              onShow={(id) => {
                setGuidePage(null)
                showModuleNow(id)
              }}
            />
          )}
          {feedbackOpen && (
            <FeedbackDialog
              onClose={() => setFeedbackOpen(false)}
              // The edit's settings, never the photo: what a report needs to make the same thing again.
              edit={image ? () => ({ photo: { width: image.size.width, height: image.size.height }, blend, output }) : undefined}
            />
          )}
          {settingsOpen && (
            <SettingsDialog onClose={() => setSettingsOpen(false)}>
              <GeneralSettings
                onIntro={() => {
                  setSettingsOpen(false)
                  setIntroOpen(true)
                }}
                onReport={() => setFeedbackOpen(true)}
                onWhatsNew={() => setWhatsNewOpen('all')}
                onTour={startTour}
                onStatus={setStatus}
              />
              <TimelapsePanel
                settings={timelapse}
                onSettings={setTimelapse}
                recorder={recorder}
                hasImage={!!image}
                playing={replaying}
                making={makingVideo}
                onPlay={(frames, seconds) => {
                  setSettingsOpen(false)
                  void playTimelapse(frames, seconds)
                }}
                onStop={() => {
                  if (replay.current) replay.current.stop = true
                }}
                onVideo={(frames, opts) => void makeVideo(frames, opts)}
                onCancelVideo={() => videoAbort.current?.abort()}
                onStatus={setStatus}
                onError={setError}
              />
            </SettingsDialog>
          )}
        </div>
        {askingVersions && <NewVersionsDialog items={askingVersions.items} onDone={askingVersions.resolve} />}
        {askingReplace && <ReplacedVersionDialog name={askingReplace.name} size={askingReplace.size} thumb={askingReplace.thumb} onDone={askingReplace.resolve} />}
      </DropperContext.Provider>
    </BaselineContext.Provider>
    </HistogramContext.Provider>
    </ToneHighlightContext.Provider>
    </MaskOverlayContext.Provider>
    </EditViewContext.Provider>
  )
}

/** Two settings the same but for the crop (the same objects everywhere else, as an edit leaves them). */
function onlyCropDiffers(a: BlendParams, b: BlendParams): boolean {
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof BlendParams>) if (k !== 'effects' && a[k] !== b[k]) return false
  const ea = a.effects
  const eb = b.effects
  for (const k of new Set([...Object.keys(ea), ...Object.keys(eb)]) as Set<keyof typeof ea>) if (k !== 'crop' && ea[k] !== eb[k]) return false
  return true
}

/** A tour step's keys, each beside what it does. */
function TourKeys({ rows }: { rows: [string, string][] }) {
  return (
    <span className="tour-dots tour-keys">
      {rows.map(([key, what]) => (
        <span key={key}>
          <kbd>{key}</kbd> {what}
        </span>
      ))}
    </span>
  )
}

/**
 * The edit with one module's own output left out, while its own part is
 * selected, drawn or painted: Repeat's copies, the streaks, the
 * Kaleidoscope's copies. What it is cut from is then what shows.
 */
function hideOwnOutput(b: BlendParams, owner: MaskOwner | null): BlendParams {
  const e = b.effects
  if (owner === 'recolour' && e.recolour?.enabled) return { ...b, effects: { ...e, recolour: { ...e.recolour, enabled: false } } }
  if (owner === 'kaleido' && e.kaleido?.enabled) return { ...b, effects: { ...e, kaleido: { ...e.kaleido, enabled: false } } }
  if (owner === 'repeat' && e.repeat?.enabled) return { ...b, effects: { ...e, repeat: { ...e.repeat, enabled: false } } }
  if (owner === 'streak' && e.streaks.enabled) return { ...b, effects: { ...e, streaks: { ...e.streaks, enabled: false } } }
  return b
}
