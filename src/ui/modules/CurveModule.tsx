import { type BaseParams, CURVE_PRESETS, isStraight } from '../../engine/base'
import { ToneCurveEditor } from '../ToneCurveEditor'
import { Module } from '../controls'
import { WHOLE_STEP, type EditHistory } from '../history'
import { track } from '../../platform/usage'

interface Props {
  baseFx: BaseParams
  history: EditHistory
  setBase: (patch: Partial<BaseParams>) => void
  histogram: number[] | null
}

/** Curve: a tone curve, from a preset or drawn. */
export function CurveModule({ baseFx, history, setBase, histogram }: Props) {
  return (
    <Module
      id="curve"
      title="Curve"
      summary={isStraight(baseFx.curve) ? undefined : CURVE_PRESETS.find((p) => JSON.stringify(p.curve) === JSON.stringify(baseFx.curve))?.name ?? 'Custom'}
    >
      <div className="chips">
        {CURVE_PRESETS.map((p) => (
          <button
            key={p.name}
            title={p.hint}
            className={JSON.stringify(p.curve) === JSON.stringify(baseFx.curve) ? 'on' : ''}
            onClick={() => {
              track('curve', p.name)
              history.hint(`${WHOLE_STEP}the ${p.name.toLowerCase()} curve`)
              setBase({ curve: p.curve, curveOn: true })
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <ToneCurveEditor curve={baseFx.curve} histogram={histogram} onChange={(curve) => setBase({ curve })} />
    </Module>
  )
}
