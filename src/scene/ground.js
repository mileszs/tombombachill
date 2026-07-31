import { BufferAttribute, Color, Mesh, MeshLambertMaterial, PlaneGeometry } from 'three'
import { WORLD_SIZE } from '../config.js'
import { surface } from '../palette.js'
import { terrainElevation, terrainHeight, terrainTint } from '../util/terrain.js'
import { makeGrassTexture } from '../util/textures.js'

/** Grid resolution of the displaced plane. */
const SEGMENTS = 160

/** Above this point on the ramp the grass gives way to bare soil. */
const SOIL_THRESHOLD = 0.74

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

export function createGround({ anisotropy = 1 } = {}) {
  const geometry = new PlaneGeometry(WORLD_SIZE, WORLD_SIZE, SEGMENTS, SEGMENTS)
  geometry.rotateX(-Math.PI / 2)

  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  const tint = new Color()
  const tints = readTints()

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    position.setY(i, terrainHeight(x, z))

    groundColorAt(x, z, tint, tints)
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

  const material = new MeshLambertMaterial({ map, vertexColors: true })

  const ground = new Mesh(geometry, material)
  ground.name = 'ground'
  ground.receiveShadow = true
  return ground
}
