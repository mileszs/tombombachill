import { BufferAttribute, Color, Mesh, MeshLambertMaterial, PlaneGeometry } from 'three'
import { GROUND, WORLD_SIZE } from '../config.js'
import { surface } from '../palette.js'
import { terrainElevation, terrainHeight, terrainTint } from '../util/terrain.js'
import { makeGrassTexture } from '../util/textures.js'
import { standDensity } from './trees.js'

/** Above this point on the ramp the grass gives way to bare soil. */
const SOIL_THRESHOLD = 0.74

/** Cell size of the trunk lookup grid. Must be ≥ the largest shade radius. */
const TRUNK_CELL = 4

/**
 * Read at call time, never hoisted to module scope. A `const` up there is
 * evaluated once at import, so it would keep the palette's *original* value
 * and silently ignore every later edit — which is exactly what the debug
 * panel's rebuild depends on.
 */
function readTints() {
  return {
    moss: new Color(surface.ground.moss),
    dry: new Color(surface.ground.dryGrass),
    soil: new Color(surface.ground.soil),
    stand: new Color(surface.ground.standShade),
    root: new Color(surface.ground.rootShade),
  }
}

/**
 * Blend the three ground tints across a single 0–1 ramp: moss in the hollows,
 * drying off through the middle, bare soil on the exposed tops.
 */
function groundColorAt(x, z, out, tints) {
  // A little noise on the ramp so the bands follow the terrain without
  // resolving into clean contour lines.
  const jitter = (terrainTint(x, z) - 0.5) * surface.ground.blendJitter
  const ramp = Math.min(1, Math.max(0, terrainElevation(x, z) + jitter))

  if (ramp < SOIL_THRESHOLD) {
    return out.copy(tints.moss).lerp(tints.dry, ramp / SOIL_THRESHOLD)
  }
  // Squared, so soil stays a scatter of bare crowns on the highest ground
  // rather than claiming everything above the threshold.
  const t = (ramp - SOIL_THRESHOLD) / (1 - SOIL_THRESHOLD)
  return out.copy(tints.dry).lerp(tints.soil, t * t)
}

/**
 * Bucket the trunks so the per-vertex contact shading only ever tests the nine
 * cells around a vertex. Without this it is 167 trunks × 83,000 vertices, and
 * the world build is already the best part of a second.
 */
function makeTrunkGrid(trunks) {
  const cells = new Map()
  for (const trunk of trunks) {
    const cx = Math.floor(trunk.x / TRUNK_CELL)
    const cz = Math.floor(trunk.z / TRUNK_CELL)
    const key = `${cx},${cz}`
    if (!cells.has(key)) cells.set(key, [])
    cells.get(key).push(trunk)
  }
  return cells
}

/**
 * How dark the ground goes at (x, z) from the trunks standing on it, 0–1.
 * Smoothstepped from the trunk's own radius out to `rootShadeRadius` × that
 * radius, so a fat trunk sits heavier than a slim one and neither gets a hard
 * edge.
 */
function rootShadeAt(x, z, cells) {
  let darkest = 0
  const cx = Math.floor(x / TRUNK_CELL)
  const cz = Math.floor(z / TRUNK_CELL)

  for (let ix = cx - 1; ix <= cx + 1; ix++) {
    for (let iz = cz - 1; iz <= cz + 1; iz++) {
      const bucket = cells.get(`${ix},${iz}`)
      if (!bucket) continue
      for (const trunk of bucket) {
        const reach = trunk.radius * GROUND.rootShadeRadius
        const distance = Math.hypot(x - trunk.x, z - trunk.z)
        if (distance >= reach) continue
        // 1 at the trunk, 0 at the edge of the reach.
        const t = 1 - Math.min(1, Math.max(0, (distance - trunk.radius) / (reach - trunk.radius)))
        const eased = t * t * (3 - 2 * t)
        if (eased > darkest) darkest = eased
      }
    }
  }
  return darkest
}

/**
 * @param options.trunks the forest's {x, z, radius} list. The ground is built
 *   *after* the forest for this reason — the contact shading under each trunk
 *   is baked into these vertex colours rather than drawn as a decal, which
 *   costs nothing at runtime, adds no draw call, cannot z-fight with the
 *   terrain it sits on, and reuses the tint-multiplied-over-a-neutral-map
 *   trick the ground already runs on.
 */
export function createGround({ anisotropy = 1, trunks = [] } = {}) {
  const segments = GROUND.segments
  const geometry = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segments, segments)
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const tint = new Color()
  const tints = readTints()
  const cells = makeTrunkGrid(trunks)

  const standStrength = surface.ground.standShadeStrength
  const rootStrength = surface.ground.rootShadeStrength

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, terrainHeight(x, z))

    groundColorAt(x, z, tint, tints)

    // Under a stand the floor is enclosed and cooler. standDensity is exported
    // from trees.js precisely so other systems can ask where the stands are,
    // and it is already zeroed inside clearings — so clearings keep their full
    // brightness with no extra test.
    if (standStrength > 0) {
      const density = standDensity(x, z)
      if (density > 0) tint.lerp(tints.stand, density * standStrength)
    }

    if (rootStrength > 0) {
      const root = rootShadeAt(x, z, cells)
      if (root > 0) tint.lerp(tints.root, root * rootStrength)
    }

    colors[i * 3] = tint.r
    colors[i * 3 + 1] = tint.g
    colors[i * 3 + 2] = tint.b
  }

  position.needsUpdate = true
  geometry.setAttribute('color', new BufferAttribute(colors, 3))
  geometry.computeVertexNormals()

  const map = makeGrassTexture({ anisotropy })
  const repeats = WORLD_SIZE / surface.ground.tileSize
  map.repeat.set(repeats, repeats)

  // dithering: a long, smooth fog ramp across a near-flat plane in a narrow
  // warm hue range, tone-mapped linearly into 8 bits, is textbook banding.
  // One hash per fragment buys it off.
  const material = new MeshLambertMaterial({ map, vertexColors: true, dithering: true })

  const ground = new Mesh(geometry, material)
  ground.name = 'ground'
  ground.receiveShadow = true
  return ground
}
