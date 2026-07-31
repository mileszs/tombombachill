import './style.css'
import { createRenderer, resizeRenderer } from './core/renderer.js'
import { createCameraRig } from './core/camera.js'
import { CAMERA } from './config.js'
import { createWorld, disposeWorld } from './scene/index.js'
import { createOverlay } from './ui/overlay.js'
import { createInput } from './core/input.js'
import { createDebugPanel } from './ui/debugPanel.js'
import { createLoader, nextPaint } from './ui/loader.js'

const container = document.querySelector('#scene')

const loader = createLoader()
const renderer = createRenderer(container)
const rig = createCameraRig(container.clientWidth / Math.max(container.clientHeight, 1))
const { camera } = rig
const input = createInput()

// Hand the browser a frame before we block it. Everything below this line is
// synchronous and takes the best part of a second, so without this yield the
// loading screen would never actually reach the screen.
await nextPaint()

// Reassigned when the debug panel changes a value that's baked in at build
// time, so the render loop reads it through the binding rather than capturing.
let world = createWorld(renderer)

const overlay = createOverlay({
  onEnter() {
    // The front door. Drops the title and pushes the camera in from the wide
    // establishing shot to the walking one — at 30 the boombox is seven pixels
    // tall, and the game wants to reveal less than the ears do.
    // TODO: this is also where the AudioContext gets unlocked (Phase 2).
    overlay.dismiss()
    rig.setViewSize(CAMERA.walkViewSize)
  },
})

createDebugPanel({
  renderer,
  getWorld: () => world,
  rebuildWorld() {
    disposeWorld(world)
    world = createWorld(renderer)
  },
})

function handleResize() {
  rig.setAspect(resizeRenderer(renderer, container))
}

window.addEventListener('resize', handleResize)
handleResize()

// The player sprite is fetched over the network while everything else is built
// synchronously, so wait for it too — otherwise the reveal can catch him as an
// untextured white quad.
await world.ready

// Draw one frame before revealing. This is where three compiles every shader
// and uploads every texture — doing it behind the loading screen means the
// reveal is a clean cross-fade rather than a stutter.
world.update(0, rig, input)
renderer.render(world.scene, camera)
await nextPaint()
loader.reveal()

/**
 * Delta-time loop. Everything that moves is expressed per second and
 * multiplied by dt here, so the walk covers the same ground at 30fps as at
 * 144. The clamp matters: switching tabs hands back one enormous frame, and
 * without it the player would teleport across the forest — through trunks,
 * since collision only ever corrects the position it is given.
 */
const MAX_FRAME = 1 / 20
let previous = performance.now()

renderer.setAnimationLoop((time) => {
  const dt = Math.min((time - previous) / 1000, MAX_FRAME)
  previous = time
  world.update(dt, rig, input)
  renderer.render(world.scene, camera)
})
