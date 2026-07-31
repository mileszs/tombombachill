import { PLAYER, WORLD } from '../config.js'

/**
 * Soft collision. Nothing here ever stops the player dead — a trunk pushes you
 * around itself and the edge of the world turns you back inwards, both by
 * displacing you along the normal rather than by refusing the move.
 *
 * The Old Forest steered walkers rather than barring them, which is the same
 * idea: you are never blocked, only persuaded.
 *
 * `resolve` takes where you were as well as where you want to be. That matters
 * for the boundary: a correction computed from position alone gets reapplied
 * every frame and drags you inwards indefinitely, so the player would stall
 * several metres short of the radius that was configured. Knowing the step lets
 * the edge damp *movement* instead, which leaves standing still a no-op.
 */
export function createCollider(trunks) {
  // A coarse spatial hash, because this runs against every trunk every frame
  // and the forest is a couple of hundred trees.
  const CELL = 8
  const buckets = new Map()

  for (const trunk of trunks) {
    const reach = trunk.radius + PLAYER.radius
    const x0 = Math.floor((trunk.x - reach) / CELL)
    const x1 = Math.floor((trunk.x + reach) / CELL)
    const z0 = Math.floor((trunk.z - reach) / CELL)
    const z1 = Math.floor((trunk.z + reach) / CELL)
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const key = `${cx},${cz}`
        if (!buckets.has(key)) buckets.set(key, [])
        buckets.get(key).push(trunk)
      }
    }
  }

  const empty = []

  return {
    /**
     * @param fromX,fromZ where the player was
     * @param toX,toZ     where they would like to be
     * @param out         mutated and returned as {x, z}
     */
    resolve(fromX, fromZ, toX, toZ, out) {
      let x = toX
      let z = toZ

      // --- trunks -------------------------------------------------------
      // Correcting only the overlap means walking into a trunk at an angle
      // glides around it rather than catching. This is idempotent: once you're
      // outside the radius it does nothing.
      const near = buckets.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? empty
      for (const trunk of near) {
        const dx = x - trunk.x
        const dz = z - trunk.z
        const minimum = trunk.radius + PLAYER.radius
        const distanceSq = dx * dx + dz * dz
        if (distanceSq >= minimum * minimum) continue

        const distance = Math.sqrt(distanceSq)
        if (distance < 1e-4) {
          // Dead centre, so there is no normal to push along. Pick one rather
          // than dividing by zero.
          x += minimum
          continue
        }
        const push = (minimum - distance) / distance
        x += dx * push
        z += dz * push
      }

      // --- the edge of the world ----------------------------------------
      const wasAt = Math.hypot(fromX, fromZ)
      const wouldBe = Math.hypot(x, z)
      const soft = WORLD.boundaryRadius - WORLD.boundarySoftness

      if (wouldBe > soft && wouldBe > wasAt && wouldBe > 1e-4) {
        // Heading outward through the last few metres. Scale down how much of
        // that outward intent is granted, reaching zero at the boundary, so the
        // walk slows and turns instead of hitting a wall. Standing still gains
        // nothing and loses nothing.
        const resistance = Math.min(1, (wouldBe - soft) / WORLD.boundarySoftness)
        const granted = wasAt + (wouldBe - wasAt) * (1 - resistance)
        const scale = granted / wouldBe
        x *= scale
        z *= scale
      } else if (wouldBe > WORLD.boundaryRadius && wouldBe > 1e-4) {
        // Already outside — only reachable by being placed there. Ease back in
        // rather than snapping, so it reads as being turned around.
        const target = wouldBe + (WORLD.boundaryRadius - wouldBe) * 0.1
        const scale = target / wouldBe
        x *= scale
        z *= scale
      }

      out.x = x
      out.z = z
      return out
    },
  }
}
