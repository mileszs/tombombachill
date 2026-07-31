/**
 * Small deterministic RNG helpers. Every procedural generator in the scene
 * draws from one of these so a given SEED always rebuilds the same forest.
 */

/** mulberry32 — fast, decent distribution, 32-bit state. Returns [0, 1). */
export function makeRng(seed) {
  let a = seed >>> 0
  return function random() {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randRange(rng, min, max) {
  return min + rng() * (max - min)
}

export function randInt(rng, min, max) {
  return Math.floor(randRange(rng, min, max + 1))
}

export function pick(rng, items) {
  return items[Math.floor(rng() * items.length)]
}

/** Random sign, ±1. */
export function randSign(rng) {
  return rng() < 0.5 ? -1 : 1
}
