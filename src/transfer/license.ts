import { get, put, remove } from '../storage/db'

/**
 * The desktop app's license, checked with Polar directly (its customer-portal
 * endpoints are made for apps), so activating never depends on copyshop's own
 * server. Each computer takes one of the key's activations; a customer can free one
 * from their Polar account.
 */

const POLAR = 'https://api.polar.sh'
const ORG = 'b6aa1011-52c5-4910-ab65-82b122112f6d'
const STORE = 'meta'
const ID = 'license'
/** How long the app keeps working on its last good check while it can't reach Polar. */
const OFFLINE_GRACE_MS = 30 * 24 * 60 * 60 * 1000

export interface License {
  id: typeof ID
  key: string
  displayKey: string
  activationId: string
  activatedAt: number
  checkedAt: number
}

async function reason(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; detail?: unknown }
    if (res.status === 404) return "That key wasn't found. Check it against your purchase email."
    const detail = typeof body.detail === 'string' ? body.detail : ''
    if (res.status === 403 && /limit/i.test(detail))
      return 'This key is in use on three computers already. Free one under Your purchases, at the foot of getcopyshop.com, then try again.'
    if (detail) return detail
  } catch {
    /* fall through */
  }
  return `The license check didn't work just now (it answered ${res.status}). Try again in a minute, or write to hello@getcopyshop.com.`
}

/** A request that never got an answer (offline, blocked), said plainly. */
const unreachable = () => new Error("Couldn't reach the license check. Check this computer is online, then try again.")

/** What the activation is called in the buyer's account: the kind of computer it's on. */
const deviceLabel = () => {
  const ua = navigator.userAgent
  return /Windows/.test(ua) ? 'Windows' : /Linux|X11/.test(ua) ? 'Linux' : /Mac/.test(ua) ? 'Mac' : 'Computer'
}

export const loadLicense = (): Promise<License | undefined> => get<License>(STORE, ID)

export type LicenseState = 'checking' | 'valid' | 'invalid' | 'none'

/**
 * Activating, removing, and asking to change the key, heard by the app (which
 * shows the activation sheet) and by Settings.
 */
const events = new EventTarget()
export function onLicense(listener: (state: LicenseState | 'change') => void): () => void {
  const fn = (e: Event) => listener((e as CustomEvent<LicenseState | 'change'>).detail)
  events.addEventListener('license', fn)
  return () => events.removeEventListener('license', fn)
}
const emit = (detail: LicenseState | 'change') => events.dispatchEvent(new CustomEvent('license', { detail }))
/** Settings' "Change…": the app shows the activation sheet over everything. */
export const requestLicenseChange = () => emit('change')

export async function activate(key: string): Promise<License> {
  key = key.trim()
  // The same key again on this computer (after a long time offline, say):
  // its old activation is freed first, so it doesn't take a second of the
  // key's computers.
  const before = await loadLicense()
  if (before && before.key === key) await freeActivation(before)
  const res = await fetch(`${POLAR}/v1/customer-portal/license-keys/activate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key, organization_id: ORG, label: deviceLabel() }),
  }).catch(() => {
    throw unreachable()
  })
  if (!res.ok) throw new Error(await reason(res))
  const body = (await res.json()) as { id: string; license_key: { display_key: string } }
  const license: License = {
    id: ID,
    key,
    displayKey: body.license_key.display_key,
    activationId: body.id,
    activatedAt: Date.now(),
    checkedAt: Date.now(),
  }
  // A new key replaces the old one: free the old activation first.
  const old = await loadLicense()
  if (old && old.key !== key) await freeActivation(old)
  await put(STORE, license)
  emit('valid')
  return license
}

/**
 * Whether this computer's license still stands. Asks Polar when it can; offline,
 * trusts the last good answer for a month.
 */
export async function checkLicense(): Promise<'valid' | 'invalid' | 'none'> {
  const license = await loadLicense()
  if (!license) return 'none'
  let res: Response
  try {
    res = await fetch(`${POLAR}/v1/customer-portal/license-keys/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: license.key, organization_id: ORG, activation_id: license.activationId }),
    })
  } catch {
    return Date.now() - license.checkedAt < OFFLINE_GRACE_MS ? 'valid' : 'invalid'
  }
  if (res.ok) {
    const body = (await res.json()) as { status?: string }
    if (body.status === 'granted') {
      await put(STORE, { ...license, checkedAt: Date.now() })
      return 'valid'
    }
    return 'invalid'
  }
  // Only Polar saying the key or this computer's activation is gone counts as
  // invalid. Anything else (a firewall, a captive wifi page or a bot check
  // answering 403, a server error) is treated as being offline: the last good
  // answer stands for a month.
  if (res.status === 404) return 'invalid'
  return Date.now() - license.checkedAt < OFFLINE_GRACE_MS ? 'valid' : 'invalid'
}

const freeActivation = (license: License) =>
  fetch(`${POLAR}/v1/customer-portal/license-keys/deactivate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: license.key, organization_id: ORG, activation_id: license.activationId }),
  }).catch(() => undefined)

/** Frees this computer's activation and forgets the key here. */
export async function deactivate(): Promise<void> {
  const license = await loadLicense()
  if (!license) return
  await freeActivation(license)
  await remove(STORE, ID)
  emit('none')
}
