import { outlineRuns } from '../engine/maskShapes'
import { keyWords } from '../platform/os'
import { useEffect, useRef, useState } from 'react'
import { draftPoints } from './state/draft'
import { toScene, toView, viewLine } from './lensView'
import { sampleOutline, type Point } from '../engine/leaks'
import { MAX_CONVERGE, MAX_STREAK_POINTS, pathFlow, radialCircle, samplePath, streakCoords, streakMirrorAt, streakPos, streakVanish } from '../engine/streaks'
import type { Rect, Size, StreakFix, StreakShape } from '../engine/types'
import { capturePointer } from './pointer'
import { inTextField } from './shortcuts'

export interface StreakEditor {
  shapes: StreakShape[]
  selected: number | null
  /** Drawing a new shape: clicks add points; double-click or Enter closes it. */
  drawing: boolean
  /** Drawing a path for the selected shape: clicks add points; double-click or Enter ends it. */
  drawingPath: boolean
  /** Drawing the selected trail's end line, as a path is drawn. */
  drawingEnds?: boolean
  onFinishEnds?: (ends: Point[]) => void
  /**
   * The shapes changed. `step` names the edit: changes with the same step
   * are one step to undo — all the moves of one drag, say.
   */
  onChange: (shapes: StreakShape[], step?: string) => void
  onSelect: (index: number | null) => void
  onFinishDraw: (outline: Point[]) => void
  onFinishPath: (path: Point[]) => void
  /**
   * The selected shape's colour fixes: which is selected, and placing one by
   * dragging across the streak — a new fix's stretch, or the selected fix's source.
   */
  fixes?: {
    selected: number | null
    placing: 'span' | 'source' | null
    onPlace: (a: Point, b: Point) => void
    onSelect: (index: number) => void
  }
  /**
   * Only the selected shape's fixes are edited: the shape shows faintly with
   * nothing of its own to grab, the other shapes not at all.
   */
  fixesOnly?: boolean
  /**
   * An edit session on the selected shape (App's StreakSession): only this
   * tool's handles, and no other shape. Unset: every handle, as when a new
   * streak is drawn.
   */
  tool?: StreakTool
  /**
   * Shapes drawn as a smooth curve through their points (leak shapes with
   * Rounded on), as the engine fills them: the points stay where they are
   * dragged, the line between them bends.
   */
  rounded?: boolean[]
}

interface Props {
  editor: StreakEditor
  /** The photo's place in the print, print px: shapes are fractions of it. */
  frame: Rect
  /** The part of the print shown, print px. */
  region: Rect
  css: Size
  /** What streak bars are measured in, print px (see shapeMeasure). */
  measure?: { x: number; y: number; unit: number }
}

/** What an edit session on a streak is changing on the photo. */
/** 'all': the pencil, every handle the streak has at once (App passes no tool to the overlay for it). */
export type StreakTool = 'all' | 'shape' | 'direction' | 'path' | 'ends' | 'middle' | 'fixes' | 'guides'

type Drag =
  | { index: number; kind: 'point'; point: number }
  | { index: number; kind: 'pathPoint'; point: number }
  | { index: number; kind: 'endPoint'; point: number }
  | { index: number; kind: 'body'; start: Point; shape: StreakShape }
  // Several picked outline points moved together.
  | { index: number; kind: 'points'; points: number[]; start: Point; shape: StreakShape }
  // A handle of the box round the shape: which side it is on across and
  // down (-1, 0, 1), the box when the drag began (photo px), and the shape
  // then. `only`: the picked points, when the box is round them alone.
  | { index: number; kind: 'scale'; handle: [number, number]; box: Box; shape: StreakShape; only?: number[] }
  // The handle above the box: turns the shape (or its picked points) about the box's middle (photo px).
  | { index: number; kind: 'rotate'; centre: Point; start: number; shape: StreakShape; only?: number[] }
  | { index: number; kind: 'angle' }
  // The arrow's middle, pulled: a straight streak bent into a curve from its middle to its tip (photo fractions).
  | { index: number; kind: 'bend'; from: Point; to: Point }
  // The end of the bars, pulled along the streak: its Length, from where the bars leave the shape (short-side units).
  | { index: number; kind: 'length'; from: Point; dir: Point }
  | { index: number; kind: 'centre' }
  | { index: number; kind: 'fixEnd'; fix: number; end: 'a' | 'b' | 'sa' | 'sb' }
  // A mirrored streak's middle line, dragged sideways.
  | { index: number; kind: 'mirror' }
  // One of a straight streak's two side lines, turned about where it leaves
  // the shape (anchors, short-side units); the other stays through `other`.
  | { index: number; kind: 'side'; which: 0 | 1; anchors: [Point, Point]; other: Point; dir: Point }

/** Index of the segment of a polyline (closed, or open) nearest to a point. */
function nearestSegment(pts: Point[], p: Point, closed: boolean): number {
  let best = Infinity
  let index = 0
  const count = closed ? pts.length : pts.length - 1
  for (let j = 0; j < count; j++) {
    const a = pts[j]
    const b = pts[(j + 1) % pts.length]
    const abx = b.x - a.x
    const aby = b.y - a.y
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / Math.max(abx * abx + aby * aby, 1e-12)))
    const d = Math.hypot(p.x - a.x - abx * t, p.y - a.y - aby * t)
    if (d < best) {
      best = d
      index = j
    }
  }
  return index
}

/** An axis-aligned box, photo px. */
interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * The shape with every point it is placed by moved through `f`: its
 * outline, path, trail end line, radial middle and colour fixes, so all of
 * it stays where it was drawn on the shape when the shape moves, scales or
 * turns.
 */
function mapShape(s: StreakShape, f: (p: Point) => Point): Partial<StreakShape> {
  return {
    outline: s.outline.map(f),
    path: s.path ? s.path.map(f) : null,
    ends: s.ends ? s.ends.map(f) : s.ends,
    ...(s.colourLine ? { colourLine: s.colourLine.map(f) } : {}),
    radialCentre: s.radialCentre ? f(s.radialCentre) : s.radialCentre,
    fixes: (s.fixes ?? []).map((fx) => ({
      ...fx,
      a: f(fx.a),
      b: f(fx.b),
      source: fx.source ? { a: f(fx.source.a), b: f(fx.source.b) } : null,
    })),
  }
}

/** The cursor for a box handle: which way it stretches. */
const SCALE_CURSOR: Record<string, string> = {
  '-1,-1': 'nwse-resize',
  '1,1': 'nwse-resize',
  '1,-1': 'nesw-resize',
  '-1,1': 'nesw-resize',
  '0,-1': 'ns-resize',
  '0,1': 'ns-resize',
  '-1,0': 'ew-resize',
  '1,0': 'ew-resize',
}

const centroid = (pts: Point[]) => ({
  x: pts.reduce((a, p) => a + p.x, 0) / pts.length,
  y: pts.reduce((a, p) => a + p.y, 0) / pts.length,
})

/**
 * Streak shapes on the photo. Each is its outline — the same straight-sided
 * shape the engine fills — and an arrow from its centre showing the streak
 * direction, or the path the streaks follow, arrowed at its end. Masks are
 * drawn amber, with no arrow. Select a shape for its handles: drag points to
 * reshape, drag inside to move, drag the arrow head to turn the streaks, and
 * the box round it to scale it (corners keep its proportions, sides stretch
 * it) or the handle above the box to turn it — so an outline traced round
 * something small can be blown up and placed elsewhere. While drawing,
 * clicks add outline points and a drag traces them.
 */
/** How often a drag hands its edit on to be rendered, ms. */
const COMMIT_MS = 90

export function StreakOverlay({ editor, frame, region: shown, css, measure }: Props) {
  // Shapes are fractions of the photo, not the print, so a border does not
  // move them. Everything below works as if the photo were the print: sizes
  // are the photo's, and the shown region is measured from its corner.
  const print: Size = { width: frame.width, height: frame.height }
  const region: Rect = { ...shown, x: shown.x - frame.x, y: shown.y - frame.y }
  const svg = useRef<SVGSVGElement>(null)
  const drag = useRef<Drag | null>(null)
  const [draft, setDraft] = useState<Point[]>([])
  // Its count, for Done in the edit's box (state/draft.ts).
  useEffect(() => {
    draftPoints.set(draft.length)
  }, [draft.length])
  useEffect(() => () => draftPoints.set(0), [])
  // Undo while drawing: the draft as it was before each step — a click, a
  // traced stroke, a point moved or deleted — so Cmd+Z takes back a whole
  // stroke or move at a time, and Cmd+Shift+Z puts it back.
  const past = useRef<Point[][]>([])
  const future = useRef<Point[][]>([])
  const remember = (d: Point[]) => {
    past.current.push(d)
    future.current = []
  }
  // A press on the photo while drawing: it becomes a freehand stroke only
  // once it has moved a few pixels, so a click that wobbles stays a click.
  // `from` is where the stroke starts in the draft, for thinning it after.
  const press = useRef<{ x: number; y: number; tracing: boolean; from: number } | null>(null)
  // A placed point being dragged to a new place, while drawing.
  const moving = useRef<number | null>(null)
  const skipClick = useRef(false)
  const sx = css.width / region.width
  const sy = css.height / region.height
  const short = Math.min(print.width, print.height)
  // Points are where they are on the photo; the lens shows them elsewhere (lensView.ts).
  const toCss = (p: Point) => {
    const v = toView({ x: p.x * print.width, y: p.y * print.height })
    return [(v.x - region.x) * sx, (v.y - region.y) * sy]
  }
  /** A point of the overlay (css px from its corner) on the photo, in fractions. */
  const cssFrac = (x: number, y: number): Point => {
    const q = toScene({ x: x / sx + region.x, y: y / sy + region.y })
    return { x: q.x / print.width, y: q.y / print.height }
  }
  const toFrac = (cx: number, cy: number): Point => {
    const r = svg.current!.getBoundingClientRect()
    const q = toScene({ x: (cx - r.left) / sx + region.x, y: (cy - r.top) / sy + region.y })
    return { x: q.x / print.width, y: q.y / print.height }
  }
  // Each drag, insert or removal is its own step to undo.
  const gesture = useRef(0)
  // While a handle is dragged the outline follows the pointer here at once,
  // and the edit is handed on at most every COMMIT_MS (and on release): each
  // hand-off re-renders the photo, its streaks rasterised again, which can
  // take longer than a frame. The overlay stays smooth however long that is.
  const [live, setLive] = useState<StreakShape[] | null>(null)
  const shapes = live ?? editor.shapes
  const pending = useRef<{ shapes: StreakShape[]; step: string } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(editor)
  latest.current = editor
  const flush = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const p = pending.current
    pending.current = null
    if (p) latest.current.onChange(p.shapes, p.step)
  }
  const release = () => {
    flush()
    setLive(null)
  }
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const update = (i: number, patch: Partial<StreakShape>, step = `gesture${gesture.current}`) => {
    const next = shapes.map((s, j) => (j === i ? { ...s, ...patch } : s))
    // Only while dragging; a one-off change (a point removed) goes straight on.
    if (!drag.current) {
      editor.onChange(next, step)
      return
    }
    setLive(next)
    pending.current = { shapes: next, step }
    if (!timer.current) timer.current = setTimeout(flush, COMMIT_MS)
  }

  const finish = () => {
    // Drop repeats (a double-click lands twice), measured on screen so a
    // detailed outline traced while zoomed in keeps its points.
    const pts = draft.filter(
      (p, i) =>
        i === 0 || Math.hypot((p.x - draft[i - 1].x) * print.width * sx, (p.y - draft[i - 1].y) * print.height * sy) > 2,
    )
    setDraft([])
    past.current = []
    future.current = []
    if (editor.drawingEnds) {
      if (pts.length >= 2) editor.onFinishEnds?.(pts)
    } else if (editor.drawingPath) {
      if (pts.length >= 2) editor.onFinishPath(pts)
    } else if (pts.length >= 3) editor.onFinishDraw(pts)
  }
  const drawing = editor.drawing || editor.drawingPath || !!editor.drawingEnds

  const clearDraft = () => {
    // The same empty draft kept, not a new one: this runs on every render
    // while nothing is being drawn, and a new array would render again forever.
    setDraft((d) => (d.length ? [] : d))
    past.current = []
    future.current = []
  }

  useEffect(() => {
    if (!drawing) {
      clearDraft()
      return
    }
    // Capture phase, ahead of the app's own Cmd+Z for finished edits: while
    // a shape is being drawn, undo works on the shape being drawn.
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e.target)) return
      const key = e.key.toLowerCase()
      const take = () => {
        e.preventDefault()
        e.stopImmediatePropagation()
      }
      if (e.key === 'Enter') finish()
      else if (e.key === 'Escape') clearDraft()
      else if ((e.key === 'Backspace' || e.key === 'Delete') && draft.length) {
        take()
        remember(draft)
        setDraft(draft.slice(0, -1))
      } else if ((e.metaKey || e.ctrlKey) && ((key === 'z' && e.shiftKey) || key === 'y')) {
        const next = future.current.pop()
        if (!next) return
        take()
        past.current.push(draft)
        setDraft(next)
      } else if ((e.metaKey || e.ctrlKey) && key === 'z' && past.current.length) {
        take()
        future.current.push(draft)
        setDraft(past.current.pop()!)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  /**
   * A traced stroke, thinned: points that sit within a pixel and a half of
   * the line through their neighbours add nothing, so they go
   * (Ramer–Douglas–Peucker, on screen).
   */
  const simplify = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts
    const xy = pts.map(toCss)
    const keep = new Array<boolean>(pts.length).fill(false)
    keep[0] = keep[pts.length - 1] = true
    const stack: [number, number][] = [[0, pts.length - 1]]
    while (stack.length) {
      const [a, b] = stack.pop()!
      const [ax, ay] = xy[a]
      const [bx, by] = xy[b]
      const len = Math.hypot(bx - ax, by - ay) || 1
      let far = -1
      let farD = 1.5
      for (let k = a + 1; k < b; k++) {
        const d = Math.abs((bx - ax) * (ay - xy[k][1]) - (ax - xy[k][0]) * (by - ay)) / len
        if (d > farD) {
          farD = d
          far = k
        }
      }
      if (far >= 0) {
        keep[far] = true
        stack.push([a, far], [far, b])
      }
    }
    return pts.filter((_, k) => keep[k])
  }
  const clampFrac = (e: { clientX: number; clientY: number }) => {
    const p = toFrac(e.clientX, e.clientY)
    return { x: Math.min(1.5, Math.max(-0.5, p.x)), y: Math.min(1.5, Math.max(-0.5, p.y)) }
  }

  /** An outline as the engine fills it: straight lines between its points (a selection's parts each on its own, outlineRuns). */
  const path = (outline: Point[]) => {
    const { runs, closed } = outlineRuns(outline)
    return runs
      .map(
        (run) =>
          viewLine(
            run.map((p) => ({ x: p.x * print.width, y: p.y * print.height })),
            closed,
          )
            .map((p, i) => `${i ? 'L' : 'M'}${(p.x - region.x) * sx} ${(p.y - region.y) * sy}`)
            .join(' ') + (closed ? ' Z' : ''),
      )
      .join(' ')
  }

  /** A shape's outline as the engine fills it: straight, or (rounded) a smooth curve through its points. */
  const shapePath = (i: number, outline: Point[]) => {
    if (!editor.rounded?.[i] || outline.length < 3) return path(outline)
    const px = outline.map((p) => ({ x: p.x * print.width, y: p.y * print.height }))
    const curve = viewLine(sampleOutline(px, 8), true)
    return curve.map((p, k) => `${k ? 'L' : 'M'}${(p.x - region.x) * sx} ${(p.y - region.y) * sy}`).join(' ') + ' Z'
  }

  /** An open path through the points, as the engine samples it, in CSS px. */
  const openPath = (pts: Point[]) =>
    viewLine(
      samplePath(
        pts.map((p) => ({ x: p.x * print.width, y: p.y * print.height })),
        Math.max(2, pts.length * 12),
      ),
      false,
    )
      .map((p, i) => `${i ? 'L' : 'M'}${(p.x - region.x) * sx} ${(p.y - region.y) * sy}`)
      .join(' ')

  /** Where a click on an outline falls between its points: the index a new point goes at. */
  const outlineInsert = (outline: Point[], p: Point) =>
    nearestSegment(
      outline.map((q) => ({ x: q.x * print.width, y: q.y * print.height })),
      { x: p.x * print.width, y: p.y * print.height },
      true,
    ) + 1
  /** The same for a path: between which of its points the click falls. */
  const pathInsert = (pts: Point[], p: Point) =>
    nearestSegment(
      pts.map((q) => ({ x: q.x * print.width, y: q.y * print.height })),
      { x: p.x * print.width, y: p.y * print.height },
      false,
    ) + 1

  // Colour fixes are placed across the streak, measured as the engine
  // measures it, so the stretches drawn here are the ones it fixes.
  const m = measure ?? { x: frame.x, y: frame.y, unit: Math.min(frame.width, frame.height) }
  const toShort = (p: Point): Point => ({
    x: (frame.x + p.x * frame.width - m.x) / m.unit,
    y: (frame.y + p.y * frame.height - m.y) / m.unit,
  })
  const shortCss = (q: Point) => [(m.x + q.x * m.unit - shown.x) * sx, (m.y + q.y * m.unit - shown.y) * sy]
  const flowOf = (sh: StreakShape) => {
    const a = (sh.angle * Math.PI) / 180
    const dir = { x: Math.cos(a), y: Math.sin(a) }
    const followed = sh.mode !== 'mask' && sh.path && sh.path.length >= 2 ? pathFlow(sh.path.map(toShort), sh.outline.map(toShort), sh.pathEase ?? 1) : null
    const vanish = followed ? null : streakVanish(sh.outline.map(toShort), dir, sh.converge ?? 0, sh.radial ? Math.max(sh.band, 1e-3) : 0, sh.radialCentre && toShort(sh.radialCentre))
    const st = sh.outline.map((p) => streakCoords(toShort(p), dir, followed, vanish))
    // In perspective a side can pass nearer the point than any corner.
    const pad = vanish ? 0.25 : 0.05
    return { dir, followed, vanish, s0: Math.min(...st.map((c) => c.s)) - pad, s1: Math.max(...st.map((c) => c.s)) + pad, st }
  }
  /**
   * The stretch a fix covers, exactly as wide as drawn (the engine fixes
   * lines, not whole bars), its two sides (where a and b are across the
   * flow), and where it copies from: the stretches beside it, mirrored in
   * (streakLean.ts, leanStretch), or the part picked on the photo.
   */
  const fixSpans = (
    f: Pick<StreakFix, 'a' | 'b' | 'side' | 'source' | 'feather' | 'mode'>,
    flow: ReturnType<typeof flowOf>,
  ) => {
    const ta = streakCoords(toShort(f.a), flow.dir, flow.followed, flow.vanish).t
    const tb = streakCoords(toShort(f.b), flow.dir, flow.followed, flow.vanish).t
    const lo = Math.min(ta, tb)
    const hi = Math.max(ta, tb)
    const w = hi - lo
    let from: [number, number][] = []
    let sides: { sa: number; sb: number } | null = null
    if (f.mode === 'borrow' && f.source) {
      const sa = streakCoords(toShort(f.source.a), flow.dir, flow.followed, flow.vanish).t
      const sb = streakCoords(toShort(f.source.b), flow.dir, flow.followed, flow.vanish).t
      from = [[Math.min(sa, sb), Math.max(sa, sb)]]
      sides = { sa, sb }
    } else if (f.mode === 'borrow')
      from = [
        ...(f.side !== 'after' ? [[lo - w, lo] as [number, number]] : []),
        ...(f.side !== 'before' ? [[hi, hi + w] as [number, number]] : []),
      ]
    return {
      span: [lo, hi] as [number, number],
      ta,
      tb,
      soft: f.feather > 0 ? ([lo - f.feather / 2, hi + f.feather / 2] as [number, number]) : null,
      from,
      sides,
    }
  }
  /**
   * The streak's whole run, for showing a fix along it: a trail's from its
   * shape out to the far side of the photo, not only inside the shape.
   */
  const runOf = (sh: StreakShape, flow: ReturnType<typeof flowOf>) => {
    if (sh.mode !== 'trail') return flow
    const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }].map(
      (c) => streakCoords(toShort(c), flow.dir, flow.followed, flow.vanish).s,
    )
    const far = Math.max(flow.s1, ...corners.filter((v) => Number.isFinite(v)))
    return { ...flow, s1: flow.vanish ? Math.min(far, flow.s1 + 3) : far }
  }
  /** A line along the flow at t, as an SVG path, over the run. */
  const alongLine = (flow: ReturnType<typeof flowOf>, t: number) => {
    const n = flow.followed || flow.vanish ? 48 : 1
    const pts: number[][] = []
    for (let k = 0; k <= n; k++) pts.push(shortCss(streakPos(flow.s0 + ((flow.s1 - flow.s0) * k) / n, t, flow.dir, flow.followed, flow.vanish)))
    return pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' ')
  }
  /** A stretch across the flow, [lo, hi], as an SVG path running the length of the shape. */
  const band = (flow: ReturnType<typeof flowOf>, lo: number, hi: number) => {
    const n = flow.followed ? 48 : 1
    const pts: number[][] = []
    for (let k = 0; k <= n; k++) pts.push(shortCss(streakPos(flow.s0 + ((flow.s1 - flow.s0) * k) / n, lo, flow.dir, flow.followed, flow.vanish)))
    for (let k = n; k >= 0; k--) pts.push(shortCss(streakPos(flow.s0 + ((flow.s1 - flow.s0) * k) / n, hi, flow.dir, flow.followed, flow.vanish)))
    return pts.map(([x, y], k) => `${k ? 'L' : 'M'}${x} ${y}`).join(' ') + ' Z'
  }
  /**
   * A straight streak's two side lines, as the engine runs them: through
   * the outline's outermost corners either side, out past the shape along
   * the flow to a handle (short of the vanishing point, in perspective).
   * Drag a handle and its line turns; where the two lines meet is the
   * vanishing point. Short-side units.
   */
  const sideLines = (sh: StreakShape) => {
    const flow = flowOf(sh)
    const ts = flow.st.map((c) => c.t)
    const ss = flow.st.map((c) => c.s)
    const sMin = Math.min(...ss)
    const sMax = Math.max(...ss)
    const out = flow.vanish && flow.vanish.g < 0 ? sMax + Math.min(0.15, -sMax * 0.5) : sMax + 0.15
    const pts = sh.outline.map(toShort)
    const sides = ([0, 1] as const).map((k) => {
      const t = k === 0 ? Math.min(...ts) : Math.max(...ts)
      const at = ts.indexOf(t)
      return {
        t,
        anchor: pts[at],
        from: streakPos(sMin - 0.03, t, flow.dir, null, flow.vanish),
        handle: streakPos(out, t, flow.dir, null, flow.vanish),
      }
    })
    return { flow, sides, sMin, out }
  }
  // While a side line is dragged, its handle stays under the pointer.
  const [sidePointer, setSidePointer] = useState<{ index: number; which: 0 | 1; p: Point } | null>(null)

  // Placing a fix: the drag across the streak, from where it began.
  const [placeDrag, setPlaceDrag] = useState<{ a: Point; b: Point } | null>(null)

  // Picked outline points of the selected shape: Shift-drag a box round
  // them (Option-Shift-drag takes them out), or Shift-click one. Dragging a
  // picked point moves them all; Delete removes them; the box round the
  // shape then scales and turns just them; Escape lets them go.
  const [picked, setPicked] = useState<{ index: number; points: number[] } | null>(null)
  const pickedHere =
    picked && picked.index === editor.selected && shapes[picked.index]
      ? picked.points.filter((k) => k < shapes[picked.index].outline.length)
      : []
  const pickedSet = new Set(pickedHere)
  useEffect(() => setPicked(null), [editor.selected])
  const [shift, setShift] = useState(false)
  useEffect(() => {
    const on = (e: KeyboardEvent) => setShift(e.shiftKey)
    const off = () => setShift(false)
    window.addEventListener('keydown', on)
    window.addEventListener('keyup', on)
    window.addEventListener('blur', off)
    return () => {
      window.removeEventListener('keydown', on)
      window.removeEventListener('keyup', on)
      window.removeEventListener('blur', off)
    }
  }, [])
  // The box being dragged out, CSS px from the overlay's corner.
  const [marquee, setMarquee] = useState<{ a: [number, number]; b: [number, number]; remove: boolean } | null>(null)
  const cssAt = (e: { clientX: number; clientY: number }): [number, number] => {
    const r = svg.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  const startMarquee = (e: React.PointerEvent) => {
    e.stopPropagation()
    capturePointer(e.target, e.pointerId)
    const at = cssAt(e)
    setMarquee({ a: at, b: at, remove: e.altKey })
  }
  const endMarquee = () => {
    const mq = marquee
    setMarquee(null)
    const i = editor.selected
    if (!mq || i === null || !shapes[i]) return
    const x0 = Math.min(mq.a[0], mq.b[0])
    const x1 = Math.max(mq.a[0], mq.b[0])
    const y0 = Math.min(mq.a[1], mq.b[1])
    const y1 = Math.max(mq.a[1], mq.b[1])
    const inside = shapes[i].outline.flatMap((q, k) => {
      const [x, y] = toCss(q)
      return x >= x0 && x <= x1 && y >= y0 && y <= y1 ? [k] : []
    })
    const had = new Set(pickedHere)
    if (mq.remove) inside.forEach((k) => had.delete(k))
    else inside.forEach((k) => had.add(k))
    setPicked(had.size ? { index: i, points: [...had].sort((a, b) => a - b) } : null)
  }
  const togglePick = (i: number, k: number) => {
    const had = new Set(pickedHere)
    if (had.has(k)) had.delete(k)
    else had.add(k)
    setPicked(had.size ? { index: i, points: [...had].sort((a, b) => a - b) } : null)
  }
  // Delete removes the picked points (a shape keeps at least three); Escape lets them go.
  useEffect(() => {
    if (!pickedHere.length || drawing || editor.selected === null) return
    const i = editor.selected
    const onKey = (e: KeyboardEvent) => {
      if (inTextField(e.target)) return
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        setPicked(null)
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        e.stopImmediatePropagation()
        const gone = new Set(pickedHere)
        const outline = shapes[i].outline.filter((_, k) => !gone.has(k))
        if (outline.length < 3) return
        gesture.current++
        update(i, { outline })
        setPicked(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  const removePoint = (i: number, k: number, kind: 'point' | 'pathPoint') => {
    gesture.current++
    setPicked(null)
    const shape = editor.shapes[i]
    if (kind === 'point') {
      if (shape.outline.length > 3) update(i, { outline: shape.outline.filter((_, j) => j !== k) })
    } else if (shape.path && shape.path.length > 2) update(i, { path: shape.path.filter((_, j) => j !== k) })
  }

  const onMove = (e: React.PointerEvent) => {
    if (marquee) {
      const b = cssAt(e)
      setMarquee({ ...marquee, b })
      return
    }
    if (moving.current !== null) {
      const k = moving.current
      const p = clampFrac(e)
      setDraft((d) => d.map((q, j) => (j === k ? p : q)))
      return
    }
    const d = drag.current
    if (!d) return
    const p = toFrac(e.clientX, e.clientY)
    const shape = shapes[d.index]
    if (d.kind === 'point') {
      update(d.index, { outline: shape.outline.map((q, i) => (i === d.point ? p : q)) })
    } else if (d.kind === 'pathPoint') {
      update(d.index, { path: (shape.path ?? []).map((q, i) => (i === d.point ? p : q)) })
    } else if (d.kind === 'endPoint') {
      update(d.index, { ends: (shape.ends ?? []).map((q, i) => (i === d.point ? p : q)) })
    } else if (d.kind === 'mirror') {
      update(d.index, { mirrorAt: p })
    } else if (d.kind === 'fixEnd') {
      update(d.index, {
        fixes: shape.fixes.map((f, k) =>
          k !== d.fix
            ? f
            : d.end === 'a' || d.end === 'b'
              ? { ...f, [d.end]: p }
              : f.source
                ? { ...f, source: { ...f.source, [d.end === 'sa' ? 'a' : 'b']: p } }
                : f,
        ),
      })
    } else if (d.kind === 'side') {
      // The dragged line runs from its anchor through the pointer, the other
      // as it was; they meet at the vanishing point, or are parallel.
      const q = toShort(p)
      const pts = shape.outline.map(toShort)
      const xs = pts.map((o) => o.x)
      const ys = pts.map((o) => o.y)
      const c = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
      // The dragged line: from the pointer, just touching the shape on its
      // side, as the engine's side line touches it — so it stays under the
      // pointer whichever corner it rests on.
      const e = { x: c.x - q.x, y: c.y - q.y }
      const seen = pts.map((o) => Math.atan2(e.x * (o.y - q.y) - e.y * (o.x - q.x), e.x * (o.x - q.x) + e.y * (o.y - q.y)))
      const lo = pts[seen.indexOf(Math.min(...seen))]
      const hi = pts[seen.indexOf(Math.max(...seen))]
      const across = (o: Point) => -(o.x - c.x) * d.dir.y + (o.y - c.y) * d.dir.x
      const a = (across(lo) < across(hi)) === (d.which === 0) ? lo : hi
      const b = d.anchors[1 - d.which]
      const u = { x: q.x - a.x, y: q.y - a.y }
      const w = { x: d.other.x - b.x, y: d.other.y - b.y }
      const den = u.x * w.y - u.y * w.x
      const len = Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)
      setSidePointer({ index: d.index, which: d.which, p: q })
      if (len < 1e-9) return
      let dir: Point
      let converge = 0
      const f = den === 0 ? Infinity : ((b.x - a.x) * w.y - (b.y - a.y) * w.x) / den
      const v = { x: a.x + u.x * f, y: a.y + u.y * f }
      const far = Math.hypot(v.x - c.x, v.y - c.y)
      if (!Number.isFinite(f) || Math.abs(den) < len * 1e-4 || far > 1 / 0.002) {
        // Parallel, or as good as: a straight streak along the lines.
        const m = { x: u.x / Math.hypot(u.x, u.y) + w.x / Math.hypot(w.x, w.y), y: u.y / Math.hypot(u.x, u.y) + w.y / Math.hypot(w.x, w.y) }
        const sign = m.x * d.dir.x + m.y * d.dir.y < 0 ? -1 : 1
        dir = { x: m.x * sign, y: m.y * sign }
      } else {
        // Ahead along the flow, they close in toward it; behind, they spread from it.
        const toward = (v.x - c.x) * d.dir.x + (v.y - c.y) * d.dir.y > 0
        dir = toward ? { x: v.x - c.x, y: v.y - c.y } : { x: c.x - v.x, y: c.y - v.y }
        converge = Math.max(-MAX_CONVERGE, Math.min(MAX_CONVERGE, (toward ? 1 : -1) / Math.max(far, 1e-6)))
      }
      const angle = (Math.atan2(dir.y, dir.x) * 180) / Math.PI
      update(d.index, { angle: Math.round(angle * 10) / 10, converge: Math.round(converge * 1000) / 1000 })
    } else if (d.kind === 'centre') {
      update(d.index, { radialCentre: p })
    } else if (d.kind === 'bend') {
      update(d.index, { path: [d.from, p, d.to] })
    } else if (d.kind === 'length') {
      const q = toShort(p)
      const L = (q.x - d.from.x) * d.dir.x + (q.y - d.from.y) * d.dir.y
      update(d.index, { length: Math.round(Math.min(1.5, Math.max(0.02, L)) * 100) / 100 })
    } else if (d.kind === 'points') {
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      const set = new Set(d.points)
      update(d.index, { outline: d.shape.outline.map((q, k) => (set.has(k) ? { x: q.x + dx, y: q.y + dy } : q)) })
    } else if (d.kind === 'body') {
      // The path, end line, radial middle and fixes move with their shape, so they stay where they were drawn.
      const dx = p.x - d.start.x
      const dy = p.y - d.start.y
      update(d.index, mapShape(d.shape, (q) => ({ x: q.x + dx, y: q.y + dy })))
    } else if (d.kind === 'scale') {
      // About the opposite side (Option: about the middle), in photo px so a
      // corner keeps the shape's proportions on a photo that is not square.
      const P = { x: p.x * print.width, y: p.y * print.height }
      const { box, handle: [hx, hy] } = d
      const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
      const side = (k: number, lo: number, hi: number, m: number) => (k < 0 ? lo : k > 0 ? hi : m)
      const grab = { x: side(hx, box.x0, box.x1, mid.x), y: side(hy, box.y0, box.y1, mid.y) }
      const about = e.altKey ? mid : { x: side(-hx, box.x0, box.x1, mid.x), y: side(-hy, box.y0, box.y1, mid.y) }
      const vx = grab.x - about.x
      const vy = grab.y - about.y
      let kx = hx && Math.abs(vx) > 1e-6 ? (P.x - about.x) / vx : 1
      let ky = hy && Math.abs(vy) > 1e-6 ? (P.y - about.y) / vy : 1
      // A corner scales both ways alike (Shift: each its own way), by how
      // far along its diagonal the pointer is.
      if (hx && hy && !e.shiftKey) kx = ky = ((P.x - about.x) * vx + (P.y - about.y) * vy) / Math.max(vx * vx + vy * vy, 1e-9)
      kx = Math.max(0.02, kx)
      ky = Math.max(0.02, ky)
      const f = (q: Point) => ({
        x: (about.x + (q.x * print.width - about.x) * kx) / print.width,
        y: (about.y + (q.y * print.height - about.y) * ky) / print.height,
      })
      // Sizes that are part of where the streak reaches grow with it; the
      // bars' own (width, length, feather) are the look, and stay.
      const g = Math.sqrt(kx * ky)
      if (d.only) {
        const set = new Set(d.only)
        update(d.index, { outline: d.shape.outline.map((q, k) => (set.has(k) ? f(q) : q)) })
        return
      }
      update(d.index, {
        ...mapShape(d.shape, f),
        radialRadius: (d.shape.radialRadius ?? 0) * g,
        radialReach: (d.shape.radialReach ?? 0) * g,
        pathWidth: (d.shape.pathWidth ?? 0) * g,
      })
    } else if (d.kind === 'rotate') {
      const P = { x: p.x * print.width, y: p.y * print.height }
      let turn = Math.atan2(P.y - d.centre.y, P.x - d.centre.x) - d.start
      // Shift: in steps of 15°.
      if (e.shiftKey) turn = Math.round(turn / (Math.PI / 12)) * (Math.PI / 12)
      const cos = Math.cos(turn)
      const sin = Math.sin(turn)
      const f = (q: Point) => {
        const x = q.x * print.width - d.centre.x
        const y = q.y * print.height - d.centre.y
        return { x: (d.centre.x + x * cos - y * sin) / print.width, y: (d.centre.y + x * sin + y * cos) / print.height }
      }
      if (d.only) {
        const set = new Set(d.only)
        update(d.index, { outline: d.shape.outline.map((q, k) => (set.has(k) ? f(q) : q)) })
        return
      }
      // The streaks turn with their shape.
      const angle = d.shape.angle + (turn * 180) / Math.PI
      update(d.index, { ...mapShape(d.shape, f), angle: Math.round((((angle % 360) + 540) % 360 - 180) * 10) / 10 })
    } else {
      const c = centroid(shape.outline)
      const angle = (Math.atan2((p.y - c.y) * print.height, (p.x - c.x) * print.width) * 180) / Math.PI
      update(d.index, { angle: Math.round(angle) })
    }
  }

  const begin = (e: React.PointerEvent, d: Drag) => {
    e.stopPropagation()
    gesture.current++
    drag.current = d
    editor.onSelect(d.index)
    capturePointer(e.target, e.pointerId)
  }

  const order = shapes
    .map((_, i) => i)
    .filter((i) => i !== editor.selected && !editor.fixesOnly && !editor.tool)
    .concat(editor.selected !== null && editor.selected < shapes.length ? [editor.selected] : [])
  // Fixes only: the shape is there to see the bars against, not to change.
  // In an edit session (editor.tool), only that tool's handles.
  const handles = !editor.fixesOnly
  const tool = editor.tool
  // A streak off a subject has the subject as its shape: its outline follows the subject, so it has no points of its own to drag.
  const shapeH = handles && (!tool || tool === 'shape')
  const dirH = handles && (!tool || tool === 'direction')
  const pathH = handles && (!tool || tool === 'path')
  const endsH = handles && (!tool || tool === 'ends')
  const fixesH = !tool || tool === 'fixes'

  return (
    <svg
      ref={svg}
      className={drawing ? 'streak-overlay drawing' : 'streak-overlay'}
      width={css.width}
      height={css.height}
      onPointerMove={onMove}
      onPointerUp={() => {
        if (marquee) endMarquee()
        drag.current = null
        moving.current = null
        setSidePointer(null)
        release()
      }}
      onPointerCancel={() => {
        setMarquee(null)
        drag.current = null
        moving.current = null
        release()
      }}
    >
      <defs>
        <marker id="streak-path-end" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M0 0 L10 5 L0 10 z" className="streak-path-head" />
        </marker>
      </defs>
      {drawing && (
        // Reaches past the photo, so a shape can start off the frame and
        // streak in from (or out to) the edge.
        <rect
          className="streak-catcher"
          x={-css.width * 0.5}
          y={-css.height * 0.5}
          width={css.width * 2}
          height={css.height * 2}
          onClick={(e) => {
            // The press already placed its point (or traced a stroke).
            if (skipClick.current) {
              skipClick.current = false
              return
            }
            if (draft.length >= MAX_STREAK_POINTS) return
            remember(draft)
            setDraft([...draft, clampFrac(e)])
          }}
          onPointerDown={(e) => {
            capturePointer(e.target, e.pointerId)
            // Option-drag traces freehand (a still Option-click adds a point).
            if (e.altKey) {
              press.current = { x: e.clientX, y: e.clientY, tracing: false, from: draft.length }
              skipClick.current = false
              return
            }
            // A press places a point there and then; dragging slides that
            // point into place, like a pen tool. The click that follows the
            // release adds nothing more.
            press.current = null
            if (draft.length >= MAX_STREAK_POINTS) return
            remember(draft)
            moving.current = draft.length
            skipClick.current = true
            setDraft([...draft, clampFrac(e)])
          }}
          onPointerMove={(e) => {
            const pr = press.current
            if (!pr || !(e.buttons & 1)) return
            if (!pr.tracing) {
              if (Math.hypot(e.clientX - pr.x, e.clientY - pr.y) < 6) return
              // Moved far enough: a stroke, from where the press began.
              pr.tracing = true
              pr.from = draft.length
              remember(draft)
              setDraft((d) => [...d, clampFrac({ clientX: pr.x, clientY: pr.y })].slice(0, MAX_STREAK_POINTS))
            }
            const next = clampFrac(e)
            setDraft((d) => {
              const last = d[d.length - 1]
              // A point every few screen pixels along the drag.
              if (last && Math.hypot((next.x - last.x) * print.width * sx, (next.y - last.y) * print.height * sy) < 6)
                return d
              return [...d, next].slice(0, MAX_STREAK_POINTS)
            })
          }}
          onPointerUp={() => {
            const pr = press.current
            press.current = null
            if (!pr?.tracing) return
            skipClick.current = true
            // Thin the stroke just traced; the points before it stay as they are.
            setDraft((d) => [...d.slice(0, pr.from), ...simplify(d.slice(pr.from))])
          }}
          onDoubleClick={finish}
        />
      )}
      {(shift || marquee) && !drawing && shapeH && editor.selected !== null && !editor.fixes?.placing && (
        <rect
          className="streak-catcher picking"
          x={-css.width * 0.5}
          y={-css.height * 0.5}
          width={css.width * 2}
          height={css.height * 2}
          onPointerDown={startMarquee}
        >
          <title>{keyWords("Shift-drag round points to pick them; Option-Shift-drag to unpick")}</title>
        </rect>
      )}
      {order.map((i) => {
        const s = shapes[i]
        const on = editor.selected === i
        // While a shape is drawn or edited, the others are only faint
        // outlines: nothing on them to grab by mistake, and a click just
        // selects one.
        if (editor.drawing || (editor.selected !== null && !on))
          return (
            <g key={i} className={`streak dim ${s.mode === 'mask' ? 'mask' : ''}`}>
              <path
                className="streak-body"
                d={shapePath(i, s.outline)}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  editor.onSelect(i)
                }}
              >
                <title>{s.mode === 'mask' ? 'Mask' : 'Streak shape'} — click to edit it</title>
              </path>
            </g>
          )
        const c = centroid(s.outline)
        const [cx, cy] = toCss(c)
        const a = (s.angle * Math.PI) / 180
        const arm = Math.max(30, short * 0.08 * sx)
        const hx = cx + Math.cos(a) * arm
        const hy = cy + Math.sin(a) * arm
        // Where the bars end, for a straight streak whose bars run a Length
        // (a trail, or one measured as a distance): out from where the
        // streak's middle line leaves the shape, Length further on.
        const lengthEnd = (() => {
          if (s.mode === 'mask' || s.radial || (s.path && s.path.length >= 2) || (s.mode === 'trail' && s.ends && s.ends.length >= 2)) return null
          if (s.mode === 'fill' && s.clip && s.measure === 'across') return null
          if (s.lengthBeforeExtend !== undefined) return null
          const dir = { x: Math.cos(a), y: Math.sin(a) }
          const pts = s.outline.map(toShort)
          const o = toShort(c)
          // The furthest the ray from the middle crosses the outline: where it leaves the shape.
          let t = 0
          for (let k = 0; k < pts.length; k++) {
            const p1 = pts[k]
            const p2 = pts[(k + 1) % pts.length]
            const ex = p2.x - p1.x
            const ey = p2.y - p1.y
            const den = dir.x * ey - dir.y * ex
            if (Math.abs(den) < 1e-12) continue
            const tt = ((p1.x - o.x) * ey - (p1.y - o.y) * ex) / den
            const u = ((p1.x - o.x) * dir.y - (p1.y - o.y) * dir.x) / den
            if (tt > t && u >= 0 && u <= 1) t = tt
          }
          const from = { x: o.x + dir.x * t, y: o.y + dir.y * t }
          const to = { x: from.x + dir.x * s.length, y: from.y + dir.y * s.length }
          return { from, to, dir, a: shortCss(from), b: shortCss(to) }
        })()
        return (
          <g key={i} className={`streak ${s.mode === 'mask' ? 'mask' : ''} ${on ? 'on' : ''}${editor.fixesOnly ? ' fixes-only' : ''}`}>
            <path
              // Off a subject it has no shape of its own to drag: no move cursor, and a press pans.
              className={`streak-body${s.subject ? ' fixed' : ''}`}
              d={shapePath(i, s.outline)}
              onPointerDown={(e) => {
                if (!(shapeH && !s.subject)) return
                if (e.shiftKey) return startMarquee(e)
                begin(e, { index: i, kind: 'body', start: toFrac(e.clientX, e.clientY), shape: s })
              }}
            >
              <title>{s.mode === 'mask' ? 'Mask — keeps this in front of the streaks; drag to move' : 'Streak shape — drag to move'}</title>
            </path>
            {on && s.mode !== 'mask' && fixesH && (s.fixes.length > 0 || placeDrag) && (() => {
              const flow = runOf(s, flowOf(s))
              const [px0, py0] = toCss({ x: 0, y: 0 })
              const [px1, py1] = toCss({ x: 1, y: 1 })
              const sel = editor.fixes?.selected ?? null
              const placing = editor.fixes?.placing ?? null
              // A new span being dragged out, or the selected fix's source.
              const shownFixes = s.fixes.map((f, k) =>
                placeDrag && placing === 'source' && k === sel ? { ...f, source: { a: placeDrag.a, b: placeDrag.b } } : f,
              )
              const drafts =
                placeDrag && placing === 'span' ? [{ ...placeDrag, reach: 1, side: 'both' as const, source: null, feather: 0 }] : []
              return (
                <>
                  {/* A trail runs out from its shape across the photo: the fixes are
                      shown along all of it; a fill's only inside its shape. */}
                  <defs>
                    <clipPath id={`streak-clip-${i}`}>
                      {s.mode === 'trail' ? (
                        <rect x={Math.min(px0, px1)} y={Math.min(py0, py1)} width={Math.abs(px1 - px0)} height={Math.abs(py1 - py0)} />
                      ) : (
                        <path d={shapePath(i, s.outline)} />
                      )}
                    </clipPath>
                  </defs>
                  <g clipPath={`url(#streak-clip-${i})`} className="streak-fixes">
                    {[...shownFixes, ...drafts].map((f, k) => {
                      const spans = fixSpans({ mode: 'borrow', ...f }, flow)
                      const draft = k >= s.fixes.length
                      return (
                        <g key={k} className={`streak-fix${k === sel || draft ? ' on' : ''}`}>
                          {(k === sel || draft) &&
                            spans.from.map(([lo, hi], j) => <path key={j} className="streak-fix-from" d={band(flow, lo, hi)} />)}
                          {spans.soft && <path className="streak-fix-soft" d={band(flow, spans.soft[0], spans.soft[1])} />}
                          <path className="streak-fix-span" d={band(flow, spans.span[0], spans.span[1])} />
                        </g>
                      )
                    })}
                    {/* The selected fix's two sides, and its picked part's: lines along
                        the streak, each dragged sideways to widen or narrow it. */}
                    {sel !== null &&
                      sel < s.fixes.length &&
                      !placeDrag &&
                      (() => {
                        const spans = fixSpans(s.fixes[sel], flow)
                        const lines: { end: 'a' | 'b' | 'sa' | 'sb'; t: number }[] = [
                          { end: 'a', t: spans.ta },
                          { end: 'b', t: spans.tb },
                          ...(spans.sides ? [{ end: 'sa' as const, t: spans.sides.sa }, { end: 'sb' as const, t: spans.sides.sb }] : []),
                        ]
                        return lines.map(({ end, t }) => {
                          const source = end === 'sa' || end === 'sb'
                          const d = alongLine(flow, t)
                          return (
                            <g key={end} className={source ? 'streak-fix-side source' : 'streak-fix-side'}>
                              <path className="streak-fix-side-line" d={d} />
                              <path
                                className="streak-fix-side-grab"
                                d={d}
                                onPointerDown={(e) => begin(e, { index: i, kind: 'fixEnd', fix: sel, end })}
                              >
                                <title>{source ? 'Drag sideways to change the part copied' : 'Drag sideways to widen or narrow the fix'}</title>
                              </path>
                            </g>
                          )
                        })
                      })()}
                  </g>
                </>
              )
            })()}
            {/* A mirrored streak's middle line, along its flow: dragged sideways. */}
            {on &&
              s.mode !== 'mask' &&
              s.mirror &&
              editor.tool === 'middle' &&
              !s.radial &&
              (() => {
                const flow = runOf(s, flowOf(s))
                const t = streakCoords(toShort(streakMirrorAt(s)), flow.dir, flow.followed, flow.vanish).t
                if (!Number.isFinite(t)) return null
                const d = alongLine(flow, t)
                return (
                  <g className="streak-mirror">
                    <path className="streak-mirror-line" d={d} />
                    <path className="streak-mirror-grab" d={d} onPointerDown={(e) => begin(e, { index: i, kind: 'mirror' })}>
                      <title>The middle the bars are mirrored about: drag it sideways</title>
                    </path>
                  </g>
                )
              })()}
            {/* A straight streak's side lines, out past the shape — through the
                vanishing point in perspective — with a handle on each: drag
                them onto the picture's own lines (a building's sides). */}
            {on &&
              dirH &&
              s.mode !== 'mask' &&
              // Bars from a middle (Radial, Circle) run from it: no side lines to lay on the picture's own.
              !s.radial &&
              !(s.path && s.path.length >= 2) &&
              (() => {
                const { flow, sides, sMin, out } = sideLines(s)
                const v = flow.vanish
                const inner = v
                  ? [0.25, 0.5, 0.75].map((f) => {
                      const t = sides[0].t + (sides[1].t - sides[0].t) * f
                      const end = v.g < 0 ? -0.002 : out
                      return [shortCss(streakPos(sMin - 0.03, t, flow.dir, null, v)), shortCss(streakPos(end, t, flow.dir, null, v))]
                    })
                  : []
                return (
                  <g className="streak-perspective">
                    {inner.map(([[x1, y1], [x2, y2]], k) => (
                      <line key={`in${k}`} className="inner" x1={x1} y1={y1} x2={x2} y2={y2} />
                    ))}
                    {sides.map((side, k) => {
                      const live = sidePointer && sidePointer.index === i && sidePointer.which === k ? sidePointer.p : null
                      const [x1, y1] = shortCss(side.from)
                      // In perspective the line runs on to the point itself.
                      const [x2, y2] = shortCss(v && v.g < 0 ? { x: v.x, y: v.y } : side.handle)
                      const [hx, hy] = shortCss(live ?? side.handle)
                      return (
                        <g key={k}>
                          <line x1={x1} y1={y1} x2={x2} y2={y2} />
                          <circle
                            className="streak-side-handle"
                            cx={hx}
                            cy={hy}
                            r={6}
                            onPointerDown={(e) =>
                              begin(e, {
                                index: i,
                                kind: 'side',
                                which: k as 0 | 1,
                                anchors: [sides[0].anchor, sides[1].anchor],
                                other: sides[1 - k].handle,
                                dir: flow.dir,
                              })
                            }
                          >
                            <title>Drag onto a line in the photo the streaks should follow; where the two side lines meet, they converge</title>
                          </circle>
                        </g>
                      )
                    })}
                  </g>
                )
              })()}
            {/* A trail's end line: where its bars run to. Straight lines between
                its points, as the engine reads it. */}
            {s.mode === 'trail' && s.ends && s.ends.length >= 2 && (!editor.tool || editor.tool === 'ends') && (
              <polyline className="streak-ends" points={s.ends.map((p) => toCss(p).join(',')).join(' ')} />
            )}
            {on &&
              endsH &&
              s.mode === 'trail' &&
              s.ends?.map((p, k) => {
                const [x, y] = toCss(p)
                return (
                  <circle
                    key={`end${k}`}
                    className="streak-end-point"
                    cx={x}
                    cy={y}
                    r={5}
                    onPointerDown={(e) => {
                      if (e.altKey && s.ends!.length > 2) {
                        e.stopPropagation()
                        gesture.current++
                        update(i, { ends: s.ends!.filter((_, j) => j !== k) })
                      } else begin(e, { index: i, kind: 'endPoint', point: k })
                    }}
                  >
                    <title>{keyWords("Drag to move where the bars end; Option-click to remove")}</title>
                  </circle>
                )
              })}
            {/* A mask has no direction of its own; a path replaces the arrow. */}
            {s.mode !== 'mask' && s.path && s.path.length >= 2 && (!editor.tool || editor.tool === 'path' || editor.tool === 'direction') && (
              <path className="streak-path" d={openPath(s.path)} markerEnd="url(#streak-path-end)" />
            )}
            {on && dirH && s.mode !== 'mask' && s.radial && !(s.path && s.path.length >= 2) && (() => {
              // Radial: its middle, to drag, and the circle the spokes read, if one is set.
              const xs = s.outline.map((o) => o.x)
              const ys = s.outline.map((o) => o.y)
              const mid = s.radialCentre ?? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
              const [mx, my] = toCss(mid)
              const r = s.radialRadius ?? 0
              const circleAt = (radius: number) =>
                radialCircle([], radius, toShort(mid), 72)
                  .map((q) => shortCss(q).join(','))
                  .join(' ')
              const ring = r > 0 ? circleAt(r) : null
              // Around with a Reach: where the rings stop.
              const inner = r > 0 ? r : (() => {
                const c = toShort(mid)
                const o = s.outline.map(toShort)
                return o.reduce((sum, p) => sum + Math.hypot(p.x - c.x, p.y - c.y), 0) / Math.max(o.length, 1)
              })()
              const outerRing = s.radialAround && (s.radialReach ?? 0) > 0 ? circleAt(inner + s.radialReach) : null
              return (
                <>
                  {ring && <polygon className="streak-radial-circle" points={ring} />}
                  {outerRing && <polygon className="streak-radial-circle outer" points={outerRing} />}
                  <circle className="streak-centre" cx={mx} cy={my} r={6} onPointerDown={(e) => begin(e, { index: i, kind: 'centre' })}>
                    <title>The middle the streaks run out from (or round): drag to move it</title>
                  </circle>
                </>
              )
            })()}
            {/* No arrow on a Circle: its bars run round its middle, whichever way it points. */}
            {dirH && s.mode !== 'mask' && !(s.path && s.path.length >= 2) && !(s.radial && s.radialAround) && (
              <>
                <line className="streak-arrow" x1={cx} y1={cy} x2={hx} y2={hy} />
                {/* Its middle bends it, as Photoshop's Path Blur does: the streak follows a curve from here on. */}
                {!s.radial && (
                  <circle
                    className="streak-bend"
                    cx={(cx + hx) / 2}
                    cy={(cy + hy) / 2}
                    r={5}
                    onPointerDown={(e) => begin(e, { index: i, kind: 'bend', from: c, to: cssFrac(hx, hy) })}
                  >
                    <title>Drag to bend the streak into a curve</title>
                  </circle>
                )}
                <circle className="streak-head" cx={hx} cy={hy} r={7} onPointerDown={(e) => begin(e, { index: i, kind: 'angle' })}>
                  <title>Drag to turn the streak direction</title>
                </circle>
                {lengthEnd && (
                  <>
                    <line className="streak-length-line" x1={lengthEnd.a[0]} y1={lengthEnd.a[1]} x2={lengthEnd.b[0]} y2={lengthEnd.b[1]} />
                    <rect
                      className="streak-length"
                      x={lengthEnd.b[0] - 5}
                      y={lengthEnd.b[1] - 5}
                      width={10}
                      height={10}
                      transform={`rotate(${s.angle} ${lengthEnd.b[0]} ${lengthEnd.b[1]})`}
                      onPointerDown={(e) => begin(e, { index: i, kind: 'length', from: lengthEnd.from, dir: lengthEnd.dir })}
                    >
                      <title>Drag to set how far the bars run (Length)</title>
                    </rect>
                  </>
                )}
              </>
            )}
            {on && (shapeH && !s.subject) && (() => {
              // The box round the shape: scale from its corners and sides,
              // turn it from the handle above.
              // Round the picked points, when there are some, to scale and turn just them.
              const only = pickedHere.length >= 2 ? pickedHere : undefined
              const boxed = only ? only.map((k) => s.outline[k]) : s.outline
              const xs = boxed.map((q) => q.x * print.width)
              const ys = boxed.map((q) => q.y * print.height)
              const box: Box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) }
              const [bx0, by0] = toCss({ x: box.x0 / print.width, y: box.y0 / print.height })
              const [bx1, by1] = toCss({ x: box.x1 / print.width, y: box.y1 / print.height })
              const mx = (bx0 + bx1) / 2
              const my = (by0 + by1) / 2
              // Off the top-right corner, clear of the direction arrow, which
              // runs out from the middle (often straight up, for a sky).
              const turnX = bx1 + 20
              const turnY = by0 - 20
              const centre = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 }
              const grips: [number, number][] = [
                [-1, -1], [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0],
              ]
              return (
                <g className={only ? 'streak-box picked' : 'streak-box'}>
                  <rect className="streak-box-line" x={bx0} y={by0} width={bx1 - bx0} height={by1 - by0} />
                  <line className="streak-box-line" x1={bx1} y1={by0} x2={turnX} y2={turnY} />
                  {grips.map(([gx, gy]) => {
                    // Side handles on a box too thin to tell them from its corners are left off.
                    if ((gx === 0 && bx1 - bx0 < 36) || (gy === 0 && by1 - by0 < 36)) return null
                    const x = gx < 0 ? bx0 : gx > 0 ? bx1 : mx
                    const y = gy < 0 ? by0 : gy > 0 ? by1 : my
                    return (
                      <rect
                        key={`${gx},${gy}`}
                        className="streak-scale"
                        x={x - 4.5}
                        y={y - 4.5}
                        width={9}
                        height={9}
                        style={{ cursor: SCALE_CURSOR[`${gx},${gy}`] }}
                        onPointerDown={(e) => begin(e, { index: i, kind: 'scale', handle: [gx, gy], box, shape: s, only })}
                      >
                        <title>
                          {gx && gy
                            ? 'Drag to scale the shape, keeping its proportions; Shift stretches freely, Option scales about its middle'
                            : 'Drag to stretch the shape this way; Option stretches about its middle'}
                        </title>
                      </rect>
                    )
                  })}
                  <circle
                    className="streak-rotate"
                    cx={turnX}
                    cy={turnY}
                    r={6}
                    onPointerDown={(e) => {
                      const P = toFrac(e.clientX, e.clientY)
                      begin(e, {
                        index: i,
                        kind: 'rotate',
                        centre,
                        start: Math.atan2(P.y * print.height - centre.y, P.x * print.width - centre.x),
                        shape: s,
                        only,
                      })
                    }}
                  >
                    <title>Drag to turn the shape and its streaks; Shift turns in 15° steps</title>
                  </circle>
                </g>
              )
            })()}
            {on && (shapeH && !s.subject) && (
              <path
                className="streak-edge"
                d={shapePath(i, s.outline)}
                onPointerDown={(e) => {
                  if (e.shiftKey) return startMarquee(e)
                  if (s.outline.length >= MAX_STREAK_POINTS) return
                  setPicked(null)
                  const p = toFrac(e.clientX, e.clientY)
                  const k = outlineInsert(s.outline, p)
                  // The new point and the drag that places it are one step.
                  begin(e, { index: i, kind: 'point', point: k })
                  update(i, { outline: [...s.outline.slice(0, k), p, ...s.outline.slice(k)] })
                }}
              >
                <title>Click the outline to add a point there; drag to place it</title>
              </path>
            )}
            {on && pathH && s.mode !== 'mask' && s.path && s.path.length >= 2 && (
              <path
                className="streak-edge"
                d={openPath(s.path)}
                onPointerDown={(e) => {
                  if (s.path!.length >= 16) return
                  const p = toFrac(e.clientX, e.clientY)
                  const k = pathInsert(s.path!, p)
                  begin(e, { index: i, kind: 'pathPoint', point: k })
                  update(i, { path: [...s.path!.slice(0, k), p, ...s.path!.slice(k)] })
                }}
              >
                <title>Click the path to add a point there</title>
              </path>
            )}
            {on &&
              pathH &&
              s.mode !== 'mask' &&
              s.path?.map((p, k) => {
                const [x, y] = toCss(p)
                return (
                  <circle
                    key={`path${k}`}
                    className="streak-path-point"
                    cx={x}
                    cy={y}
                    r={5}
                    onPointerDown={(e) => {
                      if (e.altKey) {
                        e.stopPropagation()
                        removePoint(i, k, 'pathPoint')
                      } else begin(e, { index: i, kind: 'pathPoint', point: k })
                    }}
                    onDoubleClick={() => removePoint(i, k, 'pathPoint')}
                  >
                    <title>{keyWords("Drag to bend the path; Option-click or double-click to remove")}</title>
                  </circle>
                )
              })}
            {on &&
              (shapeH && !s.subject) &&
              s.outline.map((p, k) => {
                const [x, y] = toCss(p)
                return (
                  <circle
                    key={k}
                    className={pickedSet.has(k) ? 'streak-point picked' : 'streak-point'}
                    cx={x}
                    cy={y}
                    // Traced outlines have many points: smaller handles keep the shape visible.
                    r={s.outline.length > 40 ? 3 : 5}
                    onPointerDown={(e) => {
                      if (e.shiftKey) {
                        e.stopPropagation()
                        togglePick(i, k)
                      } else if (e.altKey) {
                        e.stopPropagation()
                        removePoint(i, k, 'point')
                      } else if (pickedSet.has(k) && pickedHere.length > 1)
                        begin(e, { index: i, kind: 'points', points: pickedHere, start: toFrac(e.clientX, e.clientY), shape: s })
                      else {
                        setPicked(null)
                        begin(e, { index: i, kind: 'point', point: k })
                      }
                    }}
                    onDoubleClick={() => removePoint(i, k, 'point')}
                  >
                    <title>{keyWords("Drag to reshape; Shift-click or Shift-drag a box to pick several, then drag one to move them all; Option-click or double-click to remove")}</title>
                  </circle>
                )
              })}
          </g>
        )
      })}
      {editor.fixes?.placing && editor.selected !== null && (
        <rect
          className="streak-catcher fixing"
          x={-css.width * 0.5}
          y={-css.height * 0.5}
          width={css.width * 2}
          height={css.height * 2}
          onPointerDown={(e) => {
            capturePointer(e.target, e.pointerId)
            const p = toFrac(e.clientX, e.clientY)
            setPlaceDrag({ a: p, b: p })
          }}
          onPointerMove={(e) => {
            if (!placeDrag || !(e.buttons & 1)) return
            setPlaceDrag({ ...placeDrag, b: toFrac(e.clientX, e.clientY) })
          }}
          onPointerUp={(e) => {
            if (!placeDrag) return
            const b = toFrac(e.clientX, e.clientY)
            setPlaceDrag(null)
            editor.fixes?.onPlace(placeDrag.a, b)
          }}
        >
          <title>
            {editor.fixes?.placing === 'source' ? 'Drag across the streak, side to side, over the part to copy' : 'Drag across the streak, side to side, over the part to fix'}
          </title>
        </rect>
      )}
      {draft.length > 0 && (
        <g className="leak-draft">
          {editor.drawingEnds
            ? null
            : editor.drawingPath
              ? draft.length >= 2 && <path className="streak-path" d={openPath(draft)} markerEnd="url(#streak-path-end)" />
              : draft.length >= 3 && <path d={path(draft)} />}
          <polyline points={draft.map((p) => toCss(p).join(',')).join(' ')} />
          {draft.map((p, k) => {
            const [x, y] = toCss(p)
            return (
              <circle
                key={k}
                className="draft-point"
                cx={x}
                cy={y}
                // Traced strokes put points close together: smaller handles.
                r={draft.length > 40 ? 3.5 : 5}
                onPointerDown={(e) => {
                  // Grab a placed point to move it, rather than starting a stroke.
                  e.stopPropagation()
                  remember(draft)
                  moving.current = k
                  capturePointer(e.target, e.pointerId)
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation()
                  finish()
                }}
              >
                <title>Drag to move this point; double-click to close the shape</title>
              </circle>
            )
          })}
        </g>
      )}
      {marquee && (
        <rect
          className={marquee.remove ? 'streak-marquee remove' : 'streak-marquee'}
          x={Math.min(marquee.a[0], marquee.b[0])}
          y={Math.min(marquee.a[1], marquee.b[1])}
          width={Math.abs(marquee.b[0] - marquee.a[0])}
          height={Math.abs(marquee.b[1] - marquee.a[1])}
        />
      )}
    </svg>
  )
}
