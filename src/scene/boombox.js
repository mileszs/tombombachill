import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshLambertMaterial } from 'three'
import { PROPS } from '../config.js'
import { surface } from '../palette.js'
import { terrainHeight } from '../util/terrain.js'

/**
 * A boombox sitting on a cut stump — the anchor for the audio engine that
 * comes next, so it's returned as a named group.
 */

/**
 * Built per call rather than once at module scope. A module-level object would
 * freeze the palette's values at import — and worse, its materials would be
 * disposed on a rebuild and then handed straight back out again.
 */
function makeMaterials() {
  const lambert = (color) => new MeshLambertMaterial({ color, flatShading: true })
  return {
    bark: lambert(surface.boombox.stumpSide),
    stumpTop: lambert(surface.boombox.stumpTop),
    shell: lambert(surface.boombox.shell),
    trim: lambert(surface.boombox.trim),
    speaker: lambert(surface.boombox.speaker),
    accent: lambert(surface.boombox.accent),
  }
}

/**
 * Scale reference: the halfling is PROPS.playerHeight (1.15 m). The stump is
 * knee height on him and the boombox is a box he could carry by its handle —
 * roughly a 1980s portable, about half a metre across.
 */
const STUMP_HEIGHT = 0.45

function createStump(MATERIALS) {
  const stump = new Mesh(
    new CylinderGeometry(0.3, 0.38, STUMP_HEIGHT, 12, 1),
    // CylinderGeometry groups are [side, top, bottom].
    [MATERIALS.bark, MATERIALS.stumpTop, MATERIALS.bark],
  )
  stump.position.y = STUMP_HEIGHT / 2
  stump.castShadow = true
  stump.receiveShadow = true
  return stump
}

function addPart(parent, geometry, material, [x, y, z]) {
  const mesh = new Mesh(geometry, material)
  mesh.position.set(x, y, z)
  mesh.castShadow = true
  mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

function createBoomboxBody(MATERIALS) {
  const body = new Group()

  const width = 0.52
  const height = 0.28
  const depth = 0.19

  addPart(body, new BoxGeometry(width, height, depth), MATERIALS.shell, [0, height / 2, 0])

  // Speakers: shallow cylinders laid on their side, flush with the front face.
  const front = depth / 2
  for (const x of [-0.155, 0.155]) {
    const rim = addPart(
      body,
      new CylinderGeometry(0.082, 0.082, 0.016, 16),
      MATERIALS.trim,
      [x, height / 2, front],
    )
    rim.rotation.x = Math.PI / 2

    const cone = addPart(
      body,
      new CylinderGeometry(0.061, 0.061, 0.016, 16),
      MATERIALS.speaker,
      [x, height / 2, front + 0.008],
    )
    cone.rotation.x = Math.PI / 2
  }

  // Cassette deck and a row of buttons between the speakers.
  addPart(body, new BoxGeometry(0.16, 0.11, 0.016), MATERIALS.speaker, [0, height / 2 + 0.037, front])
  for (let i = 0; i < 4; i++) {
    addPart(
      body,
      new BoxGeometry(0.026, 0.018, 0.013),
      i === 3 ? MATERIALS.accent : MATERIALS.trim,
      [-0.055 + i * 0.036, 0.043, front],
    )
  }

  // Handle: two posts and a bar.
  const handleHeight = 0.09
  for (const x of [-0.13, 0.13]) {
    addPart(body, new BoxGeometry(0.018, handleHeight, 0.018), MATERIALS.trim, [
      x,
      height + handleHeight / 2,
      0,
    ])
  }
  addPart(body, new BoxGeometry(0.278, 0.018, 0.018), MATERIALS.trim, [
    0,
    height + handleHeight,
    0,
  ])

  return body
}

export function createBoombox() {
  const group = new Group()
  group.name = 'boombox'

  const MATERIALS = makeMaterials()

  const [x, , z] = PROPS.boomboxPosition
  group.position.set(x, terrainHeight(x, z) - 0.03, z)

  group.add(createStump(MATERIALS))

  const body = createBoomboxBody(MATERIALS)
  body.position.y = STUMP_HEIGHT
  // Angled a little off-axis so it doesn't read as flat-on to the camera.
  body.rotation.y = -0.35
  group.add(body)

  return group
}
