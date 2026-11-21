import { MAX_ZOOM, type Zoom } from '../PreviewCanvas'
import { createStore, persistedStore, useStore } from './store'

/** How the photo is shown: zoom, the phone preview, the original, the loupe. */
export const zoomStore = persistedStore<Zoom>('ui.zoom', 'fit')
/** The phone preview: the export downsized and shown small. */
export const smallStore = persistedStore('ui.small', false)
/** In the phone preview, compressed the way Instagram does. */
export const igSimStore = persistedStore('ui.igSim', true)
/** The photo without the edit, while held. */
export const bypassStore = createStore(false)
/** W held: a 100% loupe under the pointer. */
export const loupeStore = createStore(false)
/** Asking for Fit again centres the photo, even when the view is already at Fit. */
export const fitAskedStore = createStore(0)

export const useZoom = () => useStore(zoomStore)
export const useSmall = () => useStore(smallStore)
export const useIgSim = () => useStore(igSimStore)
export const useBypass = () => useStore(bypassStore)
export const useLoupe = () => useStore(loupeStore)
export const useFitAsked = () => useStore(fitAskedStore)

/** Any zoom request means "back to editing": it leaves the small view. */
export function setZoom(next: Zoom | ((z: Zoom) => Zoom)): void {
  smallStore.set(false)
  const z = typeof next === 'function' ? next(zoomStore.get()) : next
  if (z === 'fit') fitAskedStore.set((n) => n + 1)
  zoomStore.set(z)
}
/** The zoom the preview itself reached (a scroll or a pinch): only the number. */
export const setZoomState = (z: Zoom) => zoomStore.set(z)
export const setSmall = (next: boolean | ((v: boolean) => boolean)) => smallStore.set(next)
export const setIgSim = (on: boolean) => igSimStore.set(on)
export const setBypass = (next: boolean | ((v: boolean) => boolean)) => bypassStore.set(next)
export const setLoupe = (on: boolean) => loupeStore.set(on)

/** One step of keyboard zoom: through the round numbers, clamped. */
export function stepZoom(z: Zoom, dir: 1 | -1): Zoom {
  const steps = [0.25, 0.5, 1, 2, 4, 8, MAX_ZOOM]
  if (z === 'fit') return dir > 0 ? 1 : 'fit'
  const next = dir > 0 ? steps.find((s) => s > z + 1e-6) : [...steps].reverse().find((s) => s < z - 1e-6)
  return next ?? (dir > 0 ? MAX_ZOOM : 'fit')
}
