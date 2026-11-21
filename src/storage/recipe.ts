import { tiffTag, tiffWithTag } from '../pipeline/tiff'
import { isWebp, webpChunk, webpWithChunk } from '../pipeline/webp'
import { parsePreset, presetToJson, type PresetDoc } from './presets'

/**
 * The edit, carried inside the exported file.
 *
 * An export becomes the photo people keep, so it has to be enough to come
 * back to the edit from: it records the settings and which original they were
 * applied to (name, size and a SHA-256 of its bytes, so the right file is
 * recognised even after a rename). Opening the export in the app finds that
 * original — in the archive folder, or wherever the user points to — and
 * restores the look exactly.
 *
 * JPEG carries it in an APP15 segment, PNG in a tEXt chunk, TIFF in a private
 * tag (TIFF_TAG) and WebP in a chunk of its own (WEBP_CHUNK); all are ignored
 * by every viewer and survive being copied around. Re-encoding
 * (Instagram, a phone's edit) strips them, which is fine: that copy is a
 * publication, not a master.
 */
export interface Recipe {
  v: 1
  doc: PresetDoc
  original: { name: string; size: number; sha256: string }
  /**
   * The collage's images, by name, size and SHA-256 (their library ids are
   * the hash's start), so opening the export can find one again on disk if
   * it has left the library. Exports before these were kept have none.
   */
  collage?: CollageImageRef[]
  /**
   * Read back only: whether the doc said what its shapes are fractions of.
   * Edits saved before that was recorded are ambiguous (see
   * pipeline/shapeSpace.ts).
   */
  shapeSpaceSaved?: boolean
}

export interface CollageImageRef {
  id: string
  name: string
  size: number
  sha256: string
}

const TAG = 'GrainEmulator'

export async function sha256(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const encodeRecipe = ({ shapeSpaceSaved: _, ...r }: Recipe) =>
  new TextEncoder().encode(JSON.stringify({ ...r, doc: JSON.parse(presetToJson(r.doc)) }))

function parseRefs(value: unknown): CollageImageRef[] {
  if (!Array.isArray(value)) return []
  return value
    .map((v) => (v ?? {}) as Record<string, unknown>)
    .filter((v) => typeof v.id === 'string' && typeof v.name === 'string' && typeof v.sha256 === 'string')
    .map((v) => ({ id: v.id as string, name: v.name as string, size: typeof v.size === 'number' ? v.size : 0, sha256: v.sha256 as string }))
}

function decodeRecipe(bytes: Uint8Array): Recipe | null {
  try {
    const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
    const original = raw.original as Recipe['original']
    if (raw.v !== 1 || !original || typeof original.sha256 !== 'string') return null
    const effects = ((raw.doc as { blend?: { effects?: Record<string, unknown> } } | undefined)?.blend?.effects ?? {}) as Record<string, unknown>
    return {
      v: 1,
      doc: parsePreset(raw.doc),
      original,
      collage: parseRefs(raw.collage),
      shapeSpaceSaved: typeof effects.shapeSpace === 'string',
    }
  } catch {
    return null
  }
}

// --- JPEG ------------------------------------------------------------------

function jpegWith(bytes: Uint8Array, payload: Uint8Array): Uint8Array | null {
  const tag = new TextEncoder().encode(`${TAG}\0`)
  const length = 2 + tag.length + payload.length
  if (length > 0xffff) return null
  // After SOI, and after APP0 (JFIF) if present, where viewers expect it.
  let at = 2
  if (bytes[2] === 0xff && bytes[3] === 0xe0) at = 4 + ((bytes[4] << 8) | bytes[5])
  const segment = new Uint8Array(2 + length)
  segment.set([0xff, 0xef, length >> 8, length & 0xff])
  segment.set(tag, 4)
  segment.set(payload, 4 + tag.length)
  const out = new Uint8Array(bytes.length + segment.length)
  out.set(bytes.subarray(0, at))
  out.set(segment, at)
  out.set(bytes.subarray(at), at + segment.length)
  return out
}

function jpegRecipe(bytes: Uint8Array): Uint8Array | null {
  const tag = new TextEncoder().encode(`${TAG}\0`)
  let i = 2
  while (i + 4 <= bytes.length && bytes[i] === 0xff) {
    const marker = bytes[i + 1]
    if (marker === 0xda || marker === 0xd9) break // image data starts: no more metadata
    const length = (bytes[i + 2] << 8) | bytes[i + 3]
    if (marker === 0xef && tag.every((b, k) => bytes[i + 4 + k] === b)) {
      return bytes.subarray(i + 4 + tag.length, i + 2 + length)
    }
    i += 2 + length
  }
  return null
}

// --- PNG -------------------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const toBase64 = (b: Uint8Array) => btoa(Array.from(b, (x) => String.fromCharCode(x)).join(''))
const fromBase64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

function pngWith(bytes: Uint8Array, payload: Uint8Array): Uint8Array {
  // tEXt is Latin-1 only, so the JSON travels as base64.
  const body = new TextEncoder().encode(`${TAG}\0${toBase64(payload)}`)
  const chunk = new Uint8Array(12 + body.length)
  const view = new DataView(chunk.buffer)
  view.setUint32(0, body.length)
  chunk.set(new TextEncoder().encode('tEXt'), 4)
  chunk.set(body, 8)
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)))
  // Before IEND, the last 12 bytes.
  const at = bytes.length - 12
  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, at))
  out.set(chunk, at)
  out.set(bytes.subarray(at), at + chunk.length)
  return out
}

function pngRecipe(bytes: Uint8Array): Uint8Array | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let i = 8
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i)
    const type = String.fromCharCode(...bytes.subarray(i + 4, i + 8))
    if (type === 'tEXt') {
      const text = new TextDecoder('latin1').decode(bytes.subarray(i + 8, i + 8 + length))
      if (text.startsWith(`${TAG}\0`)) return fromBase64(text.slice(TAG.length + 1))
    }
    if (type === 'IEND') break
    i += 12 + length
  }
  return null
}

// --- TIFF and WebP -----------------------------------------------------------

/** A tag in the TIFF range for private use; the value starts with TAG, so another program's use of it is never read as an edit. */
export const TIFF_TAG = 0xfe5b
/** A WebP chunk of copyshop's own: viewers skip chunks they don't know. */
export const WEBP_CHUNK = 'CPSH'

const tagged = (payload: Uint8Array) => {
  const tag = new TextEncoder().encode(`${TAG}\0`)
  const out = new Uint8Array(tag.length + payload.length)
  out.set(tag)
  out.set(payload, tag.length)
  return out
}
const untagged = (value: Uint8Array | null) => {
  const tag = new TextEncoder().encode(`${TAG}\0`)
  return value && value.length > tag.length && tag.every((b, i) => value[i] === b) ? value.subarray(tag.length) : null
}

// --- public ----------------------------------------------------------------

const isPng = (b: Uint8Array) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
const isJpeg = (b: Uint8Array) => b[0] === 0xff && b[1] === 0xd8
const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49 && b[2] === 42) || (b[0] === 0x4d && b[1] === 0x4d && b[3] === 42)

/** The same image with the recipe embedded; unchanged if it cannot carry one. */
export async function embedRecipe(blob: Blob, recipe: Recipe): Promise<Blob> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const payload = encodeRecipe(recipe)
  const out = isJpeg(bytes)
    ? jpegWith(bytes, payload)
    : isPng(bytes)
      ? pngWith(bytes, payload)
      : isTiff(bytes)
        ? tiffWithTag(bytes, TIFF_TAG, tagged(payload))
        : isWebp(bytes)
          ? webpWithChunk(bytes, WEBP_CHUNK, tagged(payload))
          : null
  return out ? new Blob([out as Uint8Array<ArrayBuffer>], { type: blob.type }) : blob
}

export async function readRecipe(blob: Blob): Promise<Recipe | null> {
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const payload = isJpeg(bytes)
    ? jpegRecipe(bytes)
    : isPng(bytes)
      ? pngRecipe(bytes)
      : isTiff(bytes)
        ? untagged(tiffTag(bytes, TIFF_TAG))
        : isWebp(bytes)
          ? untagged(webpChunk(bytes, WEBP_CHUNK))
          : null
  return payload ? decodeRecipe(payload) : null
}
