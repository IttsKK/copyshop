import { createStore } from './store'

/**
 * How many points the outline being drawn on the photo has so far
 * (StreakOverlay's draft): its Done stays off until there are enough to
 * close a shape, instead of doing nothing.
 */
export const draftPoints = createStore(0)

/** Points a closed outline needs. */
export const OUTLINE_POINTS = 3
