import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { MODULE_BY_ID } from './moduleCatalog'
import { KIND_ORDER, RELEASES, newer, whereIs } from './whatsNew'

describe("What's new", () => {
  it('compares versions by their numbers', () => {
    expect(newer('1.10.0', '1.9.0')).toBe(true)
    expect(newer('1.3.0', '1.2.5')).toBe(true)
    expect(newer('1.2.5', '1.2.5')).toBe(false)
    expect(newer('1.2.5+test.abc', '1.2.4')).toBe(true)
  })

  it('has an entry for this version or a newer one, so a release says what it adds', () => {
    const { version } = JSON.parse(readFileSync(new URL('../../src-tauri/tauri.conf.json', import.meta.url), 'utf8'))
    expect(newer(version, RELEASES[0].version)).toBe(false)
  })

  it('lists releases newest first, each thing new, improved or fixed: a module that exists or a named change, said in a line', () => {
    for (let i = 1; i < RELEASES.length; i++) expect(newer(RELEASES[i - 1].version, RELEASES[i].version)).toBe(true)
    for (const r of RELEASES) {
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      for (const t of r.things) {
        expect(KIND_ORDER).toContain(t.kind)
        expect(t.line.length).toBeGreaterThan(10)
        if (t.module) expect(MODULE_BY_ID[t.module]).toBeTruthy()
        else expect(t.title).toBeTruthy()
      }
    }
  })

  it('says where a new module is, as the panel names it', () => {
    expect(whereIs('kaleido')).toBe('Effects › Kaleidoscope')
    expect(whereIs('recolour')).toBe('Colour & tone › Recolour')
  })
})
