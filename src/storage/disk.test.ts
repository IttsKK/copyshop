import { describe, expect, it } from 'vitest'
import { fileId } from './disk'

describe('record ids as file names in the app', () => {
  const ok = (name: string) => /^[\w.@-]+$/.test(name) && name.length < 120
  it('a file-safe id is its own name, so what is saved already still loads', () => {
    expect(fileId('folders')).toBe('folders')
    expect(fileId('3f2a9c.e1')).toBe('3f2a9c.e1')
  })
  it('an id with a path or a colon in it gets a safe name of its own', () => {
    const ids = ['order:/Users/me/Pictures/Vancouver', 'order::recent', 'ref:9a3f0c1d2e', 'order:C:\\Users\\me\\Photos', 'order:/Users/me/Pictures/Vancouver 2']
    const names = ids.map(fileId)
    for (const n of names) expect(ok(n)).toBe(true)
    expect(new Set(names).size).toBe(ids.length)
    // Always the same name for the same id.
    expect(fileId(ids[0])).toBe(names[0])
  })
})
