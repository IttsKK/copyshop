import type { BlendParams } from '../engine/types'
import { APP_VERSION } from '../platform/updates'
import type { Look } from './looks'
import { MODULES, inUse } from './moduleCatalog'
import { EXTEND_STYLE, STREAK_STYLES, styleOf } from './streakStyles'

/**
 * Submit to Gallery: a finished photo sent to getcopyshop.com (/__cs/share,
 * the site's shares.js) for its gallery and copyshop's Instagram, credited as
 * its maker asks. It is looked at before it is shown anywhere, and the link
 * that comes back takes it down again. The web playground has the same form.
 *
 * What goes: the photo with its edit as a JPEG (2048 px at most, every bit of
 * its metadata taken out by the site), the credit, an optional link and
 * email, the names of the built-in parts of its edit, and this version.
 */

const ENDPOINT = 'https://getcopyshop.com/__cs/share'
const KEY = 'copyshop.shareDetails'
/** The longest side sent: the gallery and Instagram show no more. */
export const GALLERY_SIDE = 2048

export interface GalleryDetails {
  credit: string
  link: string
  contact: string
}

/** What was typed last time, so the next one is a click. */
export function keptGalleryDetails(): GalleryDetails {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { credit: String(v.credit ?? ''), link: String(v.link ?? ''), contact: String(v.contact ?? '') }
  } catch {
    return { credit: '', link: '', contact: '' }
  }
}

/** The built-in parts of an edit, by the names the app shows (never one someone gave a saved recipe). */
export function galleryTools(blend: BlendParams, look: Look | null): string[] {
  const out: string[] = []
  if (look && look.id !== 'none') out.push(`Recipe · ${look.label}`)
  for (const m of MODULES) {
    if (!inUse(m.id, blend) || m.id === 'crop') continue
    if (m.id === 'streaks') {
      const nameOf = (id: string | null) => (id === EXTEND_STYLE.id ? EXTEND_STYLE.name : (STREAK_STYLES.find((s) => s.id === id)?.name ?? null))
      const styles = new Set(blend.effects.streaks.shapes.map((s) => nameOf(styleOf(s))).filter((x): x is string => !!x))
      if (!styles.size) out.push(m.title)
      for (const s of styles) out.push(`${m.title} · ${s}`)
      continue
    }
    out.push(m.title)
  }
  return out.slice(0, 24)
}

/** A rendered photo as the JPEG sent: GALLERY_SIDE at most on its long side. */
export async function galleryJpeg(rendered: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(rendered)
  const k = Math.min(1, GALLERY_SIDE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * k))
  const h = Math.max(1, Math.round(bitmap.height * k))
  const canvas = new OffscreenCanvas(w, h)
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
}

/** Sends it. Resolves to the link that takes it down again. */
export async function submitToGallery(photo: Blob, details: GalleryDetails, tools: string[]): Promise<string> {
  try {
    localStorage.setItem(KEY, JSON.stringify(details))
  } catch {
    /* typed again next time */
  }
  const form = new FormData()
  form.set('photo', photo, 'photo.jpg')
  form.set('credit', details.credit.trim())
  form.set('link', details.link.trim())
  form.set('contact', details.contact.trim())
  form.set('tools', JSON.stringify(tools))
  form.set('rights', '1')
  form.set('source', 'desktop')
  form.set('release', APP_VERSION)
  let res: Response
  try {
    res = await fetch(ENDPOINT, { method: 'POST', body: form })
  } catch {
    throw new Error('Could not reach copyshop. Check your connection and try again')
  }
  const body = (await res.json().catch(() => null)) as { remove?: string; error?: string } | null
  if (!res.ok || !body?.remove) throw new Error(body?.error ?? 'Could not send the photo. Try again')
  return body.remove
}
