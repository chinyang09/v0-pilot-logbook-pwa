import { describe, expect, it } from "vitest"
import type { FlightLog } from "@/types/entities/flight.types"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import { sortFlights } from "@/lib/utils/flight-sort"
import { buildLogbookRows, dutyIdOf, dutyRowKey, newDutyKey, rowCoversDate } from "../logbook-rows"

const flight = (id: string, date: string, out: string): FlightLog =>
  ({ id, date, outTime: out, departureIcao: "WSSS" }) as FlightLog
const duty = (id: string, date: string, report?: string, over: Partial<ScheduleEntry> = {}): ScheduleEntry =>
  ({ id, date, reportTime: report, dutyType: "standby", dutyCode: "SBY", sectors: [], crew: [], timeReference: "UTC", importedAt: 0, ...over }) as ScheduleEntry

describe("logbook rows", () => {
  it("puts duties among the flights, newest first, by date and time", () => {
    const flights = sortFlights([flight("f1", "2026-11-10", "02:00"), flight("f2", "2026-11-12", "08:00")])
    const rows = buildLogbookRows(flights, [
      duty("d1", "2026-11-12", "10:00"),
      duty("d2", "2026-11-12", "06:00"),
      duty("d3", "2026-11-11", "06:00"),
      duty("d4", "2026-11-09"),
    ])
    expect(rows.map((r) => r.key)).toEqual(["duty:d1", "f2", "duty:d2", "duty:d3", "f1", "duty:d4"])
  })

  it("puts an all-day duty at the end of its day, as an untimed flight", () => {
    const rows = buildLogbookRows([flight("f", "2026-11-12", "08:00")], [duty("off", "2026-11-12", undefined, { dutyType: "off" })])
    expect(rows.map((r) => r.key)).toEqual(["f", "duty:off"])
  })

  it("leaves out the roster's flight rows and anything binned", () => {
    const rows = buildLogbookRows(
      [],
      [duty("a", "2026-11-12", "06:00", { dutyType: "flight" }), duty("b", "2026-11-12", "06:00", { deletedAt: 1 }), duty("c", "2026-11-12")]
    )
    expect(rows.map((r) => r.key)).toEqual(["duty:c"])
  })

  it("is the logbook alone with no duties", () => {
    const flights = sortFlights([flight("a", "2026-11-10", "02:00"), flight("b", "2026-11-11", "02:00")])
    expect(buildLogbookRows(flights, []).map((r) => r.key)).toEqual(["b", "a"])
  })

  it("makes a run of the same whole-day duty ONE row, at its last day", () => {
    const off = (id: string, date: string) => duty(id, date, undefined, { dutyType: "off", dutyCode: "LOFF" })
    const rows = buildLogbookRows(
      [flight("f", "2026-11-15", "02:00"), flight("g", "2026-11-11", "02:00")],
      [off("a", "2026-11-12"), off("b", "2026-11-13"), off("c", "2026-11-14"), off("z", "2026-11-20")]
    )
    expect(rows.map((r) => r.key)).toEqual(["duty:z", "f", "duty:a", "g"])
    const run = rows[2]
    expect(run.kind === "duty" && run.entries.map((e) => e.id)).toEqual(["a", "b", "c"])
    expect([run.startDate, run.date]).toEqual(["2026-11-12", "2026-11-14"])
    expect(rowCoversDate(run, "2026-11-13")).toBe(true)
    expect(rowCoversDate(run, "2026-11-15")).toBe(false)
  })

  it("never runs a timed duty, or a different code, into its neighbour", () => {
    const rows = buildLogbookRows(
      [],
      [
        duty("s1", "2026-11-12", "06:00"),
        duty("s2", "2026-11-13", "06:00"),
        duty("o1", "2026-11-14", undefined, { dutyType: "off", dutyCode: "LOFF" }),
        duty("o2", "2026-11-15", undefined, { dutyType: "off", dutyCode: "OFF" }),
      ]
    )
    expect(rows).toHaveLength(4)
  })

  it("names a duty's selection apart from a flight's", () => {
    expect(dutyIdOf(dutyRowKey("duty:2026-11-12:SBY"))).toBe("duty:2026-11-12:SBY")
    expect(dutyIdOf("flight-id")).toBeNull()
    expect(newDutyKey("2026-11-12")).toBe("duty:new:2026-11-12")
  })
})
