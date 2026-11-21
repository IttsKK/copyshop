import { diskAvailable } from '../storage/disk'
import { isNative } from './native'

/**
 * The desktop app, or the launcher that serves it with disk access: where RAW
 * files, folders and batches work. In a plain browser those features show,
 * greyed, with a line saying they are in the desktop app.
 */
export const isDesktop = (): boolean => isNative() || diskAvailable()

/** The line a greyed-out feature carries in the browser. */
export const IN_DESKTOP_APP = 'In the desktop app'
