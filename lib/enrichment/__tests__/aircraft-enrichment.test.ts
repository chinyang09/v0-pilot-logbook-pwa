/**
 * Aircraft enrichment's three outcomes. `unavailable` (the lookup could not be
 * made) must never come back as `not_found`: counting challenged lookups as
 * "FR24 does not know this aircraft" is what burnt every pending submission's
 * retries while lookups from Node were being challenged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const handoff = vi.hoisted(() => ({ answer: null as unknown, history: null as unknown, routes: [] as string[] }))
vi.mock("@/lib/lookup/handoff", () => ({
  lookupFromEdge: async (route: string) => {
    handoff.routes.push(route)
    return route === "aircraft/flights" ? handoff.history : handoff.answer
  },
}))
vi.mock("@/lib/icao-types/icao-types-server", () => ({
  getICAOTypeByDesignator: (code: string) => (code === "A21N" ? { description: "L2J", wtc: "M", wtg: "", manufacturerCode: "AIRBUS" } : null),
}))

import { enrichAircraftFromFR24 } from "../aircraft-enrichment"

const hit = (registration: string, typecode = "A21N") => ({
  registration, icao24: "76CDF1", typecode, model: "", serialNumber: "", operator: "TGW", operatorIata: "", operatorIcao: "TGW", owner: "TGW",
})

describe("enrichAircraftFromFR24", () => {
  beforeEach(() => {
    handoff.answer = null
    handoff.history = { ok: false, status: 404, error: "nothing" }
    handoff.routes = []
  })

  it("takes the exact registration over the first hit, and hydrates the type", async () => {
    handoff.answer = { ok: true, status: 200, source: "search", data: [hit("9V-TNA"), hit("9V-TNL")] }
    const result = await enrichAircraftFromFR24("9vtnl")
    expect(result).toMatchObject({ status: "found", data: { registration: "9V-TNL", typecode: "A21N", shortDescription: "L2J" } })
  })

  it("never takes a near miss — the flight history is asked, and without it the aircraft is not found", async () => {
    handoff.answer = { ok: true, status: 200, source: "search", data: [hit("9V-TNA"), hit("9V-TNB")] }
    expect(await enrichAircraftFromFR24("9V-TNL")).toEqual({ status: "not_found" })
    expect(handoff.routes).toEqual(["aircraft", "aircraft/flights"])

    handoff.history = { ok: true, status: 200, source: "flight-list", data: { aircraft: hit("9V-TNL", "A320"), flights: [] } }
    expect(await enrichAircraftFromFR24("9V-TNL")).toMatchObject({ status: "found", data: { registration: "9V-TNL", typecode: "A320" } })

    handoff.history = { ok: false, status: 502, error: "Upstream failed" }
    expect((await enrichAircraftFromFR24("9V-TNL")).status).toBe("unavailable")
  })

  it("is not_found only when a source answered and has no such aircraft", async () => {
    handoff.answer = { ok: false, status: 404, error: "No aircraft found for 9V-ZZZ" }
    expect(await enrichAircraftFromFR24("9V-ZZZ")).toEqual({ status: "not_found" })
  })

  it("is unavailable when the lookup could not be made", async () => {
    for (const status of [502, 401, 503, 0]) {
      handoff.answer = { ok: false, status, error: "Upstream failed: Cloudflare challenge" }
      expect((await enrichAircraftFromFR24("9V-TNL")).status).toBe("unavailable")
    }
  })
})
