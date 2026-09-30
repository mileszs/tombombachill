# Tom Bombachill

A walkable forest that is also a mixing board.

## What this actually is

A small, bounded forest in three.js, viewed from a fixed overhead orthographic
camera, walked like an early Zelda game. Scattered through the forest are
**invisible sound sources**. Each is a stem — a deliberately incomplete piece of
music, recorded acoustically, looping forever, locked to one shared tempo and key.

No stem is a complete piece alone. A glade with one source sounds like something
is missing. Walking assembles the arrangement. The player is finishing the
compositions with their feet and is never told this.

There is no goal, no inventory, no failure state, no score, no map, no HUD.
The only verb is *go*. Later, one secondary verb: *sit*.

This is a personal art project for a private audience of about a dozen invited
friends. There are no users to optimize for, no metrics, no monetization. Do not
suggest analytics, onboarding, engagement features, or growth mechanics.

Full plan: `docs/PLAN.md` — **not written yet**. Art references:
`docs/reference/` — **does not exist**, so there is currently nothing to look at
before making visual changes; ask for references rather than inventing them.

`docs/DECISIONS.md` *does* exist and is the record of non-obvious choices and,
more usefully, the traps. Read it before touching rendering, terrain, fog or
collision — several of them cost an hour each to find and are not recoverable
from the code.

## Design principles

These exist so decisions make themselves. When a choice is ambiguous, consult
this list rather than optimizing for something else.

1. **Nothing punishes the player.** No damage, no death, no lockouts, no timers.
2. **The forest is bounded.** Hitting the edge turns you gently around. Fog is
   the boundary — the world's edge must never be visible. This is thematic, not
   a limitation to work around. But fog only hides the *far* direction: towards
   the camera the view depth is barely 8 m, so the near field stays clear for
   about 35 m past the player and the world has to be physically large enough to
   fill it. `WORLD.boundaryRadius` is sized off that, and the ground plane, the
   forest radius and the clutter radius are sized off it in turn.
3. **Sources hide.** Exactly one sound source is visibly attached to an object
   (the boombox). Everything else emits from nowhere in particular.
4. **Every stem is incomplete.** If it sounds finished alone, it's wrong.
5. **One musician, one room, one microphone.** All stems are mouth, body, or
   acoustic instrument. Two deliberate exceptions: the boombox (the forest's one
   anomaly) and the MIDI in the ruin (outside the forest, outside the rule).
6. **Three depths of reference.** Surface (funny to anyone), middle (funny if
   you've read Tolkien), deep (in file names, class names, comments). Nobody has
   to find the deep layer. Feel free to add to it.
7. **It must survive a nine-month gap.** No workflow that requires remembering a
   build pipeline. Adding a stem should be: drop a file, edit one JSON entry,
   commit. Prefer boring, obvious code over clever architecture.
8. **Ship the thing that doesn't work first.** The Ring mechanic, whose entire
   function is to fail cheerfully, matters more than most things that work.
9. **Curation is composition.** Nothing goes from submission to world without
   passing through the author's hands. Never build an upload form or an
   auto-placement system.
10. **Slowness is a material.** Where latency exists, it is the effect, not a
    problem to minimize.

## Characters — important

**The player** is a small barefoot child in a plain tunic and rolled trousers,
seen from behind or in a simple front view. No backpack, no items, no weapons,
no visible face. A backpack implies a journey and inventory; there is neither.

**Tom Bombadil is never rendered.** A bearded figure in a blue coat and feathered
hat appeared in an early placeholder — that was wrong. Tom exists only as an
*audio source* that flees when approached (see "fleeing" source type). Do not
reintroduce him as a visible object, ever, under any framing.

Nothing in the visible copy or assets uses trademarked Tolkien terms. The player
is addressed as "you" and is never named.

## Art direction

**Hybrid.** Low-poly 3D geometry for anything that casts a shadow. Alpha-card
sprites for everything else. No Blender, no asset pipeline — trees are generated
procedurally in code so the forest is tuned by changing numbers.

**Old-growth forest.** Massive trunks, canopy high overhead, so the band at eye
level stays clear and the ground is always legible.

This does **not** remove occlusion, which was the original hope here. At a 35°
pitch a canopy at height *h* covers `h/tan(35°)` = 1.43·h metres of ground
*towards the camera*, so a canopy 15 m up blankets 21 m of forest floor.
Measured across the finished forest, something stands between the camera and the
player on roughly **three quarters of steps**. Raising the canopy cannot fix
this; only a steeper camera could, and the pitch is fixed by the diorama look.
Trees that block him fade to 45% and back — `scene/occlusion.js`, tuned by the
`OCCLUSION` block in `config.js` and by its folder in the debug panel. Canopies
are tested as bounding spheres, trunks as capsules. Note this feature was inert
from the initial commit until 2026-09, so its numbers are the least-settled in
the project; `docs/DECISIONS.md` says why and how to tell.

**Golden hour.** Warm amber key light at a low angle against a *cooler* fill.
The warm/cool split is the entire look — if lit areas and shadowed areas are the
same hue and differ only in brightness, something is wrong. Note that lighting is
multiplicative: a surface with near-zero blue in its albedo cannot reflect a
blue-violet fill, so ground colors need some blue in them even though the swatch
looks duller.

The key's `azimuthDeg` only means anything *relative to the camera's bearing of
30°*, and it is the most consequential number in `palette.js`. It sat at 200 —
170° away, near-dead backlight — which put N·L = −0.821 on any trunk face
pointing at the camera, so every vertical surface in the game was lit purely by
the cool fill and the split survived only on the ground and canopy tops. It is
now 95, raking. The useful band is roughly 70–120°. The ground's brightness does
not change with this at all, so it is a safe thing to push around.

**The forest moves.** A slow roll through the canopies and a faster shiver
through the undergrowth, done entirely in the vertex shader — `scene/wind.js`,
tuned by the `WIND` block. With a fixed orthographic camera there is no parallax
either, so motion is the only depth cue left, and slowness being a material
makes a slow wind exactly on-theme. Err towards too slow.

**All color and light values live in `src/palette.js`** — a pure leaf module with
zero imports. Roles are named, not colors (`fill`, not `violet`). Never hardcode
a color anywhere else. The lil-gui panel (backtick toggles it) binds to it.
The export button described here **does not exist yet** — values still have to
be copied out of the panel by hand.

**Camera:** orthographic, never rotates, rotated off the world axis so trunks are
seen at an angle rather than dead-on. Isometric diorama, not a map. It follows
the player by *translating only* — `lookAt` is called once, at construction.
Pulling back breaks the audio design: the pull of this game is hearing something
you can't see yet, so the camera must reveal less than the ears do.

**Open tension, recorded rather than settled.** The player reads as a small
figure — 3.8% of frame height in the establishing shot, 6.4% once the camera has
pushed in to `walkViewSize` — which is the "small detail in a wide
landscape" this section used to warn against. Framing him larger was tried and
abandoned: at `viewSize` 16 the camera sits *inside* the canopy layer, one 20 m
tree fills half the frame, and its canopy hides both the player and the boombox.
You cannot frame a 1.15 m figure and 20 m trees in a single orthographic shot.
The forest won that argument for now. Revisit it only together with tree height,
not on its own.

**Tree density is the only level-design tool.** There are no walls, fences, or
map. Dense stands are connective tissue; clearings are where audio sources live.
Clearings are zeroed rather than thinned, so raising tree count thickens stands
instead of filling clearings. `standDensity` is exported for placing sources.

## Audio architecture — non-negotiable

Not built yet (Phase 2+), but design around it now:

> Every stem loads as an `AudioBuffer`, starts **once**, at the same moment,
> against a single shared `AudioContext` clock, with `loop = true`, and runs
> forever. Stems are never started or stopped again. Player position changes only
> **gain** and **pan**.

This exists because HTML5 `<audio>` loops drift audibly within a minute and it
cannot be fixed after the fact. Retrofitting this later is a rewrite. The forest
is always playing its entire score; the player's position is a volume automation
curve across the whole mix.

Browsers won't autoplay audio, so the front door ("step into the forest") is the
gesture that unlocks the context. That's a feature, not a workaround.

Source types, all configurable from `zones.json`: `static`, `facing-gated`
(audible only when facing away), `fleeing` (retreats at exactly the player's walk
speed, drifts home when not chased — this is Tom), plus `reverbZones` which are
sends rather than sources.

## Phase status

- **Phase 0 — The Still.** Done. Static scene, no controls, no audio.
- **Phase 1 — Walking.** Done. WASD and arrows, camera follow, sprite flip,
  code-driven bob and squash (no animation frames), soft circular collision,
  bounded edge. Plus an occluder fade, which turned out to be necessary — see
  art direction — and, after a visual audit in 2026-09, wind, contact shading
  baked into the ground, and a raking key.
- **Phase 2 — One sound.** Next. Audio engine, one source, distance gain.
- **Phase 3 — The mixing board.** All stems, `zones.json`, the four-source sweet
  spot that is unmarked and findable only by accident.
- **Phase 4** — zone character. **Phase 5** — feel + the `sit` state machine
  (must emit events; later phases depend on it). **Phase 6** — contributor
  credits. **Phase 7** — admin (probably never; resist it). **Phase 8** — the
  ruin. **Phase 9** — inscriptions.

See `docs/PLAN.md` for full phase detail and the `zones.json` schema.

## Working style

- Plain JavaScript, ES modules. No React, no TypeScript. Vite + three.js.
- Static site. Deploys to Cloudflare Pages. No backend until Phase 8.5.
- Tunables that get adjusted while playing go in `config.js`; art direction that
  gets adjusted while looking at a reference goes in `palette.js`.
- **Push back when the request doesn't match the code.** Past corrections about
  camera pitch, `yawDeg`, and `shadowRadius` being ignored by the PCF_SOFT branch
  were all correct and useful. So were the later ones: fog bounding only the far
  direction, the canopy not clearing the camera band, and a soft world boundary
  needing the *step* rather than the position or it silently stalls the player
  metres short of the configured radius. The prompts come from a design conversation that
  has no visibility into the codebase — assume they may be wrong about current
  state and say so.
- Prefer explaining a tradeoff over silently picking one.
- Keep a running `docs/DECISIONS.md` of non-obvious implementation choices and
  their reasons — especially the traps (value noise never approaching theoretical
  amplitude, vertex colors multiplying the map, ortho fog behavior). Future
  sessions will need them.
