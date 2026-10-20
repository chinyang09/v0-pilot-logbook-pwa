import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  CUSTOM_PALETTE_ID,
  DEFAULT_PALETTE_ID,
  PALETTE_PRESETS,
  PALETTE_TOKENS,
  contrast,
  generatePalette,
  paletteStylesheet,
  presetById,
  resolveSeed,
  sanitizeSeed,
  type PaletteSeed,
  type ThemeMode,
} from "@/lib/theme/palette"

const MODES: ThemeMode[] = ["light", "dark"]

/** The guarantees every palette has to meet, preset or custom. */
function expectReadable(seed: PaletteSeed, mode: ThemeMode) {
  const { colors } = generatePalette(seed, mode)
  const ctx = `${JSON.stringify(seed)} ${mode}`
  expect(contrast(colors.foreground, colors.background), `fg/bg ${ctx}`).toBeGreaterThanOrEqual(7)
  expect(contrast(colors.foreground, colors.card), `fg/card ${ctx}`).toBeGreaterThanOrEqual(7)
  expect(contrast(colors.muted, colors.card), `muted/card ${ctx}`).toBeGreaterThanOrEqual(4.5)
  expect(contrast(colors.primary, colors.card), `primary/card ${ctx}`).toBeGreaterThanOrEqual(4.5)
  expect(contrast(colors.primary, colors.background), `primary/bg ${ctx}`).toBeGreaterThanOrEqual(4.5)
  expect(contrast(colors.primaryForeground, colors.primary), `on-primary ${ctx}`).toBeGreaterThanOrEqual(4.5)
}

describe("palette presets", () => {
  it("have unique ids, none of them the custom id", () => {
    const ids = PALETTE_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).not.toContain(CUSTOM_PALETTE_ID)
    expect(presetById(DEFAULT_PALETTE_ID)).toBeDefined()
  })

  for (const preset of PALETTE_PRESETS) {
    for (const mode of MODES) {
      it(`${preset.name} ${mode} is readable`, () => expectReadable(preset.seed, mode))
    }
  }

  it("keep the dark theme night-adapted: a low ground and no pure white text", () => {
    for (const preset of PALETTE_PRESETS) {
      const { colors } = generatePalette(preset.seed, "dark")
      expect(colors.background.l).toBeLessThanOrEqual(0.17)
      expect(colors.foreground.l).toBeLessThan(0.95)
    }
  })
})

describe("custom palettes", () => {
  it("stay readable for ANY seed a pilot can dial in", () => {
    // Deterministic sweep: every accent hue at the extremes of vividness,
    // against grounds of every hue at full tint, at every depth.
    for (let accentHue = 0; accentHue < 360; accentHue += 15) {
      for (const accentChroma of [0.02, 0.12, 0.22]) {
        for (const depth of ["dim", "deep", "black"] as const) {
          const seed: PaletteSeed = { accentHue, accentChroma, groundHue: (accentHue * 7) % 360, groundTint: 1, depth }
          for (const mode of MODES) expectReadable(seed, mode)
        }
      }
    }
  })

  it("emit every token, each a colour the browser can parse", () => {
    const seed: PaletteSeed = { accentHue: 140, accentChroma: 0.22, groundHue: 10, groundTint: 1, depth: "black" }
    for (const mode of MODES) {
      const { tokens } = generatePalette(seed, mode)
      for (const token of PALETTE_TOKENS) expect(tokens[token]).toMatch(/^oklch\([\d.]+ [\d.]+ [\d.]+\)$/)
    }
  })
})

describe("sanitizeSeed / resolveSeed", () => {
  it("brings an out-of-range or partial seed back inside the generator's ranges", () => {
    const s = sanitizeSeed({ accentHue: -30, accentChroma: 9, groundTint: -1, depth: "nope" as never })
    expect(s.accentHue).toBe(330)
    expect(s.accentChroma).toBe(0.22)
    expect(s.groundTint).toBe(0)
    expect(["dim", "deep", "black"]).toContain(s.depth)
  })

  it("falls back to the default for an unknown id, and to it for custom with no seed", () => {
    const def = presetById(DEFAULT_PALETTE_ID)!.seed
    expect(resolveSeed("gone-preset", undefined)).toEqual(def)
    expect(resolveSeed(CUSTOM_PALETTE_ID, undefined)).toEqual(def)
    const custom: PaletteSeed = { accentHue: 100, accentChroma: 0.1, groundHue: 100, groundTint: 0.5, depth: "dim" }
    expect(resolveSeed(CUSTOM_PALETTE_ID, custom)).toEqual(custom)
  })
})

describe("paletteStylesheet", () => {
  it("out-ranks globals.css on specificity, not on order", () => {
    const css = paletteStylesheet(presetById("horizon")!.seed)
    expect(css.startsWith("html:root{")).toBe(true)
    expect(css).toContain("}html.dark{")
  })
})

describe("globals.css", () => {
  // Before the stored palette is applied — first paint, or no palette chosen
  // yet — the app renders on globals.css's own tokens. They must BE the
  // default palette, or the first frame is a different colour from the second.
  const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8")
  const blockOf = (marker: string) => {
    const start = css.indexOf(marker)
    expect(start, marker).toBeGreaterThan(-1)
    return css.slice(start, css.indexOf("}", start))
  }
  const read = (block: string, token: string) => block.match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1].trim()

  for (const [mode, marker] of [
    ["light", "/* palette:light */"],
    ["dark", "/* palette:dark */"],
  ] as const) {
    it(`carries the default palette's ${mode} tokens`, () => {
      const block = blockOf(marker)
      const { tokens } = generatePalette(presetById(DEFAULT_PALETTE_ID)!.seed, mode)
      for (const token of PALETTE_TOKENS) expect(read(block, token), token).toBe(tokens[token])
    })
  }
})
