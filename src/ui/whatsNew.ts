import { CATEGORY_BY_ID, MODULE_BY_ID, type StackModuleId } from './moduleCatalog'
import { persistedStore, useStore } from './state/store'

/**
 * What's new, version by version: the page a new version opens on its first
 * run (WhatsNewDialog), and the New tags on modules it added.
 *
 * One entry per release, newest first, written when the release is. Each
 * thing in it is either a module (`module`: its name, picture and where it
 * is come from the module list, and the page offers to show it) or another
 * change (`title`, with `where` it is found). `line` says what it does, in a
 * sentence; no more. Keep a release to the things a user would notice.
 */
export interface NewThing {
  /** A module added: named, pictured and placed from the module list. */
  module?: StackModuleId
  /** Anything else: its name. */
  title?: string
  /** What it does or what changed, in one plain sentence. */
  line: string
  /** Where to find it, when it isn't a module ("Settings › General"). */
  where?: string
  /** Something to get right here: precise selection's models (PreciseDownloadButton). */
  download?: 'precise'
}

export interface Release {
  version: string
  /** When it came out (YYYY-MM-DD). */
  date: string
  things: NewThing[]
}

export const RELEASES: Release[] = [
  {
    version: '1.4.1',
    date: '2026-11-23',
    things: [
      {
        title: 'Saved photos keep .jpg on Windows',
        line: 'A name typed in the Save box without an extension saved a file Windows didn’t know was a photo, so Instagram and other pickers left it out. The extension is now added.',
      },
    ],
  },
  {
    version: '1.4.0',
    date: '2026-11-23',
    things: [
      {
        title: 'Precise subject selection',
        line: 'An optional download of two larger models that select a building, a person or a car with a cleaner edge: the selection sharpens a moment after you click, and its edge a few seconds later.',
        where: 'Settings › Selection',
        download: 'precise',
      },
      { title: 'Box it to keep the rest out', line: 'Dragging a box round a subject keeps out what is joined to it, like a wing off a tower; a streak’s subject can be boxed too.' },
      {
        title: 'Submit to Gallery',
        line: 'Send a finished photo, credited to you, for the gallery on getcopyshop.com and copyshop’s Instagram. It is looked at first, and you get a link that takes it down.',
        where: 'File › Submit to Gallery…, or a photo’s menu in the Library',
      },
      { title: 'Streak colours from a line', line: 'A streak can take its colours from a line you draw across the photo, instead of from its edge.', where: 'Streaks › a streak’s Carries › Sample line' },
      { title: 'Streak masks like every module’s', line: 'A streak’s Mask tab has Where it applies, as every module does: its own masks and the Masks list’s, inside or outside them.' },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-11-23',
    things: [
      { module: 'recolour', line: 'Select parts of the photo and give each its own colour, keeping their light and shade, or keep a part as shot in a black and white photo.' },
      { module: 'kaleido', line: 'The photo, or a part of it, copied round a point: mirrored or turned, in rings toward the middle, and masked to where it shows.' },
      { title: 'Masks can key on a colour', line: 'Besides brightness and blue, a mask can keep what is like a colour you pick or take from the photo: a green tree, a red car.', where: 'Masks › a mask’s Follow photo › Compare' },
      { title: 'Move the photo while you work', line: 'Hold Space and drag to move the photo whatever tool is out. On a trackpad, two fingers move it and a pinch zooms.', where: 'Settings › General, for the trackpad' },
      { title: 'Updates install themselves', line: 'A new version downloads in the background and is ready the next time you open copyshop, with nothing to click. You can turn this off.', where: 'Settings › General' },
      { title: 'See the photo while you select', line: 'Selecting or drawing a part for a module (a streak’s subject, what Repeat or the Kaleidoscope copies, a part to recolour) hides that module, so you see the photo itself.' },
    ],
  },
]

/** This copy's version, without a test build's +test.… (the build defines it; tests don't). */
const appVersion = () => (typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0').split('+')[0]

/** a > b, by version numbers (1.10.0 after 1.9.0). */
export function newer(a: string, b: string): boolean {
  const pa = a.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.+-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** Where a module is, as the panel names it: its category's page, then its name ("Effects › Kaleidoscope"). */
export const whereIs = (id: StackModuleId) => `${CATEGORY_BY_ID[MODULE_BY_ID[id].category].label} › ${MODULE_BY_ID[id].title}`

/** The version this copy last ran: a newer one now means it has just been updated. */
const lastVersionStore = persistedStore<string | null>('app.lastVersion', null)
/** The version updated from, kept until What's new has been seen: the releases after it are what's new. */
export const updatedFromStore = persistedStore<string | null>('app.updatedFrom', null)
/** The modules a New tag has been seen on (opened), so the tag goes. */
const seenStore = persistedStore<string[]>('app.newSeen', [])
/** The version updated from, for the New tags: kept after What's new itself is seen, until the next update. */
const taggedFrom = persistedStore<string | null>('app.newFrom', null)

/**
 * Notes, once per run, whether this run is the first of a new version. A
 * first run of the app at all (nothing stored) is not: everything is new to
 * a new user, and nothing is tagged.
 */
let noted = false
export function noteVersion(): void {
  if (noted) return
  noted = true
  const last = lastVersionStore.get()
  const now = appVersion()
  if (last && newer(now, last)) {
    updatedFromStore.set(last)
    taggedFrom.set(last)
    seenStore.set([])
  }
  if (last !== now) lastVersionStore.set(now)
}

/** The releases since the version updated from, newest first (none if not updated). */
export function releasesSince(from: string | null): Release[] {
  const now = appVersion()
  return from ? RELEASES.filter((r) => newer(r.version, from) && !newer(r.version, now)) : []
}

/** What's new is waiting to be seen: updated, and the releases since have something to say. */
export const useWhatsNewWaiting = (): boolean => releasesSince(useStore(updatedFromStore)).length > 0

/** What's new seen (opened, or put away): its button goes; the New tags stay until each module is opened. */
export const whatsNewSeen = () => updatedFromStore.set(null)

/** Whether a module wears a New tag: added since the version updated from, and not opened since. */
export function useIsNew(id: StackModuleId): boolean {
  const from = useStore(taggedFrom)
  const seen = useStore(seenStore)
  if (!from || seen.includes(id)) return false
  return releasesSince(from).some((r) => r.things.some((t) => t.module === id))
}

/** A module opened: its New tag goes. */
export function seenModule(id: StackModuleId): void {
  if (!seenStore.get().includes(id)) seenStore.set((s) => [...s, id])
}
