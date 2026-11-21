import { expect, it } from 'vitest'
import { originalOf } from './exports'

it('originalOf follows exports made over exports back to the original', () => {
  const finals = new Map([
    ['c0f60f', '96dda9'],
    ['96dda9', 'b2c383'],
  ])
  expect(originalOf(finals, 'c0f60f')).toBe('b2c383')
  expect(originalOf(finals, '96dda9')).toBe('b2c383')
  expect(originalOf(finals, 'b2c383')).toBe('b2c383')
  // A loop never hangs.
  expect(['a', 'b']).toContain(originalOf(new Map([['a', 'b'], ['b', 'a']]), 'a'))
})
