import type { ExportState } from '../storage/exports'

/** How a photo's edit stands against its file, as the library and filmstrip say it. */
export const EXPORT_STATE_LABEL: Record<ExportState, string> = {
  unexported: 'edited, not exported yet',
  changed: 'edited since its last export',
  exported: 'exported',
}
