import { LIBRARY_STORE, get, put } from './db'
import { sha256 } from './recipe'

/**
 * Which photos have been exported, and when: by the original's SHA-256 (what
 * its edit is kept under) the time of its last export, and by each exported
 * file's SHA-256 the original it was made from. With these the library
 * tells an edit that is out in its file from one changed since, whether it
 * shows the original or the export that replaced it in its folder.
 */
interface Exports {
  /** Original SHA-256 → when it was last exported, ms. */
  at: Map<string, number>
  /** Exported file's SHA-256 → the original's. */
  finals: Map<string, string>
}

let cache: Promise<Exports> | null = null
const watchers = new Set<() => void>()

export function loadExports(): Promise<Exports> {
  cache ??= get<{ at?: Record<string, number>; finals?: Record<string, string> }>(LIBRARY_STORE, 'exports').then((r) => ({
    at: new Map(Object.entries(r?.at ?? {})),
    finals: new Map(Object.entries(r?.finals ?? {})),
  }))
  return cache
}

/** An export written: `final` is the file as written, made from the original `originalSha`. */
export async function recordExport(originalSha: string, final: Blob): Promise<void> {
  const e = await loadExports()
  e.at.set(originalSha, Date.now())
  e.finals.set(await sha256(final), originalSha)
  await put(LIBRARY_STORE, { id: 'exports', at: Object.fromEntries(e.at), finals: Object.fromEntries(e.finals) })
  for (const w of watchers) w()
}

/**
 * An export opened and its original found: the export's file is known to be
 * that original's, exported when the file was last written (`at`, ms) unless
 * a later export is already recorded.
 */
export async function rememberFinal(final: Blob, originalSha: string, at: number): Promise<void> {
  const e = await loadExports()
  const sha = await sha256(final)
  if (e.finals.get(sha) === originalSha && e.at.has(originalSha)) return
  e.finals.set(sha, originalSha)
  if (!e.at.has(originalSha) || e.at.get(originalSha)! < at) e.at.set(originalSha, at)
  await put(LIBRARY_STORE, { id: 'exports', at: Object.fromEntries(e.at), finals: Object.fromEntries(e.finals) })
  for (const w of watchers) w()
}

/** Called whenever an export is recorded. */
/**
 * The original an exported file was made from, through every export in
 * between: an export drawn over an older export (before 1.0.8) is recorded
 * as made from that one, which is recorded as made from the original.
 * Not an export: itself.
 */
export function originalOf(finals: Map<string, string>, sha: string): string {
  let at = sha
  for (let k = 0; k < 8 && finals.has(at); k++) at = finals.get(at)!
  return at
}

export function onExports(watch: () => void): () => void {
  watchers.add(watch)
  return () => watchers.delete(watch)
}

/** Where a photo with an edit stands against its exported file. */
export type ExportState = 'unexported' | 'changed' | 'exported'

/** An edit saved at `editedAt` against an export at `exportedAt` (a second's slack: the export saves the edit first). */
export function exportState(editedAt: number, exportedAt: number | undefined): ExportState {
  if (exportedAt === undefined) return 'unexported'
  return editedAt > exportedAt + 1000 ? 'changed' : 'exported'
}
