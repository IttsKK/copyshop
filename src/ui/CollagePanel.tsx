import { useEffect, useRef, useState } from 'react'
import { confirmWith } from '../platform/native'
import { EditBox } from './EditBox'
import { AngleDial } from './AngleDial'
import type { CollageArrange, CollageParams, CollagePiece } from '../engine/types'
import { imageAccept } from '../pipeline/formats'
import { MAX_COLLAGE_PIECES } from '../engine/types'
import {
  addCollageImage,
  collageImageNow,
  listCollageImages,
  onCollageImage,
  removeCollageImage,
  type CollageImage,
} from '../storage/collageImages'
import { Disclosure, Slider } from './controls'
import { ItemList } from './ItemList'
import './lists.css'

interface Props {
  collage: CollageParams
  hasImage: boolean
  /** The open photo (see photoSeed): only its images are listed. */
  photo: number | null
  /** The pieces were made on another photo, so they do nothing here. */
  otherPhoto: boolean
  selected: number | null
  /** The image waiting to be laid into the next gap clicked. */
  armed: string | null
  editing: boolean
  onArm: (id: string | null) => void
  onSelect: (index: number | null) => void
  onPiece: (index: number, patch: Partial<CollagePiece>, step?: string) => void
  onRemove: (index: number) => void
  /** A copy of piece `index`, next after it. */
  onDuplicate?: (index: number) => void
  /** Every piece at this one's size, once. */
  onMatchSizes: (index: number) => void
  /** Show the rest of the image, faintly, while a piece's image is moved. */
  showGhost: boolean
  onShowGhost: (on: boolean) => void
  /** The image back to just covering the piece, unturned. */
  onFit: (index: number) => void
  onClear: () => void
  onEditing: (on: boolean) => void
  onStatus: (message: string) => void
  onError: (message: string) => void
  /** Arrange mode: clicks on the photo choose cells; the library chooses images (see CollageArrange). */
  arranging: boolean
  onArranging: (on: boolean) => void
  arrange: CollageArrange
  /** There are pieces Arrange made, so a change lays them out again. */
  arranged: boolean
  /** New settings or cells; `run` lays the images out with them. */
  onArrange: (arrange: CollageArrange, run: boolean, step?: string | null) => void
  /** Where the pieces not made by Arrange were clicked: to offer their gaps as cells. */
  pieceCells: { x: number; y: number }[]
}

const stops = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`

/**
 * Collage: other photos laid into this one. Your images sit in a grid;
 * pick one and click a gap on the photo (between wires, say) and it fills
 * that gap, matched to its brightness, the wires left as they were. Shift-
 * click more gaps to spread one image over several. See engine/collage.ts.
 */
export function CollagePanel(props: Props) {
  const { collage, selected, armed } = props
  const [images, setImages] = useState<CollageImage[]>([])
  const [swapping, setSwapping] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const piece = selected !== null ? collage.pieces[selected] : undefined
  const used = new Set(props.otherPhoto ? [] : collage.pieces.map((p) => p.image))
  const usedKey = [...used].sort().join(',')
  const refresh = () => listCollageImages(props.photo, [...used]).then(setImages)
  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.photo, usedKey])
  // Images found on disk for this photo's pieces (see collageRecovery) join the list.
  useEffect(
    () => onCollageImage(() => void refresh()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.photo, usedKey],
  )
  const full = collage.pieces.length >= MAX_COLLAGE_PIECES
  // Arranging with no images chosen yet: all of this photo's to start with.
  useEffect(() => {
    if (props.arranging && !props.arrange.images.length && images.length)
      props.onArrange({ ...props.arrange, images: images.map((i) => i.id) }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.arranging, images.length])
  // Clicking a gap on the photo selects its piece: bring that piece's image into view in the
  // library and flash it, so the gap leads straight to the image filling it.
  const library = useRef<HTMLDivElement>(null)
  const shownImage = piece && !props.otherPhoto ? piece.image : null
  useEffect(() => {
    if (shownImage === null) return
    const tile = library.current?.querySelector<HTMLElement>(`[data-image="${CSS.escape(shownImage)}"]`)
    if (!tile) return
    tile.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    tile.classList.remove('found')
    void tile.offsetWidth
    tile.classList.add('found')
  }, [selected, shownImage, images])

  const add = async (files: FileList | null) => {
    if (!files?.length) return
    try {
      let first: CollageImage | null = null
      for (const f of Array.from(files)) {
        const img = await addCollageImage(f, f.name, props.photo)
        first ??= img
      }
      await refresh()
      if (first && !full) {
        props.onArm(first.id)
        props.onEditing(true)
      }
    } catch (err) {
      props.onError((err as Error).message)
    }
  }

  const pick = (img: CollageImage) => {
    if (props.arranging) {
      const has = props.arrange.images.includes(img.id)
      const next = has ? props.arrange.images.filter((id) => id !== img.id) : [...props.arrange.images, img.id]
      props.onArrange({ ...props.arrange, images: next }, props.arranged)
      return
    }
    if (swapping && piece && selected !== null) {
      props.onPiece(selected, { image: img.id })
      setSwapping(false)
      props.onStatus(`Swapped in ${img.name}.`)
      return
    }
    if (armed === img.id) {
      props.onArm(null)
      return
    }
    props.onArm(img.id)
    props.onEditing(true)
  }

  return (
    <div className="collage">
      {props.otherPhoto && (
        <div className="collage-note">
          <span>These pieces were made on another photo, so they do nothing here.</span>
          <button className="link" onClick={props.onClear}>
            Clear them
          </button>
        </div>
      )}
      <div ref={library} className="collage-library" role="list" aria-label="Collage images">
        {images.map((img) => (
          <div key={img.id} className="collage-tile-wrap" role="listitem">
            <button
              data-image={img.id}
              className={`collage-tile${armed === img.id ? ' armed' : ''}${piece?.image === img.id && !props.arranging ? ' current' : ''}${props.arranging && !props.arrange.images.includes(img.id) ? ' left-out' : ''}`}
              title={
                props.arranging
                  ? props.arrange.images.includes(img.id)
                    ? `${img.name}: used by Arrange. Click to leave it out.`
                    : `${img.name}: left out. Click to use it.`
                  : swapping
                    ? `Use ${img.name} for this piece`
                    : `${img.name}: click it, then click where it should go on the photo. It fills the area round the click, up to lines and edges.`
              }
              aria-pressed={props.arranging ? props.arrange.images.includes(img.id) : undefined}
              disabled={!props.hasImage || (full && !swapping && !props.arranging)}
              onClick={() => pick(img)}
            >
              <img src={img.thumb} alt={img.name} />
            </button>
            {!used.has(img.id) && (
              <button
                className="collage-tile-remove"
                title={`Remove ${img.name} from this photo's images`}
                aria-label={`Remove ${img.name}`}
                onClick={async () => {
                  if (props.photo === null) return
                  if (img.keepOut && !(await confirmWith(`Remove ${img.name}? Its parts marked not to use go with it.`))) return
                  await removeCollageImage(img.id, props.photo)
                  if (armed === img.id) props.onArm(null)
                  await refresh()
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}
        <button className="collage-tile add" title="Add images (skies, textures…) to lay into photos" onClick={() => input.current?.click()}>
          +
        </button>
      </div>
      <input ref={input} type="file" accept={imageAccept()} multiple hidden onChange={(e) => {
        void add(e.target.files)
        e.target.value = ''
      }} />
      {/* Setting up an automatic fill says what to do in its own steps (CollageArrange). */}
      {!(props.hasImage && props.arranging) && (
      <p className="hint-line">
        {!props.hasImage
          ? 'Open a photo first'
          : armed
            ? 'Now click where it should go'
            : swapping
              ? 'Pick its image'
              : images.length
                ? '1 Pick an image · 2 Click the photo'
                : 'Add a few images'}
      </p>
      )}

      {props.hasImage && images.length > 0 && !props.otherPhoto && (
        <button
          className={`collage-arrange-start${props.arranging ? ' on' : ''}`}
          title="Set up an automatic fill: choose many gaps and images, and have the images laid into them in order of tone, warmth or colour, their light and colour evened out. What it fills are ordinary pieces afterwards."
          onClick={() => props.onArranging(!props.arranging)}
        >
          Fill gaps automatically…
        </button>
      )}
      {collage.pieces.length > 0 && !props.otherPhoto && !props.arranging && (
        <ItemList
          open={selected !== null && selected < collage.pieces.length ? selected : null}
          onOpen={(i) => {
            // Opening a piece selects it and shows it on the photo, to move and size; closing keeps the photo as it is.
            props.onSelect(i)
            props.onArm(null)
            setSwapping(false)
            if (i !== null && i !== selected) props.onEditing(true)
          }}
          items={collage.pieces.map((p, i) => {
            const img = collageImageNow(p.image)
            const editingThis = props.editing && selected === i
            return {
              key: p.id,
              // How many gaps it fills stays in sight even where a narrow panel hides summaries.
              name: (
                <>
                  Piece {i + 1}
                  <span className="collage-piece-gaps"> · {p.seeds.length === 1 ? '1 gap' : `${p.seeds.length} gaps`}</span>
                </>
              ),
              icon: img ? (
                <img className="collage-piece-thumb" src={img.thumb} alt="" />
              ) : (
                <span className="collage-piece-thumb" title="This image is not in your images on this computer">
                  ?
                </span>
              ),
              label: `piece ${i + 1}`,
              // Moving and sizing it on the photo; again, or Esc, stops.
              editing: editingThis,
              onEdit: props.hasImage
                ? () => {
                    if (editingThis) props.onEditing(false)
                    else {
                      if (selected !== i) props.onSelect(i)
                      props.onArm(null)
                      setSwapping(false)
                      props.onEditing(true)
                    }
                  }
                : undefined,
              ...(props.onDuplicate ? { onDuplicate: () => props.onDuplicate!(i) } : {}),
              onRemove: () => {
                setSwapping(false)
                props.onRemove(i)
              },
            }
          })}
        >
          {piece && selected !== null && (
            <>
              <p className="collage-piece-image">
                {collageImageNow(piece.image)?.name ?? 'Image not on this computer'}
              </p>
              <Slider
                label="Size"
                title="How big this piece's image is, as a share of the photo's width (here, or on the photo: a corner of its box, or scroll over it). New pieces start at the size you last gave one, so they match."
                value={Math.log2(piece.scale)}
                min={-3}
                max={3}
                step={0.01}
                format={(v) => `${Math.round(2 ** v * 100)}%`}
                onChange={(v) => props.onPiece(selected, { scale: 2 ** v }, `collage-size-${piece.id}`)}
              />
              <AngleDial
                look="turn"
                label="Rotation"
                title="Turn the image. On the photo, drag the round knob above its box (Shift for 15° steps)."
                value={piece.rotation ?? 0}
                def={0}
                min={-180}
                max={180}
                step={0.5}
                zero={0}
                onChange={(rotation) => props.onPiece(selected, { rotation }, `collage-turn-${piece.id}`)}
              />
              <Slider
                label="Opacity"
                value={piece.opacity}
                min={0}
                max={1}
                step={0.01}
                onChange={(opacity) => props.onPiece(selected, { opacity })}
              />
              <Disclosure id="collage-piece-light" title="Light and colour">
                <Slider
                  label="Brightness"
                  title="Brighter or darker than what it replaces, in stops"
                  value={piece.brightness}
                  min={-2}
                  max={2}
                  step={0.05}
                  format={stops}
                  onChange={(brightness) => props.onPiece(selected, { brightness })}
                />
                <Slider
                  label="Match light"
                  title="How far the image is brought to the brightness of what it replaces, so it sits in the photo's light"
                  value={piece.match}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(match) => props.onPiece(selected, { match })}
                />
                <Slider
                  label="Match the look"
                  title="How much the image takes on the photo's colour, tone and light, so it looks shot with the rest. 0 keeps the image's own colours; grain, dust and paper go over it either way."
                  value={piece.takeLook}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(takeLook) => props.onPiece(selected, { takeLook })}
                />
                <Slider
                  label="Photo detail"
                  title="How much of the photo's own fine texture (cloud edges, the old sky's mottle) stays on the image inside the piece. 0 lays the image in as it is; next to wires the photo is always kept as a mix, so the wires keep their edges."
                  value={piece.detail ?? 0}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'None')}
                  onChange={(detail) => props.onPiece(selected, { detail })}
                />
              </Disclosure>
              <Disclosure id="collage-piece-edges" title="Edges">
                <Slider
                  label="Reach"
                  title="How far the piece spreads from where you clicked: low keeps to colours like the one clicked, high runs into different ones"
                  value={piece.tolerance}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(tolerance) => props.onPiece(selected, { tolerance })}
                />
                <Slider
                  label="Stop at thin lines"
                  title="How readily thin or broken lines (wires, far branches) stop the piece spreading. Raise it if the piece leaks into the next gap."
                  value={piece.seal}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(seal) => props.onPiece(selected, { seal })}
                />
                <Slider
                  label="Soften"
                  title="Softens the piece's edges where they are not a line: against buildings, hills"
                  value={piece.soften}
                  min={0}
                  max={1}
                  step={0.01}
                  onChange={(soften) => props.onPiece(selected, { soften })}
                />
                <label
                  className="check-row"
                  title="Fill the patches the piece closes round but did not spread into (blue between clouds, a bright cloud top). A patch a line runs through, like a street lamp, stays in front."
                >
                  <input type="checkbox" checked={piece.fillHoles !== false} onChange={(e) => props.onPiece(selected, { fillHoles: e.target.checked })} />
                  Fill holes inside the piece
                </label>
              </Disclosure>
              <Disclosure id="collage-piece-sky" title="As sky" summary={piece.throughLeaves || (piece.keepLight ?? 0) > 0 ? 'Set up as sky' : ''}>
                <div className="collage-sky">
                  <div className="collage-sky-head">
                    <button
                      className="link"
                      title="Set this piece up to read as the photo's own sky: sky through the leaves filled, the old sky's light kept on it, the photo lit by it, its grain softened, no old cloud texture, and the look over it as over the rest"
                      onClick={() =>
                        props.onPiece(selected, { throughLeaves: true, keepLight: 0.7, relight: 0.5, smooth: 1, detail: 0, takeLook: 1, fillHoles: true })
                      }
                    >
                      Use as sky
                    </button>
                  </div>
                  <label
                    className="check-row"
                    title="Also replace the bits of this sky no click reached: patches beside the piece and specks seen through leaves and branches."
                  >
                    <input type="checkbox" checked={!!piece.throughLeaves} onChange={(e) => props.onPiece(selected, { throughLeaves: e.target.checked })} />
                    Fill all of this sky
                  </label>
                  <Slider
                    label="Keep its light"
                    title="How much of the old sky's broad light the image takes on: brighter toward the sun and the horizon, as the photo's own sky was. The image's clouds stay."
                    value={piece.keepLight ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'None')}
                    onChange={(keepLight) => props.onPiece(selected, { keepLight }, `collage-keeplight-${piece.id}`)}
                  />
                  <Slider
                    label="Light the photo"
                    title="Tints the rest of the photo with the image's colour, as the sky would light it: a warm sky warms the street. Brightness stays."
                    value={piece.relight ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'None')}
                    onChange={(relight) => props.onPiece(selected, { relight }, `collage-relight-${piece.id}`)}
                  />
                  <Slider
                    label="Smooth image"
                    title="Softens the image's own grain and noise, so it does not carry a second grain under the recipe's"
                    value={piece.smooth ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    format={(v) => (v > 0 ? `${Math.round(v * 100)}%` : 'None')}
                    onChange={(smooth) => props.onPiece(selected, { smooth }, `collage-smooth-${piece.id}`)}
                  />
                </div>
              </Disclosure>
              <label className="check-row" title="While you move, size or turn the image, show the rest of it faintly outside the piece">
                <input type="checkbox" checked={props.showGhost} onChange={(e) => props.onShowGhost(e.target.checked)} />
                Show the rest of the image while moving
              </label>
              <div className="row">
                <button className={piece.flip ? 'on' : ''} onClick={() => props.onPiece(selected, { flip: !piece.flip })}>
                  Flip
                </button>
                <button title="The image centred on its piece and straight, at its size" onClick={() => props.onFit(selected)}>
                  Recentre
                </button>
                <button
                  title="Give every piece this piece's size, once, so their clouds match"
                  disabled={collage.pieces.length < 2}
                  onClick={() => props.onMatchSizes(selected)}
                >
                  Make every piece this size
                </button>
                <button className={swapping ? 'on' : ''} onClick={() => setSwapping(!swapping)}>
                  Swap image
                </button>
                {piece.tint && (
                  <button
                    title="Arrange pulled this image's colour toward the others'. Give it back its own colour."
                    onClick={() => props.onPiece(selected, { tint: undefined })}
                  >
                    Own colour
                  </button>
                )}
                <button
                  disabled={piece.seeds.length < 2}
                  title="Take back the last gap added to this piece"
                  onClick={() => props.onPiece(selected, { seeds: piece.seeds.slice(0, -1) })}
                >
                  Undo gap
                </button>
              </div>
            </>
          )}
        </ItemList>
      )}
      {props.hasImage && (collage.pieces.length > 0 || props.editing) && !props.otherPhoto && !props.arranging && (
        <>
          <button
            className={props.editing ? 'on' : ''}
            title={
              props.editing
                ? 'Stop working on the collage: the photo pans again'
                : 'Show the pieces on the photo, to select them, move their images and size them'
            }
            onClick={() => props.onEditing(!props.editing)}
          >
            Move and size on photo
          </button>
          <EditBox at="collage" />
        </>
      )}
    </div>
  )
}
