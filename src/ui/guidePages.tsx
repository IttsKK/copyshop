import type { ReactNode } from 'react'
import { keyLabel } from './shortcuts'
import { RestoreIcon } from './icons'
import { isDesktop } from '../platform/desktop'
import { topic, type GuideTopic } from './guideTopics'

/**
 * The Guide's Getting started pages: each topic of the walk round (its own
 * words first, from guideTopics) and then more on it, with a picture of
 * that part of the window (public/guide/start, made by scripts/guide) and
 * examples on the sample photos (public/guide/examples).
 */
const BASE = import.meta.env.BASE_URL

/** A picture of part of the window at its own size, beside the words (or across the page, for the whole window). No caption: the words beside it say what it is. */
function Shot({ src, alt, wide }: { src: string; alt: string; wide?: boolean }) {
  return (
    <figure className={`guide-shot${wide ? ' wide' : ''}`}>
      <img src={`${BASE}guide/start/${src}`} alt={alt} loading="lazy" />
    </figure>
  )
}

/** A sample photo without and with something (public/guide/examples). */
export function Example({ id, photo, label }: { id: string; photo: string; label?: string }) {
  return (
    <div className="guide-example">
      <figure>
        <img src={`${BASE}guide/examples/without@${photo}.jpg`} alt="The photo as it is" loading="lazy" />
        <figcaption>Without</figcaption>
      </figure>
      <figure>
        <img src={`${BASE}guide/examples/${id}@${photo}.jpg`} alt={label ?? 'With it'} loading="lazy" />
        <figcaption>{label ?? 'With'}</figcaption>
      </figure>
    </div>
  )
}

/** A finished photo where a module is used well, beside the original it was made from (public/guide/showcase). */
export function Showcase({ id, n }: { id: string; n: number }) {
  return (
    <div className="guide-example">
      <figure>
        <img src={`${BASE}guide/showcase/${id}-${n}-original.jpg`} alt="The original photo" loading="lazy" />
        <figcaption>Original</figcaption>
      </figure>
      <figure>
        <img src={`${BASE}guide/showcase/${id}-${n}-finished.jpg`} alt="The finished photo" loading="lazy" />
        <figcaption>Finished</figcaption>
      </figure>
    </div>
  )
}

const Icon = ({ children, label }: { children: ReactNode; label: string }) => (
  <span className="tour-icon" aria-label={label}>
    {children}
  </span>
)

export const GUIDE_PAGES: Record<GuideTopic['id'], () => ReactNode> = {
  photos: () => (
    <>
      <p>{topic('photos').text()}</p>
      <Shot wide src="photos.jpg" alt="The copyshop window with a photo open" />
      <p>
        Open is at the top right, and you can also drop a photo straight onto the window. JPEG, PNG, TIFF, HEIC and WebP files open anywhere; RAW files open in the desktop app, which
        develops them with sensible defaults.
      </p>
      {isDesktop() && (
        <p>
          Add a folder and its photos show in the library, in their own order. Photos stay where they are on your computer, and each one keeps its own edit, saved as you go, so you
          can come back to any of them later.
        </p>
      )}
      <p>
        An exported photo carries its edit inside the file. Open an export and the edit comes back, and copyshop finds the original photo to work from, so nothing is lost by
        exporting. Replace photo…, on a photo's right-click menu in the Library, puts its edit onto a better copy of the same photo (a larger file, or the RAW) with everything where it was. A new version saved over a photo in its folder is matched the same way, on its own.
      </p>
    </>
  ),
  workflow: () => (
    <>
      <p>{topic('workflow').text()}</p>
      <ol className="guide-steps">
        <li>
          <b>Pick a recipe.</b> On Recipes, Suggested for this photo lists the ones whose light colour is nearest the photo’s own. Point at one to see it on the photo, click
          to use it. Under it are the modules it set: click one to go to it.
        </li>
        <li>
          <b>Change its colours.</b> On Colour, the gradient map recolours the photo through three colours, from the shadows to the light. Drag a colour round the wheel, or
          try one of the palettes from the photo under it. Strength sets how much of the photo’s own colour it replaces.
        </li>
        <li>
          <b>Match the grain and dither.</b> On Film, set Grain’s strength and size, and Dither’s amount, for this photo’s size and detail.
        </li>
        <li>
          <b>Add an effect.</b> On Effects, Streaks: Streak a subject and click a building, a person or a car, or draw the streak. Then choose its kind: Building (lined up
          with the photo’s lines), Straight, Radial, Circle or Curve. Adjust on the photo shows its arrow: drag it to turn the streak, its middle to bend it, and the
          square at the end of the bars to set how far they run.
        </li>
        <li>
          <b>Shape the bars.</b> In the streak’s Bars tab: point at a style (Smear, Fade, Light trail…) to see it on the photo and click one to start from it, then how ragged
          the bars are (Shortest), how soft their ends are, and Changes along it, for bars that fade or change in contrast toward their ends.
        </li>
        <li>
          <b>Add a border and export.</b> On Export, choose a border (your saved ones are first) and its paper colour, then the size, and Export.
        </li>
      </ol>
      <p>Save the result as a recipe of your own at the bottom of Recipes, to start the next photo from it.</p>
    </>
  ),
  recipes: () => (
    <>
      <p>{topic('recipes').text()}</p>
      <Shot src="recipes.jpg" alt="The Recipes page" />
      <p>
        Recipes is the first page on the right. Each recipe is a set of modules with their settings, and its thumbnail is your own photo with it on. Hover over one to see it on the
        whole photo, then click it to use it. A recipe never touches what you placed on the photo yourself, like streaks, masks and repeats.
      </p>
      <p>
        From there, change anything you like in the modules. To keep a look, use Save as a recipe at the bottom of the list, and it shows up under Yours to use on any photo. On the
        In use page, Strength turns each part of the look down without changing its settings.
      </p>
    </>
  ),
  modules: () => (
    <>
      <p>{topic('modules').text()}</p>
      <Shot src="modules.jpg" alt="The rail and the In use page" />
      <p>
        Down the rail on the right: Recipes, In use, then a page for each category (Camera, Colour & tone, Light, Film & texture, Effects, Print), and Export at the bottom. Base
        photo has corrections for a photo nobody has edited yet, like a camera JPEG or a RAW file.
      </p>
      <p>
        In use lists only the modules turned on for your photo, in the order they are applied. A category page shows all of its modules, the ones not in use greyed out, ready to try.
        Add an effect, at the top, lists every module with what it does. You can type to search, like “blur”, “frame” or “date”, and click one to add it.
      </p>
      <p>New group…, beside a page’s name, makes your own page of the modules you use most, shown on the rail.</p>
    </>
  ),
  editing: () => (
    <>
      <p>{topic('editing').text()}</p>
      <Shot src="editing.jpg" alt="The Grain module" />
      <p>Each module’s header has, from the left:</p>
      <ul>
        <li>
          <b>Mask</b>: keeps the module to part of the photo (see Masks).
        </li>
        <li>
          <b>↺</b>: resets the whole module to how it starts.
        </li>
        <li>
          <b>⋯</b>: its presets, Copy settings and Paste settings (to give it the same settings on another photo), and its page in this guide.
        </li>
        <li>
          <b>The switch</b>: turns it on and off, keeping its settings.
        </li>
      </ul>
      <p>
        Double-click a slider to reset just that one, or click its number to type a value. Fine-tune, at the foot of many modules, holds the settings most looks never need, and
        every change you make is a step in History.
      </p>
    </>
  ),
  effects: () => (
    <>
      <p>{topic('effects').text()}</p>
      <Showcase id="streaks" n={1} />
      <p>
        Streaks smear the photo out from a shape. Click Streak a subject and click a building, a person or a car on the photo (or drag a box round it), then click Done, and the streak
        comes off its edge. Draw a streak lets you draw the shape yourself instead.
      </p>
      <p>
        An open streak has five tabs. Direction has its kind: Building (lines that close in, lined up with the photo’s own lines), Straight, Radial (out from a middle),
        Circle (round a middle) or Curve (along a curve), each keeping its own settings while you try the others. Bars has ready-made styles to try on it, and how long, ragged
        and soft the bars are and how they change along their length. Carries is what the bars hold: the edge’s colour, copies of the subject’s last stretch, or the subject
        itself carried on, and where along each line the colour is read. Fixes changes bars that picked up the wrong colour. Mask has its subject, kept in front of it, and
        any other masks keeping it off part of the photo.
      </p>
      <p>
        While you work on the photo, a box in the panel names what you are doing, with Cancel and Done (Esc and Enter). Each streak is a row in its module, which you open for its
        settings. Its pencil shows it on the photo with every handle it has: its shape’s points (a streak made from a subject has the subject as its shape, with Brush the subject in its box), its arrow to turn it, the middle of the arrow to bend it, the square at the end of its bars for its length, and its side lines for perspective. Each of those is also a button in its tabs, one at a time
        (Adjust on the photo and Guides in Direction, Draw where they end in Bars, Fix a part in Fixes), each with its Cancel and Done under it. Its ⋯ menu has Duplicate, Copy settings and Paste settings.
      </p>
      <Showcase id="repeat" n={1} />
      <p>
        Repeat copies a part of the photo (its piece, chosen the same way as a subject) on a grid, along a path, or wherever you click. Collage brings in pieces of other photos, and
        Glass and Lighting are drawn or set on the photo too.
      </p>
    </>
  ),
  masks: () => (
    <>
      <p>{topic('masks').text()}</p>
      <Shot wide src="masks.jpg" alt="The Masks list" />
      <p>There are five ways to make one, at the top of the Masks list or from a module’s Mask button:</p>
      <ul>
        <li>
          <b>Select subject</b>: drag a box round something or click it, and a model on your computer finds its edge. Click more parts to add them, or Leave out to take parts away.
        </li>
        <li>
          <b>Draw outline</b>: click points round it.
        </li>
        <li>
          <b>Paint</b>: brush it on by hand ([ and ] change the brush size).
        </li>
        <li>
          <b>Gradient</b> and <b>Radial</b>: a soft fade across the photo, or a soft circle or oval.
        </li>
      </ul>
      <Shot src="mask-panel.jpg" alt="Grain’s mask panel" />
      <p>
        A module’s Mask button opens its mask panel, where you tick the masks it should use and choose Inside it or Outside it. Once it is masked, the button shows the mask’s name. One mask
        can be used by any number of modules, and in the Masks list each mask’s row shows the marks of the modules it applies to, and clicking one takes you to that module.
      </p>
      <p>Follow photo, in a mask’s settings, lets the photo’s own colours set its exact edge, which helps round trees, hair and the sky between branches.</p>
    </>
  ),
  history: () => (
    <>
      <p>
        Everything is saved in History, and {keyLabel('cmd+z')} undoes edits. A snapshot saves all the current settings: use snapshots to compare edits, or click
        <Icon label="restore">
          <RestoreIcon />
        </Icon>
        on one to go back to its settings.
      </p>
      <Shot src="history.jpg" alt="Snapshots and History" />
      <p>
        History lists every change to this photo with what it was, like “Grain added” or “Streak 1: length”. Click a row to go back to it; the steps after it stay listed until you
        change something. {keyLabel('cmd+shift+z')} redoes.
      </p>
      <p>
        Take snapshot keeps the photo’s settings as they are now. Include streaks, masks & collage keeps those as well, so going back to the snapshot puts them back too. Each photo
        has its own history and snapshots.
      </p>
    </>
  ),
  export: () => (
    <>
      <p>{topic('export').text()}</p>
      <Shot src="export.jpg" alt="The Export page" />
      <p>
        Export is at the bottom of the rail, or {keyLabel('cmd+e')}. The border is at the top: None, your saved borders, or a style, and its paper colour. Choose the size: the full photo, a long edge you set, or 1080 pixels wide for Instagram. Exports are never
        cropped, since framing is done in the Crop module, and if the photo is too tall or too wide for Instagram, the page offers to crop it to fit.
      </p>
    </>
  ),
  help: () => (
    <>
      <p>{topic('help').text()}</p>
      <p>
        This guide opens from ? at the top right, from {keyLabel('cmd+k')} (type “guide”), and from How it works in any module’s ⋯ menu, which opens that module’s page.
      </p>
    </>
  ),
}
