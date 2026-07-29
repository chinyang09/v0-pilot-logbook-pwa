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

export interface GlassRasters {
  /** RGBA displacement raster, `w × h` physical px. */
  disp: Uint8ClampedArray<ArrayBuffer>
  /** RGBA specular raster, same dimensions. */
  spec: Uint8ClampedArray<ArrayBuffer>
  /** Raster (physical) dimensions. */
  w: number
  h: number
  /** Element (CSS px) dimensions the raster maps back onto. */
  cssW: number
  cssH: number
  displacementScale: number
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
  /**
   * Walk every pixel instead of just the rim. The rim is the only place either
   * map is non-neutral, so the fast path skips the interior — this is the
   * reference implementation that pins it (see `displacement.test.ts`), not a
   * runtime option.
   */
  scanEveryPixel?: boolean
}

/**
 * Build the raw displacement + specular rasters for one element size.
 *
 * Pure typed-array work — no canvas, no DOM — so it is testable and so the
 * expensive part can be reasoned about on its own. `generateGlassMaps` wraps
 * this with the canvas encode.
 */
export function buildGlassRasters(opts: GlassMapOptions): GlassRasters {
  const {
    width,
    height,
    radius: rawRadius,
    bezelWidth = 12,
    glassThickness = 60,
    refractionScale = 1.2,
    specularAngle = (3 * Math.PI) / 4,
    pixelRatio,
    scanEveryPixel = false,
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
  // Cap total raster pixels so a large surface (the sidebar) doesn't allocate a
  // multi-megapixel map or hitch when it regenerates at morph-settle — small
  // controls (pills, buttons) stay at full DPR for a crisp rim.
  const BUDGET = 1_200_000
  const area = cssW * cssH
  const scale = area * dpr * dpr > BUDGET ? Math.max(1, Math.sqrt(BUDGET / area)) : dpr
  const w = Math.max(2, Math.round(cssW * scale))
  const h = Math.max(2, Math.round(cssH * scale))
  const radius = cssRadius * scale
  const bezel = bezelWidth * scale
  const feather = scale // ≈1 CSS px of outer antialias feather
  const specThickness = 1.5 * scale

  const radiusSquared = radius * radius
  const radiusPlusFeatherSquared = (radius + feather) * (radius + feather)
  const radiusMinusBezelSquared = Math.max(0, (radius - bezel) * (radius - bezel))
  const wBetween = w - radius * 2
  const hBetween = h - radius * 2

  // Displacement map — neutral gray interior, refraction encoded in the bezel.
  // Seeded one pixel through the byte view then replicated 32 bits at a time,
  // which is endian-safe and native-speed; the old per-byte loop over a
  // multi-megapixel sidebar raster was pure overhead.
  const disp = new Uint8ClampedArray(w * h * 4)
  disp[0] = 128
  disp[1] = 128
  disp[2] = 0
  disp[3] = 255
  const disp32 = new Uint32Array(disp.buffer)
  disp32.fill(disp32[0])

  // Specular map — thin edge band, brightness ∝ |normal · light|².
  const spec = new Uint8ClampedArray(w * h * 4)
  const specVec = [Math.cos(specularAngle), Math.sin(specularAngle)]
  const radiusMinusSpecSquared = Math.max(0, (radius - specThickness) * (radius - specThickness))

  /**
   * Both maps are neutral everywhere except the rim, so the scan is restricted
   * to the bands that can reach it. Walking all of a tall surface (the nav
   * sidebar is ~1.2M raster px) is what made the regenerate hitch for a second
   * on Android.
   *
   * A pixel is non-neutral only where `radius - band <= d <= radius + feather`,
   * `d` measured from the nearest corner circle. That bounds the columns:
   *   - within `band` px of the top/bottom edge, `d` can reach the rim at any
   *     column (the horizontal bezel) → scan the whole row;
   *   - elsewhere inside the corner rows, only the corner circles reach it →
   *     `radius` px in from each side;
   *   - in the straight middle, only the vertical bezel → `band` px from each
   *     side.
   * Interior pixels resolve to d = 0, which writes exactly the neutral values
   * already there, so skipping them changes no output — `displacement.test.ts`
   * asserts that byte for byte against `scanEveryPixel`.
   */
  const band = Math.max(bezel, specThickness)
  const edgeCols = Math.min(w, Math.ceil(band) + 2)
  const cornerCols = Math.min(w, Math.ceil(radius) + 2)
  const edgeRows = Math.ceil(band) + 2

  for (let y1 = 0; y1 < h; y1++) {
    const y = y1 < radius ? y1 - radius : y1 >= h - radius ? y1 - radius - hBetween : 0

    let cols: number
    if (scanEveryPixel || y1 < edgeRows || y1 >= h - edgeRows) cols = w
    else if (y1 < radius || y1 >= h - radius) cols = cornerCols
    else cols = edgeCols
    // Two runs (left band, right band) unless they meet, in which case one.
    const split = cols * 2 < w
    const runs = split ? [0, cols, w - cols, w] : [0, w]

    for (let r = 0; r < runs.length; r += 2) {
      for (let x1 = runs[r]; x1 < runs[r + 1]; x1++) {
        const idx = (y1 * w + x1) * 4
        // Coordinates relative to the nearest corner circle; straight edges → 0.
        const x = x1 < radius ? x1 - radius : x1 >= w - radius ? x1 - radius - wBetween : 0
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
          disp[idx] = Math.max(0, Math.min(255, 128 + dX * 127 * edgeFeather))
          disp[idx + 1] = Math.max(0, Math.min(255, 128 + dY * 127 * edgeFeather))
          disp[idx + 3] = 255
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
          spec[idx] = color
          spec[idx + 1] = color
          spec[idx + 2] = color
          spec[idx + 3] = Math.min(255, color * coefficient * edgeFeather)
        }
      }
    }
  }

  return {
    disp,
    spec,
    w,
    h,
    // CSS-px size — the feImage maps the hi-res raster back down to the element.
    cssW,
    cssH,
    displacementScale: maxDisplacement * refractionScale,
  }
}

/**
 * Cache of encoded maps, keyed by the geometry that produced them.
 *
 * The nav sidebar morphs open and closed constantly and lands on the same size
 * every time; without this every open paid the full raster + PNG encode again,
 * on the main thread, right at the end of the morph. Small LRU — the app only
 * ever asks for a handful of distinct sizes (pill, sidebar, a few buttons), and
 * an entry is a pair of data URLs.
 */
const MAP_CACHE_LIMIT = 16
const mapCache = new Map<string, GlassMaps>()

/**
 * Build the displacement + specular maps for one element size, memoised.
 *
 * Cheap for control-sized elements (a 56×56 button is ~12k pixels); still worth
 * calling debounced on resize for larger surfaces (the nav sidebar), since a
 * size seen for the first time pays the raster + encode.
 */
export function generateGlassMaps(opts: GlassMapOptions): GlassMaps {
  const cssW = Math.max(2, Math.round(opts.width))
  const cssH = Math.max(2, Math.round(opts.height))
  const key = [
    cssW,
    cssH,
    Math.round(opts.radius),
    opts.bezelWidth ?? 12,
    opts.glassThickness ?? 60,
    opts.refractionScale ?? 1.2,
    opts.specularAngle ?? (3 * Math.PI) / 4,
    opts.pixelRatio ?? "auto",
  ].join("|")

  const hit = mapCache.get(key)
  if (hit) {
    // Refresh recency.
    mapCache.delete(key)
    mapCache.set(key, hit)
    return hit
  }

  const r = buildGlassRasters(opts)
  const maps: GlassMaps = {
    displacementUrl: rasterToDataURL(r.disp, r.w, r.h),
    specularUrl: rasterToDataURL(r.spec, r.w, r.h),
    displacementScale: r.displacementScale,
    width: r.cssW,
    height: r.cssH,
  }

  mapCache.set(key, maps)
  if (mapCache.size > MAP_CACHE_LIMIT) {
    const oldest = mapCache.keys().next().value
    if (oldest !== undefined) mapCache.delete(oldest)
  }
  return maps
}

function rasterToDataURL(raster: Uint8ClampedArray<ArrayBuffer>, w: number, h: number): string {
  const canvas = document.createElement("canvas")
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext("2d")
  if (!ctx) return ""
  ctx.putImageData(new ImageData(raster, w, h), 0, 0)
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
