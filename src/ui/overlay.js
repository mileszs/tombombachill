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

  return {
    element,
    button,
    hide() {
      element.hidden = true
    },
    show() {
      element.hidden = false
    },
  }
}
