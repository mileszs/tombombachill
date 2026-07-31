import { MathUtils, OrthographicCamera, Vector3 } from 'three'
import { CAMERA, PROPS } from '../config.js'

/**
 * Fixed three-quarter overhead camera. Orthographic, so there's no perspective
 * convergence and the framing is entirely CAMERA.viewSize — distance only
 * decides clipping and how much fog sits between us and the world.
 *
 * It follows the player but it never *rotates*. Following is done by moving the
 * focus and translating the camera by the same amount, so the fixed offset that
 * sets the framing is preserved exactly and the world never appears to swing.
 */
export function createCameraRig(aspect) {
  const camera = new OrthographicCamera(-1, 1, 1, -1, CAMERA.near, CAMERA.far)

  const pitch = MathUtils.degToRad(CAMERA.pitchDeg)
  const yaw = MathUtils.degToRad(CAMERA.yawDeg)

  // Unit vector from the focus towards the camera, `pitchDeg` above the
  // horizon and swung `yawDeg` around it.
  const offset = new Vector3(
    Math.cos(pitch) * Math.sin(yaw),
    Math.sin(pitch),
    Math.cos(pitch) * Math.cos(yaw),
  ).multiplyScalar(CAMERA.distance)

  const focus = new Vector3(...CAMERA.target)

  // The framing was composed with the player off-centre and low in frame, which
  // is where the title sits above him. Hold that as an offset from the player
  // rather than re-centring, so the composition survives the camera moving.
  const composition = new Vector3(
    CAMERA.target[0] - PROPS.playerPosition[0],
    0,
    CAMERA.target[2] - PROPS.playerPosition[2],
  )

  camera.position.copy(focus).add(offset)
  camera.lookAt(focus)
  // Set once. Following only ever translates, so this is the last time the
  // orientation is touched.
  camera.updateMatrixWorld()
  updateCameraFrustum(camera, aspect)

  return {
    camera,
    focus,

    /**
     * Ease the focus towards the player.
     *
     * CAMERA.followLerp is expressed per frame at 60fps, which is how it's
     * reasoned about, but applying it raw would make the camera lag further
     * behind on a slow machine and stick to the player on a fast one. Raising
     * it to the power of the elapsed frames gives the same curve at any rate.
     */
    follow(x, z, dt) {
      const perFrame = 1 - CAMERA.followLerp
      const alpha = 1 - Math.pow(perFrame, dt * 60)
      focus.x += (x + composition.x - focus.x) * alpha
      focus.z += (z + composition.z - focus.z) * alpha
      camera.position.copy(focus).add(offset)
    },
  }
}

/** Keep viewSize as the vertical extent; width follows the viewport. */
export function updateCameraFrustum(camera, aspect) {
  const halfHeight = CAMERA.viewSize / 2
  const halfWidth = halfHeight * aspect
  camera.left = -halfWidth
  camera.right = halfWidth
  camera.top = halfHeight
  camera.bottom = -halfHeight
  camera.updateProjectionMatrix()
}
