/**
 * Walk input. WASD and the arrow keys, or a finger dragged anywhere on the
 * scene, read as a direction rather than as events, because movement is
 * sampled once per frame by the update loop.
 *
 * The touch control is a floating stick that is never drawn. Put a thumb down
 * anywhere and the walk goes from there towards where it slides. There is no
 * HUD, so there is nothing to show. The halfling's feet are the feedback.
 *
 * The only verb is go.
 */

import { TOUCH } from '../config.js'

const LEFT = new Set(['KeyA', 'ArrowLeft'])
const RIGHT = new Set(['KeyD', 'ArrowRight'])
const FORWARD = new Set(['KeyW', 'ArrowUp'])
const BACK = new Set(['KeyS', 'ArrowDown'])

export function createInput(target = window, surface = null) {
  const held = new Set()

  // One finger at a time. A second touch is ignored rather than re-anchoring,
  // so resting a palm on the glass does not yank the walk somewhere else.
  const stick = { id: null, originX: 0, originY: 0, x: 0, y: 0 }

  const onPointerDown = (event) => {
    if (stick.id !== null || event.button > 0) return
    stick.id = event.pointerId
    stick.originX = stick.x = event.clientX
    stick.originY = stick.y = event.clientY
    // Keeps the drag ours when the finger slides off the canvas edge.
    surface.setPointerCapture?.(event.pointerId)
    event.preventDefault()
  }
  const onPointerMove = (event) => {
    if (event.pointerId !== stick.id) return
    stick.x = event.clientX
    stick.y = event.clientY
  }
  const onPointerEnd = (event) => {
    if (event.pointerId === stick.id) stick.id = null
  }

  const onDown = (event) => {
    if (event.repeat) return
    held.add(event.code)
    // Arrows scroll the page otherwise, which fights the walk.
    if (event.code.startsWith('Arrow')) event.preventDefault()
  }
  const onUp = (event) => held.delete(event.code)
  // Keys held while the tab loses focus never send a keyup, so the player
  // would walk off on their own until you pressed and released again.
  const onBlur = () => {
    held.clear()
    stick.id = null
  }

  target.addEventListener('keydown', onDown)
  target.addEventListener('keyup', onUp)
  target.addEventListener('blur', onBlur)
  surface?.addEventListener('pointerdown', onPointerDown)
  surface?.addEventListener('pointermove', onPointerMove)
  surface?.addEventListener('pointerup', onPointerEnd)
  surface?.addEventListener('pointercancel', onPointerEnd)
  surface?.addEventListener('lostpointercapture', onPointerEnd)

  const any = (codes) => {
    for (const code of codes) if (held.has(code)) return true
    return false
  }

  /**
   * Current walk direction on the XZ plane, or zeros when standing still.
   * Normalising the keys here is what keeps diagonals from being √2 times
   * faster than the cardinals.
   *
   * The keys always give unit length. The stick gives *up to* unit length:
   * a short drag ambles, a long one walks at full speed. Slowness is a
   * material, and a thumb can do it where a key cannot.
   *
   * Directions are in *screen* space — up on the keyboard means up the screen.
   * The camera is rotated 30° off the world axis, so the caller has to rotate
   * this into world space; see player.js.
   */
  return {
    read(out) {
      if (stick.id !== null) return readStick(out)

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
      surface?.removeEventListener('pointerdown', onPointerDown)
      surface?.removeEventListener('pointermove', onPointerMove)
      surface?.removeEventListener('pointerup', onPointerEnd)
      surface?.removeEventListener('pointercancel', onPointerEnd)
      surface?.removeEventListener('lostpointercapture', onPointerEnd)
      held.clear()
      stick.id = null
    },
  }

  function readStick(out) {
    // Screen Y grows downwards; walk Y is up the screen.
    const dx = stick.x - stick.originX
    const dy = stick.originY - stick.y
    const length = Math.hypot(dx, dy)
    // Read at call time, not captured, so the debug panel can tune them live.
    const { deadZone, fullSpeedAt } = TOUCH
    if (length <= deadZone) {
      out.x = 0
      out.y = 0
      return out
    }
    const strength = Math.min(1, (length - deadZone) / Math.max(fullSpeedAt - deadZone, 1))
    out.x = (dx / length) * strength
    out.y = (dy / length) * strength
    return out
  }
}
