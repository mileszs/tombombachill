/**
 * The whole scene's art direction, as data. No imports, no three.js types —
 * every colour and light intensity in the forest is a number in this file, so
 * tuning the look never means reading the scene code.
 *
 * Colours are 0xRRGGBB where three consumes them directly, and CSS strings
 * where they're painted onto a 2D canvas (see util/textures.js).
 *
 * The relationship that makes this read as golden hour is *temperature
 * separation*: the key is warm amber, the fill and ambient are distinctly
 * cooler. Warm everything up together and you get a green scene under a
 * yellow bulb; keep the shadows cool and you get late afternoon.
 */

export const light = {
  /** Warm amber key, low in the sky, throwing the long shadows. */
  key: {
    color: 0xffb265,
    intensity: 2.4,
    /** Height above the horizon. Lower = longer shadows. */
    elevationDeg: 33.5,
    /**
     * Compass bearing the light comes from.
     *
     * This is the single most consequential number in the file, because the
     * camera is fixed at bearing 30° and the *difference* is the whole read.
     * At the original 200° the two were 170° apart — very nearly dead
     * backlight — which put N·L = −0.821 on any trunk face pointing at the
     * camera. Every vertical surface the player ever sees was lit entirely by
     * the cool fill, so the warm/cool split survived only on the ground and on
     * canopy tops, and 26 m shadows fell straight towards the lens and stacked
     * up in the clearest part of the frame.
     *
     * At 95° the key rakes across instead: trunks and canopies get a lit side
     * and a shade side, and the shadows cross the frame. The useful band is
     * roughly 70–120°; past that it swings back towards frontal and the
     * modelling flattens again. Note the ground's brightness does not change
     * with this at all — its normal is up — so this knob can only ever affect
     * vertical surfaces and where the shadows go.
     */
    azimuthDeg: 95,
    /** Only sets the shadow camera's depth range, not the light's falloff. */
    distance: 100,
  },

  /**
   * Cool blue-violet sky fill. `groundColor` is the warm light nominally
   * bouncing back off the forest floor, which keeps the undersides of the
   * canopies from going flat.
   */
  fill: {
    color: 0x4f4e97,
    groundColor: 0x4a4a52,
    intensity: 1.05,
  },

  /** Cool base level, so nothing in shadow is ever fully black. */
  ambient: {
    color: 0x3d4a63,
    intensity: 0.3,
  },

  shadow: {
    /**
     * Half-width of the shadow camera box, centred on what the view camera is
     * looking at. Has to cover the visible ground *plus* the upwind margin
     * where off-screen trees stand, or their shadows pop in at the edge.
     */
    extent: 55,
    /**
     * Softness comes from radius, which is measured in shadow-map texels — so
     * these two are a pair. Dropping the map size from 4096 makes each texel
     * bigger and does half the softening on its own.
     */
    mapSize: 4096,
    radius: 6,
    bias: -0.0002,
    /** Past ~0.02 this shrinks the faceted canopies enough to leak light. */
    normalBias: 0.018,
    near: 1,
    far: 250,
  },

  /**
   * One of the keys in TONE_MAPPINGS (core/renderer.js): 'none', 'linear',
   * 'reinhard', 'cineon', 'aces', 'agx', 'neutral'.
   *
   * Note that `exposure` below does nothing under 'none' — three compiles the
   * tone-mapping stage out entirely, and the exposure multiply lives inside
   * it. 'linear' is the true no-curve option that still respects exposure.
   */
  toneMapping: 'linear',

  /**
   * Tone-mapping exposure. The master brightness knob.
   *
   * Higher than it looks like it should be because ACES internally applied
   * `exposure / 0.6`, so swapping it for 'linear' cost about 1.9x of
   * brightness that has to be put back here.
   */
  exposure: 1.8,
}

/**
 * Warm horizon haze, and the world's boundary — beyond `far` everything is
 * solid fog colour, so the ground plane's edge can never be seen.
 *
 * Linear rather than exponential specifically because it has a near plane.
 * These are distances from the camera, so they only mean anything relative to
 * CAMERA.distance (30). Measured against the current framing:
 *
 *   depth  9   bottom of the frame
 *   depth 18   the boombox and the halfling
 *   depth 22   `near` — haze starts here, so everything nearer is fully clear
 *   depth 51   top of the frame, ~86% hazed
 *   depth 56   `far` — solid fog colour
 *   depth 60+  everything beyond the frame, so no edge is ever visible
 *
 * Exponential fog had no such plane — its haze started at the camera, which
 * under an orthographic projection meant a floor of haze over the whole frame
 * that could only be lowered by moving the camera in.
 */
export const fog = {
  color: 0xf0c48a,
  near: 22,
  far: 56,
}

export const surface = {
  /**
   * The ground's hue comes entirely from these three vertex tints, blended by
   * terrain elevation: damp hollows are mossy, mid slopes dry out, exposed
   * rises wear through to bare soil.
   *
   * They work because the grass texture below is nearly desaturated — the two
   * *multiply*, so a green map would drag `soil` back towards olive and you
   * could never get actual brown. Keep the map neutral and the tints saturated,
   * not the other way round.
   */
  ground: {
    moss: 0x47774f,
    dryGrass: 0x8a9a52,
    soil: 0x8a6242,
    /** How much noise breaks up the elevation bands, 0–1. */
    blendJitter: 0.22,
    /** World units covered by one repeat of the grass texture. */
    tileSize: 6,
  },

  /** Painted onto a canvas, so: CSS colour strings. Near-neutral by design. */
  grass: {
    base: '#b9bdae',
    patchLight: { color: '#e2e6d2', alpha: 0.22 },
    patchDark: { color: '#787c6c', alpha: 0.2 },
    blades: ['#c6cbb9', '#d2d7c4', '#a9ad9d', '#dde1cf', '#b2b7a6'],
    flowerWarm: { color: '#eee4ba', alpha: 0.75 },
    flowerPink: { color: '#e8c8d0', alpha: 0.6 },
  },

  /** Ground clutter. Card textures are canvas-painted; solids are 0xRRGGBB. */
  clutter: {
    fern: ['#4c7d3a', '#5b9145', '#3e6b31', '#69a04b'],
    tuft: ['#6d9c4a', '#7fb055', '#598840', '#8cbe5f'],
    flowerStem: '#4f7a3a',
    flowerPetal: '#f4f2e6',
    flowerCenter: '#e8c65a',
    mushroomCap: 0xa4503a,
    mushroomStem: 0xe6dcc2,
    boulderStone: 0x8e8d85,
    /** Painted onto the boulder's up-facing vertices. */
    boulderMoss: 0x5c7a42,
    /**
     * Per-instance lightness drift, applied as an instance colour so a few
     * thousand copies of the same card don't read as stamped.
     */
    tintLow: 0xa8b4a0,
    tintHigh: 0xfff6e2,
  },

  bark: [0x5c4326, 0x6b4f2c, 0x4b3720],
  leaf: [0x4e7a37, 0x5d8b3c, 0x426b30, 0x6a9944, 0x385d2a],

  /**
   * Baked across each canopy by how far its faces tilt towards the sky, and
   * multiplied over the leaf colour above. This is what gives a single canopy
   * a warm lit crown and a cool shaded underside instead of reading as one
   * flat green ball — the Lambert term alone is far too subtle at this scale.
   * `high` should stay near white or it will tint every tree at once.
   */
  canopyShade: {
    low: 0x67748f,
    high: 0xfff3d2,
  },

  boombox: {
    stumpSide: 0x6a4c2c,
    stumpTop: 0xc39a63,
    shell: 0x30343c,
    trim: 0xb9bcc2,
    speaker: 0x16181c,
    accent: 0xd8a13c,
  },

  /**
   * Contact shadow under the player. Split into colour + two opacities rather
   * than rgba() strings so every field is drivable from a colour picker and a
   * slider — lil-gui's colour widget can't parse rgba().
   */
  blobShadow: { color: '#000000', core: 0.55, mid: 0.28 },
}
