import { describe, expect, it } from 'vitest'
import { embedRecipe, readRecipe, TIFF_TAG, type Recipe } from '../storage/recipe'
import { parsePreset, PRESET_SCHEMA_VERSION } from '../storage/presets'
import { encodeTiff, tiffTag, tiffWithTag } from './tiff'
import { webpChunk, webpWithChunk } from './webp'
import { encodeAs } from './render'
import { readPhotoDate } from './photoDate'

/** RGBA pixels with something in every channel that changes along a row and down. */
function pattern(width: number, height: number): Uint8Array {
  const px = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      px.set([(x * 37 + y) & 255, (y * 53 + x * 3) & 255, (x * y) & 255, 255], i)
    }
  return px
}

const source = (width: number, height: number, px: Uint8Array) => ({
  width,
  height,
  rows: (y: number, n: number) => px.subarray(y * width * 4, (y + n) * width * 4),
})

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** A TIFF read back as a reader would: tags, strips inflated, the predictor undone. */
async function readTiff(bytes: Uint8Array) {
  const d = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  expect([bytes[0], bytes[1], d.getUint16(2, true)]).toEqual([0x49, 0x49, 42])
  const ifd = d.getUint32(4, true)
  const n = d.getUint16(ifd, true)
  const tags = new Map<number, number[]>()
  let last = 0
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12
    const tag = d.getUint16(e, true)
    expect(tag).toBeGreaterThan(last) // sorted, as TIFF requires
    last = tag
    const type = d.getUint16(e + 2, true)
    const count = d.getUint32(e + 4, true)
    const size = { 3: 2, 4: 4, 5: 8 }[type as 3 | 4 | 5] ?? 1
    const at = count * size > 4 ? d.getUint32(e + 8, true) : e + 8
    const values: number[] = []
    for (let k = 0; k < count && type !== 7 && type !== 2; k++)
      values.push(type === 3 ? d.getUint16(at + k * 2, true) : type === 5 ? d.getUint32(at + k * 8, true) : d.getUint32(at + k * 4, true))
    tags.set(tag, values)
  }
  const width = tags.get(256)![0]
  const height = tags.get(257)![0]
  const offsets = tags.get(273)!
  const counts = tags.get(279)!
  const strips = await Promise.all(offsets.map((o, i) => inflate(bytes.subarray(o, o + counts[i]))))
  const rgb = new Uint8Array(width * height * 3)
  let at = 0
  for (const s of strips) {
    rgb.set(s, at)
    at += s.length
  }
  if (tags.get(317)?.[0] === 2)
    for (let y = 0; y < height; y++)
      for (let i = y * width * 3 + 3; i < (y + 1) * width * 3; i++) rgb[i] = (rgb[i] + rgb[i - 3]) & 255
  return { width, height, tags, rgb }
}

const doc = parsePreset({
  schemaVersion: PRESET_SCHEMA_VERSION,
  name: 'Format test',
  grainSource: { kind: 'procedural', id: 'procedural', name: 'g', params: {} },
  blend: { amount: 0.33, effects: {} },
  output: { format: 'tiff' },
})
const recipe: Recipe = { v: 1, doc, original: { name: 'IMG_0001.HEIC', size: 4321, sha256: 'ab'.repeat(32) } }

describe('TIFF export', () => {
  it('writes Deflate-compressed 8-bit RGB with the predictor that reads back exactly', async () => {
    // Wide enough for several strips (512 KB of pixels each).
    for (const [w, h] of [
      [37, 23],
      [3000, 200],
    ]) {
      const px = pattern(w, h)
      const tiff = await encodeTiff(source(w, h, px))
      const back = await readTiff(tiff)
      expect([back.width, back.height]).toEqual([w, h])
      expect(back.tags.get(258)).toEqual([8, 8, 8])
      expect(back.tags.get(259)).toEqual([8])
      expect(back.tags.get(262)).toEqual([2])
      expect(back.tags.get(277)).toEqual([3])
      expect(back.tags.get(317)).toEqual([2])
      if (w === 3000) expect(back.tags.get(273)!.length).toBeGreaterThan(1)
      for (let i = 0, j = 0; i < px.length; i += 4, j += 3) {
        if (back.rgb[j] !== px[i] || back.rgb[j + 1] !== px[i + 1] || back.rgb[j + 2] !== px[i + 2]) throw new Error(`pixel ${i / 4} differs`)
      }
    }
  })

  it('carries the edit in a private tag, and reads it back', async () => {
    const tiff = await encodeTiff(source(16, 9, pattern(16, 9)))
    expect(await readRecipe(new Blob([tiff]))).toBeNull()
    const embedded = await embedRecipe(new Blob([tiff], { type: 'image/tiff' }), recipe)
    expect(embedded.type).toBe('image/tiff')
    const bytes = new Uint8Array(await embedded.arrayBuffer())
    // Still the same picture, the other tags as they were.
    const back = await readTiff(bytes)
    expect(back.rgb).toEqual((await readTiff(tiff)).rgb)
    expect(tiffTag(bytes, TIFF_TAG)).not.toBeNull()
    const read = await readRecipe(embedded)
    expect(read?.original).toEqual(recipe.original)
    expect(read?.doc.blend.amount).toBe(0.33)
    expect(read?.doc.output.format).toBe('tiff')
    // Embedding again replaces it rather than adding a second.
    const again = new Uint8Array(await (await embedRecipe(embedded, { ...recipe, original: { ...recipe.original, size: 99 } })).arrayBuffer())
    const d = new DataView(again.buffer)
    const ifd = d.getUint32(4, true)
    const tags = Array.from({ length: d.getUint16(ifd, true) }, (_, i) => d.getUint16(ifd + 2 + i * 12, true))
    expect(tags.filter((t) => t === TIFF_TAG)).toHaveLength(1)
    expect((await readRecipe(new Blob([again])))?.original.size).toBe(99)
  })

  it('adds a tag to a big-endian TIFF too', () => {
    // MM, one entry (ImageWidth = 5), no next IFD.
    const mm = new Uint8Array([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 1, 0, 0, 3, 0, 0, 0, 1, 0, 5, 0, 0, 0, 0, 0, 0])
    const out = tiffWithTag(mm, 0xfe5b, new TextEncoder().encode('hello world'))!
    expect(new TextDecoder().decode(tiffTag(out, 0xfe5b)!)).toBe('hello world')
    expect(Array.from(tiffTag(out, 256)!)).toEqual([0, 5])
  })
})

describe('WebP export', () => {
  const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
  // 8 x 6, from cwebp: lossy (VP8) and lossless (VP8L).
  const lossy = b64('UklGRjwAAABXRUJQVlA4IDAAAAAQAgCdASoIAAYAAMASJaACdLoB+AH4AAPIAP7uXj/++BM07G/7f//uDfZFz/1IAAA=')
  const lossless = b64('UklGRiIAAABXRUJQVlA4TBYAAAAvB0ABAAdQxDKXqP8BgCD8b5uI6H8I')

  it('becomes an extended WebP with the edit in its own chunk, and reads it back', async () => {
    for (const webp of [lossy, lossless]) {
      expect(await readRecipe(new Blob([webp]))).toBeNull()
      const embedded = await embedRecipe(new Blob([webp], { type: 'image/webp' }), recipe)
      const bytes = new Uint8Array(await embedded.arrayBuffer())
      const d = new DataView(bytes.buffer)
      const text = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
      expect([text(0), text(8), text(12)]).toEqual(['RIFF', 'WEBP', 'VP8X'])
      expect(d.getUint32(4, true)).toBe(bytes.length - 8)
      // The canvas size in VP8X: 8 x 6.
      expect(bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)).toBe(7)
      expect(bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)).toBe(5)
      // The picture's own chunk is still there, unchanged.
      expect(text(30)).toBe(webp === lossy ? 'VP8 ' : 'VP8L')
      expect(bytes.subarray(30, 30 + webp.length - 12)).toEqual(webp.subarray(12))
      const read = await readRecipe(embedded)
      expect(read?.original).toEqual(recipe.original)
      expect(read?.doc.blend.amount).toBe(0.33)
    }
  })

  it('replaces its chunk rather than adding another, and keeps chunks odd in length padded', () => {
    const once = webpWithChunk(lossy, 'TEST', new Uint8Array([1, 2, 3]))!
    const twice = webpWithChunk(once, 'TEST', new Uint8Array([4, 5, 6, 7, 8]))!
    expect(Array.from(webpChunk(twice, 'TEST')!)).toEqual([4, 5, 6, 7, 8])
    expect(twice.length % 2).toBe(0)
    expect(new DataView(twice.buffer).getUint32(4, true)).toBe(twice.length - 8)
  })
})

describe('export formats', () => {
  it('"Same" keeps formats it can write and makes the rest JPEG', () => {
    expect(encodeAs('jpeg').ext).toBe('jpeg')
    expect(encodeAs('jpg').mime).toBe('image/jpeg')
    expect(encodeAs('png').mime).toBe('image/png')
    expect(encodeAs('tiff')).toMatchObject({ mime: 'image/tiff', ext: 'tiff' })
    expect(encodeAs('tif')).toMatchObject({ mime: 'image/tiff', ext: 'tif' })
    expect(encodeAs('webp').mime).toBe('image/webp')
    for (const ext of ['heic', 'heif', 'avif', 'gif', 'bmp', 'orf', 'dng']) expect(encodeAs(ext)).toMatchObject({ mime: 'image/jpeg', ext: 'jpg' })
    expect(encodeAs('png', 'tiff').ext).toBe('tif')
    expect(encodeAs('heic', 'webp').ext).toBe('webp')
  })
})

describe('photo dates', () => {
  /** A TIFF block whose IFD0 has DateTime. */
  const exifTiff = (date: string) => {
    const s = new TextEncoder().encode(`${date}\0`)
    const b = new Uint8Array(8 + 2 + 12 + 4 + s.length)
    const d = new DataView(b.buffer)
    b.set([0x49, 0x49, 42, 0])
    d.setUint32(4, 8, true)
    d.setUint16(8, 1, true)
    d.setUint16(10, 0x0132, true)
    d.setUint16(12, 2, true)
    d.setUint32(14, s.length, true)
    d.setUint32(18, 26, true)
    b.set(s, 26)
    return b
  }

  it('reads EXIF from a WebP chunk and a PNG eXIf chunk', async () => {
    const webp = webpWithChunk(Uint8Array.from(atob('UklGRiIAAABXRUJQVlA4TBYAAAAvB0ABAAdQxDKXqP8BgCD8b5uI6H8I'), (c) => c.charCodeAt(0)), 'EXIF', exifTiff('2021:06:07 08:09:10'))!
    expect(await readPhotoDate(new Blob([webp]))).toBe('2021-06-07 08:09')
    const exif = exifTiff('2019:01:02 03:04:05')
    const chunk = new Uint8Array(12 + exif.length)
    new DataView(chunk.buffer).setUint32(0, exif.length)
    chunk.set(new TextEncoder().encode('eXIf'), 4)
    chunk.set(exif, 8)
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, ...chunk, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0])
    expect(await readPhotoDate(new Blob([png]))).toBe('2019-01-02 03:04')
  })
})
