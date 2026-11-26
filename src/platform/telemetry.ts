import { OFFICIAL } from './build'
import * as Sentry from '@sentry/react'
import { isNative } from './native'
import { noteCrumb, startWatchdog } from './watchdog'

/**
 * Crash reports and "Report a problem", both through Sentry (project
 * "copyshop"). On in release builds only; in development, only with
 * VITE_SENTRY_DEV=1 (to try it).
 *
 * Nothing personal leaves the app: no photos (no session replay, no
 * screenshots), no file names or folder paths (scrubbed from every message,
 * stack frame and breadcrumb), no link fragments (the pairing link carries a
 * key there), no IP address or user. A report someone writes is sent as they
 * wrote it, with an email only if they gave one.
 *
 * Settings → General can turn crash reports off; a report written by hand is
 * still sent, since sending it is the point.
 */

const DSN = 'https://0d107c178604353911e2090a0e685c47@o4512292711038976.ingest.us.sentry.io/4512437696069632'

const CRASH_KEY = 'ui.crashReports'

export const telemetryOn = (): boolean => import.meta.env.PROD || import.meta.env.VITE_SENTRY_DEV === '1'

/** Whether crash reports go out automatically (Settings → General). */
export function crashReportsAllowed(): boolean {
  try {
    return localStorage.getItem(CRASH_KEY) !== 'off'
  } catch {
    return true
  }
}

export function allowCrashReports(on: boolean): void {
  try {
    localStorage.setItem(CRASH_KEY, on ? 'on' : 'off')
  } catch {
    /* private window: on for this visit only */
  }
}

/** Photo and other file names, and folder paths, as "‹file›" and "‹path›". */
const PATH = /(?:[A-Za-z]:\\|\/(?:Users|home|Volumes|private|var|tmp|mnt|media)\/)[^\s'"`)<>]*/g
const FILE = /[^\s/\\'"`()<>:]+\.(?:jpe?g|png|tiff?|heic|heif|webp|avif|gif|bmp|orf|cr2|cr3|nef|arw|raf|rw2|dng|pef|srw|x3f|copyshop|json)\b/gi

export function scrub(text: string): string {
  return text.replace(PATH, '‹path›').replace(FILE, '‹file›')
}

/** A URL without its #fragment or query, which can hold keys (the pairing link) or names. */
function scrubUrl(url: string): string {
  return url.replace(/[?#].*$/, '')
}

let started = false

/** `tunnel`: a path on this site that passes reports on to Sentry (the web editor's, so blockers of sentry.io don't drop them). */
export function startTelemetry(opts: { tunnel?: string } = {}): void {
  // A build from the source sends nothing (platform/build.ts).
  if (started || !telemetryOn() || (import.meta.env.PROD && !OFFICIAL)) return
  started = true
  Sentry.init({
    dsn: DSN,
    ...(opts.tunnel ? { tunnel: opts.tunnel } : {}),
    release: `copyshop@${__APP_VERSION__}`,
    // Test builds (npm run app:test, 1.2.0+test.<sha>) apart from what people run, so their issues don't read as real ones.
    environment: !import.meta.env.PROD ? 'development' : __APP_VERSION__.includes('+test') ? 'test' : 'production',
    // Nothing about the person or their requests: no user, headers, cookies, query strings or bodies.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    // Errors, and a tenth of page loads for how long opening takes: no request
    // spans (their URLs can name photos), no replay.
    integrations: [Sentry.browserTracingIntegration({ traceFetch: false, traceXHR: false })],
    // Whole transactions, so beforeSendTransaction can scrub and drop them.
    traceLifecycle: 'static',
    tracesSampleRate: 0.1,
    // No tracing headers on requests: the app's own server and Polar don't accept them.
    tracePropagationTargets: [],
    // A message is its own title. With a stack attached, Sentry titles it by
    // the function that sent it (reportIssue's minified name: "n2", "withScope").
    attachStacktrace: false,
    // Thrown by browser extensions and in-app browsers into every page, not by copyshop.
    ignoreErrors: [/window\.ethereum/, /__firefox__/, /Java object is gone/, /^Script error\.?$/],
    initialScope: { tags: { app: isNative() ? 'desktop' : 'browser' } },
    beforeSend(event) {
      // Automatic reports only when allowed; a report written by hand always goes.
      if (event.type !== 'feedback' && !crashReportsAllowed()) return null
      return scrubEvent(event)
    },
    beforeSendTransaction(event) {
      if (!crashReportsAllowed()) return null
      return scrubEvent(event)
    },
    beforeBreadcrumb(crumb) {
      // The console can say anything, file names included.
      if (crumb.category === 'console') return null
      if (crumb.message) crumb.message = scrub(crumb.message)
      if (crumb.data) {
        for (const k of ['url', 'from', 'to']) if (typeof crumb.data[k] === 'string') crumb.data[k] = scrub(scrubUrl(crumb.data[k] as string))
      }
      // A click's target is the element, which can name a photo in its text.
      if (crumb.category === 'ui.click' && crumb.message) crumb.message = crumb.message.replace(/\[[^\]]*\]/g, '')
      noteCrumb(crumb)
      return crumb
    },
  })
  // Freezes, and crashes no code is left running to report (watchdog.ts).
  startWatchdog({
    release: `copyshop@${__APP_VERSION__}`,
    scrub,
    cleanExit: isNative() ? () => import('@tauri-apps/api/core').then(({ invoke }) => invoke<number | null>('last_clean_exit')) : null,
  })
}

const lastIssue = new Map<string, number>()
let issuesSent = 0

/**
 * Something else to tell about each issue (the web editor's own reports,
 * src/web/report.ts). True when it sent the issue itself: then it isn't sent
 * to Sentry a second time from here (the same problem was two issues).
 */
let issueHook: ((message: string, level: Sentry.SeverityLevel, extra?: Record<string, unknown>) => boolean | void) | null = null
export function setIssueHook(hook: typeof issueHook): void {
  issueHook = hook
}

/** Numbers and sizes out of a grouping key: "pass (682 chars)" and "pass (2563 chars)" are one issue. */
const groupKey = (s: string): string => s.replace(/\d+(\.\d+)?/g, '#').slice(0, 120)

/**
 * Something that went wrong without an error reaching the page: a worker that
 * crashed or stopped answering, a GPU reset, a fallback taken. Grouped by
 * fingerprint (numbers taken out), else by message.
 *
 * `info` is only a breadcrumb: it rides along with the next real report
 * (a slow but finished shader build, a GPU's small limits) and is not an
 * issue of its own.
 */
export function reportIssue(message: string, level: Sentry.SeverityLevel = 'error', extra?: Record<string, unknown>, fingerprint?: string[]): void {
  Sentry.addBreadcrumb({ category: 'issue', level, message: scrub(message), data: extra ? plainExtra(extra) : undefined })
  let sent = false
  try {
    sent = issueHook?.(message, level, extra) === true
  } catch {
    /* a report must never break what reported it */
  }
  if (sent || !telemetryOn() || level === 'info' || level === 'debug' || level === 'log') return
  const groups = (fingerprint ?? [message]).map(groupKey)
  // The same thing at most once a minute, and a few dozen a visit: a repeat says nothing new.
  const key = groups.join('|')
  const now = Date.now()
  if (issuesSent >= 40 || now - (lastIssue.get(key) ?? -Infinity) < 60_000) return
  issuesSent++
  lastIssue.set(key, now)
  Sentry.withScope((scope) => {
    scope.setFingerprint(groups)
    scope.setTag('issue', groups[0])
    if (typeof extra?.gpu === 'string') scope.setTag('gpu', extra.gpu.slice(0, 200))
    if (extra) scope.setExtras(extra)
    // An event, not captureMessage: titled by its message, never by a stack.
    Sentry.captureEvent({ message, level })
  })
}

/** An extra's plain values, for a breadcrumb. */
function plainExtra(extra: Record<string, unknown>): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {}
  for (const [k, v] of Object.entries(extra).slice(0, 8)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') out[k] = scrub(v).slice(0, 200)
  }
  return out
}

/**
 * Times the steps of something that should be quick (opening a photo): each
 * step is a breadcrumb, and the whole is reported when it took over SLOW_MS,
 * with the time of every step.
 */
export function stepTimer(slowMs = 3000) {
  const start = performance.now()
  let last = start
  const steps: Record<string, number> = {}
  return {
    step(name: string) {
      const now = performance.now()
      steps[name] = Math.round(now - last)
      last = now
    },
    reportIfSlow(message: string, extra: Record<string, unknown> = {}) {
      const total = performance.now() - start
      Sentry.addBreadcrumb({ category: 'timing', message: `${message.replace(/^Slow /, '')}: ${Math.round(total)} ms`, data: steps })
      if (total > slowMs) reportIssue(message, total > 15_000 ? 'error' : total > 2 * slowMs ? 'warning' : 'info', { seconds: Math.round(total / 100) / 10, stepsMs: steps, ...extra }, [message])
    },
  }
}

/** Strings anywhere in a report's extras, scrubbed like its message. */
function scrubDeep(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrub(value)
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v, depth + 1)]))
}

function scrubEvent<E extends Sentry.Event>(event: E): E {
  if (event.message) event.message = scrub(event.message)
  if (event.extra) event.extra = scrubDeep(event.extra) as typeof event.extra
  for (const crumb of event.breadcrumbs ?? []) if (crumb.message) crumb.message = scrub(crumb.message)
  if (event.request?.url) event.request.url = scrubUrl(event.request.url)
  if (event.request) delete event.request.headers
  delete event.user
  for (const ex of event.exception?.values ?? []) {
    if (ex.value) ex.value = scrub(ex.value)
    for (const frame of ex.stacktrace?.frames ?? []) {
      if (frame.filename) frame.filename = scrubUrl(frame.filename)
      if (frame.abs_path) frame.abs_path = scrubUrl(frame.abs_path)
    }
  }
  if (event.transaction) event.transaction = scrub(scrubUrl(event.transaction))
  for (const span of event.spans ?? []) {
    if (span.description) span.description = scrub(scrubUrl(span.description))
    for (const k of ['url', 'http.url', 'url.full', 'name']) {
      const v = span.data?.[k]
      if (typeof v === 'string') span.data![k] = scrub(scrubUrl(v))
    }
  }
  return event
}

/** The edit's settings without the bulk: masks' pixels, pasted images, long point lists. */
function compact(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && value.length > 300) return `‹${value.length} characters›`
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return '‹data›'
  if (typeof ImageBitmap !== 'undefined' && value instanceof ImageBitmap) return '‹image›'
  if (Array.isArray(value) && value.length > 64) return `‹${value.length} items›`
  return value
}

/**
 * Send what someone wrote in Report a problem, with an optional email and,
 * if they chose, the edit's settings (no photo). Resolves once it's sent.
 */
export async function sendReport(report: { message: string; email?: string; edit?: unknown; crash?: string }): Promise<void> {
  if (!telemetryOn()) throw new Error('Reports are only sent from the released app.')
  startTelemetry()
  const attachments = report.edit
    ? [{ filename: 'edit.json', data: scrub(JSON.stringify(report.edit, compact, 1)), contentType: 'application/json' }]
    : undefined
  Sentry.captureFeedback(
    // Written on the crash screen: kept with that crash's report.
    { message: report.message.slice(0, 4000), ...(report.email ? { email: report.email } : {}), source: report.crash ? 'crash-screen' : 'report-a-problem', ...(report.crash ? { associatedEventId: report.crash } : {}) },
    { includeReplay: false, ...(attachments ? { attachments } : {}) },
  )
  const sent = await Sentry.flush(8000)
  if (!sent) throw new Error("The report couldn't be sent. Check your connection and try again.")
}

export { Sentry }
