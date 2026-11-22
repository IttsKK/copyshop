import { describe, expect, it } from 'vitest'
import { SESSION_STORE } from '../storage/db'
import { appLinkFor, pairingFromAppLink, photoOnly } from './transfer'

const pair = { id: '0b8f4f1e-3c1a-4d0e-9a51-6d2b8c7e1f00', key: 'A'.repeat(43) }

describe('copyshop:// links', () => {
  it('round-trips a pairing', () => {
    expect(pairingFromAppLink(appLinkFor(pair))).toEqual(pair)
  })
  it('ignores anything else', () => {
    expect(pairingFromAppLink('copyshop://open')).toBeNull()
    expect(pairingFromAppLink('https://getcopyshop.com/app/#send=x')).toBeNull()
    expect(pairingFromAppLink('copyshop://open#not-a-pair')).toBeNull()
  })
  it('brings in only the photo and its edit', () => {
    const c = photoOnly({
      local: { 'grainemulator.session': '{}', 'grainemulator.snapshots': '[]' },
      stores: { [SESSION_STORE]: [{ id: 'photo' }], presets: [{ id: 'evil' }], plates: [{ id: 'p' }] },
    })
    expect(c).toEqual({ local: { 'grainemulator.session': '{}' }, stores: { [SESSION_STORE]: [{ id: 'photo' }] } })
  })
})
