/**
 * An 8-bit RGB TIFF writer, in TypeScript so it works the same in every
 * webview: Deflate compression (CompressionStream, the zlib format TIFF's
 * compression 8 is) with the horizontal predictor, which is lossless and
 * what Photoshop, Lightroom and Affinity write and read. Little-endian, one
 * image, in strips. The render is read back from an 8-bit canvas, so 8 bits
 * a channel is all there is to write.
 *
 * The edit is added afterwards by storage/recipe.ts, in a private tag.
 */
export interface PixelRows {
  width: number
  height: number
  /** `count` rows from row `y`, RGBA, 4 bytes a pixel. */
  rows(y: number, count: number): Uint8Array | Uint8ClampedArray
}

/** About this many bytes of pixels a strip. */
const STRIP_BYTES = 512 * 1024
/** Strips compressed at once. */
const IN_FLIGHT = 4

const canDeflate = () => typeof CompressionStream !== 'undefined'

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** RGBA rows as RGB, each byte the difference from the same channel of the pixel before (predictor 2). */
export function predictRows(rgba: Uint8Array | Uint8ClampedArray, width: number, rows: number, predict: boolean): Uint8Array {
  const out = new Uint8Array(width * rows * 3)
  for (let r = 0; r < rows; r++) {
    let i = r * width * 4
    let o = r * width * 3
    let pr = 0
    let pg = 0
    let pb = 0
    for (let x = 0; x < width; x++, i += 4, o += 3) {
      const red = rgba[i]
      const green = rgba[i + 1]
      const blue = rgba[i + 2]
      if (predict) {
        out[o] = red - pr
        out[o + 1] = green - pg
        out[o + 2] = blue - pb
        pr = red
        pg = green
        pb = blue
      } else {
        out[o] = red
        out[o + 1] = green
        out[o + 2] = blue
      }
    }
  }
  return out
}

interface Entry {
  tag: number
  type: number
  count: number
  /** The value's bytes, little-endian; out of line when more than 4. */
  bytes: Uint8Array
}

const SHORT = 3
const LONG = 4
const RATIONAL = 5
const ASCII = 2

const le16 = (...v: number[]) => {
  const b = new Uint8Array(v.length * 2)
  const d = new DataView(b.buffer)
  v.forEach((x, i) => d.setUint16(i * 2, x, true))
  return b
}
const le32 = (...v: number[]) => {
  const b = new Uint8Array(v.length * 4)
  const d = new DataView(b.buffer)
  v.forEach((x, i) => d.setUint32(i * 4, x >>> 0, true))
  return b
}

export async function encodeTiff(src: PixelRows, software = 'copyshop'): Promise<Uint8Array<ArrayBuffer>> {
  const { width, height } = src
  const compress = canDeflate()
  const rowsPerStrip = Math.max(1, Math.min(height, Math.floor(STRIP_BYTES / (width * 3))))
  const stripCount = Math.ceil(height / rowsPerStrip)
  const strips: Uint8Array[] = new Array(stripCount)
  // Read in order (the canvas), compressed a few at a time.
  const pending: Promise<void>[] = []
  for (let s = 0; s < stripCount; s++) {
    const y = s * rowsPerStrip
    const rows = Math.min(rowsPerStrip, height - y)
    const raw = predictRows(src.rows(y, rows), width, rows, compress)
    if (!compress) {
      strips[s] = raw
      continue
    }
    pending.push(deflate(raw).then((d) => void (strips[s] = d)))
    if (pending.length >= IN_FLIGHT) await pending.shift()
  }
  await Promise.all(pending)

  // Header, strips, then the values too long for an entry, then the IFD.
  let at = 8
  const offsets: number[] = []
  for (const strip of strips) {
    offsets.push(at)
    at += strip.length
  }
  const entries: Entry[] = [
    { tag: 256, type: LONG, count: 1, bytes: le32(width) },
    { tag: 257, type: LONG, count: 1, bytes: le32(height) },
    { tag: 258, type: SHORT, count: 3, bytes: le16(8, 8, 8) },
    { tag: 259, type: SHORT, count: 1, bytes: le16(compress ? 8 : 1) },
    { tag: 262, type: SHORT, count: 1, bytes: le16(2) },
    { tag: 273, type: LONG, count: stripCount, bytes: le32(...offsets) },
    { tag: 274, type: SHORT, count: 1, bytes: le16(1) },
    { tag: 277, type: SHORT, count: 1, bytes: le16(3) },
    { tag: 278, type: LONG, count: 1, bytes: le32(rowsPerStrip) },
    { tag: 279, type: LONG, count: stripCount, bytes: le32(...strips.map((s) => s.length)) },
    { tag: 282, type: RATIONAL, count: 1, bytes: le32(72, 1) },
    { tag: 283, type: RATIONAL, count: 1, bytes: le32(72, 1) },
    { tag: 284, type: SHORT, count: 1, bytes: le16(1) },
    { tag: 296, type: SHORT, count: 1, bytes: le16(2) },
    { tag: 305, type: ASCII, count: software.length + 1, bytes: new TextEncoder().encode(`${software}\0`) },
    ...(compress ? [{ tag: 317, type: SHORT, count: 1, bytes: le16(2) }] : []),
  ]
  const { ifd, extra, ifdAt } = layoutIfd(entries, at, 0)
  const out = new Uint8Array(ifdAt + ifd.length)
  out.set([0x49, 0x49, 42, 0])
  new DataView(out.buffer).setUint32(4, ifdAt, true)
  for (let s = 0; s < stripCount; s++) out.set(strips[s], offsets[s])
  out.set(extra, at)
  out.set(ifd, ifdAt)
  return out
}

/**
 * An IFD for `entries` (sorted here) whose long values start at `at`: those
 * values (each on a word boundary), then the IFD, pointing on to `next`.
 */
function layoutIfd(entries: Entry[], at: number, next: number): { extra: Uint8Array; ifd: Uint8Array; ifdAt: number } {
  entries = [...entries].sort((a, b) => a.tag - b.tag)
  const where = new Map<Entry, number>()
  let size = at & 1
  for (const e of entries) {
    if (e.bytes.length <= 4) continue
    where.set(e, size)
    size += e.bytes.length + (e.bytes.length & 1)
  }
  const extra = new Uint8Array(size)
  for (const [e, p] of where) extra.set(e.bytes, p)
  const ifdAt = at + size
  const ifd = new Uint8Array(2 + entries.length * 12 + 4)
  const d = new DataView(ifd.buffer)
  d.setUint16(0, entries.length, true)
  entries.forEach((e, i) => {
    const o = 2 + i * 12
    d.setUint16(o, e.tag, true)
    d.setUint16(o + 2, e.type, true)
    d.setUint32(o + 4, e.count, true)
    if (e.bytes.length > 4) d.setUint32(o + 8, at + where.get(e)!, true)
    else ifd.set(e.bytes, o + 8)
  })
  d.setUint32(2 + entries.length * 12, next, true)
  return { extra, ifd, ifdAt }
}

// --- a tag added to, or read from, a TIFF's first IFD -----------------------

const isTiff = (b: Uint8Array) => b.length >= 8 && ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 42 && b[3] === 0) || (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0 && b[3] === 42))

/** The first IFD's entries (12 bytes each, as stored), and where it points on to. */
function firstIfd(b: Uint8Array): { le: boolean; entries: Uint8Array[]; next: number } | null {
  if (!isTiff(b)) return null
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const le = b[0] === 0x49
  const at = d.getUint32(4, le)
  if (at + 2 > b.length) return null
  const n = d.getUint16(at, le)
  if (at + 2 + n * 12 + 4 > b.length) return null
  const entries = Array.from({ length: n }, (_, i) => b.subarray(at + 2 + i * 12, at + 14 + i * 12))
  return { le, entries, next: d.getUint32(at + 2 + n * 12, le) }
}

const UNDEFINED = 7

/**
 * The TIFF with `value` in tag `tag` of its first IFD (as UNDEFINED bytes),
 * replacing one there already; null if it isn't a TIFF. The value and a new
 * IFD go at the end, so every offset already in the file stays right.
 */
export function tiffWithTag(bytes: Uint8Array, tag: number, value: Uint8Array): Uint8Array<ArrayBuffer> | null {
  const ifd = firstIfd(bytes)
  if (!ifd) return null
  const { le } = ifd
  const tagOf = (e: Uint8Array) => new DataView(e.buffer, e.byteOffset, 12).getUint16(0, le)
  const valueAt = bytes.length + (bytes.length & 1)
  const ifdAt = valueAt + value.length + (value.length & 1)
  const mine = new Uint8Array(12)
  const m = new DataView(mine.buffer)
  m.setUint16(0, tag, le)
  m.setUint16(2, UNDEFINED, le)
  m.setUint32(4, value.length, le)
  if (value.length <= 4) mine.set(value, 8)
  else m.setUint32(8, valueAt, le)
  const entries = [...ifd.entries.filter((e) => tagOf(e) !== tag), mine].sort((a, b) => tagOf(a) - tagOf(b))
  const out = new Uint8Array(ifdAt + 2 + entries.length * 12 + 4)
  const d = new DataView(out.buffer)
  out.set(bytes)
  if (value.length > 4) out.set(value, valueAt)
  d.setUint16(ifdAt, entries.length, le)
  entries.forEach((e, i) => out.set(e, ifdAt + 2 + i * 12))
  d.setUint32(ifdAt + 2 + entries.length * 12, ifd.next, le)
  d.setUint32(4, ifdAt, le)
  return out
}

/** The bytes of tag `tag` in a TIFF's first IFD, or null. */
export function tiffTag(bytes: Uint8Array, tag: number): Uint8Array | null {
  const ifd = firstIfd(bytes)
  if (!ifd) return null
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 }
  for (const e of ifd.entries) {
    const d = new DataView(e.buffer, e.byteOffset, 12)
    if (d.getUint16(0, ifd.le) !== tag) continue
    const length = d.getUint32(4, ifd.le) * (sizes[d.getUint16(2, ifd.le)] ?? 1)
    if (length <= 4) return e.slice(8, 8 + length)
    const at = d.getUint32(8, ifd.le)
    return at + length <= bytes.length ? bytes.subarray(at, at + length) : null
  }
  return null
}
