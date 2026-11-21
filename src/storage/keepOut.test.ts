import { describe, expect, it } from 'vitest'
import { packKeepOut, readKeepOut } from './collageImages'

describe('collage keep-out marks', () => {
  const marks = { w: 3, h: 2, at: 7, data: new Uint8Array([1, 0, 1, 0, 0, 1]) }

  it('survive being saved as JSON (the desktop app) and read back', () => {
    const back = readKeepOut(JSON.parse(JSON.stringify(packKeepOut(marks))))
    expect(back && Array.from(back.data)).toEqual([1, 0, 1, 0, 0, 1])
    expect(back?.data.slice).toBeTypeOf('function')
  })

  it('read marks saved before as a plain object, which crashed the marks editor', () => {
    const old = JSON.parse(JSON.stringify(marks))
    expect(Array.from(readKeepOut(old)!.data)).toEqual([1, 0, 1, 0, 0, 1])
  })

  it("read the browser's own Uint8Array, and nothing from nonsense", () => {
    expect(readKeepOut(marks)!.data).toBe(marks.data)
    expect(readKeepOut({ w: 0, h: 0, at: 0, data: '' })).toBeUndefined()
    expect(readKeepOut(undefined)).toBeUndefined()
  })
})
