"use client"

import { useEffect } from "react"
import { installPressInk } from "@/lib/ui/press-ink"

/** Mounts the app's one touch-ink listener (`lib/ui/press-ink.ts`). */
export function PressInk() {
  useEffect(() => installPressInk(), [])
  return null
}
