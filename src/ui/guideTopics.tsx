import type { ReactNode } from 'react'
import { keyLabel } from './shortcuts'
import { RestoreIcon } from './icons'
import { libraryAvailable } from '../storage/library'
import { isDesktop } from '../platform/desktop'

/**
 * How copyshop works, a topic at a time: the walk round's steps (Tour) and
 * the Guide's Getting started pages are the same words, kept here, so
 * changing one changes both. The Guide's pages say more (guidePages).
 */
export interface GuideTopic {
  id: 'photos' | 'workflow' | 'recipes' | 'modules' | 'editing' | 'effects' | 'masks' | 'history' | 'export' | 'help'
  title: string
  text: () => ReactNode
}

export const GUIDE_TOPICS: GuideTopic[] = [
  {
    id: 'photos',
    title: 'Bring in your photos',
    text: () =>
      libraryAvailable()
        ? 'Open a photo, or add a folder: your library shows every photo you’ve added or opened. Each photo saves its edits automatically.'
        : 'Open a photo, or drop one into this window. Each photo keeps its own edit in your browser.',
  },
  {
    id: 'workflow',
    title: 'A photo, start to finish',
    text: () =>
      'One way to edit a photo, in the order the pages go down the right: a recipe, its colours, grain and dither, an effect like streaks, a border, then export. Any order works, and you can go back to any step.',
  },
  {
    id: 'recipes',
    title: 'Start from a recipe, or from scratch',
    text: () =>
      'A recipe is basically a starting point for a certain look. You can hover over one to see how it would look on your photo before you apply it, and you can save your own from your photos at the bottom.',
  },
  {
    id: 'modules',
    title: 'Modules',
    text: () => 'Each page is a category. In use lists the modules turned on for your photo, and Add an effect at the top lists every module so you can search through them.',
  },
  {
    id: 'editing',
    title: 'Editing modules',
    text: () => 'A module’s switch turns it on and off, and changing any of its settings turns it on too. Double-click a slider to reset it to its default.',
  },
  {
    id: 'effects',
    title: 'Effects on the photo',
    text: () =>
      'Streaks, Repeat, Collage and Glass are all made on the photo from your selections. Click a subject or draw a shape, then open it in the list to change it. You can also use the pencil icon to edit it afterwards.',
  },
  {
    id: 'masks',
    title: 'Masks',
    text: () =>
      'A mask is a selection of the photo. You can draw or place one yourself, or select an object automatically. A module’s mask button, in its header (lit here on Grain), sets which masks it uses, and whether it works only inside them or everywhere but them.',
  },
  {
    id: 'history',
    title: 'History and snapshots',
    text: () => (
      <>
        Everything is saved in History, and {keyLabel('cmd+z')} undoes edits. A snapshot saves all the current settings: use snapshots to compare edits, or click
        <span className="tour-icon" aria-label="restore">
          <RestoreIcon />
        </span>
        on one to go back to its settings.
      </>
    ),
  },
  {
    id: 'export',
    title: 'Export when you’re done',
    text: () =>
      isDesktop()
        ? 'Choose the size and format, and where you want it to go. You can open the export again later, and the edit is saved with it so you can make changes.'
        : 'The browser version exports JPEGs up to 2048 px. You can open the export again later, and the edit is saved with it so you can make changes.',
  },
  {
    id: 'help',
    title: 'Help and feedback',
    text: () =>
      'This is a project I’m maintaining on my own, so any feedback would be incredibly helpful! Under ? you can find a list of the app’s keyboard shortcuts, a button to replay this tour, and a way to let me know if anything isn’t working. Thanks for checking this out!',
  },
]

export const topic = (id: GuideTopic['id']) => GUIDE_TOPICS.find((t) => t.id === id)!
