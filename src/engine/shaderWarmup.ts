/**
 * The look's and the streaks' programs, built once in a worker of their own
 * so the browser keeps them for next time (shaderWarmupWorker).
 *
 * The renders are drawn in a worker (renderWorker) whose builds go on in the
 * background, never waited for, and Chrome keeps none of those: on Windows,
 * where Direct3D's compiler takes the look 10-50 s and the streak programs a
 * minute or more between them, each launch built them all again. Built in a
 * worker that waits for each, they are kept, and the render worker's same
 * programs then come back from them at once (the shader bench: 107 s every
 * launch; 69 s once in a waiting worker, then 0.9 s in all).
 *
 * Started a few seconds after the app opens (renderClient), on Windows only,
 * once per run of the app. Once kept, it takes about a second.
 */
let started = false

export function warmShaderCache(delayMs = 2000): void {
  if (started || typeof Worker === 'undefined') return
  started = true
  setTimeout(() => {
    const w = new Worker(new URL('./shaderWarmupWorker.ts', import.meta.url), { type: 'module' })
    w.onmessage = () => w.terminate()
    w.onerror = () => w.terminate()
    w.postMessage({})
  }, delayMs)
}
