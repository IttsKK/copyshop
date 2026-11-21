import { generateGrainPlate, type ProceduralGrainParams } from './generateGrain'

/** Grain plates made off the page's thread (see grainPlates.ts). */
self.onmessage = (e: MessageEvent<{ id: number; params: ProceduralGrainParams }>) => {
  const { id, params } = e.data
  try {
    const plate = generateGrainPlate(params)
    ;(self as unknown as Worker).postMessage({ id, plate }, [plate.data.buffer])
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ id, error: (err as Error).message })
  }
}
