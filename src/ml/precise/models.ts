import { invoke } from '@tauri-apps/api/core'
import { createStore, persistedStore, useStore } from '../../ui/state/store'
import { dataDir, fileSha, isNative, readFile, removeFile, writeFile } from '../../platform/native'
import { reportIssue } from '../../platform/telemetry'
import { track } from '../../platform/usage'

/**
 * Precise selection's models, downloaded once into the app's own folder
 * (models/precise-1): Segment Anything 2.1 small (Apache 2.0), which finds
 * what was clicked or boxed, and BiRefNet (MIT), which traces its edge. Not
 * in the app itself, which stays light: offered on the welcome sheet and in
 * Settings. Each file is pinned to a commit and checked against its SHA-256.
 * Until they are here, selecting uses the small model the app ships with.
 */

export type PrecisePart = 'find' | 'edge'

interface ModelFile {
  part: PrecisePart
  repo: string
  rev: string
  path: string
  size: number
  sha256: string
}

const SAM = { repo: 'onnx-community/sam2.1-hiera-small-ONNX', rev: 'a7df49d8de14b9d2e4504d1687b0d568f905fd8d' }
const BIREF = { repo: 'onnx-community/BiRefNet-ONNX', rev: '534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67' }

export const PRECISE_FILES: ModelFile[] = [
  { part: 'find', ...SAM, path: 'onnx/vision_encoder_fp16.onnx', size: 422501, sha256: 'f236074c31a7ba9d1e00362e8c29cb95bf9dcdd61e208048493902878d9dc4db' },
  { part: 'find', ...SAM, path: 'onnx/vision_encoder_fp16.onnx_data', size: 81182784, sha256: '557e013522bace72a6b8441f66747f1c4b2a237d1e3c86f84dba86b6d814ec1f' },
  { part: 'find', ...SAM, path: 'onnx/prompt_encoder_mask_decoder_fp16.onnx', size: 229799, sha256: 'b36b0f515864220402b18054e37f236e7ef33486a7716fb45d0df17c64332392' },
  { part: 'find', ...SAM, path: 'onnx/prompt_encoder_mask_decoder_fp16.onnx_data', size: 10454016, sha256: '33fc89eb7fb87fd638c7232a5bb6f8a1743bd4eee1a4aadca88a141f5b35945f' },
  { part: 'edge', ...BIREF, path: 'onnx/model_fp16.onnx', size: 489666272, sha256: '3654c741eb80bd926ada8fed1713b506ccf8d30eb1f6487e87eb9f234f33df09' },
]

/** The folder's name: a new set of models gets a new folder, and the old one is removed. */
const SET = 'precise-1'

/** Where a file goes: the repo's name, then its path. */
const localName = (f: ModelFile) => `${f.repo.split('/')[1]}/${f.path.split('/').pop()}`
const urlOf = (f: ModelFile) => `https://huggingface.co/${f.repo}/resolve/${f.rev}/${f.path}`

let dirPromise: Promise<string> | null = null
export const preciseDir = () => (dirPromise ??= dataDir().then((d) => `${d}/models/${SET}`))
export const precisePath = async (repoName: 'sam' | 'edge', file: string) => `${await preciseDir()}/${repoName === 'sam' ? 'sam2.1-hiera-small-ONNX' : 'BiRefNet-ONNX'}/${file}`

/**
 * The web playground on a computer: Segment Anything 2.1 small from the site
 * (R2, /app/models/precise-1), kept by the browser after the first time, run
 * on WebGPU. Not on phones and tablets (their memory) or without WebGPU; not
 * the edge model (it needs the app's native runtime).
 */
export const WEB_MODELS = '/app/models/precise-1/sam2.1-hiera-small-ONNX/'
export function webPreciseHere(): boolean {
  if (isNative() || typeof navigator === 'undefined' || !('gpu' in navigator)) return false
  if (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) return false
  return ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) >= 4
}

/** The models being fetched in a browser, while they are: bytes so far and in all. */
export const preciseLoadingStore = createStore<{ done: number; total: number } | null>(null)
export const usePreciseLoading = () => useStore(preciseLoadingStore)

/** What this computer can run natively (src-tauri/src/ml.rs). */
export interface MlInfo {
  native: boolean
  gpu: string | null
}
let infoPromise: Promise<MlInfo> | null = null
export const mlInfo = (): Promise<MlInfo> =>
  (infoPromise ??= isNative() ? invoke<MlInfo>('ml_info').catch(() => ({ native: false, gpu: null })) : Promise.resolve({ native: false, gpu: null }))

/** The parts worth having here: the edge model needs the native runtime (an Intel Mac and Linux have none). */
export async function partsHere(): Promise<PrecisePart[]> {
  return (await mlInfo()).native ? ['find', 'edge'] : ['find']
}
export const filesFor = (parts: PrecisePart[]) => PRECISE_FILES.filter((f) => parts.includes(f.part))
export const bytesFor = (parts: PrecisePart[]) => filesFor(parts).reduce((a, f) => a + f.size, 0)
/** "580 MB". */
export const sizeLabel = (bytes: number) => `${Math.round(bytes / 1e6)} MB`

export type PreciseState =
  { kind: 'unknown' } | { kind: 'none' } | { kind: 'downloading'; done: number; total: number } | { kind: 'installed'; parts: PrecisePart[] } | { kind: 'failed'; message: string }

export const preciseStore = createStore<PreciseState>({ kind: 'unknown' })
export const usePrecise = () => useStore(preciseStore)

/** Asked for on the welcome sheet: downloaded when the app is next idle, and on later launches until done. */
export const preciseWantedStore = persistedStore<boolean>('settings.preciseWanted', false)

const MARK = 'installed.json'

/** Whether the models are here (their mark, written once every file was checked). */
export async function checkPrecise(): Promise<PreciseState> {
  if (!isNative()) return { kind: 'none' }
  try {
    const raw = await readFile(`${await preciseDir()}/${MARK}`)
    const mark = raw ? (JSON.parse(new TextDecoder().decode(raw)) as { set: string; parts: PrecisePart[] }) : null
    const state: PreciseState = mark?.set === SET && mark.parts?.includes('find') ? { kind: 'installed', parts: mark.parts } : { kind: 'none' }
    if (preciseStore.get().kind !== 'downloading') preciseStore.set(state)
    return state
  } catch {
    if (preciseStore.get().kind !== 'downloading') preciseStore.set({ kind: 'none' })
    return { kind: 'none' }
  }
}

let running: AbortController | null = null
/** The size a piece is written in. */
const CHUNK = 8 << 20

/**
 * Downloads the models, with their progress in preciseStore. A file already
 * here and whole is kept, so a download stopped half way picks up from the
 * last whole file. Resolves when done; a stop or a failure leaves the state
 * saying so.
 */
export async function downloadPrecise(): Promise<boolean> {
  if (!isNative() || running) return false
  const parts = await partsHere()
  const files = filesFor(parts)
  const total = bytesFor(parts)
  const dir = await preciseDir()
  const controller = new AbortController()
  running = controller
  let done = 0
  preciseStore.set({ kind: 'downloading', done, total })
  track('precise_download', 'start', parts.join('+'))
  try {
    for (const f of files) {
      const path = `${dir}/${localName(f)}`
      // Already here from a download that stopped later on.
      if ((await fileSha(path).catch(() => '')) === f.sha256) {
        done += f.size
        preciseStore.set({ kind: 'downloading', done, total })
        continue
      }
      await removeFile(path)
      const res = await fetch(urlOf(f), { signal: controller.signal })
      if (!res.ok || !res.body) throw new Error(`The download stopped (${res.status}).`)
      const reader = res.body.getReader()
      let pending: Uint8Array[] = []
      let pendingBytes = 0
      const flush = async () => {
        if (!pendingBytes) return
        const piece = new Uint8Array(pendingBytes)
        let at = 0
        for (const p of pending) {
          piece.set(p, at)
          at += p.length
        }
        pending = []
        pendingBytes = 0
        await invoke('ml_append', piece, { headers: { 'x-path': encodeURIComponent(path) } })
      }
      for (;;) {
        const { done: end, value } = await reader.read()
        if (end) break
        pending.push(value)
        pendingBytes += value.length
        done += value.length
        if (pendingBytes >= CHUNK) {
          await flush()
          preciseStore.set({ kind: 'downloading', done, total })
        }
      }
      await flush()
      preciseStore.set({ kind: 'downloading', done, total })
      if ((await fileSha(path)) !== f.sha256) {
        await removeFile(path)
        throw new Error('A downloaded file was not what was expected. Try again.')
      }
    }
    await writeFile(`${dir}/${MARK}`, JSON.stringify({ set: SET, parts }))
    preciseStore.set({ kind: 'installed', parts })
    preciseWantedStore.set(false)
    track('precise_download', 'done', parts.join('+'))
    return true
  } catch (err) {
    const stopped = controller.signal.aborted
    preciseStore.set(stopped ? { kind: 'none' } : { kind: 'failed', message: (err as Error).message || 'The download stopped.' })
    if (!stopped) {
      track('precise_download', 'failed')
      reportIssue('Precise selection: download failed', 'warning', { error: String((err as Error)?.message ?? err), done, total }, ['precise-download'])
    }
    return false
  } finally {
    running = null
  }
}

/** Stops a download going on; what is whole so far is kept for next time. */
export function stopPreciseDownload(): void {
  running?.abort()
}

/** Removes the models: selecting goes back to the small model. */
export async function removePrecise(): Promise<void> {
  stopPreciseDownload()
  const dir = await preciseDir()
  await removeFile(`${dir}/${MARK}`)
  for (const f of PRECISE_FILES) await removeFile(`${dir}/${localName(f)}`)
  preciseStore.set({ kind: 'none' })
  track('precise_download', 'removed')
}
