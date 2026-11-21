import { describe, expect, it } from 'vitest'
import { pack, unpack } from './bundle'
import { seal, unseal } from './seal'

const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255)
const blobBytes = async (b: unknown) => new Uint8Array(await (b as Blob).arrayBuffer())

describe('transfer bundle', () => {
  it('round-trips records with blobs in nested places, byte for byte', async () => {
    const photo = new Blob([bytes(5000, 1)], { type: 'image/jpeg' })
    const plate = new Blob([bytes(1200, 2)], { type: 'image/png' })
    const piece = new Blob([bytes(77, 3)])
    const contents = {
      local: { 'grainemulator.session': '{"doc":{"a":1}}' },
      stores: {
        session: [{ id: 'photo', name: 'IMG_1.jpg', blob: photo }],
        plates: [{ id: 'plate_1', name: 'HP5', blob: plate, width: 10, height: 20 }],
        collage: [{ id: 'c1', variants: [{ size: 1, blob: piece }], photos: [3, 4] }],
        presets: [{ id: 'p1', name: 'Dusk', data: { nested: { list: [1, 'two', null] } } }],
      },
    }
    const out = unpack(await pack(contents))
    expect(out.local).toEqual(contents.local)
    expect(out.stores.presets).toEqual(contents.stores.presets)
    expect(out.stores.session[0].name).toBe('IMG_1.jpg')
    expect(await blobBytes(out.stores.session[0].blob)).toEqual(bytes(5000, 1))
    expect((out.stores.session[0].blob as Blob).type).toBe('image/jpeg')
    expect(await blobBytes(out.stores.plates[0].blob)).toEqual(bytes(1200, 2))
    const variants = out.stores.collage[0].variants as { blob: Blob }[]
    expect(await blobBytes(variants[0].blob)).toEqual(bytes(77, 3))
    expect(out.stores.collage[0].photos).toEqual([3, 4])
  })

  it('refuses something that is not a bundle', () => {
    expect(() => unpack(bytes(100, 9))).toThrow(/not a copyshop transfer/)
  })

  it('seals with a fresh key and opens only with that key', async () => {
    const data = bytes(10_000, 5)
    const a = await seal(data)
    const b = await seal(data)
    expect(a.key).not.toBe(b.key)
    expect(a.key).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(await unseal(a.sealed, a.key)).toEqual(data)
    await expect(unseal(a.sealed, b.key)).rejects.toThrow(/could not be decrypted/)
    const tampered = a.sealed.slice()
    tampered[200] ^= 1
    await expect(unseal(tampered, a.key)).rejects.toThrow(/could not be decrypted/)
  })
})
