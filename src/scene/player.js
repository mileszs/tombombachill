import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { CAMERA, PLAYER, PROPS } from '../config.js'
import { terrainHeight } from '../util/terrain.js'
import { makeBlobShadowTexture } from '../util/textures.js'

/**
 * The player: a barefoot child in a plain tunic and rolled trousers, drawn
 * from behind, as a billboard plane that turns to face the camera every frame.
 * The camera is fixed today, but controls are coming, so the billboarding is
 * real rather than baked into the initial rotation.
 *
 * A camera-facing quad leans back at the camera's pitch, which makes for an
 * odd cast shadow, so the sprite doesn't cast — a soft blob on the ground
 * plants it instead.
 */

/** Served from public/, so this is the URL path, not a filesystem path. */
const SPRITE_URL = '/sprites/player.png'

/** Fallback aspect used until the image loads and reports its real one. */
const ASSUMED_ASPECT = 0.5

/** Rim samples used to find the highest ground under the contact shadow. */
const BLOB_PROBES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

export function createPlayer({ anisotropy = 1 } = {}) {
  const group = new Group()
  group.name = 'player'

  const [x, , z] = PROPS.playerPosition
  group.position.set(x, terrainHeight(x, z), z)

  const height = PROPS.playerHeight

  // A unit quad with its origin at the bottom edge, so the sprite pivots on
  // its feet and can be scaled to whatever aspect the texture turns out to be.
  const geometry = new PlaneGeometry(1, 1)
  geometry.translate(0, 0.5, 0)

  const material = new MeshBasicMaterial({
    transparent: true,
    // alphaTest rather than sorted transparency: no depth-order surprises when
    // the sprite stands among the trees.
    alphaTest: 0.4,
    side: DoubleSide,
  })

  const sprite = new Mesh(geometry, material)
  sprite.castShadow = false
  sprite.scale.set(height * ASSUMED_ASPECT, height, 1)
  // The texture arrives asynchronously while the rest of the world is built
  // synchronously, so there's a window where this material has no map at all —
  // during which it would draw as a plain white quad. Stay hidden until dressed.
  sprite.visible = false
  group.add(sprite)

  const blob = new Mesh(
    new PlaneGeometry(1, 1),
    // No `color` here. The texture is already painted in
    // surface.blobShadow.color, and a material colour multiplies over it — so
    // the 0x000000 that used to sit here forced the blob to pure black
    // whatever the palette said, and the panel's swatch (which pays a full
    // world rebuild) changed nothing at all.
    new MeshBasicMaterial({
      map: makeBlobShadowTexture(),
      transparent: true,
      depthWrite: false,
    }),
  )
  blob.rotation.x = -Math.PI / 2
  blob.position.y = PLAYER.blobLift
  blob.renderOrder = 1
  // Sized off the assumed aspect until the texture lands and fitToTexture
  // corrects it — the blob is visible from the first frame even though the
  // sprite above it is not.
  blob.scale.setScalar(height * ASSUMED_ASPECT * 1.25)
  group.add(blob)

  // Kept so the per-frame bob, squash and flip can be rebuilt from a known
  // base rather than accumulating on top of last frame’s scale.
  let baseWidth = height * ASSUMED_ASPECT

  /** Radius the blob's gradient actually reaches, kept for the ground probe. */
  let blobRadius = height * ASSUMED_ASPECT * 1.25 * 0.5

  const fitToTexture = (image) => {
    // Height is authoritative; width follows the image so the sprite is never
    // stretched, whatever dimensions the art happens to be.
    baseWidth = height * (image.width / image.height)
    sprite.scale.set(baseWidth, height, 1)
    blob.scale.setScalar(baseWidth * 1.25)
    blobRadius = baseWidth * 1.25 * 0.5
  }

  // Resolves either way — the caller waits on this before showing the scene,
  // so it must never be left hanging on a missing file.
  const ready = new Promise((resolve) => {
    new TextureLoader().load(
      SPRITE_URL,
      (texture) => {
        texture.colorSpace = SRGBColorSpace
        texture.anisotropy = anisotropy
        material.map = texture
        material.needsUpdate = true
        fitToTexture(texture.image)
        sprite.visible = true
        resolve()
      },
      undefined,
      () => {
        // Nothing renders without it, so say so plainly rather than leaving an
        // invisible player and no explanation.
        console.error(
          `[player] could not load ${SPRITE_URL} — put the sprite at ` +
            `public${SPRITE_URL} (a back view of the child, transparent background).`,
        )
        group.visible = false
        resolve()
      },
    )
  })


  // --- walk state -------------------------------------------------------
  const position = { x, z }
  const proposed = { x, z }
  const wish = { x: 0, y: 0 }
  /** Bob phase in radians, advanced by distance walked, not by time. */
  let bobPhase = 0
  /** 0 standing, 1 walking. Eased, so bob and squash fade in and out. */
  let gait = 0
  /** -1 or 1. Which way the sprite is mirrored. */
  let facing = 1

  // Screen-space basis on the ground. The camera is rotated off the world axis,
  // so "up on the keyboard" is not world -Z; pressing up has to send the player
  // up the *screen* or the controls feel rotated.
  const yaw = (CAMERA.yawDeg * Math.PI) / 180
  const screenUp = { x: -Math.sin(yaw), z: -Math.cos(yaw) }
  const screenRight = { x: Math.cos(yaw), z: -Math.sin(yaw) }

  return {
    object: group,
    ready,
    position,

    /**
     * @param dt      seconds since the last frame, already clamped
     * @param camera  billboarding follows it, and it follows us
     * @param input   from core/input.js
     * @param collider from scene/collision.js, or null for free movement
     */
    update(dt, camera, input, collider) {
      input.read(wish)
      const walking = wish.x !== 0 || wish.y !== 0

      if (walking) {
        const step = PLAYER.speed * dt
        // wish is already unit length, so diagonals are not faster.
        const dx = (screenRight.x * wish.x + screenUp.x * wish.y) * step
        const dz = (screenRight.z * wish.x + screenUp.z * wish.y) * step

        proposed.x = position.x + dx
        proposed.z = position.z + dz
        if (collider) collider.resolve(position.x, position.z, proposed.x, proposed.z, proposed)

        // Advance the bob by the distance actually covered, so being pushed
        // around a trunk slows the step rather than moonwalking on the spot.
        const moved = Math.hypot(proposed.x - position.x, proposed.z - position.z)
        bobPhase += moved * PLAYER.bobCyclesPerMetre * Math.PI * 2

        position.x = proposed.x
        position.z = proposed.z

        // Flip on screen-space horizontal travel, not world X — otherwise the
        // sprite faces the wrong way for two of the four cardinals.
        if (Math.abs(wish.x) > 0.01) facing = wish.x > 0 ? 1 : -1
      }

      // Ease the gait so the bob does not snap on and off with the key.
      const target = walking ? 1 : 0
      gait += (target - gait) * Math.min(1, PLAYER.bobEase * dt)

      const bob = Math.sin(bobPhase) * gait
      const footing = terrainHeight(position.x, position.z)
      group.position.set(position.x, footing, position.z)
      sprite.position.y = bob * PLAYER.bobHeight

      // The blob is a flat quad and the ground is not flat. Over its own radius
      // the terrain climbs up to 5.9 cm at the steepest slope it reaches, which
      // is twice the clearance it used to be given — so on about a sixth of the
      // walkable area the uphill arc was being clipped by the ground, and the
      // bite travelled as you walked. Sit it on the highest ground it covers
      // instead. Four probes, because the blob is small and the terrain is
      // gentle enough that its extremes are always at the rim.
      let highest = footing
      for (const [ox, oz] of BLOB_PROBES) {
        const h = terrainHeight(position.x + ox * blobRadius, position.z + oz * blobRadius)
        if (h > highest) highest = h
      }
      blob.position.y = highest - footing + PLAYER.blobLift

      // Squash and stretch off the same sine: tall at the top of the bob,
      // wide and low in the dip. Roughly volume-preserving, which is what
      // stops it reading as the sprite simply scaling.
      const squash = bob * PLAYER.bobSquash
      sprite.scale.set(baseWidth * facing * (1 - squash), height * (1 + squash), 1)

      sprite.quaternion.copy(camera.quaternion)
    },
  }
}
