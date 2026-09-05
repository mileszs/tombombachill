# Decisions

Non-obvious implementation choices and, more importantly, the traps. Written
down because the reasoning is not recoverable from the code, and because most of
these cost an hour each to find.

---

## Traps

### `material.transparent` is a shader define, not a uniform

Flipping `material.transparent` at runtime does **nothing** unless you also set
`material.needsUpdate = true`.

`opaque` — `transparent === false && blending === NormalBlending &&
alphaToCoverage === false` — is a *program parameter* in three, part of the
program cache key, compiled to `#define OPAQUE`, which makes
`opaque_fragment.glsl` execute `diffuseColor.a = 1.0`. And `needsProgramChange`
in `WebGLRenderer` checks lights, colour space, batching, instancing, skinning,
envMap, fog, clipping, vertex alphas, tangents, morphs and tone mapping — but
never `transparent`. So the material keeps its opaque program, the alpha is
forced back to 1 in the fragment shader, and the `opacity` uniform (which *is*
re-uploaded) is thrown away.

This cost the occluder fade its entire existence: the feature shipped inert and
stayed that way from the initial commit. It presents as nothing at all — the
forest simply looks like it has no fade — so the only way to tell it apart from
working correctly is a forced extreme. Set `fadedOpacity: 0` and
`playerClearance: 200` so every tree is commanded to vanish, render, and diff:
if the frame does not change, the fade is not running. Broken, that test moved
3.6% of pixels; fixed, 38.7%.

Guard the `needsUpdate` on the *transition*, not on every frame of the ease —
recompiling 334 materials per frame stalls the walk.

### `Material.clone()` silently drops `onBeforeCompile`

`onBeforeCompile` is a prototype method on `Material`, so assigning one makes an
*own* property, and `copy()` only carries the properties it enumerates. Anything
that clones a patched material gets an unpatched one and no warning.

`trees.js` clones a leaf material per tree (for the occlusion fade), so the wind
patch has to be applied **after** the clone or two thirds of the forest stands
still. See `scene/wind.js`.

The flip side is worth knowing: the default `customProgramCacheKey()` returns
`onBeforeCompile.toString()`, so every material sharing one *function object*
shares one compiled program. Build the patch in a per-material factory and you
compile 334 identical shaders instead of one. Both patches in `wind.js` are
module-level constants for exactly this reason.

### A baked vertex attribute nobody reads costs nothing and shows nothing

`makeCanopyGeometry` computed the warm/cool `canopyShade` ramp, allocated it,
and uploaded it on all 270 canopies — while `makeMaterials(surface.leaf)` was
called without its `vertexColors` argument, so every byte was ignored. The
palette comment described an effect that had never once rendered.

Nothing errors. Nothing warns. **When you bake into a `color` attribute, check
the material actually asks for it.** Note the inverse is also a trap and is why
`makeMaterials` takes the flag at all: a Lambert material with
`vertexColors: true` and no attribute to read gets (0,0,0) and renders black,
which is why bark must keep it false.

### Lights are not in the scene traverse

`disposeWorld` walked the scene disposing geometries and materials, which never
reaches a `DirectionalLight` — it has neither. The orphan is a 4096² depth
target, about 64 MB, per rebuild, and the debug panel fires a rebuild every
220 ms while you drag a colour picker. `DirectionalLight.dispose()` releases its
own shadow map, so one call covers it.

`InstancedMesh` is the same shape of problem: `instanceMatrix` and
`instanceColor` live outside the geometry and only release through the mesh's
own `dispose()`. Five clutter meshes, 80,000 instances, ~6 MB a rebuild.

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

### It never ran, and so none of its numbers had ever been seen

The whole feature was inert until 2026-09 — see "material.transparent is a
shader define" above. Everything below it in this section was reasoned out
correctly and then never validated against a pixel, so treat the numbers with
suspicion and the reasoning with less.

Two things that reasoning got wrong, found the moment it first rendered:

- **0.22 was far too transparent.** A faded canopy over the bright fog stopped
  reading as a tree and came apart into a scatter of translucent facet edges —
  worse once the canopy vertex ramp and the raking key gave those facets real
  contrast. 0.45 holds together as a dome you can see through, and the player
  still reads clearly against it.
- **`playerClearance: 1.2` ghosted trees nowhere near him.** The canopy test is
  a *bounding sphere*, and a rotated, non-uniformly scaled icosphere is bounded
  by its largest scale component — so the test circle is already up to half
  again the width of the visible leaves. Adding 1.2 m on top faded a stand at a
  time. 0.3 is the current value.

`depthWrite` was suspected too, and is not the problem: forcing it true while
faded changes mean luminance by 0.04 of 255. The existing reasoning for turning
it off still holds, and it stays off.

The fade now has its own folder in the debug panel, because these are the
least-tuned numbers in the project.

### The trunk needed a different shape, not more spheres

Canopy spheres miss the trunk case entirely. For a tree close to the camera the
canopy has already climbed off the top of the player on screen while the trunk,
which starts at the ground, has not. Measured over 18,826 simulated steps: a
trunk overlaps the player on **15.2%** of steps, and on **6.0%** no canopy
sphere is near enough to trigger anything.

Tiling a 17 m trunk with spheres at its own radius would take about twenty of
them, so the trunk is tested as a **capsule** instead: transform its two ends,
find the closest point on the screen-space segment to the player, and compare
depth *at that point* so a trunk standing behind him never fades. Two transforms
instead of twenty, and exact along the whole length.

`trunkClearance` is deliberately tighter than `playerClearance`. A canopy is a
soft mass and fading it early costs nothing; a trunk is a hard narrow blocker at
eye level, and a generous clearance ghosts half the stand every time you walk
past one.

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
### The player sprite is generated, and its source is tools/player-sprite.html

The sprite is a placeholder standing in for real art. Its source is a single
self-contained HTML file: open it in a browser, click a tone, save the download
over `public/sprites/player.png`. No build step and no dependencies, because a
generator that needs a toolchain is a generator that will not survive a
nine-month gap.

Skin, its shading and hair move together as a named tone rather than as loose
constants — hair that reads against a light tone disappears against a deep one.
`TONES` in that file is the ladder a skin-tone chooser should offer when one
lands, and the drawing routine already takes a tone, so the game-side work is
picking one and reloading the texture rather than rewriting the sprite.

Note this colour deliberately does *not* live in `palette.js`. The sprite is a
baked PNG, so nothing in the running game can tint parts of it — palette.js is
for values three consumes at runtime, and putting a dead one there would be a
lie.


---

## Light, ground and wind

### The key's azimuth is only meaningful *relative to the camera's bearing*

The camera sits at bearing 30°. The key was at 200°. That is 170° apart — very
nearly dead backlight — and the consequence is not subtle: on a trunk face
pointing straight at the camera, **N·L = −0.821**. Every vertical surface the
player ever looks at received zero key light and was lit entirely by the cool
fill, so the warm/cool split that the art direction calls "the entire look"
survived only on the ground and on canopy tops. Shadows fell toward bearing 20°,
almost straight at the lens, so a 17 m tree laid a 26 m shadow down the screen
into the clearest part of the frame, where they stacked into noise.

At 95° the key rakes across instead. Mean frame luminance rose 37.2 → 46.5 with
no change to exposure, purely from surfaces that were previously unlit.

**The ground's brightness does not change with azimuth at all** — its normal is
up, so only elevation matters to it. That makes this a safe knob: it can affect
nothing but vertical surfaces and where the shadows go.

### Contact shading is baked into the ground's vertex colours, not drawn

Two darkenings — a cool shift under dense stands, driven by the already-exported
`standDensity()`, and a contact ring where each trunk meets the ground — are
both lerped into the same vertex tints the ground already multiplies over its
neutral grass map. No new draw call, no runtime cost, no transparency ordering,
and nothing to z-fight with the terrain it sits on.

This is why **the forest is built before the ground** in `scene/index.js`: the
ground needs the trunk positions and radii. It is also why `GROUND.segments`
went from 160 to 288 — a 1 m grid cannot draw a 1.4 m ring without going blocky.
Trunks are bucketed into a 4 m grid first, or it is 167 trunks × 83,000 vertices
at build time.

**Do not reach for `aoMap` here.** `aomap_fragment` applies occlusion as
`reflectedLight.indirectDiffuse *= ambientOcclusion` — it darkens only the
*indirect* term, which in this rig is the hemisphere and ambient, i.e. the
entire cool half of the palette. An aoMap would make enclosed ground *warmer and
flatter*, which is exactly backwards for this art direction. It would also need
a `uv1` set and a baked texture, which means an asset pipeline.

### Wind is two shader patches and one clock

`scene/wind.js`. Everything is in the vertex shader through `onBeforeCompile`,
so 80,000 clutter instances and 270 canopies move for no draw calls and no CPU.
Phase comes from `instanceMatrix[3].xz` for instanced cards and `modelMatrix[3]`
for canopies — both free, neither needs a new attribute.

Canopies translate **rigidly**. That is not laziness: `flatShading` derives its
normals in the fragment shader from the screen-space derivatives of the view
position, so a per-vertex displacement would rewrite the shading of every facet
as the tree moved. Cards do bend, masked by `uv.y` — 0 at the base, 1 at the tip
in `makeCardGeometry` — so the plant stays rooted whatever its instance scale.

Known and accepted: **the shadow pass never sees any of it.** `getDepthMaterial`
returns three's own internal depth material and copies across only
`map`/`alphaMap`/`alphaTest`/`side`, so a swaying canopy casts a still shadow.
The clutter does not cast at all, and a 0.17 m crown movement against a 20 m
shadow at a six-texel penumbra does not read. If it ever does, the fix is a
`customDepthMaterial` per canopy carrying the same patch, at the price of 270
more materials.

### Shadow texel snapping fixes the swimming but not all of the fizz

`followLighting` now quantises the shadow box to whole shadow-map texels before
moving it, so a stationary tree lands on the same texels frame after frame.
`LightShadow.updateMatrices` sits the shadow camera at the light and `lookAt`s
the target with the default up vector, so with a fixed elevation and azimuth the
basis is constant and can be precomputed: `right = cross(up, towardsSun)`,
`up' = cross(towardsSun, right)`.

What it does **not** fix: r185's `SHADOWMAP_TYPE_PCF` branch rotates its five-tap
Vogel disk by `interleavedGradientNoise(gl_FragCoord.xy)` — *screen* space. The
camera lerps by a sub-pixel amount every frame, so a fixed world point still
slides across that noise field and its five-tap estimate keeps changing. The
residue is a fine edge shimmer rather than the whole shadow drifting. The tap
count is not exposed; the remaining lever is a smaller `shadow.extent`, which
buys resolution and lets `shadow.radius` come down.

### Canvas cards need their colour bled into the transparent margin

A canvas starts as RGBA (0,0,0,0) and stays that way wherever nothing is drawn.
three uploads it unpremultiplied and mipmaps it with a plain `generateMipmap`,
which averages that **black** into the RGB of every texel along an edge. These
cards are ten to twenty pixels tall on screen, so they draw from a deep mip
almost always, and the surviving fringe reads as every leaf being dirty rather
than soft.

`bleedEdges` in `util/textures.js` runs two passes of a four-neighbour dilate
before the `CanvasTexture` is built. **Alpha is never touched**, so `alphaTest`
behaviour is unchanged and nothing invisible becomes visible. Note a filled
texel is still fully transparent, so alpha alone cannot tell it from an unfilled
one on the second pass — the RGB has to be checked too.

### The contact shadow is a flat quad and the ground is not flat

`terrainHeight`'s maximum gradient over the walkable disc is 0.164/m, which is a
5.9 cm rise across the blob's own 0.36 m radius — twice the 3 cm it used to be
lifted by. On about **16%** of the walkable area the uphill arc was clipped by
the ground, and the bite travelled as you walked. It now sits on the highest of
four rim probes, so on the downhill side it floats instead, which is much the
lesser evil.

Separately: the material had a hardcoded `color: 0x000000` multiplying over a
texture already painted in `surface.blobShadow.color`, so the blob could only
ever be pure black and the panel's swatch — which pays a full world rebuild —
changed nothing. It was the only hardcoded hex outside `palette.js` in `src/`.

---

## Deployment

### Workers static assets, not Pages

Cloudflare now routes static sites through Workers with static assets; Pages
still runs but is not where new projects go. `wrangler.jsonc` has no `main` —
an assets-only Worker runs no server code, it just serves `dist/`. Static asset
requests are unmetered on the free plan, so the whole forest costs nothing.

`not_found_handling: "single-page-application"` is set so unknown paths fall
back to `index.html` rather than 404ing. Costs nothing today, avoids a surprise
if routes ever appear.

### The two traps that ate an afternoon

**A fresh `*.workers.dev` subdomain has no certificate yet.** The first deploy
to a brand-new account subdomain returns `ERR_SSL_VERSION_OR_CIPHER_MISMATCH` —
DNS resolves, but the TLS handshake dies with alert 40 because the edge has no
cert to present for that SNI. Nothing is wrong with the deploy. It provisions on
Cloudflare's own schedule. Don't debug it; bind the real domain, whose zone
already has Universal SSL, and skip `workers.dev` entirely.

**`custom_domain: true` refuses to share an apex.** If any A/AAAA/CNAME already
exists on the hostname, the trigger fails with a 409 the CLI reports only as
"a request to the Cloudflare API failed" — the actual message (`code 100117`,
"already has externally managed DNS records") is buried in the log file, and is
redacted there too unless you re-run with `WRANGLER_LOG_SANITIZE=false`.
The orphaned records here were pointing at a dead origin and serving 522s.
Delete only the A and AAAA. **The MX and SPF TXT records are Namecheap email
forwarding** — removing those breaks mail to the domain, silently.

Adding `routes` disables `workers.dev` for the Worker automatically. That is the
desired end state, and it makes the uncertificated subdomain moot.
