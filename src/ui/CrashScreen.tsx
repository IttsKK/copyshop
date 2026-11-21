import { crashReportsAllowed, telemetryOn } from '../platform/telemetry'

/**
 * What shows if the app itself fails: that it crashed, that the work is safe
 * (the edit is saved as it's made), and Restart, which comes back to it. The
 * crash is reported on its own (Sentry's error boundary, main.tsx) unless
 * crash reports are off in Settings.
 */
export function CrashScreen(_: { error: unknown; eventId?: string }) {
  const reported = telemetryOn() && crashReportsAllowed()
  return (
    <div className="crash-screen">
      <div className="crash-card">
        <h1>copyshop crashed</h1>
        <p>{reported ? 'Your work is saved, and a report was sent.' : 'Your work is saved.'}</p>
        <div className="crash-actions">
          <button className="primary" onClick={() => location.reload()}>
            Restart
          </button>
        </div>
      </div>
    </div>
  )
}
