import { OFFICIAL } from './build'
import { isNative } from './native'

/**
 * Usage counts: which parts of the app get used, so the useful ones can get
 * better and the unused ones can go. Sent to getcopyshop.com/__usage (the
 * site's worker, site/worker.js), read with site/scripts/usage.mjs.
 *
 * An event is a short name, with up to two built-in names (a module, a
 * preset that comes with the app, an export format) and a number. Never a
 * photo, a file or folder name, or anything typed: names someone gave things
 * themselves are sent as "own". The web app sends no id (the site's worker
 * makes a hash of the day, address and browser); the desktop app sends a
 * random id kept in its own storage, so the same app on another day counts
 * once.
 *
 * Settings → General → Send usage data switches it off. On in release builds;
 * in development only with VITE_USAGE_DEV=1, and localStorage "usage.debug"
 * = "1" prints each event to the console.
 */

const KEY = 'ui.usageCounts'
const ID_KEY = 'usage.id'
const SITE = 'https://getcopyshop.com'
const FLUSH_MS = 20_000
const MAX_PER_VISIT = 600

type Event = [name: string, a: string | null, b: string | null, n: number | null, at: number]

const queue: Event[] = []
const lastSeen = new Map<string, number>()
const once = new Set<string>()
const session = Math.random().toString(36).slice(2, 12)
let sent = 0
let timer: number | null = null
let started = false

// Never from a test build (npm run app:test, 1.2.0+test.<sha>): its use is ours, not people's.
// Nor from a build from the source (platform/build.ts).
const on = (): boolean => (import.meta.env.PROD || import.meta.env.VITE_USAGE_DEV === '1') && !__APP_VERSION__.includes('+test') && OFFICIAL

/** Whether usage counts are sent (Settings → General). */
export function usageAllowed(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

export function allowUsage(allow: boolean): void {
  try {
    localStorage.setItem(KEY, allow ? 'on' : 'off')
  } catch {
    /* private window: for this visit only */
  }
  if (!allow) queue.length = 0
}

function debug(): boolean {
  try {
    return localStorage.getItem('usage.debug') === '1'
  } catch {
    return false
  }
}

function desktopId(): string | null {
  try {
    let id = localStorage.getItem(ID_KEY)
    if (!id || !/^[a-z0-9]{8,32}$/.test(id)) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => (b % 36).toString(36)).join('')
      localStorage.setItem(ID_KEY, id)
    }
    return id
  } catch {
    return null
  }
}

function endpoint(): string | null {
  if (isNative()) return `${SITE}/__usage`
  if (location.hostname === 'getcopyshop.com') return '/__usage'
  return import.meta.env.VITE_USAGE_URL ?? null
}

/** A built-in name as sent: trimmed and short. */
const word = (v: string | null | undefined): string | null => (v == null || v === '' ? null : String(v).slice(0, 64))

/**
 * Something was used. `a` and `b` must be built-in names (module ids, the
 * names of presets that come with the app, formats), never a name someone
 * typed or a file's. The same event twice within a second counts once.
 */
export function track(name: string, a?: string | null, b?: string | null, n?: number | null): void {
  if (!on() || !usageAllowed() || sent + queue.length >= MAX_PER_VISIT) return
  const key = `${name}|${a ?? ''}|${b ?? ''}`
  const now = Date.now()
  if (now - (lastSeen.get(key) ?? -Infinity) < 1000) return
  lastSeen.set(key, now)
  const event: Event = [name, word(a), word(b), typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 1000) / 1000 : null, now]
  if (debug()) console.debug('[usage]', name, event[1] ?? '', event[2] ?? '', event[3] ?? '')
  queue.push(event)
  schedule()
}

/** As track, at most once a visit for the same name and `a`: whether something was used at all. */
export function trackOnce(name: string, a?: string | null, b?: string | null): void {
  const key = `${name}|${a ?? ''}`
  if (once.has(key)) return
  once.add(key)
  track(name, a, b)
}

function schedule(): void {
  if (timer == null) timer = window.setTimeout(flush, FLUSH_MS)
}

function flush(): void {
  if (timer != null) window.clearTimeout(timer)
  timer = null
  const url = endpoint()
  if (!queue.length || !url) return
  const now = Date.now()
  const events = queue.splice(0, 60).map(([name, a, b, n, at]) => [name, a, b, n, now - at])
  sent += events.length
  const body = JSON.stringify({
    s: isNative() ? 'desktop' : 'web',
    v: __APP_VERSION__,
    id: isNative() ? desktopId() : undefined,
    sid: session,
    e: events,
  })
  try {
    // A beacon survives the page closing; the desktop app's page is never "closed" that way, so fetch there.
    if (isNative() || !navigator.sendBeacon?.(url, body)) void fetch(url, { method: 'POST', body, keepalive: true }).catch(() => undefined)
  } catch {
    /* counts are best effort */
  }
  if (queue.length) schedule()
}

/** Once at start: the visit, then sending when the page is hidden or closed. */
export function startUsage(): void {
  if (started) return
  started = true
  track('app_open', isNative() ? 'desktop' : 'web', screenClass())
  addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

/** The window's size, roughly: whether the layout has room. */
function screenClass(): string {
  const w = window.innerWidth
  return w < 1100 ? 'small' : w < 1600 ? 'medium' : 'large'
}
