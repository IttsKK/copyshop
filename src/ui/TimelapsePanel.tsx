import { keyWords } from '../platform/os'
import { useEffect, useState } from 'react'
import { ModuleSwitch } from './controls'
import { canMakeVideo, describeRecording, type TimelapseFrame, type TimelapseRecorder, type TimelapseSettings } from './timelapse'
import { deleteTake, listTakes, loadTake, type TimelapseMeta } from '../storage/timelapses'

interface Props {
  settings: TimelapseSettings
  onSettings: (next: TimelapseSettings) => void
  recorder: TimelapseRecorder
  hasImage: boolean
  playing: boolean
  /** 0..1 while a video is being made, else null. */
  making: number | null
  onPlay: (frames: TimelapseFrame[], seconds: number) => void
  onStop: () => void
  onVideo: (frames: TimelapseFrame[], opts: { seconds: number; shape: 'reel' | 'photo'; fromOriginal: boolean }) => void
  onCancelVideo: () => void
  onStatus: (message: string) => void
  onError: (message: string) => void
}

const LENGTHS = [15, 30, 60] as const

const when = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const span = (ms: number) => (ms < 60000 ? `${Math.max(1, Math.round(ms / 1000))} s` : `${Math.round(ms / 60000)} min`)

/**
 * The timelapse, in Settings: off until turned on. Then every time a photo
 * is open is a take, recorded as you edit and kept on disk. Pick one (or all
 * of them, one after another) to play back in the window, to screen record,
 * or to make into a video of the photo changing, sped up to a reel's length.
 * A video can also be made with every export.
 */
export function TimelapsePanel({ settings, onSettings, recorder, hasImage, playing, making, onPlay, onStop, onVideo, onCancelVideo, onStatus, onError }: Props) {
  const { seconds, shape, fromOriginal } = settings
  const set = (patch: Partial<TimelapseSettings>) => onSettings({ ...settings, ...patch })
  const [videoOk, setVideoOk] = useState<boolean | null>(null)
  const [takes, setTakes] = useState<TimelapseMeta[]>([])
  /** 'current', a take's id, or 'all'. */
  const [pick, setPick] = useState('current')
  const [busy, setBusy] = useState(false)
  // The live take moves with every edit; look again now and then rather than on each.
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1500)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    void canMakeVideo().then(setVideoOk)
  }, [])
  const sha = recorder.photoSha()
  const saves = recorder.saves()
  useEffect(() => {
    if (!sha) return setTakes([])
    let live = true
    void listTakes(sha).then((list) => live && setTakes(list))
    return () => {
      live = false
    }
  }, [sha, saves])
  void tick

  const currentId = recorder.takeId()
  const earlier = takes.filter((t) => t.id !== currentId)
  const { changes, minutes } = describeRecording(recorder.frames())
  useEffect(() => {
    if (pick !== 'current' && pick !== 'all' && !takes.some((t) => t.id === pick)) setPick('current')
  }, [takes, pick])

  /** The frames picked: the live take from memory, saved ones from disk, all of them end to end. */
  const framesPicked = async (): Promise<TimelapseFrame[]> => {
    if (pick === 'current') return recorder.frames()
    if (pick !== 'all') return loadTake(pick)
    const out: TimelapseFrame[] = []
    let offset = 0
    for (const take of earlier) {
      const frames = await loadTake(take.id)
      for (const f of frames) out.push({ t: f.t + offset, state: f.state })
      offset = (out[out.length - 1]?.t ?? 0) + 1000
    }
    for (const f of recorder.frames()) out.push({ t: f.t + offset, state: f.state })
    return out
  }
  const withFrames = async (use: (frames: TimelapseFrame[]) => void) => {
    setBusy(true)
    try {
      const frames = await framesPicked()
      if (frames.length < 2) onStatus('Nothing to play in that one yet.')
      else use(frames)
    } catch (err) {
      onError(`Could not read the recording: ${(err as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  const pickedChanges =
    pick === 'current' ? changes : pick === 'all' ? earlier.reduce((a, t) => a + t.changes, 0) + changes : (takes.find((t) => t.id === pick)?.changes ?? 0)
  const enough = hasImage && pickedChanges > 0 && !busy

  return (
    <section className="settings-section">
      <div className="settings-head">
        <h3>Timelapse</h3>
        <ModuleSwitch on={settings.on} onToggle={() => set({ on: !settings.on })} label="timelapse recording" />
      </div>
      <p className="muted">Records each photo's edit as you work, to play back or save as a video.</p>
      {settings.on && (
      <>
      <div className="take-list">
        <label className={`take${pick === 'current' ? ' on' : ''}`}>
          <input type="radio" name="take" checked={pick === 'current'} onChange={() => setPick('current')} />
          <span>
            <strong>This time</strong>
            <em>
              {changes
                ? `${changes} change${changes === 1 ? '' : 's'} · ${minutes < 1 ? 'under a minute' : `${Math.round(minutes)} min`}`
                : 'Nothing yet: edit away'}
            </em>
          </span>
        </label>
        {earlier
          .slice()
          .reverse()
          .map((t) => (
            <label key={t.id} className={`take${pick === t.id ? ' on' : ''}`}>
              <input type="radio" name="take" checked={pick === t.id} onChange={() => setPick(t.id)} />
              <span>
                <strong>{t.made ? `Made up · ${when(t.started)}` : when(t.started)}</strong>
                <em>
                  {t.changes} changes · {span(t.ms)}
                </em>
              </span>
              <button
                className="take-remove"
                title="Delete this take"
                onClick={(e) => {
                  e.preventDefault()
                  void deleteTake(t.id).then(() => setTakes((list) => list.filter((x) => x.id !== t.id)))
                }}
              >
                ×
              </button>
            </label>
          ))}
        {earlier.length > 0 && (
          <label className={`take${pick === 'all' ? ' on' : ''}`}>
            <input type="radio" name="take" checked={pick === 'all'} onChange={() => setPick('all')} />
            <span>
              <strong>All of them</strong>
              <em>{earlier.length + 1} takes, one after another</em>
            </span>
          </label>
        )}
      </div>
      <div className="field valued">
        <span title="About how long the playback or video runs, the edit sped up to fit">Length</span>
        <div className="segmented">
          {LENGTHS.map((s) => (
            <button key={s} className={seconds === s ? 'on' : ''} onClick={() => set({ seconds: s })}>
              {s}s
            </button>
          ))}
        </div>
      </div>
      <div className="row">
        <button
          className={playing ? 'on' : ''}
          disabled={!playing && (!enough || making !== null)}
          title={keyWords("Play the edit back in the app, panels moving as they did, to screen record (Cmd+Shift+5). Esc stops; the edit comes back as it is now.")}
          onClick={() => (playing ? onStop() : void withFrames((f) => onPlay(f, seconds)))}
        >
          {playing ? 'Stop' : 'Play in the window'}
        </button>
        <button
          disabled={!hasImage || changes === 0 || playing || making !== null}
          title="Keep this take as it is and start a new one from here"
          onClick={() => {
            recorder.newTake()
            onStatus('A new take starts from here; the last one is kept')
          }}
        >
          New take
        </button>
      </div>
      <div className="field valued">
        <span title="The video's frame">Video</span>
        <div className="segmented">
          <button className={shape === 'reel' ? 'on' : ''} title="1080×1920, the photo in the middle: a reel or story" onClick={() => set({ shape: 'reel' })}>
            Reel 9:16
          </button>
          <button className={shape === 'photo' ? 'on' : ''} title="The finished print's own shape" onClick={() => set({ shape: 'photo' })}>
            Photo shape
          </button>
        </div>
      </div>
      <label className="check-row" title="Open on the photo as it came, before any of the edit">
        <input type="checkbox" checked={fromOriginal} onChange={(e) => set({ fromOriginal: e.target.checked })} />
        Start on the original
      </label>
      <div className="row">
        {making === null ? (
          <button
            className="primary"
            disabled={!enough || playing || videoOk === false}
            title={videoOk === false ? 'This version of WebKit cannot encode video' : 'Render the picked take to an MP4'}
            onClick={() => void withFrames((f) => onVideo(f, { seconds, shape, fromOriginal }))}
          >
            Make video…
          </button>
        ) : (
          <>
            <progress value={making} max={1} />
            <button onClick={onCancelVideo}>Cancel</button>
          </>
        )}
      </div>
      <label className="check-row" title="Each export also saves its timelapse video beside it">
        <input type="checkbox" checked={settings.withExports} onChange={(e) => set({ withExports: e.target.checked })} />
        Save a video with every export
      </label>
      </>
      )}
    </section>
  )
}
