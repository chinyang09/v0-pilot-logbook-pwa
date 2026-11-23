import { describe, expect, it } from "vitest"
import { formatRunwayLength } from "../runway-length"

describe("formatRunwayLength", () => {
  it("is feet by default and metres when chosen", () => {
    expect(formatRunwayLength(10499, undefined)).toBe("10,499'")
    expect(formatRunwayLength(10499, "ft")).toBe("10,499'")
    expect(formatRunwayLength(10499, "m")).toBe("3,200m")
  })
  it("says nothing for a length the source left out", () => {
    expect(formatRunwayLength(0, "m")).toBe("")
    expect(formatRunwayLength(Number.NaN, "ft")).toBe("")
  })
})
