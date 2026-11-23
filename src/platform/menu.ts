import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isNative } from './native'
import { isMac } from './os'

/**
 * The app's menu bar (built in src-tauri/src/lib.rs). A click on one of
 * its items reaches the page as one of these ids. On a Mac their keys are
 * not sent here: the page's own shortcuts take those first, so an action
 * never runs twice. In a browser there is no menu bar and none of this does
 * anything.
 */
export type MenuAction =
  | 'settings'
  | 'open'
  | 'open-folder'
  | 'export'
  | 'export-as'
  | 'export-timelapse'
  | 'submit-gallery'
  | 'undo'
  | 'redo'
  | 'snapshot'
  | 'reset-all'
  | 'command-palette'
  | 'zoom-fit'
  | 'zoom-100'
  | 'zoom-200'
  | 'zoom-in'
  | 'zoom-out'
  | 'show-original'
  | 'phone-preview'
  | 'toggle-left'
  | 'toggle-right'
  | 'toggle-filmstrip'
  | 'library'
  | 'shortcuts'
  | 'intro'
  | 'feedback'

/*
 * On Windows and Linux the menu's keys may reach the menu as well as the
 * page, and the page has already acted on them. A menu action that arrives
 * just after a Ctrl or Alt key press is that key, not a click, and is left
 * out. Not on a Mac, where the menu only hears keys the page left alone.
 */
const KEY_ECHO_MS = 300
let lastModifiedKey = -Infinity
let watchingKeys = false
function watchKeys() {
  if (watchingKeys || isMac()) return
  watchingKeys = true
  window.addEventListener(
    'keydown',
    (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) lastModifiedKey = performance.now()
    },
    true,
  )
}
const fromKey = () => !isMac() && performance.now() - lastModifiedKey < KEY_ECHO_MS

/** Call `handler` with each menu click; returns the call that stops it. */
export function onMenuAction(handler: (id: MenuAction) => void): () => void {
  if (!isNative()) return () => {}
  watchKeys()
  let stopped = false
  let unlisten: (() => void) | null = null
  listen<MenuAction>('menu', (event) => {
    if (!fromKey()) handler(event.payload)
  }).then((stop) => {
    if (stopped) stop()
    else unlisten = stop
  })
  return () => {
    stopped = true
    unlisten?.()
  }
}

/** Grey a menu item out, or back: Export with no photo open, say. */
export function setMenuEnabled(id: MenuAction, enabled: boolean): void {
  if (!isNative()) return
  invoke('set_menu_enabled', { id, enabled }).catch(() => {})
}
