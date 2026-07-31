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

Full plan: `docs/PLAN.md`. Art references: `docs/reference/`.
**Look at the reference images before making visual changes.**

## Design principles

These exist so decisions make themselves. When a choice is ambiguous, consult
this list rather than optimizing for something else.

1. **Nothing punishes the player.** No damage, no death, no lockouts, no timers.
2. **The forest is bounded.** Hitting the edge turns you gently around. Fog is
   the boundary — the world's edge must never be visible. This is thematic, not
   a limitation to work around.
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

**Old-growth forest.** Massive trunks, canopy high overhead. This keeps the
camera band clear so ground is always legible and occlusion never needs solving.

**Golden hour.** Warm amber key light at a low angle against a *cooler* fill.
The warm/cool split is the entire look — if lit areas and shadowed areas are the
same hue and differ only in brightness, something is wrong. Note that lighting is
multiplicative: a surface with near-zero blue in its albedo cannot reflect a
blue-violet fill, so ground colors need some blue in them even though the swatch
looks duller.

**All color and light values live in `src/palette.js`** — a pure leaf module with
zero imports. Roles are named, not colors (`fill`, not `violet`). Never hardcode
a color anywhere else. The lil-gui panel binds to it; there's an export button
that emits a paste-ready object literal.

**Camera:** orthographic, fixed, never rotates, rotated off the world axis so
trunks are seen at an angle rather than dead-on. Isometric diorama, not a map.
The player should be clearly readable as the subject — if he reads as a small
detail in a wide landscape, the camera is too far back. Pulling back also breaks
the audio design: the pull of this game is hearing something you can't see yet,
so the camera must reveal less than the ears do.

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
- **Phase 1 — Walking.** Next. WASD, camera follow, sprite flip, code-driven bob
  and squash (no animation frames), soft circular collision, bounded edge.
- **Phase 2 — One sound.** Audio engine, one source, distance gain.
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
  were all correct and useful. The prompts come from a design conversation that
  has no visibility into the codebase — assume they may be wrong about current
  state and say so.
- Prefer explaining a tradeoff over silently picking one.
- Keep a running `docs/DECISIONS.md` of non-obvious implementation choices and
  their reasons — especially the traps (value noise never approaching theoretical
  amplitude, vertex colors multiplying the map, ortho fog behavior). Future
  sessions will need them.
