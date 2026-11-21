import { useSyncExternalStore } from 'react'
import { mirrorUiPref } from '../../storage/db'

/**
 * A value kept outside React, read with useStore: only the components that
 * read it render again when it changes, wherever they are in the tree.
 */
export interface Store<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

/** A stored preference, or `initial` when there is none or it cannot be read. */
export function readStored<T>(key: string, initial: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? initial : (JSON.parse(raw) as T)
  } catch {
    return initial
  }
}

/** Keep a preference. Under the launcher the `ui.*` keys are kept on disk as well (see mirrorUiPref). */
export function writeStored<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    if (key.startsWith('ui.')) mirrorUiPref()
  } catch {
    /* storage full or blocked: layout preference is not worth failing over */
  }
}

function makeStore<T>(read: () => T, write?: (value: T) => void): Store<T> {
  const listeners = new Set<() => void>()
  let loaded = false
  let value: T
  const get = () => {
    if (!loaded) {
      value = read()
      loaded = true
    }
    return value
  }
  return {
    get,
    set: (next) => {
      const prev = get()
      const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next
      if (Object.is(v, prev)) return
      value = v
      write?.(v)
      listeners.forEach((l) => l())
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

/** A value for this session only. */
export function createStore<T>(initial: T): Store<T> {
  return makeStore(() => initial)
}

/**
 * A value kept in localStorage under `key`, in the same JSON useLocalStorage
 * writes. It is read when first wanted, not when the module loads: the
 * launcher's copy is put in place before the first render (initStorage).
 */
export function persistedStore<T>(key: string, initial: T): Store<T> {
  return makeStore(
    () => readStored(key, initial),
    (value) => writeStored(key, value),
  )
}

/** The store's value, and a render whenever it changes. */
export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}
