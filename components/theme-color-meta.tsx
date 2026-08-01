"use client"

import { useEffect } from "react"
import { useTheme } from "next-themes"

/**
 * Keep `<meta name="theme-color">` on the APP's theme, not the OS's.
 *
 * This is what Android paints its system bars with. The static metadata in
 * `app/layout.tsx` can only vary on `prefers-color-scheme`, but the app's theme
 * is a class the user picks — so a user running the app dark on a light phone
 * (or the reverse) got a system bar in the wrong colour, which is exactly the
 * "the pad doesn't match / isn't theme aware on Android" symptom. iOS doesn't
 * show it because `black-translucent` leaves the strip transparent and our own
 * background shows through, which is why it looked theme-aware there already.
 *
 * Every `theme-color` meta is updated, media-queried ones included: the browser
 * picks the first whose media matches, so leaving those on the OS scheme would
 * let one of them win.
 *
 * The colours are the sRGB of the `--background` tokens in globals.css
 * (oklch(0.15 0.01 60) and oklch(0.975 0.005 75)). They are literals because a
 * meta tag takes a colour, not a custom property, and Safari has never accepted
 * oklch() there.
 */
const THEME_COLOR = { dark: "#0e0a07", light: "#f9f6f3" } as const

export function ThemeColorMeta() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    const color = resolvedTheme === "light" ? THEME_COLOR.light : THEME_COLOR.dark
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    if (metas.length === 0) {
      const meta = document.createElement("meta")
      meta.name = "theme-color"
      meta.content = color
      document.head.appendChild(meta)
      return
    }
    metas.forEach((meta) => {
      meta.content = color
    })
  }, [resolvedTheme])

  return null
}
