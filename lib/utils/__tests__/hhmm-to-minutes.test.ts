/**
 * hhmmToMinutes reads the stored `H:MM` / `HH:MM` form off its character codes
 * and leaves everything else to the general `split` + `parseInt` parse. This
 * pins the fast path to that general parse, which is the definition.
 */

import { describe, it, expect } from "vitest"
import { hhmmToMinutes } from "../time"

/** The parse as it was before the fast path. */
function reference(hhmm: string | undefined | null): number {
  if (!hhmm || typeof hhmm !== "string") return 0
  const parts = hhmm.split(":")
  if (parts.length !== 2) return 0
  const hours = Number.parseInt(parts[0], 10)
  const minutes = Number.parseInt(parts[1], 10)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0
  return hours * 60 + minutes
}

describe("hhmmToMinutes", () => {
  it("matches the general parse for every H:MM and HH:MM", () => {
    for (let h = 0; h < 100; h++) {
      for (let m = 0; m < 100; m++) {
        const mm = String(m).padStart(2, "0")
        for (const s of [`${h}:${mm}`, `${String(h).padStart(2, "0")}:${mm}`]) {
          expect(hhmmToMinutes(s)).toBe(reference(s))
        }
      }
    }
  })

  it("matches it on malformed and unusual input", () => {
    const cases = [
      "", "0", ":", "1:", ":30", "1:5", "12:345", "123:45", "-1:30", " 1:05", "1 :05",
      "1a:30", "a1:30", "12:3a", "12-30", "12:30:00", "١٢:٣٠", "12:30 ", "+1:30", "1:+5",
      "/0:00", "0:0/", ";9:59", "9:5:", "00:00", "23:59", "24:00", "99:99",
    ]
    for (const s of cases) expect(hhmmToMinutes(s)).toBe(reference(s))
    expect(hhmmToMinutes(undefined)).toBe(0)
    expect(hhmmToMinutes(null)).toBe(0)
  })
})
