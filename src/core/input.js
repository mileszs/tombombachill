/**
 * Keyboard walk input. WASD and the arrow keys, read as a direction rather than
 * as events, because movement is sampled once per frame by the update loop.
 *
 * The only verb is go.
 */

const LEFT = new Set(['KeyA', 'ArrowLeft'])
const RIGHT = new Set(['KeyD', 'ArrowRight'])
const FORWARD = new Set(['KeyW', 'ArrowUp'])
const BACK = new Set(['KeyS', 'ArrowDown'])

export function createInput(target = window) {
  const held = new Set()

  const onDown = (event) => {
    if (event.repeat) return
    held.add(event.code)
    // Arrows scroll the page otherwise, which fights the walk.
    if (event.code.startsWith('Arrow')) event.preventDefault()
  }
  const onUp = (event) => held.delete(event.code)
  // Keys held while the tab loses focus never send a keyup, so the player
  // would walk off on their own until you pressed and released again.
  const onBlur = () => held.clear()

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)

  const any = (codes) => {
    for (const code of codes) if (held.has(code)) return true
    return false
  }

  /**
   * Current walk direction as a unit vector on the XZ plane, or zeros when
   * standing still. Normalising here is what keeps diagonals from being
   * √2 times faster than the cardinals.
   *
   * Directions are in *screen* space — up on the keyboard means up the screen.
   * The camera is rotated 30° off the world axis, so the caller has to rotate
   * this into world space; see player.js.
   */
  return {
    read(out) {
      let x = 0
      let y = 0
      if (any(LEFT)) x -= 1
      if (any(RIGHT)) x += 1
      if (any(FORWARD)) y += 1
      if (any(BACK)) y -= 1

      const length = Math.hypot(x, y)
      out.x = length > 0 ? x / length : 0
      out.y = length > 0 ? y / length : 0
      return out
    },
    dispose() {
      target.removeEventListener('keydown', onDown)
      target.removeEventListener('keyup', onUp)
      target.removeEventListener('blur', onBlur)
      held.clear()
    },
  }
}
