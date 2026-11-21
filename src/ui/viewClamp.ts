/**
 * Where the preview may be panned. The view can go past the photo's edges,
 * to reach what is drawn off it (vanishing points, streak ends), but never so
 * far that the photo leaves it: in each axis the photo and the view overlap
 * by at least the photo's own extent or MIN_OVERLAP of the view's, whichever
 * is less. A photo smaller than that stays wholly in view.
 */
export const MIN_OVERLAP = 0.3

export interface Pan {
  x: number
  y: number
}

interface Extent {
  width: number
  height: number
}

/**
 * The nearest pan to `pan` that keeps the overlap. `pan` is the view's
 * top-left and `view` its size, both in photo pixels at the current scale;
 * the photo spans 0 to `photo` in each axis.
 */
export function clampPan(pan: Pan, photo: Extent, view: Extent): Pan {
  const axis = (v: number, size: number, span: number) => {
    const need = Math.min(size, span * MIN_OVERLAP)
    return Math.min(size - need, Math.max(need - span, v))
  }
  return { x: axis(pan.x, photo.width, view.width), y: axis(pan.y, photo.height, view.height) }
}

/** The pan that puts the photo in the middle of the view. */
export function centredPan(photo: Extent, view: Extent): Pan {
  return { x: (photo.width - view.width) / 2, y: (photo.height - view.height) / 2 }
}

/** How much of the photo and the view overlap in each axis, in photo pixels. */
export function overlapOf(pan: Pan, photo: Extent, view: Extent): Pan {
  const axis = (v: number, size: number, span: number) => Math.min(v + span, size) - Math.max(v, 0)
  return { x: axis(pan.x, photo.width, view.width), y: axis(pan.y, photo.height, view.height) }
}
