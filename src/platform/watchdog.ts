import * as Sentry from '@sentry/react'

/**
 * What a page's own error handlers can't see, reported through Sentry:
 *
 * - Freezes: the page's thread busy for over a second and a half (no clicks,
 *   no drawing). Reported with what was running, where the browser says
 *   (Chrome's long-animation-frame entries), at most one every half minute.
 *
 * - Crashes: when a tab or the whole browser dies (out of memory, a GPU
 *   driver reset, killed while frozen) no code runs to say so. Each open page
 *   keeps a note of itself in localStorage, renewed every few seconds with its
 *   last breadcrumbs, and removes it when it closes properly (pagehide). A
 *   note left behind is a page that never closed: the next page to open
 *   reports it, with those breadcrumbs. One that was in the background when
 *   it went is left out: the browser discards and closes those on its own.
 *   The desktop app's window never gets pagehide (the app just quits), so
 *   there the app notes when it last quit properly (last_clean_exit in
 *   src-tauri): a page that stopped well before that quit, or with no quit
 *   after it, died.
 *
 * Nothing here is sent unless crash reports are on (beforeSend in telemetry.ts).
 */

const PREFIX = 'copyshop.open.'
const BEAT_MS = 3000
/** A note not renewed for this long belongs to a page that is gone. */
const STALE_MS = 15_000
const CRUMBS = 40
/** A freeze this long is a breadcrumb; this long, a report. */
const NOTE_MS = 700
const REPORT_MS = 1500
const TICK_MS = 250

interface Crumb {
  t: number
  c?: string
  m?: string
  l?: string
  d?: Record<string, string | number | boolean>
}

interface OpenNote {
  release: string
  started: number
  beat: number
  visible: boolean
  heapMB?: number
  crumbs: Crumb[]
}

const crumbs: Crumb[] = []
let replaying = false
let save: (() => void) | null = null

/** Only small, plain values: a breadcrumb's data can be anything. */
function smallData(data: Record<string, unknown> | undefined): Crumb['d'] {
  if (!data) return undefined
  const out: NonNullable<Crumb['d']> = {}
  for (const [k, v] of Object.entries(data).slice(0, 8)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = v.slice(0, 200)
  }
  return out
}

/** Every breadcrumb (already scrubbed, telemetry.ts) is kept for a crash's report. */
export function noteCrumb(b: Sentry.Breadcrumb): void {
  if (replaying) return
  crumbs.push({ t: b.timestamp ?? Date.now() / 1000, c: b.category, m: b.message?.slice(0, 300), l: b.level, d: smallData(b.data) })
  if (crumbs.length > CRUMBS) crumbs.shift()
  save?.()
}

function heapMB(): number | undefined {
  const m = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
  return m ? Math.round(m.usedJSHeapSize / 1048576) : undefined
}

/** The machine, for every report: how much memory and how many cores. */
function machine(): Record<string, number | undefined> {
  const nav = navigator as Navigator & { deviceMemory?: number }
  const m = (performance as Performance & { memory?: { jsHeapSizeLimit: number } }).memory
  return { deviceMemoryGB: nav.deviceMemory, cores: nav.hardwareConcurrency, heapMB: heapMB(), heapLimitMB: m ? Math.round(m.jsHeapSizeLimit / 1048576) : undefined }
}

interface LongFrame {
  start: number
  end: number
  blocking: number
  scripts: { invoker: string; fn: string; source: string; ms: number }[]
}

function watchFreezes(scrub: (s: string) => string): void {
  const frames: LongFrame[] = []
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries() as (PerformanceEntry & { blockingDuration?: number; scripts?: Record<string, unknown>[] })[]) {
        if (e.duration < NOTE_MS) continue
        frames.push({
          start: e.startTime,
          end: e.startTime + e.duration,
          blocking: Math.round(e.blockingDuration ?? 0),
          scripts: (e.scripts ?? [])
            .map((s) => ({
              invoker: String(s.invoker ?? ''),
              fn: String(s.sourceFunctionName ?? ''),
              source: scrub(String(s.sourceURL ?? '').replace(/[?#].*$/, '')) + (s.sourceCharPosition != null ? `:${s.sourceCharPosition}` : ''),
              ms: Math.round(Number(s.duration ?? 0)),
            }))
            .sort((a, b) => b.ms - a.ms)
            .slice(0, 5),
        })
        if (frames.length > 10) frames.shift()
      }
    }).observe({ type: 'long-animation-frame', buffered: false })
  } catch {
    /* Not in this browser (Safari): the freeze is still reported, without what caused it. */
  }

  let last = performance.now()
  let skip = false
  let reported = 0
  let lastReport = -Infinity
  document.addEventListener('visibilitychange', () => {
    // A hidden page's timers are slowed on purpose: not a freeze.
    skip = true
    last = performance.now()
  })
  setInterval(() => {
    const now = performance.now()
    const gap = now - last - TICK_MS
    const from = last
    last = now
    if (skip || document.visibilityState !== 'visible') {
      skip = false
      return
    }
    // Minutes: the computer slept, not the page.
    if (gap < NOTE_MS || gap > 120_000) return
    const seconds = Math.round(gap / 100) / 10
    Sentry.addBreadcrumb({ category: 'freeze', level: 'warning', message: `The page froze for ${seconds} s` })
    if (gap < REPORT_MS || reported >= 10 || now - lastReport < 30_000) return
    reported++
    lastReport = now
    // Chrome hands the long frame over a moment later.
    setTimeout(() => {
      const frame = frames.filter((f) => f.end >= from && f.start <= now).sort((a, b) => b.end - b.start - (a.end - a.start))[0]
      const top = frame?.scripts[0]
      Sentry.withScope((scope) => {
        scope.setLevel(gap >= 5000 ? 'error' : 'warning')
        scope.setTag('freeze', gap >= 10_000 ? '10s+' : gap >= 5000 ? '5-10s' : gap >= 3000 ? '3-5s' : '1.5-3s')
        scope.setFingerprint(['ui-freeze', top ? `${top.invoker} ${top.fn}`.trim() || top.source : 'unknown'])
        scope.setExtras({ seconds, frame: frame ?? null, ...machine() })
        Sentry.captureMessage(`The page froze for ${seconds} s${top ? ` (${top.fn || top.invoker || 'script'})` : ''}`)
      })
    }, 300)
  }, TICK_MS)
}

function report(note: OpenNote): void {
  const last = note.crumbs[note.crumbs.length - 1]
  replaying = true
  try {
    Sentry.withScope((scope) => {
      scope.clearBreadcrumbs()
      for (const c of note.crumbs) scope.addBreadcrumb({ timestamp: c.t, category: c.c, message: c.m, level: c.l as Sentry.SeverityLevel | undefined, data: c.d }, CRUMBS)
      scope.setLevel('fatal')
      scope.setTag('crash', 'page-did-not-close')
      // Grouped by what was going on last.
      scope.setFingerprint(['page-did-not-close', last?.c ?? 'none', (last?.m ?? '').replace(/\d+(\.\d+)?/g, '#').slice(0, 80)])
      scope.setExtras({
        openForSeconds: Math.round((note.beat - note.started) / 1000),
        lastSeen: new Date(note.beat).toISOString(),
        heapMBThen: note.heapMB,
        releaseThen: note.release,
      })
      Sentry.captureEvent({
        message: 'The page stopped without closing: the tab or the browser crashed, or it was ended while frozen',
        level: 'fatal',
        release: note.release,
      })
    })
  } finally {
    replaying = false
  }
}

/**
 * When the desktop app last quit properly (ms), or null on the web. A page
 * still alive within this long of a quit went with it.
 */
type CleanExit = () => Promise<number | null>
const QUIT_MS = BEAT_MS * 3

/** Notes left by pages that never closed properly: reported, then removed. */
async function checkLeftBehind(own: string, cleanExit: CleanExit | null): Promise<void> {
  const quit = cleanExit ? await cleanExit().catch(() => null) : null
  let keys: string[] = []
  try {
    keys = Object.keys(localStorage).filter((k) => k.startsWith(PREFIX) && k !== own)
  } catch {
    return
  }
  for (const key of keys) {
    try {
      const note = JSON.parse(localStorage.getItem(key) ?? 'null') as OpenNote | null
      if (note && Date.now() - note.beat < STALE_MS) continue
      localStorage.removeItem(key)
      // The desktop app quit with this page open: a quit, not a crash.
      if (quit !== null && note && quit >= note.beat && quit - note.beat < QUIT_MS) continue
      if (note?.visible) report(note)
    } catch {
      try {
        localStorage.removeItem(key)
      } catch {
        /* storage off */
      }
    }
  }
}

function watchCrashes(release: string, cleanExit: CleanExit | null): void {
  const id = PREFIX + (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`)
  const note: OpenNote = { release, started: Date.now(), beat: Date.now(), visible: document.visibilityState === 'visible', crumbs }
  let closed = false
  save = () => {
    if (closed) return
    note.beat = Date.now()
    note.visible = document.visibilityState === 'visible'
    note.heapMB = heapMB()
    try {
      localStorage.setItem(id, JSON.stringify(note))
    } catch {
      /* storage full or off: no crash reports from this page */
    }
  }
  save()
  setInterval(() => save?.(), BEAT_MS)
  document.addEventListener('visibilitychange', () => save?.())
  addEventListener('pagehide', () => {
    closed = true
    try {
      localStorage.removeItem(id)
    } catch {
      /* storage off */
    }
  })
  addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (!e.persisted) return
    closed = false
    save?.()
  })
  // Now, and again once a page that crashed just before this one opened has gone quiet long enough to count.
  void checkLeftBehind(id, cleanExit)
  setTimeout(() => void checkLeftBehind(id, cleanExit), STALE_MS + BEAT_MS)
}

export function startWatchdog(opts: { release: string; scrub: (s: string) => string; cleanExit: CleanExit | null }): void {
  if (typeof document === 'undefined') return
  watchFreezes(opts.scrub)
  watchCrashes(opts.release, opts.cleanExit)
}
