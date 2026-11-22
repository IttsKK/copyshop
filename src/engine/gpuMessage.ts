/**
 * What a graphics failure means, in words for the person using copyshop. The
 * engine's own messages (a shader's compile log, "context lost") stay in the
 * reports (reportIssue); the screen shows these. null when the message isn't
 * a graphics one, so it is shown as it is.
 */
export function plainGpuError(message: string, app: 'desktop' | 'browser' = 'desktop'): string | null {
  const restart = app === 'desktop' ? 'Restart copyshop' : 'Reload the page'
  const big = message.match(/Requested render is (\d+)×(\d+)px but this GPU caps out at (\d+)px/)
  if (big) return `This picture is ${big[1]}×${big[2]}, larger than this graphics card can draw (${big[3]} px a side). Choose a smaller size.`
  if (/WebGL2 is not available|no OffscreenCanvas/i.test(message))
    return app === 'desktop'
      ? "This computer's graphics can't run copyshop's effects (WebGL 2 is missing). Updating the graphics driver may help."
      : "This browser can't run copyshop's effects (WebGL 2 is missing). Try another browser, or update this one."
  if (/streaks'.*shader (failed to build|is not built)/i.test(message))
    return `Your graphics card couldn't prepare streaks. ${restart}; if it keeps happening, update the graphics driver.`
  if (/shader failed to build|Shader compile failed|Program link failed|shader is not built/i.test(message))
    return `Your graphics card couldn't prepare the effects. ${restart}; if it keeps happening, update the graphics driver.`
  if (/context was lost|GPU context/i.test(message)) return `The graphics card was reset while drawing. Try again; if it keeps happening, ${restart.toLowerCase()}.`
  if (/render target|OUT_OF_MEMORY|out of memory/i.test(message)) return 'The graphics card ran out of memory. Close other apps or choose a smaller size, then try again.'
  if (/render worker stopped|lost its photo or grain|has been disposed/i.test(message)) return 'Drawing stopped partway. Try again.'
  return null
}
