import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  FrontSide,
  MathUtils,
  Mesh,
  Object3D,
  Points,
  ShaderMaterial,
  SpotLight,
  Vector2,
} from 'three'
import { SEED } from '../config.js'
import { light } from '../palette.js'
import { makeRng } from '../util/rng.js'

/**
 * A spotlight on the boombox, from nowhere in particular.
 *
 * Two parts. A real SpotLight, so everything inside the pool is lit by it —
 * ground, undergrowth, the stump, and him when he walks in — and the boombox
 * throws a shadow inside its own pool. And a faint visible beam, because a
 * pool of light alone gets lost in golden-hour light that is already warm
 * and bright.
 *
 * The beam is a cone with additive blending and its own small shader. Its
 * edges fade by how side-on each part of the surface is to the camera, which
 * under an orthographic camera is just the view-space normal's Z, and it fades
 * out near the top so it has no hard apex hanging in the air.
 *
 * And motes: small soft points drifting up through the beam. Every one is
 * moved in the vertex shader from a fixed random seed and a clock, so they
 * cost nothing per frame on the CPU and there is no buffer to update.
 */

const BEAM_VERTEX = /* glsl */ `
  varying vec3 vViewNormal;
  varying float vDown;
  void main() {
    vViewNormal = normalize(normalMatrix * normal);
    // ConeGeometry spans y ∈ [−h/2, h/2] with the point at +h/2; this is 0 at
    // the point and 1 at the open base on the ground.
    vDown = 0.5 - position.y / BEAM_HEIGHT;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const BEAM_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying vec3 vViewNormal;
  varying float vDown;
  void main() {
    float facing = abs(normalize(vViewNormal).z);
    float fromTop = smoothstep(0.0, 0.45, vDown);
    gl_FragColor = vec4(color * opacity * facing * facing * fromTop, 1.0);
  }
`

/*
 * Each mote's whole life is a function of its seed and the time: it rises up
 * a column of the beam, wrapping round to the bottom, circling the light's
 * axis as it goes, and is kept inside the cone at whatever height it has
 * reached. It fades in at the bottom of its climb and out at the top, so the
 * wrap is never seen, and twinkles on its own rhythm in between.
 */
const MOTE_VERTEX = /* glsl */ `
  attribute vec4 seed; // angle, radius fraction, height fraction, phase
  uniform float time;
  uniform float height;
  uniform float radius;
  uniform float rise;
  uniform float swirl;
  uniform float size;
  uniform float pxPerMetre;
  varying float vAlpha;

  void main() {
    // Climb through the lower three quarters of the beam, where it is wide
    // enough to read; the narrow top is left empty.
    float range = height * 0.75;
    float y = mod(seed.z * range + rise * time * (0.7 + 0.6 * seed.w), range);
    float life = y / range;

    // The cone narrows to a point at the light: at height y its radius is
    // radius · (1 − y / height). Stay a little inside it.
    float inside = radius * (1.0 - y / height) * 0.85;
    float r = seed.y * inside + 0.12 * sin(time * 0.6 + seed.w * 6.2831);
    float a = seed.x + time * swirl * (0.6 + 0.8 * seed.w);
    vec3 p = vec3(cos(a) * r, y + 0.25, sin(a) * r);

    float twinkle = 0.55 + 0.45 * sin(time * (1.1 + 1.4 * seed.w) + seed.w * 40.0);
    vAlpha = smoothstep(0.0, 0.15, life) * (1.0 - smoothstep(0.7, 1.0, life)) * twinkle;

    vec4 view = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = size * pxPerMetre * (0.7 + 0.6 * fract(seed.w * 7.31));
  }
`

const MOTE_FRAGMENT = /* glsl */ `
  uniform vec3 color;
  uniform float opacity;
  varying float vAlpha;
  void main() {
    // A soft round dot, brightest in the middle, with no hard rim.
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float glow = 1.0 - smoothstep(0.0, 1.0, d);
    gl_FragColor = vec4(color * opacity * vAlpha * glow * glow, 1.0);
  }
`

function createMotes(count) {
  const rng = makeRng(SEED + 31)
  const seeds = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    seeds[i * 4] = rng() * Math.PI * 2
    // sqrt, so they spread evenly across the beam's cross-section rather than
    // bunching on its axis.
    seeds[i * 4 + 1] = Math.sqrt(rng())
    seeds[i * 4 + 2] = rng()
    seeds[i * 4 + 3] = rng()
  }

  const geometry = new BufferGeometry()
  // three wants a position attribute to draw anything; the real positions are
  // worked out in the shader, so these are only placeholders.
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3))
  geometry.setAttribute('seed', new BufferAttribute(seeds, 4))

  const material = new ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      height: { value: 1 },
      radius: { value: 1 },
      rise: { value: 0 },
      swirl: { value: 0 },
      size: { value: 0 },
      pxPerMetre: { value: 1 },
      color: { value: new Color() },
      opacity: { value: 0 },
    },
    vertexShader: MOTE_VERTEX,
    fragmentShader: MOTE_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  })

  const points = new Points(geometry, material)
  // The placeholder positions are all at the origin, so three's bounding
  // sphere would be a point and the motes would be culled at the frame edge.
  points.frustumCulled = false
  points.renderOrder = 3

  // Points are sized in pixels, so a size in metres has to be converted for
  // whatever the camera is doing now. For an orthographic camera,
  // projectionMatrix[5] is 2 / frustum height, so this is pixels per metre.
  const buffer = new Vector2()
  points.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(buffer)
    material.uniforms.pxPerMetre.value = (buffer.y * camera.projectionMatrix.elements[5]) / 2
  }

  return points
}

/**
 * @param at  [x, y, z] the boombox stands at; y is its ground height
 */
export function createSpotlight(at) {
  const [x, y, z] = at

  const spot = new SpotLight()
  // No falloff with distance: the pool's brightness is just `intensity`, which
  // keeps the one number in the palette meaning what it says.
  spot.decay = 0
  spot.distance = 0
  spot.castShadow = true
  // The pool is a few metres across, so a small map is plenty.
  spot.shadow.mapSize.set(1024, 1024)
  spot.shadow.bias = -0.0004
  spot.shadow.normalBias = 0.02

  const target = new Object3D()
  target.position.set(x, y, z)
  spot.target = target

  // A unit-high cone, scaled to the light's height and pool every frame, so
  // the palette can change both live without rebuilding geometry.
  const beamGeometry = new ConeGeometry(1, 1, 32, 1, true)
  const beamMaterial = new ShaderMaterial({
    uniforms: {
      color: { value: new Color() },
      opacity: { value: 0 },
    },
    defines: { BEAM_HEIGHT: '1.0' },
    vertexShader: BEAM_VERTEX,
    fragmentShader: BEAM_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: FrontSide,
  })
  const beam = new Mesh(beamGeometry, beamMaterial)
  beam.castShadow = false
  beam.receiveShadow = false
  // Drawn after the opaque world, so it adds light over whatever is behind it.
  beam.renderOrder = 2

  const motes = createMotes(light.spot.motes.count)
  motes.position.set(x, y, z)
  let time = 0

  /** Push the palette onto the light, beam and motes. Cheap; runs every frame. */
  const apply = (dt = 0) => {
    const { color, intensity, height, angleDeg, penumbra, beamOpacity } = light.spot
    const angle = MathUtils.degToRad(angleDeg)

    spot.color.set(color)
    spot.intensity = intensity
    spot.angle = angle
    spot.penumbra = penumbra
    spot.position.set(x, y + height, z)
    spot.shadow.camera.far = height + 5

    // The beam's base matches the pool: radius = height · tan(angle).
    const radius = height * Math.tan(angle)
    beam.scale.set(radius, height, radius)
    beam.position.set(x, y + height / 2, z)
    beam.visible = beamOpacity > 0
    beamMaterial.uniforms.color.value.set(color)
    beamMaterial.uniforms.opacity.value = beamOpacity

    time += dt
    const m = motes.material.uniforms
    const { opacity, size, rise, swirl } = light.spot.motes
    m.time.value = time
    m.height.value = height
    m.radius.value = radius
    m.rise.value = rise
    m.swirl.value = swirl
    m.size.value = size
    m.opacity.value = opacity
    m.color.value.set(color)
    motes.visible = opacity > 0
  }
  apply()

  return {
    light: spot,
    target,
    beam,
    motes,
    /** @param dt seconds since the last frame, which is what moves the motes */
    update: apply,
    /**
     * Lights are not in the scene traverse (see DECISIONS.md), so the world's
     * dispose never reaches this one's shadow map. The beam is a mesh and is
     * reached by the traverse, and so are the motes, so they need nothing here.
     */
    dispose() {
      spot.dispose()
    },
  }
}
