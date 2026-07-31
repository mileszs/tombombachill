import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  InstancedMesh,
  MeshLambertMaterial,
  Object3D,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { CLUTTER, PROPS, SEED } from '../config.js'
import { surface } from '../palette.js'
import { terrainHeight } from '../util/terrain.js'
import { makeRng, randRange } from '../util/rng.js'
import {
  makeFernTexture,
  makeGrassTuftTexture,
  makeWildflowerTexture,
} from '../util/textures.js'

/**
 * The forest floor: a few thousand ferns, tufts, mushrooms, flowers and
 * boulders, one InstancedMesh per kind so the whole floor costs five draw
 * calls.
 *
 * Placement is clustered rather than uniform — real undergrowth grows in
 * patches, and an even scatter reads as texture rather than as plants.
 */

/** Alpha-tested, not blended: no sort order to get wrong among thousands. */
const CARD_ALPHA_TEST = 0.28

/** Clutter is pushed this far out of any tree trunk. */
const TRUNK_CLEARANCE = 0.9

const dummy = new Object3D()
const tintColor = new Color()
// Palette-derived Colors are built inside the functions that use them, not up
// here — a module-level const is evaluated once at import and would ignore
// later palette edits, making the debug panel's rebuild look broken.

/**
 * Crossed quads: `planes` cards through a common vertical axis, origin at the
 * base. Cheaper than per-frame billboarding — which we can't afford per
 * instance anyway — and unlike a single quad it still reads as a plant once
 * the camera starts rotating.
 */
function makeCardGeometry(width, height, planes = 2) {
  const positions = []
  const normals = []
  const uvs = []
  const indices = []
  const half = width / 2

  for (let p = 0; p < planes; p++) {
    const angle = (p / planes) * Math.PI
    const cos = Math.cos(angle)
    const sin = Math.sin(angle)
    const offset = p * 4

    for (const [cx, cy] of [
      [-half, 0],
      [half, 0],
      [half, height],
      [-half, height],
    ]) {
      positions.push(cx * cos, cy, cx * sin)
      // Normals point straight up rather than out of the card face: foliage lit
      // by its own face normal goes black on whichever side faces away from the
      // key, while an up-normal catches the sky fill evenly.
      normals.push(0, 1, 0)
    }

    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)

    // Both windings, so the card is visible from either side under FrontSide.
    // DoubleSide would be the obvious way to do that, but three flips the
    // normal for back-facing fragments — which would point these *down* and
    // undo the whole reason for the up-normal above. Backface culling picks
    // whichever winding faces us and leaves its normal alone.
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3)
    indices.push(offset, offset + 2, offset + 1, offset, offset + 3, offset + 2)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  geometry.setIndex(indices)
  return geometry
}

/**
 * A clump of three little mushrooms merged into one instanced unit. Cap and
 * stem colours are baked into vertex colours rather than split across two
 * materials, which keeps this a single-material instanced draw.
 */
function makeMushroomGeometry() {
  const parts = []
  const colors = []
  const stemColor = new Color(surface.clutter.mushroomStem)
  const capColor = new Color(surface.clutter.mushroomCap)

  const addPart = (geometry, color) => {
    parts.push(geometry)
    for (let i = 0; i < geometry.attributes.position.count; i++) {
      colors.push(color.r, color.g, color.b)
    }
  }

  // A clump a few centimetres across — mushroom scale, not stool scale.
  const layout = [
    { x: 0, z: 0, scale: 0.35 },
    { x: 0.038, z: 0.025, scale: 0.25 },
    { x: -0.032, z: 0.032, scale: 0.19 },
  ]

  for (const { x, z, scale } of layout) {
    const stemHeight = 0.2 * scale
    const stem = new CylinderGeometry(0.022 * scale, 0.03 * scale, stemHeight, 5)
    stem.translate(x, stemHeight / 2, z)
    addPart(stem, stemColor)

    const cap = new ConeGeometry(0.075 * scale, 0.1 * scale, 7)
    cap.translate(x, stemHeight + 0.03 * scale, z)
    addPart(cap, capColor)
  }

  // Vertex order follows the array order, so the colour buffer lines up.
  const merged = mergeGeometries(parts)
  merged.setAttribute('color', new Float32BufferAttribute(colors, 3))
  merged.computeVertexNormals()
  return merged
}

/**
 * A squat boulder. Moss is painted into vertex colours by how much each face
 * points at the sky, which costs nothing and beats a second material.
 */
function makeBoulderGeometry(rng) {
  const geometry = new IcosahedronGeometry(0.5, 0)
  const position = geometry.attributes.position

  for (let i = 0; i < position.count; i++) {
    const scale = 1 + randRange(rng, -0.18, 0.18)
    position.setXYZ(
      i,
      position.getX(i) * scale,
      position.getY(i) * scale * 0.78,
      position.getZ(i) * scale,
    )
  }

  geometry.computeVertexNormals()

  const stone = new Color(surface.clutter.boulderStone)
  const moss = new Color(surface.clutter.boulderMoss)
  const normal = geometry.attributes.normal
  const colors = new Float32Array(position.count * 3)
  const blended = new Color()

  for (let i = 0; i < normal.count; i++) {
    const upness = Math.max(0, normal.getY(i))
    blended.copy(stone).lerp(moss, Math.min(1, upness * 1.4))
    colors[i * 3] = blended.r
    colors[i * 3 + 1] = blended.g
    colors[i * 3 + 2] = blended.b
  }

  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  return geometry
}

/**
 * Cluster centres shared by every clutter kind, so ferns, mushrooms and
 * flowers pile into the same rich patches instead of each having its own
 * unrelated distribution.
 */
function makeClusters(rng) {
  const clusters = []
  for (let i = 0; i < CLUTTER.clusterCount; i++) {
    const angle = rng() * Math.PI * 2
    const radius = Math.sqrt(rng()) * CLUTTER.scatterRadius
    clusters.push({
      x: Math.cos(angle) * radius,
      z: Math.sin(angle) * radius,
      radius: randRange(rng, CLUTTER.clusterRadius * 0.45, CLUTTER.clusterRadius),
    })
  }
  return clusters
}

/**
 * Draw one position, either inside a cluster or — for a minority — anywhere,
 * so the patches have stragglers around them rather than hard edges.
 */
function samplePosition(rng, clusters, avoid) {
  const [playerX, , playerZ] = PROPS.playerPosition

  for (let attempt = 0; attempt < 24; attempt++) {
    let x
    let z

    if (rng() < CLUTTER.strayFraction) {
      const angle = rng() * Math.PI * 2
      const radius = Math.sqrt(rng()) * CLUTTER.scatterRadius
      x = Math.cos(angle) * radius
      z = Math.sin(angle) * radius
    } else {
      const cluster = clusters[Math.floor(rng() * clusters.length)]
      const angle = rng() * Math.PI * 2
      // Squaring the unit radius pulls samples towards the cluster centre.
      const radius = cluster.radius * rng() ** 2
      x = cluster.x + Math.cos(angle) * radius
      z = cluster.z + Math.sin(angle) * radius
    }

    if (x * x + z * z > CLUTTER.scatterRadius ** 2) continue

    const toPlayer = (x - playerX) ** 2 + (z - playerZ) ** 2
    if (toPlayer < CLUTTER.spawnClearRadius ** 2) continue

    let inTrunk = false
    for (const trunk of avoid) {
      if ((trunk.x - x) ** 2 + (trunk.z - z) ** 2 < TRUNK_CLEARANCE ** 2) {
        inTrunk = true
        break
      }
    }
    if (inTrunk) continue

    return { x, z }
  }

  return null
}

/**
 * @param geometry shared by every instance
 * @param material shared by every instance
 * @param options.count how many to place
 * @param options.scale [min, max] uniform scale multiplier
 * @param options.tilt maximum lean from vertical, in radians
 * @param options.tinted whether to vary lightness per instance
 */
function buildInstances(geometry, material, rng, clusters, avoid, options) {
  const { count, scale, tilt = 0.12, tinted = true, castShadow = false, record } = options

  const mesh = new InstancedMesh(geometry, material, count)
  mesh.castShadow = castShadow
  mesh.receiveShadow = true

  const tintLow = new Color(surface.clutter.tintLow)
  const tintHigh = new Color(surface.clutter.tintHigh)

  let placed = 0
  for (let i = 0; i < count; i++) {
    const spot = samplePosition(rng, clusters, avoid)
    if (!spot) continue

    dummy.position.set(spot.x, terrainHeight(spot.x, spot.z), spot.z)
    dummy.rotation.set(randRange(rng, -tilt, tilt), rng() * Math.PI * 2, randRange(rng, -tilt, tilt))
    // Height varies *relative* to the footprint, not independently of it —
    // rolling both ends of the range separately turns a wide boulder into a
    // paving slab.
    const s = randRange(rng, scale[0], scale[1])
    dummy.scale.set(s, s * randRange(rng, 0.85, 1.2), s)
    dummy.updateMatrix()
    mesh.setMatrixAt(placed, dummy.matrix)
    // The instanced mesh keeps only matrices, so anything that needs a
    // position later has to be told now.
    if (record) record(spot.x, spot.z, s)

    if (tinted) {
      mesh.setColorAt(placed, tintColor.copy(tintLow).lerp(tintHigh, rng()))
    }

    placed++
  }

  // Anything we failed to place would otherwise render as an identity-matrix
  // instance piled at the origin.
  mesh.count = placed
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  return mesh
}

/**
 * @param options.avoid tree trunk positions to keep clear of
 * @param options.anisotropy from the renderer
 */
export function createClutter({ avoid = [], anisotropy = 1 } = {}) {
  const rng = makeRng(SEED + 991)
  const clusters = makeClusters(rng)

  const group = new Object3D()
  group.name = 'clutter'

  // FrontSide is deliberate — see makeCardGeometry.
  const cardMaterial = (map) =>
    new MeshLambertMaterial({
      map,
      alphaTest: CARD_ALPHA_TEST,
      transparent: false,
    })

  const ferns = buildInstances(
    makeCardGeometry(0.8, 0.6, 2),
    cardMaterial(makeFernTexture({ anisotropy })),
    rng,
    clusters,
    avoid,
    { count: CLUTTER.counts.ferns, scale: [0.55, 1.25] },
  )
  ferns.name = 'clutter:ferns'
  group.add(ferns)

  const tufts = buildInstances(
    makeCardGeometry(0.3, 0.28, 2),
    cardMaterial(makeGrassTuftTexture({ anisotropy })),
    rng,
    clusters,
    avoid,
    { count: CLUTTER.counts.grassTufts, scale: [0.6, 1.5] },
  )
  tufts.name = 'clutter:grassTufts'
  group.add(tufts)

  const flowers = buildInstances(
    makeCardGeometry(0.2, 0.24, 2),
    cardMaterial(makeWildflowerTexture({ anisotropy })),
    rng,
    clusters,
    avoid,
    { count: CLUTTER.counts.wildflowers, scale: [0.6, 1.2] },
  )
  flowers.name = 'clutter:wildflowers'
  group.add(flowers)

  const mushrooms = buildInstances(
    makeMushroomGeometry(),
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    rng,
    clusters,
    avoid,
    { count: CLUTTER.counts.mushrooms, scale: [0.7, 1.5], tilt: 0.08, tinted: false },
  )
  mushrooms.name = 'clutter:mushrooms'
  group.add(mushrooms)

  // Boulders past a certain size push the player around them. Smaller ones are
  // pebbles: being stopped by those would read as the ground being sticky.
  const obstacles = []
  const BOULDER_GEOMETRY_RADIUS = 0.5

  const boulders = buildInstances(
    makeBoulderGeometry(rng),
    new MeshLambertMaterial({ vertexColors: true, flatShading: true }),
    rng,
    clusters,
    avoid,
    {
      count: CLUTTER.counts.boulders,
      scale: [0.35, 1.1],
      tilt: 0.25,
      tinted: false,
      castShadow: true,
      record(x, z, s) {
        const radius = BOULDER_GEOMETRY_RADIUS * s
        if (radius >= CLUTTER.boulderBlockRadius) obstacles.push({ x, z, radius })
      },
    },
  )
  boulders.name = 'clutter:boulders'
  group.add(boulders)

  return { object: group, obstacles }
}
