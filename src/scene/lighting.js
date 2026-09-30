import {
  AmbientLight,
  DirectionalLight,
  HemisphereLight,
  MathUtils,
  Vector3,
} from 'three'
import { light } from '../palette.js'

/**
 * Three-light golden-hour rig. Every colour and intensity comes from
 * palette.js — this module only decides the *shape* of the lighting.
 */

const towardsSun = new Vector3()

/**
 * The shadow camera's own screen axes, rebuilt whenever the light angle
 * changes. LightShadow.updateMatrices sits the shadow camera at the light and
 * lookAts the target with the default up vector, so with a fixed elevation and
 * azimuth this basis is constant — which is what makes snapping to it possible.
 */
const shadowRight = new Vector3()
const shadowUp = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)
const snapped = new Vector3()

/**
 * Push the current palette values onto existing lights. Split out from
 * createLighting so the debug panel can re-apply them live without rebuilding
 * the world.
 *
 * @param lights the {key, fill, ambient} returned by createLighting
 * @param target world point the shadow camera centres on
 */
export function applyLighting({ key, fill, ambient }, target = [0, 0, 0]) {
  const focus = new Vector3(...target)

  const elevation = MathUtils.degToRad(light.key.elevationDeg)
  const azimuth = MathUtils.degToRad(light.key.azimuthDeg)

  // Direction the light arrives *from*, kept as a unit vector so the key can be
  // re-centred on the focus without changing the angle of the light.
  towardsSun.set(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  )

  // Rebuild the shadow camera's basis for the texel snap in followLighting.
  shadowRight.crossVectors(WORLD_UP, towardsSun).normalize()
  shadowUp.crossVectors(towardsSun, shadowRight).normalize()

  key.color.set(light.key.color)
  key.intensity = light.key.intensity
  key.position.copy(focus).addScaledVector(towardsSun, light.key.distance)
  key.target.position.copy(focus)
  key.target.updateMatrixWorld()

  key.shadow.radius = light.shadow.radius
  key.shadow.bias = light.shadow.bias
  key.shadow.normalBias = light.shadow.normalBias

  if (key.shadow.mapSize.x !== light.shadow.mapSize) {
    key.shadow.mapSize.set(light.shadow.mapSize, light.shadow.mapSize)
    // The existing render target is the old size; drop it so three allocates a
    // new one at the next shadow pass.
    key.shadow.map?.dispose()
    key.shadow.map = null
  }

  const shadowCamera = key.shadow.camera
  shadowCamera.left = -light.shadow.extent
  shadowCamera.right = light.shadow.extent
  shadowCamera.top = light.shadow.extent
  shadowCamera.bottom = -light.shadow.extent
  shadowCamera.near = light.shadow.near
  shadowCamera.far = light.shadow.far
  shadowCamera.updateProjectionMatrix()

  fill.color.set(light.fill.color)
  fill.groundColor.set(light.fill.groundColor)
  fill.intensity = light.fill.intensity

  ambient.color.set(light.ambient.color)
  ambient.intensity = light.ambient.intensity
}

/**
 * Move the key light and its shadow box to keep up with the camera. The
 * shadow camera only covers ±extent, so left behind it would drop every
 * shadow in the scene the moment the player walked out of the original box.
 *
 * The box is *snapped to whole shadow-map texels* before it moves. Without
 * that, every frame re-rasterises the whole forest into a map that has slid a
 * fraction of a texel, and every shadow edge crawls while you walk. Quantising
 * the box to its own grid means a stationary tree lands on exactly the same
 * texels frame after frame.
 *
 * Honest limit: this fixes the swimming, not all of the fizz. r185's PCF path
 * rotates its five-tap Vogel disk by interleavedGradientNoise(gl_FragCoord.xy)
 * — that is *screen* space, and the camera lerps by a sub-pixel amount every
 * frame, so a fixed world point still slides across the noise field and its
 * five-tap estimate keeps changing. The residue is a fine edge shimmer rather
 * than the whole shadow drifting. Raising the tap count is not exposed; the
 * remaining lever is a smaller `shadow.extent`, which buys resolution and lets
 * `shadow.radius` come down.
 */
export function followLighting({ key }, x, z) {
  const texel = (2 * light.shadow.extent) / light.shadow.mapSize

  // Project the wanted centre onto the shadow camera's own axes, round each to
  // a texel, and rebuild. The component along the light direction is depth and
  // is left alone — the ortho shadow camera does not care where it sits on it.
  snapped.set(x, 0, z)
  const u = Math.round(snapped.dot(shadowRight) / texel) * texel
  const v = Math.round(snapped.dot(shadowUp) / texel) * texel
  const w = snapped.dot(towardsSun)

  snapped
    .copy(shadowRight)
    .multiplyScalar(u)
    .addScaledVector(shadowUp, v)
    .addScaledVector(towardsSun, w)

  key.target.position.copy(snapped)
  key.position.copy(snapped).addScaledVector(towardsSun, light.key.distance)
  key.target.updateMatrixWorld()
}

/**
 * @param scene
 * @param target world point the shadow camera should centre on — pass what the
 *   view camera is looking at, so the shadow map spends its resolution on what
 *   is actually on screen.
 */
export function createLighting(scene, target = [0, 0, 0]) {
  const key = new DirectionalLight()
  key.castShadow = true

  // Cool sky overhead, warm bounce from the forest floor.
  const fill = new HemisphereLight()
  fill.position.set(0, 50, 0)

  const ambient = new AmbientLight()

  const lights = { key, fill, ambient }
  applyLighting(lights, target)

  scene.add(key)
  scene.add(key.target)
  scene.add(fill)
  scene.add(ambient)

  return lights
}
