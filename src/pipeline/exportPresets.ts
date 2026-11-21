import type { OutputSettings } from '../storage/presets'

/** What an export preset sets: everything about the file but its name. */
export type ExportSettings = Pick<OutputSettings, 'shape' | 'longEdge' | 'format' | 'jpegQuality'>

export interface ExportPreset {
  id: string
  name: string
  hint: string
  settings: ExportSettings
  builtIn?: boolean
}

const builtIn = (id: string, name: string, hint: string, settings: ExportSettings): ExportPreset => ({ id, name, hint, settings, builtIn: true })

/** The ones most photos go out as. Your own follow them. */
export const BUILT_IN_EXPORTS: ExportPreset[] = [
  builtIn('original', 'Original', 'The photo’s own size and format', { shape: 'original', longEdge: null, format: 'match', jpegQuality: 0.95 }),
  builtIn('instagram', 'Instagram', '1080 px wide, the size Instagram shows, so it isn’t resized and the grain stays crisp', { shape: 'instagram', longEdge: null, format: 'jpeg', jpegQuality: 0.92 }),
  builtIn('web', 'Web', '2048 px on the long edge: sharing, sites, messages', { shape: 'original', longEdge: 2048, format: 'jpeg', jpegQuality: 0.9 }),
  builtIn('4k', '4K screen', '3840 px on the long edge, for wallpapers and TVs', { shape: 'original', longEdge: 3840, format: 'jpeg', jpegQuality: 0.95 }),
  builtIn('lossless', 'Lossless', 'Full size PNG: nothing lost to compression, for printing or further editing', { shape: 'original', longEdge: null, format: 'png', jpegQuality: 0.95 }),
]

/** Whether the current settings are a preset's. Quality only counts where it applies: not for PNG or TIFF. */
export function matches(a: ExportSettings, b: ExportSettings): boolean {
  return (
    a.shape === b.shape &&
    (a.shape === 'instagram' || a.longEdge === b.longEdge) &&
    a.format === b.format &&
    (a.format === 'png' || a.format === 'tiff' || Math.abs(a.jpegQuality - b.jpegQuality) < 0.005)
  )
}
