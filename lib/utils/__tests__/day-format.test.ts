import { describe, expect, it } from "vitest"
import { formatRestSpan } from "../dashboard/duty-status"
import { formatDay, formatDayAt, formatDayParts, formatStamp, formatYMDMedium, formatYMDShort, formatDayRange } from "../date"

describe("the app's day: Ddd, d Mmm yy", () => {
  it("writes a stored date with weekday, unpadded day, month and two-digit year", () => {
    expect(formatDay("2026-11-27")).toBe("Fri, 27 Nov 26")
    expect(formatDay("2026-11-06")).toBe("Fri, 6 Nov 26")
    expect(formatDay("2011-01-03")).toBe("Mon, 3 Jan 11")
    expect(formatDay("2000-02-29")).toBe("Tue, 29 Feb 00")
  })

  it("drops parts, never reorders them", () => {
    expect(formatDay("2026-11-27", { weekday: false })).toBe("27 Nov 26")
    expect(formatDay("2026-11-27", { year: false })).toBe("Fri, 27 Nov")
    expect(formatDay("2026-11-27", { weekday: false, year: false })).toBe("27 Nov")
    expect(formatYMDShort("2026-04-16")).toBe("16 Apr")
    expect(formatYMDMedium("2026-04-16")).toBe("Thu, 16 Apr 26")
  })

  it("passes through what is not a date", () => {
    expect(formatDay("")).toBe("")
    expect(formatDay("soon")).toBe("soon")
  })

  it("reads an instant on the calendar of the zone asked", () => {
    // 23:30Z on the 5th is the 6th in Singapore, still the 5th in New York.
    const at = Date.UTC(2026, 10, 5, 23, 30)
    expect(formatDayAt(at, "UTC")).toBe("Thu, 5 Nov 26")
    expect(formatDayAt(at, "Asia/Singapore")).toBe("Fri, 6 Nov 26")
    expect(formatDayAt(at, "America/New_York", { weekday: false, year: false })).toBe("5 Nov")
  })

  it("agrees with the part-built form on the device's calendar", () => {
    const d = new Date(2026, 10, 27, 14, 5)
    expect(formatDayAt(d)).toBe(formatDayParts(2026, 10, 27))
    expect(formatStamp(d)).toBe("Fri, 27 Nov 26 14:05")
  })
})


describe("a rest's length reads the same on the dashboard and the FDP page", () => {
  it("is a clock under 100 hours and days + hours from there", () => {
    expect(formatRestSpan(642)).toBe("10:42")
    expect(formatRestSpan(99 * 60 + 59)).toBe("99:59")
    expect(formatRestSpan(100 * 60)).toBe("4d 4h")
    expect(formatRestSpan(510 * 60 + 13)).toBe("21d 6h")
  })
})
describe("formatDayRange", () => {
  it("inside one year carries the year once, on the end", () => {
    expect(formatDayRange("2026-11-01", "2026-11-30")).toBe("1 Nov – 30 Nov 26")
  })
  it("across two years carries each end's own", () => {
    expect(formatDayRange("2026-12-28", "2027-01-03")).toBe("28 Dec 26 – 3 Jan 27")
  })
  it("a single day is just that day", () => {
    expect(formatDayRange("2026-11-07", "2026-11-07")).toBe("7 Nov 26")
  })
})
