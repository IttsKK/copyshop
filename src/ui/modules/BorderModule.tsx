import { useState, type CSSProperties } from 'react'
import type { Palette } from '../../engine/palette'
import type { BlendParams, BorderParams, EdgeKind, PaperKind, Rgb } from '../../engine/types'
import { BORDER_STYLES, borderStyleOf, type BorderStyle } from '../borderStyles'
import { ColourField } from '../ColourField'
import { Disclosure, Module, ModuleActions, Shuffle, Slider } from '../controls'
import { FACTORY } from '../moduleCatalog'
import { sameBorder, useSavedBorders } from '../savedBorders'
import type { StoredPart } from '../../storage/parts'
import { track } from '../../platform/usage'

/** How the photo's edge meets the paper (BorderParams.edge); Clean is a straight cut (no wander). */
const EDGES: [EdgeKind | 'clean', string, string][] = [
  ['clean', 'Clean', 'A straight digital edge'],
  ['printed', 'Printed', "An enlarger easel's edge: a slight wander"],
  ['torn', 'Torn', 'Torn paper: ragged bites'],
  ['brush', 'Brush', 'Brushed-on emulsion: bristle strokes past the edge'],
  ['film', 'Film', "The negative's black edge round the photo, filed rough"],
  ['deckle', 'Deckle', 'Small scallops, as old prints were cut'],
]
/** Wander each starts with, from a clean cut. */
const EDGE_START: Record<EdgeKind, number> = { printed: 0.35, torn: 0.6, brush: 0.5, film: 0.4, deckle: 0.45 }

/** The paper's surfaces (BorderParams.paper), as the engine draws them. */
const SURFACES: [PaperKind, string, string][] = [
  ['paper', 'Paper', 'Print paper: fine tooth and a soft mottle'],
  ['smooth', 'Smooth', 'A glossy print: almost no texture'],
  ['canvas', 'Canvas', 'Woven threads, over and under'],
  ['linen', 'Linen', 'Fine threads both ways, with thicker slubs'],
  ['watercolour', 'Watercolour', 'Cold-press: soft hills and pooled colour'],
  ['fibre', 'Fibre', 'Card with short fibres and dark specks'],
]

const PAPERS: { name: string; colour: [number, number, number] }[] = [
  { name: 'Warm white', colour: [0.94, 0.925, 0.895] },
  { name: 'Neutral white', colour: [0.955, 0.955, 0.955] },
  { name: 'Cream', colour: [0.93, 0.9, 0.82] },
  { name: 'Black', colour: [0.07, 0.07, 0.075] },
]

interface Props {
  blend: BlendParams
  setBorder: (patch: Partial<BorderParams>, step?: string) => void
  palette: Palette
  papers: { label: string; colour: Rgb }[] | null
  /** Use one of your saved borders, as its ⋯ menu would. */
  onApplyPart?: (part: StoredPart) => void
}

const css = (c: readonly number[]) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const deg = (v: number) => `${Math.round(v)}°`
/** A direction as words: where the light or the gradient goes. */
const towards = (v: number) =>
  ['right', 'lower right', 'down', 'lower left', 'left', 'upper left', 'up', 'upper right'][Math.round((((v % 360) + 360) % 360) / 45) % 8]
/** The same as an arrow, short enough for the value column (the words are in the tooltip). */
const arrow = (v: number) => ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'][Math.round((((v % 360) + 360) % 360) / 45) % 8]

/** A style drawn small: its paper, and the photo on it with its corners, shadow, bevel and line. */
function BorderSwatch({ s }: { s: BorderStyle['patch'] }) {
  const k = 3.2 // the swatch's short side is about 32px; widths are fractions of the photo's
  const pad = Math.max(2, Math.round(s.width * 32 * k * 0.55))
  const paper =
    s.fill === 'linear'
      ? `linear-gradient(${(s.fillAngle ?? 90) + 90}deg, ${css(s.colour)}, ${css(s.colour2 ?? s.colour)})`
      : s.fill === 'radial'
        ? `radial-gradient(circle, ${css(s.colour)}, ${css(s.colour2 ?? s.colour)})`
        : css(s.colour)
  const photo: CSSProperties = {
    inset: `${pad}px ${pad}px ${pad + Math.round((s.bottomExtra ?? 0) * 32 * 0.9)}px ${pad}px`,
    borderRadius: (s.corner ?? 0) > 0 ? Math.max(1.5, (s.corner ?? 0) * 32 * k) : 0,
    boxShadow:
      [
        (s.shadow ?? 0) > 0
          ? `${Math.cos(((s.shadowAngle ?? 60) * Math.PI) / 180) * 1.5}px ${Math.sin(((s.shadowAngle ?? 60) * Math.PI) / 180) * 1.5}px 3px rgba(0,0,0,${(s.shadow ?? 0) * 0.8})`
          : '',
        (s.bevel ?? 0) > 0 ? '0 0 0 1.5px rgba(255,255,255,0.85)' : '',
        (s.line ?? 0) > 0
          ? `0 0 0 ${1 + Math.round((s.lineGap ?? 0) * 32 * k * 0.5)}px ${css(s.colour)}, 0 0 0 ${2 + Math.round((s.lineGap ?? 0) * 32 * k * 0.5)}px ${css(s.lineColour ?? [0.1, 0.1, 0.1])}`
          : '',
        (s.inset ?? 0) > 0 ? 'inset 0 0 3px rgba(0,0,0,0.45)' : '',
      ]
        .filter(Boolean)
        .join(', ') || undefined,
  }
  return (
    <span className={`border-swatch${s.irregularity > 0.5 ? ' rough' : ''}`} style={{ background: paper }} aria-hidden>
      <i style={photo} />
    </span>
  )
}

/**
 * Border: the paper round the picture. A row of ready-made ones to start
 * from (a darkroom print, a mat, clean digital white, a gradient...), then
 * everything they set, in groups: the paper, the edge, its depth, a line.
 */
/** A gradient's other end for paper of this colour: clearly darker, or lighter if it's already dark. */
function secondColour(c: [number, number, number]): [number, number, number] {
  const light = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] > 0.5
  return c.map((v) => (light ? v * 0.62 : v + (1 - v) * 0.45)) as [number, number, number]
}

const DIRECTIONS = [270, 315, 0, 45, 90, 135, 180, 225] // up, upper right, right, ... as the arrows go round

/**
 * A gradient paper: the gradient itself, its two ends to click (the colour
 * row under it sets the one chosen), a swap, and for a straight gradient
 * which way it runs, as eight arrows.
 */
function GradientControls({
  b,
  fill,
  setBorder,
  palette,
  swatches,
}: {
  b: BorderParams
  fill: 'linear' | 'radial'
  setBorder: (patch: Partial<BorderParams>, step?: string) => void
  palette: Palette
  swatches: { label: string; colour: Rgb }[]
}) {
  const [end, setEnd] = useState<'from' | 'to'>('from')
  const c1 = b.colour
  const c2 = b.colour2 ?? b.colour
  const angle = b.fillAngle ?? 90
  const names = fill === 'radial' ? (['Middle', 'Edges'] as const) : (['From', 'To'] as const)
  const bar = fill === 'radial' ? `radial-gradient(circle at 0% 50%, ${css(c1)}, ${css(c2)} 100%)` : `linear-gradient(90deg, ${css(c1)}, ${css(c2)})`
  return (
    <>
      <div className="field valued border-gradient">
        <span>Colours</span>
        <div className="border-gradient-row">
          <button
            className={`border-gradient-end${end === 'from' ? ' on' : ''}`}
            title={`${names[0]}: choose it to set its colour below`}
            aria-pressed={end === 'from'}
            onClick={() => setEnd('from')}
          >
            <i style={{ background: css(c1) }} />
          </button>
          <span className="border-gradient-bar" style={{ background: bar }} aria-hidden />
          <button
            className={`border-gradient-end${end === 'to' ? ' on' : ''}`}
            title={`${names[1]}: choose it to set its colour below`}
            aria-pressed={end === 'to'}
            onClick={() => setEnd('to')}
          >
            <i style={{ background: css(c2) }} />
          </button>
          <button className="border-gradient-swap" title="Swap the two colours" aria-label="Swap the two colours" onClick={() => setBorder({ colour: c2, colour2: c1 })}>
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <path d="M2.5 5.5h10M10 3l2.5 2.5L10 8M13.5 10.5h-10M6 8l-2.5 2.5L6 13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
      <ColourField
        label={end === 'from' ? names[0] : names[1]}
        title={`The gradient's ${end === 'from' ? names[0].toLowerCase() : names[1].toLowerCase()} colour. The first colours are taken from the finished picture.`}
        value={{ source: 'manual', colour: end === 'from' ? c1 : c2 }}
        palette={palette}
        photoSources={false}
        swatches={swatches}
        onChange={(c) => setBorder(end === 'from' ? { colour: [...c.colour] as Rgb } : { colour2: [...c.colour] as Rgb })}
      />
      {fill === 'linear' && (
        <div className="field valued">
          <span title={`Which way the gradient runs, from ${names[0]} to ${names[1]}: now ${towards(angle)}`}>Direction</span>
          <div className="border-directions" role="radiogroup" aria-label="Direction">
            {DIRECTIONS.map((d) => {
              const on = Math.round((((angle % 360) + 360) % 360) / 45) % 8 === Math.round(d / 45) % 8
              return (
                <button key={d} role="radio" aria-checked={on} className={on ? 'on' : ''} title={`Runs ${towards(d)}`} onClick={() => setBorder({ fillAngle: d })}>
                  {arrow(d)}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}

export function BorderModule({ blend, setBorder, palette, papers, onApplyPart }: Props) {
  const b = blend.border
  const saved = useSavedBorders()
  const mine = saved.find((s) => sameBorder(s.border, b))
  const current = mine ? null : borderStyleOf(b)
  const fill = b.fill ?? 'solid'
  const shadow = b.shadow ?? 0
  const bevel = b.bevel ?? 0
  const line = b.line ?? 0
  const swatches = [
    ...(papers ?? []),
    ...PAPERS.filter((p) => !papers || p.name === 'Black' || p.name === 'Warm white').map((p) => ({ label: p.name, colour: p.colour })),
  ]
  return (
    <Module
      id="border"
      title="Border"
      summary={b.width > 0 || b.bottomExtra > 0 ? `${mine?.part.name ?? BORDER_STYLES.find((s) => s.id === current)?.name ?? 'Own'} · ${(b.width * 100).toFixed(1)}%` : 'None'}
    >
      <div className="border-styles" role="radiogroup" aria-label="Border style">
        {/* Yours first: the borders you saved from the ⋯ menu. */}
        {onApplyPart &&
          saved.map((s) => (
            <button
              key={s.part.id}
              role="radio"
              aria-checked={mine?.part.id === s.part.id}
              className={`border-style mine${mine?.part.id === s.part.id ? ' on' : ''}`}
              title={`Your saved border “${s.part.name}”`}
              onClick={() => {
                track('border_style', 'own')
                onApplyPart(s.part)
              }}
            >
              <BorderSwatch s={s.border} />
              <span>{s.part.name}</span>
            </button>
          ))}
        {BORDER_STYLES.map((s) => (
          <button
            key={s.id}
            role="radio"
            aria-checked={current === s.id}
            className={`border-style${current === s.id ? ' on' : ''}`}
            title={s.hint}
            onClick={() => {
              track('border_style', s.id)
              setBorder(s.patch, `the ${s.name} border`)
            }}
          >
            <BorderSwatch s={s.patch} />
            <span>{s.name}</span>
          </button>
        ))}
      </div>

      <Slider label="Width" value={b.width} def={FACTORY.border.width} min={0} max={0.2} step={0.005} format={pct} onChange={(width) => setBorder({ width })} />
      <Slider
        label="Bottom"
        title="Extra paper at the bottom, the way a print is signed"
        value={b.bottomExtra}
        def={FACTORY.border.bottomExtra}
        min={0}
        max={0.35}
        step={0.005}
        format={pct}
        onChange={(bottomExtra) => setBorder({ bottomExtra })}
      />

      <div className="field valued">
        <span>Paper</span>
        <div className="segmented">
          {(
            [
              ['solid', 'Flat', 'One colour'],
              ['linear', 'Gradient', 'From one colour to another across the print'],
              ['radial', 'Radial', 'From one colour in the middle to another at the edges'],
            ] as const
          ).map(([id, label, hint]) => (
            <button
              key={id}
              title={hint}
              className={fill === id ? 'on' : ''}
              onClick={() =>
                setBorder({
                  fill: id,
                  // A second colour that shows: the paper's own, darker (or lighter, on dark paper), when there's no other yet.
                  ...(id !== 'solid' && (!b.colour2 || b.colour2.every((v, k) => Math.abs(v - b.colour[k]) < 0.02)) ? { colour2: secondColour(b.colour) } : {}),
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {fill === 'solid' ? (
        <ColourField
          label="Colour"
          title="The paper's colour. The first colours are taken from the finished picture: its ink, shade, midtone, light and accent."
          value={{ source: 'manual', colour: b.colour }}
          palette={palette}
          photoSources={false}
          swatches={swatches}
          onChange={(c) => setBorder({ colour: [...c.colour] as [number, number, number] })}
        />
      ) : (
        <GradientControls b={b} fill={fill} setBorder={setBorder} palette={palette} swatches={swatches} />
      )}

      <div className="field border-surfaces">
        <span title="How the photo's edge meets the paper">Edge</span>
        <div className="chips" role="radiogroup" aria-label="Photo edge">
          {EDGES.map(([id, label, hint]) => {
            const on = id === 'clean' ? b.irregularity === 0 && (b.edge ?? 'printed') === 'printed' : b.irregularity > 0 && (b.edge ?? 'printed') === id
            return (
              <button
                key={id}
                role="radio"
                aria-checked={on}
                className={on ? 'on' : ''}
                title={hint}
                onClick={() => {
                  track('border_edge', id)
                  // Clean is a straight cut; the others need some wander to show.
                  setBorder(id === 'clean' ? { edge: 'printed', irregularity: 0 } : { edge: id, ...(b.irregularity < 0.15 ? { irregularity: EDGE_START[id] } : {}) })
                }}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="field border-surfaces">
        <span title="What the paper is made of: its texture">Surface</span>
        <div className="chips" role="radiogroup" aria-label="Paper surface">
          {SURFACES.map(([id, label, hint]) => (
            <button
              key={id}
              role="radio"
              aria-checked={(b.paper ?? 'paper') === id}
              className={(b.paper ?? 'paper') === id ? 'on' : ''}
              title={hint}
              onClick={() => {
                track('border_surface', id)
                // Choosing one shows it: a texture turned all the way down comes back up.
                setBorder({ paper: id, ...(b.texture < 0.2 && id !== 'smooth' ? { texture: 0.6 } : {}) })
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <Slider
        label="Texture"
        title="How strongly the surface shows"
        value={b.texture}
        def={FACTORY.border.texture}
        min={0}
        max={1}
        step={0.01}
        onChange={(texture) => setBorder({ texture })}
      />

      <Disclosure
        id="border-edge"
        title="Corners and roughness"
        summary={[(b.corner ?? 0) > 0 ? 'Rounded' : 'Square', b.irregularity > 0 ? `rough ${Math.round(b.irregularity * 100)}` : 'straight'].join(', ')}
      >
        <Slider
          label="Corners"
          title="Round the photo's corners"
          value={b.corner ?? 0}
          def={0}
          min={0}
          max={0.1}
          step={0.001}
          format={(v) => (v > 0 ? pct(v) : 'Square')}
          onChange={(corner) => setBorder({ corner })}
        />
        <Slider
          label="Rough"
          title="How uneven the cut between picture and paper is: 0 is a clean digital edge"
          value={b.irregularity}
          def={FACTORY.border.irregularity}
          min={0}
          max={1}
          step={0.01}
          onChange={(irregularity) => setBorder({ irregularity })}
        />
        <Slider
          label="Grain"
          title="Grain on the paper, as a multiple of Strength"
          value={b.grain}
          def={FACTORY.border.grain}
          min={0}
          max={2}
          step={0.01}
          onChange={(grain) => setBorder({ grain })}
        />
      </Disclosure>

      <Disclosure
        id="border-depth"
        title="Shadow and depth"
        summary={[shadow > 0 && 'Shadow', bevel > 0 && 'Bevel', (b.inset ?? 0) > 0 && 'Set in'].filter(Boolean).join(', ') || 'Flat'}
      >
        <Slider
          label="Shadow"
          title="The photo lifted off the paper, its shadow under it"
          value={shadow}
          def={0}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (v > 0 ? `${Math.round(v * 100)}` : 'Off')}
          onChange={(shadow) => setBorder({ shadow })}
        />
        <Slider
          idle={shadow === 0 && 'Turn up Shadow first'}
          label="Softness"
          value={b.shadowSize ?? 0.02}
          def={0.02}
          min={0.002}
          max={0.12}
          step={0.001}
          format={pct}
          onChange={(shadowSize) => setBorder({ shadowSize })}
        />
        <Slider
          idle={shadow === 0 && 'Turn up Shadow first'}
          label="Distance"
          title="How far the shadow falls from the photo"
          value={b.shadowDistance ?? 0.008}
          def={0.008}
          min={0}
          max={0.06}
          step={0.001}
          format={pct}
          onChange={(shadowDistance) => setBorder({ shadowDistance })}
        />
        <Slider
          idle={shadow === 0 && 'Turn up Shadow first'}
          label="Falls"
          title={`Which way the shadow falls: now ${towards(b.shadowAngle ?? 60)}`}
          value={b.shadowAngle ?? 60}
          def={60}
          min={0}
          max={359}
          step={1}
          format={(v) => `${arrow(v)} ${deg(v)}`}
          onChange={(shadowAngle) => setBorder({ shadowAngle })}
        />
        <Slider
          label="Bevel"
          title="A mat's bevelled cut round the photo, its white core catching the light"
          value={bevel}
          def={0}
          min={0}
          max={0.02}
          step={0.0005}
          format={(v) => (v > 0 ? pct(v) : 'Off')}
          onChange={(bevel) => setBorder({ bevel })}
        />
        <Slider
          idle={bevel === 0 && 'Turn up Bevel first'}
          label="Light"
          title="How strongly the light catches the bevel"
          value={b.bevelLight ?? 0.6}
          def={0.6}
          min={0}
          max={1}
          step={0.01}
          onChange={(bevelLight) => setBorder({ bevelLight })}
        />
        <Slider
          label="Set in"
          title="The photo set into the paper: shade along its inside edge"
          value={b.inset ?? 0}
          def={0}
          min={0}
          max={1}
          step={0.01}
          format={(v) => (v > 0 ? `${Math.round(v * 100)}` : 'Off')}
          onChange={(inset) => setBorder({ inset })}
        />
      </Disclosure>

      <Disclosure id="border-line" title="Line" summary={line > 0 ? pct(line) : 'None'}>
        <Slider
          label="Width"
          title="A thin line round the photo"
          value={line}
          def={0}
          min={0}
          max={0.015}
          step={0.0005}
          format={(v) => (v > 0 ? pct(v) : 'Off')}
          onChange={(line) => setBorder({ line })}
        />
        <Slider
          idle={line === 0 && 'Give the line a width first'}
          label="Gap"
          title="Space between the photo and the line"
          value={b.lineGap ?? 0}
          def={0}
          min={0}
          max={0.06}
          step={0.0005}
          format={pct}
          onChange={(lineGap) => setBorder({ lineGap })}
        />
        <div className={line === 0 ? 'is-idle-block' : undefined} title={line === 0 ? 'Give the line a width first' : undefined}>
          <ColourField
            label="Colour"
            title="The line's colour"
            value={{
              source: 'manual',
              colour: b.lineColour ?? [0.1, 0.1, 0.1],
            }}
            palette={palette}
            photoSources={false}
            swatches={[{ label: 'Black', colour: [0.08, 0.08, 0.09] }, { label: 'White', colour: [0.97, 0.97, 0.96] }, ...(papers ?? []).slice(0, 2)]}
            onChange={(c) =>
              setBorder({
                lineColour: [...c.colour] as [number, number, number],
              })
            }
          />
        </div>
      </Disclosure>

      <ModuleActions>
        <Shuffle what="paper edge and texture" onShuffle={() => setBorder({ seed: Math.floor(Math.random() * 2 ** 31) })} />
      </ModuleActions>
    </Module>
  )
}
