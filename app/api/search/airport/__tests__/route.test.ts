/**
 * /api/search/airport against the FR24 gateway Worker: the Worker's chain is
 * asked first, a zone the source did not carry is derived from the
 * coordinates (the client stores a blank one as UTC), and a Worker deployment
 * that predates `/airport` falls back to the legacy traffic-stats passthrough.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/mongodb", () => ({
  getMongoClient: async () => {
    throw new Error("no database in tests")
  },
}))

import { GET } from "../route"

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const SELETAR = {
  icao: "WSSL",
  iata: "XSP",
  name: "Seletar",
  city: "",
  country: "Singapore",
  countryCode: "",
  latitude: 1.417,
  longitude: 103.868,
  elevation: 36,
  timezone: "",
  timezoneOffsetSeconds: null,
}

describe("GET /api/search/airport via the Worker", () => {
  const calls: string[] = []
  let answer: (url: string) => Response

  beforeEach(() => {
    calls.length = 0
    vi.stubEnv("FR24_PROXY_URL", "https://gw.test/")
    vi.stubEnv("FR24_PROXY_SECRET", "s")
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        calls.push(url)
        return answer(url)
      })
    )
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  const get = async (q: string) => (await GET(new Request(`https://app.test/api/search/airport?q=${q}`))).json()

  it("derives the timezone from the coordinates when the source had none", async () => {
    answer = () => json({ ok: true, source: "airport-list", data: SELETAR })
    const body = await get("WSSL")
    expect(calls[0]).toBe("https://gw.test/airport?code=WSSL")
    expect(body.result).toMatchObject({ icao: "WSSL", timezone: "Asia/Singapore" })
    expect(body.result).not.toHaveProperty("timezoneOffsetSeconds")
  })

  it("answers no result when the Worker found nothing, without trying the legacy path", async () => {
    answer = () => json({ ok: false, error: "No airport found for ZZZZ" }, 404)
    const body = await get("ZZZZ")
    expect(body.result).toBeNull()
    expect(calls).toHaveLength(1)
  })

  it("falls back to traffic-stats on a Worker that predates /airport", async () => {
    answer = (url) =>
      url.includes("/airport?")
        ? json({ error: "Path not allowed", path: "/airport" }, 400)
        : json({
            details: {
              name: "Singapore Changi Airport",
              code: { iata: "SIN", icao: "WSSS" },
              position: { latitude: 1.35, longitude: 103.99, altitude: 22, country: { name: "Singapore", code: "SG" }, region: { city: "Singapore" } },
              timezone: { name: "Asia/Singapore" },
            },
          })
    const body = await get("WSSS")
    expect(calls[1]).toBe("https://gw.test/airports/traffic-stats/?airport=WSSS")
    expect(body.result).toMatchObject({ icao: "WSSS", timezone: "Asia/Singapore", elevation: 22 })
  })
})
