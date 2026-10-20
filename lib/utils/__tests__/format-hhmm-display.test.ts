import { describe, it, expect } from "vitest"
import { formatHHMMDisplay } from "../time"

describe("formatHHMMDisplay — durations", () => {
  it("pads only when asked", () => {
    expect(formatHHMMDisplay("03:56", "24h")).toBe("3:56")
    expect(formatHHMMDisplay("03:56", "24h-padded")).toBe("03:56")
  })

  it("never gives a duration AM/PM, even with the 12-hour clock chosen", () => {
    // "12h" is how a clock time reads; a 3h56 block is not "3:56 AM".
    expect(formatHHMMDisplay("03:56", "12h")).toBe("3:56")
    expect(formatHHMMDisplay("13:05", "12h")).toBe("13:05")
  })
})
