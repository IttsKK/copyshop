import { keyWords } from '../../platform/os'
import { EditBox } from '../EditBox'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { type BlendParams, type MaskShape, MAX_STREAKS, type StreakParams, type StreakShape } from '../../engine/types'
import { ItemList } from '../ItemList'
import type { FixEditing } from '../StreakFixes'
import type { StreakTool } from '../StreakOverlay'
import { StreakSettings, type StreakNewMask, type StreakOwnMasks, type StreakTab } from '../StreakSettings'
import type { TraceOutline } from '../TraceToKey'
import { Disclosure, Module, ModuleActions, Slider } from '../controls'
import type { EditHistory } from '../history'
import type { LoadedImage } from '../loadedImage'
import { FACTORY } from '../moduleCatalog'
import { PickPanel, type PickingState } from '../MasksPanel'

interface Props {
  drawingStreak: boolean
  image: LoadedImage | null
  blend: BlendParams
  setDrawingStreak: Dispatch<SetStateAction<boolean>>
  setDrawingPath: Dispatch<SetStateAction<boolean>>
  setFixEditing: Dispatch<SetStateAction<FixEditing>>
  setStreaks: (patch: Partial<StreakParams>, step?: string | null) => void
  setEditingStreaks: Dispatch<SetStateAction<boolean>>
  setSelectedStreak: Dispatch<SetStateAction<number | null>>
  setEditingLeaks: Dispatch<SetStateAction<boolean>>
  setEditingGuides: Dispatch<SetStateAction<boolean>>
  setEditingBands: Dispatch<SetStateAction<boolean>>
  setMaskDrawing: Dispatch<SetStateAction<boolean>>
  setMaskEditing: Dispatch<SetStateAction<boolean>>
  setStatus: Dispatch<SetStateAction<string | null>>
  selectedStreak: number | null
  setGuidingStreak: Dispatch<SetStateAction<boolean>>
  setStreakShape: (i: number, patch: Partial<StreakShape>) => void
  editingStreaks: boolean
  drawingPath: boolean
  fixEditing: FixEditing
  setLightEditing: Dispatch<SetStateAction<boolean>>
  setLightDrawing: Dispatch<SetStateAction<boolean>>
  history: EditHistory
  streakSel: StreakShape | undefined
  traceOutline: TraceOutline | undefined
  guidingStreak: boolean
  matchLines: (i: number, base?: Partial<StreakShape>, quiet?: boolean) => void
  fitRepeat: (i: number, say: boolean) => void
  extendSubject: (i: number, extra?: Partial<StreakShape>) => void
  listedMasks: MaskShape[]
  /** Making a mask of streak `i`'s own, from its Mask tab, used by it once made. */
  newMaskFor: (i: number) => StreakNewMask
  repeatFit: (sh: StreakShape) => { length: number; vanish: number } | null
  streakTab: StreakTab
  /** Editing a streak on the photo (App's streakSession), and starting one on a tool (draw: draw it again). */
  session: { index: number; tool: StreakTool } | null
  startSession: (index: number, tool: StreakTool, draw?: boolean) => void
  endSession: (keep: boolean) => void
  setStreakTab: Dispatch<SetStateAction<StreakTab>>
  pathKind: 'path' | 'ends'
  setPathKind: Dispatch<SetStateAction<'path' | 'ends'>>
  selectedFix: number | null
  setSelectedFix: Dispatch<SetStateAction<number | null>>
  /** A subject being picked to streak (Streak a subject), and for which streak (null: a new one). */
  pickingView: PickingState | null
  pickingStreak: number | null
  choosePickReading: (reading: number) => void
  finishPicking: (keep: boolean) => void
  /** Pick a subject to streak: a new streak, or the subject of streak `i` again. */
  onStreakSubject: (i?: number) => void
  /** A subject streak's outline taken in from its subject's edge by this much. */
  onSubjectInset: (i: number, inset: number) => void
  /** A streak's own subject's settings (App: brush, select again, match). */
  subjectSettings: (streak: number, maskId: string) => ReactNode
  /** A copy of streak i next after it, its own subject copied too; false if there is no room. And one removed, its own subject with it (App). */
  copyStreak: (i: number) => boolean
  removeStreak: (i: number) => void
  /** Streak `from` moved to `to` in the list: the higher one is in front where they cross. */
  moveStreak: (from: number, to: number) => void
  /** Streak i's settings copied, and copied settings pasted onto streak i; `clip` names the streak they came from. */
  copySettings: (i: number) => void
  pasteSettings: (i: number) => void
  clip: string | null
  /** Streak i's own masks, for its Mask tab. */
  ownMasks: (i: number) => StreakOwnMasks
  /** Streak i shown on the photo with these settings for now, without changing it (null: as it is). */
  previewStreak: (i: number, patch: Partial<StreakShape> | null) => void
}

/** Streaks: the photo smeared along shapes drawn on it, each with its own settings, guides and colour fixes. */
export function StreaksModule({ previewStreak, moveStreak, copySettings, pasteSettings, clip, ownMasks, subjectSettings, copyStreak, removeStreak, session, startSession, endSession, drawingStreak, image, blend, setDrawingStreak, setDrawingPath, setFixEditing, setStreaks, setEditingStreaks, setSelectedStreak, setEditingLeaks, setEditingGuides, setEditingBands, setMaskDrawing, setMaskEditing, setStatus, selectedStreak, setGuidingStreak, setStreakShape, drawingPath, fixEditing, streakSel, traceOutline, guidingStreak, matchLines, fitRepeat, extendSubject, listedMasks, newMaskFor, repeatFit, streakTab, setStreakTab, pathKind, selectedFix, setSelectedFix, pickingView, pickingStreak, choosePickReading, finishPicking, onStreakSubject, onSubjectInset }: Props) {
  const full = blend.effects.streaks.shapes.length >= MAX_STREAKS
  /** A tool begun from a button in the open streak's tabs; the same button again is Done. */
  const toggleTool = (tool: StreakTool) => {
    if (selectedStreak === null) return
    if (session?.index === selectedStreak && session.tool === tool) endSession(true)
    else startSession(selectedStreak, tool)
  }
  const pickingNew = !!pickingView && pickingStreak === null
  const count = blend.effects.streaks.shapes.length
  return (
    <Module
      id="streaks"
      title="Streaks"
    >
      {/* One way in at a time: while a subject is being picked or a shape drawn, the other button waits and this one cancels. */}
      <ModuleActions>
        <button
          className={pickingNew ? 'on' : ''}
          disabled={!image || (full && !pickingNew) || drawingStreak}
          title={
            full
              ? `Up to ${MAX_STREAKS} streaks`
              : drawingStreak
                ? 'Finish or cancel the shape you are drawing first'
                : pickingNew
                  ? 'Stop picking'
                  : 'Click the thing to streak on the photo: the streak comes off its edge, and it stays in front'
          }
          onClick={() => {
            if (pickingNew) return finishPicking(false)
            setDrawingStreak(false)
            setDrawingPath(false)
            setEditingLeaks(false)
            setEditingGuides(false)
            setEditingBands(false)
            onStreakSubject()
          }}
        >
          {/* Lit while picking; Cancel and Done are in the pick panel just below. Clicking it again stops too. */}
          Streak a subject
        </button>
        <button
          className={drawingStreak ? 'on' : ''}
          disabled={!image || (full && !drawingStreak) || pickingNew}
          title={
            full
              ? `Up to ${MAX_STREAKS} streaks`
              : pickingNew
                ? 'Finish or cancel picking the subject first'
                : keyWords("Draw the shape yourself: click points round the area on the photo (drag to place each one, Option-drag to trace freehand); then Done (or Enter) closes it")
          }
          onClick={() => {
            setDrawingStreak(!drawingStreak)
            setDrawingPath(false)
            setFixEditing(null)
            // The section switches on when the streak is made (App), so cancelling leaves it as it was.
            setEditingStreaks(!drawingStreak)
            if (!drawingStreak) setSelectedStreak(null)
            setEditingLeaks(false)
            setEditingGuides(false)
            setEditingBands(false)
            setMaskDrawing(false)
            setMaskEditing(false)
            setStatus(
              drawingStreak
                ? null
                : 'Click round the area to streak',
            )
          }}
        >
          Draw a streak
        </button>
      </ModuleActions>
      <EditBox at="streaks" />
      {pickingNew && pickingView && <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />}
      {count > 0 && (
        <span className="module-group-head streak-list-head" title="Each streak has its own settings: click one to open them. Where they cross, the one higher in the list is in front: drag one by its name to move it.">
          Your streaks
        </span>
      )}
      <ItemList
        // Editing one on the photo, its own keys answer: Delete takes away a guide or a point, not the streak.
        keysOff={!!session}
        onMove={moveStreak}
        open={selectedStreak}
        onOpen={(i) => {
          // Open: its settings. Editing on the photo is the pencil's. A subject
          // being picked again for the one that was open is let go.
          if (pickingView && i !== selectedStreak) finishPicking(false)
          setSelectedStreak(i)
          setDrawingPath(false)
          setDrawingStreak(false)
          setFixEditing(null)
          setGuidingStreak(false)
          setEditingStreaks(false)
        }}
        items={blend.effects.streaks.shapes.map((sh, i) => ({
          key: String(i),
          name: `${sh.mode === 'mask' ? 'Mask' : 'Streak'} ${i + 1}`,
          summary:
            sh.mode === 'mask'
              ? sh.feather > 0
                ? `Feather ${(sh.feather * 100).toFixed(1)}%`
                : 'Hard edge'
              : `${sh.subject ? 'From a subject' : sh.mode === 'trail' ? 'Drawn, trailing' : 'Drawn'}${sh.carry === 'repeat' ? ' · copies' : ''}${sh.path ? ' · curved' : ''}`,
          label: `streak ${i + 1}`,
          on: sh.enabled !== false,
          onToggle: () => setStreakShape(i, { enabled: sh.enabled === false }),
          // The pencil: edit it on the photo (a session, Done or Cancel on the photo).
          // The pencil: the streak on the photo with every handle it has
          // (its shape's points, unless it comes off a subject; its arrow,
          // bend, length, side lines, curve, middle). One tool at a time is
          // a button in its tabs.
          editing: session?.index === i && session.tool === 'all',
          editTitle: `Edit streak ${i + 1} on the photo: ${sh.subject ? 'its' : 'its shape and its'} direction, bend, length and curve`,
          onEdit: () => (session?.index === i && session.tool === 'all' ? endSession(true) : startSession(i, 'all')),
          // A copy, next after it, open and on the photo to move it where it goes.
          onDuplicate: () => {
            if (!copyStreak(i)) return
            setSelectedStreak(i + 1)
            if (image) startSession(i + 1, 'shape')
          },
          full: full ? `Up to ${MAX_STREAKS} streaks` : undefined,
          actions: [
            { label: 'Copy settings', title: 'Copy its look (bars, colour, tone, length) to paste onto another streak', onClick: () => copySettings(i), apart: true },
            {
              label: clip ? `Paste settings from ${clip}` : 'Paste settings',
              title: clip ? `Give it ${clip}'s look; its shape, direction, masks and fixes stay its own` : 'Copy another streak’s settings first',
              disabled: !clip,
              onClick: () => pasteSettings(i),
            },
            {
              label: 'Mask…',
              title: 'Keep this streak off part of the photo (or only on it), with a mask of its own',
              apart: true,
              onClick: () => {
                setSelectedStreak(i)
                setStreakTab('where')
              },
            },
          ],
          onRemove: () => {
            if (pickingView) finishPicking(false)
            removeStreak(i)
            setSelectedStreak(null)
            setEditingStreaks(false)
            setDrawingPath(false)
            setFixEditing(null)
          },
        }))}
      >
        {/* An edit going on in it: under its tabs when its settings show, here otherwise. */}
        {selectedStreak !== null && !streakSel && <EditBox at={`streaks/${selectedStreak}`} />}
        {pickingView && pickingStreak !== null && pickingStreak === selectedStreak && (
          <PickPanel p={pickingView} onPickReading={choosePickReading} onPickDone={finishPicking} />
        )}
        {streakSel && selectedStreak !== null && (
                    <StreakSettings
                      index={selectedStreak}
                      editBox={<EditBox at={`streaks/${selectedStreak}`} />}
                      onPreview={(patch) => previewStreak(selectedStreak, patch)}
                      trace={traceOutline}
                      guiding={guidingStreak}
                      onGuides={() => toggleTool('guides')}
                      onAdjust={() => toggleTool('direction')}
                      sessionTool={session?.index === selectedStreak ? session.tool : null}
                      toolBox={(t) => <EditBox at={`streaks/${selectedStreak}/${t}`} />}
                      onMirrorMiddle={() => toggleTool('middle')}
                      onMatchLines={(base, quiet) => matchLines(selectedStreak, base, quiet)}
                      aspect={image ? image.size.width / image.size.height : undefined}
                      onFitRepeat={() => fitRepeat(selectedStreak, true)}
                      // Only a subject has something to carry on; a hand-drawn streak doesn't.
                      onExtend={streakSel.subject ? (extra) => extendSubject(selectedStreak, extra) : undefined}
                      subject={
                        streakSel.subject && blend.effects.masks.some((m) => m.id === streakSel.subject!.mask && (m.raster || m.outline.length >= 3))
                          ? {
                              onReselect: () => onStreakSubject(selectedStreak),
                              onInset: (inset) => onSubjectInset(selectedStreak, inset),
                              reselecting: pickingStreak === selectedStreak,
                              body: subjectSettings(selectedStreak, streakSel.subject.mask),
                            }
                          : undefined
                      }
                      masks={listedMasks}
                      newMask={newMaskFor(selectedStreak)}
                      own={ownMasks(selectedStreak)}
                      key={selectedStreak}
                      shape={streakSel}
                      onChange={(patch) => {
                        // Repeat chosen for the first time: its copies fitted to the subject's rhythm.
                        const sh = blend.effects.streaks.shapes[selectedStreak]
                        const fitted = patch.carry === 'repeat' && sh && sh.repeatLength === undefined ? repeatFit(sh) : null
                        // (Its pattern kept too: Layers takes more of it.)
                        // A length set by hand is the streak's own from now on, Extend or not.
                        const own = patch.length !== undefined && sh?.lengthBeforeExtend !== undefined ? { lengthBeforeExtend: undefined } : {}
                        setStreakShape(selectedStreak, fitted ? { ...patch, ...own, repeatLength: fitted.length, repeatPeriod: fitted.length, repeatVanish: fitted.vanish || undefined } : { ...patch, ...own })
                      }}
                      tab={streakTab}
                      onTab={setStreakTab}
                      drawingPath={drawingPath && pathKind === 'path'}
                      onDrawPath={() => toggleTool('path')}
                      drawingEnds={drawingPath && pathKind === 'ends'}
                      onDrawEnds={() => toggleTool('ends')}
                      fixes={{
                        selected: selectedFix,
                        onSelect: setSelectedFix,
                        editing: fixEditing,
                        onEditing: (editing) => {
                          // Fixes are edited on the photo in a session on their tool;
                          // finished placing one, they stay there to adjust.
                          if (editing) {
                            if (session?.index !== selectedStreak || session.tool !== 'fixes') startSession(selectedStreak, 'fixes')
                            setFixEditing(editing)
                          } else if (session?.tool === 'fixes') setFixEditing('edit')
                          else setFixEditing(null)
                        },
                        holds:
                          blend.effects.streaks.shapes.some((sh) => sh.mode === 'mask') ||
                          // The streak's own masks keeping it back (a subject streak keeps its subject in front).
                          (streakSel.maskMode === 'exclude' && streakSel.maskIds.some((id) => blend.effects.masks.some((m) => m.id === id))) ||
                          (blend.effects.maskUse?.streaks?.mode === 'exclude' &&
                            blend.effects.maskUse.streaks.ids.some((id) => blend.effects.masks.some((m) => m.id === id))),
                      }}
                    />
        )}
      </ItemList>
      {count > 0 && (
        <Disclosure
          id="streaks-all"
          title="All streaks together"
          summary={`Amount ${Math.round(blend.effects.streaks.amount * 100)}${blend.effects.streaks.graded === false ? ' · no colour grade' : ''}`}
        >
          <Slider
            label="Amount"
            value={blend.effects.streaks.amount} def={FACTORY.effects.streaks.amount}
            min={0}
            max={1}
            step={0.01}
            onChange={(amount) => setStreaks({ amount }, 'amount')}
          />
          <label className="check-row" title="Off: the Colour module's grade leaves the streaks as they are, so a subject kept out of the grade (by its mask) keeps its own colour in its streaks too">
            <input type="checkbox" checked={blend.effects.streaks.graded !== false} onChange={(e) => setStreaks({ graded: e.target.checked ? undefined : false })} />
            Colour grade on the streaks
          </label>
        </Disclosure>
      )}
    </Module>
  )
}
