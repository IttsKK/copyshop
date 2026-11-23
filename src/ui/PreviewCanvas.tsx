import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toScene } from './lensView'
import { graphicsState, renderClient } from '../engine/renderClient'
import { activeBorder, photoFrameOf, printSizeOf, shapeFrame, shapeMeasure, type BlendParams, type MaskRaster, type Rect, type RenderRequest, type Size } from '../engine/types'
import { cropFraction, shapesOnCrop } from '../pipeline/instagram'
import { composeCrop } from '../engine/crop'
import { originalOf } from '../engine/original'
import { exportCrop, exportPhotoSize, prepareForExport, type ExportSizing } from '../pipeline/exportSize'
import type { GrainTexture } from '../sources/GrainSource'
import { BandOverlay, type BandEditor } from './BandOverlay'
import { GuideOverlay, type GuideEditor } from './GuideOverlay'
import { CollageOverlay, type CollageEditor } from './CollageOverlay'
import { ToneOverlay, lumaOf } from './ToneOverlay'
import { pointedTone, type ToneRange } from './toneHighlight'
import { pieceContains, pieceMaps } from '../engine/collage'
import { StreakOverlay, type StreakEditor } from './StreakOverlay'
import { LeakOverlay, type LeakEditor } from './LeakOverlay'
import { ShapeMaskOverlay, type ShapeMaskEditor } from './ShapeMaskOverlay'
import { CropOverlay, type CropEditor } from './CropOverlay'
import { RepeatOverlay, type RepeatEditor } from './RepeatOverlay'
import { KaleidoOverlay, type KaleidoEditor } from './KaleidoOverlay'
import { ColourLineOverlay, type ColourLineEditor } from './ColourLineOverlay'
import { LightOverlay, type LightEditor } from './LightOverlay'
import { StreakGuideOverlay, type StreakGuideEditor } from './StreakGuideOverlay'
import { RasterTint } from './RasterTint'
import type { MaskBrush } from './maskBrush'
import { capturePointer } from './pointer'
import { encodeWebp } from '../pipeline/webp'
import { PickOverlay, pickNear, type Picker } from './PickOverlay'
import { centredPan, clampPan, type Pan } from './viewClamp'
import { trackpadScrollStore } from './state/settings'
import { inTextField } from './shortcuts'

/**
 * How far in the view is: 'fit' shows the whole print, a number is device
 * pixels per print pixel (1 = 100%, where one image pixel is one screen pixel).
 */
export type Zoom = 'fit' | number

export const MAX_ZOOM = 16
/** How far below fit the view can go, as a fraction of the fit scale. */
export const MIN_ZOOM_OF_FIT = 0.25

/** Width the small view resamples to: what a phone or a feed actually gets. */
const SMALL_WIDTH = 1080
/** Above this, a zoomed-out view renders at screen size rather than full size. */
const MAX_SUPERSAMPLE_PX = 48e6
/**
 * A look slower than this to render is not waited for while the view moves:
 * its last picture is moved and scaled with the view, and full renders are
 * drawn over it as they land. Anything faster renders at every step: renders
 * queue newest-only, so a fast zoom never lags.
 */
const MOVE_ABOVE_MS = 40
/** How long the view stays still before it is rendered in full again. */
const DRAFT_IDLE_MS = 120
/**
 * The whole print, at least this many px on its long side (more on a big
 * screen, up to BACKDROP_MAX), behind a moved picture; rendered this long
 * after things settle.
 */
const BACKDROP_SIDE = 1024
const BACKDROP_MAX = 2048
const BACKDROP_AFTER_MS = 300
/** How long the picture may lag the edit before a note says it is updating: a click (a recipe, a style), and while dragging. */
const UPDATING_AFTER_MS = 120
const UPDATING_DRAGGING_MS = 400
/**
 * While something is dragged (a slider, a handle) and the look is slower than
 * this to render, the preview draws drafts: fewer pixels, scaled up, to cost
 * about DRAFT_TARGET_MS, and the full render once the pointer is let go.
 * Renders run off the page's thread, so a draft only sets how often the
 * picture keeps up, never whether the page does: kept mild, at least half
 * the pixels across.
 */
const DRAFT_ABOVE_MS = 45
const DRAFT_TARGET_MS = 120

/** Whether the look draws patterns at the scale of single print pixels. */
function hasPixelPattern(p: BlendParams): boolean {
  const fx = p.effects
  if (!p.modules.grain) return false
  return (fx.dither.enabled && fx.dither.amount > 0) || fx.pixelArt.pixelate > 1 || fx.pixelArt.palette !== 'off'
}

/**
 * Shrink with an averaging filter: halve while more than twice the target,
 * then one high-quality step. The browser's single-step resize skips pixels
 * at large factors, which is exactly what aliases a pixel pattern.
 */
function shrinkTo(img: CanvasImageSource & Size, w: number, h: number): HTMLCanvasElement {
  let src: CanvasImageSource & Size = img
  while (src.width / 2 >= w && src.height / 2 >= h) {
    const half = document.createElement('canvas')
    half.width = Math.round(src.width / 2)
    half.height = Math.round(src.height / 2)
    const hc = half.getContext('2d')!
    hc.imageSmoothingQuality = 'high'
    hc.drawImage(src, 0, 0, half.width, half.height)
    src = half
  }
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const oc = out.getContext('2d')!
  oc.imageSmoothingQuality = 'high'
  oc.drawImage(src, 0, 0, w, h)
  return out
}
/** JPEG quality Instagram's re-encode roughly corresponds to. */
const IG_QUALITY = 0.72

/** One thing to draw: some grain, blended some way. */
export interface PreviewLayer {
  grain: GrainTexture
  params: BlendParams
  /** An open mask shown over it (RenderRequest.showMask), drawn with it. */
  showMask?: RenderRequest['showMask']
}

interface Props {
  base: ImageBitmap | null
  baseSize: Size | null
  /** The photo's seed for its own random detail; see photoSeed. */
  imageSeed?: number
  layer: PreviewLayer | null
  /** When set, revealed to the left of the wipe for comparison. */
  compare: PreviewLayer | null
  /** Show a loupe under the pointer: the photo at 100% (200% when already zoomed in). */
  loupe?: boolean
  /** Layers likely to be compared next (the snapshots): rendered ahead for the current view while idle. */
  prefetch?: PreviewLayer[]
  compareLabel?: string
  wipe: number
  onWipeChange: (wipe: number) => void
  zoom: Zoom
  /** Bumped whenever Fit is asked for: the photo goes back to the middle. */
  fitAsked?: number
  /** The view zoomed itself (wheel, middle click); the parent should follow. */
  onZoomChange: (zoom: Zoom) => void
  /** The empty view's Open button. */
  onOpen?: () => void
  /** Open a sample photo, to try the app without one of your own. */
  onTrySample?: () => void
  bypass: boolean
  /** Changes whenever the panel layout does, prompting a re-measure. */
  layoutVersion: number
  onError: (message: string) => void
  /** When set, leak spots are drawn over the photo with handles. */
  leakEditor?: LeakEditor | null
  /** When set, the dither band line is drawn over the photo with handles. */
  bandEditor?: BandEditor | null
  /** When set, streak shapes are drawn over the photo with handles. */
  streakEditor?: StreakEditor | null
  /** When set, masks are drawn over the photo with handles (same overlay as streaks). */
  maskEditor?: StreakEditor | null
  /** Radial and gradient masks, edited with their own handles. */
  shapeMaskEditor?: ShapeMaskEditor | null
  /** The crop being set on the whole photo. */
  cropEditor?: CropEditor | null
  /** Repeat's path or placed copies, set on the photo. */
  repeatEditor?: RepeatEditor | null
  kaleidoEditor?: KaleidoEditor | null
  colourLineEditor?: ColourLineEditor | null
  /** A streak's guides, laid along the photo's lines. */
  streakGuideEditor?: StreakGuideEditor | null
  /** Lighting's lights, drawn and edited on the photo. */
  lightEditor?: LightEditor | null
  /** Painting a subject mask in or out by hand. */
  maskBrush?: MaskBrush | null
  /** A subject mask being looked at: what it covers, tinted. */
  /** A selected mask shown tinted on the photo: its cells, or (href) how it really covers the photo. */
  maskTint?: { raster: MaskRaster; href?: string | null } | null
  /** Leak shapes, drawn and edited with the same tools as masks and streaks (outlines in print fractions). */
  leakShapeEditor?: StreakEditor | null
  /** Selecting a subject by clicking it (Masks): clicks pick, a drag still pans. */
  picker?: Picker | null
  /** A brightness range to tint on the photo (a brightness slider being held). */
  toneHighlight?: ToneRange | null
  /** When set, the collage's pieces are drawn over the photo and clicks place them. */
  collageEditor?: CollageEditor | null
  /** When set, band guides are drawn over the photo; a click adds one. */
  guideEditor?: GuideEditor | null
  onPlaceGuide?: (x: number, y: number) => void
  /** A click (not a drag) on the photo while editing leaks, in print fractions. */
  onPlaceSpot?: (x: number, y: number) => void
  /** A double-click while editing leaks: closes a shape being drawn. */
  onFinishDraft?: () => void
  /** Show the export downscaled to a small, phone-like size instead of the editing view. */
  small?: boolean
  /** In the small view, also put it through Instagram-like JPEG re-compression. */
  igSim?: boolean
  /** How the export is compressed (JPEG or WebP, at its quality); null when it loses nothing (PNG, TIFF). */
  exportQuality?: { format: 'jpeg' | 'webp'; quality: number } | null
  /** How the export is cropped and sized; null at the photo's own size. The small view shows it rendered so. */
  exportSizing?: ExportSizing | null
  /** Where `base` sits in the original photo when it is the photo's crop (engine/crop.ts), for collage pieces. */
  photoCrop?: Rect | null
  /**
   * Degrees the picture on screen is turned about the photo's middle, for
   * now: the photo being straightened (Crop) shows turning at once, the
   * real picture following when the angle is still.
   */
  turnBy?: number
  /** The eyedropper is waiting: a click on the photo samples it. */
  sampling?: boolean
  /** What the dropper reads, for its banner: the photo before the look, or as edited. */
  samplingFrom?: 'edited' | 'original'
  /** Switch what the dropper reads, from its banner. */
  onSamplingFrom?: (from: 'edited' | 'original') => void
  /**
   * The dropper, in print fractions: 'preview' while the button is held (as
   * it moves), 'commit' on release.
   */
  onSample?: (x: number, y: number, phase: 'preview' | 'commit') => void
  /**
   * A photo being opened: its thumbnail, shown at Fit over the old photo
   * until the new one's first picture is in, so the app never shows the
   * photo you left while the next one loads.
   */
  cover?: string | null
  /** The first full picture of a newly opened photo is on show. */
  onFresh?: () => void
  /**
   * The whole print, rendered at about the screen's size, once things
   * settle after a change: the app keeps it to show at once when this photo
   * is opened again. `forLayer` is the look it shows.
   */
  onWhole?: (picture: HTMLCanvasElement, forLayer: PreviewLayer) => void
  /**
   * Nothing new is asked for: the look is not ready yet (its grain is still
   * being made). A render then would show the wrong grain, and keep the
   * worker from the right one.
   */
  hold?: boolean
  /** A change is on its way that the edit does not show yet (a recipe's grain being made): the picture is updating. */
  busy?: boolean
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function PreviewCanvas({
  cover = null,
  onFresh,
  onWhole,
  hold = false,
  busy = false,
  base,
  baseSize,
  imageSeed,
  layer,
  compare,
  prefetch,
  loupe,
  compareLabel,
  wipe,
  onWipeChange,
  zoom,
  fitAsked = 0,
  onZoomChange,
  onOpen,
  onTrySample,
  bypass,
  layoutVersion,
  onError,
  leakEditor,
  bandEditor,
  guideEditor,
  collageEditor,
  toneHighlight,
  onPlaceGuide,
  streakEditor,
  maskEditor,
  shapeMaskEditor,
  cropEditor = null,
  repeatEditor = null,
  kaleidoEditor = null,
  colourLineEditor = null,
  streakGuideEditor = null,
  lightEditor = null,
  maskBrush = null,
  maskTint = null,
  leakShapeEditor,
  picker,
  onPlaceSpot,
  onFinishDraft,
  small = false,
  igSim = false,
  exportQuality = null,
  exportSizing = null,
  photoCrop = null,
  turnBy = 0,
  sampling = false,
  samplingFrom = 'edited',
  onSamplingFrom,
  onSample,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The loupe: where the pointer is over the photo, and its own canvas.
  const loupeRef = useRef<HTMLCanvasElement>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const lastPointer = useRef<{ x: number; y: number } | null>(null)
  // Pressed with the pointer already over the photo: start where it is.
  useEffect(() => {
    if (loupe) setPointer(lastPointer.current)
  }, [loupe])
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 })
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const clickRef = useRef<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; mode: 'pan' | 'wipe' | 'sample' | 'collage' | 'box' | 'brush'; moved?: boolean } | null>(
    null,
  )
  // Selecting a subject: a box being dragged round it, screen pixels.
  const [boxDraft, setBoxDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  // Painting a subject mask: the stroke so far, screen pixels.
  const [stroke, setStroke] = useState<{ x: number; y: number }[] | null>(null)
  const [brushAt, setBrushAt] = useState<{ x: number; y: number } | null>(null)
  // The stroke as it goes, and when it was last painted into the mask.
  const strokeRef = useRef<{ x: number; y: number }[]>([])
  const paintedAt = useRef(0)
  /** The photo whose first full picture was last reported (onFresh). */
  const freshFor = useRef<CanvasImageSource | null>(null)
  /**
   * The same, as state: until a photo's first picture with its edit is in,
   * what shows is a stand-in (the last picture, a preview kept on disk, or
   * the photo's thumbnail), and a moment later a note says it is loading.
   * Not while the look's shader is still building: that has a note of its own.
   */
  const [freshShown, setFreshShown] = useState<unknown>(null)
  const graphics = useSyncExternalStore(graphicsState.subscribe, graphicsState.get)
  // (The small view draws its own way, and shows its picture whole when it is in.)
  const loadingEdit = !small && !!base && !!layer && freshShown !== base && graphics.look === 'ready'
  const [showLoading, setShowLoading] = useState(false)
  useEffect(() => {
    if (!loadingEdit) {
      setShowLoading(false)
      return
    }
    const t = setTimeout(() => setShowLoading(true), 350)
    return () => clearTimeout(t)
  }, [loadingEdit])
  /**
   * The edit the picture on screen was made from. When it lags the edit (a
   * recipe or style chosen, a slow look still rendering), a moment later a
   * note says the picture is updating, so what is chosen and what shows
   * never seem to disagree.
   */
  const drawnParams = useRef<unknown>(null)
  const [updating, setUpdating] = useState(false)
  const waitingRef = useRef(false)
  waitingRef.current = hold || busy
  const drew = (params: unknown) => {
    drawnParams.current = params
    setUpdating(false)
  }
  const wanted = layer?.params
  // Whether a button is held anywhere (a slider dragged): the picture follows, a note would only flicker.
  const pressed = useRef(false)
  useEffect(() => {
    const down = () => (pressed.current = true)
    const up = () => (pressed.current = false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])
  // Held (a new grain being made) or busy, the picture is behind too.
  const waiting = hold || busy
  useEffect(() => {
    if (!wanted || loadingEdit || (!waiting && drawnParams.current === wanted)) return setUpdating(false)
    const t = setTimeout(() => (waitingRef.current || drawnParams.current !== wanted) && setUpdating(true), pressed.current ? UPDATING_DRAGGING_MS : UPDATING_AFTER_MS)
    return () => clearTimeout(t)
  }, [wanted, waiting, loadingEdit])
  const strokeOnPhoto = (pts: { x: number; y: number }[]) =>
    pts.map((p) => photoAt(p.x, p.y)).filter((p): p is [number, number] => !!p).map(([x, y]) => ({ x, y }))

  const dpr = Math.min(window.devicePixelRatio || 1, 2)

  // Renders run in a worker (engine/renderClient.ts): the page never waits
  // for one, and each picture is drawn when it arrives. The current look
  // renders on the main engine; a compared snapshot on an engine of its own,
  // so the two edits do not throw out each other's cached passes (glow,
  // shapes, collage) on every frame of the wipe.
  /** Each layer's render on its way, by the key it was asked for with. */
  const pending = useRef(new WeakMap<PreviewLayer, string>())
  /** Bumped when a render arrives, to draw it. */
  const [arrived, setArrived] = useState(0)
  /**
   * Each layer's last render, kept until the layer, the view or Show original
   * changes: moving the wipe, or anything else that does not change a
   * layer's pixels, only composites again.
   */
  // The last two, so a view toggled back (the filmstrip or a panel shown,
  // then hidden) is there at once.
  const rendered = useRef(new WeakMap<PreviewLayer, { key: string; canvas: HTMLCanvasElement }[]>())
  // The streaks' shader has finished building (renderClient's graphicsState):
  // what was drawn without them is drawn again.
  useEffect(() => {
    const again = () => {
      rendered.current = new WeakMap()
      setArrived((n) => n + 1)
    }
    window.addEventListener('grain:graphics-ready', again)
    return () => window.removeEventListener('grain:graphics-ready', again)
  }, [])

  /*
   * A panel or the filmstrip shown or hidden moves and resizes the view. The
   * photo stays where it is on screen, at the size it is, rather than
   * jumping to the new middle: `layoutShift` carries how far the view moved
   * to the frame effect below, and at Fit `fitHold` keeps the scale from
   * growing into the room a closed panel leaves. A panel opening over a
   * photo that would no longer fit still fits it again. Fit asked for, or a
   * new photo, lets go of both.
   */
  const fromLayout = useRef(false)
  const lastRect = useRef<{ left: number; top: number; width: number; height: number } | null>(null)
  const layoutShift = useRef<{ dx: number; dy: number; scale: number } | null>(null)
  const [fitHold, setFitHold] = useState<number | null>(null)
  const scaleNow = useRef(1)
  const fittingNow = useRef(false)
  const measure = useCallback(() => {
    const host = hostRef.current
    if (!host) return
    const r = host.getBoundingClientRect()
    const prev = lastRect.current
    lastRect.current = { left: r.left, top: r.top, width: r.width, height: r.height }
    if (fromLayout.current) {
      fromLayout.current = false
      if (prev && (prev.left !== r.left || prev.top !== r.top || prev.width !== r.width || prev.height !== r.height)) {
        layoutShift.current = { dx: r.left - prev.left, dy: r.top - prev.top, scale: scaleNow.current }
        if (fittingNow.current) {
          const at = scaleNow.current
          setFitHold((h) => Math.min(h ?? Infinity, at))
        }
      }
    }
    const next = {
      width: Math.max(1, Math.floor(r.width * dpr)),
      height: Math.max(1, Math.floor(r.height * dpr)),
    }
    setViewport((prev) => (prev.width === next.width && prev.height === next.height ? prev : next))
  }, [dpr])

  // Panel resizes arrive as a layoutVersion change; window resizes and any
  // other layout shift come from the listener and the observer.
  useLayoutEffect(() => {
    fromLayout.current = true
    measure()
    const ro = new ResizeObserver(measure)
    if (hostRef.current) ro.observe(hostRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [measure, layoutVersion])

  const printed = baseSize ? (layer ? printSizeOf(baseSize, layer.params) : baseSize) : null
  const fitScale = printed ? Math.min(viewport.width / printed.width, viewport.height / printed.height) : 1
  // A wheel or pinch zoom is kept here while it goes on, and handed to the
  // app once it stops: the app re-renders everything on a zoom change, which
  // every wheel step would otherwise wait for.
  const [liveZoom, setLiveZoom] = useState<Zoom | null>(null)
  const zoomCommit = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    // The app's own zoom (a button, a shortcut, or this one handed on) wins.
    setLiveZoom(null)
    setFitHold(null)
  }, [zoom])
  useEffect(() => () => void (zoomCommit.current && clearTimeout(zoomCommit.current)), [])
  const shownZoom = liveZoom ?? zoom
  const scale = shownZoom === 'fit' ? (fitHold ? Math.min(fitHold, fitScale) : fitScale) : shownZoom
  scaleNow.current = scale
  fittingNow.current = shownZoom === 'fit'

  const viewAt = (at: number) => ({ width: viewport.width / at, height: viewport.height / at })
  /**
   * Every pan, from a drag, a zoom, a resize or a new photo, is held by one
   * rule (viewClamp.ts): past the photo's edges as far as you like, as long as
   * some of the photo stays in view. `pan` keeps where it was put, so a view
   * narrowed by a panel and widened again comes back to where it was; `view`
   * is where it is now.
   */
  const within = (p: Pan, at: number): Pan =>
    printed && viewport.width >= 2 && viewport.height >= 2 ? clampPan(p, printed, viewAt(at)) : p
  const view = within(pan, scale)

  /**
   * The region shown and the size it is drawn at. Everything is in print
   * coordinates, so a border shows in the preview and the fit view accounts
   * for the paper around the photo. `pan` is the region's top-left.
   */
  const geometry = useCallback((): { region: Rect; out: Size; shift: { x: number; y: number } } | null => {
    if (!printed || viewport.width < 2 || viewport.height < 2) return null
    const width = Math.min(viewport.width / scale, printed.width)
    const height = Math.min(viewport.height / scale, printed.height)
    const out = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
    // The region is derived from the rounded output so pixels stay square.
    const rw = out.width / scale
    const rh = out.height / scale
    const region = {
      x: clamp(view.x, 0, Math.max(0, printed.width - rw)),
      y: clamp(view.y, 0, Math.max(0, printed.height - rh)),
      width: rw,
      height: rh,
    }
    // Dragged past the photo's edge, the canvas moves off the middle by as
    // much, overlays and all: what is rendered stays the photo.
    const shift = {
      x: ((region.x - view.x) * scale - (viewport.width - out.width) / 2) / dpr,
      y: ((region.y - view.y) * scale - (viewport.height - out.height) / 2) / dpr,
    }
    return { region, out, shift }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [printed?.width, printed?.height, viewport, scale, view.x, view.y])

  /**
   * Turned on screen (turnBy, the crop being set), the photo at Fit is made
   * smaller till the whole of it fits the view turned: its corners stay in
   * sight to crop to.
   */
  const turnFit = (() => {
    if (!turnBy || shownZoom !== 'fit' || !baseSize || !layer || viewport.width < 2) return 1
    const f = photoFrameOf(baseSize, layer.params)
    const a = (turnBy * Math.PI) / 180
    const bw = Math.abs(f.width * Math.cos(a)) + Math.abs(f.height * Math.sin(a))
    const bh = Math.abs(f.width * Math.sin(a)) + Math.abs(f.height * Math.cos(a))
    return Math.min(1, viewport.width / scale / bw, viewport.height / scale / bh)
  })()

  // The picture takes its new size on screen in the same frame the layout
  // changes (a panel or the filmstrip shown): the last picture scaled to it
  // until the render for the new size lands, never left at its old size,
  // clipped and off-centre, for the frames before the next draw.
  useLayoutEffect(() => {
    const display = canvasRef.current
    const geo = geometry()
    if (!display || !geo || small) return
    display.style.width = `${geo.out.width / dpr}px`
    display.style.height = `${geo.out.height / dpr}px`
  }, [geometry, small, dpr])

  // A new image opens in the middle, fitted.
  useLayoutEffect(() => {
    setFitHold(null)
    if (!printed) return
    setPan(within(centredPan(printed, viewAt(scale)), scale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base])

  // Zoom changes that did not come with an anchor (buttons, shortcuts) keep
  // the middle of the view where it is. A new photo, or the view changing
  // size, is not a zoom: the photo's own centring (below and above) sees to
  // that, and working from the old scale here would push it off to one side.
  // Layout effects, so the new scale is never shown at the old pan.
  const lastScale = useRef(scale)
  const lastFrame = useRef('')
  const anchored = useRef(false)
  const frame = `${printed?.width}x${printed?.height}@${viewport.width}x${viewport.height}`
  useLayoutEffect(() => {
    const prev = lastScale.current
    lastScale.current = scale
    const sameFrame = lastFrame.current === frame
    lastFrame.current = frame
    if (anchored.current) {
      anchored.current = false
      return
    }
    if (prev === scale || !printed || !sameFrame) return
    setPan((p) => {
      const was = within(p, prev)
      const cx = was.x + viewport.width / prev / 2
      const cy = was.y + viewport.height / prev / 2
      return within({ x: cx - viewport.width / scale / 2, y: cy - viewport.height / scale / 2 }, scale)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scale, frame])

  // A border added, widened or narrowed moves the photo inside the print:
  // the view moves with it, so the photo stays where it is on screen and
  // the border grows out from its edges (at Fit the whole print is centred
  // and fitted anyway).
  const photoInPrint = baseSize && layer ? photoFrameOf(baseSize, layer.params) : null
  const lastPhotoAt = useRef<{ x: number; y: number; base: unknown } | null>(null)
  useLayoutEffect(() => {
    if (!photoInPrint) return
    const prev = lastPhotoAt.current
    lastPhotoAt.current = { x: photoInPrint.x, y: photoInPrint.y, base }
    if (!prev || prev.base !== base || shownZoom === 'fit') return
    const dx = photoInPrint.x - prev.x
    const dy = photoInPrint.y - prev.y
    if (dx || dy) setPan((p) => ({ x: p.x + dx, y: p.y + dy }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoInPrint?.x, photoInPrint?.y, base])

  // Fit, asked for (the button, a shortcut), brings the photo back to the
  // middle. After the zoom's own keep-the-middle step above, so it wins.
  useLayoutEffect(() => {
    if (!printed || !fitAsked) return
    setFitHold(null)
    setPan(within(centredPan(printed, viewAt(fitScale)), fitScale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitAsked])

  // At Fit, the view or the print changing size under it (a panel dragged,
  // a border added) puts the whole photo back in the middle. Zooming into
  // Fit does not: the photo stays where the zoom left it.
  const fitting = shownZoom === 'fit'
  const fitFrame = useRef(frame)
  useLayoutEffect(() => {
    const changed = fitFrame.current !== frame
    fitFrame.current = frame
    const shift = layoutShift.current
    layoutShift.current = null
    if (!changed || !printed) return
    // A panel shown or hidden, the photo at the same size: it stays put on screen.
    if (shift && Math.abs(scale - shift.scale) < 1e-9) {
      setPan((p) => {
        const was = within(p, scale)
        return within({ x: was.x + (shift.dx * dpr) / scale, y: was.y + (shift.dy * dpr) / scale }, scale)
      })
      return
    }
    if (!fitting) return
    setPan(within(centredPan(printed, viewAt(scale)), scale))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frame])

  /**
   * Zoom to `next`, keeping the print point under the cursor where it is. The
   * canvas is centred in the view while it is smaller than it, so the offset
   * of the canvas inside the view has to be accounted for on both sides.
   */
  const zoomAt = (next: Zoom, clientX: number, clientY: number, live = false) => {
    const host = hostRef.current
    const geo = geometry()
    if (!host || !geo || !printed) return
    const nextScale = next === 'fit' ? fitScale : next
    const r = host.getBoundingClientRect()
    const hx = (clientX - r.left) * dpr
    const hy = (clientY - r.top) * dpr
    // The print point under the cursor stays under it, unless that would
    // take the photo out of view (see within).
    const px = view.x + hx / scale
    const py = view.y + hy / scale
    if (nextScale !== scale) anchored.current = true
    // Reaching Fit this way keeps the point too; only the Fit button centres.
    setPan(within({ x: px - hx / nextScale, y: py - hy / nextScale }, nextScale))
    if (!live) {
      onZoomChange(next)
      return
    }
    setLiveZoom(next)
    if (zoomCommit.current) clearTimeout(zoomCommit.current)
    zoomCommit.current = setTimeout(() => {
      zoomCommit.current = null
      onZoomChange(next)
    }, DRAFT_IDLE_MS)
  }

  // Wheel zoom. Registered natively because React's wheel listener is
  // passive, and the page must not scroll while zooming.
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {})
  wheelRef.current = (e: WheelEvent) => {
    if (!base) return
    e.preventDefault()
    if (small) return
    // A pinch (WebKit's own gesture, below) is under way: its wheel echo is not a second zoom.
    if (pinch.current && e.ctrlKey) return
    // A trackpad's two-finger swipe moves the view, any way, whatever tool is
    // out (Settings: Two-finger scroll); a pinch (ctrl+wheel in Chromium) and a
    // mouse wheel zoom.
    if (!e.ctrlKey && trackpadScrollStore.get() === 'move' && fromTrackpad(e)) {
      setPan((p) => within({ x: within(p, scale).x + (e.deltaX * dpr) / scale, y: within(p, scale).y + (e.deltaY * dpr) / scale }, scale))
      return
    }
    // Over the selected collage piece, the wheel sizes its image instead.
    const onPiece = collagePieceAt(e.clientX, e.clientY)
    if (onPiece && collageEditor) {
      collageEditor.onZoom(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), onPiece[0], onPiece[1])
      return
    }
    const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018))
    const next = clamp(scale * factor, fitScale * MIN_ZOOM_OF_FIT, MAX_ZOOM)
    // Fit is a detent: crossing it on the way in or out stops there once.
    const crossed = (scale > fitScale * 1.001 && next < fitScale) || (scale < fitScale * 0.999 && next > fitScale)
    zoomAt(crossed || Math.abs(next - fitScale) < fitScale * 0.001 ? 'fit' : next, e.clientX, e.clientY, true)
  }
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const onWheel = (e: WheelEvent) => wheelRef.current(e)
    host.addEventListener('wheel', onWheel, { passive: false })
    // A pinch on a Mac's trackpad: WebKit tells it as a gesture with a scale
    // (not as a ctrl+wheel, as Chromium does), and would zoom the page itself.
    type Gesture = Event & { scale: number; clientX: number; clientY: number }
    const start = (e: Event) => {
      e.preventDefault()
      pinch.current = { scale: scaleNow.current }
    }
    const change = (e: Event) => {
      e.preventDefault()
      const g = e as Gesture
      if (pinch.current && typeof g.scale === 'number') pinchRef.current(pinch.current.scale * g.scale, g.clientX, g.clientY)
    }
    const end = (e: Event) => {
      e.preventDefault()
      pinch.current = null
    }
    host.addEventListener('gesturestart', start)
    host.addEventListener('gesturechange', change)
    host.addEventListener('gestureend', end)
    return () => {
      host.removeEventListener('wheel', onWheel)
      host.removeEventListener('gesturestart', start)
      host.removeEventListener('gesturechange', change)
      host.removeEventListener('gestureend', end)
    }
  }, [])
  const pinch = useRef<{ scale: number } | null>(null)
  const pinchRef = useRef((_to: number, _x: number, _y: number) => {})
  pinchRef.current = (to, x, y) => {
    if (!base || small) return
    const next = clamp(to, fitScale * MIN_ZOOM_OF_FIT, MAX_ZOOM)
    zoomAt(Math.abs(next - fitScale) < fitScale * 0.01 ? 'fit' : next, x, y, true)
  }

  /**
   * One layer rendered for a view, from the kept render when the layer, the
   * view and Show original are unchanged; otherwise asked for, and
   * 'pending' until it arrives (which draws again). The current layer
   * renders on the main engine, any other (a snapshot) on the compare engine.
   */
  /**
   * What is drawn in pixels (grain, dither, Pixel art's blocks) at the size
   * the export will have it: a smaller export (Web, Instagram) brings the
   * photo down to its own size and draws them in its pixels, so here, on the
   * whole photo, they are drawn as many photo pixels large as one of its
   * pixels covers. The Small view renders the export itself, as it is.
   */
  const exportPixels = (() => {
    if (!exportSizing || !baseSize || !layer) return 1
    const shrunk = exportPhotoSize(baseSize, activeBorder(layer.params), exportSizing)
    return shrunk && shrunk.width > 0 ? Math.max(1, baseSize.width / shrunk.width) : 1
  })()
  const asExported = (p: BlendParams): BlendParams => (exportPixels > 1.001 ? { ...p, pixelScale: (p.pixelScale ?? 1) * exportPixels } : p)
  const renderView = (
    l: PreviewLayer,
    geo: { region: Rect; out: Size },
    draft = 1,
  ): { canvas: HTMLCanvasElement | null; x: number; y: number; partial: boolean } | 'pending' | null => {
    if (!base || !baseSize || !layer) return null
    // The photo's offset inside a print, for lining up layers whose borders
    // differ: the view is set by the current layer, and a compared snapshot
    // with another border is shifted so the photo itself stays put.
    const photoOffset = (p: BlendParams) => Math.round(activeBorder(p).width * Math.min(baseSize.width, baseSize.height))
    const params = asExported(bypass ? originalOf(l.params) : l.params)
    const shift = photoOffset(params) - photoOffset(layer.params)
    const own = printSizeOf(baseSize, params)
    // The view region in this layer's print, clipped to its print: reading
    // outside it would smear the frame's edge pixels across the gap.
    const x0 = Math.max(0, geo.region.x + shift)
    const y0 = Math.max(0, geo.region.y + shift)
    const x1 = Math.min(own.width, geo.region.x + shift + geo.region.width)
    const y1 = Math.min(own.height, geo.region.y + shift + geo.region.height)
    const sx = geo.out.width / geo.region.width
    const sy = geo.out.height / geo.region.height
    const partial = x1 - x0 < geo.region.width - 0.5 || y1 - y0 < geo.region.height - 0.5
    if (x1 <= x0 || y1 <= y0) return { canvas: null, x: 0, y: 0, partial }
    const outW = Math.max(1, Math.round((x1 - x0) * sx))
    const outH = Math.max(1, Math.round((y1 - y0) * sy))
    // Zoomed out, a look with pixel-sized patterns (dither, ordered dots,
    // pixel art) is rendered at full size and shrunk with an averaging
    // filter, as the Small view and any image viewer do. Rendered straight at
    // screen size, the shader would sample the pattern at scattered points,
    // and the blocks would change size and shimmer with every zoom step.
    const full = { width: Math.round(x1 - x0), height: Math.round(y1 - y0) }
    const supersample =
      draft === 1 && hasPixelPattern(params) && full.width > outW * 1.01 && full.width * full.height <= MAX_SUPERSAMPLE_PX
    // Zoomed in past 100%, rendered at the print's own pixels and drawn
    // larger: what the export has there, at a fraction of the cost of every
    // screen pixel (a fifth of a millisecond against a third of a second,
    // zoomed far in on streaks). From 200% each print pixel is a sharp square.
    const crisp = sx > 1.001 && draft >= 1 / sx
    const px0 = Math.floor(x0)
    const py0 = Math.floor(y0)
    const own1 = { width: Math.ceil(x1) - px0, height: Math.ceil(y1) - py0 }
    const key = JSON.stringify([x0, y0, x1, y1, outW, outH, supersample, crisp, bypass, base.width, base.height, draft])
    const kept = rendered.current.get(l)?.find((r) => r.key === key)
    const at = { x: Math.round((x0 - shift - geo.region.x) * sx), y: Math.round((y0 - shift - geo.region.y) * sy) }
    if (kept) return { canvas: kept.canvas, ...at, partial }
    if (pending.current.get(l) !== key) {
      pending.current.set(l, key)
      const current = l === layer
      renderClient
        .render(current ? 'view' : 'compare', current ? 'main' : 'compare', {
          base,
          baseSize,
          grain: l.grain.source,
          grainSize: l.grain.size,
          grainMean: l.grain.mean,
          grainSd: l.grain.sd,
          params,
          imageSeed,
          ...(photoCrop ? { photoCrop } : {}),
          ...(l.showMask && !bypass ? { showMask: l.showMask } : {}),
          region: crisp ? { x: px0, y: py0, ...own1 } : { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
          outputSize: crisp
            ? own1
            : supersample
              ? full
              : { width: Math.max(1, Math.round(outW * draft)), height: Math.max(1, Math.round(outH * draft)) },
          draft: draft < 1,
        },
        // While the look's shader builds (seconds, the first time on
        // Windows), the photo as it is rather than an empty view.
        { provisional: current })
        .then((res) => {
          if (pending.current.get(l) === key) pending.current.delete(l)
          if (!res) return
          const src = supersample ? shrinkTo(res.bitmap, outW, outH) : res.bitmap
          const list = rendered.current.get(l) ?? []
          // The older of two is drawn over; never the newest, which may be on show.
          const canvas = list.length >= 2 ? list[1].canvas : document.createElement('canvas')
          canvas.width = outW
          canvas.height = outH
          const c2 = canvas.getContext('2d')!
          c2.imageSmoothingEnabled = true
          // A draft is drawn small and scaled up to the view.
          if (crisp) {
            c2.imageSmoothingEnabled = sx < 2
            c2.drawImage(src, (px0 - x0) * sx, (py0 - y0) * sy, own1.width * sx, own1.height * sy)
          } else if (draft < 1) c2.drawImage(src, 0, 0, outW, outH)
          else c2.drawImage(src, 0, 0)
          res.bitmap.close()
          rendered.current.set(l, [{ key, canvas }, ...list.filter((r) => r.canvas !== canvas)].slice(0, 2))
          // A stand-in is not the photo's first picture, nor how long a render takes.
          if (res.provisional) {
            setArrived((n) => n + 1)
            return
          }
          if (current && draft >= 1 && freshFor.current !== base) {
            freshFor.current = base
            setFreshShown(base)
            onFresh?.()
          }
          if (current) {
            // How long a render of this view took: a slow one makes the view
            // move its last picture while it moves. Only the current look's:
            // a snapshot's comes from another engine.
            renderCost.current = Math.max(renderCost.current, res.ms)
            // What a full render would cost now, from this one: a draft's
            // scaled up by its pixels. Look edits reuse the streaks and are
            // fast; streak and mask edits search again and are not, so this
            // follows each drag.
            fullCost.current = res.ms / (draft * draft)
          }
          setArrived((n) => n + 1)
        })
        .catch((err: Error) => {
          if (pending.current.get(l) === key) pending.current.delete(l)
          onError(err.message)
        })
    }
    return 'pending'
  }

  // The loupe: the photo round the pointer as the export will have it at
  // 100%, one of its pixels to one of the screen's (twice the view's zoom
  // when the view is that close already), so grain can be judged without
  // leaving Fit. A piece a few times the loupe's size is rendered round the
  // pointer and the loupe shows its own part of it at every move, so what is
  // in it is always what is under the pointer, past the photo's edge too;
  // a new piece is rendered when the pointer nears the edge of the last, or
  // the edit changes (the last piece shown till it lands).
  const LOUPE_CSS = 240
  const loupeZoom = scale >= 0.999 / exportPixels ? scale * 2 : 1 / exportPixels
  const loupeTile = useRef<{
    of: unknown[]
    zoom: number
    x: number
    y: number
    w: number
    h: number
    bitmap: ImageBitmap
  } | null>(null)
  const loupeBusy = useRef(false)
  const [loupeLanded, setLoupeLanded] = useState(0)
  useEffect(() => {
    if (loupe) return
    loupeTile.current?.bitmap.close()
    loupeTile.current = null
  }, [loupe])
  useLayoutEffect(() => {
    const c = loupeRef.current
    if (!loupe || !pointer || !c || !base || !baseSize || !layer || small) return
    const geo = geometry()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!geo || !rect || rect.width === 0) return
    const print = printSizeOf(baseSize, layer.params)
    const px = geo.region.x + ((pointer.x - rect.left) / rect.width) * geo.region.width
    const py = geo.region.y + ((pointer.y - rect.top) / rect.height) * geo.region.height
    const zoom = loupeZoom
    const side = Math.round(LOUPE_CSS * dpr)
    const span = side / zoom
    const wx = px - span / 2
    const wy = py - span / 2
    if (c.width !== side) {
      c.width = side
      c.height = side
    }
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#18191c'
    ctx.fillRect(0, 0, side, side)
    const of = [layer, base, bypass, imageSeed, photoCrop, exportPixels]
    const t = loupeTile.current
    if (t && t.zoom === zoom) {
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(t.bitmap, Math.round((t.x - wx) * zoom), Math.round((t.y - wy) * zoom))
    }
    // The part of the loupe that is photo, and whether the last piece covers it for this edit.
    const nx0 = Math.max(0, wx)
    const ny0 = Math.max(0, wy)
    const nx1 = Math.min(print.width, wx + span)
    const ny1 = Math.min(print.height, wy + span)
    const covered =
      !!t &&
      t.zoom === zoom &&
      t.of.every((v, i) => v === of[i]) &&
      (nx1 <= nx0 || ny1 <= ny0 || (nx0 >= t.x - 0.5 && ny0 >= t.y - 0.5 && nx1 <= t.x + t.w + 0.5 && ny1 <= t.y + t.h + 0.5))
    if (covered || loupeBusy.current) return
    // A piece two and a half loupes across round the pointer, kept inside the photo.
    const want = span * 2.5
    const w = Math.round(Math.min(want, print.width) * zoom) / zoom
    const h = Math.round(Math.min(want, print.height) * zoom) / zoom
    const x = clamp(px - w / 2, 0, Math.max(0, print.width - w))
    const y = clamp(py - h / 2, 0, Math.max(0, print.height - h))
    loupeBusy.current = true
    renderClient
      .render('loupe', 'main', {
        base,
        baseSize,
        grain: layer.grain.source,
        grainSize: layer.grain.size,
        grainMean: layer.grain.mean,
        grainSd: layer.grain.sd,
        params: asExported(bypass ? originalOf(layer.params) : layer.params),
        imageSeed,
        ...(photoCrop ? { photoCrop } : {}),
        ...(layer.showMask && !bypass ? { showMask: layer.showMask } : {}),
        region: { x, y, width: w, height: h },
        outputSize: { width: Math.max(1, Math.round(w * zoom)), height: Math.max(1, Math.round(h * zoom)) },
      })
      .then((res) => {
        loupeBusy.current = false
        if (!res) return
        loupeTile.current?.bitmap.close()
        loupeTile.current = { of, zoom, x, y, w, h, bitmap: res.bitmap }
        setLoupeLanded((n) => n + 1)
      })
      .catch((err: Error) => {
        loupeBusy.current = false
        onError(err.message)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loupe, pointer, layer, base, baseSize, geometry, loupeZoom, dpr, bypass, small, imageSeed, photoCrop, exportPixels, loupeLanded])

  // Snapshots rendered ahead for this view, one at a time while nothing else
  // is happening, so pointing at one in the strip shows it at once.
  useEffect(() => {
    if (!prefetch?.length || small || !base || !layer) return
    let timer: ReturnType<typeof setTimeout>
    let i = 0
    const next = () => {
      const geo = geometry()
      if (!geo || i >= prefetch.length) return
      // One at a time: each waits for the one before, rather than replacing it.
      if (!renderClient.busy('compare')) renderView(prefetch[i++], geo)
      timer = setTimeout(next, 120)
    }
    // After the view itself has been drawn and things have settled.
    timer = setTimeout(next, 400)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefetch, layer, geometry, bypass, small, base])

  // While the view is zoomed or panned, a slow look (streaks, say) is not
  // rendered at all: the last finished picture is moved and scaled with the
  // view, over a small render of the whole print for what it did not cover,
  // and the full render follows once the view has been still for
  // DRAFT_IDLE_MS. Every wheel step would otherwise wait for a render.
  const viewMovedAt = useRef(0)
  const renderCost = useRef(0)
  // What a full render costs, from the last render, and whether a pointer is
  // down (dragging a slider or a handle): drafts while it is, if slow.
  const fullCost = useRef(0)
  const pointerHeld = useRef(false)
  const drewDraft = useRef(false)
  useEffect(() => {
    const down = () => {
      pointerHeld.current = true
    }
    const up = () => {
      pointerHeld.current = false
      if (drewDraft.current) setRefine((n) => n + 1)
    }
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('blur', up)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('blur', up)
    }
  }, [])
  const [refine, setRefine] = useState(0)
  const lastGeometry = useRef(geometry)
  if (lastGeometry.current !== geometry) {
    lastGeometry.current = geometry
    viewMovedAt.current = performance.now()
  }
  const lastLayer = useRef(layer)
  if (lastLayer.current !== layer) {
    // An edit, not a move: shown in full at once, as before. Its cost is
    // measured afresh, but streaks and collage are known to be slow.
    lastLayer.current = layer
    viewMovedAt.current = 0
    const fx = layer?.params.effects
    renderCost.current =
      fx && ((fx.streaks.enabled && fx.streaks.shapes.length > 0) || (fx.collage.enabled && fx.collage.pieces.length > 0))
        ? MOVE_ABOVE_MS + 1
        : 0
  }
  /**
   * The last finished picture on the display, and what it showed: the
   * region of its print, and where the photo was in that print (`photo`),
   * so that while a new border renders it is drawn with the photo where the
   * photo is now, not jumping by the border's change until the render lands.
   */
  const shown = useRef<{ canvas: HTMLCanvasElement; region: Rect; what: unknown[]; photo: { x: number; y: number } } | null>(null)
  /** The whole print, small, for what the last picture does not cover while the view moves. */
  const backdrop = useRef<{ canvas: HTMLCanvasElement; print: Size; what: unknown[]; base: unknown; bypass: boolean; photo: { x: number; y: number } } | null>(null)
  const sameAs = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((v, i) => v === b[i])

  useEffect(() => {
    const display = canvasRef.current
    const geo = geometry()
    if (!display || !base || !baseSize || !layer || !geo || small || hold) return
    const what = [layer, compare, wipe, bypass, base]
    const moving =
      performance.now() - viewMovedAt.current < DRAFT_IDLE_MS &&
      renderCost.current > MOVE_ABOVE_MS &&
      !!shown.current &&
      sameAs(shown.current.what, what)
    let refineTimer: ReturnType<typeof setTimeout> | undefined
    let backdropTimer: ReturnType<typeof setTimeout> | undefined

    const raf = requestAnimationFrame(() => {
      const ctx = display.getContext('2d')
      if (!ctx) return
      if (display.width !== geo.out.width || display.height !== geo.out.height) {
        display.width = geo.out.width
        display.height = geo.out.height
      }
      display.style.width = `${geo.out.width / dpr}px`
      display.style.height = `${geo.out.height / dpr}px`
      const sx = geo.out.width / geo.region.width
      const sy = geo.out.height / geo.region.height
      const photoNow = photoFrameOf(baseSize, layer.params)
      // The last finished picture, moved and scaled to this view, over the
      // whole print small for what it does not cover. Each lined up by the
      // photo in it: a border changed since moves the photo in the print.
      const drawMoved = (last: NonNullable<typeof shown.current>) => {
        ctx.fillStyle = '#18191c'
        ctx.fillRect(0, 0, geo.out.width, geo.out.height)
        ctx.imageSmoothingEnabled = true
        // The newest whole print made for this photo, even one from an edit
        // or two ago: a near likeness beats bars of background.
        const bd = backdrop.current
        if (bd && bd.base === base && bd.bypass === bypass)
          ctx.drawImage(
            bd.canvas,
            (photoNow.x - bd.photo.x - geo.region.x) * sx,
            (photoNow.y - bd.photo.y - geo.region.y) * sy,
            bd.print.width * sx,
            bd.print.height * sy,
          )
        ctx.drawImage(
          last.canvas,
          (last.region.x + photoNow.x - last.photo.x - geo.region.x) * sx,
          (last.region.y + photoNow.y - last.photo.y - geo.region.y) * sy,
          last.region.width * sx,
          last.region.height * sy,
        )
      }

      if (moving && shown.current) {
        drawMoved(shown.current)
        // And the full render of this view over it once it lands, while the
        // view keeps moving. Never a smaller one: at fewer pixels the grain,
        // dots and streak colours are not the same, and the look flickered
        // between the two as the view moved.
        if (!compare) {
          const piece = renderView(layer, geo, 1)
          if (piece && piece !== 'pending' && piece.canvas) {
            ctx.drawImage(piece.canvas, piece.x, piece.y)
            // The newest picture is the one moved from now on.
            const keep = shown.current.canvas
            keep.width = display.width
            keep.height = display.height
            keep.getContext('2d')!.drawImage(display, 0, 0)
            shown.current = { canvas: keep, region: { ...geo.region }, what, photo: { x: photoNow.x, y: photoNow.y } }
            drew(layer.params)
          }
        }
        refineTimer = setTimeout(() => setRefine((n) => n + 1), DRAFT_IDLE_MS)
        return
      }

      // Dragging something on a slow look: a draft now, the full render on release.
      const draft =
        pointerHeld.current && fullCost.current > DRAFT_ABOVE_MS
          ? clamp(Math.sqrt(DRAFT_TARGET_MS / fullCost.current), 0.5, 1)
          : 1
      drewDraft.current = draft < 1
      // Every layer's picture, or the ones not here yet asked for: until they
      // are, the last picture stays up (moved to this view if it changed),
      // and their arrival draws again.
      // The same render moving or still: a quicker one first would look different.
      const pieces = new Map<PreviewLayer, ReturnType<typeof renderView>>()
      for (const l of compare ? [layer, compare] : [layer]) pieces.set(l, renderView(l, geo, draft))
      if ([...pieces.values()].includes('pending')) {
        const last = shown.current
        if (
          last &&
          (last.canvas.width !== display.width ||
            last.canvas.height !== display.height ||
            !sameAs(Object.values(last.region), Object.values(geo.region)) ||
            last.photo.x !== photoNow.x ||
            last.photo.y !== photoNow.y)
        )
          drawMoved(last)
        return
      }
      const draw = (l: PreviewLayer, clipTo?: number) => {
        const piece = pieces.get(l)
        if (!piece || piece === 'pending') return
        ctx.save()
        if (clipTo !== undefined) {
          ctx.beginPath()
          ctx.rect(0, 0, clipTo, geo.out.height)
          ctx.clip()
        }
        if (piece.partial) {
          ctx.fillStyle = '#18191c'
          ctx.fillRect(0, 0, geo.out.width, geo.out.height)
        }
        if (piece.canvas) ctx.drawImage(piece.canvas, piece.x, piece.y)
        ctx.restore()
      }

      try {
        draw(layer)
        if (compare) {
          const split = Math.round(geo.out.width * clamp(wipe, 0, 1))
          draw(compare, split)
          ctx.fillStyle = 'rgba(255,255,255,0.85)'
          ctx.fillRect(split - Math.round(dpr / 2), 0, Math.max(1, Math.round(dpr)), geo.out.height)
        }
      } catch (err) {
        onError((err as Error).message)
        return
      }
      // Kept for moving: a copy of what is on the display now.
      const keep = shown.current?.canvas ?? document.createElement('canvas')
      keep.width = display.width
      keep.height = display.height
      keep.getContext('2d')!.drawImage(display, 0, 0)
      shown.current = { canvas: keep, region: { ...geo.region }, what, photo: { x: photoNow.x, y: photoNow.y } }
      drew(layer.params)
      // And, once things settle, the whole print small, for the next move.
      const bdWhat = [layer, bypass, base]
      // Every look gets one, so zooming out never shows bars while the
      // new view renders; at about the screen's size, so it is not soft.
      if (draft === 1 && !(backdrop.current && sameAs(backdrop.current.what, bdWhat)))
        backdropTimer = setTimeout(() => {
          const print = printSizeOf(baseSize, layer.params)
          const side = Math.min(BACKDROP_MAX, Math.max(BACKDROP_SIDE, viewport.width, viewport.height))
          const k = Math.min(1, side / Math.max(print.width, print.height))
          try {
            void renderClient
              .render('backdrop', 'main', {
                base,
                baseSize,
                grain: layer.grain.source,
                grainSize: layer.grain.size,
                grainMean: layer.grain.mean,
                grainSd: layer.grain.sd,
                params: asExported(bypass ? originalOf(layer.params) : layer.params),
                imageSeed,
                ...(photoCrop ? { photoCrop } : {}),
                outputSize: { width: Math.max(1, Math.round(print.width * k)), height: Math.max(1, Math.round(print.height * k)) },
              })
              .then((res) => {
                if (!res) return
                const canvas = backdrop.current?.canvas ?? document.createElement('canvas')
                canvas.width = res.bitmap.width
                canvas.height = res.bitmap.height
                canvas.getContext('2d')!.drawImage(res.bitmap, 0, 0)
                res.bitmap.close()
                backdrop.current = { canvas, print, what: bdWhat, base, bypass, photo: { x: photoNow.x, y: photoNow.y } }
                if (!bypass) onWhole?.(canvas, layer)
              })
              .catch(() => undefined)
          } catch {
            /* the move shows background where the last picture does not reach */
          }
        }, BACKDROP_AFTER_MS)
    })
    return () => {
      cancelAnimationFrame(raf)
      if (refineTimer) clearTimeout(refineTimer)
      if (backdropTimer) clearTimeout(backdropTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, baseSize, layer, compare, wipe, geometry, bypass, dpr, onError, small, refine, arrived, hold, exportPixels])

  // Small view: the full-resolution render resampled with a high-quality
  // filter, the way a phone or a feed downsizes the export, then shown small.
  // Debounced, since it renders the whole print.
  const smallRef = useRef<HTMLCanvasElement>(null)
  // The downsized renders, kept so moving the wipe only recomposites them.
  const smallImages = useRef<{ current: ImageBitmap | null; compare: ImageBitmap | null }>({
    current: null,
    compare: null,
  })
  const smallWipe = useRef(false)
  // Print size and photo offset of the cached small renders, for lining them up.
  const smallPrint = useRef<{ print: Size; photo: Size; offset: number } | null>(null)
  const smallComparePrint = useRef<{ print: Size; photo: Size; offset: number } | null>(null)

  const drawSmall = useCallback(() => {
    const display = smallRef.current
    const { current, compare: other } = smallImages.current
    if (!display || !current) return
    const ctx = display.getContext('2d')
    if (!ctx) return
    // Draw at exactly the device pixels the canvas occupies, shrinking with an
    // averaging filter (repeated halving, then one high-quality step) the way
    // an image viewer does. Leaving the last shrink to the browser's
    // compositor kept single-pixel stipple crisper than any viewer shows it.
    // Before layout the canvas has no width yet; fall back to the image's.
    if (display.clientWidth > 0) display.style.height = `${(display.clientWidth * current.height) / current.width}px`
    const targetW = display.clientWidth > 0 ? Math.round(display.clientWidth * dpr) : current.width
    const targetH = Math.max(1, Math.round((targetW * current.height) / current.width))
    const shrink = (img: CanvasImageSource & { width: number; height: number }) => {
      let src: CanvasImageSource & { width: number; height: number } = img
      while (src.width / 2 >= targetW) {
        const half = document.createElement('canvas')
        half.width = Math.round(src.width / 2)
        half.height = Math.round(src.height / 2)
        const h = half.getContext('2d')!
        h.imageSmoothingQuality = 'high'
        h.drawImage(src, 0, 0, half.width, half.height)
        src = half
      }
      return src
    }
    if (display.width !== targetW || display.height !== targetH) {
      display.width = targetW
      display.height = targetH
    }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(shrink(current), 0, 0, targetW, targetH)
    if (other) {
      // Same convention as the main view: the snapshot to the left of the wipe.
      const split = Math.round(targetW * clamp(wipe, 0, 1))
      ctx.save()
      ctx.beginPath()
      ctx.rect(0, 0, split, targetH)
      ctx.clip()
      // A snapshot with a different border has a different print size: draw
      // it so its photo matches this one's on screen, not stretched to fit.
      // Line the snapshot up by its photo, not its print: with a different
      // border — or the Instagram size, where every print is 1080 wide and the
      // photo shrinks to make room — the two photos sit at different places
      // and sizes inside prints of the same size.
      const cur = smallPrint.current
      const oth = smallComparePrint.current
      if (cur && oth) {
        const k = targetW / cur.print.width
        const s = cur.photo.width / oth.photo.width
        ctx.fillStyle = '#18191c'
        ctx.fillRect(0, 0, split, targetH)
        ctx.drawImage(
          shrink(other),
          (cur.offset - oth.offset * s) * k,
          (cur.offset - oth.offset * s) * k,
          oth.print.width * s * k,
          oth.print.height * s * k,
        )
      } else {
        ctx.drawImage(shrink(other), 0, 0, targetW, targetH)
      }
      ctx.restore()
      ctx.fillStyle = 'rgba(255,255,255,0.85)'
      ctx.fillRect(split - Math.round(dpr / 2), 0, Math.max(1, Math.round(dpr)), targetH)
    }
  }, [wipe, dpr])

  useEffect(() => {
    if (!small) return
    if (!base || !baseSize || !layer) return
    let cancelled = false
    const encode = async (src: CanvasImageSource & { width: number; height: number }, codec: { format: 'jpeg' | 'webp'; quality: number }) => {
      const c = document.createElement('canvas')
      c.width = src.width
      c.height = src.height
      const ctx = c.getContext('2d')!
      ctx.drawImage(src, 0, 0)
      // WebP through the export's own encoder (the canvas can't make one in Safari).
      const blob =
        codec.format === 'webp'
          ? new Blob([await encodeWebp(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, codec.quality)], { type: 'image/webp' })
          : await new Promise<Blob>((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode failed'))), 'image/jpeg', codec.quality))
      return createImageBitmap(blob)
    }
    const downsize = async (l: PreviewLayer): Promise<ImageBitmap | null> => {
      // Cropped or resized for the export, the photo is prepared before the
      // edit exactly as the export does it, so the grain is never resampled.
      const crop = exportSizing ? exportCrop(baseSize, activeBorder(l.params), exportSizing) : null
      const igBase = exportSizing ? await prepareForExport(base as ImageBitmap, activeBorder(l.params), exportSizing) : null
      const res = await renderClient.render(l === layer ? 'small' : 'small-compare', l === layer ? 'main' : 'compare', {
        base: igBase ?? base,
        baseSize: igBase ? { width: igBase.width, height: igBase.height } : baseSize,
        grain: l.grain.source,
        grainSize: l.grain.size,
        grainMean: l.grain.mean,
        grainSd: l.grain.sd,
        ...(igBase && crop
          ? { photoCrop: photoCrop ? composeCrop(photoCrop, cropFraction(baseSize, crop)) : cropFraction(baseSize, crop) }
          : photoCrop
            ? { photoCrop }
            : {}),
        // On a crop, shapes are moved onto it, as the export does.
        params:
          igBase && crop
            ? shapesOnCrop(bypass ? originalOf(l.params) : l.params, baseSize, crop)
            : bypass ? originalOf(l.params) : l.params,
        imageSeed,
      })
      if (igBase) renderClient.release(igBase)
      if (!res) {
        igBase?.close()
        return null
      }
      const rendered = res.bitmap
      const outW = Math.min(SMALL_WIDTH, rendered.width)
      const outH = Math.round((rendered.height * outW) / rendered.width)
      // Snapshot the engine's canvas now, before anything renders into it again.
      // Then encode it the way the export will: below quality 1 the browser's
      // JPEG keeps colour at half resolution, which takes most colour grain
      // with it, and the small view must not show texture the file won't have.
      const exported = exportQuality !== null ? await encode(rendered, exportQuality) : rendered
      if (exported !== rendered) rendered.close()
      igBase?.close()
      const bitmap = await createImageBitmap(exported, {
        resizeWidth: outW,
        resizeHeight: outH,
        resizeQuality: 'high',
      })
      exported.close()
      if (!igSim) return bitmap
      // Instagram re-encodes uploads as JPEG at roughly this quality, which
      // smears fine grain and keeps large structure like banding: show that.
      const c = document.createElement('canvas')
      c.width = outW
      c.height = outH
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
      bitmap.close()
      const blob = await new Promise<Blob>((r, j) =>
        c.toBlob((b) => (b ? r(b) : j(new Error('encode failed'))), 'image/jpeg', IG_QUALITY),
      )
      return createImageBitmap(blob)
    }
    const timer = setTimeout(async () => {
      try {
        const current = await downsize(layer)
        const other = compare ? await downsize(compare) : null
        // Replaced by a newer one on its way.
        if (!current || (compare && !other)) {
          current?.close()
          other?.close()
          return
        }
        const geoOf = (l: PreviewLayer) => {
          const p = bypass ? originalOf(l.params) : l.params
          const photo = (exportSizing && exportPhotoSize(baseSize, activeBorder(p), exportSizing)) || baseSize
          return {
            print: printSizeOf(photo, p),
            photo,
            offset: Math.round(activeBorder(p).width * Math.min(photo.width, photo.height)),
          }
        }
        smallPrint.current = geoOf(layer)
        smallComparePrint.current = compare ? geoOf(compare) : null
        if (cancelled) {
          current.close()
          other?.close()
          return
        }
        smallImages.current.current?.close()
        smallImages.current.compare?.close()
        smallImages.current = { current, compare: other }
        drawSmall()
        drew(layer.params)
      } catch (err) {
        onError((err as Error).message)
      }
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
    // drawSmall is left out on purpose: a wipe move must not re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [small, base, baseSize, layer, compare, bypass, onError, igSim, exportQuality, exportSizing, photoCrop])

  // Moving the wipe, or the window changing size, only recomposites.
  useEffect(() => {
    if (small) drawSmall()
  }, [small, drawSmall, viewport])

  // The border is added around the photo, not fitted inside the same box: the
  // photo keeps its phone-like size and the paper grows the frame outward, as
  // it does to the exported print.
  const SMALL_PHOTO_CSS = 400
  const smallStyle = (() => {
    if (!baseSize || !printed || !layer) return undefined
    const availW = viewport.width / dpr - 32
    const availH = viewport.height / dpr - 32
    // Scale is set by the uncropped print, so switching to the Instagram crop
    // only trims the edges instead of zooming the picture to refill the box.
    const photoW = Math.max(
      40,
      Math.min(SMALL_PHOTO_CSS, (availW * baseSize.width) / printed.width, (availH * baseSize.width) / printed.height),
    )
    const cssPerPx = photoW / baseSize.width
    // Only the width is set here; the height follows the image actually
    // drawn (drawSmall), so the box never takes a new shape before the new
    // render has arrived to fill it.
    const photo = exportSizing && exportPhotoSize(baseSize, activeBorder(layer.params), exportSizing)
    if (!photo) return { width: `${printed.width * cssPerPx}px` }
    // The export's photo is a crop of the original, resized: the part of the
    // original it shows keeps the original's on-screen scale.
    const print = printSizeOf(photo, layer.params)
    const cropW = exportCrop(baseSize, activeBorder(layer.params), exportSizing!).width
    const photoCss = cropW * cssPerPx
    const w = (photoCss * print.width) / photo.width
    return { width: `${w}px` }
  })()

  const smallWipeFrom = (clientX: number) => {
    const rect = smallRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    onWipeChange(clamp((clientX - rect.left) / rect.width, 0, 1))
  }

  const wipeFromEvent = (clientX: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    onWipeChange(clamp((clientX - rect.left) / rect.width, 0, 1))
  }

  /** A screen point as fractions of the photo itself (not the print). */
  const photoAt = (clientX: number, clientY: number): [number, number] | null => {
    const f = fracAt(clientX, clientY)
    if (!f || !baseSize || !layer) return null
    const p = printSizeOf(baseSize, layer.params)
    const frame = photoFrameOf(baseSize, layer.params)
    // Where it is on the photo: the lens shows it bent (lensView.ts).
    const q = toScene({ x: f[0] * p.width, y: f[1] * p.height })
    return [(q.x - frame.x) / frame.width, (q.y - frame.y) / frame.height]
  }
  /** The point, in photo fractions, if it is on the selected collage piece. */
  /** The last click on the photo while making a collage: when, where, and which piece was selected before it. */
  const lastCollageClick = useRef<{ t: number; x: number; y: number; selected: number | null } | null>(null)
  const collagePieceAt = (clientX: number, clientY: number): [number, number] | null => {
    const ed = collageEditor
    if (!ed || ed.selected === null || ed.armed) return null
    const piece = ed.collage.pieces[ed.selected]
    const at = photoAt(clientX, clientY)
    const maps = piece ? pieceMaps(ed.seed, piece) : null
    return at && maps && pieceContains(maps, at[0], at[1]) ? at : null
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    clickRef.current = { x: e.clientX, y: e.clientY }
    if (sampling && onSample) {
      // Hold to preview: the colour under the pointer is applied live while
      // the button is down; releasing keeps it.
      dragRef.current = { x: e.clientX, y: e.clientY, panX: 0, panY: 0, mode: 'sample' }
      const f = fracAt(e.clientX, e.clientY)
      if (f) onSample(f[0], f[1], 'preview')
      capturePointer(e.target, e.pointerId)
      return
    }
    // Painting a mask: the drag is the stroke.
    if (maskBrush) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: 0, panY: 0, mode: 'brush' }
      strokeRef.current = [{ x: e.clientX, y: e.clientY }]
      setStroke(strokeRef.current)
      paintedAt.current = performance.now()
      const pts = strokeOnPhoto(strokeRef.current)
      if (pts.length) maskBrush.onPaint?.(pts)
      capturePointer(e.target, e.pointerId)
      return
    }
    // Selecting a subject: a drag is a box round it, a click a point (on pointer up).
    if (picker) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: 0, panY: 0, mode: 'box' }
      capturePointer(e.target, e.pointerId)
      return
    }
    if (compare && !sampling) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: 0, panY: 0, mode: 'wipe' }
      wipeFromEvent(e.clientX)
      capturePointer(e.target, e.pointerId)
      return
    }
    // Dragging the selected collage piece moves its image.
    if (collageEditor && collagePieceAt(e.clientX, e.clientY)) {
      dragRef.current = { x: e.clientX, y: e.clientY, panX: 0, panY: 0, mode: 'collage' }
      capturePointer(e.target, e.pointerId)
      return
    }
    startPan(e)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (maskBrush) setBrushAt({ x: e.clientX, y: e.clientY })
    const d = dragRef.current
    if (!d) return
    if (d.mode === 'brush') {
      strokeRef.current = [...strokeRef.current, { x: e.clientX, y: e.clientY }]
      setStroke(strokeRef.current)
      // Into the mask as it goes, a few times a second: the effect follows the brush.
      const now = performance.now()
      if (maskBrush?.onPaint && now - paintedAt.current > 70) {
        paintedAt.current = now
        const pts = strokeOnPhoto(strokeRef.current)
        if (pts.length) maskBrush.onPaint(pts)
      }
      return
    }
    if (d.mode === 'box') {
      if (d.moved || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) {
        d.moved = true
        setBoxDraft({ x0: d.x, y0: d.y, x1: e.clientX, y1: e.clientY })
      }
      return
    }
    if (d.mode === 'sample') {
      const f = fracAt(e.clientX, e.clientY)
      if (f) onSample?.(f[0], f[1], 'preview')
      return
    }
    if (d.mode === 'wipe') {
      wipeFromEvent(e.clientX)
      return
    }
    if (d.mode === 'collage') {
      if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return
      const a = photoAt(d.x, d.y)
      const b = photoAt(e.clientX, e.clientY)
      d.moved = true
      d.x = e.clientX
      d.y = e.clientY
      if (a && b) collageEditor?.onMove(b[0] - a[0], b[1] - a[1], false)
      return
    }
    if (!printed) return
    setPan(within({ x: d.panX - ((e.clientX - d.x) * dpr) / scale, y: d.panY - ((e.clientY - d.y) * dpr) / scale }, scale))
  }

  // The middle button always moves the view, over anything on the photo (an
  // editor's points, a mask being painted), like a hand tool held ready: it
  // is caught before anything under it sees it.
  const middle = useRef<{ x: number; y: number; panX: number; panY: number; button: number } | null>(null)
  /**
   * Space held over the photo: the hand, as Photoshop's. A drag moves the
   * view, as the middle button's does, whatever tool is out; let go of Space
   * and the tool carries on where it was. Not while typing in a field.
   */
  const [hand, setHand] = useState(false)
  const handNow = useRef(false)
  handNow.current = hand
  const [handDragging, setHandDragging] = useState(false)
  const pointerOver = useRef(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || inTextField(e.target)) return
      if (!pointerOver.current && !handNow.current) return
      // Kept from the page, a focused button and every other key handler.
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      // At once, not at the next render: a click straight after is the hand's.
      handNow.current = true
      setHand(true)
    }
    const up = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !handNow.current) return
      e.preventDefault()
      e.stopPropagation()
      handNow.current = false
      setHand(false)
    }
    const away = () => {
      handNow.current = false
      setHand(false)
    }
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', away)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', away)
    }
  }, [])
  const panBy = useRef((_d: { x: number; y: number; panX: number; panY: number }, _e: PointerEvent) => {})
  panBy.current = (d, ev) => setPan(within({ x: d.panX - ((ev.clientX - d.x) * dpr) / scale, y: d.panY - ((ev.clientY - d.y) * dpr) / scale }, scale))
  const onMiddleDown = (e: React.PointerEvent) => {
    // The middle button, or any click with Space held (the hand).
    if (e.button !== 1 && !(e.button === 0 && handNow.current)) return
    e.preventDefault()
    e.stopPropagation()
    if (!base || small || middle.current) return
    middle.current = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y, button: e.button }
    setHandDragging(e.button === 0)
    const move = (ev: PointerEvent) => {
      if (!middle.current) return
      ev.stopPropagation()
      panBy.current(middle.current, ev)
    }
    const up = (ev: PointerEvent) => {
      if (ev.type === 'pointerup' && ev.button !== middle.current?.button) return
      // The click that ends a hand drag is the hand's, not the tool's under it (a point added there, say).
      if (ev.button === 0) {
        ev.stopPropagation()
        const eat = (c: MouseEvent) => {
          c.stopPropagation()
          c.preventDefault()
        }
        window.addEventListener('click', eat, { capture: true, once: true })
        setTimeout(() => window.removeEventListener('click', eat, true), 0)
      }
      middle.current = null
      setHandDragging(false)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
  }

  /** A drag that moves the view, at any zoom and past the photo's edges, never off it. */
  const startPan = (e: React.PointerEvent) => {
    dragRef.current = { x: e.clientX, y: e.clientY, panX: view.x, panY: view.y, mode: 'pan' }
    capturePointer(e.target, e.pointerId)
  }

  /** A screen point as fractions of the print, or null off the photo canvas. */
  const fracAt = (clientX: number, clientY: number): [number, number] | null => {
    const geo = geometry()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!geo || !rect || !baseSize || !layer || rect.width === 0) return null
    const p = printSizeOf(baseSize, layer.params)
    const px = geo.region.x + ((clientX - rect.left) / rect.width) * geo.region.width
    const py = geo.region.y + ((clientY - rect.top) / rect.height) * geo.region.height
    return [px / p.width, py / p.height]
  }

  const onPointerUp = (e: React.PointerEvent) => {
    if (dragRef.current?.mode === 'sample') {
      dragRef.current = null
      clickRef.current = null
      const f = fracAt(e.clientX, e.clientY)
      if (f) onSample?.(f[0], f[1], 'commit')
      return
    }
    if (dragRef.current?.mode === 'brush') {
      dragRef.current = null
      clickRef.current = null
      const pts = strokeOnPhoto([...strokeRef.current, { x: e.clientX, y: e.clientY }])
      strokeRef.current = []
      setStroke(null)
      if (pts.length && maskBrush) maskBrush.onStroke(pts)
      return
    }
    if (dragRef.current?.mode === 'box' && dragRef.current.moved) {
      const d = dragRef.current
      dragRef.current = null
      clickRef.current = null
      setBoxDraft(null)
      const a = photoAt(d.x, d.y)
      const b = photoAt(e.clientX, e.clientY)
      if (a && b && picker?.onBox) {
        const c = (v: number) => clamp(v, 0, 1)
        picker.onBox({ x0: c(Math.min(a[0], b[0])), y0: c(Math.min(a[1], b[1])), x1: c(Math.max(a[0], b[0])), y1: c(Math.max(a[1], b[1])) })
      }
      return
    }
    const wasCollage = dragRef.current?.mode === 'collage' && dragRef.current.moved
    dragRef.current = null
    const click = clickRef.current
    clickRef.current = null
    if (wasCollage) {
      collageEditor?.onMove(0, 0, true)
      return
    }
    // Selecting a subject: a click picks it (Option: leaves it out); a click
    // on a pick takes it back.
    if (picker && click && Math.hypot(e.clientX - click.x, e.clientY - click.y) <= 4) {
      const at = photoAt(e.clientX, e.clientY)
      const g = geometry()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!at || !g || !rect || !baseSize || !layer || at[0] < 0 || at[1] < 0 || at[0] > 1 || at[1] > 1) return
      const near = pickNear(picker.picks, photoFrameOf(baseSize, layer.params), g.region, { width: rect.width, height: rect.height }, e.clientX - rect.left, e.clientY - rect.top)
      if (near >= 0) picker.onUnpick(near)
      else picker.onPick(at[0], at[1], picker.leaveOut ? e.altKey : !e.altKey)
      return
    }
    // A click on the photo while making a collage: lay in, add a gap, or
    // select. A second click soon after on the same spot is a double-click
    // (counted here: a press on the selected piece holds the pointer for
    // dragging, and WebKit then may not send one of its own).
    if (collageEditor && click && Math.hypot(e.clientX - click.x, e.clientY - click.y) <= 4) {
      const at = photoAt(e.clientX, e.clientY)
      if (!at || at[0] < 0 || at[1] < 0 || at[0] > 1 || at[1] > 1) return
      const last = lastCollageClick.current
      const now = performance.now()
      if (last && now - last.t < 450 && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= 6) {
        lastCollageClick.current = null
        collageEditor.onReset(at[0], at[1], last.selected)
        return
      }
      lastCollageClick.current = { t: now, x: e.clientX, y: e.clientY, selected: collageEditor.selected }
      collageEditor.onClick(at[0], at[1], e.shiftKey)
      return
    }
    // A click without a drag samples (dropper) or places a spot (leaks); a
    // drag still pans.
    const place = leakEditor ? onPlaceSpot : guideEditor ? onPlaceGuide : undefined
    if (!place || !click || Math.hypot(e.clientX - click.x, e.clientY - click.y) > 4) return
    const geo = geometry()
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!geo || !rect || !baseSize || !layer) return
    const printed = printSizeOf(baseSize, layer.params)
    const px = geo.region.x + ((e.clientX - rect.left) / rect.width) * geo.region.width
    const py = geo.region.y + ((e.clientY - rect.top) / rect.height) * geo.region.height
    place(px / printed.width, py / printed.height)
  }

  const cursor = maskBrush
    ? 'brush'
    : sampling
    ? 'sample'
    : picker
      ? picker.leaveOut
        ? 'place leave-out'
        : 'place'
    : compare
      ? 'wipe'
      : collageEditor
        ? collageEditor.armed
          ? 'place'
          : 'collage'
      : leakEditor || guideEditor
        ? 'place'
        : 'grab'
  const geo = geometry()

  return (
    <div
      className={`preview${hand ? ' hand' : ''}${handDragging ? ' hand-dragging' : ''}`}
      ref={hostRef}
      onPointerEnter={() => (pointerOver.current = true)}
      onPointerLeave={() => (pointerOver.current = false)}
      // Stops the browser's middle-button autoscroll from starting.
      onMouseDown={(e) => e.button === 1 && e.preventDefault()}
      onPointerDownCapture={onMiddleDown}
      // The background round the photo pans too; but while selecting a
      // subject, brushing or picking a colour, a press there is the tool's (a
      // box begun just past the photo's edge is a box, held to the edge, not
      // a drag that moves the photo away).
      onPointerDown={(e) => {
        if (e.target !== hostRef.current || !base || small || e.button !== 0) return
        if (picker || maskBrush || sampling) onPointerDown(e)
        else startPan(e)
      }}
      onPointerMove={(e) => e.target === hostRef.current && onPointerMove(e)}
      onPointerUp={(e) => {
        if (e.target !== hostRef.current) return
        const mode = dragRef.current?.mode
        if (mode === 'pan') dragRef.current = null
        else if (mode === 'box' || mode === 'brush' || mode === 'sample') onPointerUp(e)
      }}
    >
      {small && base && (
        <canvas
          ref={smallRef}
          className={compare ? 'small-view wipe' : 'small-view'}
          style={smallStyle}
          onPointerDown={(e) => {
            if (!compare || e.button !== 0) return
            smallWipe.current = true
            smallWipeFrom(e.clientX)
            capturePointer(e.target, e.pointerId)
          }}
          onPointerMove={(e) => smallWipe.current && smallWipeFrom(e.clientX)}
          onPointerUp={() => (smallWipe.current = false)}
          onPointerCancel={() => (smallWipe.current = false)}
        />
      )}
      {sampling && base && (
        <div className="dropper-banner" onPointerDown={(e) => e.stopPropagation()}>
          <span>Take a colour from</span>
          <span className="segmented" role="radiogroup" aria-label="Take a colour from">
            {(
              [
                ['edited', 'The edit', 'The colour as you see it, with the look'],
                ['original', 'The original', 'The colour in the photo itself, before the look'],
              ] as const
            ).map(([from, text, hint]) => (
              <button key={from} role="radio" aria-checked={samplingFrom === from} className={samplingFrom === from ? 'on' : ''} title={hint} onClick={() => onSamplingFrom?.(from)}>
                {text}
              </button>
            ))}
          </span>
          <span className="dropper-banner-hint">Click, or hold and drag to try colours · Esc cancels</span>
        </div>
      )}
      {cover && (
        <div className="preview-cover" aria-hidden>
          <img src={cover} alt="" draggable={false} />
        </div>
      )}
      {updating && !showLoading && (
        <div className="preview-updating" role="status">
          <span className="graphics-spinner" aria-hidden />
          Updating
        </div>
      )}
      {showLoading && (
        <div className="preview-loading" role="status">
          <span className="graphics-spinner" aria-hidden />
          Loading the edit…
        </div>
      )}
      <div
        className="preview-frame"
        hidden={small}
        style={geo ? { left: geo.shift.x, top: geo.shift.y } : undefined}
        onPointerMove={(e) => {
          lastPointer.current = { x: e.clientX, y: e.clientY }
          if (loupe) setPointer(lastPointer.current)
          // The brightness under the pointer, for the tone strip's marker.
          const at = base ? photoAt(e.clientX, e.clientY) : null
          if (base && at && at[0] >= 0 && at[1] >= 0 && at[0] <= 1 && at[1] <= 1) {
            const l = lumaOf(base)
            pointedTone.set(l.encoded[Math.min(l.h - 1, Math.floor(at[1] * l.h)) * l.w + Math.min(l.w - 1, Math.floor(at[0] * l.w))])
          } else pointedTone.set(null)
        }}
        onPointerLeave={() => {
          setBrushAt(null)
          lastPointer.current = null
          setPointer(null)
          pointedTone.set(null)
        }}
      >
        {loupe && pointer && base && !small && (
          <canvas
            ref={loupeRef}
            className="loupe"
            style={{ width: LOUPE_CSS, height: LOUPE_CSS, left: pointer.x - LOUPE_CSS / 2, top: pointer.y - LOUPE_CSS / 2 }}
          />
        )}
        <canvas
          ref={canvasRef}
          className={`preview-canvas ${cursor}`}
          style={(() => {
            if (!turnBy || !geo || !baseSize || !layer) return undefined
            // About the photo's middle, wherever the view is on it; at Fit, made smaller to fit turned.
            const f = photoFrameOf(baseSize, layer.params)
            const ox = ((f.x + f.width / 2 - geo.region.x) / geo.region.width) * 100
            const oy = ((f.y + f.height / 2 - geo.region.y) / geo.region.height) * 100
            return { transform: `rotate(${turnBy}deg)${turnFit < 1 ? ` scale(${turnFit})` : ''}`, transformOrigin: `${ox}% ${oy}%` }
          })()}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          // A collage's double-click is counted from its clicks (onPointerUp).
          onDoubleClick={() => {
            if (leakEditor) onFinishDraft?.()
          }}
          onPointerCancel={() => {
            dragRef.current = null
            clickRef.current = null
          }}
        />
        {leakEditor && geo && base && baseSize && layer && (
          <LeakOverlay
            editor={leakEditor}
            print={printSizeOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {leakShapeEditor && geo && base && baseSize && layer && (
          <StreakOverlay
            editor={leakShapeEditor}
            // Leak outlines are fractions of the whole print, border and all.
            frame={{ x: 0, y: 0, ...printSizeOf(baseSize, layer.params) }}
            measure={shapeMeasure(baseSize, activeBorder(layer.params), layer.params.effects.shapeUnits, layer.params.effects.cropFrame)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {streakEditor && geo && base && baseSize && layer && (
          <StreakOverlay
            editor={streakEditor}
            frame={shapeFrame(baseSize, layer.params)}
            measure={shapeMeasure(baseSize, activeBorder(layer.params), layer.params.effects.shapeUnits, layer.params.effects.cropFrame)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {maskEditor && geo && base && baseSize && layer && (
          <StreakOverlay
            editor={maskEditor}
            frame={shapeFrame(baseSize, layer.params)}
            measure={shapeMeasure(baseSize, activeBorder(layer.params), layer.params.effects.shapeUnits, layer.params.effects.cropFrame)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {maskTint && !picker && geo && base && baseSize && layer && (
          <RasterTint raster={maskTint.raster} href={maskTint.href} shapes={shapeFrame(baseSize, layer.params)} region={geo.region} css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }} />
        )}
        {lightEditor && geo && base && baseSize && layer && (
          <LightOverlay editor={lightEditor} print={printSizeOf(baseSize, layer.params)} region={geo.region} css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }} />
        )}
        {streakGuideEditor && geo && base && baseSize && layer && (
          <StreakGuideOverlay
            editor={streakGuideEditor}
            frame={shapeFrame(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {repeatEditor && geo && base && baseSize && layer && (
          <RepeatOverlay
            editor={repeatEditor}
            frame={shapeFrame(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {colourLineEditor && geo && base && baseSize && layer && (
          <ColourLineOverlay editor={colourLineEditor} frame={shapeFrame(baseSize, layer.params)} region={geo.region} css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }} />
        )}
        {kaleidoEditor && geo && base && baseSize && layer && (
          <KaleidoOverlay
            editor={kaleidoEditor}
            frame={shapeFrame(baseSize, layer.params)}
            photo={photoFrameOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {cropEditor && geo && base && baseSize && layer && (
          <CropOverlay
            editor={cropEditor}
            fit={turnFit}
            frame={photoFrameOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {shapeMaskEditor && geo && base && baseSize && layer && (
          <ShapeMaskOverlay
            editor={shapeMaskEditor}
            frame={shapeFrame(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {picker && geo && base && baseSize && layer && (
          <PickOverlay
            picker={picker}
            photo={photoFrameOf(baseSize, layer.params)}
            shapes={shapeFrame(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {collageEditor && !leakEditor && !streakEditor && !maskEditor && !guideEditor && !bandEditor && geo && base && baseSize && layer && (
          <CollageOverlay
            editor={collageEditor}
            frame={photoFrameOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {toneHighlight && geo && base && baseSize && layer && (
          <ToneOverlay
            base={base}
            range={toneHighlight}
            frame={photoFrameOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {guideEditor && geo && base && baseSize && layer && (
          <GuideOverlay
            editor={guideEditor}
            print={printSizeOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
        {bandEditor && geo && base && baseSize && layer && (
          <BandOverlay
            editor={bandEditor}
            print={printSizeOf(baseSize, layer.params)}
            region={geo.region}
            css={{ width: geo.out.width / dpr, height: geo.out.height / dpr }}
          />
        )}
      </div>
      {boxDraft && (
        <div
          className="pick-box-draft"
          style={{
            left: Math.min(boxDraft.x0, boxDraft.x1),
            top: Math.min(boxDraft.y0, boxDraft.y1),
            width: Math.abs(boxDraft.x1 - boxDraft.x0),
            height: Math.abs(boxDraft.y1 - boxDraft.y0),
          }}
        />
      )}
      {maskBrush &&
        (() => {
          // The brush's size on screen: its share of the photo's short side.
          const g = geometry()
          const rect = canvasRef.current?.getBoundingClientRect()
          if (!g || !rect || !baseSize || !layer || rect.width === 0) return null
          const pf = photoFrameOf(baseSize, layer.params)
          const d = maskBrush.size * Math.min(pf.width, pf.height) * (rect.width / g.region.width)
          return (
            <>
              {stroke && stroke.length > 0 && (
                <svg className={`brush-stroke ${maskBrush.mode}`} width="100%" height="100%">
                  <polyline points={stroke.map((p) => `${p.x},${p.y}`).join(' ')} strokeWidth={d} />
                </svg>
              )}
              {brushAt && <div className={`brush-cursor ${maskBrush.mode}`} style={{ left: brushAt.x - d / 2, top: brushAt.y - d / 2, width: d, height: d }} />}
            </>
          )
        })()}
      {!base && (
        <div className="preview-empty">
          <p>Drop a photo here</p>
          {onOpen && <button onClick={onOpen}>Open a photo…</button>}
          {onTrySample && (
            <button className="link" onClick={onTrySample}>
              or try a sample photo
            </button>
          )}
        </div>
      )}
      {compare && base && (
        <div className="wipe-labels">
          <span>{compareLabel ?? 'Snapshot'}</span>
          <span>Current</span>
        </div>
      )}
    </div>
  )
}

/**
 * Whether a wheel event is a trackpad's two-finger swipe rather than a mouse
 * wheel's notch. Nothing says so outright: a sideways part says trackpad; in
 * WebKit and Chromium a trackpad's legacy wheelDelta is three times its
 * delta, a wheel's whole notches of 120; and the events of one swipe (its
 * glide after the fingers lift too) keep the answer of its first.
 */
let lastTrackpad = 0
function fromTrackpad(e: WheelEvent): boolean {
  const now = e.timeStamp || Date.now()
  let pad = false
  if (e.deltaMode === 0) {
    const legacy = (e as WheelEvent & { wheelDeltaY?: number }).wheelDeltaY
    if (e.deltaX !== 0) pad = true
    else if (typeof legacy === 'number' && legacy !== 0) pad = legacy === -3 * e.deltaY && legacy % 120 !== 0
    else pad = !Number.isInteger(e.deltaY) || Math.abs(e.deltaY) < 40
  }
  if (!pad && now - lastTrackpad < 250 && e.deltaMode === 0) pad = true
  if (pad) lastTrackpad = now
  return pad
}
