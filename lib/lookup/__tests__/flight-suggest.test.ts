/**
 * "Which flight is TR288 on this date": the list's row for that UTC date
 * (`scheduled`, which may fill a blank by itself), or the nearest day's times
 * moved onto it (`usual`, which is only offered) — never another day's
 * aeroplane. The rows are modelled on TR288's real list (30 Oct 2026): a week
 * ahead scheduled with no registration, a week back flown.
 */

import { describe, expect, it } from "vitest"
import type { Fr24Flight } from "@/lib/fr24/types"
import { findOnBoard, normalizeFlightNumber, pickFlightOnDate, suggestFlight } from "../flight-suggest"

const end = (iata: string, icao: string) => ({ iata, icao, name: iata, timezone: "", gate: "", terminal: "", baggage: "" })
const row = (dep: string, arr: string | null, registration = "", over: Partial<Fr24Flight> = {}): Fr24Flight => ({
  fr24Id: null,
  flightNumber: "TR288",
  callsign: "",
  status: "",
  live: false,
  registration,
  typecode: "A20N",
  model: "Airbus A320neo",
  airline: null,
  origin: end("SIN", "WSSS"),
  destination: end("KIX", "RJBB"),
  scheduledDeparture: dep,
  scheduledArrival: arr,
  actualDeparture: null,
  actualArrival: null,
  estimatedDeparture: null,
  estimatedArrival: null,
  durationSeconds: null,
  ...over,
})

const LIST = [
  row("2026-11-06T02:25:00.000Z", "2026-11-06T08:55:00.000Z"),
  row("2026-10-31T02:25:00.000Z", "2026-10-31T08:55:00.000Z"),
  row("2026-10-30T02:25:00.000Z", "2026-10-30T08:55:00.000Z", "9V-TNF"),
  row("2026-10-24T02:15:00.000Z", "2026-10-24T08:40:00.000Z", "9V-OFA"),
]

describe("flight suggestion", () => {
  it("treats TR0288, tr 288 and TR288 as one number", () => {
    expect(normalizeFlightNumber("tr 0288")).toBe("TR288")
    expect(normalizeFlightNumber("3K123A")).toBe("3K123A")
  })

  it("answers that day's row: route, times, and the aeroplane once it is assigned", () => {
    expect(suggestFlight(LIST, "TR288", "2026-10-30")).toMatchObject({
      basis: "scheduled",
      origin: { icao: "WSSS", iata: "SIN" },
      destination: { icao: "RJBB" },
      scheduledDeparture: "2026-10-30T02:25:00.000Z",
      scheduledArrival: "2026-10-30T08:55:00.000Z",
      registration: "9V-TNF",
      typecode: "A20N",
    })
    // A day ahead is scheduled but not yet assigned an aeroplane.
    expect(suggestFlight(LIST, "tr288", "2026-10-31")).toMatchObject({ basis: "scheduled", registration: "" })
  })

  it("past the list, moves the nearest day's times onto the date — and never its aeroplane", () => {
    const usual = suggestFlight(LIST, "TR288", "2026-11-20")
    expect(usual).toMatchObject({
      basis: "usual",
      basedOn: "2026-11-06",
      scheduledDeparture: "2026-11-20T02:25:00.000Z",
      scheduledArrival: "2026-11-20T08:55:00.000Z",
      registration: "",
    })
    // The nearest day to an older date is the oldest one, with ITS times.
    expect(suggestFlight(LIST, "TR288", "2026-10-01")).toMatchObject({ basedOn: "2026-10-24", scheduledDeparture: "2026-10-01T02:15:00.000Z", registration: "" })
  })

  it("is null for a number the list does not have", () => {
    expect(suggestFlight(LIST, "TR600", "2026-10-30")).toBeNull()
    expect(suggestFlight([], "TR288", "2026-10-30")).toBeNull()
  })

  it("picks the nearer of two departures the same day by the OUT asked, else the first", () => {
    const twice = [row("2026-10-30T14:00:00.000Z", null, "9V-TNB"), row("2026-10-30T02:25:00.000Z", null, "9V-TNA")]
    expect(pickFlightOnDate(twice, "TR288", "2026-10-30")?.registration).toBe("9V-TNA")
    expect(pickFlightOnDate(twice, "TR288", "2026-10-30", "13:30")?.registration).toBe("9V-TNB")
  })

  it("finds the flight on a board by number within three hours of its schedule", () => {
    const board = [
      row("2026-10-30T02:25:00.000Z", null, "", { flightNumber: "TR600" }),
      row("2026-10-31T02:25:00.000Z", null, "", { origin: { ...end("SIN", "WSSS"), gate: "D9" } }),
      row("2026-10-30T02:40:00.000Z", null, "", { origin: { ...end("SIN", "WSSS"), gate: "D41" } }),
    ]
    expect(findOnBoard(board, "TR288", "2026-10-30T02:25:00.000Z")?.origin?.gate).toBe("D41")
    expect(findOnBoard(board, "TR288", "2026-11-02T02:25:00.000Z")).toBeNull()
  })
})
