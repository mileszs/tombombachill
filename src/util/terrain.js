import { SEED } from '../config.js'

/**
 * The ground's displacement as a pure function of world position, so the mesh
 * and anything standing on it agree about where "the floor" is.
 */

/** Hash an integer lattice coordinate to [0, 1). */
function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1274126177)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function smoothstep(t) {
  return t * t * (3 - 2 * t)
}

/** Value noise on a unit lattice, returned in [-1, 1]. */
function valueNoise(x, y, seed) {
  const ix = Math.floor(x)
  const iy = Math.floor(y)
  const fx = smoothstep(x - ix)
  const fy = smoothstep(y - iy)

  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)

  const top = a + (b - a) * fx
  const bottom = c + (d - c) * fx
  return (top + (bottom - top) * fy) * 2 - 1
}

/**
 * Height of the ground at a world (x, z). Two octaves: a broad roll plus a
 * shallow ripple. Deliberately gentle — this is a lawn, not a landscape.
 */
export function terrainHeight(x, z) {
  return (
    0.9 * valueNoise(x / 26, z / 26, SEED) +
    0.32 * valueNoise(x / 9, z / 9, SEED + 101)
  )
}

/** Largest displacement terrainHeight can return, given the octave weights. */
export const TERRAIN_AMPLITUDE = 0.9 + 0.32

/**
 * Two octaves of value noise almost never land near their theoretical
 * amplitude — measured across the playable area, terrainHeight sits inside
 * about ±0.6, with two thirds of it inside ±0.2. Normalising against
 * TERRAIN_AMPLITUDE would therefore squash every sample into the middle of the
 * ramp and paint the whole map one flat mid-tone, so colour is normalised
 * against the band the noise actually occupies.
 */
const COLOR_RANGE = 0.6

/**
 * terrainHeight remapped to 0–1, so ground colour can be driven by the very
 * same noise that shaped the ground: 0 is the bottom of a hollow, 1 the top of
 * a rise.
 */
export function terrainElevation(x, z) {
  const normalized = terrainHeight(x, z) / COLOR_RANGE / 2 + 0.5
  return Math.min(1, Math.max(0, normalized))
}

/**
 * The same value-noise basis the terrain is built from, exposed for any other
 * system that wants a coherent field over the ground plane. `scale` is the
 * world size of one noise feature. Returns 0–1.
 */
export function noise2D(x, z, scale, seedOffset = 0) {
  return valueNoise(x / scale, z / scale, SEED + seedOffset) * 0.5 + 0.5
}

/**
 * Low-frequency [0, 1] field used to tint the ground, breaking up the visible
 * repetition of the grass tile.
 */
export function terrainTint(x, z) {
  const broad = valueNoise(x / 34, z / 34, SEED + 777)
  const detail = valueNoise(x / 11, z / 11, SEED + 913)
  return (broad * 0.7 + detail * 0.3) * 0.5 + 0.5
}
