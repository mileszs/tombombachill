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
  scene.add(createGround({ anisotropy }))

  const forest = createForest()
  scene.add(forest.object)
  const collider = createCollider(forest.positions)
  const occlusion = createOcclusionFade(forest.occluders)

  // Clutter needs the trunk positions so it doesn't grow through the trees;
  // collision needs their radii too.
  scene.add(createClutter({ avoid: forest.positions, anisotropy }))

  const boombox = createBoombox()
  scene.add(boombox)

  const player = createPlayer({ anisotropy })
  scene.add(player.object)

  return {
    scene,
    lighting,
    player,
    boombox,
    /** Resolves once every asynchronously-loaded asset is in place. */
    ready: player.ready,

    /**
     * @param dt     seconds since the last frame, clamped by the caller
     * @param rig    the camera rig; it follows the player, the player faces it
     * @param input  from core/input.js
     */
    update(dt, rig, input) {
      player.update(dt, rig.camera, input, collider)
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
}
