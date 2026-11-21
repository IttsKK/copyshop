import { IN_DESKTOP_APP, isDesktop } from '../platform/desktop'
import { useEffect, useRef, useState } from 'react'
import type { BlendParams } from '../engine/types'
import type { GrainSource } from '../sources/GrainSource'
import type { OutputSettings } from '../storage/presets'
import { pickDirectory, supportsFolders, type Folder } from '../batch/fsAccess'
import { runBatch, type BatchItemResult } from '../batch/runBatch'
import { runReframe } from '../batch/reframe'
import { Disclosure } from './controls'
import { track } from '../platform/usage'

interface Props {
  source: GrainSource | null
  blend: BlendParams
  output: OutputSettings
  /** The export folder, offered as the folder to re-frame. */
  exportFolder: Folder | null
  keepBorderColour: boolean
  onKeepBorderColour: (keep: boolean) => void
  onStatus: (message: string) => void
  onError: (message: string) => void
}

export function BatchPanel({
  source,
  blend,
  output,
  exportFolder,
  keepBorderColour,
  onKeepBorderColour,
  onStatus,
  onError,
}: Props) {
  const [inputDir, setInputDir] = useState<Folder | null>(null)
  const [outputDir, setOutputDir] = useState<Folder | null>(null)
  // Re-exporting a folder: this look's border on each, and at what size.
  const [frameBorder, setFrameBorder] = useState(true)
  const [frameSize, setFrameSize] = useState<'keep' | 'original' | 'instagram'>('keep')
  const [reframeDir, setReframeDir] = useState<Folder | null>(null)
  const frameDir = reframeDir ?? exportFolder
  /** A passing note, e.g. how many unedited photos were skipped. */
  const [note, setNote] = useState<string | null>(null)
  useEffect(() => {
    if (!note) return
    const timer = setTimeout(() => setNote(null), 4000)
    return () => clearTimeout(timer)
  }, [note])
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null)
  const [results, setResults] = useState<BatchItemResult[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const supported = supportsFolders()

  const pick = async (which: 'in' | 'out') => {
    try {
      const handle = await pickDirectory(which === 'in' ? 'read' : 'readwrite', `grain-${which}`)
      which === 'in' ? setInputDir(handle) : setOutputDir(handle)
    } catch {
      /* picker dismissed */
    }
  }

  const start = async () => {
    if (!inputDir || !outputDir || !source) return
    if (await inputDir.isSame(outputDir)) {
      onError('Choose an output folder different from the input folder.')
      return
    }
    abortRef.current = new AbortController()
    setResults(null)
    setProgress({ done: 0, total: 0, current: '' })
    try {
      const res = await runBatch({
        inputDir,
        outputDir,
        source,
        blend,
        output,
        signal: abortRef.current.signal,
        onProgress: (done, total, current) => setProgress({ done, total, current }),
      })
      setResults(res)
      const failed = res.filter((r) => r.status === 'error').length
      track('export', output.format, 'batch', res.length - failed)
      onStatus(`Batch finished: ${res.length - failed} written${failed ? `, ${failed} failed` : ''}.`)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  const reframe = async () => {
    if (!frameDir) return
    abortRef.current = new AbortController()
    setResults(null)
    setNote(null)
    setProgress({ done: 0, total: 0, current: '' })
    try {
      const res = await runReframe({
        dir: frameDir,
        blend,
        keepColour: keepBorderColour,
        border: frameBorder,
        size: frameSize,
        signal: abortRef.current.signal,
        onProgress: (done, total, current) => setProgress({ done, total, current }),
      })
      setResults(res)
      const done = res.filter((r) => r.status === 'ok').length
      const failed = res.filter((r) => r.status === 'error').length
      const skipped = res.filter((r) => r.status === 'skipped').length
      onStatus(`Re-exported ${done} photo${done === 1 ? '' : 's'}${failed ? `, ${failed} couldn’t be` : ''}.`)
      if (skipped) setNote(`Skipped ${skipped} photo${skipped === 1 ? '' : 's'} not edited here.`)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setProgress(null)
      abortRef.current = null
    }
  }

  // In a browser it shows greyed, saying where it is.
  if (!supported || !isDesktop()) {
    return (
      <div className="mac-only" title={IN_DESKTOP_APP}>
        <span>Batch a folder</span>
        <small>{IN_DESKTOP_APP}</small>
      </div>
    )
  }

  return (
    <>
      {/* Progress outside both groups: it shows for either job, open or folded. */}
      {progress && (
        <div className="batch-progress">
          <progress value={progress.done} max={Math.max(progress.total, 1)} />
          <p className="muted status-line">
            {progress.done}/{progress.total} · {progress.current}
          </p>
          <button onClick={() => abortRef.current?.abort()}>Stop</button>
        </div>
      )}
      <Disclosure id="batch" title="Batch a folder" summary={inputDir ? inputDir.name : undefined}>
        <p className="muted">Applies the current settings to every JPEG and PNG in a folder.</p>
        <div className="field">
          <span>Input</span>
          <button className="path" onClick={() => pick('in')} title={inputDir?.name}>
            {inputDir ? inputDir.name : 'Choose folder…'}
          </button>
        </div>
        <div className="field">
          <span>Output</span>
          <button className="path" onClick={() => pick('out')} title={outputDir?.name}>
            {outputDir ? outputDir.name : 'Choose folder…'}
          </button>
        </div>
        {!progress && (
          <button className="primary" disabled={!inputDir || !outputDir || !source} onClick={start}>
            Run batch
          </button>
        )}
      </Disclosure>
      <Disclosure id="reframe" title="Re-export a folder" summary={frameDir ? frameDir.name : undefined}>
        <p className="muted">
          Renders photos you already exported again, each with its own edit — with this border and at the size you
          pick. Re-rendered from Originals/ and saved over the export.
        </p>
        <div className="field">
          <span>Folder</span>
          <button
            className="path"
            onClick={async () => {
              try {
                setReframeDir(await pickDirectory('readwrite', 'grain-export'))
              } catch {
                /* picker dismissed */
              }
            }}
            title={frameDir?.name}
          >
            {frameDir ? frameDir.name : 'Choose folder…'}
          </button>
        </div>
        <label className="check-row" title="Put this recipe's border on every export; off, each keeps the border it has">
          <input type="checkbox" checked={frameBorder} onChange={(e) => setFrameBorder(e.target.checked)} />
          Use this border
        </label>
        {frameBorder && (
          <label className="check-row" title="Each photo keeps the paper colour it was exported with">
            <input type="checkbox" checked={keepBorderColour} onChange={(e) => onKeepBorderColour(e.target.checked)} />
            Keep each photo’s colour
          </label>
        )}
        <div className="field valued">
          <span title="The size every export is rendered again at">Size</span>
          <div className="segmented">
            {(['keep', 'original', 'instagram'] as const).map((s) => (
              <button
                key={s}
                className={frameSize === s ? 'on' : ''}
                title={s === 'keep' ? 'Each at the size it was exported at' : s === 'original' ? "All at the photo's own size" : 'All at Instagram size (1080 wide)'}
                onClick={() => setFrameSize(s)}
              >
                {s === 'keep' ? 'As exported' : s === 'original' ? 'Original' : 'Instagram'}
              </button>
            ))}
          </div>
        </div>
        {!progress && (
          <button disabled={!frameDir} onClick={reframe}>
            Re-export all
          </button>
        )}
      </Disclosure>
      {results && results.some((r) => r.status === 'error') && (
        <ul className="errors">
          {results
            .filter((r) => r.status === 'error')
            .map((r) => (
              <li key={r.filename}>
                {r.filename}: {r.message}
              </li>
            ))}
        </ul>
      )}
    </>
  )
}
