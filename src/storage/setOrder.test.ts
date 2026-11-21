import { describe, expect, it } from 'vitest'
import type { PhotoFile } from '../platform/native'
import { RECENT } from './library'
import { moved, ordered, takenMs, type SetOrder } from './setOrder'

const f = (name: string, modified = 0, dir = '/set'): PhotoFile => ({ name, path: `${dir}/${name}`, size: 1, modified })
const names = (l: PhotoFile[]) => l.map((p) => p.name)

describe('ordered', () => {
  const photos = [f('IMG_10.jpg', 3), f('IMG_2.jpg', 1), f('IMG_1.jpg', 2)]
  it('by name, numbers as numbers', () => {
    expect(names(ordered('/set', photos, { sort: 'name', order: [] }, new Map()))).toEqual(['IMG_1.jpg', 'IMG_2.jpg', 'IMG_10.jpg'])
  })
  it('by file date', () => {
    expect(names(ordered('/set', photos, { sort: 'modified', order: [] }, new Map()))).toEqual(['IMG_2.jpg', 'IMG_1.jpg', 'IMG_10.jpg'])
  })
  it('by date taken, the file date where it is not known', () => {
    const taken = new Map([['/set/IMG_10.jpg', 0], ['/set/IMG_1.jpg', 5]])
    expect(names(ordered('/set', photos, { sort: 'taken', order: [] }, taken))).toEqual(['IMG_10.jpg', 'IMG_2.jpg', 'IMG_1.jpg'])
  })
  it('your own order: by name, photos added since at the end by name, ones gone left out', () => {
    const o: SetOrder = { sort: 'custom', order: ['IMG_2.jpg', 'gone.jpg', 'IMG_10.jpg'] }
    expect(names(ordered('/set', [...photos, f('A.jpg')], o, new Map()))).toEqual(['IMG_2.jpg', 'IMG_10.jpg', 'A.jpg', 'IMG_1.jpg'])
  })
  it('Recent as opened', () => {
    expect(names(ordered(RECENT, photos, { sort: 'opened', order: [] }, new Map()))).toEqual(names(photos))
  })
})

describe('moved', () => {
  const list = ['a', 'b', 'c', 'd'].map((n) => f(n))
  it('later and earlier', () => {
    expect(moved('/set', list, 0, 2).order).toEqual(['b', 'c', 'a', 'd'])
    expect(moved('/set', list, 3, 0).order).toEqual(['d', 'a', 'b', 'c'])
    expect(moved('/set', list, 1, 3)).toEqual({ sort: 'custom', order: ['a', 'c', 'd', 'b'] })
  })
  it('round trip through ordered', () => {
    const o = moved('/set', list, 2, 0)
    expect(names(ordered('/set', list, o, new Map()))).toEqual(['c', 'a', 'b', 'd'])
  })
})

it('takenMs', () => {
  expect(takenMs('2024-05-01 14:03')).toBe(new Date(2024, 4, 1, 14, 3).getTime())
  expect(takenMs('2024-05-01')).toBe(new Date(2024, 4, 1).getTime())
  expect(takenMs('')).toBeNull()
})
