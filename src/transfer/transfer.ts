import { MAX_BUNDLE_BYTES, collect, hasContent, pack, restore, unpack } from './bundle'
import { newKey, seal, unseal } from './seal'

/** The transfer server (server/ in this repo). Set VITE_COPYSHOP_SERVER for a local one. */
export const SERVER: string = import.meta.env.VITE_COPYSHOP_SERVER ?? 'https://api.getcopyshop.com'

/** The browser version, where pairing links open. */
/** Where people write with problems, questions and ideas. */
export const CONTACT = 'hello@getcopyshop.com'
export const FEEDBACK_MAIL = `mailto:${CONTACT}?subject=${encodeURIComponent('copyshop')}`
export const WEB_APP: string = import.meta.env.VITE_COPYSHOP_WEB ?? 'https://getcopyshop.com/app/'

/** The desktop app's Polar checkout link. */
export const DESKTOP_CHECKOUT = 'https://buy.polar.sh/polar_cl_PHH25Jt7NUVexScggn75uGQfvJ9M1NFW6Puw34USArm'

async function failure(res: Response, fallback: string): Promise<Error> {
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return new Error(body.error)
  } catch {
    /* not JSON */
  }
  return new Error(fallback)
}

/**
 * The browser side. Packs and encrypts what's open (and the libraries), uploads
 * it, and returns the checkout link that names it, so the desktop app bought there
 * opens with it. Without anything to carry, the plain link.
 */
export async function checkoutWithEdit(checkout = DESKTOP_CHECKOUT): Promise<string> {
  const contents = await collect()
  if (!hasContent(contents)) return checkout
  const bytes = await pack(contents)
  if (bytes.length > MAX_BUNDLE_BYTES) throw new Error('Your photos and plates are too big to send across together.')
  const { sealed, key } = await seal(bytes)
  const res = await fetch(`${SERVER}/v1/transfers`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-transfer-key': key },
    body: sealed,
  })
  if (!res.ok) throw await failure(res, 'Your edit could not be uploaded.')
  const { id } = (await res.json()) as { id: string }
  const url = new URL(checkout)
  url.searchParams.set('reference_id', id)
  return url.toString()
}

/** Asks the server to email the license keys bought with this address. Says nothing about whether it bought any. */
export async function emailLostKey(email: string): Promise<void> {
  const res = await fetch(`${SERVER}/v1/recover`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email }),
  })
  if (!res.ok) throw await failure(res, "Your key couldn't be emailed. Try again in a minute.")
}

const post = (path: string, licenseKey: string) =>
  fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: licenseKey }),
  })

/**
 * The app side. Fetches, opens and restores any transfer waiting for this
 * license, then tells the server to delete it. Returns how many came in.
 */
export async function receiveTransfers(licenseKey: string): Promise<number> {
  const res = await post('/v1/transfers/claim', licenseKey)
  if (!res.ok) throw await failure(res, 'Could not check for an edit from the browser.')
  const { transfers } = (await res.json()) as { transfers: { id: string; key: string }[] }
  for (const t of transfers) {
    const data = await post(`/v1/transfers/${t.id}/download`, licenseKey)
    if (!data.ok) throw await failure(data, 'Your edit from the browser could not be downloaded.')
    const contents = unpack(await unseal(new Uint8Array(await data.arrayBuffer()), t.key))
    await restore(contents)
    await post(`/v1/transfers/${t.id}/done`, licenseKey).catch(() => undefined)
  }
  return transfers.length
}

/*
 * Pairing: the desktop app asks the browser for its edits, any time after buying.
 * The app makes the id and the key; the link carries them in its #fragment,
 * which a browser never sends anywhere, so the server only ever holds what it
 * can't open.
 */

export interface Pairing {
  id: string
  key: string
  url: string
}

export function newPairing(): Pairing {
  const id = crypto.randomUUID()
  const key = newKey()
  return { id, key, url: `${WEB_APP}#send=${id}.${key}` }
}

/** The pairing a link asks this browser to send to, if it's one. */
export function pairingFromHash(hash: string): { id: string; key: string } | null {
  const m = /^#send=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/.exec(hash)
  return m ? { id: m[1], key: m[2] } : null
}

/** The browser side: false when there's nothing here to send. */
export async function sendToApp(pairing: { id: string; key: string }): Promise<boolean> {
  const contents = await collect()
  if (!hasContent(contents)) return false
  const bytes = await pack(contents)
  if (bytes.length > MAX_BUNDLE_BYTES) throw new Error('Your photos and plates are too big to send together.')
  const { sealed } = await seal(bytes, pairing.key)
  const res = await fetch(`${SERVER}/v1/pairs/${pairing.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/octet-stream' },
    body: sealed,
  })
  if (!res.ok) throw await failure(res, 'Your edits could not be sent.')
  return true
}

/** The app side: polls until the browser has sent, then brings it in. Rejects with an AbortError when stopped. */
export async function receivePairing(pairing: Pairing, signal: AbortSignal): Promise<void> {
  for (;;) {
    signal.throwIfAborted()
    const res = await fetch(`${SERVER}/v1/pairs/${pairing.id}`, { cache: 'no-store', signal }).catch((e) => {
      if (signal.aborted) throw e
      return null // offline for a moment: keep waiting
    })
    if (res?.ok) {
      const contents = unpack(await unseal(new Uint8Array(await res.arrayBuffer()), pairing.key))
      await restore(contents)
      await fetch(`${SERVER}/v1/pairs/${pairing.id}`, { method: 'DELETE' }).catch(() => undefined)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 2000)
      signal.addEventListener('abort', () => {
        clearTimeout(t)
        reject(signal.reason)
      }, { once: true })
    })
  }
}
