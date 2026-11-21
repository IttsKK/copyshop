import type { StreakShape } from '../engine/types'
import type { StreakTool } from './StreakOverlay'
import type { FixEditing } from './StreakFixes'
import type { GuideState } from './StreakGuideOverlay'
import type { EditView } from './EditBox'

/** What each tool is, as its edit box names it: "Streak 1: end line". */
export const STREAK_TOOL_NAMES: Record<StreakTool, string> = {
  all: 'Everything',
  shape: 'Shape',
  direction: 'Direction',
  path: 'Path',
  ends: 'End line',
  middle: 'Middle',
  fixes: 'Fixes',
  guides: 'Guides',
}

/** The tools an edit session on this streak has: only what it can have changed on the photo. */
export function streakTools(sh: StreakShape): StreakTool[] {
  if (sh.mode === 'mask') return ['shape']
  const path = !!sh.path && sh.path.length >= 2
  return [
    'shape',
    ...(path ? [] : (['direction'] as const)),
    ...(sh.radial ? [] : (['path'] as const)),
    ...(sh.mode === 'trail' ? (['ends'] as const) : []),
    ...(sh.mirror && !sh.radial ? (['middle'] as const) : []),
    'fixes' as const,
    ...(!path && !sh.radial ? (['guides'] as const) : []),
  ]
}

interface Props {
  shape: StreakShape
  tool: StreakTool
  onTool: (tool: StreakTool, draw?: boolean) => void
  /** Something is being drawn in it: a path or an end line. */
  drawing: boolean
  fixEditing: FixEditing
  onAddFix: () => void
  /** Laying guides: a line being laid or chosen, and the keys that finish or remove it (Enter, Delete). */
  guideState: GuideState
  onGuideKey: (key: 'Enter' | 'Delete') => void
  /** Guide points snap onto the photo's edges. */
  guideSnap: boolean
  onGuideSnap: (on: boolean) => void
}

/**
 * Editing one streak on the photo (App's streakSession), as its edit box
 * shows it (EditBox): its tools (only the one chosen shows its handles),
 * what to do with the one chosen, and that tool's few extras.
 */
export function streakEditParts({ shape, tool, onTool, drawing, fixEditing, guideState, onGuideKey, guideSnap, onGuideSnap }: Props): Pick<EditView, 'tools' | 'tool' | 'onTool' | 'hint' | 'extras'> {
  const has = (k: 'path' | 'ends') => !!shape[k] && shape[k]!.length >= 2
  // A few words, only where nothing on the photo shows yet what to do:
  // every handle says what it does when pointed at (StreakOverlay).
  const hint = (() => {
    switch (tool) {
      case 'path':
        return drawing ? 'Click along the curve' : undefined
      case 'ends':
        return drawing ? 'Click across where bars end' : undefined
      case 'fixes':
        return fixEditing === 'add' ? 'Drag across the part to fix' : fixEditing === 'source' ? 'Drag across the part to copy' : undefined
      case 'guides':
        return guideState === 'idle' && !shape.guides?.length ? 'Click along a straight edge' : undefined
      default:
        return undefined
    }
  })()
  const extras = (
    <>
      {(tool === 'path' || tool === 'ends') && has(tool) && !drawing && (
        <button className="link" onClick={() => onTool(tool, true)}>
          Draw again
        </button>
      )}
      {tool === 'guides' && (
        <label className="check-row" title="Move each point onto the nearest edge in the photo when it is placed or let go">
          <input type="checkbox" checked={guideSnap} onChange={(e) => onGuideSnap(e.target.checked)} />
          Snap to edges
        </label>
      )}
      {tool === 'guides' && guideState === 'laying' && (
        <button className="link" title="Finish this line (Enter): the next click starts another" onClick={() => onGuideKey('Enter')}>
          Finish line
        </button>
      )}
      {tool === 'guides' && guideState === 'chosen' && (
        <button className="link" title="Take this line away (Delete)" onClick={() => onGuideKey('Delete')}>
          Remove line
        </button>
      )}
    </>
  )
  // (Fix a part is the button over the box, in Fixes.)
  const showsExtras = ((tool === 'path' || tool === 'ends') && has(tool) && !drawing) || tool === 'guides'
  return {
    tools: streakTools(shape).map((t) => ({ id: t, name: STREAK_TOOL_NAMES[t] })),
    tool,
    onTool: (t) => onTool(t as StreakTool),
    hint,
    extras: showsExtras ? extras : undefined,
  }
}

/** Drawing a new streak's shape, as its edit box says it. */
export const DRAWING_STREAK_HINT = 'Click round the area'
