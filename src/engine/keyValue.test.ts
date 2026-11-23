import { expect, it } from 'vitest'
import { keyValue, packKeyColour } from './keyValue'

it('a key on a colour: like it in sun and shade, not like other hues of the same brightness', () => {
  const green: [number, number, number] = [0.3, 0.5, 0.25]
  const v = (c: number[]) => keyValue(c[0], c[1], c[2], 'colour', green)
  expect(v(green)).toBe(1)
  expect(v([0.2, 0.34, 0.17])).toBeGreaterThan(v([0.43, 0.38, 0.5]))
  expect(v([0.2, 0.34, 0.17])).toBeGreaterThan(0.75)
  expect(v([0.5, 0.36, 0.3])).toBeLessThan(0.75)
})

it('brightness and blue keys read as before', () => {
  expect(keyValue(1, 1, 1, 'brightness', undefined)).toBeCloseTo(1)
  expect(keyValue(0.2, 0.4, 0.9, 'blue', undefined)).toBe(0.9)
  expect(packKeyColour([1, 0.5, 0])).toBe(255 * 65536 + 128 * 256)
})
