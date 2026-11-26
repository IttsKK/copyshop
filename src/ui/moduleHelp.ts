import type { StackModuleId } from './moduleCatalog'

/**
 * What each module does, for the ? in its header: a few plain sentences,
 * what it changes first, then how its on-photo parts are used. Every module
 * has one (the header shows it from here, not from the module's own code).
 */
export const MODULE_HELP: Record<StackModuleId, string[]> = {
  exposure: [
    "Corrects how bright the photo is: overall, its contrast, and its highlights and shadows on their own. Fine-tune has the whites and blacks.",
    'Auto reads the photo and sets them for you.',
  ],
  balance: [
    "Corrects the colour of the photo's own light: cooler or warmer, greener or more magenta, and how much colour it has.",
    'For a coloured look, use Colour; this puts the photo right first.',
  ],
  curve: [
    "Reshapes the photo's tones with a curve. Drag a point to bend it, click the line to add a point, double-click a point to take it away.",
    'Start from one of the ready-made curves if you like.',
  ],
  crop: [
    'Cuts the photo to an aspect ratio. It is cut before everything else, so the vignette, border and grain fit the crop.',
    'While Crop is open and you are working in it, the whole photo shows with the crop on it: drag inside to move it, a corner or side to size it. Enter, Done or a click outside Crop shows the cropped picture. All of it is one step to undo.',
  ],
  lens: [
    'What a camera lens does to a photo: bulges or pinches it, splits red and blue at the edges, softens the corners, glows round the highlights, or blurs above and below a sharp band (tilt-shift).',
    'Streaks, masks and lights bend with the distortion.',
  ],
  prism: [
    'Splits the colours apart, as light does through a prism or the edge of a glass held in front of the lens: red one way, blue the other, or a smooth rainbow between them.',
    'Straight splits the whole photo the same way; Radial splits out from the middle, none there and most at the corners. Only the light keeps the split to the bright parts and the fringes round them.',
  ],
  double: ['Blends a second photo over this one, as two exposures on one frame. Choose the photo, how it mixes in, and where it sits.'],
  stamp: ["Prints the photo's date in a corner, in the style of a point-and-shoot camera's display."],
  tone: [
    "The film's handling of light: film exposure up or down, fade the blacks, soften the highlights, darken the corners, and bring out detail with Clarity.",
  ],
  colour: [
    'Recolours the picture. A palette maps its tones to three colours; Overall then sets how much colour there is and how warm, on top of the palette.',
    "Palettes are built from each photo's own colours, so one comes out differently on every photo. More colour has a standout colour, exact palette colours, tints for the shadows and the light, and film stocks.",
  ],
  light: [
    'A glow round the bright parts: halation, the warm red bleed of film, and bloom, a soft spread of light. The threshold sets how bright a part must be to glow.',
  ],
  edges: ['Light and contrast along edges: a glow on the dark side of an edge, and Crunch, which sharpens local contrast.'],
  solarize: ['Turns the brightest tones back toward dark, as film over-exposed in the darkroom does, and can draw halo lines along strong edges.'],
  lighting: [
    "Light drawn onto parts of the photo: a window's glow, sun on a wall, a colour cast on one side.",
    "Draw a light round where it falls, or glow round a mask for light from behind it. Each has a colour, strength, soft edge and the side it comes from; it adds light, or only colours what is there.",
  ],
  leaks: [
    "Light getting in at the frame's edges, and dark burns. Pick a style, then Shuffle for another like it.",
    'Place spots on photo to add your own. To light part of the photo on purpose, use Lighting.',
  ],
  mono: ['Black and white, as black-and-white film: a colour filter changes which colours come out light or dark, and a toner tints the print.'],
  grain: ['Film grain over the picture, generated or from a scanned plate: its size, strength, and how it sits in the dark and light tones.'],
  dither: [
    'Breaks smooth gradients into bands whose edges dissolve into a stipple, as in pixel art.',
    'Click the photo to add a guide that moves the bands toward it (or away); drag it to move it, its ring to size it.',
  ],
  pixel: ["Makes the picture out of blocks, and can limit it to a few colours: a fixed palette, or the photo's own."],
  streaks: [
    'Draw a shape on the photo and the photo smears through it, in bars.',
    'Click points round the area; Enter closes it, Esc cancels. Open a streak to set it; the pencil reshapes it on the photo.',
    "Where streaks overlap, the one higher in the list is in front, and dragging a name changes the order. Each streak's … menu has Duplicate, Copy and Paste settings, and Mask, which gives that streak its own mask. The Mask row at the bottom of Streaks masks every streak.",
  ],
  glass: ['The photo seen through textured glass: reeded ribs, cut facets or ripples. Draw glass area keeps it to one part of the photo.'],
  collage: ['Lays your own images (skies, textures) into gaps found in the photo, such as the sky between buildings. Add images, pick one, then click a gap on the photo.'],
  repeat: [
    'Copies a piece of the photo: on a grid out from it, along a path you draw, or wherever you click.',
    'Make the piece here: select a subject, draw round it, or paint it. The copies go in before every other effect, so colour and grain treat them like the rest of the picture.',
  ],
  recolour: [
    'Gives parts of the photo a new colour. Select a part (click it, or drag a box round it) or draw round it: it takes a colour at once, and each new part the next one.',
    'Colour keeps the part’s own light and shade, so a grey building turned red is still lit as it was. Hue only turns the hue and keeps how much colour it has. As shot keeps the part as it was taken: Colour and Black & white leave it. Keep it out of Colour and B&W does the same for a new colour: a red building in a black and white photo.',
    'The new colours go in before the look, so its grade and grain go over them too. While you select or draw a part, Recolour is hidden so you see the photo itself.',
  ],
  kaleido: [
    'Copies the photo round a point. Slice takes a wedge of the photo from the point and copies it all the way round; Select or Draw copies just that part round it, over the photo.',
    'Mirror flips every other copy, so they meet edge to edge. Rings put it inside itself again, smaller and turned, toward the point.',
    'Move the point with Move centre. While you select or draw the part to copy, the copies are hidden so you see the photo itself.',
  ],
  halftone: ['Prints the finished picture as ink on paper: halftone dots or lines in one ink, or riso in two inks slightly out of line.'],
  surface: ['What the print is on: paper, canvas, linen, crumpled paper, or an image of your own, over the whole print. Relief lights it as a raised surface.'],
  border: ['Paper round the photo, as on a print, with its own colour and texture. A deeper bottom edge gives an instant-film frame.'],
  dust: ['Dust, hairs and scratches on the film and the scanner glass, over everything.'],
  surge: ['Uneven development: bands where the developer worked harder, coarsening the grain and lifting the density a little.'],
}
