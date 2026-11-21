import type { ReactNode } from 'react'
import type { CategoryId } from './moduleCatalog'

export type IconTab = 'active' | CategoryId

/** A small line icon for each tab on the rail beside the modules, drawn on a 16 px grid in currentColor. */
const ICONS: Record<IconTab, ReactNode> = {
  // On this photo: the layers it is built from.
  active: (
    <>
      <path d="M8 2.2 L14 5.3 L8 8.4 L2 5.3 Z" fill="currentColor" />
      <path d="M2.3 8.2 L8 11.1 L13.7 8.2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2.3 10.9 L8 13.8 L13.7 10.9" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" opacity="0.6" />
    </>
  ),
  // The base photo: sliders.
  base: (
    <>
      <path d="M2 5h12M2 11h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="10.5" cy="5" r="2" fill="var(--panel, #1c1d21)" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="5.5" cy="11" r="2" fill="var(--panel, #1c1d21)" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  // The camera: a body and its lens.
  camera: (
    <>
      <rect x="1.5" y="4.5" width="13" height="9" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 4.5 L6.2 2.8 H9.8 L11 4.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="8" cy="9" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </>
  ),
  // Colour & tone: three colours overlapping.
  colour: (
    <>
      <circle cx="5.7" cy="6" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="10.3" cy="6" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="10.2" r="3.4" fill="none" stroke="currentColor" strokeWidth="1.3" />
    </>
  ),
  // Light: a sun.
  light: (
    <>
      <circle cx="8" cy="8" r="3" fill="currentColor" />
      {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
        <path
          key={a}
          d={`M${8 + Math.cos((a * Math.PI) / 180) * 5} ${8 + Math.sin((a * Math.PI) / 180) * 5} L${8 + Math.cos((a * Math.PI) / 180) * 6.6} ${8 + Math.sin((a * Math.PI) / 180) * 6.6}`}
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
      ))}
    </>
  ),
  // Film & texture: a strip of film.
  texture: (
    <>
      <rect x="2.5" y="1.5" width="11" height="13" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="5" y="5" width="6" height="6" rx="0.8" fill="currentColor" fillOpacity="0.5" />
      {[3.4, 7.4, 11.4].map((y) => (
        <g key={y}>
          <rect x="3.3" y={y} width="1" height="1.4" fill="currentColor" />
          <rect x="11.7" y={y} width="1" height="1.4" fill="currentColor" />
        </g>
      ))}
    </>
  ),
  // Shapes & collage: a square and a circle laid over each other.
  shapes: (
    <>
      <rect x="2" y="2" width="7.5" height="7.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="10.5" cy="10.5" r="3.6" fill="currentColor" fillOpacity="0.55" />
    </>
  ),
  // Print: a print on its paper.
  print: (
    <>
      <rect x="2" y="1.5" width="12" height="13" rx="1" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <rect x="4.5" y="4" width="7" height="6" fill="currentColor" fillOpacity="0.55" />
    </>
  ),
}

export function CategoryIcon({ tab, size = 16 }: { tab: IconTab; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
      {ICONS[tab]}
    </svg>
  )
}
