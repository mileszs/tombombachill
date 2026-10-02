import {
  BufferAttribute,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshLambertMaterial,
} from 'three'
import { CAMERA, FOREST, PROPS, SEED } from '../config.js'
import { surface } from '../palette.js'
import { noise2D, terrainHeight } from '../util/terrain.js'
import { makeRng, pick, randRange } from '../util/rng.js'
import { collectOccluder } from './occlusion.js'
import { swayCanopy } from './wind.js'

/**
 * No canopy may hang lower than this, in metres. Keeps the band at eye level
 * clear so the player — 1.15 m tall — is never walking through leaves.
 */
const CANOPY_CLEARANCE = 2.5

/**
 * How far makeCanopyGeometry pushes vertices outward when roughening. The
 * clearance guard has to know: bounding a canopy by its nominal radius
 * under-measures it by exactly this, and five canopies were dipping to 1.4 m
 * against a guarantee of 2.5.
 */
const CANOPY_ROUGHEN = 0.16
const SECOND_CANOPY_ROUGHEN = 0.2

// Deliberately not module-level Colors: a const up here is evaluated once at
// import and would ignore every later palette edit, so the debug panel's
// rebuild would appear to do nothing. Same rule everywhere in scene/.

/** The band the raw density field actually occupies — see standDensity. */
const FIELD_MIN = 0.25
const FIELD_MAX = 0.68

/**
 * Low-poly trees: a tapered cylinder trunk under one or two flat-shaded
 * icospheres. Shape, height and colour are all drawn from the shared seed.
 */

/**
 * Prototypes drawn from the bark/leaf swatches in the palette. Every tree
 * clones one of these rather than sharing it — see createTree — so these eight
 * are never rendered themselves; they exist only to be copied from.
 *
 * `vertexColors` is not decorative. Canopy geometry carries a baked warm/cool
 * ramp in a `color` attribute and needs it true; trunk geometry carries no such
 * attribute and needs it false, because a Lambert material asking for a vertex
 * colour that is not there reads (0,0,0) and renders the trunk black. That is
 * the whole reason this takes an argument.
 */
function makeMaterials(colors, vertexColors = false) {
  return colors.map(
    (color) =>
      new MeshLambertMaterial({ color, flatShading: true, vertexColors, dithering: true }),
  )
}

/**
 * Nudge each vertex outward by a random amount so no two canopies match, then
 * bake the vertical light split into vertex colours.
 *
 * IcosahedronGeometry is non-indexed, so after computeVertexNormals every
 * vertex carries its own face's normal — which means a per-vertex colour keyed
 * on normal.y lands as a clean per-facet shade, matching the flat shading.
 */
function makeCanopyGeometry(radius, rng, amount) {
  const geometry = new IcosahedronGeometry(radius, 1)
  const position = geometry.attributes.position

  for (let i = 0; i < position.count; i++) {
    const scale = 1 + randRange(rng, -amount, amount)
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale,
      position.getZ(i) * scale,
    )
  }
  position.needsUpdate = true
  geometry.computeVertexNormals()

  const normal = geometry.attributes.normal
  const colors = new Float32Array(position.count * 3)
  const shade = new Color()
  const shadeLow = new Color(surface.canopyShade.low)
  const shadeHigh = new Color(surface.canopyShade.high)

  for (let i = 0; i < normal.count; i++) {
    // Bias the ramp upward so only the genuinely sky-facing facets take the
    // warm end, and everything from the equator down falls into the cool fill.
    const upness = normal.getY(i) * 0.5 + 0.5
    shade.copy(shadeLow).lerp(shadeHigh, upness ** 0.7)
    colors[i * 3] = shade.r
    colors[i * 3 + 1] = shade.g
    colors[i * 3 + 2] = shade.b
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/** Random rotation and non-uniform scale, so no two canopies read as copies. */
function varyCanopy(canopy, rng) {
  canopy.rotation.set(
    randRange(rng, -0.4, 0.4),
    rng() * Math.PI * 2,
    randRange(rng, -0.4, 0.4),
  )
  canopy.scale.set(
    randRange(rng, 0.78, 1.3),
    randRange(rng, 0.7, 1.35),
    randRange(rng, 0.78, 1.3),
  )
}

function createTree(rng, barkMaterials, leafMaterials, out) {
  const tree = new Group()

  // Mature forest trees: 12–22 m, so roughly 10–19x the halfling's height.
  const height = randRange(rng, 12, 22)
  // A high proportion on purpose: the trunk is what keeps the canopy up out of
  // the eye-level band. Much past 0.66 and the tallest trees read as bare
  // poles with their canopies out of frame.
  const trunkHeight = height * randRange(rng, 0.5, 0.66)
  // ~0.7–1.4 m across at the base, which is a grown trunk, not a sapling.
  const bottomRadius = trunkHeight * randRange(rng, 0.035, 0.06)
  // Reported back so collision has a real radius per tree rather than one
  // average guess — these range over about 0.2 to 0.7 m.
  out.radius = bottomRadius
  const topRadius = bottomRadius * randRange(rng, 0.42, 0.78)

  const trunk = new Mesh(
    new CylinderGeometry(topRadius, bottomRadius, trunkHeight, 6, 1),
    pick(rng, barkMaterials).clone(),
  )
  trunk.position.y = trunkHeight / 2
  trunk.castShadow = true
  trunk.receiveShadow = true
  // The occluder fade tests the trunk as a capsule, and a cylinder's ends are
  // at ±height/2 in its own space — so it needs the height as well as the
  // radius to rebuild that segment in world space after the tree's lean.
  trunk.userData.isTrunk = true
  trunk.userData.trunkHeight = trunkHeight
  trunk.userData.trunkRadius = bottomRadius
  tree.add(trunk)

  // Cloned per tree: these materials are what the occlusion fade writes
  // opacity to, and the palette swatches are shared between trees. Fading a
  // shared material would ghost every tree using it. Costs nothing in draw
  // calls — each tree already has its own geometry, so its own draw call.
  // swayCanopy has to come after the clone: onBeforeCompile is a prototype
  // method on Material, so assigning it makes an own property and clone() does
  // not carry it. Patch the prototype material instead and every tree stands
  // perfectly still.
  const leafMaterial = swayCanopy(pick(rng, leafMaterials).clone())
  const canopyRadius = (height - trunkHeight) * randRange(rng, 0.34, 0.78)

  const canopy = new Mesh(makeCanopyGeometry(canopyRadius, rng, CANOPY_ROUGHEN), leafMaterial)
  varyCanopy(canopy, rng)

  let canopyY = trunkHeight + canopyRadius * randRange(rng, 0.4, 0.8)
  // Lift the whole canopy if it would hang into the eye-level band — cheaper
  // than rejecting the tree and regenerating it. Bound it by the largest scale
  // component, not scale.y: varyCanopy also rotates, so the canopy's local Y
  // isn't vertical and only its bounding sphere is rotation-invariant.
  const maxScale = Math.max(canopy.scale.x, canopy.scale.y, canopy.scale.z)
  const lowestPoint = canopyY - canopyRadius * (1 + CANOPY_ROUGHEN) * maxScale
  if (lowestPoint < CANOPY_CLEARANCE) canopyY += CANOPY_CLEARANCE - lowestPoint

  canopy.position.set(randRange(rng, -0.4, 0.4), canopyY, randRange(rng, -0.4, 0.4))
  canopy.userData.isCanopy = true
  canopy.castShadow = true
  canopy.receiveShadow = true
  tree.add(canopy)

  // Two thirds of the trees get a smaller second clump, offset to one side.
  if (rng() < 0.65) {
    const secondRadius = canopyRadius * randRange(rng, 0.4, 0.85)
    const second = new Mesh(makeCanopyGeometry(secondRadius, rng, SECOND_CANOPY_ROUGHEN), leafMaterial)
    varyCanopy(second, rng)

    const angle = rng() * Math.PI * 2
    const reach = canopyRadius * randRange(rng, 0.3, 0.7)
    let secondY = canopy.position.y + canopyRadius * randRange(rng, 0.35, 0.9)
    // The second clump needs the same guard as the first. It is placed relative
    // to the first canopy, but it can be nearly as large and scaled up again, so
    // it is quite capable of hanging lower than the canopy it sits beside.
    const secondScale = Math.max(second.scale.x, second.scale.y, second.scale.z)
    const secondLowest = secondY - secondRadius * (1 + SECOND_CANOPY_ROUGHEN) * secondScale
    if (secondLowest < CANOPY_CLEARANCE) secondY += CANOPY_CLEARANCE - secondLowest
    second.position.set(
      canopy.position.x + Math.cos(angle) * reach,
      secondY,
      canopy.position.z + Math.sin(angle) * reach,
    )
    second.userData.isCanopy = true
    second.castShadow = true
    second.receiveShadow = true
    tree.add(second)
  }

  tree.rotation.y = rng() * Math.PI * 2
  // A hair of lean, so the trunks don't all read as perfectly plumb.
  tree.rotation.x = randRange(rng, -0.04, 0.04)
  tree.rotation.z = randRange(rng, -0.04, 0.04)

  return tree
}

/**
 * How likely a tree is to stand at (x, z), in 0–1.
 *
 * Two octaves of low-frequency noise, with everything below the threshold
 * flattened to exactly zero. That flattening is the important part: merely
 * *thinning* the trees in low-density regions gives you a sparse forest, not
 * a clearing. Zeroing it means clearings are genuinely, reliably empty and
 * stay put as `count` changes — which is what makes this usable for level
 * design.
 *
 * Exported because the clearings are where the audio sources will live: this
 * is the function that says where they are.
 */
export function standDensity(x, z) {
  // The two offsets just pick which layout of stands and clearings you get;
  // this pair frames a stand in the middle distance with the spawn clearing
  // open in front of it. Change them for a different map.
  const broad = noise2D(x, z, FOREST.clusterScale, 375)
  const detail = noise2D(x, z, FOREST.clusterScale * 0.42, 481)
  const field = broad * 0.72 + detail * 0.28

  // Summed value noise piles up around its midpoint: measured over the disc
  // this field spans about 0.25–0.68, not 0–1. Renormalising across the band
  // it actually occupies is what makes clearingThreshold mean something — on
  // the raw range, a threshold of 0.45 leaves almost every point near zero and
  // the trees collapse into a few tiny knots.
  const normalized = Math.min(1, Math.max(0, (field - FIELD_MIN) / (FIELD_MAX - FIELD_MIN)))

  const above = (normalized - FOREST.clearingThreshold) / (1 - FOREST.clearingThreshold)
  if (above <= 0) return 0
  return above ** FOREST.densityContrast
}

/**
 * Propose points across the disc and keep them in proportion to the local
 * density field, so trees gather into stands. Minimum spacing still applies
 * inside a stand, so they crowd without interpenetrating.
 */
function scatterPositions(rng) {
  const positions = []
  const minSpacingSq = FOREST.minSpacing ** 2
  // Generous, because most proposals inside a clearing are rejected outright.
  const maxAttempts = 60000

  // Two guaranteed clearings. The glade round the boombox is tested *before*
  // the density draw, exactly as it always was, so the stream of random draws —
  // and with it every tree in the forest — is unchanged (see
  // PROPS.gladeCentre). The spawn's, and the sightline from it to the camera,
  // are tested *after* the draws, so they only remove trees that would have
  // stood there. A few replacements do appear elsewhere, to keep the count.
  const [gladeX, , gladeZ] = PROPS.gladeCentre
  const [spawnX, , spawnZ] = PROPS.playerPosition
  const clearSq = FOREST.clearingRadius ** 2
  // The camera's bearing on the ground: the direction from the player towards
  // the lens. The sightline corridor runs that way from the spawn.
  const yaw = (CAMERA.yawDeg * Math.PI) / 180
  const lensX = Math.sin(yaw)
  const lensZ = Math.cos(yaw)
  const inSightline = (x, z) => {
    const dx = x - spawnX
    const dz = z - spawnZ
    const along = dx * lensX + dz * lensZ
    const across = Math.abs(dx * lensZ - dz * lensX)
    return along > 0 && along < FOREST.sightline.length && across < FOREST.sightline.halfWidth
  }

  for (let attempt = 0; attempt < maxAttempts && positions.length < FOREST.count; attempt++) {
    const angle = rng() * Math.PI * 2
    // sqrt keeps proposals even across the disc; the density field, not the
    // sampling, is what does the clustering.
    const radius = Math.sqrt(rng()) * FOREST.scatterRadius
    const x = Math.cos(angle) * radius
    const z = Math.sin(angle) * radius

    if ((x - gladeX) ** 2 + (z - gladeZ) ** 2 < clearSq) continue
    if (rng() >= standDensity(x, z)) continue
    if ((x - spawnX) ** 2 + (z - spawnZ) ** 2 < clearSq) continue
    if (inSightline(x, z)) continue

    let tooClose = false
    for (const p of positions) {
      if ((p.x - x) ** 2 + (p.z - z) ** 2 < minSpacingSq) {
        tooClose = true
        break
      }
    }
    if (tooClose) continue

    positions.push({ x, z })
  }

  if (positions.length < FOREST.count) {
    console.warn(
      `[forest] placed ${positions.length}/${FOREST.count} trees — the stands ` +
        'are saturated. Lower FOREST.minSpacing, or lower clearingThreshold / ' +
        'densityContrast to give the trees more ground to stand on.',
    )
  }

  return positions
}

/**
 * @returns the forest group plus the trunks as {x, z, radius} — the ground
 *   clutter needs the positions so it does not sprout through the trees, and
 *   collision needs the radii.
 */
export function createForest() {
  const rng = makeRng(SEED + 7)
  const barkMaterials = makeMaterials(surface.bark)
  // true, because makeCanopyGeometry bakes the canopyShade ramp into a `color`
  // attribute on every canopy. Without it the ramp is computed, uploaded and
  // then ignored by the GPU, and every canopy renders as a flat green ball —
  // which is exactly what it did from the initial commit until it was measured.
  const leafMaterials = makeMaterials(surface.leaf, true)

  const object = new Group()
  object.name = 'forest'

  const positions = scatterPositions(rng)
  const occluders = []
  for (const trunk of positions) {
    const { x, z } = trunk
    const tree = createTree(rng, barkMaterials, leafMaterials, trunk)
    // Sink slightly so the trunk's base never floats over a dip.
    tree.position.set(x, terrainHeight(x, z) - 0.15, z)
    object.add(tree)
    occluders.push(collectOccluder(tree))
  }

  return { object, positions, occluders }
}
