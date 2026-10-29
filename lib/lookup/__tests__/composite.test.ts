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
