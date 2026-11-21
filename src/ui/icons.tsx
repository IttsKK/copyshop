/**
 * Panel toggles read as a frame with one edge filled — the standard editor
 * convention, and mirrored so left and right are distinguishable at a glance.
 * The block glyphs they replace (▤ ▥) looked identical at this size.
 */
const base = {
  width: 15,
  height: 15,
  viewBox: '0 0 15 15',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.2,
  'aria-hidden': true,
} as const

export function PanelLeftIcon() {
  return (
    <svg {...base}>
      <rect x="1.6" y="2.6" width="11.8" height="9.8" rx="1.6" />
      <path d="M5.7 2.6v9.8" />
      <rect x="1.6" y="2.6" width="4.1" height="9.8" rx="1.6" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  )
}

export function PanelRightIcon() {
  return (
    <svg {...base}>
      <rect x="1.6" y="2.6" width="11.8" height="9.8" rx="1.6" />
      <path d="M9.3 2.6v9.8" />
      <rect x="9.3" y="2.6" width="4.1" height="9.8" rx="1.6" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  )
}

/** The filmstrip: the frame with its bottom edge filled, as the panel toggles have theirs. */
export function PanelBottomIcon() {
  return (
    <svg {...base}>
      <rect x="1.6" y="2.6" width="11.8" height="9.8" rx="1.6" />
      <path d="M1.6 9.2h11.8" />
      <rect x="1.6" y="9.2" width="11.8" height="3.2" rx="1.6" fill="currentColor" stroke="none" opacity="0.55" />
    </svg>
  )
}

export function HelpIcon() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="7.5" r="5.6" />
      <path d="M5.9 5.9a1.7 1.7 0 1 1 1.9 2.2v1" strokeLinecap="round" />
      <circle cx="7.6" cy="10.7" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function SettingsIcon() {
  return (
    <svg {...base}>
      <circle cx="7.5" cy="7.5" r="2" />
      <path
        d="M7.5 1.6v1.6M7.5 11.8v1.6M1.6 7.5h1.6M11.8 7.5h1.6M3.3 3.3l1.15 1.15M10.55 10.55l1.15 1.15M3.3 11.7l1.15-1.15M10.55 4.45l1.15-1.15"
        strokeLinecap="round"
      />
      <circle cx="7.5" cy="7.5" r="4.3" />
    </svg>
  )
}

export function RestoreIcon() {
  return (
    <svg {...base}>
      <path d="M3.2 7.5a4.3 4.3 0 1 0 1.4-3.2" strokeLinecap="round" />
      <path d="M2.5 2.9v2.6h2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
