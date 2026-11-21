import { describe, expect, it } from 'vitest'
import { keepUntilWritten, onBeforeQuit, settleWrites } from './quit'

describe('settleWrites', () => {
  it('saves what waits, then waits for every write, including one started by another', async () => {
    const done: string[] = []
    const later = (name: string, ms: number) => new Promise<void>((r) => setTimeout(() => (done.push(name), r()), ms))
    const stop = onBeforeQuit(() => {
      void keepUntilWritten(later('edit', 20).then(() => keepUntilWritten(later('thumb', 20))))
    })
    await settleWrites()
    stop()
    expect(done).toEqual(['edit', 'thumb'])
  })

  it('gives up on a write that never ends', async () => {
    void keepUntilWritten(new Promise(() => {}))
    const t = Date.now()
    await settleWrites(50)
    expect(Date.now() - t).toBeLessThan(500)
  })
})
