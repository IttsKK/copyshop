/**
 * AES-256-GCM around a transfer bundle, with a fresh random key each time.
 * Sealed layout: the 12-byte IV, then the ciphertext with its tag.
 */

export const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const fromB64url = (s: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0))

/** A fresh key, as the sealing functions take it. */
export const newKey = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)))

/** Seals with `withKey` when given (pairing: the app chose it), else a fresh one. */
export async function seal(data: Uint8Array<ArrayBuffer>, withKey?: string): Promise<{ sealed: Uint8Array<ArrayBuffer>; key: string }> {
  const raw = withKey ? fromB64url(withKey) : crypto.getRandomValues(new Uint8Array(32))
  const key = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data))
  const sealed = new Uint8Array(12 + ct.length)
  sealed.set(iv)
  sealed.set(ct, 12)
  return { sealed, key: b64url(raw) }
}

export async function unseal(sealed: Uint8Array<ArrayBuffer>, key: string): Promise<Uint8Array<ArrayBuffer>> {
  const k = await crypto.subtle.importKey('raw', fromB64url(key), 'AES-GCM', false, ['decrypt'])
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: sealed.subarray(0, 12) }, k, sealed.subarray(12)))
  } catch {
    throw new Error('The transfer could not be decrypted.')
  }
}
