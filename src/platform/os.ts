/**
 * Whether this is a Mac (the app, or a browser on one): shortcuts read ⌘⇧⌥
 * there and Ctrl+Shift+Alt elsewhere. Read once; it never changes.
 */
let mac: boolean | null = null

export function isMac(): boolean {
  if (mac === null) {
    const nav = typeof navigator === 'undefined' ? null : navigator
    const platform =
      (nav as (Navigator & { userAgentData?: { platform?: string } }) | null)?.userAgentData?.platform ||
      nav?.platform ||
      nav?.userAgent ||
      ''
    mac = /mac|iphone|ipad|ipod/i.test(platform)
  }
  return mac
}

/** The system's file browser by name: the Finder on a Mac, File Explorer on Windows, else plainly a folder. */
export function showInFilesLabel(): string {
  if (isMac()) return 'Show in Finder'
  const nav = typeof navigator === 'undefined' ? null : navigator
  return /win/i.test(nav?.platform || nav?.userAgent || '') ? 'Show in File Explorer' : 'Show in folder'
}

/**
 * Text naming Mac keys ("Cmd+Z", "Option-click") as this computer's: Ctrl
 * and Alt off a Mac. A Mac-only tool named in brackets (the screen recorder)
 * is left out there.
 */
export function keyWords(text: string): string {
  if (isMac()) return text
  return text
    .replace(/ \(Cmd\+Shift\+5\)/g, '')
    .replace(/\bCmd\+/g, 'Ctrl+')
    .replace(/\bOption([-+])/g, 'Alt$1')
}
