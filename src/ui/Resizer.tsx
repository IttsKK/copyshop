import { useCallback, useEffect, useRef } from 'react'

interface Props {
  /** Which side of the layout this handle lives on. */
  side: 'left' | 'right'
  width: number
  min: number
  max: number
  onResize: (width: number) => void
  onReset?: () => void
}

/** Drag handle for a sidebar. Double-click restores the default width. */
export function Resizer({ side, width, min, max, onResize, onReset }: Props) {
  const start = useRef<{ x: number; width: number } | null>(null)

  const clamp = useCallback((value: number) => Math.min(max, Math.max(min, value)), [max, min])

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (!start.current) return
      const delta = e.clientX - start.current.x
      onResize(clamp(start.current.width + (side === 'left' ? delta : -delta)))
    }
    const up = () => {
      start.current = null
      document.body.classList.remove('resizing')
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [clamp, onResize, side])

  return (
    <div
      className="resizer"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        start.current = { x: e.clientX, width }
        document.body.classList.add('resizing')
      }}
      onDoubleClick={onReset}
    />
  )
}
