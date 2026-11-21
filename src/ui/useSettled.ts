import { useEffect, useState } from 'react'

/**
 * A value as it was once it stopped changing for `ms`: for work too slow to
 * redo on every step of a drag (it runs once, when the drag rests).
 */
export function useSettled<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    if (Object.is(value, settled)) return
    const timer = setTimeout(() => setSettled(value), ms)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ms])
  return settled
}
