import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { buildCalendarSpans, flightBarLabel, layoutWeek, nextDayKey } from "../calendar-bars"

const UTC = { zulu: true }
const flight = (over: Partial<FlightLog>): FlightLog =>
  ({ id: "f", date: "2026-11-16", flightNumber: "TR560", arrivalIcao: "RPMD", ...over }) as FlightLog
const duty = (over: Partial<ScheduleEntry>): ScheduleEntry =>
  ({ id: "d", date: "2026-11-09", dutyType: "leave", dutyCode: "AL", sectors: [], crew: [], timeReference: "UTC", importedAt: 0, ...over }) as ScheduleEntry
const WEEK = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]
const opts = { duties: true, todayUtc: "2026-11-11" }

describe("calendar spans", () => {
  it("labels a flight by its number and where it goes", () => {
    expect(flightBarLabel({ flightNumber: "tr560", arrivalIcao: "RPMD" })).toBe("TR560 RPMD")
    expect(flightBarLabel({ flightNumber: "TR560", arrivalIata: "DVO" })).toBe("TR560 DVO")
  })

  it("keeps a same-day flight in one whole cell", () => {
    const [s] = buildCalendarSpans([], [flight({ scheduledOut: "02:00", scheduledIn: "05:00" })], UTC, opts)
    expect(s).toMatchObject({ startDay: "2026-11-16", endDay: "2026-11-16", startHalf: 0, endHalf: 2 })
    expect(s.tone).toEqual({ kind: "flight", state: "planned" })
  })

  it("draws a flight across midnight on half of each day", () => {
    const [s] = buildCalendarSpans([], [flight({ outTime: "21:55", inTime: "01:30" })], UTC, opts)
    expect(s).toMatchObject({ startDay: "2026-11-16", endDay: "2026-11-17", startHalf: 1, endHalf: 1 })
    expect(s.tone).toEqual({ kind: "flight", state: "flown" })
  })

  it("reads the day in the display zone", () => {
    // 20:00Z is 04:00 the next day in Singapore.
    const [s] = buildCalendarSpans([], [flight({ scheduledOut: "20:00", scheduledIn: "23:00" })], { zulu: false, zone: "Asia/Singapore" }, opts)
    expect(s.startDay).toBe("2026-11-17")
  })

  it("merges consecutive all-day duties with the same code into one bar", () => {
    const entries = ["2026-11-09", "2026-11-10", "2026-11-11"].map((date, i) => duty({ id: `d${i}`, date }))
    entries.push(duty({ id: "x", date: "2026-11-13" }))
    const spans = buildCalendarSpans(entries, [], UTC, opts)
    expect(spans).toHaveLength(2)
    expect(spans[0]).toMatchObject({ id: "d0", startDay: "2026-11-09", endDay: "2026-11-11" })
    expect(spans[1]).toMatchObject({ startDay: "2026-11-13", endDay: "2026-11-13" })
  })

  it("leaves duties and simulators out when the Duties toggle is off", () => {
    const spans = buildCalendarSpans(
      [duty({})],
      [flight({ id: "a" }), flight({ id: "s", entryType: "simulator", isSimulator: true })],
      UTC,
      { ...opts, duties: false }
    )
    expect(spans.map((s) => s.id)).toEqual(["a"])
  })

  it("marks a past sector with no times as not logged", () => {
    const [s] = buildCalendarSpans([], [flight({ date: "2026-11-07", scheduledOut: "04:10", scheduledIn: "06:35" })], UTC, opts)
    expect(s.tone).toEqual({ kind: "flight", state: "unlogged" })
  })

  it("steps a day key on the calendar", () => {
    expect(nextDayKey("2026-12-31")).toBe("2027-01-01")
  })
})

describe("week layout", () => {
  it("places bars in half-day columns and stacks the longer first", () => {
    const spans = buildCalendarSpans(
      [duty({ id: "l1", date: "2026-11-16" }), duty({ id: "l2", date: "2026-11-17" })],
      [flight({ id: "o", outTime: "21:55", inTime: "01:30" })],
      UTC,
      opts
    )
    const { bars, lanes } = layoutWeek(WEEK, spans, 3)
    const leave = bars.find((b) => b.span.id === "l1")!
    const over = bars.find((b) => b.span.id === "o")!
    expect([leave.start, leave.end, leave.lane]).toEqual([2, 6, 0])
    expect([over.start, over.end, over.lane]).toEqual([3, 5, 1])
    expect(lanes).toBe(2)
  })

  it("continues a bar onto the next row", () => {
    const spans = buildCalendarSpans([], [flight({ date: "2026-11-21", outTime: "22:00", inTime: "02:00" })], UTC, opts)
    const thisWeek = layoutWeek(WEEK, spans, 3).bars[0]
    expect([thisWeek.start, thisWeek.end, thisWeek.continuesRight]).toEqual([13, 14, true])
    const nextWeek = layoutWeek(WEEK.map((d) => d.replace(/\d\d$/, (n) => String(Number(n) + 7))), spans, 3).bars[0]
    expect([nextWeek.start, nextWeek.end, nextWeek.continuesLeft]).toEqual([0, 1, true])
  })

  it("counts what does not fit under the lane cap", () => {
    const four = ["a", "b", "c", "d"].map((id, i) =>
      flight({ id, scheduledOut: `0${i * 2}:00`, scheduledIn: `0${i * 2 + 1}:00` })
    )
    // Same-day flights never share a lane (each takes the whole cell).
    const { bars, hidden, lanes } = layoutWeek(WEEK, buildCalendarSpans([], four, UTC, opts), 3)
    expect(lanes).toBe(4)
    expect(bars).toHaveLength(3)
    expect(hidden[1]).toBe(1)
  })
})

describe("duty labels", () => {
  it("names leave by its description and other duties by their code", async () => {
    const { dutyBarLabel } = await import("../calendar-bars")
    expect(dutyBarLabel({ dutyType: "leave", dutyCode: "PL", dutyDescription: "Paternal Leave" })).toBe("Paternal Leave")
    expect(dutyBarLabel({ dutyType: "off", dutyCode: "LOFF", dutyDescription: "Local Day Off for Tech Crew" })).toBe("LOFF")
    expect(dutyBarLabel({ dutyType: "standby" })).toBe("Standby")
  })
})
