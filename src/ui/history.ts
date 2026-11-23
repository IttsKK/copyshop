import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { BlendParams } from '../engine/types'
import type { OutputSettings } from '../storage/presets'
import type { GrainSource } from '../sources/GrainSource'
import type { Look } from './looks'
import { changeTitle, wholeTitle } from './historyLabels'
import { historyView, OPENED, travel, type HistoryView, type StepEntry } from './historySteps'

export type { HistoryStep, HistoryView } from './historySteps'

/** Everything an edit can change: undo puts all of it back together. */
export interface EditState {
  blend: BlendParams
  source: GrainSource | null
  output: OutputSettings
  look: Look | null
  presetId: string
}

/** How many steps back undo can go. */
export const HISTORY_LIMIT = 300

/**
 * Hint for a step that never folds into the one before — a look, a preset, a
 * snapshot — followed by its name: `${WHOLE_STEP}look`.
 */
export const WHOLE_STEP = '!'

/**
 * Hint for changes that are one step however long they take, as long as
 * nothing else is changed between them: `${SESSION_STEP}crop:3` is every
 * change made while the crop is set on the photo, drags and clicks alike.
 */
export const SESSION_STEP = '~'

type Entry = StepEntry<EditState>

function startHistory() {
  const openedAt = Date.now()
  return {
    past: [] as Entry[],
    future: [] as Entry[],
    last: null as EditState | null,
    sig: '',
    at: 0,
    gesture: -1,
    hint: null as string | null,
    restoring: null as EditState | null,
    suspended: false,
    /** When the photo was opened: the first row of the list. */
    openedAt,
    /** That row's title: OPENED, or OPENED_EDITED for a photo that opened with its saved edit. */
    opened: OPENED as string,
    /** The oldest steps were dropped (HISTORY_LIMIT): the first row is no longer the photo as opened. */
    trimmed: false,
    listeners: new Set<() => void>(),
    view: historyView<EditState>([], [], openedAt, false),
  }
}

/**
 * Undo and redo for the whole edit. Rather than every control saving the
 * state before it changes it, this watches the state: each change keeps what
 * was there before. Changes fold into one step when they are one action —
 * everything during a single press (a slider dragged, a shape dragged on
 * the photo), or the same control nudged again within a second (arrow keys
 * on a slider) — so a step is what you would call one edit. A click is
 * always its own step, and so is anything hinted WHOLE_STEP.
 *
 * `hint` names the next change, for changes the state alone cannot group
 * right; it is used once.
 *
 * The History panel reads the steps through `subscribe` and `view` (see
 * useHistoryView), so only the panel renders when they change, and goes to
 * one with `jumpTo`. The returned object is the same on every render.
 */
export function useEditHistory(state: EditState, restore: (to: EditState) => void) {
  const h = useRef<ReturnType<typeof startHistory>>(null!)
  if (!h.current) h.current = startHistory()
  const press = useRef({ down: false, gesture: 0, clickAt: 0 })
  const restoreRef = useRef(restore)
  restoreRef.current = restore

  /** The list changed: a new snapshot for the panel. */
  const changedList = () => {
    const r = h.current
    r.view = historyView(r.past, r.future, r.openedAt, r.trimmed, r.opened)
    for (const l of r.listeners) l()
  }

  useEffect(() => {
    const down = () => {
      press.current.down = true
      press.current.gesture++
    }
    const up = () => (press.current.down = false)
    const click = () => (press.current.clickAt = Date.now())
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    window.addEventListener('click', click, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
      window.removeEventListener('click', click, true)
    }
  }, [])

  const { blend, source, output, look, presetId } = state
  useEffect(() => {
    const now: EditState = { blend, source, output, look, presetId }
    const r = h.current
    const before = r.last
    r.last = now
    if (!before) return
    // A timelapse playing back: none of it is an edit.
    if (r.suspended) return
    if (r.restoring) {
      const done = same(r.restoring, now)
      if (done) r.restoring = null
      return
    }
    // Starting up: the grain arrives after the first render.
    if (!before.source) return
    const path = changed(before, now)
    const sig = r.hint ?? path
    r.hint = null
    if (!path) return
    const whole = sig.startsWith(WHOLE_STEP)
    // Only which recipe is marked as in use changed (saving or deleting one): nothing to undo in the edit.
    if (!whole && before.blend === now.blend && before.source === now.source && before.output === now.output) return
    const session = sig.startsWith(SESSION_STEP)
    const t = Date.now()
    const p = press.current
    const clicked = t - p.clickAt < 300
    const folds =
      !whole &&
      r.past.length > 0 &&
      ((p.down && r.gesture === p.gesture) || (session ? r.sig === sig : !clicked && r.sig === sig && t - r.at < 1000))
    // Back to how it was before the last step, moments after it (a switch
    // flicked on and off, a choice tried and taken back): the two cancel
    // out, and neither is left in the list.
    const top = r.past[r.past.length - 1]
    const soon = !folds && !!top && t - r.at < UNDONE_WITHIN_MS
    if (
      soon &&
      ((!whole && !top.named && alike(top.state, now)) ||
        flippedBack(top.title, whole ? wholeTitle(sig.slice(WHOLE_STEP.length)) : changeTitle(before, now)))
    ) {
      r.past.pop()
      r.future = []
      r.gesture = -1
      r.sig = ''
      r.at = t
      changedList()
      return
    }
    if (!folds) {
      const label = whole ? sig.slice(WHOLE_STEP.length) : describe(path)
      const title = whole ? wholeTitle(label) : changeTitle(before, now) || cap(label)
      r.past.push({ state: before, label, title, at: t, named: whole })
      if (r.past.length > HISTORY_LIMIT) {
        r.past.shift()
        r.trimmed = true
      }
      r.future = []
      r.gesture = p.down ? p.gesture : -1
      changedList()
    } else {
      // The step grew: name it by all it changed now, if that reads differently.
      const top = r.past[r.past.length - 1]
      if (top && !top.named) {
        const title = changeTitle(top.state, now) || top.title
        if (title !== top.title) {
          r.past[r.past.length - 1] = { ...top, title }
          changedList()
        }
      }
    }
    r.sig = sig
    r.at = t
  }, [blend, source, output, look, presetId])

  return useMemo(() => {
    /** Go to row `index` of the list (see HistoryView) as that many undos or redos would, with one restore. */
    const jumpTo = (index: number): { moved: Entry[]; back: boolean } | null => {
      const r = h.current
      if (!r.last) return null
      const back = index < r.past.length
      const went = travel(r.past, r.future, r.last, index)
      if (!went) return null
      r.past = went.past
      r.future = went.future
      r.sig = ''
      r.restoring = same(went.state, r.last) ? null : went.state
      restoreRef.current(went.state)
      changedList()
      return { moved: went.moved, back }
    }
    return {
      /** Name the next change. */
      hint: (step: string | null) => {
        h.current.hint = step
      },
      /**
       * Another photo: its edit has a history of its own, so undo never puts
       * one photo's edit on another. The change that opens it is not a step.
       */
      reset: (opened: string = OPENED) => {
        const r = h.current
        r.opened = opened
        r.past = []
        r.future = []
        r.sig = ''
        r.last = null
        r.restoring = null
        r.openedAt = Date.now()
        r.trimmed = false
        changedList()
      },
      /** How many steps there are to undo. */
      steps: () => h.current.past.length,
      /** Stop taking steps: a timelapse is playing back through the edit. */
      suspend: () => {
        h.current.suspended = true
      },
      /** Take steps again, after putting `to` back (the edit as it was), not as a step. */
      resume: (to: EditState) => {
        const r = h.current
        r.suspended = false
        r.sig = ''
        r.restoring = r.last && same(to, r.last) ? null : to
        restoreRef.current(to)
      },
      /** Undo (or redo) one step. Returns what it was, or null if there was nothing. */
      step: (back: boolean): string | null => {
        const r = h.current
        const went = jumpTo(r.past.length + (back ? -1 : 1))
        // Its title, as the History list shows it ("Grain: strength"), not the internal label.
        return went ? went.moved[0].title || went.moved[0].label : null
      },
      /**
       * Go to a row of the list: back to an earlier step, or forward to one
       * undone, in one go. Steps after it stay until a new change drops them,
       * as redo does. Returns the row's title, or null if it is where the
       * edit is now (or not a row).
       */
      jumpTo: (index: number): string | null => (jumpTo(index) ? h.current.view.steps[index].title : null),
      /**
       * Make the steps from a row to the newest one step, named as the newest:
       * a module switched on by an action and what the action then made undo
       * together.
       */
      squashFrom: (row: number) => {
        const r = h.current
        const i = row - 1
        if (i < 0 || i >= r.past.length - 1) return
        const first = r.past[i]
        const last = r.past[r.past.length - 1]
        r.past.splice(i, r.past.length - i, { ...last, state: first.state })
        changedList()
      },
      /** Forget the steps undone (nothing to redo): for a step taken back because what it began was cancelled. */
      dropRedo: () => {
        if (!h.current.future.length) return
        h.current.future = []
        changedList()
      },
      /** For useSyncExternalStore: called whenever the list changes. */
      subscribe: (listener: () => void) => {
        h.current.listeners.add(listener)
        return () => {
          h.current.listeners.delete(listener)
        }
      },
      /** The list as it is now; the same object until it changes. */
      view: (): HistoryView => h.current.view,
    }
    // Everything it uses is in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}

export type EditHistory = ReturnType<typeof useEditHistory>

/** What the History panel needs of the history. */
export type HistorySource = Pick<EditHistory, 'subscribe' | 'view' | 'jumpTo'>

/** The steps, re-rendering the calling component (and nothing else) when they change. */
export function useHistoryView(history: HistorySource): HistoryView {
  return useSyncExternalStore(history.subscribe, history.view)
}

/** How soon a change that takes the last one back cancels it (see the effect above). */
const UNDONE_WITHIN_MS = 4000

/**
 * A switch flicked straight back: "Border on" then "Border off". Switching
 * a module on fills in where it starts (a border's width), which switching
 * it off keeps, so the edit is not quite as it was, but nothing shows it.
 */
function flippedBack(last: string, now: string): boolean {
  const a = /^(.+) (on|off)$/.exec(last)
  const b = /^(.+) (on|off)$/.exec(now)
  return !!a && !!b && a[1] === b[1] && a[2] !== b[2]
}

/** The same edit, by value: a switch flicked back makes new objects with the old values. */
const alike = (a: EditState, b: EditState) =>
  a.source === b.source && a.look === b.look && a.presetId === b.presetId && equal(a.output, b.output) && equal(a.blend, b.blend)

function equal(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b)
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  // A box ticked and unticked leaves false where there was nothing: the same.
  const kx = Object.keys(x).filter((k) => x[k] !== undefined && x[k] !== false)
  const ky = Object.keys(y).filter((k) => y[k] !== undefined && y[k] !== false)
  return kx.length === ky.length && kx.every((k) => equal(x[k], y[k]))
}

const same = (a: EditState, b: EditState) =>
  a.blend === b.blend && a.source === b.source && a.output === b.output && a.look === b.look && a.presetId === b.presetId

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Where the state changed, as a path: blend.effects.grade.mapContrast. Empty if nothing did. */
function changed(a: EditState, b: EditState): string {
  if (a.source !== b.source) return 'grain'
  if (a.blend !== b.blend) return 'blend' + diff(a.blend, b.blend, 3)
  if (a.output !== b.output) return 'output' + diff(a.output, b.output, 1)
  if (a.look !== b.look || a.presetId !== b.presetId) return 'look'
  return ''
}

function diff(a: unknown, b: unknown, depth: number): string {
  if (depth === 0 || !a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a)) return ''
  const x = a as Record<string, unknown>
  const y = b as Record<string, unknown>
  const keys = Object.keys(y).filter((k) => x[k] !== y[k])
  if (keys.length !== 1) return keys.length ? `.${keys.sort().join('+')}` : ''
  return `.${keys[0]}` + diff(x[keys[0]], y[keys[0]], depth - 1)
}

const NAMES: Record<string, string> = {
  grain: 'grain',
  look: 'look',
  output: 'export settings',
  streaks: 'streaks',
  masks: 'masks',
  maskUse: 'which masks modules use',
  grade: 'colour',
  stock: 'film stock',
  leaks: 'leaks',
  dither: 'dither',
  pixelArt: 'pixel art',
  border: 'border',
  modules: 'section switch',
  keys: 'key controls',
  defects: 'dust & scratches',
  surge: 'surge marks',
  glass: 'glass',
  crop: 'crop',
  lens: 'lens',
  prism: 'prism',
  repeat: 'repeat',
  kaleido: 'kaleidoscope',
  lighting: 'lighting',
}

/** A step's name for the status line: the most specific part we have a name for, else the setting itself. */
function describe(sig: string): string {
  const parts = sig.split('.').filter((p) => p !== 'blend' && p !== 'effects')
  for (const p of parts) if (NAMES[p]) return NAMES[p]
  const last = parts[parts.length - 1] ?? 'change'
  return last.includes('+') ? 'settings' : last.replace(/([A-Z])/g, ' $1').toLowerCase()
}
