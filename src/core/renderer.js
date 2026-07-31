import {
  ACESFilmicToneMapping,
  AgXToneMapping,
  CineonToneMapping,
  LinearToneMapping,
  NeutralToneMapping,
  NoToneMapping,
  PCFShadowMap,
  ReinhardToneMapping,
  WebGLRenderer,
} from 'three'
import { light } from '../palette.js'

/**
 * Owns the WebGL context and the display surface. Nothing in here knows what
 * is being drawn.
 */

/**
 * Named so the palette can stay a pure data module — it holds the string, this
 * maps it to the constant.
 *
 * A note on which to pick: ACES is a film emulation. It deliberately rolls
 * saturated colour off towards neutral as it brightens, which is right for
 * photographic content and wrong for flat-shaded stylized art, where the
 * palette *is* the look. It's what was desaturating the warm key into olive.
 * 'linear' applies exposure and clamps, nothing else.
 *
 * 'none' skips the stage altogether — which also means exposure stops working,
 * since the exposure multiply lives inside the tone-mapping function.
 */
export const TONE_MAPPINGS = {
  none: NoToneMapping,
  linear: LinearToneMapping,
  reinhard: ReinhardToneMapping,
  cineon: CineonToneMapping,
  aces: ACESFilmicToneMapping,
  agx: AgXToneMapping,
  neutral: NeutralToneMapping,
}

export function createRenderer(container) {
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: 'high-performance',
  })

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(container.clientWidth, container.clientHeight)

  renderer.shadowMap.enabled = true
  // Soft PCF. In r185 PCFSoftShadowMap is deprecated and falls back to this
  // path anyway — and only this path samples a Vogel disk scaled by
  // light.shadow.radius, so PCFShadowMap is what actually gives soft edges.
  renderer.shadowMap.type = PCFShadowMap

  applyToneMapping(renderer)

  container.appendChild(renderer.domElement)
  return renderer
}

/** Re-read the palette's tone mapping and exposure onto a live renderer. */
export function applyToneMapping(renderer) {
  renderer.toneMapping = TONE_MAPPINGS[light.toneMapping] ?? LinearToneMapping
  renderer.toneMappingExposure = light.exposure
}

/** Resize to fill the container. Returns the new aspect ratio. */
export function resizeRenderer(renderer, container) {
  const width = container.clientWidth
  const height = container.clientHeight
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  // Let setSize update the inline style too — it wrote px dimensions on
  // creation, and those would otherwise win over the stylesheet and leave the
  // canvas stretched after a resize.
  renderer.setSize(width, height)
  return width / Math.max(height, 1)
}
