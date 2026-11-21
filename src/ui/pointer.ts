/**
 * Pointer capture is a nicety, not a precondition: it keeps a drag alive when
 * the cursor leaves the element. Calling it can throw (a pointer that is no
 * longer active, a synthetic event), and a drag must not be lost because of
 * that — so callers set their drag state first and capture on a best-effort
 * basis.
 */
export function capturePointer(target: EventTarget | null, pointerId: number): void {
  try {
    ;(target as Element | null)?.setPointerCapture?.(pointerId)
  } catch {
    /* drag continues without capture */
  }
}
