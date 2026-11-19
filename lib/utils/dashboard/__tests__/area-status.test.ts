/**
 * The flight dashboard's areas, each said in words: a verdict (go / check /
 * stop, or info / idle where there is none to give) and one line — never a
 * code, and never another area's fact.
 */

import { describe, expect, it } from "vitest"
import {
  aircraftArea,
  crewArea,
  currencyArea,
  destinationArea,
  dutyArea,
  hazardWords,
  limitsArea,
  readiness,
  sinceText,
  weatherArea,
} from "../area-status"
import type { DutyStatus } from "../duty-status"
import type { Requirement } from "../legality"

const clock = (ms: number) => `${new Date(ms).toISOString().slice(11, 16)}Z`
const NOW = Date.parse("2026-11-18T20:00:00Z")

const duty = (over: Partial<DutyStatus>): DutyStatus =>
  ({ phase: "off", active: null, justFinished: null, lastDuty: null, next: null, rest: null, standby: null, ...over }) as DutyStatus

const req = (over: Partial<Requirement>): Requirement =>
  ({ id: "r", group: "currency", label: "Medical", state: "ok", value: "120d", href: "/currencies", ...over }) as Requirement

describe("the page's one answer", () => {
  it("is the worst verdict, counting what needs a look", () => {
    expect(readiness([{ tone: "go", headline: "" }, { tone: "info", headline: "" }])).toMatchObject({ tone: "go", headline: "Good to go" })
    expect(readiness([{ tone: "go", headline: "" }, { tone: "check", headline: "" }])).toMatchObject({ tone: "check", headline: "1 thing to check" })
    expect(readiness([{ tone: "check", headline: "" }, { tone: "stop", headline: "" }])).toMatchObject({ tone: "stop", headline: "Action needed", flagged: 2 })
    expect(readiness([{ tone: "idle", headline: "" }]).tone).toBe("idle")
  })
})

describe("duty and rest", () => {
  it("says when rest ends, and that it is legal once it has", () => {
    const resting = duty({ rest: { isLegalNow: false, elapsedMinutes: 596, requiredMinutes: 716, legalAtUtc: "2026-11-18T22:00:00Z" } })
    expect(dutyArea(resting, clock)).toMatchObject({ tone: "check", headline: "Resting until 22:00Z" })
    const rested = duty({ rest: { isLegalNow: true, elapsedMinutes: 900, requiredMinutes: 716, legalAtUtc: "2026-11-18T22:00:00Z" } })
    expect(dutyArea(rested, clock)).toMatchObject({ tone: "go", headline: "Rested — legal for duty" })
  })

  it("stops on a next duty that reports inside the rest owed", () => {
    const short = duty({
      rest: { isLegalNow: false, elapsedMinutes: 60, requiredMinutes: 720, legalAtUtc: "2026-11-18T22:00:00Z" },
      next: { legalAtReport: false, restShortfallMinutes: 45 } as DutyStatus["next"],
    })
    expect(dutyArea(short, clock)).toMatchObject({ tone: "stop", headline: "Rest 0:45 short of report" })
  })
})

describe("the aircraft", () => {
  const base = { registration: "9V-NCA", hasLegs: true, loading: false, gate: "", nowMs: NOW, clock }
  it("waits until it is worth asking", () => {
    expect(aircraftArea({ ...base, lookups: null })).toMatchObject({ tone: "info", headline: "9V-NCA" })
    expect(aircraftArea({ ...base, registration: "", lookups: null }).headline).toBe("Aircraft not assigned yet")
  })
  it("is good once on the ground, with the gate beside it", () => {
    const lookups = {
      gates: {},
      inboundRegistration: "9V-NCA",
      inboundFlightId: "a",
      inbound: {
        status: "done",
        checkedAt: NOW,
        whereabouts: { inbound: { status: "landed", arrival: "2026-11-18T19:15:00Z", origin: { iata: "DPS" }, flightNumber: "TR289" } },
      },
    } as never
    expect(aircraftArea({ ...base, gate: "C11", lookups })).toEqual({
      tone: "go",
      headline: "9V-NCA is on the ground",
      detail: "Gate C11 · TR289 from DPS, 45m ago",
    })
  })
})

describe("weather", () => {
  const brief = (station: string, hazards: string[], worst: string | null = "VFR") => ({ station, hazards, worst }) as never
  const code = (icao: string) => icao
  it("names the hazard in words, not the code", () => {
    expect(hazardWords("TEMPO TS")).toBe("Thunderstorms")
    expect(hazardWords("Vis 800m")).toBe("Poor visibility")
    const a = weatherArea({ briefs: [brief("WSSS", []), brief("WIII", ["TEMPO TS", "CB"])], asked: true, failed: false, loading: false, checkedAt: NOW, code })
    expect(a).toMatchObject({ tone: "check", headline: "Thunderstorms at WIII" })
  })
  it("is fine when nothing is forecast", () => {
    const a = weatherArea({ briefs: [brief("WSSS", []), brief("WIII", [])], asked: true, failed: false, loading: false, checkedAt: NOW, code })
    expect(a).toEqual({ tone: "go", headline: "Fine at WSSS and WIII" })
  })
})

describe("crew, destination, currency, limits", () => {
  it("names the captain and when last flown together", () => {
    expect(crewArea([{ personId: "t", name: "Tan Wei Ming", role: "PIC", last: null, count: 0 }], (d) => d)).toEqual({
      tone: "info",
      headline: "Capt Tan Wei Ming",
      detail: "First time flying together",
    })
  })
  it("says how long since the pilot was last there", () => {
    expect(sinceText("2026-10-30", NOW)).toBe("19 days ago")
    expect(destinationArea([{ icao: "WIII", last: { flightId: "x", date: "2026-10-30", flightNumber: "TR274", from: "WSSS" }, year: 3, total: 9 }], () => "Jakarta (CGK)", NOW)).toEqual({
      tone: "info",
      headline: "Jakarta (CGK)",
      detail: "Last there 19 days ago",
    })
  })
  it("leads with the remedy for a lapsed currency", () => {
    const a = currencyArea([req({}), req({ id: "rec", label: "90-Day Recency", state: "fail", value: "0 / 3", action: "3 takeoffs required", urgency: 9 })])
    expect(a).toMatchObject({ tone: "stop", headline: "3 takeoffs required" })
    expect(currencyArea([req({ daysUntil: 120 })])).toMatchObject({ tone: "go", headline: "Medical current" })
  })
  it("has room, or names the limit it is close to", () => {
    expect(limitsArea([req({ group: "limits", label: "Duty 14d", progress: 0.1 })])).toMatchObject({ tone: "go", headline: "Plenty of room" })
    expect(limitsArea([req({ group: "limits", label: "Flight 28d", state: "caution", detail: [{ label: "Remaining", value: "6.5h" }] })])).toEqual({
      tone: "check",
      headline: "Close to the Flight 28d limit",
      detail: "6.5h left",
    })
  })
})
