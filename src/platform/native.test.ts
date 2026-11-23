import { describe, expect, it } from 'vitest'
import { extensionOf, withExtension } from './native'

describe('withExtension', () => {
  it('adds the offered extension to a name typed without one', () => {
    expect(withExtension('C:\\Users\\me\\Pictures\\sunset', 'IMG_1234.jpg')).toBe('C:\\Users\\me\\Pictures\\sunset.jpg')
    expect(withExtension('/home/me/sunset', '/home/me/IMG_1234.png')).toBe('/home/me/sunset.png')
  })

  it('leaves a name that has an extension as it is', () => {
    expect(withExtension('C:\\Pictures\\sunset.jpeg', 'IMG_1234.jpg')).toBe('C:\\Pictures\\sunset.jpeg')
    expect(withExtension('/Users/me/sunset.JPG', 'IMG_1234.jpg')).toBe('/Users/me/sunset.JPG')
  })

  it('does not take a dot in a folder name for an extension', () => {
    expect(extensionOf('C:\\my.photos\\sunset')).toBe('')
    expect(withExtension('/Users/me/my.photos/sunset', 'a.jpg')).toBe('/Users/me/my.photos/sunset.jpg')
  })
})
