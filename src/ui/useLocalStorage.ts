import { useCallback, useState } from 'react'
import { readStored, writeStored } from './state/store'

/**
 * Tiny persisted-state hook for interface preferences. Under the launcher the
 * `ui.*` keys are kept on disk as well (see mirrorUiPref). For a preference
 * more than one component reads, see persistedStore in state/store.ts.
 */
export function useLocalStorage<T>(key: string, initial: T): [T, (value: T) => void] {
  // Its key can change (a module's folding, kept per page): read again for the new one.
  const [state, setState] = useState<{ key: string; value: T }>(() => ({ key, value: readStored(key, initial) }))
  const value = state.key === key ? state.value : readStored(key, initial)
  if (state.key !== key) setState({ key, value })
  const set = useCallback(
    (next: T) => {
      setState({ key, value: next })
      writeStored(key, next)
    },
    [key],
  )
  return [value, set]
}
