import { describe, expect, it } from 'vitest'
import { keyLabel, keyText, shortcutDisplay, type Shortcut } from './shortcuts'

const shortcut = (key: string, display?: string): Shortcut => ({ key, display, label: '', group: '' })

describe('keyLabel', () => {
  it('uses the glyphs on a Mac, in the Mac order', () => {
    expect(keyLabel('cmd+shift+e', true)).toBe('⇧⌘E')
    expect(keyLabel('alt+cmd+1', true)).toBe('⌥⌘1')
    expect(keyLabel('cmd++', true)).toBe('⌘+')
    expect(keyLabel('escape', true)).toBe('Esc')
    expect(keyLabel('z', true)).toBe('Z')
  })

  it('uses words elsewhere, Ctrl first', () => {
    expect(keyLabel('cmd+shift+e', false)).toBe('Ctrl+Shift+E')
    expect(keyLabel('alt+cmd+1', false)).toBe('Ctrl+Alt+1')
    expect(keyLabel('shift+alt+cmd+r', false)).toBe('Ctrl+Alt+Shift+R')
    expect(keyLabel('cmd+,', false)).toBe('Ctrl+,')
    expect(keyLabel('escape', false)).toBe('Esc')
    expect(keyLabel('z', false)).toBe('Z')
  })
})

describe('shortcutDisplay', () => {
  it('turns glyphs in a written display into words off a Mac', () => {
    expect(shortcutDisplay(shortcut('?', '? or ⌘/'), true)).toBe('? or ⌘/')
    expect(shortcutDisplay(shortcut('?', '? or ⌘/'), false)).toBe('? or Ctrl+/')
    expect(shortcutDisplay(shortcut('cmd+]', '⌘]'), false)).toBe('Ctrl+]')
    expect(shortcutDisplay(shortcut('\\', '\\'), false)).toBe('\\')
    expect(keyText('⌥⇧⌘O', false)).toBe('Ctrl+Alt+Shift+O')
  })
})
