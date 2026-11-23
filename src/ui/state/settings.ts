import { DEFAULT_TIMELAPSE, type TimelapseSettings } from '../timelapse'
import { persistedStore, useStore } from './store'

/** The timelapse: off until turned on in Settings; then it records in the background. */
export const timelapseStore = persistedStore<TimelapseSettings>('settings.timelapse', DEFAULT_TIMELAPSE)

export const useTimelapseSettings = () => useStore(timelapseStore)
export const setTimelapse = (settings: TimelapseSettings) => timelapseStore.set(settings)

/**
 * Where Export saves, in the app: next to the photo (it takes the photo's
 * place; the original moves into Originals/ beside it) or in the chosen
 * export folder, or neither ('ask': asked each time, or downloaded), the
 * export folder still remembered for later. Null until chosen: the folder if one was chosen before,
 * else next to the photo.
 */
export type ExportTo = 'photo' | 'folder' | 'ask'
export const exportToStore = persistedStore<ExportTo | null>('settings.exportTo', null)
export const useExportTo = () => useStore(exportToStore)
export const setExportTo = (to: ExportTo) => exportToStore.set(to)

/** What the app shows when it opens (the desktop app): the photo left open, or the Library. */
export const launchStore = persistedStore<'photo' | 'library'>('settings.launch', 'photo')
export const useLaunch = () => useStore(launchStore)

/** The recipe a newly opened photo starts with, by its id: 'none', or one of the built-in looks. */
export const startLookStore = persistedStore<string>('settings.startLook', 'none')
export const useStartLook = () => useStore(startLookStore)

/**
 * Opening a module folds the others, so the panel stays short and the next
 * one is in sight (darktable's "expand single module"). Option-click does
 * the other: on, it opens one beside the rest; off, it opens only that one.
 */
export const singleModuleStore = persistedStore<boolean>('settings.singleModule', true)
export const useSingleModule = () => useStore(singleModuleStore)

/** Animations kept to a minimum, whatever the system says. (The system's Reduce motion is always followed.) */
export const reduceMotionStore = persistedStore<boolean>('settings.reduceMotion', false)
export const useReduceMotion = () => useStore(reduceMotionStore)

/**
 * A two-finger swipe on a trackpad over the photo: moves it (as in Figma,
 * Lightroom and Apple's apps; a pinch zooms), or zooms as a mouse wheel
 * does. A mouse wheel always zooms.
 */
export const trackpadScrollStore = persistedStore<'move' | 'zoom'>('settings.trackpadScroll', 'move')
export const useTrackpadScroll = () => useStore(trackpadScrollStore)
