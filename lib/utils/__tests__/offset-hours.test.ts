import { describe, it, expect } from "vitest"
import { offsetHoursFromName, tzOffsetName } from "../tz-format"

describe("offsetHoursFromName", () => {
  it("keeps the minutes of a half-hour zone", () => {
    expect(offsetHoursFromName("GMT+05:30")).toBe(5.5)
    expect(offsetHoursFromName("GMT+05:45")).toBe(5.75)
    expect(offsetHoursFromName("GMT-03:30")).toBe(-3.5)
  })

  it("reads whole-hour zones and bare GMT", () => {
    expect(offsetHoursFromName("GMT+08:00")).toBe(8)
    expect(offsetHoursFromName("GMT-05:00")).toBe(-5)
    expect(offsetHoursFromName("GMT")).toBe(0)
    expect(offsetHoursFromName("")).toBe(0)
  })

  it("reads what Intl actually produces for the owner's Indian airports", () => {
    const at = new Date("2026-03-09T20:00:00Z")
    expect(offsetHoursFromName(tzOffsetName("Asia/Kolkata", "longOffset", at))).toBe(5.5)
    expect(offsetHoursFromName(tzOffsetName("Asia/Singapore", "longOffset", at))).toBe(8)
  })
})
