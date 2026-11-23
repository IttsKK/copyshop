import { type RefObject } from 'react'
import type { Size } from '../engine/types'
import { photoAccept } from '../pipeline/formats'
import { libraryAvailable } from '../storage/library'
import { HelpIcon, PanelBottomIcon, PanelLeftIcon, PanelRightIcon, SettingsIcon } from './icons'
import { setLeftOpen, setLibraryShown, setRightOpen, setStripOpen, useLeftOpen, useLibraryShown, useRightOpen, useStripOpen } from './state/layout'
import { PANEL_KEYS, keyLabel } from './shortcuts'
import { installUpdate, useUpdate } from '../platform/updates'
import { useWhatsNewWaiting } from './whatsNew'

interface Props {
  /** The open photo, named with its size; null before one is open. */
  image: { name: string; size: Size } | null
  /** Opened from this export of it: its name, shown beside the original's. */
  fromExport?: string | null
  /** The desktop app: there is a library to switch to. */
  hasLibrary: boolean
  onAddFolder: () => void
  /** Open photos: the system's dialog in the app, the file input in a browser. */
  onOpenPhotos: () => void
  /** Served by the launcher, which can be quit from here. */
  launcher: boolean
  onQuit: () => void
  onSettings: () => void
  onHelp: () => void
  /** The file input Open clicks, also clicked by Cmd/Ctrl+O and the empty preview. */
  imageInput: RefObject<HTMLInputElement>
  onOpen: (file: File) => void
  /** What's new, from the top bar's button after an update. */
  onWhatsNew: () => void
}

/** The bar over everything: the panels, the open photo, Open, Settings and help. */
export function TopBar({ image, fromExport, hasLibrary, onAddFolder, onOpenPhotos, launcher, onQuit, onSettings, onHelp, imageInput, onOpen, onWhatsNew }: Props) {
  const whatsNew = useWhatsNewWaiting()
  const leftOpen = useLeftOpen()
  const rightOpen = useRightOpen()
  const stripOpen = useStripOpen()
  const inLibrary = useLibraryShown() && hasLibrary
  const update = useUpdate()
  const megapixels = image ? ((image.size.width * image.size.height) / 1e6).toFixed(1) : null

  return (
    <header className="topbar">
      <button
        className="icon-btn"
        title={inLibrary ? `Folders (${keyLabel(PANEL_KEYS.left)})` : `Left panel (${keyLabel(PANEL_KEYS.left)})`}
        aria-pressed={leftOpen}
        onClick={() => setLeftOpen(!leftOpen)}
      >
        <PanelLeftIcon />
      </button>
      <span className="rule" />
      <h1>copyshop</h1>
      <span className="rule" />
      <div className="topbar-file">
        {/* The open photo belongs to Edit; the Library has its own heading. */}
        {inLibrary ? null : image ? (
          <>
            <span className="filename">{image.name}</span>
            {fromExport && (
              <span
                className="meta"
                title={`You opened ${fromExport}, an export of this photo. Its edit is on the original, ${image.name}: export again to update ${fromExport}.`}
              >
                from {fromExport}
              </span>
            )}
            <span className="meta">
              {image.size.width}×{image.size.height} · {megapixels} MP
            </span>
          </>
        ) : (
          <span className="meta">No photo open</span>
        )}
      </div>
      <div className="topbar-actions">
        {/* Just updated: what's new in it, until looked at. */}
        {whatsNew && (
          <button className="update-button whats-new-button" title="What this version adds, and where to find it" onClick={onWhatsNew}>
            What’s new
          </button>
        )}
        {/* A newer version: with Update automatically off, offered here and installed on a click; downloaded, it
            installs as the app quits, and Restart to update installs it now. */}
        {(update.kind === 'available' || update.kind === 'ready' || update.kind === 'installing') && (
          <button
            className={update.kind === 'available' ? 'primary update-button' : 'update-button'}
            disabled={update.kind === 'installing'}
            title={
              update.kind === 'available'
                ? `Download copyshop ${update.version}, install it and restart. Your edits are kept.`
                : update.kind === 'ready'
                  ? `copyshop ${update.version} is downloaded and installs when you quit. Restart now to use it. Your edits are kept.`
                  : undefined
            }
            onClick={() => void installUpdate()}
          >
            {update.kind === 'installing'
              ? update.progress === null
                ? 'Updating…'
                : `Updating… ${Math.round(update.progress * 100)}%`
              : update.kind === 'ready'
                ? 'Restart to update'
                : `Update to ${update.version}`}
          </button>
        )}
        {hasLibrary && (
          <div className="segmented view-switch">
            <button className={inLibrary ? 'on' : ''} title="Your photos: recent ones and your folders (G)" onClick={() => setLibraryShown(true)}>
              Library
            </button>
            <button className={inLibrary ? '' : 'on'} title="The open photo (D)" onClick={() => setLibraryShown(false)}>
              Edit
            </button>
          </div>
        )}
        <button
          title={
            hasLibrary
              ? `Open photos. They are kept in Recent in the library. (${keyLabel('cmd+o')})`
              : `Open a photo (${keyLabel('cmd+o')})`
          }
          onClick={onOpenPhotos}
        >
          Open
        </button>
        {libraryAvailable() && (
          <button title={`Add a folder of photos to the library. The photos stay where they are. (${keyLabel('cmd+shift+o')})`} onClick={onAddFolder}>
            Add folder
          </button>
        )}
        <span className="rule" />
        {launcher && (
          <button
            title="Stop the app's background server. It also stops by itself 10 minutes after the last window closes."
            onClick={onQuit}
          >
            Quit
          </button>
        )}
        <button className="icon-btn" title={`Settings (${keyLabel('cmd+,')})`} onClick={onSettings}>
          <SettingsIcon />
        </button>
        <button className="icon-btn" title="Help: keyboard shortcuts, how it works, report a problem (?)" onClick={onHelp}>
          <HelpIcon />
        </button>
        {/* The filmstrip and the right panel belong to the editor: not offered over the Library. */}
        {hasLibrary && !inLibrary && (
          <button className="icon-btn" title={`Filmstrip (${keyLabel(PANEL_KEYS.strip)})`} aria-pressed={stripOpen} onClick={() => setStripOpen(!stripOpen)}>
            <PanelBottomIcon />
          </button>
        )}
        {!inLibrary && (
        <button
          className="icon-btn"
          title={`Right panel (${keyLabel(PANEL_KEYS.right)})`}
          aria-pressed={rightOpen}
          onClick={() => setRightOpen(!rightOpen)}
        >
          <PanelRightIcon />
        </button>
        )}
        <input
          ref={imageInput}
          type="file"
          accept={photoAccept()}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onOpen(f)
            e.target.value = ''
          }}
        />
      </div>
    </header>
  )
}
