/** A point, in fractions of the frame masks are kept in (see shapeFrame). */
export interface RepeatPoint {
  x: number
  y: number
}

/**
 * Repeat: a piece of the photo, cut out by one of its masks, copied — along a
 * grid, along a drawn path, or wherever it is placed. The copies go into the
 * photo before every other effect (engine/repeat.ts), so colour, grain and
 * streaks treat them as the rest of the picture.
 */
export interface RepeatParams {
  /** Which repeat this is in the module's list (missing in edits from before there could be more than one). */
  id?: string
  /** Its own switch in the list: off, it is kept but copies nothing. */
  enabled: boolean
  /** The mask whose piece of the photo is copied: a drawn outline or a selection. */
  source: string | null
  layout: 'grid' | 'path' | 'placed'
  /** Grid: copies across (+ right, - left) and up (+ up, - down) from the piece. */
  across: number
  up: number
  /**
   * Grid, before Spacing: room between copies, a share of the piece's own
   * width and height (0 touching, below overlapping), each step also
   * scaled by the copies' sizes. Used only while `spacing` is unset (an
   * edit made before it), so such an edit looks as it did.
   */
  gapX: number
  gapY: number
  /**
   * How far each copy is from the one before, first to last: a share of
   * the piece's own size along the way they go (100%: side by side, less:
   * overlapping), whatever size the copies are. Along a path, how the
   * copies are spread along it: bigger, further apart there.
   */
  spacing?: [number, number]
  /**
   * Fitted to the photo once there is a piece (fitRepeat): the copies go
   * the way there is room, and are spaced so the last reaches the edge
   * (reach), or only brought closer if they would run off it (within);
   * any: as reach, along whichever way (up or across) has most room for
   * the piece's size.
   * Ready-made starts and a new Repeat ask for it; App does it and clears it.
   */
  fitPending?: 'reach' | 'within' | 'any'
  /** Grid: every other row (or column, going up) moved along by this share of a step. */
  stagger: number
  /** Grid: copies on both sides of the piece (left and right, above and below), the piece in the middle. */
  both?: boolean
  /** Grid, both sides: those on the other side (left, below) mirrored, as a reflection. */
  mirror?: boolean
  /** Grid: its rows and columns turned this many degrees (clockwise): the line the copies run along. */
  angle?: number
  /**
   * Grid, one row or column: the copies run toward this point (fractions of
   * the frame masks are in), each the piece made smaller about it, as the
   * piece's own lines carry on in perspective: a building going up for ever,
   * its sides meeting there. Null: no perspective.
   */
  vanish?: RepeatPoint | null
  /** Path: its points; the copies are spread evenly along it, start to end. */
  path: RepeatPoint[]
  count: number
  /** Path: copies turn as the path does. */
  followPath: boolean
  /** Path: straight lines between its points, corners and all, instead of a smooth curve through them. */
  straight?: boolean
  /**
   * Path: where the piece is on it. 'start': the path starts at the piece,
   * and the copies run on from it. 'middle': the path runs through the
   * piece, and the copies go both ways from it, toward each end.
   * 'off': the path is apart from it, the first copy at its first point.
   */
  pieceOnPath: 'start' | 'middle' | 'off'
  /**
   * With the piece in the middle of its path, which way first to last goes:
   * 'out' from the piece both ways, a step out the same on either side (the
   * shorter side stops sooner); 'along' from the path's start to its end,
   * through the piece; 'back' from its end to its start. Missing: 'out'.
   */
  firstToLast?: 'out' | 'along' | 'back'
  /** Placed: each copy's middle, in the order placed. */
  placed: RepeatPoint[]
  /**
   * Across the copies, first to last: size (a share of the piece's), turn
   * (degrees), opacity (a share). The copies between go evenly from one to
   * the other; the piece itself is as it is.
   */
  size: [number, number]
  turn: [number, number]
  opacity: [number, number]
  /**
   * How the turn goes from the first copy to the last: 0 evenly; toward 1
   * most of it at the end (the copies twist faster and faster), toward -1
   * most at the start.
   */
  turnEase?: number
  /** Copies behind the piece itself, which stays in front of them. */
  behind: boolean
  blend: 'normal' | 'lighten' | 'darken' | 'screen' | 'multiply'
}

export const DEFAULT_REPEAT: RepeatParams = {
  enabled: false,
  source: null,
  layout: 'grid',
  across: 0,
  up: 3,
  gapX: 0,
  gapY: 0,
  spacing: [1, 1],
  fitPending: 'any',
  stagger: 0,
  path: [],
  count: 5,
  followPath: false,
  pieceOnPath: 'start',
  placed: [],
  size: [1, 1],
  turn: [0, 0],
  opacity: [1, 0.45],
  behind: true,
  blend: 'normal',
}

/**
 * The Repeat module: its switch, and its repeats, each with its own piece
 * and its own way of copying it. They go into the photo the first in the list in front, each
 * cutting its piece from the photo as it was taken (not from copies before it).
 */
export interface RepeatModule {
  enabled: boolean
  items: RepeatParams[]
}

export const DEFAULT_REPEAT_MODULE: RepeatModule = { enabled: false, items: [] }

/** Room for this many repeats (each has its own piece, and masks are limited). */
export const MAX_REPEATS = 6

/** A new repeat for the list: on, and fitted to its piece once it has one. */
export const newRepeat = (id: string): RepeatParams => ({ ...DEFAULT_REPEAT, id, enabled: true })

/** Whether the Repeat module is doing anything: on, with at least one repeat copying. */
export function repeatsActive(m: RepeatModule | undefined, maskIds: string[]): boolean {
  return !!m?.enabled && m.items.some((r) => repeatActive(r, maskIds))
}

/** Whether one repeat is doing anything: on, with a piece and somewhere to copy it. */
export function repeatActive(r: RepeatParams | undefined, maskIds: string[]): boolean {
  if (!r || !r.enabled || !r.source || !maskIds.includes(r.source)) return false
  if (r.layout === 'grid') return r.across !== 0 || r.up !== 0
  if (r.layout === 'path') return r.path.length >= (r.pieceOnPath === 'off' ? 2 : 1) && r.count > 0
  return r.placed.length > 0
}

/** How many copies a repeat makes, all told (the grid's whole grid, both sides counted). */
export function repeatCopyCount(r: RepeatParams): number {
  if (r.layout === 'grid') {
    const sides = r.both ? 2 : 1
    return (Math.abs(r.across) * sides + 1) * (Math.abs(r.up) * sides + 1) - 1
  }
  return r.layout === 'path' ? r.count : r.placed.length
}

/** How many copies there are, for spreading a setting first to last: the grid's furthest ring, the path's count, the copies placed. */
export function copySpan(r: RepeatParams): number {
  if (r.layout === 'grid') return Math.max(1, Math.round(Math.abs(r.across)), Math.round(Math.abs(r.up)))
  if (r.layout === 'path') return Math.max(1, Math.round(r.count))
  return Math.max(1, r.placed.length)
}

/** Copy `n`'s spacing from the one before (Spacing, first to last). */
export function copySpacing(r: RepeatParams, n: number, span: number): number {
  const s = r.spacing ?? [1, 1]
  const t = span > 1 ? Math.min(1, Math.max(0, (n - 1) / (span - 1))) : 0
  return Math.max(0.02, s[0] + (s[1] - s[0]) * t)
}

/**
 * Repeat fitted to its piece (its box, fractions of the photo): a grid's
 * copies turned the way there is more room (unless `keepWay`), and Spacing
 * scaled (first to last as it is) so the last copy just reaches the
 * photo's edge, whole; `within`, only made smaller, if they would run off.
 * Nothing when there is no room that way.
 */
export function fitRepeat(r: RepeatParams, box: { x: number; y: number; width: number; height: number }, keepWay = false, within = false, anyWay = false): Partial<RepeatParams> {
  // In perspective the copies close in on their point by themselves; turned, the edges are not the box's.
  if (r.layout !== 'grid' || r.vanish || Math.abs(r.angle ?? 0) > 0.5) return {}
  let { across, up } = r
  // A single row or column, along whichever way has more room in pieces.
  if (anyWay && (across === 0) !== (up === 0)) {
    const n = Math.abs(across || up)
    const side = Math.max(box.x, 1 - box.x - box.width) / Math.max(box.width, 1e-3)
    const tall = Math.max(box.y, 1 - box.y - box.height) / Math.max(box.height, 1e-3)
    across = side > tall ? n : 0
    up = side > tall ? 0 : n
  }
  if (!keepWay && !r.both) {
    if (across !== 0) across = Math.abs(across) * (1 - (box.x + box.width) >= box.x ? 1 : -1)
    if (up !== 0) up = Math.abs(up) * (box.y >= 1 - (box.y + box.height) ? 1 : -1)
  }
  const span = Math.max(1, Math.round(Math.abs(across)), Math.round(Math.abs(up)))
  const base = r.spacing ?? [1, 1]
  const at = { ...r, spacing: base, across, up }
  const last = copyLook(at, span, span).scale
  // Each way: how far the last copy's middle can go, over the steps there, in pieces.
  const way = (n: number, sign: number, lo: number, size: number) => {
    const steps = Math.round(Math.abs(n))
    if (!steps) return Infinity
    const c = lo + size / 2
    const reach = sign > 0 ? 1 - (last * size) / 2 - c : c - (last * size) / 2
    let sum = 0
    for (let k = 1; k <= steps; k++) sum += copySpacing(at, k, span)
    return reach > 0 ? reach / size / sum : 0
  }
  // Both sides: whichever side has less room.
  const each = (n: number, sign: number, lo: number, size: number) => (r.both ? Math.min(way(n, 1, lo, size), way(n, -1, lo, size)) : way(n, sign, lo, size))
  const f = Math.min(each(across, Math.sign(across), box.x, box.width), each(up, -Math.sign(up), box.y, box.height), within ? 1 : Infinity)
  // So little room this way they would all but sit on each other: the other way, if it has more.
  if (!keepWay && !anyWay && !within && f < 0.25 && (r.across === 0) !== (r.up === 0)) {
    const other = fitRepeat(r, box, false, false, true)
    if ((other.across !== 0) !== (across !== 0)) return other
  }
  if (!Number.isFinite(f) || f <= 0) return { across, up }
  // Kept within Spacing's own range (5% to 300%), so its slider shows where it is: a small piece
  // with room to spare stops at 300% rather than reaching the edge.
  const round = (v: number) => Math.round(Math.min(3, Math.max(0.05, v)) * 100) / 100
  return { across, up, spacing: [round(base[0] * f), round(base[1] * f)] }
}

/** Copy `n` (1 the first) of `span`: its size, turn (degrees) and opacity. */
export function copyLook(r: RepeatParams, n: number, span: number): { scale: number; turn: number; opacity: number } {
  const t = span > 1 ? Math.min(1, Math.max(0, (n - 1) / (span - 1))) : 0
  const mix = (v: [number, number], at = t) => v[0] + (v[1] - v[0]) * at
  // The turn eased: faster toward the end (or the start).
  const e = Math.max(-1, Math.min(1, r.turnEase ?? 0))
  const tt = e > 0 ? Math.pow(t, 1 + 3 * e) : e < 0 ? 1 - Math.pow(1 - t, 1 - 3 * e) : t
  return { scale: Math.min(3, Math.max(0.05, mix(r.size))), turn: mix(r.turn, tt), opacity: Math.min(1, Math.max(0, mix(r.opacity))) }
}
