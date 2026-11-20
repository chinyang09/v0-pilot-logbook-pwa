import { describe, expect, it } from "vitest"
import { addMonths, daysBetween, dotAt, dotLayout, lookAheadDays, lookAheadFor } from "../currency-dots"

describe("the currency dot calendar", () => {
  it("looks 90 days, six months or a year ahead by the tile's width", () => {
    expect([1, 2, 3].map(lookAheadFor)).toEqual(["90d", "6m", "1y"])
    expect(lookAheadDays("2026-11-20", "90d")).toBe(91)
    expect(lookAheadDays("2026-11-20", "6m")).toBe(daysBetween("2026-11-20", "2027-05-20"))
    expect(lookAheadDays("2026-11-20", "1y")).toBe(365)
  })

  it("counts a leap day in range", () => {
    expect(lookAheadDays("2027-03-01", "1y")).toBe(366) // 29 Feb 2028
    expect(lookAheadDays("2028-03-01", "1y")).toBe(365)
    expect(addMonths("2028-02-29", 12)).toBe("2029-03-01")
  })

  it("lays the days out a week to a column, Monday at the top", () => {
    // Fri 20 Nov 2026: row 4 of its week; 91 days need 14 columns from there.
    const l = dotLayout("2026-11-20", "90d")
    expect(l.offset).toBe(4)
    expect(l.weeks).toBe(14)
    expect(dotAt(l, "2026-11-20")).toEqual({ week: 0, row: 4, index: 0 })
    expect(dotAt(l, "2026-11-23")).toEqual({ week: 1, row: 0, index: 3 }) // the Monday after
    expect(dotAt(l, "2027-02-18")?.index).toBe(90)
    expect(dotAt(l, "2027-02-19")).toBeNull()
    // A year ahead is 52 weeks and a bit.
    expect(dotLayout("2026-11-20", "1y").weeks).toBe(53)
  })

  it("puts a day already gone on today, and names each month where it starts", () => {
    const l = dotLayout("2026-11-20", "90d")
    expect(dotAt(l, "2026-10-01")).toEqual({ week: 0, row: 4, index: 0 })
    expect(l.months.map((m) => m.label)).toEqual(["Dec", "Jan", "Feb"])
    expect(l.months[0].week).toBe(dotAt(l, "2026-12-01")!.week)
  })
})
