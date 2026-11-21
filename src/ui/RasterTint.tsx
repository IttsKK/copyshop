import { decodeRaster, rasterKey } from '../engine/maskRaster'
import type { MaskRaster, Rect, Size } from '../engine/types'

const urls = new Map<string, string>()

/** A raster mask as a tinted picture of what it covers, made once. */
export function rasterTintUrl(r: MaskRaster): string {
  const id = rasterKey(r)
  let url = urls.get(id)
  if (url) return url
  const grid = decodeRaster(r)
  const c = document.createElement('canvas')
  c.width = r.w
  c.height = r.h
  const img = new ImageData(r.w, r.h)
  for (let i = 0; i < grid.length; i++)
    if (grid[i]) {
      img.data[i * 4] = 127
      img.data[i * 4 + 1] = 211
      img.data[i * 4 + 2] = 255
      img.data[i * 4 + 3] = 255
    }
  c.getContext('2d')!.putImageData(img, 0, 0)
  url = c.toDataURL('image/png')
  urls.set(id, url)
  if (urls.size > 12) urls.delete(urls.keys().next().value!)
  return url
}

/** The SVG image of a raster mask over the photo, placed by `shapes` (the frame masks are fractions of). */
export function RasterTintImage({ raster, shapes, region, css, href }: { raster: MaskRaster; shapes: Rect; region: Rect; css: Size; href?: string | null }) {
  const sx = css.width / region.width
  const sy = css.height / region.height
  const x = (shapes.x + raster.x * shapes.width - region.x) * sx
  const y = (shapes.y + raster.y * shapes.height - region.y) * sy
  return (
    <image
      className="raster-tint"
      href={href ?? rasterTintUrl(raster)}
      x={x}
      y={y}
      width={raster.width * shapes.width * sx}
      height={raster.height * shapes.height * sy}
      preserveAspectRatio="none"
      style={{ imageRendering: 'auto' }}
    />
  )
}

/** A raster mask shown on the photo while it is the one being looked at. */
export function RasterTint(props: { raster: MaskRaster; shapes: Rect; region: Rect; css: Size; href?: string | null }) {
  return (
    <svg className="raster-tint-overlay" width={props.css.width} height={props.css.height} viewBox={`0 0 ${props.css.width} ${props.css.height}`}>
      <RasterTintImage {...props} />
    </svg>
  )
}
