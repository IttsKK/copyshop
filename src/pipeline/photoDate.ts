/**
 * When a photo was taken, from its EXIF: DateTimeOriginal, or the file's
 * DateTime. Reads JPEG (the Exif APP1 segment), TIFF-based files, which most
 * camera RAW files are (ORF, CR2, NEF, ARW, DNG...), PNG (eXIf), WebP (its
 * EXIF chunk), and HEIC and AVIF (the Exif item). "YYYY-MM-DD HH:MM" (or
 * without the time when it has none), or '' when there is none. For the date
 * stamp.
 */
export async function readPhotoDate(file: Blob): Promise<string> {
  try {
    const found = await findExif(file)
    return found ? dateIn(found.buf, found.tiff) : ''
  } catch {
    return ''
  }
}

const HEAD = 512 * 1024
const fourCC = (b: DataView, at: number) => String.fromCharCode(b.getUint8(at), b.getUint8(at + 1), b.getUint8(at + 2), b.getUint8(at + 3))

/** The EXIF's TIFF block: the bytes it is in and where it starts. */
async function findExif(file: Blob): Promise<{ buf: DataView; tiff: number } | null> {
  const buf = new DataView(await file.slice(0, HEAD).arrayBuffer())
  if (buf.byteLength < 12) return null
  if (buf.getUint16(0) === 0xffd8) {
    // JPEG: walk the markers to APP1 "Exif\0\0".
    let p = 2
    while (p + 4 < buf.byteLength) {
      if (buf.getUint8(p) !== 0xff) break
      const marker = buf.getUint8(p + 1)
      const len = buf.getUint16(p + 2)
      if (marker === 0xe1 && buf.getUint32(p + 4) === 0x45786966) return { buf, tiff: p + 10 }
      if (marker === 0xda) break
      p += 2 + len
    }
    return null
  }
  if (buf.getUint32(0) === 0x89504e47) {
    // PNG: the eXIf chunk, before the image data.
    let p = 8
    while (p + 8 <= buf.byteLength) {
      const len = buf.getUint32(p)
      const type = fourCC(buf, p + 4)
      if (type === 'eXIf') return { buf, tiff: p + 8 }
      if (type === 'IDAT' || type === 'IEND') break
      p += 12 + len
    }
    return null
  }
  if (fourCC(buf, 0) === 'RIFF' && fourCC(buf, 8) === 'WEBP') {
    // WebP: the EXIF chunk, after the image data, so maybe past the head.
    let p = 12
    for (let i = 0; i < 64 && p + 8 <= file.size; i++) {
      const head = new DataView(await file.slice(p, p + 8).arrayBuffer())
      const len = head.getUint32(4, true)
      if (fourCC(head, 0) === 'EXIF') {
        const body = new DataView(await file.slice(p + 8, p + 8 + Math.min(len, HEAD)).arrayBuffer())
        // Some writers keep JPEG's "Exif\0\0" in front.
        return { buf: body, tiff: body.byteLength > 6 && body.getUint32(0) === 0x45786966 ? 6 : 0 }
      }
      p += 8 + len + (len & 1)
    }
    return null
  }
  if (fourCC(buf, 4) === 'ftyp') {
    // HEIC and AVIF: the Exif item, found through the meta box.
    const at = heifExif(buf)
    if (!at) return null
    const body = new DataView(await file.slice(at.offset, at.offset + Math.min(at.length, HEAD)).arrayBuffer())
    if (body.byteLength < 8) return null
    // The item starts with the offset of the TIFF header after these four bytes.
    return { buf: body, tiff: 4 + body.getUint32(0) }
  }
  // TIFF itself, and RAW files built on it.
  return { buf, tiff: 0 }
}

/** Where a HEIF file's Exif item is, from its meta box (iinf for the item, iloc for its place). */
function heifExif(b: DataView): { offset: number; length: number } | null {
  type Box = { type: string; start: number; end: number }
  const boxes = (from: number, to: number): Box[] => {
    const out: Box[] = []
    let p = from
    while (p + 8 <= to) {
      let size = b.getUint32(p)
      const type = fourCC(b, p + 4)
      let head = 8
      if (size === 1) {
        if (p + 16 > to) break
        size = Number(b.getBigUint64(p + 8))
        head = 16
      } else if (size === 0) size = to - p
      if (size < head) break
      out.push({ type, start: p + head, end: Math.min(p + size, to) })
      p += size
    }
    return out
  }
  const meta = boxes(0, b.byteLength).find((x) => x.type === 'meta')
  if (!meta) return null
  // meta is a full box: version and flags first.
  const inside = boxes(meta.start + 4, meta.end)
  const iinf = inside.find((x) => x.type === 'iinf')
  const iloc = inside.find((x) => x.type === 'iloc')
  if (!iinf || !iloc) return null
  let exifId = -1
  {
    const v = b.getUint8(iinf.start)
    const first = iinf.start + 4 + (v === 0 ? 2 : 4)
    for (const infe of boxes(first, iinf.end)) {
      if (infe.type !== 'infe') continue
      const iv = b.getUint8(infe.start)
      if (iv < 2) continue
      const id = iv === 2 ? b.getUint16(infe.start + 4) : b.getUint32(infe.start + 4)
      const typeAt = infe.start + 4 + (iv === 2 ? 2 : 4) + 2
      if (fourCC(b, typeAt) === 'Exif') {
        exifId = id
        break
      }
    }
  }
  if (exifId < 0) return null
  const v = b.getUint8(iloc.start)
  let p = iloc.start + 4
  const sizes = b.getUint8(p)
  const sizes2 = b.getUint8(p + 1)
  p += 2
  const offsetSize = sizes >> 4
  const lengthSize = sizes & 15
  const baseSize = sizes2 >> 4
  const indexSize = v === 1 || v === 2 ? sizes2 & 15 : 0
  const read = (n: number): number => {
    const value = n === 0 ? 0 : n === 2 ? b.getUint16(p) : n === 4 ? b.getUint32(p) : n === 8 ? Number(b.getBigUint64(p)) : NaN
    p += n
    return value
  }
  const count = v < 2 ? read(2) : read(4)
  for (let i = 0; i < count && p < iloc.end; i++) {
    const id = v < 2 ? read(2) : read(4)
    const method = v === 1 || v === 2 ? read(2) & 15 : 0
    read(2) // data reference index
    const base = read(baseSize)
    const extents = read(2)
    let first: { offset: number; length: number } | null = null
    for (let e = 0; e < extents; e++) {
      if (indexSize) read(indexSize)
      const offset = read(offsetSize)
      const length = read(lengthSize)
      first ??= { offset: base + offset, length }
    }
    // Only items stored in the file itself (method 0).
    if (id === exifId) return method === 0 && first && Number.isFinite(first.offset) ? first : null
  }
  return null
}

/** The date in a TIFF block's IFD0 or Exif IFD. */
function dateIn(buf: DataView, tiff: number): string {
  if (tiff < 0 || tiff + 8 > buf.byteLength) return ''
  const order = buf.getUint16(tiff)
  if (order !== 0x4949 && order !== 0x4d4d) return ''
  const le = order === 0x4949
  const u16 = (o: number) => buf.getUint16(tiff + o, le)
  const u32 = (o: number) => buf.getUint32(tiff + o, le)
  const ascii = (o: number, n: number) => {
    let s = ''
    for (let i = 0; i < n && tiff + o + i < buf.byteLength; i++) {
      const c = buf.getUint8(tiff + o + i)
      if (!c) break
      s += String.fromCharCode(c)
    }
    return s
  }
  const readIfd = (off: number): Map<number, number> => {
    const tags = new Map<number, number>()
    if (off <= 0 || tiff + off + 2 > buf.byteLength) return tags
    const n = u16(off)
    for (let i = 0; i < n && off + 2 + i * 12 + 12 <= buf.byteLength - tiff; i++) {
      const e = off + 2 + i * 12
      tags.set(u16(e), e)
    }
    return tags
  }
  const valueAt = (entry: number) => (u32(entry + 4) > 4 ? u32(entry + 8) : entry + 8)
  const ifd0 = readIfd(u32(4))
  const dateOf = (tags: Map<number, number>, tag: number) => {
    const e = tags.get(tag)
    return e === undefined ? '' : ascii(valueAt(e), 19)
  }
  const exifPtr = ifd0.get(0x8769)
  const exif = exifPtr !== undefined ? readIfd(u32(exifPtr + 8)) : new Map<number, number>()
  const raw = dateOf(exif, 0x9003) || dateOf(exif, 0x9004) || dateOf(ifd0, 0x0132)
  const m = /^(\d{4}):(\d{2}):(\d{2})(?: (\d{2}):(\d{2}))?/.exec(raw)
  if (!m || m[1] === '0000') return ''
  return m[4] ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : `${m[1]}-${m[2]}-${m[3]}`
}
