import { describe, it, expect } from "vitest"
import { timezoneRepairPatch } from "../flight-timezone"
import { offsetHoursFromName, tzOffsetName } from "../tz-format"

const offsetAt = (tz: string, at: Date) => offsetHoursFromName(tzOffsetName(tz, "longOffset", at))
const flight = (over = {}) => ({ date: "2026-03-09", outTime: "20:00", inTime: "23:59", departureTimezone: 5, arrivalTimezone: 8, ...over })

describe("timezoneRepairPatch", () => {
  it("puts India back at +5:30", () => {
    expect(timezoneRepairPatch(flight(), "Asia/Kolkata", "Asia/Singapore", offsetAt)).toEqual({ departureTimezone: 5.5 })
  })

  it("fills an offset left at 0 by an airport that had not resolved", () => {
    expect(
      timezoneRepairPatch(flight({ departureTimezone: 8, arrivalTimezone: 0 }), "Asia/Singapore", "Asia/Manila", offsetAt)
    ).toEqual({ arrivalTimezone: 8 })
  })

  it("leaves a correct flight, and an airport with no zone, alone", () => {
    expect(timezoneRepairPatch(flight({ departureTimezone: 5.5 }), "Asia/Kolkata", "Asia/Singapore", offsetAt)).toEqual({})
    expect(timezoneRepairPatch(flight(), null, null, offsetAt)).toEqual({})
  })

  it("reads the offset at the flight's own date, not today's", () => {
    // London: BST (+1) in July, GMT in January.
    const july = timezoneRepairPatch(flight({ date: "2026-07-01", departureTimezone: 0 }), "Europe/London", "Asia/Singapore", offsetAt)
    const jan = timezoneRepairPatch(flight({ date: "2026-01-15", departureTimezone: 0 }), "Europe/London", "Asia/Singapore", offsetAt)
    expect(july).toEqual({ departureTimezone: 1 })
    expect(jan).toEqual({})
  })
})
