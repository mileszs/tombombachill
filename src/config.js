/**
 * Scene layout and geometry. Anything about *colour* or *light* lives in
 * palette.js instead.
 */

/** Master seed for every procedural generator. Change it, get a new forest. */
export const SEED = 20260728

/** Ground plane is WORLD_SIZE x WORLD_SIZE, centred on the origin. */
export const WORLD_SIZE = 160

export const CAMERA = {
  /**
   * Down-angle from the horizon. True isometric is 35.26°; at this angle the
   * trunks stay visible and the ground reads as receding. Push it toward 50°
   * and it starts to look like a map rather than a diorama.
   */
  pitchDeg: 35,
  /** Rotation around the world Y axis, so trunks are seen at an angle. */
  yawDeg: 30,
  /**
   * Distance from the target. Under an orthographic camera this doesn't affect
   * framing at all — but it *does* set how much fog sits between the camera
   * and the world, so it's really a fog control: it sets the *baseline* haze
   * over the whole frame. The fog's own near/far planes (palette.js) are
   * measured from the camera, so they only mean anything relative to this.
   */
  distance: 30,
  /**
   * How hard the camera chases the player, per frame at 60fps. Small numbers
   * lag further behind, which is the point — the camera should feel dragged
   * along rather than bolted on. Frame-rate corrected in core/camera.js.
   */
  followLerp: 0.08,
  /** Vertical extent of the frustum, in world units. Horizontal follows aspect. */
  viewSize: 30,
  /**
   * Negative near is legal for an orthographic camera and necessary here: at
   * this distance the tops of foreground trees sit *behind* the camera plane,
   * and a near of 0 would slice them off.
   */
  near: -30,
  far: 200,
  /**
   * Offset from the clearing, which pushes the player and boombox down and
   * left of centre so the title overlay doesn't sit on them.
   */
  target: [-6.8, 0.6, -11.32],
}

/**
 * Trees are not scattered evenly — a low-frequency noise field over the ground
 * decides how likely a tree is to stand at any given point, which produces
 * dense stands separated by open clearings. These four knobs are the
 * level-design dial:
 *
 *   clusterScale       how big stands and clearings are
 *   clearingThreshold  how much of the map is clearing at all
 *   densityContrast    how abruptly a stand gives way to open ground
 *   count              how thick the stands are, given the above
 *
 * Raising `count` thickens the stands rather than filling the clearings — the
 * field zeroes out below the threshold, so no amount of trees will grow there.
 */
export const FOREST = {
  count: 167,
  /** Trees are scattered inside this radius, leaving the plane's edge bare
   *  (the fog swallows it long before then). */
  scatterRadius: 75,
  /** No tree centre may be closer than this to another. */
  minSpacing: 6.5,
  /** Keep the clearing around the player and boombox open. */
  clearingRadius: 9,
  /** World units per feature of the density field. Bigger = broader stands. */
  clusterScale: 30,
  /** Field values below this are bare clearing. Raise for more open ground. */
  clearingThreshold: 0.45,
  /** Higher = a sharper edge between stand and clearing. */
  densityContrast: 1.6,
}

/**
 * Ground clutter. `counts` is the density dial — every entry is a number of
 * instances, and each kind is one instanced draw call, so these can go a long
 * way up before it costs anything. Placement is clustered, so raising a count
 * thickens the existing patches before it fills the gaps between them.
 */
export const CLUTTER = {
  /** How many patches the undergrowth gathers into. */
  clusterCount: 110,
  /** Maximum radius of a single patch, in world units. */
  clusterRadius: 6.5,
  /** Clutter is scattered within this radius of the origin. */
  scatterRadius: 75,
  /** Fraction placed outside any patch, to soften the patch edges. */
  strayFraction: 0.18,
  /** Kept clear around the player's spawn so they aren't standing in a bush. */
  spawnClearRadius: 1.1,
  counts: {
    ferns: 16000,
    grassTufts: 45000,
    wildflowers: 13000,
    mushrooms: 4000,
    boulders: 2100,
  },
}

/**
 * How the player walks. These are feel values — expect to sit here with the
 * game running and nudge them.
 */
export const PLAYER = {
  /** Metres per second. Diagonals are normalised, so they are no faster. */
  speed: 3,
  /** Half-width of the soft cylinder used against trunks and the boundary. */
  radius: 0.35,

  /**
   * The walk bob, driven by distance travelled rather than by time — so it
   * stays in step with the feet whatever the speed ends up being.
   */
  bobCyclesPerMetre: 0.85,
  bobHeight: 0.05,
  /** Squash and stretch, in step with the bob: low in the dip, tall at the top. */
  bobSquash: 0.07,
  /** How fast the bob winds up and down when starting and stopping, per second. */
  bobEase: 8,
}

/**
 * The bounds of the walk.
 *
 * boundaryRadius is not free to choose. The camera shows clear, unfogged ground
 * about 35 m past the player in the near field — fog only hides the far
 * direction, because towards the camera the view depth is barely 8 m. So the
 * forest has to reach boundaryRadius + 35 or you watch the trees simply stop,
 * and the ground plane has to reach boundaryRadius + 36 or the void shows in
 * frame. WORLD_SIZE, FOREST.scatterRadius and CLUTTER.scatterRadius above are
 * all sized off this number: move it and they must move with it, and the counts
 * with them, or the density changes underneath you.
 */
export const WORLD = {
  boundaryRadius: 40,
  /** Distance over which the edge turns you around. Nothing ever stops dead. */
  boundarySoftness: 4,
}

/**
 * Fading whatever stands between the camera and the player.
 *
 * CLAUDE.md assumes a high canopy keeps the camera band clear and occlusion
 * never needs solving. At a 35° pitch that does not hold: a canopy at height
 * h covers 1.43·h metres of ground towards the camera, so a 15 m canopy
 * blankets 21 m of it and the player walks under something often.
 */
export const OCCLUSION = {
  /** What a blocking tree fades to. 0 would read as the tree vanishing. */
  fadedOpacity: 1.0,
  /** Metres of clearance kept around the player before a tree counts as blocking. */
  playerClearance: 1.2,
  /** How fast a tree fades in and out, per second. */
  fadeSpeed: 6,
  /** Trees further than this from the player are never tested. */
  testRadius: 45,
}

export const PROPS = {
  /**
   * Placed 3.2 m from the boombox along the camera's screen-horizontal axis —
   * a few paces, close enough to read as regarding it — and offset sideways
   * rather than in depth so the two don't stack on top of each other.
   */
  playerPosition: [-1.971, 0, 2.8],
  /**
   * The halfling's height, and the anchor for every other scale in the scene.
   * A hobbit stands about the height of a human child, so 1.15 m.
   */
  playerHeight: 1.15,
  boomboxPosition: [0.8, 0, 1.2],
}
