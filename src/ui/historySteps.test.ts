import { describe, expect, it } from 'vitest'
import { groupSteps, historyView, OLDEST, OPENED, travel, type StepEntry } from './historySteps'

type E = StepEntry<string>
const entry = (state: string, title: string, at = 0): E => ({ state, label: title.toLowerCase(), title, at, named: false })

/** Undo or redo one step, as useEditHistory did before jumpTo. */
function stepOnce(past: E[], future: E[], now: string, back: boolean) {
  const p = past.slice()
  const f = future.slice()
  const e = back ? p.pop() : f.pop()
  if (!e) return null
  ;(back ? f : p).push({ ...e, state: now })
  return { past: p, future: f, state: e.state }
}

// Opened at "A"; steps to B, C, D. past holds the state before each step.
const PAST = [entry('A', 'One', 1), entry('B', 'Two', 2), entry('C', 'Three', 3)]

describe('travel', () => {
  it('goes back as repeated undo would', () => {
    let s = { past: PAST, future: [] as E[], state: 'D' }
    for (let i = 0; i < 3; i++) s = stepOnce(s.past, s.future, s.state, true)!
    const went = travel(PAST, [], 'D', 0)!
    expect(went.state).toBe('A')
    expect(went.past).toEqual(s.past)
    expect(went.future).toEqual(s.future)
    expect(went.moved.map((e) => e.title)).toEqual(['Three', 'Two', 'One'])
  })

  it('comes forward as repeated redo would, after going back', () => {
    const back = travel(PAST, [], 'D', 1)!
    expect(back.state).toBe('B')
    let s = { past: back.past, future: back.future, state: back.state }
    s = stepOnce(s.past, s.future, s.state, false)!
    s = stepOnce(s.past, s.future, s.state, false)!
    const forward = travel(back.past, back.future, back.state, 3)!
    expect(forward.state).toBe('D')
    expect(forward.past).toEqual(s.past)
    expect(forward.future).toEqual(s.future)
    // Back where it started.
    expect(forward.past).toEqual(PAST)
    expect(forward.future).toEqual([])
  })

  it('keeps titles and times with the steps', () => {
    const back = travel(PAST, [], 'D', 0)!
    expect(historyView(back.past, back.future, 0, false).steps.map((s) => s.title)).toEqual([OPENED, 'One', 'Two', 'Three'])
    expect(back.future.map((e) => e.at)).toEqual([3, 2, 1])
  })

  it('does nothing for the current row or one out of range', () => {
    expect(travel(PAST, [], 'D', 3)).toBeNull()
    expect(travel(PAST, [], 'D', 4)).toBeNull()
    expect(travel(PAST, [], 'D', -1)).toBeNull()
    expect(travel(PAST, [], 'D', 1.5)).toBeNull()
  })

  it('does not change the lists it is given', () => {
    const past = PAST.slice()
    travel(past, [], 'D', 0)
    expect(past).toEqual(PAST)
  })
})

describe('historyView', () => {
  it('lists the photo as opened, the steps, then the undone ones in order', () => {
    const back = travel(PAST, [], 'D', 1)!
    const v = historyView(back.past, back.future, 0, false)
    expect(v.steps.map((s) => s.title)).toEqual([OPENED, 'One', 'Two', 'Three'])
    expect(v.current).toBe(1)
  })

  it('says when the oldest steps were dropped', () => {
    expect(historyView(PAST, [], 0, true).steps[0].title).toBe(OLDEST)
  })
})

describe('groupSteps', () => {
  const view = (titles: string[], current: number) => ({ steps: [OPENED, ...titles].map((title, at) => ({ title, at })), current })

  it('folds runs of the same title, the newest one standing for the run', () => {
    const g = groupSteps(view(['Grain: strength', 'Grain: strength', 'Grain: strength', 'Tone: fade'], 4))
    expect(g.map((x) => [x.title, x.count, x.index, x.when])).toEqual([
      [OPENED, 1, 0, 'past'],
      ['Grain: strength', 3, 3, 'past'],
      ['Tone: fade', 1, 4, 'current'],
    ])
  })

  it('never runs across the current row', () => {
    const g = groupSteps(view(['Crop', 'Crop', 'Crop', 'Crop'], 2))
    expect(g.map((x) => [x.count, x.index, x.when])).toEqual([
      [1, 0, 'past'],
      [2, 2, 'current'],
      [2, 4, 'future'],
    ])
  })

  it('keeps Opened on its own', () => {
    const g = groupSteps({ steps: [{ title: OPENED, at: 0 }, { title: OPENED, at: 1 }], current: 1 })
    expect(g).toHaveLength(2)
  })
})
