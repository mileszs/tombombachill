import { MathUtils, OrthographicCamera, Vector3 } from 'three'
import { CAMERA, PROPS } from '../config.js'

/**
 * Fixed three-quarter overhead camera. Orthographic, so there's no perspective
 * convergence and the framing is entirely the view size — distance only decides
 * clipping and how much fog sits between us and the world.
 *
 * It follows the player and it changes width, but it never *rotates*. Following
 * moves the focus and translates the camera by the same amount; the width is a
 * frustum change. `lookAt` is called once, at construction, and never again.
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

  /**
   * Where the player sits relative to the focus, at CAMERA.viewSize. The
   * framing was composed with him low and left of centre, under the title.
   *
   * This has to *scale with the view size*. It is a world-space offset, so at a
   * narrower frame the same metres are a larger fraction of it — hold it fixed
   * while pushing in and he slides towards the corner and eventually off.
   */
  const baseComposition = new Vector3(
    CAMERA.target[0] - PROPS.playerPosition[0],
    0,
    CAMERA.target[2] - PROPS.playerPosition[2],
  )

  let currentAspect = aspect
  let viewSize = CAMERA.viewSize
  let wantedViewSize = CAMERA.viewSize

  const applyFrustum = () => {
    const halfHeight = viewSize / 2
    const halfWidth = halfHeight * currentAspect
    camera.left = -halfWidth
    camera.right = halfWidth
    camera.top = halfHeight
    camera.bottom = -halfHeight
    camera.updateProjectionMatrix()
  }

  camera.position.copy(focus).add(offset)
  camera.lookAt(focus)
  camera.updateMatrixWorld()
  applyFrustum()

  return {
    camera,
    focus,
    get viewSize() {
      return viewSize
    },

    setAspect(next) {
      currentAspect = next
      applyFrustum()
    },

    /** Ease to a new frame height — the push-in when you step into the forest. */
    setViewSize(next) {
      wantedViewSize = next
    },

    /**
     * Ease the focus towards the player, and the width towards its target.
     *
     * CAMERA.followLerp is expressed per frame at 60fps, which is how it's
     * reasoned about, but applying it raw would make the camera lag further
     * behind on a slow machine and stick to the player on a fast one. Raising
     * it to the power of the elapsed frames gives the same curve at any rate.
     */
    follow(x, z, dt) {
      if (Math.abs(viewSize - wantedViewSize) > 0.002) {
        viewSize += (wantedViewSize - viewSize) * Math.min(1, CAMERA.viewSizeEase * dt)
        applyFrustum()
      }

      const framing = viewSize / CAMERA.viewSize
      const perFrame = 1 - CAMERA.followLerp
      const alpha = 1 - Math.pow(perFrame, dt * 60)
      focus.x += (x + baseComposition.x * framing - focus.x) * alpha
      focus.z += (z + baseComposition.z * framing - focus.z) * alpha
      camera.position.copy(focus).add(offset)
    },
  }
}
