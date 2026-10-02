import { Vector3 } from 'three'
import { AUDIO } from '../config.js'

/**
 * The mixing board.
 *
 * The one rule, from CLAUDE.md, and the reason this file is shaped the way it
 * is: every stem is an AudioBuffer, started *once*, at the *same* moment,
 * against one AudioContext clock, looping forever. Nothing is ever stopped or
 * restarted. Walking changes gain and pan and nothing else — the forest is
 * always playing its entire score, and where you stand is the mix.
 *
 * HTML5 <audio> loops drift audibly against each other within a minute, which
 * is why none of this uses it. Buffers looped on a shared clock cannot drift.
 *
 * What decides the gains is the compass (see AUDIO in config.js and
 * `compassMix` below): all four stems at the boombox, narrowing to the stem
 * that owns your direction as you walk away from it.
 *
 * Signal path, per stem:     buffer → gain → pan ┐
 *                                                ├→ master → fade → speakers
 *                            buffer → gain → pan ┘
 *
 * `master` follows AUDIO.masterGain live; `fade` is only ever touched once, by
 * the fade-in on entering. Two nodes so neither has to know about the other.
 */
export function createAudioEngine() {
  // Created at boot so the files can decode while the world builds. It starts
  // suspended — browsers won't play sound before a gesture, and Chrome says so
  // in the console. That warning is expected; the front door resumes it.
  const context = new AudioContext()

  const fade = context.createGain()
  fade.gain.value = 0
  fade.connect(context.destination)

  const master = context.createGain()
  master.gain.value = AUDIO.masterGain
  master.connect(fade)

  const voices = AUDIO.stems.map((source) => {
    const gain = context.createGain()
    gain.gain.value = 0
    const pan = context.createStereoPanner()
    gain.connect(pan).connect(master)
    return { source, gain, pan, buffer: null }
  })

  // Each file fails on its own. A missing stem leaves a hole in the mix, which
  // is a thing you can hear and go and fix; it should never take the rest of
  // the forest down with it, or stop anyone walking.
  const loaded = Promise.all(
    voices.map(async (voice) => {
      try {
        const response = await fetch(voice.source.file)
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`)
        voice.buffer = await context.decodeAudioData(await response.arrayBuffer())
      } catch (error) {
        console.warn(`[audio] ${voice.source.id}: could not load ${voice.source.file}`, error)
      }
    }),
  )

  let started = false
  const right = new Vector3()
  const up = new Vector3()

  return {
    context,
    loaded,

    /**
     * Call from inside the click handler. `resume()` has to be reached
     * synchronously within the gesture or the browser refuses it, which is why
     * it comes before any await.
     *
     * If the files are still decoding when you step in, the forest simply
     * comes up a moment later. Every source still starts on the same tick.
     */
    async start() {
      if (started) return
      started = true

      const resuming = context.resume()
      await Promise.all([resuming, loaded])

      // A little lead, so every start() below is scheduled for a time that
      // hasn't happened yet — that is what makes them land on the same sample.
      const at = context.currentTime + 0.1

      for (const voice of voices) {
        if (!voice.buffer) continue
        const node = context.createBufferSource()
        node.buffer = voice.buffer
        node.loop = true
        node.connect(voice.gain)
        node.start(at)
      }

      fade.gain.setValueAtTime(0, at)
      fade.gain.linearRampToValueAtTime(1, at + AUDIO.fadeInSeconds)
    },

    /**
     * Once a frame. Reads AUDIO fresh every call so the debug panel is live.
     *
     * @param listener  {x, z} on the ground — the player
     * @param camera    for which way is "right" on screen
     */
    update(listener, camera) {
      const now = context.currentTime
      const tau = AUDIO.smoothing

      // The camera never rotates, but reading its right-hand axis off the
      // matrix means this stays correct if yawDeg is ever changed. "Up the
      // screen" on the ground is that axis turned a quarter round.
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      right.y = 0
      right.normalize()
      up.set(right.z, 0, -right.x)

      master.gain.setTargetAtTime(AUDIO.masterGain, now, tau)

      // Where he stands relative to the boombox, in screen terms: east is
      // right, north is up.
      const { centre, outerRadius } = AUDIO.compass
      const dx = listener.x - centre[0]
      const dz = listener.z - centre[2]
      const east = dx * right.x + dz * right.z
      const north = dx * up.x + dz * up.z

      for (const voice of voices) {
        const stem = voice.source
        voice.gain.gain.setTargetAtTime(
          stem.gain * compassMix(stem.bearingDeg, east, north, AUDIO.compass),
          now,
          tau,
        )

        // Pan towards the far end of the stem's own direction — the point at
        // the outer radius along its bearing — so from the middle each stem is
        // heard from the way you would walk to find it alone.
        const bearing = (stem.bearingDeg * Math.PI) / 180
        const homeEast = outerRadius * Math.sin(bearing)
        const across = (homeEast - east) / AUDIO.panWidth
        voice.pan.pan.setTargetAtTime(
          Math.max(-1, Math.min(1, across)) * AUDIO.maxPan,
          now,
          tau,
        )
      }
    },
  }
}

/**
 * How loud one stem is, 0–1, for a listener at (east, north) metres from the
 * centre.
 *
 * Two parts. How well his direction matches the stem's: cos of the angle
 * between them, floored at 0, so a stem is full on its own bearing, ~0.71 at
 * 45° off and silent from 90° away. And how far out he is, eased from 0 at
 * `innerRadius` to 1 at `outerRadius`, which blends from "every stem in full"
 * to "only the direction's own".
 *
 * Why cos: with stems 90° apart, the two either side of a diagonal get cos and
 * sin of the same angle, and cos² + sin² = 1 — so walking round the edge keeps
 * the same loudness rather than dipping between stems.
 *
 * Exported, and free of Web Audio, so it can be tested in Node.
 */
export function compassMix(bearingDeg, east, north, { innerRadius, outerRadius }) {
  const distance = Math.hypot(east, north)
  const t = smoothstep(innerRadius, outerRadius, distance)
  if (t === 0) return 1

  const bearing = (bearingDeg * Math.PI) / 180
  // Unit vector of the stem's direction against unit vector of his.
  const facing = (Math.sin(bearing) * east + Math.cos(bearing) * north) / distance
  const aligned = Math.max(0, facing)

  return 1 - t + t * aligned
}

/** 0 below `edge0`, 1 above `edge1`, and an S-curve between — no corners to hear. */
function smoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / Math.max(edge1 - edge0, 1e-6), 0), 1)
  return t * t * (3 - 2 * t)
}
