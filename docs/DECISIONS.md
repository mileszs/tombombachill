# Decisions

Non-obvious implementation choices and, more importantly, the traps. Written
down because the reasoning is not recoverable from the code, and because most of
these cost an hour each to find.

---

## Traps

### Value noise never approaches its theoretical amplitude

Two octaves summed to a nominal ±1.22 actually sit inside about **±0.6**, with
two thirds of samples inside ±0.2. Normalising against the theoretical amplitude
squashes everything onto the middle of whatever ramp it feeds.

This bit twice. Ground colour came out one flat mid-tone until it was normalised
against the band the noise really occupies (`COLOR_RANGE` in `util/terrain.js`).
Then the tree density field did the same thing: the raw two-octave field spans
**0.25–0.68**, not 0–1, so `clearingThreshold` was operating on a range the noise
barely entered — mean density came out 0.049 and the forest collapsed into a few
knots. See `FIELD_MIN`/`FIELD_MAX` in `scene/trees.js`.

**Any new field over this basis needs the same renormalisation.** Measure the
percentiles first; don't trust the algebra.

### Vertex colours multiply the map

The ground's hue comes from vertex tints multiplied over the grass texture. You
cannot get brown soil by multiplying a brown tint into a green map — it lands on
olive. The grass texture is deliberately near-desaturated so the tints carry all
the hue. Re-green that texture and the soil silently breaks.

### Orthographic fog is a two-knob system

Fog depth is measured from the camera, and under an orthographic projection
every visible point sits at roughly `CAMERA.distance` ± half the view depth. So
`CAMERA.distance` sets the *baseline* haze over the whole frame, and the fog's
own near/far set how fast it deepens. They have to be tuned together.

Exponential fog was abandoned for this reason: it has no near plane, so its haze
starts at the camera and lays a floor of it over the foreground that can only be
reduced by moving the camera in. Linear `THREE.Fog` has an explicit near, which
is the whole reason it's used.

`CAMERA.near` is **negative** (-30). That is legal for an orthographic camera and
necessary: at this distance the tops of foreground trees sit behind the camera
plane and a near of 0 slices them off.

### Fog only hides the *far* direction

Easy to assume fog bounds the world in every direction. It does not. Towards the
camera the view depth is only about 8 m, so the near field is completely clear
out to roughly **35 m past the player** — see `WORLD.boundaryRadius` in
`config.js`, which is sized off this. Grow the walkable radius and the forest,
the clutter and the ground plane all have to grow with it or you watch the world
simply stop.

### PCFSoftShadowMap is deprecated, and `shadow.radius` only works on PCF

As of r185 `PCFSoftShadowMap` logs a deprecation and falls back to
`PCFShadowMap`. Worse, `shadowRadius` is sampled *only* by the
`SHADOWMAP_TYPE_PCF` branch (a five-tap Vogel disk); the PCF_SOFT branch uses a
fixed kernel and ignores it. So `PCFShadowMap` + `radius` is the combination
that actually softens anything.

### Palette values captured at module scope ignore every later edit

A `const MOSS = new Color(surface.ground.moss)` at the top of a module is
evaluated once at import. The debug panel's rebuild then appears to do nothing,
because the rebuilt world reads the same frozen values. Worse for `boombox.js`,
whose shared materials were disposed on rebuild and then handed straight back.

**Read palette values inside the function that uses them.** Every module in
`scene/` now does, and says so in a comment.

---

## Phase 1 — walking

### The update loop is delta-time with a clamp, not a fixed timestep

Everything that moves is expressed per second and multiplied by `dt`. The clamp
(`MAX_FRAME = 1/20`) matters: switching tabs hands back one enormous frame, and
without it the player teleports across the forest — through trunks, because
collision only ever corrects the position it is given, it does not sweep.

The tradeoff is that below 20fps the game runs in slow motion rather than
skipping ahead. That is the right way round for this game — nothing is
time-critical and nothing punishes the player — but it does mean wall-clock
speed can't be measured in a software-rendered headless browser, which runs this
scene at about 1.6fps. Measure distance per *simulated* second instead
(frames × clamped dt).

### The camera translates; it never re-aims

`camera.lookAt` is called exactly once, at construction. Following moves the
focus and translates the camera by the same vector, so the orientation is
untouched and the framing offset composed for the title is preserved exactly.
Calling `lookAt` every frame would work but would let the rotation drift with
floating-point error, and the design says the camera never rotates.

`followLerp` is expressed per frame at 60fps because that's how it's reasoned
about, then corrected with `1 - (1 - k)^(dt·60)`. Applying it raw would make the
camera lag further behind on a slow machine and stick to the player on a fast
one.

### The shadow box has to travel with the camera

The shadow camera only covers ±`extent`. Left at the origin it drops every
shadow in the scene the moment the player walks out of the original box, so
`followLighting` moves the key light and its target each frame.

Known artifact: the shadow map is not snapped to texel increments, so shadow
edges shimmer slightly while walking. Fixable by quantising the light's position
to the shadow-map texel size; not worth it yet.

### Collision takes *from* and *to*, and that is not incidental

The first version took a position alone and pushed it inside the boundary. That
correction gets reapplied every frame, so it compounds: the player stalled at
**36.6 m** against a boundary configured at 40, and the knob quietly lied.

A position-only correction has to be *idempotent* to be safe, and a soft one
can't be. Knowing the step lets the edge damp *movement* — scale down how much
outward intent is granted, to zero at the boundary — which leaves standing still
a no-op and lets the walk actually reach 39.95 of a configured 40.

Trunk push-out is still position-only, because correcting an overlap *is*
idempotent: once you're outside the radius it does nothing.

### Input is read as a direction, not as events

Sampled once per frame by the update loop, normalised at the source so diagonals
aren't √2 faster. Directions are in **screen** space and rotated into world
space by the player, because the camera sits 30° off the world axis — read them
as world directions and two of the four cardinals go visibly wrong.

`blur` clears the held set: a key held while the tab loses focus never sends a
keyup, and the player would walk off on their own.

### The bob is driven by distance, not time

`bobPhase` advances with metres actually covered, so it stays in step with the
feet whatever the speed becomes, and being pushed around a trunk slows the stride
rather than moonwalking on the spot. Squash and stretch come off the same sine —
tall at the top, wide and low in the dip — which is roughly volume-preserving and
is what stops it reading as the sprite simply scaling.

### The player sprite hides until its texture arrives

It is fetched over the network while the rest of the world is built
synchronously, so at first render the material has no map and it draws as a
plain white quad. `createPlayer` exposes a `ready` promise, surfaced as
`world.ready`, which the loading screen waits on. It resolves on error too, so a
missing sprite can't hang the boot forever.

---

## Boot

### The loading screen needs an explicit yield, and inline CSS

The world build is synchronous and takes the best part of a second. Dropping a
loading screen into the HTML isn't enough — the browser goes straight from
parsing into the block and never paints it. `main.js` waits for a real paint
(`requestAnimationFrame` twice: the first fires *before* the next paint, the
second after) before building anything.

The critical rules are also inlined in `<head>`. In dev, Vite injects the
stylesheet from JavaScript, so there is a window where the raw markup is on
screen with no CSS at all — long enough to see the wordmark at full size. A
loading screen defined only in `style.css` cannot cover a gap that exists
because `style.css` hasn't loaded.

One frame is rendered behind the loading screen before revealing, because that
first render is where every shader compiles.

---

## Assets

### Keying artwork off a single background is always an estimate

Several wordmarks were cut out of generated images. What works depends entirely
on the source:

- **Flat colour on true white** — scale alpha against the *fill's* luminance so
  the fill lands fully opaque, then un-composite. If the fill has a gradient,
  scale against a threshold above it instead, or its light areas go transparent.
- **Two-tone with a keyline on warm paper** — the fill can sit only ~17 levels
  from the paper, and letter counters are sealed inside the keyline where a
  border flood fill can't reach. Threshold the keyline, flood the paper inward,
  label the enclosed regions and classify each by its *mean* — individual pixels
  overlap, thousands averaged do not.
- **A solid object** (the wooden sign) — flood fill inward from the border. The
  board encloses everything, so nothing enclosed is background and no threshold
  has to separate letter from paper.
- **Two renders of the same art over white and black** — exact, no estimation:
  `a = 1 − (Ow − Ob)/255`, `F = Ob/a`. Check alignment first. This is the one to
  ask for.

**Transparent margin is not free.** An uncropped export is sized by the CSS caps
as a whole canvas, so the artwork inside it renders small — one wordmark came out
2.1× smaller on screen than the same art cropped tight. Always crop to the ink.

---

## Occluder fade

### CLAUDE.md's "occlusion never needs solving" does not hold at a 35° camera

The art direction reasons that a high canopy keeps the camera band clear. The
geometry disagrees: at a pitch of *p*, a canopy at height *h* covers `h/tan(p)`
metres of ground **towards the camera** — at 35° that is 1.43·h, so a canopy 15 m
up blankets 21 m of forest floor. Measured by walking 80 m across the finished
forest, something is between the camera and the player on about **three quarters
of steps**. Raising the canopy does not help; only a steeper camera would, and
the camera pitch is fixed by the diorama look.

### The test is in camera space, not a raycast

The camera is orthographic and never rotates, so "in front of the player" is a
comparison, not a query: transform a canopy's bounding sphere by the view
matrix, and it blocks if its depth is less than the player's and it lands within
a clearance of him on screen. Orthographic means no perspective divide, so
camera-space X and Y *are* screen offsets in metres — which is why
`playerClearance` is expressed that way and why it stays correct at any zoom.

A raycast was the obvious alternative and is worse: a ray can slip between the
two canopy clumps of a single tree and flicker, and it costs more than the ~300
vector transforms this does per frame.

Note a canopy directly overhead does *not* block — it sits high above the player
on screen. What covers him is the tree roughly 1.4·h *in front*. Testing "is
there a tree above me" would have solved nothing.

### Canopy materials are cloned per tree

They were shared across the forest from a five-swatch palette. Fading a shared
material ghosts every tree using it, so each tree now clones its own. This costs
nothing in draw calls — every tree already has unique geometry, so it was
already its own draw call — and adds 334 material objects.

### A faded tree must stop writing depth

`transparent: true` alone is not enough. The player is drawn in the transparent
pass and, being further away, is drawn *before* the nearer canopy; if that canopy
still wrote depth it would reject his fragments and he would stay hidden behind
a tree that looks see-through. So `depthWrite` is switched off for exactly as
long as a tree is faded, and restored when it is not.

Known: a faded tree still casts a full-strength shadow. The light comes from a
different direction than the camera, so the shadow is not over the player and it
reads as the tree still being there. Left alone deliberately.

### Testing this needed a headless harness, not a browser

Software rendering runs this scene at ~1.6 fps, and with the `dt` clamp the
player covers barely a metre in the time a browser test can run — so an in-scene
A/B never encounters an occluder and comes back identical with the fade on and
off. Both the geometry and the integration are covered by importing the real
modules in Node instead: `scene/trees.js` and `scene/occlusion.js` have no DOM
dependencies, so the real forest can be built and marched across headlessly.
Prefer that for anything that needs many simulated frames.

### Canopy clearance is enforced against a nominal radius, and is approximate

`CANOPY_CLEARANCE` (2.5 m) is applied by lifting a canopy until its underside
clears that height above the tree's own root. The guard bounds the canopy by
`canopyRadius × (1 + roughen) × maxScale`, which is close but not exact: the
roughening is asymmetric, so the geometry's real bounding sphere shifts off
centre and comes out slightly larger, and the tree's lean tilts it a little more.

Measured over 270 canopies, three land about 0.7 m under target — 1.80 m of
clearance instead of 2.5. Against a 1.15 m player that is still 0.65 m of
headroom, so the actual requirement (never walk through leaves) holds. Two real
bugs were fixed on the way here and are worth not reintroducing:

- the guard originally ignored the roughening entirely and under-measured by up
  to 20%, letting canopies dip to 1.42 m;
- the *second* canopy clump had no guard at all, though it is placed relative to
  the first, can be nearly as large, and is scaled again afterwards — it was
  quite capable of hanging below the canopy it sits beside.

Making it exact means measuring the transformed bounding sphere after the tree
is positioned and lifting from that. Not worth it while the margin is this
comfortable.
