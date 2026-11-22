import { isNative } from './native'

/**
 * copyshop:// links (the deep-link plugin, src-tauri): the playground's
 * Desktop app button opens one to hand its photo to the app. `handle` gets
 * each link: the one the app was started with, then any while it runs
 * (Windows and Linux pass them on from a second launch, single-instance).
 */
export function startDeepLinks(handle: (url: string) => void): void {
  if (!isNative()) return
  void Promise.all([import('@tauri-apps/api/core'), import('@tauri-apps/api/event')]).then(async ([{ invoke }, { listen }]) => {
    await listen<string[]>('deep-link://new-url', (e) => e.payload.forEach(handle))
    const first = await invoke<string[] | null>('plugin:deep-link|get_current').catch(() => null)
    first?.forEach(handle)
  })
}
