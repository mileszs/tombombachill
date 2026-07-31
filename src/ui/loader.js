import { fog } from '../palette.js'

/**
 * The loading screen that covers the ~800ms it takes to build the world.
 *
 * Without it you see the title and button sitting over an empty page: the
 * overlay is plain HTML so it paints as soon as the document is ready, while
 * the scene can't appear until the terrain, trees, clutter and textures are
 * all built and every shader compiled.
 */
export function createLoader() {
  const app = document.querySelector('#app')
  const element = document.querySelector('#loader')

  // Read the colour from the palette rather than hard-coding it in CSS, so the
  // loading screen is literally the same colour as the fog it dissolves into
  // and stays matched if the fog is retuned.
  element.style.backgroundColor = `#${fog.color.toString(16).padStart(6, '0')}`

  return {
    reveal() {
      app.classList.add('is-ready')
    },
  }
}

/**
 * Resolve once the browser has actually put a frame on screen.
 *
 * One rAF only guarantees we're *before* the next paint; the second fires
 * after it. This matters because the world build is synchronous — without
 * yielding for a real paint first, the loading screen would never be shown at
 * all, and the block would happen behind a blank page instead.
 */
export function nextPaint() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  })
}
