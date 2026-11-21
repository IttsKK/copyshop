import { isNative } from '../platform/native'
import { isMac } from '../platform/os'
import { RAW_EXTENSIONS, canOpenRaw, isRawName } from './raw'

/**
 * Every photo format copyshop opens, in one place: the file pickers, the
 * Open dialog, the library's folders, batches and drag and drop all read
 * these lists.
 *
 * The webview decodes them where it can (Safari and the Mac app: all of
 * them). Where it can't, the desktop app converts the file first
 * (pipeline/decode.ts): macOS's own image engine on a Mac, Rust on Windows
 * and Linux, which reads TIFF, WebP, BMP and GIF but not HEIC or AVIF. Camera
 * RAW files are developed instead (pipeline/raw.ts).
 */
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
}

/** Photos opened as they are, not developed. */
export const IMAGE_EXTENSIONS = Object.keys(MIME)

/** A file name's extension, lower case, without the dot. */
export const extOf = (name: string): string => {
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
}

/** The MIME type for a photo's name, or '' if it isn't one of IMAGE_EXTENSIONS. */
export const mimeOf = (name: string): string => MIME[extOf(name)] ?? ''

/** Everything that opens here as a photo: RAW files too where they can be developed. */
export const photoExtensions = (): string[] => (canOpenRaw() ? [...IMAGE_EXTENSIONS, ...RAW_EXTENSIONS] : IMAGE_EXTENSIONS)

/** Whether a file of this name opens as a photo here. */
export const isPhotoName = (name: string): boolean => photoExtensions().includes(extOf(name))

const accept = (extensions: string[]) =>
  [...new Set(extensions.map((e) => MIME[e]).filter(Boolean)), ...extensions.map((e) => `.${e}`)].join(',')

/** What the photo pickers take. */
export const photoAccept = (): string => accept(photoExtensions())

/** What the pickers for images laid into a photo (double exposure, collage) and grain plates take: no RAW. */
export const imageAccept = (): string => accept(IMAGE_EXTENSIONS)

/** A format's name for people, by extension. */
function formatName(ext: string): string {
  if (ext === 'heic' || ext === 'heif') return 'HEIC'
  if (ext === 'tif' || ext === 'tiff') return 'TIFF'
  if (ext === 'jpg' || ext === 'jpeg') return 'JPEG'
  if (ext === 'webp') return 'WebP'
  return ext.toUpperCase()
}

/** What to say when a photo couldn't be decoded; `detail` is the app's reason, when it tried converting it. */
export function cannotOpenMessage(name: string, detail?: string): string {
  const ext = extOf(name)
  const kind = formatName(ext)
  const heic = ext === 'heic' || ext === 'heif'
  if (isRawName(name)) return `${name} is a RAW file. RAW files open in the desktop app.`
  if (!IMAGE_EXTENSIONS.includes(ext))
    return `Could not open ${name}. copyshop opens JPEG, PNG, TIFF, WebP, HEIC, AVIF, BMP and GIF photos, and camera RAW files in the desktop app.`
  if (isNative()) {
    if (heic && !isMac()) return `${name} is a HEIC photo. HEIC photos open in the Mac app; here, save it as a JPEG first.`
    if (ext === 'avif' && !isMac()) return `Could not open ${name}: this computer can't read AVIF photos. Save it as a JPEG first.`
    return `Could not open ${name}${detail ? `: ${detail}` : '. The file may be damaged.'}`
  }
  if (kind === 'JPEG' || kind === 'PNG') return `Could not open ${name}. The file may be damaged.`
  return `This browser can't open ${kind} photos like ${name}. Safari can, and so can the desktop app${heic ? ' on a Mac' : ''}; or save it as a JPEG first.`
}
