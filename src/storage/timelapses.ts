import { get, getAll, put, remove, TIMELAPSE_DATA_STORE, TIMELAPSE_STORE } from './db'
import { hydrateGrainSource, type GrainSource, type SerializedGrainSource } from '../sources/GrainSource'
import { LOOKS } from '../ui/looks'
import type { EditState } from '../ui/history'
import { sameFocus, type TimelapseFocus, type TimelapseFrame } from '../ui/timelapse'

/**
 * Timelapses on disk. Each time a photo is open is one take: the edit as it
 * was when it opened, then for every change after it only what changed — the
 * settings' paths and their new values, a few bytes for a slider's step —
 * one line each, gzipped. An hour of editing is a few hundred kilobytes.
 *
 * The listing (TimelapseMeta) is kept apart from the changes, so the panel
 * lists a photo's takes without reading any of them.
 */

export interface TimelapseMeta {
  id: string
  photoName: string
  /** SHA-256 of the photo's file: its takes are found by this, renamed or not. */
  photoSha: string
  /** When the take began, epoch ms. */
  started: number
  updated: number
  changes: number
  /** How long it covers, ms. */
  ms: number
  /** Made up from a finished edit by an earlier version, not recorded: labelled so. */
  made?: boolean
}

interface DataRecord {
  id: string
  data: Blob
  /** 'gzip', or 'none' where the browser cannot compress. */
  encoding: 'gzip' | 'none'
}

/** An edit as stored: everything plain data, the grain and look by what names them. */
interface StoredState {
  blend: EditState['blend']
  source: SerializedGrainSource | null
  output: EditState['output']
  look: string | null
  presetId: string
}

/** A change: the path to a setting and its new value; a third element 1 means it was removed. */
type Op = [(string | number)[], unknown] | [(string | number)[], null, 1]

const isPlain = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** What changed from a to b, as paths. Unchanged parts are the same objects, so they cost nothing to pass over. */
function diffInto(a: unknown, b: unknown, path: (string | number)[], out: Op[]): void {
  if (a === b) return
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length) {
    for (let i = 0; i < b.length; i++) diffInto(a[i], b[i], [...path, i], out)
    return
  }
  if (isPlain(a) && isPlain(b)) {
    for (const k of Object.keys(b)) {
      if (b[k] === undefined) {
        if (a[k] !== undefined) out.push([[...path, k], null, 1])
      } else diffInto(a[k], b[k], [...path, k], out)
    }
    for (const k of Object.keys(a)) if (!(k in b) && a[k] !== undefined) out.push([[...path, k], null, 1])
    return
  }
  // Numbers that only differ past what is worth keeping are the same.
  if (typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) < 1e-9) return
  out.push([path, b === undefined ? null : b])
}

const store = (s: EditState): StoredState => ({
  blend: s.blend,
  source: s.source?.serialize() ?? null,
  output: s.output,
  look: s.look?.id ?? null,
  presetId: s.presetId,
})

/** The first line of a take: the edit in full. */
export function headerLine(state: EditState, focus: TimelapseFocus | null = null): string {
  return JSON.stringify({ v: 1, state: store(state), focus })
}

/** One change's line: when (ms into the take) and what changed. */
export function changeLine(
  t: number,
  from: EditState,
  to: EditState,
  fromFocus: TimelapseFocus | null = null,
  toFocus: TimelapseFocus | null = null,
): string {
  const ops: Op[] = []
  // The shape being edited is kept beside the edit, under its own name.
  if (!sameFocus(fromFocus, toFocus)) ops.push([['@focus'], toFocus ?? null])
  if (from.source !== to.source) ops.push([['source'], to.source?.serialize() ?? null])
  if (from.look !== to.look) ops.push([['look'], to.look?.id ?? null])
  if (from.presetId !== to.presetId) ops.push([['presetId'], to.presetId])
  diffInto(from.blend, to.blend, ['blend'], ops)
  diffInto(from.output, to.output, ['output'], ops)
  return JSON.stringify([Math.round(t), ops])
}

/** The value with the one at `path` replaced: new objects along the path, everything else shared. */
function setIn(obj: unknown, path: (string | number)[], value: unknown, del: boolean): unknown {
  if (!path.length) return value
  const [k, ...rest] = path
  if (Array.isArray(obj)) {
    const copy = obj.slice()
    copy[k as number] = setIn(copy[k as number], rest, value, del)
    return copy
  }
  const copy: Record<string, unknown> = { ...(isPlain(obj) ? obj : {}) }
  if (del && !rest.length) delete copy[k as string]
  else copy[k as string] = setIn(copy[k as string], rest, value, del)
  return copy
}

async function compress(text: string): Promise<{ data: Blob; encoding: DataRecord['encoding'] }> {
  if (typeof CompressionStream === 'undefined') return { data: new Blob([text]), encoding: 'none' }
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))
  return { data: await new Response(stream).blob(), encoding: 'gzip' }
}

async function decompress(rec: DataRecord): Promise<string> {
  if (rec.encoding !== 'gzip') return rec.data.text()
  return new Response(rec.data.stream().pipeThrough(new DecompressionStream('gzip'))).text()
}

/** Save a take: its listing and its lines. */
export async function saveTake(meta: TimelapseMeta, lines: string[]): Promise<void> {
  const { data, encoding } = await compress(lines.join('\n'))
  await put<DataRecord>(TIMELAPSE_DATA_STORE, { id: meta.id, data, encoding })
  await put(TIMELAPSE_STORE, meta)
}

/** A photo's takes, oldest first. */
export async function listTakes(photoSha: string): Promise<TimelapseMeta[]> {
  const all = await getAll<TimelapseMeta>(TIMELAPSE_STORE)
  return all.filter((m) => m.photoSha === photoSha).sort((a, b) => a.started - b.started)
}

export async function deleteTake(id: string): Promise<void> {
  await remove(TIMELAPSE_DATA_STORE, id)
  await remove(TIMELAPSE_STORE, id)
}

/**
 * A take back as frames, each an edit as the app holds one. Unchanged parts
 * stay the same objects from frame to frame, as they were when recorded, and
 * each grain is hydrated once.
 */
export async function loadTake(id: string): Promise<TimelapseFrame[]> {
  const rec = await get<DataRecord>(TIMELAPSE_DATA_STORE, id)
  if (!rec) throw new Error('That recording is missing.')
  return framesFromLines((await decompress(rec)).split('\n').filter(Boolean))
}

/** A take's lines (see headerLine, changeLine) back as frames. */
export async function framesFromLines(lines: string[]): Promise<TimelapseFrame[]> {
  const head = JSON.parse(lines[0]) as { v: number; state: StoredState; focus?: TimelapseFocus | null }
  let focus = head.focus ?? null
  const sources = new Map<string, GrainSource | null>()
  const sourceFor = async (s: SerializedGrainSource | null) => {
    if (!s) return null
    const key = JSON.stringify(s)
    if (!sources.has(key)) sources.set(key, await hydrateGrainSource(s).catch(() => null))
    return sources.get(key)!
  }
  const looks = new Map(LOOKS.map((l) => [l.id, l]))
  const live = async (s: StoredState, prev: EditState | null): Promise<EditState> => ({
    blend: s.blend,
    source: prev && s.source === null ? prev.source : await sourceFor(s.source),
    output: s.output,
    look: s.look ? (looks.get(s.look) ?? null) : null,
    presetId: s.presetId,
  })
  let state = head.state
  let current = await live(state, null)
  const frames: TimelapseFrame[] = [{ t: 0, state: current, focus }]
  for (const line of lines.slice(1)) {
    const [t, ops] = JSON.parse(line) as [number, Op[]]
    let next: StoredState = state
    for (const op of ops) {
      if (op[0][0] === '@focus') focus = (op[1] as TimelapseFocus | null) ?? null
      else next = setIn(next, op[0], op[1], op[2] === 1) as StoredState
    }
    const changedSource = ops.some((op) => op[0][0] === 'source')
    // Only what changed is made anew; the rest is the frame before's.
    current = {
      blend: next.blend,
      source: changedSource ? await sourceFor(next.source) : current.source,
      output: next.output,
      look: next.look ? (looks.get(next.look) ?? null) : null,
      presetId: next.presetId,
    }
    state = next
    frames.push({ t, state: current, focus })
  }
  return frames
}
