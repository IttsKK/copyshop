import type { ReactNode } from 'react'

/**
 * A small picture of what each module does, in its category's colour: dots
 * for grain, a curve for tone, three colours for colour. Drawn on a 16 px
 * grid; `c` is the category tint.
 */
const GLYPHS: Record<string, (c: string) => ReactNode> = {
  look: (c) => (
    <>
      <circle cx="5.5" cy="6" r="3.6" fill={c} opacity="0.55" />
      <circle cx="10.5" cy="6" r="3.6" fill={c} opacity="0.8" />
      <circle cx="8" cy="10.5" r="3.6" fill={c} />
    </>
  ),
  lens: (c) => (
    <>
      <circle cx="8" cy="8" r="6.3" fill="none" stroke={c} strokeWidth="1.6" />
      <circle cx="8" cy="8" r="3.4" fill={c} opacity="0.35" />
      <path d="M5.6 5.4 A3.4 3.4 0 0 1 9.4 4.9" stroke={c} strokeWidth="1.3" fill="none" strokeLinecap="round" />
    </>
  ),
  prism: (c) => (
    <>
      <path d="M8 2.2 L13.6 12.6 H2.4 Z" fill="none" stroke={c} strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M0.8 7.6 L6 8.4" stroke={c} strokeWidth="1.3" strokeLinecap="round" />
      <path d="M10 8.2 L15.2 6.2" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity="0.9" />
      <path d="M10.2 9 L15.4 9.2" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
      <path d="M10.4 9.8 L15.2 12" stroke={c} strokeWidth="1.2" strokeLinecap="round" opacity="0.35" />
    </>
  ),
  crop: (c) => (
    <>
      <path d="M4.5 1.5v10h10" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 4.5h10v10" stroke={c} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </>
  ),
  double: (c) => (
    <>
      <circle cx="6" cy="8" r="4.6" fill={c} opacity="0.45" />
      <circle cx="10" cy="8" r="4.6" fill={c} opacity="0.75" />
    </>
  ),
  stamp: () => (
    <>
      <path d="M2 11h3M6 11h3M10 11h4" stroke="#ff8a2a" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M2.5 5v4M8 5v4M12.5 5v4" stroke="#ff8a2a" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
    </>
  ),
  mono: () => (
    <>
      <circle cx="8" cy="8" r="6.2" fill="#e9e9e9" />
      <path d="M8 1.8 A6.2 6.2 0 0 1 8 14.2 Z" fill="#3a3a3a" />
    </>
  ),
  halftone: (c) => (
    <>
      {[0, 1, 2].flatMap((row) =>
        [0, 1, 2].map((col) => <circle key={`${row}${col}`} cx={3 + col * 5} cy={3 + row * 5} r={0.8 + (row + col) * 0.45} fill={c} />),
      )}
    </>
  ),
  exposure: (c) => (
    <>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={c} strokeWidth="1.6" />
      <path d="M8 1.8 A6.2 6.2 0 0 0 8 14.2 Z" fill={c} opacity="0.45" />
      <path d="M5.5 8h5M8 5.5v5" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  balance: (c) => (
    <>
      <circle cx="5.2" cy="8" r="3.6" fill="#7aa7e6" opacity="0.9" />
      <circle cx="10.8" cy="8" r="3.6" fill="#f0b46a" opacity="0.9" />
      <path d="M8 3v10" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  curve: (c) => (
    <>
      <rect x="1.5" y="1.5" width="13" height="13" rx="2" fill="none" stroke={c} strokeWidth="1.2" opacity="0.5" />
      <path d="M2.5 13.5 C6 13 6 3 13.5 2.5" stroke={c} strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </>
  ),
  tone: (c) => (
    <>
      <path d="M2 14 C6 14 7 3 14 2" stroke={c} strokeWidth="2" fill="none" strokeLinecap="round" />
      <circle cx="2" cy="14" r="1.4" fill={c} />
      <circle cx="14" cy="2" r="1.4" fill={c} />
    </>
  ),
  colour: () => (
    <>
      <circle cx="5.6" cy="6" r="3.8" fill="#6f7fe0" />
      <circle cx="10.4" cy="6" r="3.8" fill="#e46f8f" opacity="0.92" />
      <circle cx="8" cy="10.4" r="3.8" fill="#f6c36d" opacity="0.92" />
    </>
  ),
  light: (c) => (
    <>
      <circle cx="8" cy="8" r="7" fill={c} opacity="0.22" />
      <circle cx="8" cy="8" r="4.6" fill={c} opacity="0.4" />
      <circle cx="8" cy="8" r="2.6" fill={c} />
    </>
  ),
  edges: (c) => (
    <>
      <path d="M2 13 L7 4 L11 10 L14 6" stroke={c} strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13 L7 4 L11 10 L14 6" stroke={c} strokeWidth="5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.25" />
    </>
  ),
  solarize: (c) => (
    <>
      <circle cx="8" cy="8" r="6.2" fill="none" stroke={c} strokeWidth="1.6" />
      <path d="M8 1.8 A6.2 6.2 0 0 1 8 14.2 Z" fill={c} />
      <circle cx="8" cy="8" r="2.2" fill={c} opacity="0.35" />
    </>
  ),
  leaks: (c) => (
    <>
      <path d="M16 0 L16 15 Q4 12 1 0Z" fill={c} opacity="0.3" />
      <path d="M16 0 L16 9 Q9 8 7 0Z" fill={c} />
    </>
  ),
  grain: (c) => (
    <>
      {[
        [3, 3, 1.3], [8, 2.5, 0.9], [13, 4, 1.2], [5, 7.5, 1], [10.5, 8, 1.4], [2.5, 12, 0.9], [7, 12.5, 1.3], [12.5, 13, 1], [14, 8.5, 0.8],
      ].map(([x, y, r], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill={c} />
      ))}
    </>
  ),
  dither: (c) => (
    <>
      {[0, 1, 2, 3].flatMap((row) =>
        [0, 1, 2, 3].map((col) => {
          const keep = (row + col) % 2 === 0 || row > 2 - col / 2
          return keep ? <rect key={`${row}${col}`} x={1 + col * 3.6} y={1 + row * 3.6} width="2.6" height="2.6" rx="0.6" fill={c} opacity={0.35 + row * 0.2} /> : null
        }),
      )}
    </>
  ),
  pixel: (c) => (
    <>
      <rect x="1" y="1" width="6.5" height="6.5" rx="1.5" fill={c} />
      <rect x="8.5" y="1" width="6.5" height="6.5" rx="1.5" fill={c} opacity="0.45" />
      <rect x="1" y="8.5" width="6.5" height="6.5" rx="1.5" fill={c} opacity="0.65" />
      <rect x="8.5" y="8.5" width="6.5" height="6.5" rx="1.5" fill={c} opacity="0.9" />
    </>
  ),
  streaks: (c) => (
    <>
      {[3, 6.5, 10, 13.5].map((y, i) => (
        <line key={y} x1={2 + i * 1.5} y1={y} x2={15} y2={y} stroke={c} strokeWidth="1.8" strokeLinecap="round" opacity={0.45 + i * 0.18} />
      ))}
      <circle cx="3" cy="8" r="2.4" fill={c} />
    </>
  ),
  glass: (c) => (
    <>
      {[1, 5, 9, 13].map((x) => (
        <rect key={x} x={x} y="1" width="3" height="14" rx="1.5" fill={c} opacity={x % 8 === 1 ? 0.9 : 0.5} />
      ))}
    </>
  ),
  collage: (c) => (
    <>
      <path d="M2 4 L9 2 L10 9 L3 11Z" fill={c} opacity="0.55" />
      <path d="M7 7 L14 6 L14.5 14 L7.5 14.5Z" fill={c} />
    </>
  ),
  lighting: (c) => (
    <>
      <path d="M2.5 13.5 L7 3 L13.5 13.5 Z" fill={c} opacity="0.35" />
      <circle cx="7" cy="3.2" r="2.2" fill={c} />
    </>
  ),
  repeat: (c) => (
    <>
      <rect x="2" y="9" width="5.5" height="5.5" rx="1.2" fill={c} />
      <rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1.2" fill={c} opacity="0.6" />
      <rect x="8.5" y="1.5" width="5.5" height="5.5" rx="1.2" fill={c} opacity="0.35" />
    </>
  ),
  border: (c) => <rect x="2" y="2" width="12" height="12" rx="2.5" fill="none" stroke={c} strokeWidth="2.6" />,
  dust: (c) => (
    <>
      <path d="M2 4 Q6 7 9 4 T15 6" stroke={c} strokeWidth="1.3" fill="none" strokeLinecap="round" />
      <circle cx="4" cy="11" r="1.4" fill={c} />
      <circle cx="11" cy="12" r="1" fill={c} />
      <circle cx="13.5" cy="9.5" r="0.8" fill={c} />
    </>
  ),
  surge: (c) => (
    <>
      <rect x="2" y="1" width="3.5" height="14" rx="1.75" fill={c} opacity="0.35" />
      <rect x="7" y="1" width="3.5" height="14" rx="1.75" fill={c} />
      <rect x="12" y="1" width="2.5" height="14" rx="1.25" fill={c} opacity="0.6" />
    </>
  ),
  export: (c) => (
    <>
      <path d="M8 2 V10 M4.5 6.5 L8 10 L11.5 6.5" stroke={c} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.5 11 V13.5 H13.5 V11" stroke={c} strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
}

export function ModuleGlyph({ id, tint, size = 16 }: { id: string; tint: string; size?: number }) {
  const draw = GLYPHS[id]
  return (
    <span className="glyph" style={{ ['--tint' as string]: tint }} aria-hidden>
      <svg width={size} height={size} viewBox="0 0 16 16">
        {draw ? draw(tint) : <rect x="3" y="3" width="10" height="10" rx="3" fill={tint} />}
      </svg>
    </span>
  )
}
