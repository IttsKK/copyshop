import type { Dispatch, SetStateAction } from 'react'
import { ARRANGED_ID } from '../../engine/arrange'
import { coverPlacement, pieceMaps } from '../../engine/collage'
import { type CollageArrange, type CollageParams, type CollagePiece, DEFAULT_COLLAGE, MAX_COLLAGE_PIECES } from '../../engine/types'
import { collageImageNow } from '../../storage/collageImages'
import { CollagePanel } from '../CollagePanel'
import { Module } from '../controls'
import type { LoadedImage } from '../loadedImage'

interface Props {
  collage: CollageParams
  image: LoadedImage | null
  collageHere: boolean
  selectedPiece: number | null
  armedImage: string | null
  editingCollage: boolean
  setArmedImage: Dispatch<SetStateAction<string | null>>
  setSelectedPiece: Dispatch<SetStateAction<number | null>>
  markMoving: () => void
  setPiece: (i: number, patch: Partial<CollagePiece>, step?: string | null) => void
  matchSizes: (i: number) => void
  collageGhost: boolean
  setCollageGhost: (value: boolean) => void
  setCollage: (next: CollageParams, step?: string | null) => void
  editCollage: (on: boolean) => void
  setStatus: Dispatch<SetStateAction<string | null>>
  setError: Dispatch<SetStateAction<string | null>>
  arranging: boolean
  startArranging: (on: boolean) => void
  arrangeNow: CollageArrange
  arranged: boolean
  setArrange: (a: CollageArrange, run: boolean, step?: string | null) => void
}

/** Collage: pieces from other photos placed into this one. */
export function CollageModule({ collage, image, collageHere, selectedPiece, armedImage, editingCollage, setArmedImage, setSelectedPiece, markMoving, setPiece, matchSizes, collageGhost, setCollageGhost, setCollage, editCollage, setStatus, setError, arranging, startArranging, arrangeNow, arranged, setArrange }: Props) {
  return (
    <Module
      id="collage"
      title="Collage"
    >
      <CollagePanel
        collage={collage}
        hasImage={!!image}
        photo={image?.seed ?? null}
        otherPhoto={!!image && collage.pieces.length > 0 && !collageHere}
        selected={selectedPiece}
        armed={armedImage}
        editing={editingCollage}
        onArm={setArmedImage}
        onSelect={setSelectedPiece}
        onPiece={(i, patch, step) => {
          if ('scale' in patch || 'rotation' in patch) markMoving()
          setPiece(i, patch, step ?? null)
        }}
        onMatchSizes={matchSizes}
        showGhost={collageGhost}
        onShowGhost={setCollageGhost}
        onFit={(i) => {
          const p = collage.pieces[i]
          const maps = p && image ? pieceMaps(image.seed, p) : null
          const img = p ? collageImageNow(p.image) : null
          if (!p || !maps || !img || !image) return
          const fit = coverPlacement(maps, img.bitmap, image.size)
          setPiece(i, { x: fit.x, y: fit.y, rotation: 0 })
        }}
        onDuplicate={(i) => {
          if (collage.pieces.length >= MAX_COLLAGE_PIECES) return
          setCollage({ ...collage, pieces: [...collage.pieces.slice(0, i + 1), structuredClone(collage.pieces[i]), ...collage.pieces.slice(i + 1)] })
          setSelectedPiece(i + 1)
        }}
        onRemove={(i) => {
          setCollage({ ...collage, pieces: collage.pieces.filter((_, j) => j !== i) })
          setSelectedPiece(null)
        }}
        onClear={() => {
          setCollage(DEFAULT_COLLAGE)
          setSelectedPiece(null)
        }}
        onEditing={editCollage}
        onStatus={setStatus}
        onError={setError}
        arranging={arranging}
        onArranging={startArranging}
        arrange={arrangeNow}
        arranged={arranged}
        onArrange={setArrange}
        pieceCells={(collageHere ? collage.pieces : []).filter((p) => !p.id.startsWith(ARRANGED_ID)).flatMap((p) => p.seeds)}
      />
    </Module>
  )
}
