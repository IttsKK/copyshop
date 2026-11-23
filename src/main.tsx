import { startTelemetry, Sentry } from './platform/telemetry'
import { startUsage } from './platform/usage'
import { startUpdateChecks } from './platform/updates'
import { noteVersion } from './ui/whatsNew'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { CrashScreen } from './ui/CrashScreen'
import { initStorage } from './storage/db'
import { isNative } from './platform/native'
import './ui/styles.css'

// Crash reports first, so an error while starting up is caught too (release builds only).
startTelemetry()
// Usage counts: which parts of the app get used (platform/usage.ts).
startUsage()
// The desktop app looks for a newer version a little after it opens, and every few hours.
startUpdateChecks()
// The first run of a newer version: What's new waits in the top bar, and its new modules are tagged.
noteVersion()

// The desktop app's self-check (src/platform/smoke.ts): only when launched
// with GRAIN_EMULATOR_SMOKE set; it writes a report and quits.
if (isNative()) {
  import('@tauri-apps/api/core').then(async ({ invoke }) => {
    const dir = await invoke<string | null>('smoke_dir')
    if (!dir) return
    const { runSmoke } = await import('./platform/smoke')
    await runSmoke(dir).catch(() => undefined)
    await invoke('quit_app')
  })
}

// The web app after a deploy: a part loaded later (a dialog, a tool) may be
// gone from the server if this page is older than two deploys. Loading the
// page again gets the new build; once, so a real failure still shows.
if (!isNative())
  window.addEventListener('vite:preloadError', (event) => {
    const KEY = 'copyshop-reloaded-at'
    try {
      if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < 60_000) return
      sessionStorage.setItem(KEY, String(Date.now()))
    } catch {
      return
    }
    event.preventDefault()
    window.location.reload()
  })

// Storage is decided before the first render: the app reads its session
// synchronously, and on disk it first has to be fetched into place.
initStorage()
  .catch(() => undefined)
  .then(() =>
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <Sentry.ErrorBoundary fallback={({ error, eventId }) => <CrashScreen error={error} eventId={eventId} />}>
          <App />
        </Sentry.ErrorBoundary>
      </React.StrictMode>,
    ),
  )
