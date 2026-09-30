import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three'
import { makeRng, randRange } from './rng.js'
import { SEED } from '../config.js'
import { surface } from '../palette.js'

/**
 * Textures are painted onto canvases at load time rather than loaded from disk:
 * no assets to ship, and the palette stays in one place with the rest of the
 * art direction.
 */

/**
 * Palette entries that need transparency are stored as {color, alpha} so the
 * debug panel can bind a colour picker to them; canvas wants an rgba() string.
 */
function rgba({ color, alpha }) {
  const hex = parseInt(color.slice(1), 16)
  return `rgba(${(hex >> 16) & 255}, ${(hex >> 8) & 255}, ${hex & 255}, ${alpha})`
}

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return { canvas, ctx: canvas.getContext('2d') }
}

/**
 * Push colour outwards into the transparent margin of an alpha-cut card.
 *
 * A canvas starts as RGBA (0,0,0,0) and stays that way wherever nothing is
 * drawn. three uploads it unpremultiplied and then mipmaps it with a plain
 * `generateMipmap`, which averages that *black* into the RGB of every texel
 * along an edge. These cards end up ten to twenty pixels tall on screen, so
 * they are drawn from a deep mip almost always, and the surviving fringe reads
 * as every leaf being dirty rather than soft.
 *
 * Two passes of a four-neighbour dilate is enough at these sizes: the fringe is
 * a mip-averaging artifact, not a wide halo, and it only needs plausible colour
 * a texel or two out. Alpha is never touched, so alphaTest behaviour is
 * unchanged and nothing that was invisible becomes visible.
 */
function bleedEdges(ctx, size, passes = 2) {
  const image = ctx.getImageData(0, 0, size, size)
  const px = image.data

  for (let pass = 0; pass < passes; pass++) {
    // Snapshot per pass, so colour spreads one ring at a time rather than
    // racing across the tile in whatever order the loop happens to run.
    const source = px.slice()
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        if (source[i + 3] !== 0) continue

        let r = 0
        let g = 0
        let b = 0
        let found = 0
        for (const [dx, dy] of NEIGHBOURS) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          const n = (ny * size + nx) * 4
          // Either genuinely painted, or filled by an earlier pass — which is
          // how the colour walks outward one ring at a time. A filled texel is
          // still fully transparent, so alpha alone cannot tell them apart.
          const painted = source[n + 3] !== 0
          const filled = source[n] + source[n + 1] + source[n + 2] > 0
          if (!painted && !filled) continue
          r += source[n]
          g += source[n + 1]
          b += source[n + 2]
          found++
        }
        if (!found) continue

        px[i] = r / found
        px[i + 1] = g / found
        px[i + 2] = b / found
        // Alpha deliberately left at 0.
      }
    }
  }

  ctx.putImageData(image, 0, 0)
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]

/**
 * Draw the same shape nine times, once per wrap offset, so marks that cross an
 * edge reappear on the opposite side and the tile stays seamless.
 */
function drawWrapped(ctx, size, draw) {
  for (let ox = -1; ox <= 1; ox++) {
    for (let oy = -1; oy <= 1; oy++) {
      ctx.save()
      ctx.translate(ox * size, oy * size)
      draw()
      ctx.restore()
    }
  }
}

/** Seamless stylized grass. `tileWorldSize` is set by the caller via repeat. */
export function makeGrassTexture({ size = 512, anisotropy = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size)
  const rng = makeRng(SEED + 31)

  ctx.fillStyle = surface.grass.base
  ctx.fillRect(0, 0, size, size)

  // Broad soft patches: light clearings and darker damp ground. Kept faint —
  // these are the strongest cue that the tile repeats, so the large-scale
  // variation is left to the ground's vertex tint instead.
  for (let i = 0; i < 26; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = randRange(rng, size * 0.08, size * 0.24)
    const light = rng() < 0.5
    drawWrapped(ctx, size, () => {
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r)
      grad.addColorStop(0, rgba(light ? surface.grass.patchLight : surface.grass.patchDark))
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)')
      ctx.fillStyle = grad
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  // Blades.
  const blades = surface.grass.blades
  ctx.lineCap = 'round'
  for (let i = 0; i < 2600; i++) {
    const x = rng() * size
    const y = rng() * size
    const len = randRange(rng, 3, 9)
    const lean = randRange(rng, -2.5, 2.5)
    const color = blades[Math.floor(rng() * blades.length)]
    const width = randRange(rng, 1, 2.2)
    drawWrapped(ctx, size, () => {
      ctx.strokeStyle = color
      ctx.lineWidth = width
      ctx.beginPath()
      ctx.moveTo(x, y)
      ctx.quadraticCurveTo(x + lean * 0.5, y - len * 0.6, x + lean, y - len)
      ctx.stroke()
    })
  }

  // A scatter of tiny flowers for a touch of warmth.
  for (let i = 0; i < 90; i++) {
    const x = rng() * size
    const y = rng() * size
    const r = randRange(rng, 1.2, 2.4)
    const color = rgba(rng() < 0.6 ? surface.grass.flowerWarm : surface.grass.flowerPink)
    drawWrapped(ctx, size, () => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(x, y, r, 0, Math.PI * 2)
      ctx.fill()
    })
  }

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = RepeatWrapping
  texture.wrapT = RepeatWrapping
  texture.anisotropy = anisotropy
  return texture
}

/**
 * Ground-clutter cards. All three draw from the bottom edge upward, because
 * the card geometry's origin is at its base where it meets the ground.
 *
 * Strokes are kept chunky on purpose: these end up ~10-20px tall on screen and
 * are alpha-tested against a mipmapped texture, so anything hairline erodes to
 * nothing the moment it's minified.
 */
export function makeFernTexture({ size = 256, anisotropy = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size)
  const rng = makeRng(SEED + 61)
  const greens = surface.clutter.fern
  const base = size * 0.98

  ctx.lineCap = 'round'

  // Fronds fanning out from a common root, low and spreading. Kept few and
  // thin: overlap them and the alpha-tested card stops reading as a plant and
  // starts reading as a solid green plate.
  for (let i = 0; i < 6; i++) {
    const lean = randRange(rng, -1, 1)
    const tipX = size / 2 + lean * size * 0.46
    const tipY = randRange(rng, size * 0.12, size * 0.42)
    const color = greens[Math.floor(rng() * greens.length)]

    // Spine.
    ctx.strokeStyle = color
    ctx.lineWidth = randRange(rng, 2.5, 3.5)
    ctx.beginPath()
    ctx.moveTo(size / 2, base)
    ctx.quadraticCurveTo(size / 2 + lean * size * 0.16, base * 0.55, tipX, tipY)
    ctx.stroke()

    // Leaflets stepped along the spine, shrinking towards the tip.
    const leaflets = 9
    for (let j = 1; j <= leaflets; j++) {
      const t = j / (leaflets + 1)
      // Point on the quadratic spine.
      const mt = 1 - t
      const cx = size / 2 + lean * size * 0.16
      const cy = base * 0.55
      const px = mt * mt * (size / 2) + 2 * mt * t * cx + t * t * tipX
      const py = mt * mt * base + 2 * mt * t * cy + t * t * tipY
      const span = (1 - t) * size * 0.115 + 3

      ctx.lineWidth = randRange(rng, 2.5, 3.5)
      for (const dir of [-1, 1]) {
        ctx.beginPath()
        ctx.moveTo(px, py)
        ctx.lineTo(px + dir * span, py - span * 0.55)
        ctx.stroke()
      }
    }
  }

  bleedEdges(ctx, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}

export function makeGrassTuftTexture({ size = 128, anisotropy = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size)
  const rng = makeRng(SEED + 67)
  const greens = surface.clutter.tuft
  const base = size * 0.99

  ctx.lineCap = 'round'

  for (let i = 0; i < 16; i++) {
    const rootX = size / 2 + randRange(rng, -size * 0.3, size * 0.3)
    const lean = randRange(rng, -size * 0.3, size * 0.3)
    const tipY = randRange(rng, size * 0.06, size * 0.5)

    ctx.strokeStyle = greens[Math.floor(rng() * greens.length)]
    ctx.lineWidth = randRange(rng, 3.5, 6.5)
    ctx.beginPath()
    ctx.moveTo(rootX, base)
    ctx.quadraticCurveTo(rootX + lean * 0.35, (base + tipY) / 2, rootX + lean, tipY)
    ctx.stroke()
  }

  bleedEdges(ctx, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}

export function makeWildflowerTexture({ size = 128, anisotropy = 1 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size)
  const rng = makeRng(SEED + 71)
  const { flowerStem, flowerPetal, flowerCenter } = surface.clutter
  const base = size * 0.99

  ctx.lineCap = 'round'

  for (let i = 0; i < 6; i++) {
    const rootX = size / 2 + randRange(rng, -size * 0.26, size * 0.26)
    const headX = rootX + randRange(rng, -size * 0.16, size * 0.16)
    const headY = randRange(rng, size * 0.16, size * 0.46)

    ctx.strokeStyle = flowerStem
    ctx.lineWidth = randRange(rng, 3, 4.5)
    ctx.beginPath()
    ctx.moveTo(rootX, base)
    ctx.quadraticCurveTo(rootX, (base + headY) / 2, headX, headY)
    ctx.stroke()

    // Five petals around a warm centre.
    const petal = randRange(rng, 6, 8.5)
    ctx.fillStyle = flowerPetal
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2 + rng()
      ctx.beginPath()
      ctx.arc(headX + Math.cos(a) * petal, headY + Math.sin(a) * petal, petal * 0.72, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.fillStyle = flowerCenter
    ctx.beginPath()
    ctx.arc(headX, headY, petal * 0.5, 0, Math.PI * 2)
    ctx.fill()
  }

  bleedEdges(ctx, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = anisotropy
  return texture
}

/** Soft radial falloff used as a contact shadow under the player. */
export function makeBlobShadowTexture({ size = 128 } = {}) {
  const { canvas, ctx } = makeCanvas(size, size)
  const half = size / 2
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half)
  const blob = surface.blobShadow
  grad.addColorStop(0, rgba({ color: blob.color, alpha: blob.core }))
  grad.addColorStop(0.55, rgba({ color: blob.color, alpha: blob.mid }))
  grad.addColorStop(1, rgba({ color: blob.color, alpha: 0 }))
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, size, size)

  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.minFilter = LinearFilter
  texture.generateMipmaps = false
  return texture
}
