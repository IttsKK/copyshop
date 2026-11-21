import type { CategoryId, StackModuleId } from '../moduleCatalog'
import type { ModuleGroup, StackTab } from '../StackNav'
import { createStore, persistedStore, useStore } from './store'

/** The panels' widths when first opened, and on a double-click of their edge. */
export const DEFAULT_LEFT = 264
export const DEFAULT_RIGHT = 324

/** The side panels, shown or hidden (PANEL_KEYS in shortcuts.ts, and Tab), and how wide. */
export const leftOpenStore = persistedStore('ui.leftOpen', true)
export const rightOpenStore = persistedStore('ui.rightOpen', true)
export const leftWidthStore = persistedStore('ui.leftWidth', DEFAULT_LEFT)
export const rightWidthStore = persistedStore('ui.rightWidth', DEFAULT_RIGHT)
/** The filmstrip under the photo, once there is a folder (PANEL_KEYS.strip). */
export const stripOpenStore = persistedStore('ui.filmstrip', true)
/** The Library grid over the editor (LibraryView.tsx), or the editor (G and D switch). */
export const libraryShownStore = createStore(false)

/** The right panel's page. Recipes first: the page a photo starts on; the modules, then export. */
export type PanelPage = 'recipes' | 'modules' | 'export'
export const panelPageStore = createStore<PanelPage>('recipes')
/** Which modules are in view, chosen on the rail: the photo's, a category or one of your groups. */
export const stackTabStore = persistedStore<StackTab>('ui.stack.tab', 'active')
/** Modules added or switched off on this photo's tab, kept in view (see the module stack in App). */
export const pinnedStore = persistedStore<StackModuleId[]>('ui.stack.pinned', [])
/** Your groups of modules, each a tab on the rail. */
export const groupsStore = persistedStore<ModuleGroup[]>('ui.stack.groups', [])
/** The categories folded away under their headers, for each view. */
export const foldedStore = persistedStore<Record<string, CategoryId[]>>('ui.stack.folded', {})

export const useLeftOpen = () => useStore(leftOpenStore)
export const useRightOpen = () => useStore(rightOpenStore)
export const useLeftWidth = () => useStore(leftWidthStore)
export const useRightWidth = () => useStore(rightWidthStore)
export const useStripOpen = () => useStore(stripOpenStore)
export const useLibraryShown = () => useStore(libraryShownStore)
export const usePanelPage = () => useStore(panelPageStore)
export const useStackTab = () => useStore(stackTabStore)
export const usePinned = () => useStore(pinnedStore)
export const useGroups = () => useStore(groupsStore)
export const useFolded = () => useStore(foldedStore)

export const setLeftOpen = (open: boolean) => leftOpenStore.set(open)
export const setRightOpen = (open: boolean) => rightOpenStore.set(open)
export const setLeftWidth = (w: number) => leftWidthStore.set(w)
export const setRightWidth = (w: number) => rightWidthStore.set(w)
export const setStripOpen = (open: boolean) => stripOpenStore.set(open)
export const setLibraryShown = (shown: boolean) => libraryShownStore.set(shown)
export const setPanelPage = (page: PanelPage) => panelPageStore.set(page)
export const setPinned = (ids: StackModuleId[]) => pinnedStore.set(ids)
export const setGroups = (groups: ModuleGroup[]) => groupsStore.set(groups)
export const setFoldedByTab = (folded: Record<string, CategoryId[]>) => foldedStore.set(folded)
