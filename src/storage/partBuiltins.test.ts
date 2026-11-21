import { describe, expect, it } from 'vitest'
import { DEFAULT_BLEND_PARAMS, type BlendParams } from '../engine/types'
import { DEFAULT_PROCEDURAL_PARAMS } from '../sources/generateGrain'
import type { SerializedGrainSource } from '../sources/GrainSource'
import { BUILT_IN_PARTS, PART_BUILTINS } from './partBuiltins'
import { OWNS, PART_LABELS, applyPart, extractPart, type PartKind } from './parts'
import { inUse, type StackModuleId } from '../ui/moduleCatalog'

const SOURCE: SerializedGrainSource = { kind: 'procedural', id: 'procedural', name: 'Generated grain', params: DEFAULT_PROCEDURAL_PARAMS }
const KINDS = Object.keys(PART_LABELS) as PartKind[]

/** A starting edit with every module switched off, so a part's switch shows. */
const START: BlendParams = {
  ...DEFAULT_BLEND_PARAMS,
  modules: Object.fromEntries(Object.keys(DEFAULT_BLEND_PARAMS.modules).map((k) => [k, false])) as unknown as BlendParams['modules'],
}

const json = (v: unknown) => JSON.stringify(v)

describe('built-in parts', () => {
  it('has 3 to 5 for every kind, with plain unique names and ids', () => {
    for (const kind of KINDS) {
      const list = PART_BUILTINS[kind]
      expect(list.length, kind).toBeGreaterThanOrEqual(3)
      expect(list.length, kind).toBeLessThanOrEqual(5)
      const names = list.map((b) => b.name)
      expect(new Set(names).size, kind).toBe(names.length)
      for (const n of names) expect(n.trim(), kind).toBe(n)
    }
    const ids = BUILT_IN_PARTS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const part of BUILT_IN_PARTS) {
    const kind = part.kind
    const own = OWNS[kind]

    it(`${kind} “${part.name}” only holds its module's settings`, () => {
      const { effects, modules, ...top } = part.data.blend
      for (const k of Object.keys(top)) expect(own.blend, `${kind}: blend.${k}`).toContain(k)
      for (const k of Object.keys(effects ?? {})) expect(own.effects, `${kind}: effects.${k}`).toContain(k)
      for (const k of Object.keys(modules ?? {})) expect([own.module], `${kind}: modules.${k}`).toContain(k)
      if (part.data.grainSource) expect(own.source, `${kind}: grainSource`).toBe(true)
      expect(part.data.schemaVersion).toBeTypeOf('number')
    })

    it(`${kind} “${part.name}” parses, changes only its module, and keeps every value`, () => {
      const applied = applyPart(part.data, START, SOURCE)
      const untouched = applyPart({ blend: {} }, START, SOURCE)

      // Nothing outside the module moves.
      const a = applied.blend as unknown as Record<string, unknown>
      const b = untouched.blend as unknown as Record<string, unknown>
      for (const k of Object.keys(b)) {
        if (k === 'effects' || k === 'modules' || own.blend.includes(k as keyof BlendParams)) continue
        expect(json(a[k]), `${kind}: blend.${k}`).toBe(json(b[k]))
      }
      for (const k of Object.keys(untouched.blend.effects)) {
        if (own.effects.includes(k as keyof BlendParams['effects'])) continue
        expect(json(a.effects && (a.effects as Record<string, unknown>)[k]), `${kind}: effects.${k}`).toBe(json((untouched.blend.effects as unknown as Record<string, unknown>)[k]))
      }
      for (const k of Object.keys(untouched.blend.modules)) {
        if (k === own.module) continue
        expect(applied.blend.modules[k as keyof BlendParams['modules']], `${kind}: modules.${k}`).toBe(false)
      }

      // The parser kept every value the built-in sets: none out of range or unknown.
      const back = extractPart(kind, applied.blend, part.data.grainSource ? applied.grainSource : null)
      const sent = part.data.blend
      for (const k of own.blend) expect(json(back.blend[k as keyof typeof back.blend]), `${kind}: blend.${k}`).toBe(json(sent[k as keyof typeof sent]))
      for (const k of Object.keys(sent.effects ?? {})) {
        const want = (sent.effects as Record<string, unknown>)[k]
        const got = (back.blend.effects as Record<string, unknown>)[k]
        // The stamp's date is the photo's, kept from the edit.
        if (k === 'stamp') expect({ ...(got as object), date: '' }, `${kind}: effects.stamp`).toEqual({ ...(want as object), date: '' })
        else expect(got, `${kind}: effects.${k}`).toEqual(want)
      }
      if (own.module) expect(applied.blend.modules[own.module], `${kind}: switch`).toBe(sent.modules?.[own.module] ?? false)
      if (part.data.grainSource) expect(applied.grainSource).toEqual(part.data.grainSource)

      // It does something: the module is on and in use (the border's None is the one that switches it off).
      const off = kind === 'border' && sent.modules?.border === false
      expect(inUse(kind as StackModuleId, applied.blend), `${kind}: in use`).toBe(!off)
    })
  }

  it('keeps the photo’s date when a stamp part is applied', () => {
    const dated: BlendParams = { ...START, effects: { ...START.effects, stamp: { ...START.effects.stamp, date: '2024-06-01' } } }
    const part = BUILT_IN_PARTS.find((p) => p.kind === 'stamp')!
    expect(applyPart(part.data, dated, SOURCE).blend.effects.stamp.date).toBe('2024-06-01')
  })
})
