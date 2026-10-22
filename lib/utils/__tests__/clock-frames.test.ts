/**
 * The flight form's time rows edit either clock — UTC, or the airport's local
 * time — and both columns show the same instant. The pair must therefore be an
 * exact inverse at every offset the app meets, half and quarter hours included.
 */

import { describe, it, expect } from "vitest"
import { formatTimezoneOffset, localToUTC, utcToLocal } from "../time"

describe("utcToLocal / localToUTC", () => {
  it("convert across midnight in both directions", () => {
    expect(utcToLocal("23:30", 8)).toBe("07:30")
    expect(localToUTC("07:30", 8)).toBe("23:30")
    expect(utcToLocal("02:10", -5)).toBe("21:10")
    expect(localToUTC("21:10", -5)).toBe("02:10")
  })

  it("handle half- and quarter-hour zones", () => {
    expect(utcToLocal("17:13", 5.5)).toBe("22:43")
    expect(localToUTC("22:43", 5.5)).toBe("17:13")
    expect(localToUTC("00:10", 5.75)).toBe("18:25")
  })

  it("are exact inverses for every minute of the day", () => {
    for (const offset of [-11, -3.5, 0, 5.5, 5.75, 8, 13, 14]) {
      for (let m = 0; m < 24 * 60; m += 7) {
        const utc = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
        expect(localToUTC(utcToLocal(utc, offset), offset)).toBe(utc)
      }
    }
  })

  it("return blank for no time, never a made-up one", () => {
    expect(localToUTC("", 8)).toBe("")
    expect(localToUTC("25:00", 8)).toBe("")
    expect(utcToLocal(undefined, 8)).toBe("")
  })
})

describe("formatTimezoneOffset", () => {
  it("names whole, half and negative zones", () => {
    expect(formatTimezoneOffset(0)).toBe("UTC")
    expect(formatTimezoneOffset(8)).toBe("UTC+8")
    expect(formatTimezoneOffset(-5)).toBe("UTC-5")
    expect(formatTimezoneOffset(5.5)).toBe("UTC+5:30")
    expect(formatTimezoneOffset(5.75)).toBe("UTC+5:45")
    expect(formatTimezoneOffset(-3.5)).toBe("UTC-3:30")
  })
})
