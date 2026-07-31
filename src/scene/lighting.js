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
 */
export function followLighting({ key }, x, z) {
  const dx = x - key.target.position.x
  const dz = z - key.target.position.z
  key.position.x += dx
  key.position.z += dz
  key.target.position.x = x
  key.target.position.z = z
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
