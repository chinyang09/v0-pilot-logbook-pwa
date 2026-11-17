import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"
import {
  changiRequestBody,
  changiTimeToIso,
  dashRegistration,
  fetchChangiFlights,
  parseChangiFlightPage,
  singaporeDate,
} from "../changi"

// Real pages from Changi's flight enquiry (17 Nov 2026), long option lists
// and scripts trimmed.
const page = (name: string) => readFileSync(path.join(__dirname, "fixtures/changi", name), "utf8")

describe("Changi flight enquiry", () => {
  it("reads a departure: gate, stand, registration and the inbound", () => {
    expect(parseChangiFlightPage(page("tr288-departure-17nov.html"))).toEqual([
      {
        flightNumber: "TR288",
        direction: "departure",
        status: "DP",
        linkedFlight: "TR733",
        scheduled: "2026-11-17T02:25:00.000Z",
        estimated: "2026-11-17T02:25:00.000Z",
        actual: "2026-11-17T02:44:00.000Z",
        terminal: "1",
        otherEnd: "DPS",
        registration: "9V-TNG",
        aircraftType: "A20N",
        gate: "C16",
        stand: "C16",
        belt: "",
      },
    ])
  })

  it("reads an arrival: its belt and the departure it turns into", () => {
    const [f] = parseChangiFlightPage(page("tr289-arrival-17nov.html"))
    expect(f).toMatchObject({
      flightNumber: "TR289",
      direction: "arrival",
      status: "LD",
      linkedFlight: "TR134",
      otherEnd: "DPS",
      registration: "9V-TNG",
      gate: "C1",
      stand: "C1",
      belt: "13",
      actual: "2026-11-17T09:44:00.000Z",
    })
  })

  it("reads a flight not yet assigned — blank is blank, never the next label", () => {
    const [f] = parseChangiFlightPage(page("tr288-scheduled-19nov.html"))
    expect(f).toMatchObject({
      flightNumber: "TR288",
      direction: "departure",
      status: "",
      linkedFlight: "",
      registration: "",
      aircraftType: "A21N",
      gate: "",
      stand: "",
      actual: null,
      scheduled: "2026-11-19T02:25:00.000Z",
    })
  })

  it("finds nothing on 'No Flight Record Found.'", () => {
    expect(parseChangiFlightPage(page("no-record.html"))).toEqual([])
  })

  it("asks by the Singapore date, in the page's own form fields", () => {
    expect(singaporeDate(Date.parse("2026-11-17T17:30:00Z"))).toBe("2026-11-18")
    expect(Object.fromEntries(new URLSearchParams(changiRequestBody("tr0288", "2026-11-07")))).toEqual({
      action: "submit",
      option: "SearchFlight",
      flightNo1: "TR",
      flightNo2: "288",
      flightDate1: "07",
      flightDate2: "Nov",
      flightDate3: "2026",
    })
  })

  it("converts its local times and Singapore marks", () => {
    expect(changiTimeToIso("1 Jan 2027 / 07:05")).toBe("2026-12-31T23:05:00.000Z")
    expect(changiTimeToIso("")).toBeNull()
    expect(dashRegistration("9VTNG")).toBe("9V-TNG")
    expect(dashRegistration("B-LAA")).toBe("B-LAA")
  })

  it("rejects a page that is not the enquiry, rather than reading it as no record", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>Access denied</html>", { status: 200 }))
    await expect(fetchChangiFlights("TR288", "2026-11-17", 1000, fetchImpl as unknown as typeof fetch)).rejects.toThrow()
    const ok = vi.fn(async () => new Response(page("tr288-departure-17nov.html"), { status: 200 }))
    expect(await fetchChangiFlights("TR288", "2026-11-17", 1000, ok as unknown as typeof fetch)).toHaveLength(1)
  })
})
