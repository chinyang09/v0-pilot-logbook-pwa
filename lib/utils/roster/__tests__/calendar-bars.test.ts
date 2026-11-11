import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { buildCalendarSpans, flightBarLabel, layoutWeek, nextDayKey, pairedFlightNumber, shortFlightNumber } from "../calendar-bars"

const UTC = { zulu: true }
const flight = (over: Partial<FlightLog>): FlightLog =>
  ({ id: "f", date: "2026-11-16", flightNumber: "TR560", arrivalIcao: "RPMD", ...over }) as FlightLog
const duty = (over: Partial<ScheduleEntry>): ScheduleEntry =>
  ({ id: "d", date: "2026-11-09", dutyType: "leave", dutyCode: "AL", sectors: [], crew: [], timeReference: "UTC", importedAt: 0, ...over }) as ScheduleEntry
const WEEK = ["2026-11-15", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]
const opts = { duties: true, todayUtc: "2026-11-11" }

describe("calendar spans", () => {
  it("labels a flight by its number and where it goes", () => {
    expect(flightBarLabel({ flightNumber: "tr560", arrivalIcao: "RPMD" })).toBe("560 RPMD")
    expect(flightBarLabel({ flightNumber: "TR560", arrivalIata: "DVO" })).toBe("560 DVO")
  })

  it("drops the airline designator and leading zeros, and keeps anything else whole", () => {
    expect(shortFlightNumber("TR0288")).toBe("288")
    expect(shortFlightNumber("TGW288")).toBe("288")
    expect(shortFlightNumber("3K123")).toBe("123")
    expect(shortFlightNumber("TR288A")).toBe("288A")
    expect(shortFlightNumber("288")).toBe("288")
    expect(shortFlightNumber("POSN")).toBe("POSN")
  })

  it("writes a return pair the way a roster does", () => {
    expect(pairedFlightNumber("248", "249")).toBe("248/9")
    expect(pairedFlightNumber("288", "291")).toBe("288/91")
    expect(pairedFlightNumber("199", "200")).toBe("199/200")
    expect(pairedFlightNumber("98", "101")).toBe("98/101")
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

  it("leaves the roster's duties out when the Duties toggle is off, and keeps the logbook's simulator", () => {
    const spans = buildCalendarSpans(
      [duty({})],
      [flight({ id: "a" }), flight({ id: "s", entryType: "simulator", isSimulator: true })],
      UTC,
      { ...opts, duties: false }
    )
    expect(spans.map((s) => s.id).sort()).toEqual(["a", "s"])
  })

  const leg = (id: string, number: string, from: string, to: string, out: string, inn: string, date = "2026-11-16") =>
    flight({ id, date, flightNumber: number, departureIcao: from, arrivalIcao: to, scheduledOut: out, scheduledIn: inn })

  it("draws out-and-back as ONE bar named for the turnaround", () => {
    const spans = buildCalendarSpans(
      [],
      [
        leg("b", "TR249", "WMKP", "WSSS", "04:00", "05:10"),
        leg("a", "TR248", "WSSS", "WMKP", "01:30", "02:40"),
      ],
      UTC,
      opts
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ id: "a", label: "248/9", detail: "WMKP", startDay: "2026-11-16", endDay: "2026-11-16" })
  })

  it("makes a four-sector day of two returns two bars", () => {
    const spans = buildCalendarSpans(
      [],
      [
        leg("1", "TR248", "WSSS", "WMKP", "00:30", "01:40"),
        leg("2", "TR249", "WMKP", "WSSS", "02:30", "03:40"),
        leg("3", "TR250", "WSSS", "WMKP", "05:00", "06:10"),
        leg("4", "TR251", "WMKP", "WSSS", "07:00", "08:10"),
      ],
      UTC,
      opts
    )
    expect(spans.map((s) => `${s.label} ${s.detail}`)).toEqual(["248/9 WMKP", "250/1 WMKP"])
  })

  it("pairs an overnight return across midnight, half of each day", () => {
    const spans = buildCalendarSpans(
      [],
      [
        leg("a", "TR566", "WSSS", "VTBS", "14:50", "17:15"),
        leg("b", "TR567", "VTBS", "WSSS", "18:20", "20:45"),
      ],
      { zulu: false, zone: "Asia/Singapore" },
      opts
    )
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({ label: "566/7", startDay: "2026-11-16", endDay: "2026-11-17", startHalf: 1, endHalf: 1 })
  })

  it("leaves a one-way leg, a triangle and a long layover as single legs", () => {
    const spans = buildCalendarSpans(
      [],
      [
        leg("a", "TR100", "WSSS", "WMKK", "00:00", "01:00"),
        leg("b", "TR101", "WMKK", "WMKP", "02:00", "03:00"),
        leg("c", "TR102", "WMKP", "WSSS", "04:00", "05:00"),
        leg("d", "TR300", "WSSS", "RJAA", "06:00", "13:00", "2026-11-17"),
        leg("e", "TR301", "RJAA", "WSSS", "06:00", "13:00", "2026-11-19"),
      ],
      UTC,
      opts
    )
    expect(spans.map((s) => s.label)).toEqual(["100", "101", "102", "300", "301"])
  })

  it("keeps a pair still to fly in the accent until both legs are flown", () => {
    const [s] = buildCalendarSpans(
      [],
      [
        { ...leg("a", "TR248", "WSSS", "WMKP", "01:30", "02:40", "2026-11-11"), outTime: "01:31", inTime: "02:39" },
        leg("b", "TR249", "WMKP", "WSSS", "04:00", "05:10", "2026-11-11"),
      ],
      UTC,
      opts
    )
    expect(s.tone).toEqual({ kind: "flight", state: "planned" })
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

  it("gives a label a second line only where the lane under it is free", () => {
    const always = () => true
    const legs = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        flight({ id: `f${i}`, flightNumber: `TR${100 + i}`, scheduledOut: `0${i * 2}:00`, scheduledIn: `0${i * 2 + 1}:00` })
      )
    // One flight alone: number over airport.
    expect(layoutWeek(WEEK, buildCalendarSpans([], legs(1), UTC, opts), 3, always).bars.map((b) => b.height)).toEqual([2])
    // Two: the first's lane below is taken, the second's is free.
    expect(layoutWeek(WEEK, buildCalendarSpans([], legs(2), UTC, opts), 3, always).bars.map((b) => [b.lane, b.height])).toEqual([
      [0, 1],
      [1, 2],
    ])
    // Three: every lane is needed, so nothing takes a second line.
    expect(layoutWeek(WEEK, buildCalendarSpans([], legs(3), UTC, opts), 3, always).bars.map((b) => b.height)).toEqual([1, 1, 1])
    // Only bars that ask for it.
    expect(layoutWeek(WEEK, buildCalendarSpans([], legs(1), UTC, opts), 3, () => false).bars[0].height).toBe(1)
  })

  it("never takes a second line over another item's day, even half of it", () => {
    const spans = buildCalendarSpans(
      [duty({ id: "sb", date: "2026-11-17", dutyType: "standby", dutyCode: "SBY", reportTime: "00:00", debriefTime: "08:00" })],
      [flight({ id: "o", outTime: "21:55", inTime: "01:30" })],
      UTC,
      opts
    )
    // The overnight flight (16th, half to 17th) sits over the standby's lane on the 17th.
    const bars = layoutWeek(WEEK, spans, 3, () => true).bars
    const over = bars.find((b) => b.span.id === "o")!
    const sb = bars.find((b) => b.span.id === "sb")!
    expect([over.lane, over.height]).toEqual([0, 1])
    expect([sb.lane, sb.height]).toEqual([1, 2])
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
