import { describe, expect, it } from 'vitest'
import { thumbCurrent, thumbKey } from './photoEdits'

describe('an edit’s thumbnail', () => {
  it('is current when drawn for this edit by this build', () => {
    expect(thumbCurrent({ thumb: 'data:x', thumbFor: thumbKey(5), updatedAt: 5 })).toBe(true)
  })
  it('is out of date once the edit changes after it was drawn', () => {
    expect(thumbCurrent({ thumb: 'data:x', thumbFor: thumbKey(5), updatedAt: 6 })).toBe(false)
  })
  it('is out of date when drawn by another build, or with no record of what it was drawn for', () => {
    expect(thumbCurrent({ thumb: 'data:x', thumbFor: '5@1.0.0', updatedAt: 5 })).toBe(false)
    expect(thumbCurrent({ thumb: 'data:x', updatedAt: 5 })).toBe(false)
  })
  it('is out of date when there is none', () => {
    expect(thumbCurrent({ thumb: '', thumbFor: thumbKey(5), updatedAt: 5 })).toBe(false)
  })
})
