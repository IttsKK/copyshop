import { describe, expect, it } from 'vitest'
import { copyOf } from './versions'

describe('copyOf', () => {
  const names = ['PB065305.jpg', 'PB065326.jpg', 'P1.ORF', 'P1.jpg', 'IMG.jpg']
  it('copies by name', () => {
    expect(copyOf('PB065305_01.jpg', names)).toEqual({ of: 'PB065305.jpg', renamed: true })
    expect(copyOf('PB065326 copy.jpg', names)?.of).toBe('PB065326.jpg')
    expect(copyOf('PB065326 copy 2.jpg', names)?.of).toBe('PB065326.jpg')
    expect(copyOf('PB065326 (1).jpg', names)?.of).toBe('PB065326.jpg')
    expect(copyOf('PB065326 - Copy.jpg', names)?.of).toBe('PB065326.jpg')
    expect(copyOf('PB065326-2.jpg', names)?.of).toBe('PB065326.jpg')
    expect(copyOf('PB065326-Edit.tif', names)?.of).toBe('PB065326.jpg')
  })
  it('another kind of file of the same name', () => {
    expect(copyOf('PB065305.tif', names)).toEqual({ of: 'PB065305.jpg', renamed: false })
  })
  it('not a copy', () => {
    expect(copyOf('PB065399.jpg', names)).toBeNull()
    expect(copyOf('PB065305.jpg', names)).toBeNull()
    // A RAW and its JPEG are a pair.
    expect(copyOf('P1.jpg', names)).toBeNull()
    expect(copyOf('P1.ORF', names)).toBeNull()
  })
})
