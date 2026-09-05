import GUI from 'lil-gui'
import { light, fog, surface } from '../palette.js'
import { TONE_MAPPINGS, applyToneMapping } from '../core/renderer.js'
import { applyLighting } from '../scene/lighting.js'
import { CAMERA, OCCLUSION } from '../config.js'

/**
 * Live controls over palette.js. Toggle with the backtick key.
 *
 * Two classes of value, handled differently:
 *
 *  - `light` and `fog` are read by objects that already exist, so they apply
 *    on every frame of a drag (onChange).
 *  - `surface` colours are *baked* — into vertex colour buffers, into
 *    canvas-painted textures, into shared materials built at construction —
 *    so changing one means rebuilding the world. Those are debounced: the
 *    rebuild fires once the value stops moving, which keeps a colour-picker
 *    drag from rebuilding a few thousand instances per frame while still
 *    responding without the user having to click away.
 *    (lil-gui's own onFinishChange fires on *blur* for colour inputs, which
 *    would leave the scene looking broken until you clicked elsewhere.)
 *
 * Colour and number controls are separate calls on purpose. A palette colour
 * is a plain number (0x4a7538) and so is a tile size (11) — nothing at runtime
 * can tell them apart, so the call site has to say which it is.
 */

/**
 * Both, because `event.key` is the character *produced*: the backtick key alone
 * gives '`' and only Shift gives '~'. Listening for '~' alone meant the panel
 * opened on Shift+backtick while the console line below told you to press
 * backtick, so the one tool for tuning the whole art direction looked broken.
 */
const TOGGLE_KEYS = new Set(['`', '~'])

/** Long enough to coalesce a drag, short enough to feel like a response. */
const REBUILD_DEBOUNCE_MS = 220

export function createDebugPanel({ renderer, getWorld, rebuildWorld }) {
  const gui = new GUI({ title: 'Tom Bombachill — palette' })
  gui.domElement.style.display = 'none'
  let visible = false

  const relight = () => applyLighting(getWorld().lighting, CAMERA.target)

  const refog = () => {
    const { scene } = getWorld()
    scene.fog.color.set(fog.color)
    scene.fog.near = fog.near
    scene.fog.far = fog.far
    // Background tracks the fog, or distant geometry dissolves towards a
    // different colour than the sky behind it.
    scene.background.set(fog.color)
  }

  // --- live: applies while you drag ---
  const liveColor = (f, target, key) => f.addColor(target, key).onChange(relight)
  const liveNum = (f, target, key, min, max, step) =>
    f.add(target, key, min, max, step).onChange(relight)

  // --- baked: rebuilds the world once the value settles ---
  let pendingRebuild = null
  const scheduleRebuild = () => {
    clearTimeout(pendingRebuild)
    pendingRebuild = setTimeout(() => {
      pendingRebuild = null
      rebuildWorld()
    }, REBUILD_DEBOUNCE_MS)
  }

  const bakedColor = (f, target, key) => f.addColor(target, key).onChange(scheduleRebuild)
  const bakedNum = (f, target, key, min, max, step) =>
    f.add(target, key, min, max, step).onChange(scheduleRebuild)

  /** An array of swatches, e.g. the five leaf greens. */
  const bakedSwatches = (f, array, label) =>
    array.forEach((_, i) => bakedColor(f, array, i).name(`${label} ${i + 1}`))

  // ---- Render ----------------------------------------------------------
  const render = gui.addFolder('Render')
  render
    .add(light, 'toneMapping', Object.keys(TONE_MAPPINGS))
    .name('tone mapping')
    .onChange(() => applyToneMapping(renderer))
  render
    .add(light, 'exposure', 0, 4, 0.01)
    .name('exposure')
    .onChange(() => applyToneMapping(renderer))

  // ---- Fog -------------------------------------------------------------
  const fogFolder = gui.addFolder('Fog')
  fogFolder.addColor(fog, 'color').onChange(refog)
  fogFolder.add(fog, 'near', 0, 120, 1).onChange(refog)
  fogFolder.add(fog, 'far', 10, 260, 1).onChange(refog)

  // ---- Lights ----------------------------------------------------------
  const key = gui.addFolder('Key light')
  liveColor(key, light.key, 'color')
  liveNum(key, light.key, 'intensity', 0, 8, 0.05)
  liveNum(key, light.key, 'elevationDeg', 2, 80, 0.5).name('elevation°')
  liveNum(key, light.key, 'azimuthDeg', 0, 360, 1).name('azimuth°')

  const fill = gui.addFolder('Fill light')
  liveColor(fill, light.fill, 'color').name('sky colour')
  liveColor(fill, light.fill, 'groundColor').name('ground bounce')
  liveNum(fill, light.fill, 'intensity', 0, 3, 0.01)

  const ambient = gui.addFolder('Ambient')
  liveColor(ambient, light.ambient, 'color')
  liveNum(ambient, light.ambient, 'intensity', 0, 2, 0.01)

  const shadow = gui.addFolder('Shadow')
  liveNum(shadow, light.shadow, 'radius', 0, 24, 0.5)
  liveNum(shadow, light.shadow, 'bias', -0.002, 0.002, 0.0001)
  liveNum(shadow, light.shadow, 'normalBias', 0, 0.2, 0.002)
  liveNum(shadow, light.shadow, 'extent', 20, 120, 1)

  // ---- Surface: everything below rebuilds on release -------------------
  const ground = gui.addFolder('Ground — rebuilds')
  bakedColor(ground, surface.ground, 'moss')
  bakedColor(ground, surface.ground, 'dryGrass')
  bakedColor(ground, surface.ground, 'soil')
  bakedNum(ground, surface.ground, 'blendJitter', 0, 1, 0.01)
  bakedNum(ground, surface.ground, 'tileSize', 2, 30, 0.5)
  bakedColor(ground, surface.ground, 'standShade').name('under a stand')
  bakedNum(ground, surface.ground, 'standShadeStrength', 0, 1, 0.01).name('stand shade amount')
  bakedColor(ground, surface.ground, 'rootShade').name('trunk contact')
  bakedNum(ground, surface.ground, 'rootShadeStrength', 0, 1, 0.01).name('contact amount')

  // ---- Occlusion: live, read fresh every frame -----------------------
  // Worth having a panel for: none of these had ever been seen until the fade
  // was fixed, so they are the least-tuned numbers in the project.
  const occ = gui.addFolder('Occluder fade')
  occ.add(OCCLUSION, 'fadedOpacity', 0, 1, 0.01).name('faded to')
  occ.add(OCCLUSION, 'playerClearance', 0, 3, 0.05).name('canopy clearance (m)')
  occ.add(OCCLUSION, 'trunkClearance', 0, 3, 0.05).name('trunk clearance (m)')
  occ.add(OCCLUSION, 'fadeSpeed', 0.5, 20, 0.5).name('fade speed')

  const grass = gui.addFolder('Grass texture — rebuilds')
  bakedColor(grass, surface.grass, 'base')
  bakedSwatches(grass, surface.grass.blades, 'blade')
  for (const name of ['patchLight', 'patchDark', 'flowerWarm', 'flowerPink']) {
    bakedColor(grass, surface.grass[name], 'color').name(name)
    bakedNum(grass, surface.grass[name], 'alpha', 0, 1, 0.01).name(`${name} alpha`)
  }

  const trees = gui.addFolder('Trees — rebuilds')
  bakedSwatches(trees, surface.bark, 'bark')
  bakedSwatches(trees, surface.leaf, 'leaf')
  bakedColor(trees, surface.canopyShade, 'low').name('canopy shade (cool)')
  bakedColor(trees, surface.canopyShade, 'high').name('canopy light (warm)')

  const clutter = gui.addFolder('Clutter — rebuilds')
  bakedSwatches(clutter, surface.clutter.fern, 'fern')
  bakedSwatches(clutter, surface.clutter.tuft, 'tuft')
  for (const name of [
    'flowerStem',
    'flowerPetal',
    'flowerCenter',
    'mushroomCap',
    'mushroomStem',
    'boulderStone',
    'boulderMoss',
    'tintLow',
    'tintHigh',
  ]) {
    bakedColor(clutter, surface.clutter, name)
  }

  const props = gui.addFolder('Props — rebuilds')
  for (const name of Object.keys(surface.boombox)) bakedColor(props, surface.boombox, name)
  bakedColor(props, surface.blobShadow, 'color').name('blob shadow')
  bakedNum(props, surface.blobShadow, 'core', 0, 1, 0.01).name('blob centre')
  bakedNum(props, surface.blobShadow, 'mid', 0, 1, 0.01).name('blob midpoint')

  for (const folder of [occ, grass, trees, clutter, props]) folder.close()

  const toggle = (event) => {
    if (!TOGGLE_KEYS.has(event.key)) return
    visible = !visible
    gui.domElement.style.display = visible ? '' : 'none'
  }
  window.addEventListener('keydown', toggle)

  console.info('[palette] press ` to toggle the palette panel')

  return {
    gui,
    dispose() {
      window.removeEventListener('keydown', toggle)
      gui.destroy()
    },
  }
}
