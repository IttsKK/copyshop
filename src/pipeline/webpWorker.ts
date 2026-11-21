/// <reference lib="webworker" />
/**
 * WebP encoding off the main thread (pipeline/webp.ts): libwebp compiled to
 * WebAssembly (@jsquash/webp), loaded the first time a WebP is exported.
 */
import encode from '@jsquash/webp/encode.js'

interface Job {
  id: number
  width: number
  height: number
  pixels: ArrayBuffer
  quality: number
}

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, width, height, pixels, quality } = e.data
  try {
    const image = { data: new Uint8ClampedArray(pixels), width, height, colorSpace: 'srgb' } as ImageData
    // Sharp YUV: colour edges (and colour grain) kept as well as 4:2:0 allows.
    const out = await encode(image, { quality, method: 4, use_sharp_yuv: 1 })
    ;(self as unknown as Worker).postMessage({ id, out }, [out])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: (err as Error)?.message ?? String(err) })
  }
}
