import { describe, expect, it } from 'vitest'
import { plainGpuError } from './gpuMessage'

describe('plainGpuError', () => {
  it('hides a shader log behind a plain sentence', () => {
    const m = plainGpuError("The look's shader failed to build: ERROR: 0:1532: 'uMasks' : array index out of range")
    expect(m).toMatch(/couldn't prepare the effects/)
    expect(m).not.toMatch(/ERROR|uMasks/)
  })
  it('names streaks when it is their shader', () => {
    expect(plainGpuError("The streaks' lean-3 shader failed to build: no reason given")).toMatch(/prepare streaks/)
  })
  it('says what to do in the browser and the app', () => {
    expect(plainGpuError('Shader compile failed: x', 'browser')).toMatch(/Reload the page/)
    expect(plainGpuError('Shader compile failed: x', 'desktop')).toMatch(/Restart copyshop/)
  })
  it('gives the sizes when a picture is too big', () => {
    expect(plainGpuError('Requested render is 20000×15000px but this GPU caps out at 16384px per side.')).toBe(
      'This picture is 20000×15000, larger than this graphics card can draw (16384 px a side). Choose a smaller size.',
    )
  })
  it('explains a lost context, missing WebGL 2 and a stopped worker', () => {
    expect(plainGpuError('The GPU context was lost during the render.')).toMatch(/reset while drawing/)
    expect(plainGpuError('WebGL2 is not available in this browser.', 'browser')).toMatch(/Try another browser/)
    expect(plainGpuError('The render worker stopped.')).toBe('Drawing stopped partway. Try again.')
  })
  it('leaves other messages alone', () => {
    expect(plainGpuError('Could not open IMG_1.HEIC: unsupported format')).toBeNull()
  })
})
