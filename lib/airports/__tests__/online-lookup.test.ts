/**
 * The browser's online airport lookup: the shared pool is asked FIRST, so an
 * airport another pilot added never costs a gateway call; the gateway's
 * `/api/lookup/airport` only on a pool miss, its offset dropped; a blank
 * timezone derived from the coordinates (callers store a blank one as "UTC");
 * and nothing throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deriveTimezone, lookupAirportLive, lookupAirportOnline } from "../online-lookup"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const KUCHING = {
  icao: "WBGG",
  iata: "KCH",
  name: "Kuching International Airport",
  city: "Kuching",
  country: "Malaysia",
  countryCode: "MY",
  latitude: 1.4847,
  longitude: 110.3469,
  elevation: 89,
  timezone: "Asia/Kuching",
}

const POOL = "/api/lookup/pool/airport"
const GATEWAY = "/api/lookup/airport?"
const gateway = (airport: unknown) => json({ ok: true, source: "airport-json", data: airport })

describe("lookupAirportOnline", () => {
  const calls: string[] = []
  let routes: Record<string, () => Response>

  beforeEach(() => {
    calls.length = 0
    routes = {}
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        const route = Object.keys(routes).find((prefix) => url.startsWith(prefix))
        return route ? routes[route]() : json({}, 404)
      })
    )
  })
  afterEach(() => vi.unstubAllGlobals())

  it("answers from the shared pool without asking FR24", async () => {
    routes[POOL] = () => json({ results: { WBGG: KUCHING } })
    const found = await lookupAirportOnline("wbgg")
    expect(found).toEqual({ result: KUCHING, source: "cache" })
    expect(calls).toEqual([POOL])
  })

  it("asks FR24 only when the pool has nothing", async () => {
    routes[POOL] = () => json({ results: {} })
    routes[GATEWAY] = () => gateway({ ...KUCHING, timezoneOffsetSeconds: 28800 })
    const found = await lookupAirportOnline("WBGG")
    expect(found).toEqual({ result: KUCHING, source: "fr24" })
    expect(calls).toEqual([POOL, "/api/lookup/airport?code=WBGG"])
  })

  it("falls through to FR24 when the pool is unreachable", async () => {
    routes[POOL] = () => json({ error: "down" }, 500)
    routes[GATEWAY] = () => gateway({ ...KUCHING, timezoneOffsetSeconds: 28800 })
    expect((await lookupAirportOnline("WBGG"))?.result.icao).toBe("WBGG")
  })

  it("derives a timezone FR24 did not carry", async () => {
    routes[POOL] = () => json({ results: {} })
    routes[GATEWAY] = () => gateway({ ...KUCHING, timezone: "", timezoneOffsetSeconds: null })
    routes["/api/timezone"] = () => json({ tz: "Asia/Kuching" })
    const found = await lookupAirportOnline("WBGG")
    expect(found?.result.timezone).toBe("Asia/Kuching")
    expect(calls[2]).toBe("/api/timezone?lat=1.4847&lng=110.3469")
  })

  it("answers null when nobody has it, and never throws", async () => {
    routes[POOL] = () => json({ results: {} })
    routes[GATEWAY] = () => json({ ok: false, error: "No airport found for ZZZZ" }, 404)
    expect(await lookupAirportOnline("ZZZZ")).toBeNull()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    expect(await lookupAirportOnline("WBGG")).toBeNull()
  })

  it("asks the gateway alone for a caller that has asked the pool already", async () => {
    routes[GATEWAY] = () => gateway({ ...KUCHING, timezoneOffsetSeconds: 28800 })
    expect(await lookupAirportLive(" wbgg ")).toEqual(KUCHING)
    expect(calls).toEqual(["/api/lookup/airport?code=WBGG"])
    routes[GATEWAY] = () => json({ ok: false, error: "Upstream failed" }, 502)
    expect(await lookupAirportLive("WBGG")).toBeNull()
  })

  it("leaves a zone alone, and never derives one from 0,0", async () => {
    expect(await deriveTimezone(KUCHING)).toBe(KUCHING)
    const blank = { ...KUCHING, timezone: "", latitude: 0, longitude: 0 }
    expect(await deriveTimezone(blank)).toBe(blank)
    expect(calls).toEqual([])
  })
})
