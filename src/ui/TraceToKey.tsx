import { useState } from 'react'
import type { Point } from '../engine/leaks'
import { Slider } from './controls'
import type { TraceKey } from './traceKey'

/** Traces an outline to a key, or null when there is no photo (or the key picks nothing there). */
export type TraceOutline = (outline: Point[], key: TraceKey, points: number) => Point[] | null

interface Props {
  outline: Point[]
  keyed: TraceKey
  trace?: TraceOutline
  /** The traced outline, with the key switched off: the outline is the key's edge now. */
  onTrace: (outline: Point[]) => void
}

/**
 * The key made into the outline: the shape's points moved onto the edge of
 * what the key picks inside it, as many as Points allows. The key is then
 * switched off, so the shape is that edge wherever it goes: trace a sign's
 * glyph, then scale it up into the sky.
 */
export function TraceToKey({ outline, keyed, trace, onTrace }: Props) {
  const [points, setPoints] = useState(60)
  const [missed, setMissed] = useState(false)
  return (
    <>
      <Slider
        label="Points"
        title="How many points the traced outline gets: more follow the edge more closely, fewer are easier to move by hand"
        value={points}
        min={8}
        max={300}
        step={1}
        format={(v) => `${Math.round(v)}`}
        onChange={(v) => setPoints(Math.round(v))}
      />
      <div className="row">
        <button
          disabled={!trace}
          title="Move the outline's points onto the edge of what the key picks inside it, then switch the key off: the shape becomes that edge, and stays it when scaled or moved"
          onClick={() => {
            const traced = trace?.(outline, keyed, points)
            setMissed(!traced)
            if (traced) onTrace(traced)
          }}
        >
          Trace outline to key
        </button>
      </div>
      {missed && <p className="hint-line">Nothing picked: move the Level</p>}
    </>
  )
}
