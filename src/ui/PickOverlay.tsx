import { outlineRuns } from '../engine/maskShapes'
import type { MaskRaster, Rect, Size } from '../engine/types'
import { toView } from './lensView'
import { RasterTintImage } from './RasterTint'
import type { Pick } from '../ml/segment'

export interface Picker {
  picks: Pick[]
  /** The selection so far, fractions of `shapeFrame` (as mask outlines are). */
  outline: { x: number; y: number }[] | null
  /** The selection so far as itself, when it is kept as a grid (a subject mask). */
  raster?: MaskRaster | null
  busy: boolean
  /** Plain clicks leave out (Option then adds). */
  leaveOut?: boolean
  /** A click on the photo, fractions of the photo: on, or (Option) to leave out. */
  onPick: (x: number, y: number, on: boolean) => void
  /** A click on a pick already made takes it away. */
  onUnpick: (index: number) => void
  /** A box dragged round the subject, fractions of the photo. */
  box?: { x0: number; y0: number; x1: number; y1: number } | null
  onBox?: (box: { x0: number; y0: number; x1: number; y1: number }) => void
}

interface Props {
  picker: Picker
  /** Where the photo sits in the print, print pixels: the picks are fractions of it. */
  photo: Rect
  /** What the outline is a fraction of, print pixels. */
  shapes: Rect
  /** The part of the print on screen, print pixels. */
  region: Rect
  css: Size
}

/** Selecting a subject by clicking it: the selection so far, and where was clicked. */
export function PickOverlay({ picker, photo, shapes, region, css }: Props) {
  const sx = css.width / region.width
  const sy = css.height / region.height
  const toScreen = (frame: Rect, p: { x: number; y: number }) => {
    const v = toView({ x: frame.x + p.x * frame.width, y: frame.y + p.y * frame.height })
    return [(v.x - region.x) * sx, (v.y - region.y) * sy]
  }
  // A selection of several parts: each part's own outline, without the bridges between them (outlineRuns).
  const path = picker.outline
    ? (() => {
        const { runs, closed } = outlineRuns(picker.outline)
        return runs.map((run) => run.map((p, i) => `${i ? 'L' : 'M'}${toScreen(shapes, p).map((v) => v.toFixed(1)).join(' ')}`).join(' ') + (closed ? ' Z' : '')).join(' ')
      })()
    : null
  return (
    <svg className={`pick-overlay${picker.busy ? ' busy' : ''}`} width={css.width} height={css.height} viewBox={`0 0 ${css.width} ${css.height}`}>
      {picker.raster ? (
        <RasterTintImage raster={picker.raster} shapes={shapes} region={region} css={css} />
      ) : (
        path && <path className="pick-fill" d={path} fillRule="evenodd" />
      )}
      {picker.box && (() => {
        const [x0, y0] = toScreen(photo, { x: picker.box.x0, y: picker.box.y0 })
        const [x1, y1] = toScreen(photo, { x: picker.box.x1, y: picker.box.y1 })
        return <rect className="pick-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      })()}
      {picker.picks.map((p, i) => {
        const [x, y] = toScreen(photo, p)
        return (
          <g key={i} className={`pick-dot ${p.on ? 'on' : 'off'}`} transform={`translate(${x} ${y})`}>
            <circle r={7} />
            <path d={p.on ? 'M-3.5 0H3.5M0 -3.5V3.5' : 'M-3.5 0H3.5'} />
          </g>
        )
      })}
    </svg>
  )
}

/** Index of the pick within `radius` css pixels of a screen point, or -1. */
export function pickNear(picks: Pick[], photo: Rect, region: Rect, css: Size, sxPx: number, syPx: number, radius = 9): number {
  const sx = css.width / region.width
  const sy = css.height / region.height
  return picks.findIndex((p) => {
    const v = toView({ x: photo.x + p.x * photo.width, y: photo.y + p.y * photo.height })
    const x = (v.x - region.x) * sx
    const y = (v.y - region.y) * sy
    return Math.hypot(x - sxPx, y - syPx) <= radius
  })
}
