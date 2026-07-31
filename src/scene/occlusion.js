import { Matrix4, Vector3 } from 'three'
import { OCCLUSION } from '../config.js'

/**
 * Fade whatever stands between the camera and the player.
 *
 * No raycasting. The camera is orthographic and never rotates, so "in front of
 * the player" is just a comparison in camera space: transform a canopy's
 * bounding sphere, and it blocks if it sits nearer the camera than the player
 * and lands close to him on screen. Because the projection is orthographic
 * there's no perspective divide — camera-space X and Y are already screen
 * offsets in metres, which is why the clearance is expressed that way.
 *
 * That is ~300 vector transforms a frame against 167 trees, which is cheaper
 * and far more stable than raycasting: a ray can slip between two canopies of
 * the same tree and flicker.
 */
export function createOcclusionFade(trees) {
  const view = new Matrix4()
  const player = new Vector3()
  const centre = new Vector3()

  return {
    /**
     * @param camera  the rig's camera
     * @param x,y,z   the player's centre, not his feet — his head is what gets
     *                covered, and testing from the ground fades a beat late
     * @param dt      seconds, for the fade easing
     */
    update(camera, x, y, z, dt) {
      camera.updateMatrixWorld()
      view.copy(camera.matrixWorld).invert()

      player.set(x, y, z).applyMatrix4(view)
      const playerDepth = -player.z
      const ease = Math.min(1, OCCLUSION.fadeSpeed * dt)

      for (const tree of trees) {
        let blocking = false

        // Cheap world-space reject first. Only trees between the player and the
        // camera can matter, and the camera is 30 m off.
        const dx = tree.x - x
        const dz = tree.z - z
        if (dx * dx + dz * dz < OCCLUSION.testRadius * OCCLUSION.testRadius) {
          for (const sphere of tree.spheres) {
            centre.copy(sphere.centre).applyMatrix4(view)
            // Behind the player: it cannot be covering him.
            if (-centre.z >= playerDepth) continue

            const reach = sphere.radius + OCCLUSION.playerClearance
            const ox = centre.x - player.x
            const oy = centre.y - player.y
            if (ox * ox + oy * oy < reach * reach) {
              blocking = true
              break
            }
          }
        }

        const target = blocking ? OCCLUSION.fadedOpacity : 1
        tree.fade += (target - tree.fade) * ease

        // Only touch the materials when the value actually moved, so a still
        // forest costs nothing.
        if (Math.abs(tree.fade - tree.applied) < 0.002) continue
        tree.applied = tree.fade

        const faded = tree.fade < 0.995
        for (const material of tree.materials) {
          material.opacity = tree.fade
          material.transparent = faded
          // While faded it must not write depth, or it would still hide the
          // player: he is drawn in the transparent pass before it, being
          // further away, and a depth write here would reject his fragments.
          material.depthWrite = !faded
        }
      }
    },
  }
}

/**
 * Collect what the fade needs from a finished tree: its own materials, and a
 * world-space sphere per canopy. Called once at build.
 */
export function collectOccluder(tree) {
  tree.updateMatrixWorld(true)

  const spheres = []
  const materials = new Set()
  const scale = new Vector3()

  tree.traverse((node) => {
    if (!node.isMesh) return
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
    }
    if (!node.userData.isCanopy) return

    node.geometry.computeBoundingSphere()
    const local = node.geometry.boundingSphere
    scale.setFromMatrixScale(node.matrixWorld)
    spheres.push({
      centre: local.center.clone().applyMatrix4(node.matrixWorld),
      radius: local.radius * Math.max(scale.x, scale.y, scale.z),
    })
  })

  return {
    x: tree.position.x,
    z: tree.position.z,
    spheres,
    materials: [...materials],
    fade: 1,
    applied: 1,
  }
}
