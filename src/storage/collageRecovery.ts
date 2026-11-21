import { findByHash, isNative, readFile } from '../platform/native'
import { findOriginalOnDisk } from './archive'
import { addCollageImage, hasCollageImage } from './collageImages'
import type { CollageImageRef } from './recipe'

/**
 * A collage's images that have left the library (removed from it, or an
 * edit from another machine), found again and put back, so its pieces show.
 *
 * Library ids are the start of the image's SHA-256, so an image is known by
 * its contents wherever it is. With the name an export records, Spotlight
 * finds it by name; without (exports from before names were kept), the app
 * looks through the folders photos usually live in, beside the exports
 * first, for a file with that hash. Re-adding the same file in Collage also
 * brings a piece back, since it gets the same id.
 */
export async function recoverCollageImages(
  ids: string[],
  refs: CollageImageRef[],
  exportFolderPath: string | null,
  /** The photo the collage is on: the images found become its own. */
  photo: number | null,
): Promise<{ found: number; missing: number }> {
  let missing: string[] = []
  for (const id of new Set(ids)) if (!(await hasCollageImage(id))) missing.push(id)
  const total = missing.length
  if (!total) return { found: 0, missing: 0 }
  const put = async (file: File, id: string) => {
    const img = await addCollageImage(file, file.name, photo).catch(() => null)
    if (img?.id === id) missing = missing.filter((m) => m !== id)
  }
  for (const ref of refs) {
    if (!missing.includes(ref.id)) continue
    const file = await findOriginalOnDisk(ref.name, ref.size, ref.sha256)
    if (file) await put(new File([file], ref.name), ref.id)
  }
  if (missing.length && isNative()) {
    const beside = exportFolderPath ? exportFolderPath.replace(/\/[^/]+\/?$/, '') : null
    const roots = [...(beside ? [beside] : []), '~/Pictures', '~/Desktop', '~/Downloads', '~/Documents']
    for (const hit of await findByHash(roots, missing.map((id) => id.replace(/^img_/, '')))) {
      const id = `img_${hit.prefix}`
      const bytes = await readFile(hit.path)
      if (bytes) await put(new File([bytes], hit.path.split('/').pop() ?? id), id)
    }
  }
  return { found: total - missing.length, missing: missing.length }
}
