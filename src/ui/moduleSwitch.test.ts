import { describe, expect, it } from 'vitest'
import { MODULES, inUse, startModule, stopModule } from './moduleCatalog'
import { NONE_LOOK } from './looks'

/**
 * A module's switch: switching it on from nothing (a photo with no look)
 * shows it on, and off shows off. A few have nothing to do when switched on
 * (a straight curve, exposure at 0, no second photo yet): the panel keeps
 * their switch on until their settings do something (App, stackApi.toggle).
 * A module joining them should be one that has to wait for its settings.
 */
const ON_WITH_NOTHING_TO_DO = ['exposure', 'balance', 'curve', 'double']

describe('module switches', () => {
  const none = NONE_LOOK.doc.blend
  it('only the modules that wait for their settings are on with nothing to do', () => {
    const waiting = MODULES.filter((m) => !inUse(m.id, startModule(m.id, stopModule(m.id, none)))).map((m) => m.id)
    expect(waiting.sort()).toEqual([...ON_WITH_NOTHING_TO_DO].sort())
  })
  for (const m of MODULES) {
    it(`${m.id} switches off, and on again`, () => {
      const on = startModule(m.id, stopModule(m.id, none))
      expect(inUse(m.id, stopModule(m.id, on)), 'off').toBe(false)
      if (!ON_WITH_NOTHING_TO_DO.includes(m.id)) expect(inUse(m.id, startModule(m.id, stopModule(m.id, on))), 'on again').toBe(true)
    })
  }
})
