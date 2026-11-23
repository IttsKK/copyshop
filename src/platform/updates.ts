import { OFFICIAL } from './build'
import { useSyncExternalStore } from 'react'
import { isNative, openUrl } from './native'
import { onQuitLast } from './quit'
import { persistedStore } from '../ui/state/store'

/**
 * Updates for the desktop app (Tauri's updater): it asks
 * getcopyshop.com/downloads/latest.json, written by scripts/release.mjs, which
 * lists the newest version and a signed file for each platform. An update is
 * only installed if its signature matches the key in tauri.conf.json. The
 * newest is always the one offered, however old the copy asking: there is
 * no stepping through the versions between.
 *
 * Checked a little after the app opens and every few hours. With Update
 * automatically on (Settings, General; on unless turned off), a new version
 * is downloaded in the background as soon as it is found and put in place,
 * so the next time the app opens it is the new one; the top bar offers
 * Restart to update for now. On a Mac (and Linux) it is put in place at
 * once, beside the running app, which carries on as it is: however the app
 * is quit (the Dock's Quit and logging out skip the app's own quit, see
 * lib.rs), the next launch is the new version. On Windows its installer has
 * to run, so it runs as the app quits. Off, the top bar offers each one and
 * nothing is downloaded or installed without a click. A Linux .deb can't
 * replace itself: there it opens the download page.
 */

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'none'; checkedAt: number }
  /** Found, waiting for a click (Update automatically off, or it can't install itself here). */
  | { kind: 'available'; version: string; notes?: string }
  /** Found, being downloaded in the background. */
  | { kind: 'downloading'; version: string; progress: number | null }
  /** Downloaded and put in place (a Mac): the next launch is the new version; or downloaded (Windows): installed as the app quits. */
  | { kind: 'ready'; version: string }
  | { kind: 'installing'; version: string; progress: number | null }
  | { kind: 'failed'; message: string }

const DOWNLOAD_PAGE = 'https://getcopyshop.com/download'
const EVERY_MS = 3 * 60 * 60 * 1000

/** Update automatically: download new versions in the background and install them as the app quits. */
export const autoUpdateStore = persistedStore<boolean>('settings.autoUpdate', true)
/**
 * A version this copy found it can't install itself (a Linux .deb): it is
 * offered with the download page instead of being downloaded again each time.
 */
const cannotInstallStore = persistedStore<string | null>('updates.cannotInstall', null)

/**
 * Test builds (+test in the version) note each step to updates.log in the
 * app's data folder: what an update did can be read after the app has quit.
 */
const traced: string[] = []
function trace(line: string): void {
  if (!__APP_VERSION__.includes('+test')) return
  traced.push(`${new Date().toISOString()} ${line}`)
  void import('@tauri-apps/api/core')
    .then(async ({ invoke }) => {
      const dir = await invoke<string>('data_dir')
      await invoke('write_file', new TextEncoder().encode(traced.join('\n') + '\n'), { headers: { 'x-path': encodeURIComponent(`${dir}/updates.log`) } })
    })
    .catch(() => undefined)
}

let state: UpdateState = { kind: 'idle' }
const listeners = new Set<() => void>()
const set = (next: UpdateState) => {
  if (next.kind !== state.kind) trace(`state ${next.kind}${'version' in next ? ` ${next.version}` : ''}${next.kind === 'failed' ? ` ${next.message}` : ''}`)
  state = next
  listeners.forEach((l) => l())
}

// The update found (the updater's handle to it), and whether it has been downloaded.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pending: any = null
let downloaded = false
/** Put in place already: the next launch is the new version (a Mac, Linux). */
let installed = false
/** Windows: the update is an installer, run as the app quits. Elsewhere it is put in place as soon as it is downloaded. */
const installsOnQuit = (): boolean => typeof navigator !== 'undefined' && /win/i.test(navigator.platform || navigator.userAgent)

/** Whether this copy can update itself: the desktop app, in a release build. */
export const canUpdate = (): boolean => isNative() && import.meta.env.PROD && OFFICIAL

/** Asks whether there is a newer version, and with Update automatically on, downloads it. Quiet: a failure (offline) leaves things as they were, unless asked by hand. */
export async function checkForUpdate(byHand = false): Promise<void> {
  if (!canUpdate() || state.kind === 'checking' || state.kind === 'downloading' || state.kind === 'installing') return
  const before = state
  set({ kind: 'checking' })
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check()
    if (!update) {
      pending = null
      downloaded = false
      return set({ kind: 'none', checkedAt: Date.now() })
    }
    // The same one already downloaded: nothing more to do.
    if (before.kind === 'ready' && before.version === update.version && downloaded) return set(before)
    pending = update
    downloaded = false
    installed = false
    if (!autoUpdateStore.get() || cannotInstallStore.get() === update.version) {
      return set({ kind: 'available', version: update.version, notes: update.body ?? undefined })
    }
    await download(update.version)
  } catch (err) {
    set(byHand ? { kind: 'failed', message: `Couldn't check for updates: ${(err as Error).message ?? err}` } : before.kind === 'ready' ? before : { kind: 'idle' })
  }
}

/** The update found, downloaded in the background; ready to install when the app quits. */
async function download(version: string): Promise<void> {
  set({ kind: 'downloading', version, progress: null })
  let total = 0
  let got = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await pending.download((e: any) => {
    if (e.event === 'Started') total = e.data.contentLength ?? 0
    else if (e.event === 'Progress') {
      got += e.data.chunkLength
      if (total) set({ kind: 'downloading', version, progress: Math.min(1, got / total) })
    }
  })
  downloaded = true
  if (!installsOnQuit()) {
    try {
      // In place now, beside the running app: whatever way the app is quit, it opens as the new version.
      await pending.install()
      installed = true
      trace('installed in place')
    } catch (err) {
      trace(`install failed: ${(err as Error).message ?? err}`)
      // Not installable here (a Linux .deb): offered with the download page from now on.
      cannotInstallStore.set(version)
      return set({ kind: 'available', version })
    }
  }
  set({ kind: 'ready', version })
}

/** Installs the update now and restarts: downloading it first if it isn't yet (Update to …, Restart to update). */
export async function installUpdate(): Promise<void> {
  if ((state.kind !== 'available' && state.kind !== 'ready') || !pending) return
  const version = state.version
  // One this copy can't install itself: the download page has it.
  if (cannotInstallStore.get() === version) return void openUrl(DOWNLOAD_PAGE)
  set({ kind: 'installing', version, progress: null })
  try {
    // Already in place: saved, then opened again as the new version.
    if (installed) {
      const { settleWrites } = await import('./quit')
      await settleWrites().catch(() => undefined)
      const { relaunch } = await import('@tauri-apps/plugin-process')
      return await relaunch()
    }
    if (!downloaded) {
      let total = 0
      let got = 0
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await pending.download((e: any) => {
        if (e.event === 'Started') total = e.data.contentLength ?? 0
        else if (e.event === 'Progress') {
          got += e.data.chunkLength
          if (total) set({ kind: 'installing', version, progress: Math.min(1, got / total) })
        }
      })
      downloaded = true
    }
    // Saved first, as quitting does: the open photo's last change is on disk before the app goes.
    const { settleWrites } = await import('./quit')
    await settleWrites().catch(() => undefined)
    await pending.install()
    const { relaunch } = await import('@tauri-apps/plugin-process')
    await relaunch()
  } catch (err) {
    cannotInstallStore.set(version)
    set({ kind: 'failed', message: `The update couldn't be installed here: ${(err as Error).message ?? err}. The download page has version ${version}.` })
    void openUrl(DOWNLOAD_PAGE)
  }
}

/**
 * As the app quits (quit.ts): a downloaded update is installed, so the app
 * opens as the new version next time. The app waits for it (hold_quit). On
 * Windows the installer takes over and closes the app itself, without
 * opening it again.
 */
async function installOnQuit(): Promise<void> {
  trace(`quitting: state ${state.kind}, downloaded ${downloaded}, installed ${installed}`)
  if (state.kind !== 'ready' || !pending || !downloaded || installed) return
  const version = state.version
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('hold_quit', { ms: 120_000 }).catch(() => undefined)
    set({ kind: 'installing', version, progress: null })
    await pending.install({ restartAfterInstall: false })
    trace('installed')
  } catch (err) {
    trace(`install failed: ${(err as Error).message ?? err}`)
    // Not installable here (a Linux .deb): offered with the download page from now on.
    cannotInstallStore.set(version)
  }
}

/** Starts checking: soon after opening, then every few hours. Once per app run. */
let started = false
export function startUpdateChecks(): void {
  if (started || !canUpdate()) return
  started = true
  onQuitLast(installOnQuit)
  setTimeout(() => void checkForUpdate(), 8000)
  setInterval(() => void checkForUpdate(), EVERY_MS)
  // Turned on with one waiting: downloaded now. Turned off: one already downloaded stays ready.
  autoUpdateStore.subscribe(() => {
    if (autoUpdateStore.get() && state.kind === 'available') void checkForUpdate()
  })
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
