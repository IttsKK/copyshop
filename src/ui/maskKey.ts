import { rasterCover } from './maskBrush'
import { maskKind } from '../engine/maskShapes'
import type { MaskShape, Rect } from '../engine/types'
import { distanceTo } from '../ml/trace'

import { KEY_BAND } from '../engine/maskCover'

export { KEY_BAND }

export interface FoundKey {
  keyOn: 'brightness' | 'blue'
  key: 'darker' | 'lighter'
  keyLevel: number
  keySoftness: number
  /** How cleanly the photo splits there, 0 (not at all) to 1 (perfectly). */
  score: number
}

/**
 * The tone key that best tells a mask's subject from what is round it, read
 * from the photo in a band along the mask's edge: brightness or blue, the
 * subject darker or lighter, and where to cut. The mask there is only rough,
 * so it is the bulk of each side that counts: the cut that gets the fewest
 * of either side wrong, each side weighed alike.
 *
 * `photoFrame` and `shapeFrame` are the photo's frame and the frame masks
 * are kept in (see App's photoFrameOf and shapeFrame).
 */
export function findKey(
  bitmap: ImageBitmap,
  m: MaskShape,
  photoFrame: Rect,
  shapeFrame: Rect,
  band = KEY_BAND,
): FoundKey | null {
  const kind = maskKind(m)
  if (kind !== 'outline' && kind !== 'subject') return null
  const LONG = 640
  const k = LONG / Math.max(bitmap.width, bitmap.height)
  const w = Math.max(8, Math.round(bitmap.width * k))
  const h = Math.max(8, Math.round(bitmap.height * k))
  const photo = new OffscreenCanvas(w, h)
  const pc = photo.getContext('2d', { willReadFrequently: true })!
  pc.drawImage(bitmap, 0, 0, w, h)
  const px = pc.getImageData(0, 0, w, h).data

  // The mask over the photo, at the same size: shape fractions to photo pixels.
  const toX = (x: number) => ((shapeFrame.x + x * shapeFrame.width - photoFrame.x) / photoFrame.width) * w
  const toY = (y: number) => ((shapeFrame.y + y * shapeFrame.height - photoFrame.y) / photoFrame.height) * h
  const cover = new OffscreenCanvas(w, h)
  const cc = cover.getContext('2d', { willReadFrequently: true })!
  if (m.raster) {
    const r = m.raster
    const grid = rasterCover(r)
    const cells = new OffscreenCanvas(r.w, r.h)
    const img = new ImageData(r.w, r.h)
    for (let i = 0; i < grid.length; i++) if (grid[i]) img.data[i * 4 + 3] = 255
    cells.getContext('2d')!.putImageData(img, 0, 0)
    cc.drawImage(cells, toX(r.x), toY(r.y), toX(r.x + r.width) - toX(r.x), toY(r.y + r.height) - toY(r.y))
  } else {
    const path = new Path2D()
    m.outline.forEach((p, i) => (i ? path.lineTo(toX(p.x), toY(p.y)) : path.moveTo(toX(p.x), toY(p.y))))
    path.closePath()
    cc.fillStyle = '#000'
    cc.fill(path, 'evenodd')
  }
  const alpha = cc.getImageData(0, 0, w, h).data
  const inside = new Uint8Array(w * h)
  let count = 0
  for (let i = 0; i < inside.length; i++) if (alpha[i * 4 + 3] > 127) {
    inside[i] = 1
    count++
  }
  if (count < 16 || count > inside.length - 16) return null
  const toOut = distanceTo(inside, w, h, 0)
  const toIn = distanceTo(inside, w, h, 1)
  const reach = Math.max(3, band * Math.min(w, h))

  // Each side's values in the band, as 256-bin histograms, for each measure.
  const hist = { brightness: [new Float64Array(256), new Float64Array(256)], blue: [new Float64Array(256), new Float64Array(256)] }
  let nIn = 0
  let nOut = 0
  for (let i = 0; i < inside.length; i++) {
    const near = inside[i] ? toOut[i] : toIn[i]
    if (near > reach) continue
    const r = px[i * 4]
    const g = px[i * 4 + 1]
    const b = px[i * 4 + 2]
    const side = inside[i] ? 0 : 1
    hist.brightness[side][Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b)]++
    hist.blue[side][b]++
    if (side) nOut++
    else nIn++
  }
  if (nIn < 16 || nOut < 16) return null

  let best: FoundKey | null = null
  for (const keyOn of ['brightness', 'blue'] as const) {
    const [hi, ho] = hist[keyOn]
    // Running shares of each side at or below each level.
    let ci = 0
    let co = 0
    for (let t = 0; t < 255; t++) {
      ci += hi[t] / nIn
      co += ho[t] / nOut
      // Subject darker: it should be below the cut, the rest above.
      const darkerWrong = (1 - ci + co) / 2
      const lighterWrong = (ci + 1 - co) / 2
      const wrong = Math.min(darkerWrong, lighterWrong)
      const score = 1 - 2 * wrong
      if (!best || score > best.score)
        best = { keyOn, key: darkerWrong <= lighterWrong ? 'darker' : 'lighter', keyLevel: (t + 0.5) / 255, keySoftness: 0.03, score }
    }
  }
  return best
}

/**
 * How an open mask shows on the photo (RenderRequest.showMask, drawn by the
 * render itself): a red or green wash with a white line along its edge,
 * either standing out against most photos; or the mask alone, white where it
 * covers, black where it does not, the photo hidden.
 */
export type MaskView = 'red' | 'green' | 'matte'
