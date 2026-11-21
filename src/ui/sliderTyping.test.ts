import { describe, expect, it } from 'vitest'
import { percent, valueForTyped } from './controls'

const deg = (v: number) => `${Math.round(v)}°`

describe('typing a value into a slider', () => {
  it('sets exactly the whole degrees typed, negative or not', () => {
    for (const t of [-180, -91, -90, -45, -1, 0, 1, 45, 90, 179, 180]) expect(valueForTyped(t, { min: -180, max: 180, step: 1, format: deg })).toBe(t)
  })
  it('sets the percent typed on a fine step', () => {
    for (const t of [0, 1, 15, 55, 56, 99, 100]) expect(valueForTyped(t, { min: 0, max: 1, step: 0.01, format: percent })).toBeCloseTo(t / 100, 9)
  })
  it('works on a track whose reading falls as it goes', () => {
    const fall = (v: number) => `${Math.round(-v)}`
    for (const t of [-40, -3, 0, 7, 40]) expect(valueForTyped(t, { min: -50, max: 50, step: 1, format: fall })).toBe(t === 0 ? 0 : -t)
  })
  it('works through a curved track (square-root strength)', () => {
    const v = valueForTyped(64, { min: 0, max: 1, step: 0.001, format: percent, fromSlider: (p) => p * p })!
    expect(Math.round(v * 100)).toBe(64)
  })
  it('keeps to the ends, and ignores what is not a number', () => {
    expect(valueForTyped(500, { min: -180, max: 180, step: 1, format: deg })).toBe(180)
    expect(valueForTyped(-500, { min: -180, max: 180, step: 1, format: deg })).toBe(-180)
    expect(valueForTyped(NaN, { min: 0, max: 1, step: 0.01, format: percent })).toBeNull()
  })
  it('a signed reading with a plus sign', () => {
    const signed = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v)}`
    for (const t of [-20, -1, 0, 1, 20]) expect(valueForTyped(t, { min: -20, max: 20, step: 1, format: signed })).toBe(t)
  })
})
