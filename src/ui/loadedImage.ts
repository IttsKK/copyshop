import type { Size } from '../engine/types'
import type { PhotoFile } from '../platform/native'

/** The open photo, decoded. */
export interface LoadedImage {
  bitmap: ImageBitmap
  size: Size
  name: string
  file: Blob
  /** The photo's own seed for random detail (see photoSeed). */
  seed: number
  /** Its SHA-256: what its edit is kept under (storage/photoEdits.ts). */
  sha: string
  /** A camera RAW file, developed as shot: it starts unedited. */
  raw?: boolean
  /** When it was taken, YYYY-MM-DD from its EXIF, or ''. */
  date?: string
  /** The file it was opened from by path (the library, the app's Open): kept in Recent. */
  from?: PhotoFile
  /** `from` is an export of this photo, opened as its original (from Originals/): `from`'s own SHA-256 is not `sha`. */
  fromExport?: boolean
}
