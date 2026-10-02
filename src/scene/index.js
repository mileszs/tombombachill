import { Color, Fog, Scene } from 'three'
import { CAMERA, PROPS } from '../config.js'
import { fog } from '../palette.js'
import { createLighting, followLighting } from './lighting.js'
import { createGround } from './ground.js'
import { createForest } from './trees.js'
import { createClutter } from './clutter.js'
import { createCollider } from './collision.js'
import { createOcclusionFade } from './occlusion.js'
import { createPlayer } from './player.js'
import { createBoombox } from './boombox.js'
import { advanceWind } from './wind.js'

/**
 * Assembles the world. Returns the scene plus handles to the things later
 * systems (controls, audio) will want to talk to.
 */
export function createWorld(renderer) {
  const scene = new Scene()

  // Background matches the fog exactly, so trees don't dissolve *towards*
  // anything — the haze and the void behind it are the same colour, which is
  // what lets the fog stand in for a horizon.
  scene.background = new Color(fog.color)
  scene.fog = new Fog(fog.color, fog.near, fog.far)

  const anisotropy = renderer.capabilities.getMaxAnisotropy()

  // Centre the shadow camera on what the view camera is framing, not on the
  // world origin.
  const lighting = createLighting(scene, CAMERA.target)

  // The forest is built before the ground, not after: the ground bakes the
  // contact shading under each trunk straight into its vertex colours, so it
  // needs the trunk positions and radii first.
  const forest = createForest()
  scene.add(forest.object)
  const occlusion = createOcclusionFade(forest.occluders)

  scene.add(createGround({ anisotropy, trunks: forest.positions }))

  // Clutter needs the trunk positions so it doesn't grow through the trees;
  // collision needs their radii too.
  const clutter = createClutter({ avoid: forest.positions, anisotropy })
  scene.add(clutter.object)

  const boombox = createBoombox()
  scene.add(boombox.object)

  // Everything solid, in one list. All of it is a circle on the ground, which
  // is why the collider only ever needed to understand circles.
  const collider = createCollider([
    ...forest.positions,
    ...clutter.obstacles,
    boombox.obstacle,
  ])

  const player = createPlayer({ anisotropy })
  scene.add(player.object)

  return {
    scene,
    lighting,
    player,
    boombox: boombox.object,
    /** Resolves once every asynchronously-loaded asset is in place. */
    ready: player.ready,

    /**
     * @param dt     seconds since the last frame, clamped by the caller
     * @param rig    the camera rig; it follows the player, the player faces it
     * @param input  from core/input.js
     */
    update(dt, rig, input) {
      advanceWind(dt)
      player.update(dt, input, collider)
      rig.follow(player.position.x, player.position.z, dt)
      // The shadow box is only ±extent wide, so it has to travel too.
      followLighting(lighting, rig.focus.x, rig.focus.z)
      // Fade anything standing between the camera and him. Measured from his
      // middle rather than his feet — his head is what gets covered first.
      occlusion.update(
        rig.camera,
        player.position.x,
        player.object.position.y + PROPS.playerHeight * 0.5,
        player.position.z,
        dt,
      )
    },
  }
}

/**
 * Release every GPU resource the world holds, so it can be rebuilt from
 * changed palette values without leaking buffers and textures.
 */
export function disposeWorld(world) {
  world.scene.traverse((object) => {
    object.geometry?.dispose()

    // InstancedMesh keeps its matrix and colour buffers outside the geometry,
    // and they are only released through its own dispose event — the traverse
    // above walks straight past them. Five clutter meshes hold 80,000
    // instances between them, which is about 6 MB a rebuild.
    if (object.isInstancedMesh) object.dispose()

    const materials = Array.isArray(object.material)
      ? object.material
      : object.material
        ? [object.material]
        : []

    for (const material of materials) {
      // Shared materials get visited once per mesh; dispose is safe to repeat.
      material.map?.dispose()
      material.alphaMap?.dispose()
      material.dispose()
    }
  })

  // The largest single allocation in the scene is not in the scene graph at
  // all. A light carries no geometry and no material, so the traverse never
  // reaches it — and createWorld builds a fresh DirectionalLight every time,
  // orphaning a 4096² depth target. That is ~64 MB per rebuild, and the debug
  // panel fires a rebuild every 220 ms while you drag a colour picker.
  // DirectionalLight.dispose() releases its own shadow map, so this is the
  // whole of it.
  world.lighting?.key.dispose()
}
