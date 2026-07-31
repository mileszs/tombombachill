# sprites

`player.png` — the player character: a small barefoot child in a plain tunic
and rolled trousers, **seen from behind**, on a transparent background.

Loaded by `src/scene/player.js` as a camera-facing billboard. The sprite is
scaled to `PROPS.playerHeight` (1.2 world units) and its width is taken from
the image's own aspect ratio, so any dimensions work as long as the character
fills the frame vertically and stands on the bottom edge — that edge is the
pivot that meets the ground.
