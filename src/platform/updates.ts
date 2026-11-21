import { OFFICIAL } from './build'
import { useSyncExternalStore } from 'react'
import { isNative, openUrl } from './native'

/**
 * Updates for the desktop app (Tauri's updater): it asks
 * getcopyshop.com/downloads/latest.json, written by scripts/release.mjs, which
 * lists the newest version and a signed file for each platform. An update is
 * only installed if its signature matches the key in tauri.conf.json.
 *
 * Checked a little after the app opens and every few hours. When one is
 * there, the top bar offers it; it is never installed without a click. A
 * Linux .deb can't replace itself, so there it opens the download page.
 */

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; checkedAt: number }
  | { kind: 'available'; version: string; notes?: string }
  | { kind: 'installing'; version: string; progress: number | null }
  | { kind: 'failed'; message: string }

const DOWNLOAD_PAGE = 'https://getcopyshop.com/download'
const EVERY_MS = 6 * 60 * 60 * 1000

let state: UpdateState = { kind: 'idle' }
const listeners = new Set<() => void>()
const set = (next: UpdateState) => {
  state = next
  listeners.forEach((l) => l())
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pending: any = null

/** Whether this copy can update itself: the desktop app, in a release build. */
export const canUpdate = (): boolean => isNative() && import.meta.env.PROD && OFFICIAL

/** Asks whether there is a newer version. Quiet: a failure (offline) leaves things as they were, unless asked by hand. */
export async function checkForUpdate(byHand = false): Promise<void> {
  if (!canUpdate() || state.kind === 'checking' || state.kind === 'installing') return
  set({ kind: 'checking' })
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    pending = update
    set(update ? { kind: 'available', version: update.version, notes: update.body ?? undefined } : { kind: 'none', checkedAt: Date.now() })
  } catch (err) {
    set(byHand ? { kind: 'failed', message: `Couldn't check for updates: ${(err as Error).message ?? err}` } : { kind: 'idle' })
  }
}

/** Downloads and installs the update found, then restarts the app. */
export async function installUpdate(): Promise<void> {
  if (state.kind !== 'available' || !pending) return
  const version = state.version
  set({ kind: 'installing', version, progress: null })
  try {
    let total = 0
    let got = 0
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pending.downloadAndInstall((e: any) => {
      if (e.event === 'Started') total = e.data.contentLength ?? 0
      else if (e.event === 'Progress') {
        got += e.data.chunkLength
        if (total) set({ kind: 'installing', version, progress: Math.min(1, got / total) })
      }
    })
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (err) {
    // Installed some other way (a Linux .deb): the download page has the new one.
    set({ kind: 'failed', message: `The update couldn't be installed here: ${(err as Error).message ?? err}. The download page has version ${version}.` })
    void openUrl(DOWNLOAD_PAGE)
  }
}

/** Starts checking: soon after opening, then every few hours. Once per app run. */
let started = false
export function startUpdateChecks(): void {
  if (started || !canUpdate()) return
  started = true
  setTimeout(() => void checkForUpdate(), 8000)
  setInterval(() => void checkForUpdate(), EVERY_MS)
}

export function useUpdate(): UpdateState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/** The app's version, as built (src-tauri/tauri.conf.json). */
export const APP_VERSION = __APP_VERSION__
