import { isNative } from './native'

/**
 * Quitting the desktop app without losing the last change. The app asks the
 * page first (`quit-requested`, request_quit in src-tauri/src/lib.rs): what
 * is waiting to be saved is saved, the writes under way finish, and only then
 * does the page quit. The open photo's edit is saved a moment after each
 * change, and quitting inside that moment dropped it.
 */

const writes = new Set<Promise<unknown>>()
const hooks = new Set<() => void>()

/** A write the app must not quit in the middle of. Returns it. */
export function keepUntilWritten<T>(write: Promise<T>): Promise<T> {
  writes.add(write)
  const done = () => writes.delete(write)
  write.then(done, done)
  return write
}

/** Run `save` before the app quits: something waiting to be written, written now. Returns the call that stops it. */
export function onBeforeQuit(save: () => void): () => void {
  hooks.add(save)
  return () => hooks.delete(save)
}

/** What waits is saved, and the writes under way finish (or `limitMs` passes). */
export async function settleWrites(limitMs = 3000): Promise<void> {
  for (const save of hooks) {
    try {
      save()
    } catch {
      // One that fails doesn't keep the others from saving.
    }
  }
  const deadline = Date.now() + limitMs
  // A write may start another (an edit, then its thumbnail): wait again until none is left.
  while (writes.size && Date.now() < deadline) {
    const left = deadline - Date.now()
    await Promise.race([Promise.allSettled([...writes]), new Promise((r) => setTimeout(r, left))])
  }
}

let started = false
/** The desktop app: answer the app's quit-requested by saving, then quitting. */
export function startQuitHandling(): void {
  if (started || !isNative()) return
  started = true
  void Promise.all([import('@tauri-apps/api/event'), import('@tauri-apps/api/core')]).then(([{ listen }, { invoke }]) =>
    listen('quit-requested', async () => {
      await settleWrites().catch(() => undefined)
      await invoke('quit_app')
    }),
  )
}
