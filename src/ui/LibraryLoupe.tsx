import { useEffect, useState } from 'react'
import type { PhotoFile } from '../platform/native'
import { shownThumb } from './Filmstrip'
import { libraryPicture, type LibraryEdit } from './libraryPictures'

interface Props {
  file: PhotoFile
  /** Its edit, if it has one (useFolderPhotos.editOf). */
  edit: LibraryEdit | null
  /** Its finished picture from when it was last open in the editor, if kept: shown as it is, at once. */
  picture?: string
  onEdit: () => void
}

/**
 * One photo filling the Library, as it looks (see libraryPicture: the file,
 * its kept preview, or its edit drawn). The thumbnail shows at once while
 * that loads.
 */
export function LibraryLoupe({ file, edit, picture, onEdit }: Props) {
  const [src, setSrc] = useState<string | null>(picture ?? null)
  const thumb = shownThumb(file.path)

  useEffect(() => {
    let live = true
    setSrc(picture ?? null)
    if (picture) return
    void libraryPicture(file, edit, 'library-view').then((url) => live && url && setSrc(url))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.path, file.modified, edit?.sha, edit?.state, edit?.updatedAt, picture])

  return (
    <div className="library-loupe" onDoubleClick={onEdit}>
      {thumb && !src && <img className="library-loupe-thumb" src={thumb} alt="" draggable={false} />}
      {src && <img key={src} className="library-loupe-img" src={src} alt={file.name} draggable={false} />}
    </div>
  )
}
