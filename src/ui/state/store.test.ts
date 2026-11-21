import { afterEach, describe, expect, it } from 'vitest'
import { createStore, persistedStore } from './store'

const saved = new Map<string, string>()
const fakeStorage = {
  getItem: (k: string) => saved.get(k) ?? null,
  setItem: (k: string, v: string) => void saved.set(k, v),
}

afterEach(() => {
  saved.clear()
  delete (globalThis as { localStorage?: unknown }).localStorage
})

describe('store', () => {
  it('tells its listeners of a change, and not of the same value again', () => {
    const s = createStore(1)
    let calls = 0
    const stop = s.subscribe(() => calls++)
    s.set(2)
    s.set((v) => v)
    expect(s.get()).toBe(2)
    expect(calls).toBe(1)
    stop()
    s.set(3)
    expect(calls).toBe(1)
  })

  it('reads and writes the same JSON as useLocalStorage, when first wanted', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage
    const s = persistedStore('ui.test.width', 264)
    saved.set('ui.test.width', '310')
    expect(s.get()).toBe(310)
    s.set(320)
    expect(saved.get('ui.test.width')).toBe('320')
  })

  it('falls back to its starting value when storage cannot be read', () => {
    ;(globalThis as { localStorage?: unknown }).localStorage = fakeStorage
    saved.set('ui.test.bad', '{not json')
    expect(persistedStore('ui.test.bad', true).get()).toBe(true)
    delete (globalThis as { localStorage?: unknown }).localStorage
    const s = persistedStore('ui.test.none', 'fit')
    expect(s.get()).toBe('fit')
    s.set('x')
    expect(s.get()).toBe('x')
  })
})
