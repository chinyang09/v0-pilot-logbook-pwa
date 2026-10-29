/**
 * Aircraft enrichment's three outcomes. `unavailable` (the lookup could not be
 * made) must never come back as `not_found`: counting challenged lookups as
 * "FR24 does not know this aircraft" is what burnt every pending submission's
 * retries while lookups from Node were being challenged.
 */

import { beforeEach, describe, expect, it, vi } from "vitest"

const handoff = vi.hoisted(() => ({ answer: null as unknown, calls: [] as { route: string; params: Record<string, unknown> }[] }))
vi.mock("@/lib/lookup/handoff", () => ({
  lookupFromEdge: async (route: string, params: Record<string, unknown>) => {
    handoff.calls.push({ route, params })
    return handoff.answer
  },
}))
vi.mock("@/lib/icao-types/icao-types-server", () => ({
  getICAOTypeByDesignator: (code: string) => (code === "A21N" ? { description: "L2J", wtc: "M", wtg: "", manufacturerCode: "AIRBUS" } : null),
}))

import { enrichAircraftFromFR24 } from "../aircraft-enrichment"

const candidate = (registration: string, exact: boolean, typecode = "A21N") => ({
  registration, icao24: "76CDF1", typecode, operator: "TGW", source: "fr24", exact,
})

describe("enrichAircraftFromFR24", () => {
  beforeEach(() => {
    handoff.answer = null
    handoff.calls = []
  })

  it("asks the door for that registration only, and hydrates the type", async () => {
    handoff.answer = { ok: true, status: 200, source: "search", data: [candidate("9V-TNL", true)] }
    const result = await enrichAircraftFromFR24("9vtnl")
    expect(result).toMatchObject({ status: "found", data: { registration: "9V-TNL", typecode: "A21N", shortDescription: "L2J" } })
    expect(handoff.calls).toEqual([{ route: "aircraft/candidates", params: { q: "9vtnl", exact: 1 } }])
  })

  it("never takes a near miss, even if one came back", async () => {
    handoff.answer = { ok: true, status: 200, source: "search", data: [candidate("9V-TNA", false)] }
    expect(await enrichAircraftFromFR24("9V-TNL")).toEqual({ status: "not_found" })
    handoff.answer = { ok: true, status: 200, source: "search", data: [candidate("9V-TNA", true)] }
    expect(await enrichAircraftFromFR24("9V-TNL")).toEqual({ status: "not_found" })
  })

  it("is not_found only when every source answered and has no such aircraft", async () => {
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
