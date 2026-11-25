import type { TextureSource } from './types'

/**
 * Surface images (engine/surface.ts kind 'image') the engine has to hand, by
 * their id in the texture store. The engine draws synchronously and never
 * reads storage itself: whoever renders puts the image here first
 * (sources/surfaceTextures.ts loadSurfaceTexture, which an export awaits), or
 * passes it with the request (the render worker gets it that way). One
 * that isn't here yet is left out of that render.
 */
const images = new Map<string, TextureSource>()

export function setSurfaceImage(id: string, image: TextureSource): void {
  images.set(id, image)
}

export const surfaceImageOf = (id: string | undefined): TextureSource | null => (id ? (images.get(id) ?? null) : null)

/** The size of an image the engine can draw, whatever kind it is. */
export function sizeOf(s: TextureSource): { width: number; height: number } {
  const o = s as { width?: number; height?: number; naturalWidth?: number; naturalHeight?: number }
  return { width: o.naturalWidth || o.width || 1, height: o.naturalHeight || o.height || 1 }
}
