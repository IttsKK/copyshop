import { useEffect } from 'react'
import { isMac } from '../platform/os'

export interface Shortcut {
  /**
   * The key, with any modifiers before it: 'z', '\\', 'cmd+o', 'cmd+shift+e',
   * 'alt+cmd+1'. `cmd` is Command on a Mac and Ctrl elsewhere. Matched
   * case-insensitively; Shift only counts for letters and digits, so '?'
   * and 'cmd+=' match however the keyboard makes them.
   */
  key: string
  label: string
  group: string
  /** Display override, for keys whose names read badly ("\\", "?"). */
  display?: string
  onDown?: () => void
  /** Present only for hold-to-act shortcuts, which the help panel marks. */
  onUp?: () => void
  /** Listed in the help panel only: the key is handled elsewhere (Cmd+Z). */
  displayOnly?: boolean
  /** Only when this holds; otherwise the key does what it normally does. */
  when?: () => boolean
  /** Works, but is left out of the help panel (a second key for something listed). */
  unlisted?: boolean
  /** Fires while typing in a field too. For Command shortcuts that text fields have no use for. */
  inFields?: boolean
}

interface Combo {
  key: string
  cmd: boolean
  alt: boolean
  shift: boolean
}

function parse(spec: string): Combo {
  const parts = spec.toLowerCase().split('+')
  // 'cmd++' is Command and the plus key.
  const key = spec.endsWith('++') ? '+' : parts[parts.length - 1]
  const mods = new Set(parts.slice(0, spec.endsWith('++') ? -2 : -1))
  return { key, cmd: mods.has('cmd'), alt: mods.has('alt'), shift: mods.has('shift') }
}

/** Letters and digits by their place on the keyboard: Option changes the character they type on a Mac. */
function codeOf(key: string): string | null {
  if (/^[a-z]$/.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  return null
}

export function matches(spec: string, e: KeyboardEvent): boolean {
  const c = parse(spec)
  if (c.cmd !== (e.metaKey || e.ctrlKey) || c.alt !== e.altKey) return false
  const code = codeOf(c.key)
  if (code) return e.code === code ? c.shift === e.shiftKey : e.key.toLowerCase() === c.key && c.shift === e.shiftKey
  return e.key.toLowerCase() === c.key
}

/** Non-text inputs: a focused slider or checkbox is not typing, and Enter there means nothing to it. */
const NOT_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color'])

/**
 * Whether a key press goes to something being typed in. Unlike shortcuts,
 * Enter still finishes an editor with a slider or checkbox focused.
 */
export function inTextField(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true
  return el.tagName === 'INPUT' && !NOT_TEXT.has((el as HTMLInputElement).type)
}

/** Checks the focused element as well as the event target: a shortcut firing
 *  while the user types a preset suffix would be maddening. */
function isTyping(target: EventTarget | null): boolean {
  // A focused slider or checkbox (clicked a moment ago) isn't typing: the keys still work.
  return inTextField(target) || inTextField(document.activeElement)
}

/**
 * Binds a shortcut list. The list is the single source of truth: the help
 * overlay renders from the same array, so a shortcut cannot exist without
 * being documented.
 */
export function useShortcuts(shortcuts: Shortcut[], enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const held = new Set<string>()

    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return
      const match = shortcuts.find((s) => !s.displayOnly && matches(s.key, e))
      if (!match || (isTyping(e.target) && !match.inFields) || (match.when && !match.when())) return
      // A window open (Settings, Help, the palette): a plain key belongs to it, not to what's behind.
      if (!e.metaKey && !e.ctrlKey && !match.inFields && e.key !== 'Escape' && document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      // Ignore auto-repeat for hold shortcuts so they fire once.
      if (match.onUp && held.has(match.key)) return
      held.add(match.key)
      match.onDown?.()
    }

    const up = (e: KeyboardEvent) => {
      for (const key of held) {
        const s = shortcuts.find((x) => x.key === key)
        if (!s || parse(s.key).key !== e.key.toLowerCase()) continue
        held.delete(key)
        s.onUp?.()
      }
    }

    // Releasing the key after the window loses focus never reaches us, so
    // clear held state on blur or a stuck "show original" would hide the grain.
    const blur = () => {
      for (const key of held) shortcuts.find((s) => s.key === key)?.onUp?.()
      held.clear()
    }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
      blur()
    }
  }, [shortcuts, enabled])
}

const GLYPHS: Record<string, string> = { cmd: '⌘', alt: '⌥', shift: '⇧' }
const WORDS: Record<string, string> = { cmd: 'Ctrl', alt: 'Alt', shift: 'Shift' }

/**
 * A key spec ('cmd+shift+e') as the keyboard reads: '⇧⌘E' on a Mac,
 * 'Ctrl+Shift+E' elsewhere. For tooltips as well as the help panel.
 */
/**
 * The panel toggles: Option-Command on a Mac. Elsewhere Ctrl+Shift, because
 * Windows reads AltGr as Ctrl+Alt, and AltGr with a digit types characters.
 */
export const PANEL_KEYS = isMac()
  ? { left: 'alt+cmd+1', right: 'alt+cmd+2', strip: 'alt+cmd+3' }
  : { left: 'cmd+shift+1', right: 'cmd+shift+2', strip: 'cmd+shift+3' }

export function keyLabel(spec: string, mac = isMac()): string {
  const parts = spec.split('+')
  const key = spec.endsWith('++') ? '+' : parts[parts.length - 1]
  const mods = parts.slice(0, spec.endsWith('++') ? -2 : -1)
  const name = key.length === 1 ? key.toUpperCase() : key === 'escape' ? 'Esc' : key[0].toUpperCase() + key.slice(1)
  // The Mac's order: Option, Shift, Command. Elsewhere: Ctrl, Alt, Shift.
  if (mac) return ['alt', 'shift', 'cmd'].filter((m) => mods.includes(m)).map((m) => GLYPHS[m]).join('') + name
  return [...['cmd', 'alt', 'shift'].filter((m) => mods.includes(m)).map((m) => WORDS[m]), name].join('+')
}

/** Text written with the Mac's glyphs ('? or ⌘/') in Ctrl+ words off a Mac. */
export function keyText(text: string, mac = isMac()): string {
  if (mac) return text
  return text.replace(/[⌥⇧⌘]+/g, (glyphs) =>
    [['⌘', 'Ctrl'], ['⌥', 'Alt'], ['⇧', 'Shift']]
      .filter(([g]) => glyphs.includes(g))
      .map(([, word]) => `${word}+`)
      .join(''),
  )
}

export function shortcutDisplay(shortcut: Shortcut, mac = isMac()): string {
  if (shortcut.display) return keyText(shortcut.display, mac)
  return keyLabel(shortcut.key, mac)
}
