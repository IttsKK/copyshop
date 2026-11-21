import { useEffect, useRef } from 'react'
import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import { printSizeOf, type Size } from '../engine/types'
import { renderClient } from '../engine/renderClient'
import type { GrainSource, GrainTexture } from '../sources/GrainSource'
import type { EditState } from './history'
import { changeLine, headerLine, saveTake } from '../storage/timelapses'
import { sha256 } from '../storage/recipe'
import { drawFocus } from './timelapseOverlay'
import { newId } from '../storage/db'

/**
 * A timelapse of an edit: every change to it, as it happened — what the
 * sliders went through, not just the steps undo keeps — kept on disk per
 * photo (storage/timelapses.ts). Played back in the app (the panels move as they did, to screen
 * record), or rendered to a video of the photo alone, sped up to a length,
 * for a reel of the process.
 *
 * The states are the edit's own objects, which are never changed in place,
 * so keeping one costs a reference.
 */

export interface TimelapseFrame {
  /** When, in ms since the photo was opened. */
  t: number
  state: EditState
  /** The shape being edited on the photo then, if any: shown on the video as the app shows it. */
  focus?: TimelapseFocus | null
}

/**
 * A streak or mask being edited on the photo: which (null while a new one is
 * drawn), and the points placed so far of one being drawn — an outline, or
 * with `path`, the selected streak's path.
 */
export interface TimelapseFocus {
  kind: 'streak' | 'mask'
  index: number | null
  draft?: { x: number; y: number }[]
  path?: boolean
}

export const sameFocus = (a: TimelapseFocus | null | undefined, b: TimelapseFocus | null | undefined) =>
  (a ?? null) === (b ?? null) || (!!a && !!b && a.kind === b.kind && a.index === b.index && a.draft === b.draft && a.path === b.path)

/** Most frames kept: past this the oldest go (the first, the photo as opened, stays). */
const MAX_FRAMES = 20000
/** Changes closer together than this are one frame: the later wins. */
const COALESCE_MS = 40
/** Saved this long after the last change, and at least this often while changes keep coming. */
const SAVE_AFTER_MS = 2500
const SAVE_AT_LEAST_MS = 15000

const same = (a: EditState, b: EditState) =>
  a.blend === b.blend && a.source === b.source && a.output === b.output && a.look === b.look && a.presetId === b.presetId

/** How the timelapse is recorded and made into a video (Settings). Off unless turned on. */
export interface TimelapseSettings {
  /** Record a timelapse of each photo as it is edited. */
  on: boolean
  /** About how long the video runs, the edit sped up to fit. */
  seconds: number
  /** 1080×1920 with the photo in the middle, or the print's own shape. */
  shape: 'reel' | 'photo'
  /** Open on the photo as it came, before any of the edit. */
  fromOriginal: boolean
  /** Make the video with every export, saved beside it. */
  withExports: boolean
}

export const DEFAULT_TIMELAPSE: TimelapseSettings = { on: false, seconds: 30, shape: 'reel', fromOriginal: true, withExports: false }

export interface TimelapseRecorder {
  frames: () => TimelapseFrame[]
  /** The take being recorded, as saved (null until its first change is saved). */
  takeId: () => string | null
  /** The open photo's SHA-256, once worked out. */
  photoSha: () => string | null
  /** Goes up each time the take is saved, for the panel to list it again. */
  saves: () => number
  /** Save what there is now, and start a new take from the edit as it is. */
  newTake: () => void
}

interface Take {
  id: string
  photo: { name: string; file: Blob }
  sha: string | null
  started: number
  start: number
  frames: TimelapseFrame[]
  /** One per frame: the first the edit in full, then each change (see storage/timelapses.ts). */
  lines: string[]
  dirty: boolean
  timer: ReturnType<typeof setTimeout> | null
  lastSave: number
}

/**
 * Records every change to the edit while `photo` is open, and keeps each
 * time a photo is open (a take) on disk, saved as it goes. A new photo, or
 * New take, starts the next.
 */
export function useTimelapseRecorder(
  state: EditState,
  photo: { name: string; file: Blob } | null,
  paused: boolean,
  focus: TimelapseFocus | null = null,
): TimelapseRecorder {
  const rec = useRef({ photo: null as unknown, take: null as Take | null, saves: 0 })

  const save = (take: Take) => {
    if (take.timer) clearTimeout(take.timer)
    take.timer = null
    if (!take.dirty || !take.sha || take.frames.length < 2) return
    take.dirty = false
    take.lastSave = Date.now()
    const last = take.frames[take.frames.length - 1]
    void saveTake(
      {
        id: take.id,
        photoName: take.photo.name,
        photoSha: take.sha,
        started: take.started,
        updated: Date.now(),
        changes: take.frames.length - 1,
        ms: Math.round(last.t),
      },
      take.lines.slice(),
    )
      .then(() => rec.current.saves++)
      .catch(() => (take.dirty = true))
  }
  const schedule = (take: Take) => {
    take.dirty = true
    if (take.timer) clearTimeout(take.timer)
    const wait = Date.now() - take.lastSave > SAVE_AT_LEAST_MS ? 0 : SAVE_AFTER_MS
    take.timer = setTimeout(() => save(take), wait)
  }
  const begin = (p: { name: string; file: Blob }, first: EditState, sha: string | null, focusNow: TimelapseFocus | null): Take => {
    const take: Take = {
      id: newId('tl'),
      photo: p,
      sha,
      started: Date.now(),
      start: performance.now(),
      frames: [{ t: 0, state: first, focus: focusNow }],
      lines: [headerLine(first, focusNow)],
      dirty: false,
      timer: null,
      lastSave: Date.now(),
    }
    if (!sha)
      void sha256(p.file).then((h) => {
        take.sha = h
        if (take.dirty) schedule(take)
      })
    return take
  }

  const { blend, source, output, look, presetId } = state
  // Which shape is being edited, by kind and number: the same one stays the same object.
  const focusKey = focus ? `${focus.kind}:${focus.index}` : ''
  const focusRef = useRef<TimelapseFocus | null>(null)
  if ((focusRef.current ? `${focusRef.current.kind}:${focusRef.current.index}` : '') !== focusKey)
    focusRef.current = focus ? { kind: focus.kind, index: focus.index } : null
  const focusNow = focusRef.current
  useEffect(() => {
    if (paused || !source) return
    const r = rec.current
    const here: EditState = { blend, source, output, look, presetId }
    if (r.photo !== photo) {
      if (r.take) save(r.take)
      r.photo = photo
      r.take = photo ? begin(photo, here, null, focusNow) : null
      return
    }
    const take = r.take
    if (!take) return
    const frames = take.frames
    const last = frames[frames.length - 1]
    if (same(last.state, here) && sameFocus(last.focus, focusNow)) return
    const f: TimelapseFrame = { t: performance.now() - take.start, state: here, focus: focusNow }
    if (frames.length > 1 && f.t - last.t < COALESCE_MS) {
      const before = frames[frames.length - 2]
      frames[frames.length - 1] = f
      take.lines[take.lines.length - 1] = changeLine(f.t, before.state, here, before.focus, focusNow)
    } else {
      frames.push(f)
      take.lines.push(changeLine(f.t, last.state, here, last.focus, focusNow))
    }
    if (frames.length > MAX_FRAMES) {
      frames.splice(1, 1)
      take.lines.splice(1, 1)
      take.lines[1] = changeLine(frames[1].t, frames[0].state, frames[1].state, frames[0].focus, frames[1].focus)
    }
    schedule(take)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blend, source, output, look, presetId, photo, paused, focusNow])

  // Saved on the way out, too.
  useEffect(() => {
    const out = () => rec.current.take && save(rec.current.take)
    window.addEventListener('pagehide', out)
    return () => {
      window.removeEventListener('pagehide', out)
      out()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return {
    frames: () => rec.current.take?.frames ?? [],
    takeId: () => (rec.current.take && rec.current.take.frames.length > 1 ? rec.current.take.id : null),
    photoSha: () => rec.current.take?.sha ?? null,
    saves: () => rec.current.saves,
    newTake: () => {
      const r = rec.current
      const take = r.take
      if (!take) return
      save(take)
      const last = take.frames[take.frames.length - 1]
      r.take = begin(take.photo, last.state, take.sha, last.focus ?? null)
    },
  }
}

export interface TimelineStep {
  state: EditState
  focus: TimelapseFocus | null
  /** How long it shows, ms. */
  ms: number
}

/**
 * The recording, sped up to about `seconds` long: a change made in a sweep
 * (a slider dragged) keeps its rhythm, sped up with the rest; a pause
 * between edits becomes a short beat, a little longer or shorter each time
 * so it does not tick like a metronome. A recording shorter than the length
 * plays at its own pace.
 */
export function buildTimeline(frames: TimelapseFrame[], seconds: number): TimelineStep[] {
  if (!frames.length) return []
  const raw = frames.map((f, i) => {
    const next = frames[i + 1]
    if (!next) return 0
    const gap = next.t - f.t
    // Within a gesture: as it was. Between them: a beat.
    return gap < 400 ? gap : 420 * (0.55 + Math.random() * 0.9)
  })
  const total = raw.reduce((a, b) => a + b, 0)
  const scale = total > seconds * 1000 ? (seconds * 1000) / total : 1
  return frames.map((f, i) => ({ state: f.state, focus: f.focus ?? null, ms: raw[i] * scale }))
}

/** How long the recording covers, and how many changes, for the panel. */
export function describeRecording(frames: TimelapseFrame[]): { changes: number; minutes: number } {
  const last = frames[frames.length - 1]
  return { changes: Math.max(0, frames.length - 1), minutes: last ? last.t / 60000 : 0 }
}

export interface VideoOptions {
  frames: TimelapseFrame[]
  photo: { bitmap: ImageBitmap; size: Size; seed: number }
  /** About how long, seconds, before the hold on the finished edit. */
  seconds: number
  /** 'reel': 1080×1920 with the photo in the middle; 'photo': the photo's own shape. */
  shape: 'reel' | 'photo'
  /** Open on the photo as it came, before any of the edit. */
  fromOriginal: boolean
  onProgress: (done: number) => void
  signal: AbortSignal
}

const FPS = 30

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Whether this browser can encode the video (WebCodecs, H.264). */
export async function canMakeVideo(): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') return false
  try {
    const r = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 1080, height: 1920, bitrate: 10e6, framerate: FPS })
    return !!r.supported
  } catch {
    return false
  }
}

/**
 * The recording as an MP4: each distinct state rendered (in the render
 * worker, off the page's thread), held for its share of the timeline, and
 * encoded at 30 frames a second. Ends on the finished edit for two seconds.
 */
export async function makeTimelapseVideo(o: VideoOptions): Promise<Blob> {
  const steps = buildTimeline(o.frames, o.seconds)
  if (!steps.length) throw new Error('Nothing recorded yet.')
  const final = steps[steps.length - 1]
  // The timeline in video frames: a step shorter than a frame is passed over
  // (a slider's sweep, sped up, shows every few of its positions).
  const intro = o.fromOriginal ? 0.9 : 0
  const timeline: { state: EditState | null; focus?: TimelapseFocus | null; frames: number }[] = []
  if (o.fromOriginal) timeline.push({ state: null, frames: Math.round(intro * FPS) })
  let clock = 0
  let shown = 0
  for (const s of steps.slice(0, -1)) {
    clock += s.ms / 1000
    const upto = Math.round(clock * FPS)
    if (upto > shown) {
      timeline.push({ state: s.state, focus: s.focus, frames: upto - shown })
      shown = upto
    }
  }
  timeline.push({ state: final.state, focus: null, frames: Math.max(1, Math.round(clock * FPS) - shown) + 2 * FPS })
  const totalFrames = timeline.reduce((a, b) => a + b.frames, 0)

  // The frame: a reel, or the finished print's own shape (the size it ends at).
  const endPrint = printSizeOf(o.photo.size, final.state.blend)
  const size =
    o.shape === 'reel'
      ? { width: 1080, height: 1920 }
      : (() => {
          const s = Math.min(1, 1080 / Math.min(endPrint.width, endPrint.height), 1920 / Math.max(endPrint.width, endPrint.height))
          return { width: even(endPrint.width * s), height: even(endPrint.height * s) }
        })()
  const margin = o.shape === 'reel' ? 60 : 0
  const fit = (w: number, h: number) => {
    const s = Math.min((size.width - margin * 2) / w, (size.height - margin * 2) / h)
    const width = Math.round(w * s)
    const height = Math.round(h * s)
    return { x: Math.round((size.width - width) / 2), y: Math.round((size.height - height) / 2), width, height }
  }

  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')!
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: size.width, height: size.height, frameRate: FPS },
    fastStart: 'in-memory',
  })
  let failure: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e as Error),
  })
  encoder.configure({ codec: 'avc1.640028', width: size.width, height: size.height, bitrate: 12e6, framerate: FPS })

  const grains = new Map<GrainSource, GrainTexture>()
  const grainFor = async (source: GrainSource) => {
    let g = grains.get(source)
    if (!g) {
      g = await source.getTexture({ targetSize: o.photo.size })
      grains.set(source, g)
    }
    return g
  }

  let frameNo = 0
  try {
    for (const item of timeline) {
      if (o.signal.aborted) throw new DOMException('Stopped', 'AbortError')
      if (failure) throw failure
      ctx.fillStyle = '#0d0d0e'
      ctx.fillRect(0, 0, size.width, size.height)
      if (!item.state) {
        const at = fit(o.photo.size.width, o.photo.size.height)
        ctx.drawImage(o.photo.bitmap, at.x, at.y, at.width, at.height)
      } else {
        const st = item.state
        const print = printSizeOf(o.photo.size, st.blend)
        const at = fit(print.width, print.height)
        const grain = st.source ? await grainFor(st.source) : null
        if (grain) {
          const out = await renderClient.render('timelapse', 'timelapse', {
            base: o.photo.bitmap,
            baseSize: o.photo.size,
            grain: grain.source,
            grainSize: grain.size,
            grainMean: grain.mean,
            grainSd: grain.sd,
            params: st.blend,
            imageSeed: o.photo.seed,
            outputSize: { width: at.width, height: at.height },
          })
          if (out) {
            ctx.drawImage(out.bitmap, at.x, at.y, at.width, at.height)
            out.bitmap.close()
          }
        }
        if (item.focus) drawFocus(ctx, item.focus, st.blend, o.photo.size, at)
      }
      for (let k = 0; k < item.frames; k++) {
        const frame = new VideoFrame(canvas, { timestamp: Math.round((frameNo * 1e6) / FPS), duration: Math.round(1e6 / FPS) })
        encoder.encode(frame, { keyFrame: frameNo % (FPS * 2) === 0 })
        frame.close()
        frameNo++
        // Let the encoder keep up rather than queueing the whole video.
        while (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4))
      }
      o.onProgress(frameNo / totalFrames)
    }
    await encoder.flush()
    if (failure) throw failure
    muxer.finalize()
    return new Blob([muxer.target.buffer], { type: 'video/mp4' })
  } finally {
    if (encoder.state !== 'closed') encoder.close()
  }
}
