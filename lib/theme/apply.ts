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
 * The default (Graphite) grounds, for a launch with no stored palette yet.
 * `palette.test.ts` pins them to what the generator builds for the default.
 */
export const DEFAULT_GROUND: Record<ThemeMode, string> = { light: "#f5f6f7", dark: "#06070a" }

/**
 * Inlined into `<head>` (see `app/layout.tsx`): re-applies the last palette
 * before anything paints, so a cold start does not flash the default colours
 * first. Plain ES5, never throws — storage can be unavailable (private mode,
 * cleared site data), and then the default palette in globals.css stands.
 *
 * It also OWNS `<meta name="theme-color">` — the colour Android paints the
 * status bar with — and keeps it on the ground of the mode on screen:
 *
 * - The tag is created here, outside React. When Next rendered it from the
 *   layout's `viewport.themeColor`, a client navigation put the static pair
 *   back (keyed to the OS's dark/light, not the app's), so a light-theme
 *   pilot on a dark-mode phone got a dark bar again on every page after the
 *   first.
 * - It follows the `dark` class through a MutationObserver. next-themes sets
 *   that class in its own effect, which runs AFTER the effects of everything
 *   inside it — so the preferences provider's sync read the OLD class on a
 *   theme change and the bar only caught up on the next launch.
 */
export const PALETTE_BOOT_SCRIPT = `(function(){var d=document,w=window;try{var p=JSON.parse(localStorage.getItem(${JSON.stringify(
  PALETTE_STORAGE_KEY
)})||"null");if(p&&typeof p.css==="string"){var s=d.createElement("style");s.id=${JSON.stringify(
  STYLE_ID
)};s.textContent=p.css;d.head.appendChild(s);w.__oooiGround=p.ground}}catch(e){}try{var m=d.createElement("meta");m.name="theme-color";d.head.appendChild(m);var mode=function(){var t=null;try{t=localStorage.getItem("theme")}catch(e){}if(t==="system")t=w.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";return t==="light"?"light":"dark"};var sync=function(){var g=w.__oooiGround||${JSON.stringify(
  DEFAULT_GROUND
)};var c=d.documentElement.className;var k=/(^|\\s)dark(\\s|$)/.test(c)?"dark":/(^|\\s)light(\\s|$)/.test(c)?"light":mode();if(m.content!==g[k])m.content=g[k]};w.__oooiSyncThemeColor=sync;sync();new MutationObserver(sync).observe(d.documentElement,{attributes:true,attributeFilter:["class"]})}catch(e){}})()`

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
 * screen — the `dark` class next-themes sets, not the OS preference (a pilot
 * who chose Light on a dark-mode phone would otherwise get a dark status bar
 * over a light page). The boot script's observer does this on every class
 * change; this is the call for a new PALETTE, where the class has not moved.
 */
export function syncThemeColor() {
  if (typeof window === "undefined") return
  ;(window as Window & { __oooiSyncThemeColor?: () => void }).__oooiSyncThemeColor?.()
}
