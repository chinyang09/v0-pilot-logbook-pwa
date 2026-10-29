/**
 * The airport enrichment chain and codes that have MOVED between airports:
 * a moved code is resolved through each airport it has meant (so a caller can
 * pick by date), and a code answered locally is checked against the shared
 * pool, which is how a move nobody has dated yet shows up.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Airport } from "@/types/entities/airport.types"

const local: Record<string, Partial<Airport>> = {}

vi.mock("@/lib/db/stores/reference/airports.store", () => ({
  getAirportByIcao: vi.fn(async (icao: string) => local[icao.toUpperCase()]),
  getAirportByIata: vi.fn(async (iata: string) =>
    Object.values(local).find((a) => a.iata === iata.toUpperCase())
  ),
  addCustomAirport: vi.fn(async (a: Partial<Airport>) => ({ ...a, isCustom: true })),
}))
vi.mock("@/lib/submissions/submit", () => ({ submitAirportToServer: vi.fn() }))
vi.mock("@/lib/airports/online-lookup", () => ({ lookupAirportLive: vi.fn(async () => null) }))

import { enrichAirportBatch } from "../airport-enricher"

function airport(icao: string, iata: string): Partial<Airport> {
  return { icao, iata, name: icao, tz: "Asia/Kolkata", latitude: 1, longitude: 1 }
}

let poolAnswer: Record<string, unknown> = {}
let poolAsked: string[][] = []

beforeEach(() => {
  for (const k of Object.keys(local)) delete local[k]
  poolAnswer = {}
  poolAsked = []
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: { body?: string }) => {
      if (url === "/api/lookup/pool/airport") {
        poolAsked.push((JSON.parse(init?.body || "{}") as { codes: string[] }).codes)
        return new Response(JSON.stringify({ results: poolAnswer }), { status: 200 })
      }
      return new Response(JSON.stringify({ result: null }), { status: 404 })
    })
  )
})

afterEach(() => vi.unstubAllGlobals())

describe("a moved code (VTZ: VOVZ → VOVI)", () => {
  it("resolves each airport the code has meant, and the code itself as today's", async () => {
    local.VOVZ = airport("VOVZ", "VTZ")
    local.VOVI = airport("VOVI", "VTZ")
    const result = await enrichAirportBatch(["VTZ"])
    expect(result.enriched.get("VOVZ")?.icao).toBe("VOVZ")
    expect(result.enriched.get("VOVI")?.icao).toBe("VOVI")
    expect(result.enriched.get("VTZ")?.icao).toBe("VOVI")
    expect(result.failedCodes).toEqual([])
  })

  it("never asks the network for the code alone — its answer is the question the date settles", async () => {
    local.VOVZ = airport("VOVZ", "VTZ")
    await enrichAirportBatch(["VTZ"])
    expect(poolAsked.flat()).not.toContain("VTZ")
    expect(poolAsked.flat()).toContain("VOVI")
  })
})

describe("the pool check", () => {
  it("reports a locally answered code the pool resolves to another airport", async () => {
    local.WSSS = airport("WSSS", "SIN")
    poolAnswer = { SIN: { ...airport("WSSX", "SIN"), timezone: "Asia/Singapore", elevation: 0, city: "", country: "" } }
    const result = await enrichAirportBatch(["SIN"])
    expect(result.codeConflicts).toEqual([{ code: "SIN", localIcao: "WSSS", poolIcao: "WSSX" }])
    // Reported, never applied.
    expect(result.enriched.get("SIN")?.icao).toBe("WSSS")
  })

  it("is quiet when they agree, and for a code it has dated already", async () => {
    local.WSSS = airport("WSSS", "SIN")
    local.VOVZ = airport("VOVZ", "VTZ")
    local.VOVI = airport("VOVI", "VTZ")
    poolAnswer = { SIN: airport("WSSS", "SIN") }
    const result = await enrichAirportBatch(["SIN", "VTZ"])
    expect(result.codeConflicts).toEqual([])
  })
})
