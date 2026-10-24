import { describe, expect, it } from "vitest"
import { DEFAULT_GROUND, PALETTE_BOOT_SCRIPT, PALETTE_STORAGE_KEY } from "@/lib/theme/apply"
import { DEFAULT_PALETTE_ID, paletteGroundHex, resolveSeed } from "@/lib/theme/palette"

/**
 * The boot script runs in `<head>` before anything else, so it is exercised
 * here against a hand-built stand-in for the handful of DOM calls it makes.
 */
function boot(opts: { storage?: Record<string, string>; osDark?: boolean } = {}) {
  const storage = opts.storage ?? {}
  const head: { children: Record<string, unknown>[] } = { children: [] }
  const root = { className: "" }
  let observer: (() => void) | null = null
  const win: Record<string, unknown> = {
    matchMedia: () => ({ matches: !!opts.osDark }),
  }
  const doc = {
    head: { appendChild: (el: Record<string, unknown>) => head.children.push(el) },
    documentElement: root,
    createElement: (tag: string) => ({ tag }),
  }
  const localStorage = { getItem: (k: string) => storage[k] ?? null }
  class MutationObserver {
    constructor(cb: () => void) {
      observer = cb
    }
    observe() {}
  }
  new Function("document", "window", "localStorage", "MutationObserver", PALETTE_BOOT_SCRIPT)(
    doc,
    win,
    localStorage,
    MutationObserver
  )
  const meta = () => head.children.find((c) => c.name === "theme-color") as { content?: string }
  const setClass = (c: string) => {
    root.className = c
    observer?.()
  }
  return { meta, setClass, win }
}

describe("PALETTE_BOOT_SCRIPT — the status bar colour", () => {
  it("defaults to the default palette's grounds", () => {
    expect(DEFAULT_GROUND).toEqual(paletteGroundHex(resolveSeed(DEFAULT_PALETTE_ID, undefined)))
  })

  it("reads the stored theme before next-themes has set a class", () => {
    expect(boot().meta().content).toBe(DEFAULT_GROUND.dark) // next-themes' default is dark
    expect(boot({ storage: { theme: "light" } }).meta().content).toBe(DEFAULT_GROUND.light)
    expect(boot({ storage: { theme: "system" }, osDark: false }).meta().content).toBe(DEFAULT_GROUND.light)
  })

  it("follows the class on screen, whatever the OS prefers", () => {
    const b = boot({ osDark: true })
    b.setClass("light")
    expect(b.meta().content).toBe(DEFAULT_GROUND.light)
    b.setClass("dark")
    expect(b.meta().content).toBe(DEFAULT_GROUND.dark)
  })

  it("uses the stored palette's grounds", () => {
    const ground = { light: "#ffffff", dark: "#000000" }
    const b = boot({ storage: { [PALETTE_STORAGE_KEY]: JSON.stringify({ css: "", ground }), theme: "light" } })
    expect(b.meta().content).toBe("#ffffff")
    b.setClass("dark")
    expect(b.meta().content).toBe("#000000")
  })

  it("exposes the sync for a new palette", () => {
    const b = boot()
    b.win.__oooiGround = { light: "#111111", dark: "#222222" }
    ;(b.win.__oooiSyncThemeColor as () => void)()
    expect(b.meta().content).toBe("#222222")
  })
})
