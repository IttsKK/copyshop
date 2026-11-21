import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS, type BlendParams } from '../engine/types'
import { DEFAULT_OUTPUT } from '../storage/presets'
import { WEB_LONG_EDGE, desktopNeeds, exportSizeOf, webCap } from './ExportPresets'

const photo = { width: 6000, height: 4000 }
const withBorder: BlendParams = {
  ...DEFAULT_BLEND_PARAMS,
  modules: { ...DEFAULT_BLEND_PARAMS.modules, border: true },
  border: { ...DEFAULT_BLEND_PARAMS.border, width: 0.08, bottomExtra: 0.17 },
}

describe('the browser export limit', () => {
  it('exports a full-size request at the limit, and says what full size would be', () => {
    for (const blend of [DEFAULT_BLEND_PARAMS, withBorder]) {
      const cap = webCap({ ...DEFAULT_OUTPUT, shape: 'original', longEdge: null }, photo, blend)!
      expect(cap).not.toBeNull()
      expect(Math.max(cap.size.width, cap.size.height)).toBeLessThanOrEqual(WEB_LONG_EDGE)
      expect(Math.max(cap.size.width, cap.size.height)).toBeGreaterThan(WEB_LONG_EDGE - 4)
      expect(cap.full).toEqual(exportSizeOf({ ...DEFAULT_OUTPUT, shape: 'original', longEdge: null }, photo, blend))
    }
  })

  it('leaves sizes within the limit alone', () => {
    expect(webCap({ ...DEFAULT_OUTPUT, shape: 'original', longEdge: 1600 }, photo, DEFAULT_BLEND_PARAMS)).toBeNull()
    expect(webCap({ ...DEFAULT_OUTPUT, shape: 'instagram', longEdge: null }, photo, withBorder)).toBeNull()
    expect(webCap({ ...DEFAULT_OUTPUT, shape: 'original', longEdge: null }, { width: 1200, height: 800 }, DEFAULT_BLEND_PARAMS)).toBeNull()
  })

  it('only PNG needs the desktop app', () => {
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'png' }, { name: 'a.jpg' })).toEqual(['PNG'])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'match' }, { name: 'a.png' })).toEqual(['PNG'])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'match' }, { name: 'a.jpg' })).toEqual([])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'jpeg', longEdge: null }, { name: 'a.jpg' })).toEqual([])
  })

  it('TIFF needs the desktop app as PNG does; WebP exports in the browser', () => {
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'tiff' }, { name: 'a.jpg' })).toEqual(['TIFF'])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'match' }, { name: 'a.tif' })).toEqual(['TIFF'])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'webp' }, { name: 'a.png' })).toEqual([])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'match' }, { name: 'a.webp' })).toEqual([])
    // HEIC and the rest come out as JPEG.
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'match' }, { name: 'IMG_1.HEIC' })).toEqual([])
    expect(desktopNeeds({ ...DEFAULT_OUTPUT, format: 'tiff' }, null)).toEqual(['TIFF'])
  })
})
