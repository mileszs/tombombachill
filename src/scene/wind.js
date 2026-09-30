import { Vector3 } from 'three'
import { WIND } from '../config.js'

/**
 * Wind, as two shader patches and one clock.
 *
 * Nothing in the forest moved. That matters more here than it would elsewhere:
 * the camera is orthographic and never rotates, so there is no parallax either,
 * and motion is the only depth cue left on the table.
 *
 * Everything is done in the vertex shader through `onBeforeCompile`, so it
 * costs no draw calls and no CPU — 80,000 clutter instances and 270 canopies
 * move for a handful of ALU ops each.
 *
 * Three things about this are not obvious and all three will bite:
 *
 * 1. `Material.clone()` silently drops `onBeforeCompile`. It is a *prototype*
 *    method on Material, so assigning one makes an own property, and `copy()`
 *    only carries the properties it enumerates. trees.js clones a leaf material
 *    per tree for the occlusion fade, so the patch has to go on *after* the
 *    clone or two thirds of the forest quietly stands still.
 *
 * 2. Both patches are module-level constants, deliberately. three's default
 *    `customProgramCacheKey()` returns `onBeforeCompile.toString()`, so every
 *    material that shares the same function object shares one compiled
 *    program. Building the patch inside a factory per material would compile
 *    334 identical shaders instead of one.
 *
 * 3. The shadow pass never sees any of this. `getDepthMaterial` returns three's
 *    own internal depth material and copies only map/alphaMap/alphaTest/side
 *    across — so a swaying canopy casts a still shadow. The clutter does not
 *    cast at all, and a 0.17 m crown movement against a 20 m shadow at a
 *    six-texel penumbra does not read, so this is left alone. If it ever does
 *    show, the fix is a `customDepthMaterial` per canopy carrying the same
 *    patch, at the price of 270 more materials.
 */

/** Shared across every patched material, so one write per frame drives all. */
const uTime = { value: 0 }
/** (amplitude, speed, wave number) — packed so there is one uniform to keep. */
const uCanopy = { value: new Vector3() }
const uCard = { value: new Vector3() }

/**
 * Push the current WIND config into the uniforms. Called at construction and
 * available to the debug panel, so wind is live-tunable without a rebuild.
 */
export function applyWind() {
  uCanopy.value.set(WIND.canopyAmplitude, WIND.canopySpeed, WIND.waveNumber)
  uCard.value.set(WIND.cardAmplitude, WIND.cardSpeed, WIND.waveNumber)
}

applyWind()

/** Advance the shared clock. Called once a frame from the world update. */
export function advanceWind(dt) {
  // Wrapped rather than left to grow: after a long session a large float loses
  // the precision the sine needs and the sway starts to judder. 4096 seconds is
  // a whole-number multiple of nothing in particular, which is the point — any
  // wrap point is a discontinuity, and this one is over an hour away and lands
  // on a sub-millimetre step at these speeds.
  uTime.value = (uTime.value + dt) % 4096
}

/**
 * A canopy sways as a *rigid* clump — the whole icosphere translates rather
 * than its vertices deforming.
 *
 * That is not laziness. `flatShading` derives its normals in the fragment
 * shader from the screen-space derivatives of the view position, so a
 * per-vertex displacement would rewrite the shading of every facet as the tree
 * moved. A rigid translation leaves the facets exactly as they were.
 *
 * Phase comes from the canopy's own world position, so a stand rolls as a wave
 * rather than pulsing in unison. The two clumps of a single tree have separate
 * model matrices, so they drift against each other slightly, which is most of
 * what stops it reading as mechanical.
 */
const canopySway = (shader) => {
  shader.uniforms.uTime = uTime
  shader.uniforms.uCanopy = uCanopy
  shader.vertexShader = `
    uniform float uTime;
    uniform vec3 uCanopy;
  ${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      vec2 world = modelMatrix[3].xz;
      float phase = uTime * uCanopy.y + ( world.x + world.y ) * uCanopy.z;
      transformed.x += sin( phase ) * uCanopy.x;
      transformed.z += sin( phase * 0.73 + 1.7 ) * uCanopy.x;
    }`,
  )
}

/**
 * A ground card bends instead: the displacement is masked by `uv.y`, which
 * `makeCardGeometry` lays out as 0 at the base and 1 at the tip, so the plant
 * stays rooted whatever its instance scale happens to be.
 *
 * Phase comes from `instanceMatrix[3].xz` — the instance's world translation,
 * free with the instancing attribute and needing no extra buffer. Note the
 * offset is applied in object space and so gets rotated and scaled by the
 * instance transform afterwards: bigger plants move further and neighbours
 * lean in different directions, both of which are what you want.
 */
const cardSway = (shader) => {
  shader.uniforms.uTime = uTime
  shader.uniforms.uCard = uCard
  shader.vertexShader = `
    uniform float uTime;
    uniform vec3 uCard;
  ${shader.vertexShader}`.replace(
    '#include <begin_vertex>',
    `#include <begin_vertex>
    {
      vec2 world = instanceMatrix[3].xz;
      float phase = uTime * uCard.y + ( world.x + world.y ) * uCard.z;
      transformed.x += sin( phase ) * uCard.x * uv.y;
      transformed.z += sin( phase * 0.81 + 2.1 ) * uCard.x * uv.y;
    }`,
  )
}

/** Make a canopy material sway. Call it *after* any clone. */
export function swayCanopy(material) {
  material.onBeforeCompile = canopySway
  return material
}

/** Make an instanced clutter-card material sway. Instanced meshes only. */
export function swayCard(material) {
  material.onBeforeCompile = cardSway
  return material
}
