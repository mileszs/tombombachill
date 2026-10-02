import {
  FrontSide,
  Group,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  TextureLoader,
} from 'three'
import { CAMERA, PLAYER, PROPS } from '../config.js'
import { light } from '../palette.js'
import { terrainHeight } from '../util/terrain.js'
import { makeBlobShadowTexture } from '../util/textures.js'

/**
 * The player: a small barefoot halfling in a waistcoat and rolled breeches, drawn
 * from behind, as an upright card turned to face the camera's bearing.
 *
 * Upright, not leaning back at the camera's pitch. A fully camera-facing quad
 * puts his head ~0.7 m nearer the lens than his feet, so once he receives
 * shadows his top half tests ground he isn't standing over — legs in the sun,
 * body in shade, speckled where the two disagree. Standing him up makes every
 * pixel of him test the column directly above his feet, as a real figure would.
 * An upright card is foreshortened by cos(pitch) on screen, so it is stretched
 * by the inverse to stay exactly the size it was.
 *
 * The card doesn't cast — a flat figure throws a strange shadow — so a soft
 * blob on the ground plants him instead. It does receive shadows, and it is lit
 * by the same rig as everything else, through normals invented for it (see
 * shapeNormals). Unlit, he was the one thing in frame the golden hour never
 * touched.
 */

/**
 * Served from public/, so these are URL paths, not filesystem paths. Both come
 * from tools/player-sprite.html and share one size. The back view is the one
 * he can't do without; the front is shown while he walks towards the camera,
 * and if it is missing he simply keeps his back to you.
 */
const SPRITE_URL = { back: '/sprites/player.png', front: '/sprites/player-front.png' }

/** Fallback aspect used until the image loads and reports its real one. */
const ASSUMED_ASPECT = 0.5

/**
 * Columns across the quad, so the curved normals have somewhere to curve.
 * Lambert lights per fragment, so a handful is already smooth.
 */
const NORMAL_COLUMNS = 6

const PITCH = MathUtils.degToRad(CAMERA.pitchDeg)
const YAW = MathUtils.degToRad(CAMERA.yawDeg)

/**
 * Write cylinder-like normals across the sprite, in its own local space.
 *
 * The card stands upright facing the camera's bearing, so local +Z is level
 * and points at the camera, and local +Y is world up. Each column's normal
 * swings round from +Z by an angle that grows towards the edges, then tips
 * towards the sky by `skyward`.
 *
 * The mesh is scaled non-uniformly (it is a unit quad stretched to his size),
 * and three transforms normals by the *inverse* of that scale. So each normal is
 * pre-multiplied by the scale here, and comes out pointing where it was meant
 * to. The mirroring flip is deliberately left out of that: mirroring the quad
 * should mirror its normals, so the lit edge stays on the sunny side of the
 * screen whichever way he faces. The bob's ±7% squash is ignored.
 */
function shapeNormals(geometry, width, height, { roundnessDeg, skyward }) {
  const position = geometry.attributes.position
  const normal = geometry.attributes.normal
  const reach = MathUtils.degToRad(roundnessDeg)

  for (let i = 0; i < position.count; i++) {
    // The quad spans x ∈ [−0.5, 0.5]; centre column faces the camera.
    const angle = position.getX(i) * 2 * reach
    normal.setXYZ(i, Math.sin(angle) * width, skyward * height, Math.cos(angle))
  }
  normal.needsUpdate = true
}

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
  /** The card's real height: stretched so that, foreshortened, he is `height` on screen. */
  const cardHeight = height / Math.cos(PITCH)

  // A unit quad with its origin at the bottom edge, so the sprite pivots on
  // its feet and can be scaled to whatever aspect the texture turns out to be.
  const geometry = new PlaneGeometry(1, 1, NORMAL_COLUMNS, 1)
  geometry.translate(0, 0.5, 0)

  const material = new MeshLambertMaterial({
    transparent: true,
    // alphaTest rather than sorted transparency: no depth-order surprises when
    // the sprite stands among the trees.
    alphaTest: 0.4,
    // Front only. With DoubleSide three flips the normal of any fragment it
    // thinks is a back face, which would turn the lit edge dark. The quad
    // always faces the camera, and three corrects the winding itself when the
    // mirroring flip makes the scale negative, so nothing is ever culled.
    side: FrontSide,
  })

  const sprite = new Mesh(geometry, material)
  sprite.castShadow = false
  sprite.receiveShadow = true
  sprite.scale.set(height * ASSUMED_ASPECT, cardHeight, 1)
  // Constant, because the camera never rotates; it only ever translates.
  sprite.rotation.set(0, YAW, 0)
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

  /** What the normals were last shaped for, so they're only rewritten on a change. */
  let shapedFor = ''
  const reshape = () => {
    const { roundnessDeg, skyward } = light.player
    const key = `${baseWidth}|${roundnessDeg}|${skyward}`
    if (key === shapedFor) return
    shapedFor = key
    shapeNormals(geometry, baseWidth, cardHeight, light.player)
  }
  reshape()

  const fitToTexture = (image) => {
    // Height is authoritative; width follows the image so the sprite is never
    // stretched, whatever dimensions the art happens to be.
    baseWidth = height * (image.width / image.height)
    sprite.scale.set(baseWidth, cardHeight, 1)
    blob.scale.setScalar(baseWidth * 1.25)
    blobRadius = baseWidth * 1.25 * 0.5
  }

  /** Loaded views, keyed 'back' / 'front'. Filled in as the files arrive. */
  const textures = {}

  const loadView = (view) =>
    new Promise((resolve) => {
      new TextureLoader().load(
        SPRITE_URL[view],
        (texture) => {
          texture.colorSpace = SRGBColorSpace
          texture.anisotropy = anisotropy
          textures[view] = texture
          resolve(texture)
        },
        undefined,
        () => resolve(null),
      )
    })

  /**
   * Point the material at one view. The lift is coloured by his own texture,
   * so it brightens him rather than washing him towards grey — which means the
   * emissive map has to swap along with the colour map.
   */
  const showView = (view) => {
    const texture = textures[view] ?? textures.back
    if (!texture || material.map === texture) return
    const first = !material.map
    material.map = texture
    material.emissiveMap = texture
    // Only the first assignment changes the shader (no map → a map); swapping
    // one texture for another afterwards is a uniform change and costs nothing.
    if (first) material.needsUpdate = true
  }

  // Resolves either way — the caller waits on this before showing the scene,
  // so it must never be left hanging on a missing file.
  const ready = Promise.all([loadView('back'), loadView('front')]).then(([back, front]) => {
    if (!back) {
      // Nothing renders without it, so say so plainly rather than leaving an
      // invisible player and no explanation.
      console.error(
        `[player] could not load ${SPRITE_URL.back} — put the sprite at ` +
          `public${SPRITE_URL.back} (a back view, transparent background).`,
      )
      group.visible = false
      return
    }
    if (!front) console.warn(`[player] no ${SPRITE_URL.front}; he will only ever be seen from behind.`)
    showView('back')
    fitToTexture(back.image)
    sprite.visible = true
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
  /**
   * 'back' walking away up the screen, 'front' walking towards the camera.
   * Pure sideways travel keeps whichever he had, so he doesn't spin round on
   * the spot when you let go of a diagonal. He starts with his back to you,
   * looking into the forest.
   */
  let view = 'back'

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
     * @param input   from core/input.js
     * @param collider from scene/collision.js, or null for free movement
     */
    update(dt, input, collider) {
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
        if (wish.y > 0.01) view = 'back'
        else if (wish.y < -0.01) view = 'front'
        showView(view)
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
      sprite.scale.set(baseWidth * facing * (1 - squash), cardHeight * (1 + squash), 1)

      // Live from the panel. Both are cheap when nothing has changed.
      material.emissive.set(light.player.lift)
      reshape()
    },
  }
}
