/**
 * The routes the door composes (they were `/api/search/aircraft` and
 * `/api/search/airport/candidates`): every aircraft the query could mean, off
 * the Worker's `/search`, each marked `exact`; the registration's flight
 * history asked only when nothing found IS the query and the query could be a
 * whole registration; `exact=1` answering that registration, 404 only when
 * every source answered, 502 when one could not be asked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { isCompositeRoute, runCompositeRoute } from "../composite"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const aircraftHit = (reg: string, equip = "A320") => ({ id: reg, label: reg, detail: { owner: "Scoot", equip, hex: "76CF4C" }, type: "aircraft" })
const liveHit = (reg: string) => ({ id: "3a1b2c", label: `TR600 / ${reg}`, detail: { reg, ac_type: "A21N", operator: "TGW" }, type: "live" })
const airportHit = (label: string) => ({ id: "x", label, detail: { lat: 1, lon: 2 }, type: "airport" })

const flightList = (registration: string) =>
  json({ ok: true, source: "flight-list", data: { aircraft: { registration, icao24: "76CF4D", typecode: "A320", operator: "Scoot" }, flights: [] } })

describe("composite lookup routes", () => {
  const calls: string[] = []
  let search: () => Response
  let history: () => Response

  beforeEach(() => {
    calls.length = 0
    search = () => json({ ok: true, source: "search", data: {} })
    history = () => json({ ok: false, error: "nothing" }, 404)
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        return url.includes("/aircraft/flights") ? history() : search()
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const aircraft = (q: string, extra: Record<string, string> = {}) => runCompositeRoute("aircraft/candidates", { q, ...extra })

  it("knows its own routes and no others", () => {
    expect(isCompositeRoute("aircraft/candidates")).toBe(true)
    expect(isCompositeRoute("airport/candidates")).toBe(true)
    expect(isCompositeRoute("search")).toBe(false)
    expect(isCompositeRoute("toString")).toBe(false)
  })

  describe("aircraft/candidates", () => {
    it("answers every candidate a partial registration could be, live flights included, none exact", async () => {
      search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-OFH", "B788")], live: [liveHit("9V-OFJ"), liveHit("9V-OFH")] } })
      const answer = await aircraft("9VO")
      expect(answer.ok).toBe(true)
      const results = answer.ok ? (answer.data as { registration: string; exact: boolean }[]) : []
      expect(results.map((r) => r.registration)).toEqual(["9V-OFH", "9V-OFJ"])
      expect(results.every((r) => !r.exact)).toBe(true)
      // An airframe hit's type wins over the live flight's.
      expect(results[0]).toMatchObject({ typecode: "B788", operator: "Scoot", icao24: "76CF4C", source: "fr24" })
      // Three characters cannot be a whole registration: no history call.
      expect(calls).toEqual(["https://gw.test/search?q=9VO&limit=30"])
    })

    it("puts the exact registration first and asks nothing more", async () => {
      search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-OFJ"), aircraftHit("9V-OFH")] } })
      const answer = await aircraft("9VOFH")
      expect(answer.ok && answer.data[0]).toMatchObject({ registration: "9V-OFH", exact: true })
      expect(calls).toHaveLength(1)
    })

    it("asks the flight history for a whole registration search does not list", async () => {
      search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-TNK")] } })
      history = () => flightList("9V-TNL")
      const answer = await aircraft("9V-TNL")
      const results = answer.ok ? (answer.data as { registration: string; exact: boolean }[]) : []
      expect(results.map((r) => [r.registration, r.exact])).toEqual([["9V-TNL", true]])
      expect(answer.ok && answer.source).toBe("search+flight-list")
      expect(calls[1]).toBe("https://gw.test/aircraft/flights?reg=9V-TNL&limit=1")
    })

    it("is a 502 when every source failed — not an empty answer read as 'nothing'", async () => {
      search = () => json({ ok: false, error: "Upstream failed: Cloudflare challenge" }, 502)
      history = () => json({ ok: false, error: "Upstream failed" }, 502)
      expect(await aircraft("9V-OFH")).toMatchObject({ ok: false, status: 502 })
    })

    it("keeps the candidates it has when only the history failed", async () => {
      search = () => json({ ok: true, source: "search", data: { live: [liveHit("9V-OFHA")] } })
      history = () => json({ ok: false, error: "Upstream failed" }, 502)
      const answer = await aircraft("9V-OFH")
      expect(answer.ok && answer.data).toHaveLength(1)
      expect(calls).toHaveLength(2)
    })

    it("answers nothing for a query shorter than two characters, without asking", async () => {
      expect(await aircraft("9")).toMatchObject({ ok: true, data: [] })
      expect(calls).toEqual([])
    })

    describe("exact=1", () => {
      it("answers the registration alone, asking the history whatever the length", async () => {
        search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-TNA"), aircraftHit("9V-TNL")] } })
        const answer = await aircraft("9vtnl", { exact: "1" })
        expect(answer.ok && answer.data).toEqual([expect.objectContaining({ registration: "9V-TNL", exact: true })])
        expect(calls).toHaveLength(1)

        calls.length = 0
        search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("4X-ABC")] } })
        history = () => flightList("4X-AB")
        expect((await aircraft("4XAB", { exact: "1" })).ok).toBe(true)
        expect(calls).toHaveLength(2)
      })

      it("is 404 only when every source answered and none has it", async () => {
        search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-TNA")] } })
        expect(await aircraft("9V-TNL", { exact: "1" })).toMatchObject({ ok: false, status: 404 })
        search = () => json({ ok: false, error: "No results" }, 404)
        expect(await aircraft("9V-TNL", { exact: "1" })).toMatchObject({ ok: false, status: 404 })
      })

      it("is 502 when a source could not be asked — never a near miss, never 'not found'", async () => {
        search = () => json({ ok: true, source: "search", data: { aircraft: [aircraftHit("9V-TNA")] } })
        history = () => json({ ok: false, error: "Upstream failed" }, 502)
        expect(await aircraft("9V-TNL", { exact: "1" })).toMatchObject({ ok: false, status: 502 })
        search = () => json({ ok: false, error: "challenge" }, 502)
        history = () => json({ ok: false, error: "nothing" }, 404)
        expect(await aircraft("9V-TNL", { exact: "1" })).toMatchObject({ ok: false, status: 502, error: "challenge" })
      })
    })
  })

  describe("airport/candidates", () => {
    it("reads the codes off the search hits, exact first", async () => {
      search = () =>
        json({
          ok: true,
          source: "search",
          data: { airport: [airportHit("Visakhapatnam Airport (VTZ / VOVZ)"), airportHit("Alluri Sitarama Raju International Airport (VTZ / VOVI)")] },
        })
      const answer = await runCompositeRoute("airport/candidates", { q: "VOV" })
      expect(answer.ok && (answer.data as { icao: string }[]).map((c) => c.icao)).toEqual(["VOVI", "VOVZ"])
      expect(calls).toEqual(["https://gw.test/search?q=VOV&limit=30"])
    })

    it("is empty when search has nothing, and passes a failure through", async () => {
      search = () => json({ ok: false, error: "No results" }, 404)
      expect(await runCompositeRoute("airport/candidates", { q: "QQQ" })).toMatchObject({ ok: true, data: [] })
      search = () => json({ ok: false, error: "Upstream failed" }, 502)
      expect(await runCompositeRoute("airport/candidates", { q: "QQQ" })).toMatchObject({ ok: false, status: 502 })
    })
  })
})

describe("flight/suggest and flight/gates", () => {
  const calls: string[] = []
  let answers: Record<string, () => Response>

  const end = (iata: string, icao: string, info: Record<string, string> = {}) => ({ iata, icao, name: iata, timezone: "", gate: "", terminal: "", baggage: "", ...info })
  const flight = (over: Record<string, unknown> = {}) => ({
    fr24Id: "3c8a1b2f", flightNumber: "TR288", callsign: "", status: "", live: false, registration: "9V-TNF", typecode: "A20N", model: "",
    airline: null, origin: end("SIN", "WSSS"), destination: end("KIX", "RJBB"),
    scheduledDeparture: "2026-10-30T02:25:00.000Z", scheduledArrival: "2026-10-30T08:55:00.000Z",
    actualDeparture: null, actualArrival: null, estimatedDeparture: null, estimatedArrival: null, durationSeconds: null,
    ...over,
  })
  const page = (flights: unknown[]) => json({ ok: true, source: "flight-list", data: { page: 1, totalPages: 1, total: flights.length, flights } })

  beforeEach(() => {
    calls.length = 0
    answers = { flight: () => page([flight()]) }
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input))
        calls.push(`${url.pathname}${url.search}`)
        const route = url.pathname.slice(1) + (url.searchParams.get("mode") ? `:${url.searchParams.get("mode")}` : "")
        return (answers[route] ?? (() => json({ ok: false, error: "nothing" }, 404)))()
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("answers the flight that day from one list call", async () => {
    const answer = await runCompositeRoute("flight/suggest", { number: "tr288", date: "2026-10-30" })
    expect(answer).toMatchObject({ ok: true, data: { basis: "scheduled", registration: "9V-TNF", origin: { icao: "WSSS" } } })
    expect(calls).toEqual(["/flight?number=tr288&limit=100"])
  })

  it("refuses a request without a flight number and a date, and is 404 for a number nobody lists", async () => {
    expect(await runCompositeRoute("flight/suggest", { number: "TR288" })).toMatchObject({ ok: false, status: 400 })
    expect(calls).toEqual([])
    answers.flight = () => json({ ok: false, error: "nothing" }, 404)
    expect(await runCompositeRoute("flight/suggest", { number: "TR999", date: "2026-10-30" })).toMatchObject({ ok: false, status: 404 })
    answers.flight = () => json({ ok: false, error: "challenge" }, 502)
    expect(await runCompositeRoute("flight/suggest", { number: "TR999", date: "2026-10-30" })).toMatchObject({ ok: false, status: 502 })
  })

  it("reads the gates off the departures board at the origin and the arrivals board at the destination", async () => {
    answers["airport/schedule:departures"] = () => page([flight({ origin: end("", "", { gate: "D41", terminal: "1" }) })])
    answers["airport/schedule:arrivals"] = () => page([flight({ destination: end("", "", { gate: "12", terminal: "1", baggage: "5" }) })])
    const answer = await runCompositeRoute("flight/gates", { number: "TR288", date: "2026-10-30" })
    expect(answer).toMatchObject({
      ok: true,
      data: { source: "board", departure: { airport: "SIN", gate: "D41", terminal: "1" }, arrival: { airport: "KIX", gate: "12", baggage: "5" } },
    })
    // Each board from an hour before the scheduled time.
    expect(calls).toContain(`/airport/schedule?code=SIN&mode=departures&limit=100&timestamp=${Date.parse("2026-10-30T02:25:00Z") / 1000 - 3600}`)
  })

  it("asks the tracked flight first when it is live", async () => {
    answers.flight = () => page([flight({ live: true })])
    answers["flight/details"] = () =>
      json({ ok: true, source: "clickhandler", data: flight({ origin: end("SIN", "WSSS", { gate: "D40" }), destination: end("KIX", "RJBB", { gate: "8" }) }) })
    const answer = await runCompositeRoute("flight/gates", { number: "TR288", date: "2026-10-30" })
    expect(answer).toMatchObject({ ok: true, data: { source: "live", departure: { gate: "D40" }, arrival: { gate: "8" } } })
    expect(calls.some((c) => c.startsWith("/airport/schedule"))).toBe(false)
  })

  it("is an answer with no gate when none is published — and a failure when no board could be read", async () => {
    answers["airport/schedule:departures"] = () => page([])
    answers["airport/schedule:arrivals"] = () => page([])
    expect(await runCompositeRoute("flight/gates", { number: "TR288", date: "2026-10-30" })).toMatchObject({
      ok: true,
      data: { source: "none", departure: { gate: "" }, arrival: { gate: "" } },
    })
    answers["airport/schedule:departures"] = () => json({ ok: false, error: "challenge" }, 502)
    answers["airport/schedule:arrivals"] = () => json({ ok: false, error: "challenge" }, 502)
    expect(await runCompositeRoute("flight/gates", { number: "TR288", date: "2026-10-30" })).toMatchObject({ ok: false, status: 502 })
    // A date the list has no flight on.
    expect(await runCompositeRoute("flight/gates", { number: "TR288", date: "2026-12-30" })).toMatchObject({ ok: false, status: 404 })
  })
})
