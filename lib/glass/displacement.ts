/**
 * Liquid-glass refraction maps — adapted from winaviation/liquid-web
 * (MIT, itself based on kube's "Liquid Glass in CSS/SVG" article).
 *
 * The pipeline: a 1D Snell's-law refraction profile is computed across the
 * glass BEZEL (the rim; the interior refracts nothing), expanded into a 2D
 * displacement map for feDisplacementMap (R = x-shift, G = y-shift, 128 =
 * neutral), plus a rim specular map whose brightness is the dot product of
 * the local edge normal against a light direction — which is why real liquid
 * glass shows symmetric double-lobe glints rather than a lit top edge.
 *
 * Chromium-only consumer: `backdrop-filter: url(#…)` with SVG filters is not
 * supported by WebKit/Gecko — Safari keeps the layered-ring material (see
 * `supportsSvgBackdropFilter`).
 */

/** Convex squircle cross-section — the profile Apple-style glass uses. */
function convexSquircle(x: number): number {
  return Math.pow(1 - Math.pow(1 - x, 4), 1 / 4)
}

const REFRACTIVE_INDEX = 1.5
const PROFILE_SAMPLES = 128

/**
 * 1D lateral displacement along the bezel cross-section via Snell's law:
 * refract the incoming ray at the surface normal, then project it through the
 * remaining glass thickness to find how far the backdrop appears shifted.
 */
function refractionProfile1D(glassThickness: number, bezelWidth: number): number[] {
  const eta = 1 / REFRACTIVE_INDEX
  const result: number[] = []
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const x = i / PROFILE_SAMPLES
    const y = convexSquircle(x)
    const dx = x < 1 ? 0.0001 : -0.0001
    const y2 = convexSquircle(Math.max(0, Math.min(1, x + dx)))
    const derivative = (y2 - y) / dx
    const magnitude = Math.sqrt(derivative * derivative + 1)
    const nX = -derivative / magnitude
    const nY = -1 / magnitude
    const dot = nY
    const k = 1 - eta * eta * (1 - dot * dot)
    if (k < 0) {
      result.push(0)
      continue
    }
    const kSqrt = Math.sqrt(k)
    const rX = -(eta * dot + kSqrt) * nX
    const rY = eta - (eta * dot + kSqrt) * nY
    const remainingHeight = y * bezelWidth + glassThickness
    result.push(rX * (remainingHeight / rY))
  }
  return result
}

export interface GlassMaps {
  displacementUrl: string
  specularUrl: string
  /** feDisplacementMap scale = maxDisplacement × refractionScale */
  displacementScale: number
  width: number
  height: number
}

export interface GlassMapOptions {
  width: number
  height: number
  radius: number
  /** Rim thickness in px where refraction happens (default 12). */
  bezelWidth?: number
  /** Glass depth in px — higher bends more (default 60). */
  glassThickness?: number
  /** Refraction intensity multiplier (default 1.2). */
  refractionScale?: number
  /** Light direction in radians, y-up convention: 0 = +x, CCW (default 135° —
   *  upper-left, so the |dot| lobes land top-left/bottom-right like Apple's
   *  Control Center rims). */
  specularAngle?: number
  /** Supersample factor for the raster — defaults to the device pixel ratio
   *  (capped at 3). The specular is a sub-2px rim; rendering the map at CSS
   *  resolution and letting the SVG filter upscale it ~3× on a phone produces
   *  visible jaggies, so the raster is built at physical resolution instead. */
  pixelRatio?: number
}

/**
 * Build the displacement + specular maps for one element size. Cheap for
 * control-sized elements (a 56×56 button is ~12k pixels); call debounced on
 * resize for larger surfaces (the nav sidebar).
 */
export function generateGlassMaps(opts: GlassMapOptions): GlassMaps {
  const {
    width,
    height,
    radius: rawRadius,
    bezelWidth = 12,
    glassThickness = 60,
    refractionScale = 1.2,
    specularAngle = (3 * Math.PI) / 4,
    pixelRatio,
  } = opts
  // CSS-px geometry — the refraction magnitude (and displacementScale) are
  // resolution-independent, so the physics profile stays in CSS units.
  const cssW = Math.max(2, Math.round(width))
  const cssH = Math.max(2, Math.round(height))
  const cssRadius = Math.min(rawRadius, cssW / 2, cssH / 2)

  const profile = refractionProfile1D(glassThickness, bezelWidth)
  const maxDisplacement = Math.max(...profile.map(Math.abs), 1)

  // Supersample the raster to the device pixel ratio so the SVG filter samples
  // a physical-resolution map instead of upscaling a CSS-res one (→ jaggies on
  // the thin specular rim). The feImage still maps it to the CSS-px element.
  const dpr =
    pixelRatio ??
    Math.min(3, Math.max(1, Math.round((typeof window !== "undefined" && window.devicePixelRatio) || 1)))
  const w = Math.max(2, Math.round(cssW * dpr))
  const h = Math.max(2, Math.round(cssH * dpr))
  const radius = cssRadius * dpr
  const bezel = bezelWidth * dpr
  const feather = dpr // ≈1 CSS px of outer antialias feather
  const specThickness = 1.5 * dpr

  const radiusSquared = radius * radius
  const radiusPlusFeatherSquared = (radius + feather) * (radius + feather)
  const radiusMinusBezelSquared = Math.max(0, (radius - bezel) * (radius - bezel))
  const wBetween = w - radius * 2
  const hBetween = h - radius * 2

  // Displacement map — neutral gray interior, refraction encoded in the bezel.
  const disp = new ImageData(w, h)
  for (let i = 0; i < disp.data.length; i += 4) {
    disp.data[i] = 128
    disp.data[i + 1] = 128
    disp.data[i + 2] = 0
    disp.data[i + 3] = 255
  }

  // Specular map — thin edge band, brightness ∝ |normal · light|².
  const spec = new ImageData(w, h)
  const specVec = [Math.cos(specularAngle), Math.sin(specularAngle)]
  const radiusMinusSpecSquared = Math.max(0, (radius - specThickness) * (radius - specThickness))

  for (let y1 = 0; y1 < h; y1++) {
    for (let x1 = 0; x1 < w; x1++) {
      const idx = (y1 * w + x1) * 4
      // Coordinates relative to the nearest corner circle; straight edges → 0.
      const x = x1 < radius ? x1 - radius : x1 >= w - radius ? x1 - radius - wBetween : 0
      const y = y1 < radius ? y1 - radius : y1 >= h - radius ? y1 - radius - hBetween : 0
      const d2 = x * x + y * y
      const d = Math.sqrt(d2)
      const edgeFeather =
        d2 < radiusSquared
          ? 1
          : 1 - (d - radius) / (Math.sqrt(radiusPlusFeatherSquared) - radius)

      // Bezel refraction
      if (d2 <= radiusPlusFeatherSquared && d2 >= radiusMinusBezelSquared) {
        const cos = d > 0 ? x / d : 0
        const sin = d > 0 ? y / d : 0
        const bezelRatio = Math.max(0, Math.min(1, (radius - d) / bezel))
        const bezelIndex = Math.min(
          Math.max(0, Math.floor(bezelRatio * profile.length)),
          profile.length - 1,
        )
        const distance = profile[bezelIndex] || 0
        const dX = (-cos * distance) / maxDisplacement
        const dY = (-sin * distance) / maxDisplacement
        disp.data[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * edgeFeather))
        disp.data[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * edgeFeather))
        disp.data[idx + 3] = 255
      }

      // Specular rim
      if (d2 <= radiusPlusFeatherSquared && d2 >= radiusMinusSpecSquared) {
        const cos = d > 0 ? x / d : 0
        const sin = d > 0 ? -y / d : 0
        const dot = Math.abs(cos * specVec[0] + sin * specVec[1])
        const edgeRatio = Math.max(0, Math.min(1, (radius - d) / specThickness))
        const falloff = Math.sqrt(1 - (1 - edgeRatio) * (1 - edgeRatio))
        const coefficient = dot * falloff
        const color = Math.min(255, 255 * coefficient)
        spec.data[idx] = color
        spec.data[idx + 1] = color
        spec.data[idx + 2] = color
        spec.data[idx + 3] = Math.min(255, color * coefficient * edgeFeather)
      }
    }
  }

  return {
    displacementUrl: imageDataToDataURL(disp),
    specularUrl: imageDataToDataURL(spec),
    displacementScale: maxDisplacement * refractionScale,
    // CSS-px size — the feImage maps the hi-res raster back down to the element.
    width: cssW,
    height: cssH,
  }
}

function imageDataToDataURL(imageData: ImageData): string {
  const canvas = document.createElement("canvas")
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  ctx.putImageData(imageData, 0, 0)
  return canvas.toDataURL()
}

let cachedSupport: boolean | null = null

/**
 * True when the browser can apply an SVG filter through backdrop-filter —
 * Blink only. WebKit (the primary target, iPad Safari) parses but ignores
 * url() backdrop-filters, so the check requires both the parse AND Chromium.
 */
export function supportsSvgBackdropFilter(): boolean {
  if (cachedSupport !== null) return cachedSupport
  if (typeof window === "undefined") return false
  const isChromium = "chrome" in window
  const testEl = document.createElement("div")
  testEl.style.backdropFilter = "url(#test)"
  cachedSupport = isChromium && testEl.style.backdropFilter.includes("url")
  return cachedSupport
}
