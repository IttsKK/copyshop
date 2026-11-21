import { useRef, useState } from 'react'

interface Props {
  initial?: string
  placeholder?: string
  label: string
  className?: string
  /** The name typed, or null when cancelled (Escape, or left empty). */
  onDone: (name: string | null) => void
}

/**
 * Type a name in place. Enter or clicking away keeps it, Escape cancels.
 *
 * Used instead of window.prompt, which the app's web view (WKWebView under
 * Tauri) does not implement: there it returns null at once, so a Save that
 * asked for a name that way silently did nothing.
 */
export function NameField({ initial = '', placeholder = 'Name', label, className = 'name-field', onDone }: Props) {
  const [value, setValue] = useState(initial)
  const done = useRef(false)
  const finish = (name: string | null) => {
    if (done.current) return
    done.current = true
    onDone(name?.trim() || null)
  }
  return (
    <input
      type="text"
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      autoFocus
      maxLength={60}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(value)
        else if (e.key === 'Escape') finish(null)
        e.stopPropagation()
      }}
      onBlur={() => finish(value)}
    />
  )
}
