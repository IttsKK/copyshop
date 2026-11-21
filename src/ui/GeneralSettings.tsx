import { showInFilesLabel } from '../platform/os'
import { openUrl } from '../platform/native'
import { useEffect, useState } from 'react'
import { revealInFinder } from '../platform/native'
import { allowCrashReports, crashReportsAllowed } from '../platform/telemetry'
import { allowUsage, usageAllowed } from '../platform/usage'
import { APP_VERSION, canUpdate, checkForUpdate, installUpdate, useUpdate } from '../platform/updates'
import { diskFolder } from '../storage/disk'
import { libraryAvailable, loadRecent, onRecent, removeRecent } from '../storage/library'
import { LISTED_LOOKS, NONE_LOOK } from './looks'
import { DesktopAppSettings } from './DesktopAppSettings'
import { launchStore, reduceMotionStore, startLookStore, useLaunch, useReduceMotion, useStartLook } from './state/settings'
import { OFFICIAL } from '../platform/build'

interface Props {
  onIntro: () => void
  onReport: () => void
  onTour: () => void
  onStatus: (message: string) => void
}

/**
 * The general settings: what the app opens on and what a new photo starts
 * with, motion, and the library's housekeeping. The library's are the Mac
 * app's only; a browser keeps too little between visits for them.
 */
export function GeneralSettings({ onIntro, onReport, onTour, onStatus }: Props) {
  const [crashReports, setCrashReports] = useState(crashReportsAllowed)
  const [usage, setUsage] = useState(usageAllowed)
  const update = useUpdate()
  const app = libraryAvailable()
  const launch = useLaunch()
  const startLook = useStartLook()
  const reduceMotion = useReduceMotion()
  const [recent, setRecent] = useState(0)
  useEffect(() => {
    if (!app) return
    void loadRecent().then((list) => setRecent(list.length))
    return onRecent((list) => setRecent(list.length))
  }, [app])

  return (
    <>
      <section className="settings-section">
        <div className="settings-head">
          <h3>General</h3>
        </div>
        {app && (
          <div className="settings-row">
            <span>When copyshop opens</span>
            <div className="segmented">
              <button className={launch === 'photo' ? 'on' : ''} onClick={() => launchStore.set('photo')}>
                Last photo
              </button>
              <button className={launch === 'library' ? 'on' : ''} onClick={() => launchStore.set('library')}>
                Library
              </button>
            </div>
          </div>
        )}
        <label className="settings-row">
          <span>New photos start with</span>
          <select value={startLook} onChange={(e) => startLookStore.set(e.target.value)}>
            {[NONE_LOOK, ...LISTED_LOOKS].map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <label className="check-row">
          <input type="checkbox" checked={reduceMotion} onChange={(e) => reduceMotionStore.set(e.target.checked)} />
          Reduce motion
        </label>
      </section>
      {app && (
        <section className="settings-section">
          <div className="settings-head">
            <h3>Library</h3>
          </div>
          <div className="settings-row">
            <span>
              Recent <small className="muted">{recent ? `${recent} photo${recent === 1 ? '' : 's'}` : 'empty'}</small>
            </span>
            <button
              disabled={!recent}
              title="Empty the Recent list. The photos and their edits stay."
              onClick={async () => {
                for (const p of await loadRecent()) await removeRecent(p.path)
                onStatus('Recent is empty. The photos and their edits are still there.')
              }}
            >
              Clear
            </button>
          </div>
          <div className="settings-row">
            <span>Edits, recipes and thumbnails</span>
            <button
              disabled={!diskFolder()}
              title="Open the folder copyshop keeps its data in"
              onClick={() => {
                const dir = diskFolder()
                if (dir) void revealInFinder(dir)
              }}
            >
              {showInFilesLabel()}
            </button>
          </div>
        </section>
      )}
      <DesktopAppSettings onStatus={onStatus} />
      <section className="settings-section">
        <div className="settings-head">
          <h3>Help</h3>
        </div>
        <div className="settings-row">
          <span>How copyshop works</span>
          <span className="row">
            <button onClick={onIntro}>Show</button>
            <button onClick={onTour}>Show me around</button>
          </span>
        </div>
        {canUpdate() && (
          <div className="settings-row">
            <span>
              copyshop {APP_VERSION}
              <small className="settings-row-note">
                {update.kind === 'checking'
                  ? ' · checking…'
                  : update.kind === 'none'
                    ? ' · up to date'
                    : update.kind === 'available'
                      ? ` · ${update.version} is out`
                      : update.kind === 'installing'
                        ? ' · updating…'
                        : update.kind === 'failed'
                          ? ` · ${update.message}`
                          : ''}
              </small>
            </span>
            {update.kind === 'available' ? (
              <button className="primary" onClick={() => void installUpdate()}>
                Update and restart
              </button>
            ) : (
              <button disabled={update.kind === 'checking' || update.kind === 'installing'} onClick={() => void checkForUpdate(true)}>
                Check for updates
              </button>
            )}
          </div>
        )}
        <div className="settings-row">
          <span>Something not working, or an idea?</span>
          <button onClick={onReport}>Report a problem…</button>
        </div>
        {/* A build from the source sends nothing, so it has nothing to switch (platform/build.ts). */}
        {OFFICIAL ? (
          <>
            <label
              className="check-row"
              title="When the app hits an error, what went wrong and where in the app's code is sent so it can be fixed. Never your photos, file names or folders."
            >
              <input
                type="checkbox"
                checked={crashReports}
                onChange={(e) => {
                  allowCrashReports(e.target.checked)
                  setCrashReports(e.target.checked)
                }}
              />
              Send crash reports (never your photos or file names)
            </label>
            <label
              className="check-row"
              title="Which tools and presets get used, so the useful parts can get better. Never your photos, file names, folders or anything you type."
            >
              <input
                type="checkbox"
                checked={usage}
                onChange={(e) => {
                  allowUsage(e.target.checked)
                  setUsage(e.target.checked)
                }}
              />
              Send usage data (never your photos or file names)
            </label>
            <p className="settings-note">
              What copyshop sends, and where:{' '}
              <button className="link" onClick={() => void openUrl('https://getcopyshop.com/privacy')}>
                Privacy
              </button>
            </p>
          </>
        ) : (
          <p className="settings-note">Built from source: it sends nothing and doesn't check for updates.</p>
        )}
      </section>
    </>
  )
}
