/**
 * Palettes — the app's colour as DATA.
 *
 * A palette is a small SEED (an accent and a ground tint), and ONE generator
 * turns it into every surface and text token for both light and dark. The
 * presets are named seeds and "Custom" is a seed the pilot edits, so all of
 * them go through the same rules and none can come out unreadable: the
 * generator checks the accent against the cards it sits on and moves its
 * lightness until it clears 4.5:1, and pulls any colour outside sRGB back in
 * by chroma rather than letting the browser clip it.
 *
 * What a palette does NOT touch: the status ramp (green / yellow / orange /
 * red mean met / close / caution / not met on the legal page, whatever the
 * accent) and the glass material, whose on-glass colours are derived from
 * `--card` and `--primary` in globals.css.
 *
 * Pure — no DOM. `lib/theme/apply.ts` is the browser half.
 */

export type DarkDepth = "dim" | "deep" | "black"

export interface PaletteSeed {
  /** Accent hue, 0–360 (oklch). */
  accentHue: number
  /** Accent vividness — oklch chroma, roughly 0.04 (muted) to 0.2 (vivid). */
  accentChroma: number
  /** The hue the grey surfaces lean toward. */
  groundHue: number
  /** How far they lean: 0 = neutral grey, 1 = clearly tinted. */
  groundTint: number
  /**
   * How dark the dark theme's ground is. "black" is for OLED screens and the
   * darkest cockpit — the less light the screen puts out, the less it costs a
   * dark-adapted eye.
   */
  depth: DarkDepth
}

export interface PalettePreset {
  id: string
  name: string
  description: string
  seed: PaletteSeed
}

export type PaletteId = string

export const CUSTOM_PALETTE_ID = "custom"

/**
 * The presets. Each one keeps the dark theme night-adapted the same way — a
 * low ground, text a dimmed off-white rather than #fff — and differs in
 * character: what the accent is and which way the greys lean.
 */
export const PALETTE_PRESETS: readonly PalettePreset[] = [
  {
    id: "graphite",
    name: "Graphite",
    description: "Neutral greys, a calm blue accent",
    seed: { accentHue: 252, accentChroma: 0.13, groundHue: 260, groundTint: 0.2, depth: "deep" },
  },
  {
    id: "horizon",
    name: "Horizon",
    description: "Deep navy, glass-cockpit cyan",
    seed: { accentHue: 205, accentChroma: 0.12, groundHue: 245, groundTint: 0.9, depth: "deep" },
  },
  {
    id: "night-ops",
    name: "Night Ops",
    description: "Black and red, kindest to night vision",
    seed: { accentHue: 25, accentChroma: 0.14, groundHue: 25, groundTint: 0.45, depth: "black" },
  },
  {
    id: "classic",
    name: "Classic",
    description: "Warm sand and bronze",
    seed: { accentHue: 55, accentChroma: 0.11, groundHue: 65, groundTint: 0.4, depth: "deep" },
  },
  {
    id: "evergreen",
    name: "Evergreen",
    description: "Forest dark, sea-glass teal",
    seed: { accentHue: 182, accentChroma: 0.1, groundHue: 170, groundTint: 0.55, depth: "deep" },
  },
  {
    id: "dusk",
    name: "Dusk",
    description: "Twilight violet",
    seed: { accentHue: 292, accentChroma: 0.14, groundHue: 290, groundTint: 0.6, depth: "deep" },
  },
] as const

export const DEFAULT_PALETTE_ID = "graphite"

export function presetById(id: string | undefined): PalettePreset | undefined {
  return PALETTE_PRESETS.find((p) => p.id === id)
}

/** The seed a palette choice resolves to. An unknown id falls back to the default. */
export function resolveSeed(id: string | undefined, custom: PaletteSeed | undefined): PaletteSeed {
  if (id === CUSTOM_PALETTE_ID && custom) return sanitizeSeed(custom)
  return (presetById(id) ?? presetById(DEFAULT_PALETTE_ID)!).seed
}

const DEPTH_L: Record<DarkDepth, number> = { dim: 0.17, deep: 0.13, black: 0.075 }
/** Cards on a black ground sit a little further above it, or they vanish. */
const DEPTH_CARD_STEP: Record<DarkDepth, number> = { dim: 0.04, deep: 0.04, black: 0.055 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const wrapHue = (h: number) => ((h % 360) + 360) % 360

/** Bring a stored or hand-edited seed back inside the ranges the generator is built for. */
export function sanitizeSeed(seed: Partial<PaletteSeed>): PaletteSeed {
  const fallback = presetById(DEFAULT_PALETTE_ID)!.seed
  const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : d)
  return {
    accentHue: wrapHue(num(seed.accentHue, fallback.accentHue)),
    accentChroma: clamp(num(seed.accentChroma, fallback.accentChroma), 0.02, 0.22),
    groundHue: wrapHue(num(seed.groundHue, fallback.groundHue)),
    groundTint: clamp(num(seed.groundTint, fallback.groundTint), 0, 1),
    depth: seed.depth === "dim" || seed.depth === "black" || seed.depth === "deep" ? seed.depth : fallback.depth,
  }
}

// ─── Colour maths (OKLCH → sRGB) ───────────────────────────────────────

export interface Oklch {
  l: number
  c: number
  h: number
}

/** Linear sRGB, unclamped — values outside [0, 1] are out of gamut. */
function oklchToLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ]
}

const IN_GAMUT_EPS = 0.0005
function inGamut(color: Oklch): boolean {
  return oklchToLinearRgb(color).every((v) => v >= -IN_GAMUT_EPS && v <= 1 + IN_GAMUT_EPS)
}

/** Reduce chroma until the colour is displayable — keeps hue and lightness, unlike a channel clip. */
export function toGamut(color: Oklch): Oklch {
  if (inGamut(color)) return color
  let lo = 0
  let hi = color.c
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut({ ...color, c: mid })) lo = mid
    else hi = mid
  }
  return { ...color, c: lo }
}

/** WCAG relative luminance. */
export function luminance(color: Oklch): number {
  const [r, g, b] = oklchToLinearRgb(color).map((v) => clamp(v, 0, 1))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: Oklch, b: Oklch): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function toHex(color: Oklch): string {
  const enc = (v: number) => {
    const x = clamp(v, 0, 1)
    const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055
    return Math.round(s * 255)
      .toString(16)
      .padStart(2, "0")
  }
  return "#" + oklchToLinearRgb(color).map(enc).join("")
}

const fmt = (n: number, digits: number) => Number(n.toFixed(digits)).toString()
export function toCss({ l, c, h }: Oklch): string {
  return `oklch(${fmt(l, 3)} ${fmt(c, 3)} ${fmt(h, 1)})`
}

/**
 * Move a colour's lightness, in `step`s toward `direction`, until it has at
 * least `ratio` against every background given. Chroma is re-fitted to the
 * gamut at each lightness, so the hue survives.
 */
function ensureContrast(color: Oklch, against: Oklch[], ratio: number, direction: 1 | -1): Oklch {
  let current = toGamut(color)
  for (let i = 0; i < 60; i++) {
    if (against.every((bg) => contrast(current, bg) >= ratio)) return current
    const l = clamp(current.l + direction * 0.01, 0, 1)
    if (l === current.l) return current
    current = toGamut({ ...color, l })
  }
  return current
}

// ─── The generator ─────────────────────────────────────────────────────

export type ThemeMode = "light" | "dark"

/** Every CSS custom property a palette sets, light or dark. */
export const PALETTE_TOKENS = [
  "background",
  "foreground",
  "card",
  "card-foreground",
  "popover",
  "popover-foreground",
  "primary",
  "primary-foreground",
  "ring",
  "secondary",
  "secondary-foreground",
  "muted",
  "muted-foreground",
  "accent",
  "accent-foreground",
  "border",
  "input",
  "chart-1",
  "sidebar",
  "sidebar-foreground",
  "sidebar-primary",
  "sidebar-primary-foreground",
  "sidebar-accent",
  "sidebar-accent-foreground",
  "sidebar-border",
  "sidebar-ring",
] as const

export type PaletteToken = (typeof PALETTE_TOKENS)[number]

export interface GeneratedPalette {
  tokens: Record<PaletteToken, string>
  /** The ground as #rrggbb, for the browser/OS chrome (`theme-color`). */
  groundHex: string
  /** The resolved colours, for previews and tests. */
  colors: { background: Oklch; card: Oklch; foreground: Oklch; muted: Oklch; primary: Oklch; primaryForeground: Oklch }
}

export function generatePalette(input: PaletteSeed, mode: ThemeMode): GeneratedPalette {
  const seed = sanitizeSeed(input)
  const gh = seed.groundHue
  const dark = mode === "dark"

  // The ground leans toward its hue by up to 0.03 chroma in the dark (where a
  // tint reads as character) and a third of that in the light (where the same
  // chroma reads as a coloured page).
  const groundC = seed.groundTint * (dark ? 0.03 : 0.012)
  const surface = (l: number, cScale = 1): Oklch => toGamut({ l, c: groundC * cScale, h: gh })
  const ink = (l: number): Oklch => toGamut({ l, c: Math.min(groundC * 0.5, 0.014), h: gh })

  let background: Oklch, card: Oklch, popover: Oklch, raised: Oklch, border: Oklch, sidebar: Oklch
  let foreground: Oklch, secondaryForeground: Oklch, muted: Oklch
  if (dark) {
    const base = DEPTH_L[seed.depth]
    background = surface(base)
    card = surface(base + DEPTH_CARD_STEP[seed.depth], 1.1)
    popover = surface(card.l + 0.01, 1.1)
    raised = surface(base + 0.08, 1.1)
    border = surface(base + 0.125, 1.1)
    sidebar = surface(base + 0.02)
    // Dimmed off-white: a large field of #fff is what costs dark adaptation.
    foreground = ink(0.9)
    secondaryForeground = ink(0.82)
    muted = ensureContrast(ink(0.66), [card, raised], 4.5, 1)
  } else {
    background = surface(0.972)
    card = surface(0.995, 0.4)
    popover = card
    raised = surface(0.945)
    border = surface(0.9)
    sidebar = surface(0.982)
    foreground = ink(0.22)
    secondaryForeground = ink(0.32)
    muted = ensureContrast(ink(0.47), [card, raised, background], 4.5, -1)
  }

  // The accent carries text (links, the scheduled-flight card, "Undo"), so it
  // has to read as text on every surface it lands on.
  const primary = ensureContrast(
    { l: dark ? 0.74 : 0.52, c: seed.accentChroma, h: seed.accentHue },
    [card, background, popover],
    4.5,
    dark ? 1 : -1
  )
  // Text ON the accent: whichever of a near-ground dark and a near-white
  // reads better.
  const onDark = toGamut({ l: 0.16, c: Math.min(seed.accentChroma, 0.04), h: seed.accentHue })
  const onLight = toGamut({ l: 0.985, c: 0.004, h: seed.accentHue })
  const primaryForeground = contrast(primary, onDark) >= contrast(primary, onLight) ? onDark : onLight

  const css = toCss
  const tokens: Record<PaletteToken, string> = {
    background: css(background),
    foreground: css(foreground),
    card: css(card),
    "card-foreground": css(foreground),
    popover: css(popover),
    "popover-foreground": css(foreground),
    primary: css(primary),
    "primary-foreground": css(primaryForeground),
    ring: css(primary),
    secondary: css(raised),
    "secondary-foreground": css(secondaryForeground),
    muted: css(raised),
    "muted-foreground": css(muted),
    // A hover / highlight fill (shadcn's menus), not a second accent colour.
    accent: css(raised),
    "accent-foreground": css(dark ? foreground : secondaryForeground),
    border: css(border),
    input: css(raised),
    "chart-1": css(primary),
    sidebar: css(sidebar),
    "sidebar-foreground": css(foreground),
    "sidebar-primary": css(primary),
    "sidebar-primary-foreground": css(primaryForeground),
    "sidebar-accent": css(raised),
    "sidebar-accent-foreground": css(foreground),
    "sidebar-border": css(border),
    "sidebar-ring": css(primary),
  }

  return {
    tokens,
    groundHex: toHex(background),
    colors: { background, card, foreground, muted, primary, primaryForeground },
  }
}

function block(selector: string, tokens: Record<string, string>): string {
  return `${selector}{${Object.entries(tokens)
    .map(([k, v]) => `--${k}:${v}`)
    .join(";")}}`
}

/**
 * The stylesheet for a palette. `html:root` / `html.dark` out-rank the
 * `:root` / `.dark` blocks in globals.css on SPECIFICITY, so it wins wherever
 * the `<style>` lands in the document.
 */
export function paletteStylesheet(seed: PaletteSeed): string {
  return (
    block("html:root", generatePalette(seed, "light").tokens) +
    block("html.dark", generatePalette(seed, "dark").tokens)
  )
}

/** The grounds as hex, for `<meta name="theme-color">` in each mode. */
export function paletteGroundHex(seed: PaletteSeed): Record<ThemeMode, string> {
  return { light: generatePalette(seed, "light").groundHex, dark: generatePalette(seed, "dark").groundHex }
}
