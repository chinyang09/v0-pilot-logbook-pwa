/**
 * The browser's online airport lookup: the shared pool is asked FIRST, so an
 * airport another pilot added never costs an FR24 call; FR24 only on a pool
 * miss; a blank timezone derived from the coordinates (callers store a blank
 * one as "UTC"); and nothing throws.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { deriveTimezone, lookupAirportOnline } from "../online-lookup"

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
    routes["/api/search/airport/batch"] = () => json({ results: { WBGG: KUCHING } })
    const found = await lookupAirportOnline("wbgg")
    expect(found).toEqual({ result: KUCHING, source: "cache" })
    expect(calls).toEqual(["/api/search/airport/batch"])
  })

  it("asks FR24 only when the pool has nothing", async () => {
    routes["/api/search/airport/batch"] = () => json({ results: {} })
    routes["/api/search/airport?"] = () => json({ result: KUCHING, source: "fr24" })
    const found = await lookupAirportOnline("WBGG")
    expect(found?.source).toBe("fr24")
    expect(calls).toEqual(["/api/search/airport/batch", "/api/search/airport?q=WBGG"])
  })

  it("falls through to FR24 when the pool is unreachable", async () => {
    routes["/api/search/airport/batch"] = () => json({ error: "down" }, 500)
    routes["/api/search/airport?"] = () => json({ result: KUCHING, source: "fr24" })
    expect((await lookupAirportOnline("WBGG"))?.result.icao).toBe("WBGG")
  })

  it("derives a timezone FR24 did not carry", async () => {
    routes["/api/search/airport/batch"] = () => json({ results: {} })
    routes["/api/search/airport?"] = () => json({ result: { ...KUCHING, timezone: "" }, source: "fr24" })
    routes["/api/timezone"] = () => json({ tz: "Asia/Kuching" })
    const found = await lookupAirportOnline("WBGG")
    expect(found?.result.timezone).toBe("Asia/Kuching")
    expect(calls[2]).toBe("/api/timezone?lat=1.4847&lng=110.3469")
  })

  it("answers null when nobody has it, and never throws", async () => {
    routes["/api/search/airport/batch"] = () => json({ results: {} })
    routes["/api/search/airport?"] = () => json({ result: null, source: null })
    expect(await lookupAirportOnline("ZZZZ")).toBeNull()
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline") }))
    expect(await lookupAirportOnline("WBGG")).toBeNull()
  })

  it("leaves a zone alone, and never derives one from 0,0", async () => {
    expect(await deriveTimezone(KUCHING)).toBe(KUCHING)
    const blank = { ...KUCHING, timezone: "", latitude: 0, longitude: 0 }
    expect(await deriveTimezone(blank)).toBe(blank)
    expect(calls).toEqual([])
  })
})
