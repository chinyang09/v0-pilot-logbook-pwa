import { describe, expect, it } from "vitest"
import { dateForOut, scheduledInMinutes, scheduledInMs, scheduledOutMinutes, scheduledOutMs } from "../flight-day"

/**
 * A flight is dated by its actual OUT once there is one (as every import
 * writes it), so a red-eye's schedule can be the evening BEFORE its date.
 */
describe("the schedule against the OUT a flight is dated by", () => {
  // TR274: scheduled 23:55, off blocks 00:28 — dated the 19th.
  const redEye = { date: "2026-11-19", scheduledOut: "23:55", scheduledIn: "01:50", outTime: "00:28" }

  it("reads a schedule the evening before the date", () => {
    expect(scheduledOutMinutes(redEye)).toBe(-5)
    expect(scheduledInMinutes(redEye)).toBe(110)
    expect(scheduledOutMs(redEye)).toBe(Date.parse("2026-11-18T23:55:00Z"))
    expect(scheduledInMs(redEye)).toBe(Date.parse("2026-11-19T01:50:00Z"))
  })

  it("reads an unflown schedule on its own date", () => {
    expect(scheduledOutMinutes({ scheduledOut: "23:55", outTime: "" })).toBe(1435)
    expect(scheduledInMinutes({ scheduledOut: "23:55", scheduledIn: "01:50", outTime: "" })).toBe(1550)
  })

  it("keeps an early departure's schedule after it", () => {
    // Off blocks at 23:58 for a 00:05 schedule: dated the 18th, scheduled the 19th.
    expect(scheduledOutMinutes({ scheduledOut: "00:05", outTime: "23:58" })).toBe(1445)
    // A long delay stays on the day: scheduled 08:00, off at 19:30.
    expect(scheduledOutMinutes({ scheduledOut: "08:00", outTime: "19:30" })).toBe(480)
  })
})

describe("the date an OUT typed by hand puts a flight on", () => {
  const rostered = { date: "2026-11-18", scheduledOut: "23:55", outTime: "" }

  it("moves a red-eye stamped after midnight to the next day", () => {
    expect(dateForOut(rostered, "00:28")).toBe("2026-11-19")
    expect(dateForOut(rostered, "23:58")).toBe("2026-11-18")
    // Two hours early is still the same day; more is the evening before.
    expect(dateForOut({ date: "2026-11-19", scheduledOut: "00:30", outTime: "" }, "23:50")).toBe("2026-11-18")
  })

  it("follows a corrected OUT from the one it had", () => {
    const flown = { date: "2026-11-19", scheduledOut: "23:55", outTime: "00:28" }
    expect(dateForOut(flown, "23:58")).toBe("2026-11-18")
    expect(dateForOut(flown, "00:40")).toBe("2026-11-19")
  })

  it("goes back to the schedule's day when the OUT is cleared", () => {
    expect(dateForOut({ date: "2026-11-19", scheduledOut: "23:55", outTime: "00:28" }, "")).toBe("2026-11-18")
    expect(dateForOut({ date: "2026-11-18", scheduledOut: "08:00", outTime: "08:10" }, "")).toBe("2026-11-18")
  })

  it("leaves a flight with no schedule and no OUT alone", () => {
    expect(dateForOut({ date: "2026-11-18", scheduledOut: "", outTime: "" }, "00:28")).toBe("2026-11-18")
  })
})
