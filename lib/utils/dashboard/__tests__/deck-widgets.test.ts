/**
 * The tiles a pilot adds to the Flight Deck: the sun on each leg, days off
 * around the chosen duty, a leg's OFP in brief (off a REAL package) and the
 * logbook's month.
 */
import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { daysOffAt, legSun, logbookMonth, ofpBrief, sunEvents, tonnes } from "../deck-widgets"
import { parseBriefing } from "@/lib/briefing/parse"
import type { FlightLog } from "@/types/entities/flight.types"

const H = 3_600_000
const DAY = 24 * H
const at = (iso: string) => Date.parse(iso)
const WSSS = { lat: 1.3644, lon: 103.9915 }
const WIII = { lat: -6.1256, lon: 106.6559 }

describe("legSun — each leg by day or night", () => {
  it("a red-eye from Singapore to Jakarta is dark at both ends and all the way", () => {
    // 15:55Z–17:50Z: 23:55 SGT to 00:50 in Jakarta.
    const l = legSun({ id: "a", flight: "TR274", departMs: at("2026-11-18T15:55:00Z"), arriveMs: at("2026-11-18T17:50:00Z"), from: WSSS, to: WIII })
    expect(l.takeoff).toBe("night")
    expect(l.landing).toBe("night")
    expect(l.blockMinutes).toBe(115)
    expect(l.nightMinutes).toBe(115)
  })
  it("a midday leg is by day throughout", () => {
    const l = legSun({ id: "b", flight: "TR275", departMs: at("2026-11-19T04:00:00Z"), arriveMs: at("2026-11-19T06:00:00Z"), from: WIII, to: WSSS })
    expect(l.takeoff).toBe("day")
    expect(l.landing).toBe("day")
    expect(l.nightMinutes).toBe(0)
  })
  it("an end with no position says nothing rather than guess", () => {
    const l = legSun({ id: "c", flight: "X", departMs: at("2026-11-19T04:00:00Z"), arriveMs: at("2026-11-19T06:00:00Z"), from: null, to: WSSS })
    expect(l.takeoff).toBeNull()
    expect(l.nightMinutes).toBeNull()
    expect(l.landing).toBe("day")
  })
})

describe("sunEvents — when the sun next rises and sets", () => {
  it("Singapore's next sunset and sunrise from noon, to the minute, in order", () => {
    const ev = sunEvents(WSSS, at("2026-11-19T04:00:00Z"))
    expect(ev.map((e) => e.kind)).toEqual(["sunset", "sunrise"])
    // Civil dusk near 19:20 SGT (11:20Z), civil dawn near 06:30 SGT (22:30Z).
    expect(Math.abs(ev[0].atMs - at("2026-11-19T11:20:00Z"))).toBeLessThan(20 * 60_000)
    expect(Math.abs(ev[1].atMs - at("2026-11-19T22:30:00Z"))).toBeLessThan(20 * 60_000)
    expect(ev[0].atMs % 60_000).toBe(0)
  })
})

describe("daysOffAt — the duty against para 5", () => {
  const off = (from: string, hours: number) => ({ startMs: at(from), endMs: at(from) + hours * H })
  const result = {
    daysOff: [off("2026-10-25T02:00:00Z", 34), off("2026-11-08T02:00:00Z", 34), off("2026-11-16T02:00:00Z", 34), off("2026-11-17T12:00:00Z", 24)],
    findings: [{ rule: "5(4)(a)" as const, severity: "violation" as const, atMs: at("2026-11-15T00:00:00Z"), label: "8 dates without a day off" }],
  }
  const duties = [
    { startMs: at("2026-11-10T00:00:00Z"), endMs: at("2026-11-10T10:00:00Z") },
    { startMs: at("2026-11-12T00:00:00Z"), endMs: at("2026-11-12T10:00:00Z") },
    { startMs: at("2026-11-13T00:00:00Z"), endMs: at("2026-11-13T10:00:00Z") },
  ]
  it("which date of the run the duty is, and the day off either side", () => {
    const d = daysOffAt(result, duties, duties[2].startMs, duties[2].endMs)
    // The run began on 10 Nov (SGT): 13 Nov is its fourth date.
    expect(d.runDay).toBe(4)
    expect(d.lastOff?.startMs).toBe(at("2026-11-08T02:00:00Z"))
    expect(d.nextOff?.startMs).toBe(at("2026-11-16T02:00:00Z"))
    expect(d.findings).toHaveLength(1)
  })
  it("counts the days off in the 14 and 28 dates ending on the duty's", () => {
    const d = daysOffAt(result, duties, at("2026-11-19T00:00:00Z"), at("2026-11-19T08:00:00Z"))
    // 6–19 Nov hold the three in November; 22 Oct–19 Nov the October one too.
    expect(d.in14).toBe(3)
    expect(d.in28).toBe(4)
  })
})

describe("ofpBrief — a leg's OFP in a line, off a REAL package", () => {
  it("TR438 WSSS–WBGG", () => {
    const b = parseBriefing(JSON.parse(readFileSync(join(__dirname, "../../../briefing/__tests__/fixtures/tr438-wsss-wbgg.pages.json"), "utf8")))
    const o = ofpBrief(b)
    expect(o).toMatchObject({ flight: "TR438", cruise: "FL290", tripTime: "1:07", blockKg: 6125 })
    expect(o.notams).toBeGreaterThan(0)
    expect(tonnes(o.blockKg)).toBe("6.1t")
    expect(tonnes(null)).toBe("—")
  })
})

describe("logbookMonth — the duty's month", () => {
  const f = (o: Partial<FlightLog>) =>
    ({ id: o.id ?? "x", date: "2026-11-05", flightNumber: "TR1", outTime: "01:00", inTime: "03:00", blockTime: "2:00", nightTime: "0:30", dayLandings: 1, nightLandings: 0, entryType: "flight", isSimulator: false, scheduledOut: "01:00", scheduledIn: "03:00", ...o }) as FlightLog
  it("adds up what has flown, counts what is ahead, and lists what is not logged", () => {
    const flights = [
      f({ id: "a" }),
      f({ id: "b", date: "2026-11-10", blockTime: "3:15", nightTime: "0:00", dayLandings: 0, nightLandings: 1 }),
      // Rostered, ahead of today.
      f({ id: "c", date: "2026-11-25", outTime: "", inTime: "", blockTime: "0:00" }),
      // Past, never logged.
      f({ id: "d", date: "2026-11-12", outTime: "", inTime: "", blockTime: "0:00", flightNumber: "TR491" }),
      // Another month, and a simulator: neither counts here.
      f({ id: "e", date: "2026-10-30" }),
      f({ id: "s", entryType: "simulator", isSimulator: true }),
    ]
    const m = logbookMonth(flights, at("2026-11-18T00:00:00Z"), "2026-11-20")
    expect(m.month).toBe("2026-11")
    expect(m.sectors).toBe(2)
    expect(m.blockMinutes).toBe(315)
    expect(m.nightMinutes).toBe(30)
    expect(m.landings).toBe(2)
    expect(m.rostered).toBe(1)
    expect(m.unlogged.map((u) => u.flight)).toEqual(["TR491"])
  })
  it("is the month of the duty chosen, not today's", () => {
    expect(logbookMonth([], at("2026-12-02T00:00:00Z"), "2026-11-20").month).toBe("2026-12")
    expect(DAY).toBe(86_400_000)
  })
})
