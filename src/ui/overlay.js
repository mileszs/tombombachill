/**
 * The title overlay. Kept behind a tiny module so the eventual hand-off —
 * start the audio engine, hide the title, give the controls focus — has an
 * obvious place to live.
 */
export function createOverlay({ onEnter } = {}) {
  const element = document.querySelector('#overlay')
  const button = document.querySelector('#enter-forest')

  button.addEventListener('click', () => {
    onEnter?.()
  })

  const app = document.querySelector('#app')

  return {
    element,
    button,
    /** Fade the title out. A class rather than `hidden` so it can transition. */
    dismiss() {
      app.classList.add('is-walking')
    },
  }
}
