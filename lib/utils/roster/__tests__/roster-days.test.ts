import { describe, it, expect } from "vitest"
import { agendaFrom, buildRosterDays, dayKeyAt, itemLabel, utcInstant } from "../roster-days"
import type { ScheduleEntry } from "@/types/entities/roster.types"
import type { FlightLog } from "@/types/entities/flight.types"

const duty = (over: Partial<ScheduleEntry>): ScheduleEntry =>
  ({
    id: "d",
    date: "2026-10-20",
    timeReference: "UTC",
    dutyType: "standby",
    dutyCode: "BKUP",
    sectors: [],
    crew: [],
    createdAt: 0,
    syncStatus: "synced",
    ...over,
  }) as ScheduleEntry

const flight = (over: Partial<FlightLog>): FlightLog =>
  ({ id: "f", date: "2026-10-20", flightNumber: "TR602", outTime: "", inTime: "", scheduledOut: "", scheduledIn: "", ...over }) as FlightLog

const SGT = { zulu: false, zone: "Asia/Singapore" }
const Z = { zulu: true }

describe("roster days", () => {
  it("reads a UTC date + time as one instant", () => {
    expect(utcInstant("2026-10-20", "22:00")).toBe(Date.UTC(2026, 9, 20, 22, 0))
    expect(utcInstant("2026-10-20", "")).toBeNull()
    expect(utcInstant("2026-10-20", "25:00")).toBeNull()
  })

  it("puts a duty on the day it starts in the DISPLAY zone", () => {
    // 22:00Z on the 20th is 06:00 on the 21st in Singapore.
    const days = buildRosterDays([duty({ reportTime: "22:00", debriefTime: "10:00" })], [], SGT)
    expect([...days.keys()]).toEqual(["2026-10-21"])
    // With Zulu on, the UTC date is the day.
    expect([...buildRosterDays([duty({ reportTime: "22:00" })], [], Z).keys()]).toEqual(["2026-10-20"])
  })

  it("keeps an all-day duty on its stored date, and ends a past-midnight duty the next day", () => {
    const days = buildRosterDays(
      [duty({ id: "off", dutyType: "off", dutyCode: "LOFF" }), duty({ id: "sb", reportTime: "22:00", debriefTime: "10:00" })],
      [],
      Z
    )
    expect(days.get("2026-10-20")!.map((i) => i.id)).toEqual(["off", "sb"]) // all-day first
    const sb = days.get("2026-10-20")!.find((i) => i.id === "sb")!
    expect(sb.endMs! - sb.startMs!).toBe(12 * 3_600_000)
  })

  it("places a scheduled flight by its scheduled out, and a flown one by its actual", () => {
    const days = buildRosterDays(
      [],
      [
        flight({ id: "sch", scheduledOut: "08:45", scheduledIn: "12:50" }),
        flight({ id: "flown", outTime: "13:00", inTime: "15:00", scheduledOut: "12:45" }),
      ],
      Z
    )
    const items = days.get("2026-10-20")!
    expect(items.map((i) => i.id)).toEqual(["sch", "flown"])
    expect(items.map((i) => (i.kind === "flight" ? i.flown : null))).toEqual([false, true])
  })

  it("lists the agenda soonest first, from the selected day, always including it", () => {
    const days = buildRosterDays(
      [duty({ id: "a", date: "2026-10-25" }), duty({ id: "b", date: "2026-10-21" }), duty({ id: "old", date: "2026-10-01" })],
      [],
      Z
    )
    const agenda = agendaFrom(days, "2026-10-20")
    expect(agenda.map((d) => d.dayKey)).toEqual(["2026-10-20", "2026-10-21", "2026-10-25"])
    expect(agenda[0].items).toEqual([])
  })

  it("labels a cell by duty code, flight number or SIM", () => {
    const days = buildRosterDays(
      [duty({ dutyCode: "ebt1" })],
      [flight({ id: "s", flightNumber: "", entryType: "simulator", scheduledOut: "01:00" })],
      Z
    )
    expect(days.get("2026-10-20")!.map(itemLabel)).toEqual(["EBT1", "SIM"])
  })

  it("formats a day key in a zone", () => {
    expect(dayKeyAt(Date.UTC(2026, 9, 20, 17, 0), SGT)).toBe("2026-10-21")
    expect(dayKeyAt(Date.UTC(2026, 9, 20, 17, 0), Z)).toBe("2026-10-20")
  })
})

describe("dayKeyAt — the Date fast path agrees with the zone formatter", () => {
  it("for the device zone and for UTC, across DST changes and midnights", () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone
    for (let ms = Date.UTC(2025, 0, 1); ms < Date.UTC(2027, 0, 1); ms += 37 * 60_000 * 13) {
      expect(dayKeyAt(ms, { zulu: false })).toBe(dayKeyAt(ms, { zulu: false, zone: device }))
      expect(dayKeyAt(ms, { zulu: true })).toBe(dayKeyAt(ms, { zulu: false, zone: "UTC" }))
    }
  })
})
