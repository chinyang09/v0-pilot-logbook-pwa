/**
 * Applying a palette in the browser — the DOM half of `palette.ts`.
 *
 * The generated stylesheet goes into ONE `<style id="oooi-palette">` and into
 * localStorage, so the next launch can put it back before the first paint
 * (`PALETTE_BOOT_SCRIPT`, inlined into the root layout's `<head>`). Everything
 * is local: no request is made to pick, edit or restore a palette, which is
 * what keeps it working offline and in an installed PWA cold-started with no
 * network.
 *
 * localStorage holds the RESULT (the CSS text and the two ground colours), not
 * the seed, so the boot script stays a few lines with no generator in it. The
 * preference itself — which palette, and the custom seed — lives in the
 * user's preferences row in IndexedDB; this is a paint cache in front of it.
 */

import { paletteGroundHex, paletteStylesheet, type PaletteSeed, type ThemeMode } from "@/lib/theme/palette"

export const PALETTE_STORAGE_KEY = "oooi-palette"
const STYLE_ID = "oooi-palette"

interface StoredPalette {
  css: string
  ground: Record<ThemeMode, string>
}

/**
 * Inlined into `<head>` (see `app/layout.tsx`): re-applies the last palette
 * before anything paints, so a cold start does not flash the default colours
 * first. Plain ES5, never throws — storage can be unavailable (private mode,
 * cleared site data), and then the default palette in globals.css stands.
 */
export const PALETTE_BOOT_SCRIPT = `(function(){try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PALETTE_STORAGE_KEY
)})||"null");if(!p||typeof p.css!=="string")return;var s=document.createElement("style");s.id=${JSON.stringify(
  STYLE_ID
)};s.textContent=p.css;document.head.appendChild(s);window.__oooiGround=p.ground}catch(e){}})()`

let lastCss: string | null = null

/** Put a palette on the page and remember it for the next launch. */
export function applyPalette(seed: PaletteSeed) {
  if (typeof document === "undefined") return
  const css = paletteStylesheet(seed)
  const ground = paletteGroundHex(seed)
  if (css !== lastCss) {
    lastCss = css
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
    if (!style) {
      style = document.createElement("style")
      style.id = STYLE_ID
      document.head.appendChild(style)
    }
    if (style.textContent !== css) style.textContent = css
  }
  ;(window as Window & { __oooiGround?: Record<ThemeMode, string> }).__oooiGround = ground
  try {
    const stored: StoredPalette = { css, ground }
    localStorage.setItem(PALETTE_STORAGE_KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable: the palette still applies for this session.
  }
  syncThemeColor()
}

/**
 * Point `<meta name="theme-color">` at the ground of the mode actually on
 * screen. The mode is the `dark` class next-themes sets, not the OS
 * preference — a pilot who chose Light on a dark-mode phone would otherwise
 * get a dark status bar over a light page. Both meta tags (one per media
 * query) take the same value for that reason.
 */
export function syncThemeColor() {
  if (typeof document === "undefined") return
  const ground = (window as Window & { __oooiGround?: Record<ThemeMode, string> }).__oooiGround
  if (!ground) return
  const mode: ThemeMode = document.documentElement.classList.contains("dark") ? "dark" : "light"
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (meta.getAttribute("content") !== ground[mode]) meta.setAttribute("content", ground[mode])
  })
}
