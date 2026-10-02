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
 * Signal path, per source:   buffer → gain → pan ┐
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

  const voices = AUDIO.sources.map((source) => {
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
      // matrix means this stays correct if yawDeg is ever changed.
      right.setFromMatrixColumn(camera.matrixWorld, 0)
      right.y = 0
      right.normalize()

      master.gain.setTargetAtTime(AUDIO.masterGain, now, tau)

      for (const voice of voices) {
        const { position, gain, innerRadius, outerRadius } = voice.source
        const dx = position[0] - listener.x
        const dz = position[2] - listener.z

        voice.gain.gain.setTargetAtTime(
          gain * falloff(Math.hypot(dx, dz), innerRadius, outerRadius),
          now,
          tau,
        )

        const across = (dx * right.x + dz * right.z) / AUDIO.panWidth
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
 * 1 inside `inner`, 0 beyond `outer`, and a squared curve between them. Linear
 * sounds wrong — most of the walk in would feel loud, then nothing would change
 * for the last few metres. Squaring it keeps the far field quiet and lets the
 * last stretch towards a source keep paying off.
 */
function falloff(distance, inner, outer) {
  const t = Math.min(Math.max((distance - inner) / Math.max(outer - inner, 1e-6), 0), 1)
  return (1 - t) * (1 - t)
}
