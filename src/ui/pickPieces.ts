import type { Pick, PickBox, Selection } from '../ml/segment'

/**
 * Selecting by clicks, one piece at a time: each click is asked of the model
 * on its own, and what it finds is added to the selection (a click) or taken
 * out of it (a click to leave out); the box, if any, is a piece too. Asking
 * the model about every click at once had it rethink the whole selection at
 * each one, so adding a cloud could lose the one beside it.
 */
export interface Piece {
  /** What the model found for it. */
  sel: Selection
  /** Which of its readings (Small, Medium, Large) is used. */
  reading: number
}

/** The key a click or box is kept under, so a piece already found isn't asked again (Undo, Redo, another reading). */
export const clickKey = (p: Pick) => `${p.x.toFixed(5)},${p.y.toFixed(5)}`
export const boxKey = (b: PickBox) => `box:${b.x0.toFixed(5)},${b.y0.toFixed(5)},${b.x1.toFixed(5)},${b.y1.toFixed(5)}`

/** A selection already there (the mask being selected again), as a grid over the photo. */
export interface BaseGrid {
  grid: Uint8Array
  width: number
  height: number
}

/** The grid at another size, by nearest cell. */
function resample(grid: Uint8Array, w: number, h: number, W: number, H: number): Uint8Array {
  if (w === W && h === H) return grid
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    const sy = Math.min(h - 1, Math.floor(((y + 0.5) * h) / H)) * w
    for (let x = 0; x < W; x++) out[y * W + x] = grid[sy + Math.min(w - 1, Math.floor(((x + 0.5) * w) / W))]
  }
  return out
}

/**
 * The selection the pieces make, in order: the base, then the box, then each
 * click adding what it found or taking it out. At the finest of their sizes.
 * Null when there is nothing yet.
 */
export function combinePieces(
  steps: { piece: Piece; on: boolean }[],
  base: BaseGrid | null,
): Selection | null {
  const all = [...(base ? [{ width: base.width, height: base.height }] : []), ...steps.map((s) => s.piece.sel)]
  if (!all.length) return null
  // The finest: the largest grid among them.
  const top = all.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
  const W = top.width
  const H = top.height
  const grid = base ? Uint8Array.from(resample(base.grid, base.width, base.height, W, H), (v) => (v ? 1 : 0)) : new Uint8Array(W * H)
  for (const { piece, on } of steps) {
    const s = piece.sel
    const m = resample(s.masks[Math.min(piece.reading, s.masks.length - 1)], s.width, s.height, W, H)
    if (on) for (let i = 0; i < grid.length; i++) grid[i] = grid[i] || m[i] ? 1 : 0
    else for (let i = 0; i < grid.length; i++) if (m[i]) grid[i] = 0
  }
  const pieces = steps.map((s) => s.piece.sel)
  return {
    width: W,
    height: H,
    masks: [grid],
    scores: [1],
    best: 0,
    // Tidied as precise selection's are only if every piece came from it.
    precise: pieces.length > 0 && pieces.every((s) => s.precise),
    sharp: pieces.some((s) => s.sharp),
  }
}
