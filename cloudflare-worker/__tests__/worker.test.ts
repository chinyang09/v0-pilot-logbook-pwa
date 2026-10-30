/**
 * The FR24 gateway Worker: its normalizers (FR24 shapes in, the app's out) and
 * its lookup chains, run against stand-in upstreams. FR24 cannot be reached
 * from a test, and from most servers at all — that is why the Worker exists —
 * so what is pinned here is what the Worker DOES with each answer; `/probe` on
 * the deployed Worker is what says which upstreams answer.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
// @ts-expect-error — plain JS module with JSDoc types, outside the app's tsconfig
import worker, * as w from "../worker.js"

const challenge = () =>
  new Response("<!DOCTYPE html><html><head><title>Just a moment...</title></head></html>", {
    status: 403,
    headers: { "content-type": "text/html; charset=UTF-8" },
  })
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })

const CHANGI_DETAILS = {
  name: "Singapore Changi Airport",
  code: { iata: "SIN", icao: "WSSS" },
  position: {
    latitude: 1.35019,
    longitude: 103.994003,
    elevation: 22,
    country: { name: "Singapore", code: "SG", id: 197 },
    region: { city: "Singapore" },
  },
  timezone: { name: "Asia/Singapore", offset: 28800, abbr: "+08", isDst: false },
}

describe("normalizers", () => {
  it("reads airport.json details and traffic-stats details alike (elevation vs altitude)", () => {
    const fromApi = w.normalizeAirportDetails(CHANGI_DETAILS)
    expect(fromApi).toEqual({
      icao: "WSSS",
      iata: "SIN",
      name: "Singapore Changi Airport",
      city: "Singapore",
      country: "Singapore",
      countryCode: "SG",
      latitude: 1.35019,
      longitude: 103.994003,
      elevation: 22,
      timezone: "Asia/Singapore",
      timezoneOffsetSeconds: 28800,
    })
    const { elevation, ...rest } = CHANGI_DETAILS.position
    const fromTraffic = w.normalizeAirportDetails({ ...CHANGI_DETAILS, position: { ...rest, altitude: elevation } })
    expect(fromTraffic).toEqual(fromApi)
  })

  it("refuses an airport with no code or no position, rather than placing it at 0,0", () => {
    expect(w.normalizeAirportDetails({ ...CHANGI_DETAILS, code: {} })).toBeNull()
    expect(w.normalizeAirportDetails({ ...CHANGI_DETAILS, position: { latitude: 1.3 } })).toBeNull()
    expect(w.normalizeAirportRow({ name: "X", icao: "XXXX", lat: "", lon: 5 })).toBeNull()
    expect(w.normalizeAirportDetails(null)).toBeNull()
  })

  it("reads an airports.php row with a BLANK timezone, never UTC", () => {
    const row = w.normalizeAirportRow({ name: "Changi", iata: "SIN", icao: "WSSS", lat: 1.35, lon: 103.99, country: "Singapore", alt: 22 })
    expect(row?.timezone).toBe("")
    expect(row?.elevation).toBe(22)
  })

  it("finds a list row by ICAO for four characters and by IATA for three", () => {
    const rows = [
      w.normalizeAirportRow({ name: "Changi", iata: "SIN", icao: "WSSS", lat: 1, lon: 1 }),
      w.normalizeAirportRow({ name: "Seletar", iata: "XSP", icao: "WSSL", lat: 1, lon: 1 }),
    ]
    expect(w.findAirportRow(rows, "wssl")?.name).toBe("Seletar")
    expect(w.findAirportRow(rows, "SIN")?.name).toBe("Changi")
    expect(w.findAirportRow(rows, "KJFK")).toBeNull()
  })

  it("takes an airport's codes out of a search hit's label", () => {
    const hit = { id: "SIN", label: "Singapore Changi Airport (SIN / WSSS)", detail: { lat: 1.35, lon: 103.99 }, type: "airport" }
    expect(w.airportFromSearchHit(hit)).toMatchObject({ icao: "WSSS", iata: "SIN", name: "Singapore Changi Airport", timezone: "" })
  })

  it("maps an aircraft search hit the way the app always has (owner → operator)", () => {
    const hit = { id: "9V-TNL", label: "9V-TNL", detail: { owner: "Scoot", equip: "a320", hex: "76cf4c" }, type: "aircraft" }
    expect(w.normalizeAircraftHit(hit)).toMatchObject({ registration: "9V-TNL", icao24: "76CF4C", typecode: "A320", operator: "Scoot" })
    expect(w.normalizeAircraftHit({ ...hit, type: "airport" })).toBeNull()
  })

  it("reads a flight list's aircraftInfo", () => {
    const info = {
      model: { code: "A21N", text: "Airbus A321-271NX" },
      registration: "9V-NCA",
      hex: "76b86d",
      serialNo: "10123",
      airline: { name: "Scoot", code: { iata: "TR", icao: "TGW" } },
      owner: { name: "Singapore Airlines" },
    }
    expect(w.normalizeAircraftInfo(info)).toEqual({
      registration: "9V-NCA",
      icao24: "76B86D",
      typecode: "A21N",
      model: "Airbus A321-271NX",
      serialNumber: "10123",
      operator: "Scoot",
      operatorIata: "TR",
      operatorIcao: "TGW",
      owner: "Singapore Airlines",
    })
    expect(w.normalizeAircraftInfo({ registration: "9V-NCA" })).toBeNull()
  })

  it("reads one flight, with epoch seconds as ISO UTC and 0 as unknown", () => {
    const flight = w.normalizeFlight({
      identification: { id: "3c8a1b2f", number: { default: "TR600" }, callsign: "TGW600" },
      status: { text: "Landed 14:05", live: false },
      aircraft: { model: { code: "A21N", text: "Airbus A321neo" }, registration: "9v-nca" },
      airline: { name: "Scoot", code: { iata: "TR", icao: "TGW" } },
      airport: {
        origin: { name: "Singapore Changi", code: { iata: "SIN", icao: "WSSS" }, timezone: { name: "Asia/Singapore" } },
        destination: { name: "Bangkok Suvarnabhumi", code: { iata: "BKK", icao: "VTBS" }, timezone: { name: "Asia/Bangkok" } },
      },
      time: { scheduled: { departure: 1793260800, arrival: 1793269800 }, real: { departure: 1793261400, arrival: 0 } },
    })
    expect(flight).toMatchObject({
      fr24Id: "3c8a1b2f",
      flightNumber: "TR600",
      registration: "9V-NCA",
      origin: { icao: "WSSS", iata: "SIN" },
      destination: { icao: "VTBS", timezone: "Asia/Bangkok" },
      scheduledDeparture: "2026-10-29T08:00:00.000Z",
      actualDeparture: "2026-10-29T08:10:00.000Z",
      actualArrival: null,
    })
  })

  it("reads the live feed's positional rows and skips its bookkeeping keys", () => {
    // A real row, as data-cloud's feed.js returned it.
    const feed = {
      full_count: 15914,
      version: 4,
      stats: { total: {} },
      "42573dfa": ["76B86D", 1.2721, 104.073, 193, 7100, 249, "", "F-BDWY1", "A21N", "9V-NCM", 1793271015, "SWA", "SIN", "TR129", 0, -128, "TGW129", 0, "TGW"],
    }
    expect(w.parseFeed(feed)).toEqual([
      {
        id: "42573dfa",
        icao24: "76B86D",
        latitude: 1.2721,
        longitude: 104.073,
        heading: 193,
        altitude: 7100,
        groundSpeed: 249,
        squawk: "",
        typecode: "A21N",
        registration: "9V-NCM",
        time: "2026-10-29T10:50:15.000Z",
        originIata: "SWA",
        destinationIata: "SIN",
        flightNumber: "TR129",
        onGround: false,
        verticalSpeed: -128,
        callsign: "TGW129",
        airlineIcao: "TGW",
      },
    ])
    expect(w.parseFeed(null)).toEqual([])
  })

  it("splits search results by stats.count, in order", () => {
    const grouped = w.groupSearch({
      results: [{ id: "a" }, { id: "b" }, { id: "c" }],
      stats: { count: { airport: 1, aircraft: 2 } },
    })
    expect(grouped).toEqual({ airport: [{ id: "a" }], aircraft: [{ id: "b" }, { id: "c" }] })
  })

  it("shapes a payload for the probe's explore mode — keys and types, never the values", () => {
    expect(w.shapeOf({ a: 1, b: "x", c: [{ d: true }, { d: false }], e: null, f: [] })).toEqual({
      a: "number",
      b: "string",
      c: [{ d: "boolean" }, "×2"],
      e: null,
      f: [],
    })
    expect(w.shapeOf({ a: { b: { c: { d: 1 } } } }, 2)).toEqual({ a: { b: "object" } })
    const wide = Object.fromEntries(Array.from({ length: 45 }, (_, i) => [`k${i}`, i]))
    expect((w.shapeOf(wide) as Record<string, unknown>)["…"]).toBe("5 more keys")
  })

  it("counts registration-like tokens in a page, once each", () => {
    expect(w.registrationTokens("<td>9V-OFH</td><td>A21N</td><td>9V-OFH</td><td>B-LRA</td> TR600 2026-10-30")).toEqual([
      "9V-OFH",
      "B-LRA",
    ])
    expect(w.registrationTokens("")).toEqual([])
  })

  it("reads an airlines.php row", () => {
    expect(w.normalizeAirline({ Name: "Scoot", Code: "TR", ICAO: "TGW" })).toEqual({ name: "Scoot", iata: "TR", icao: "TGW" })
    expect(w.normalizeAirline({ Name: "", Code: "TR" })).toBeNull()
  })
})

describe("routes", () => {
  type Upstream = (url: string) => Response
  let upstream: Upstream
  const store = new Map<string, Response>()

  beforeEach(() => {
    store.clear()
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => upstream(String(input))))
    vi.stubGlobal("caches", {
      default: {
        match: async (key: Request) => store.get(key.url)?.clone(),
        put: async (key: Request, res: Response) => void store.set(key.url, res),
      },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  const call = async (path: string, env: { PROXY_SECRET?: string } = {}, headers: Record<string, string> = {}) => {
    const pending: Promise<unknown>[] = []
    const res: Response = await worker.fetch(new Request(`https://gw.test${path}`, { headers }), env, {
      waitUntil: (p: Promise<unknown>) => void pending.push(p),
    })
    await Promise.all(pending)
    return { status: res.status, cache: res.headers.get("x-cache"), body: await res.json() }
  }

  it("probes the in-use sources, and the candidates only with explore=1", async () => {
    upstream = (url) =>
      url.includes("flight/list.json") && url.includes("fetchBy=reg")
        ? json({ result: { response: { data: [{ identification: { id: "3a1b" }, time: { real: { departure: 1700000000 } }, aircraft: { images: { large: [] } } }] } } })
        : json({ result: { response: {} } })
    const plain = await call("/probe")
    expect(plain.body.explore).toBeUndefined()
    expect(plain.body.summary.some((line: string) => line.includes("explore:"))).toBe(false)

    const explored = await call("/probe?explore=1")
    expect(Object.keys(explored.body.explore)).toEqual(
      expect.arrayContaining([
        "api search.json",
        "airport.json every plugin",
        "flight-playback",
        "www api/v1 airport (sniffed)",
        "airline fleet page",
        "live-feed by airline",
        "in use: flight-list by reg (one flight)",
      ])
    )
    // What the flight-list normalizer leaves on the table shows up in its shape.
    expect(explored.body.explore["in use: flight-list by reg (one flight)"].shape.aircraft).toEqual({ images: { large: [] } })
    expect(explored.body.summary.some((line: string) => line.includes("explore: flight-playback"))).toBe(true)
  })

  it("refuses a request without the secret, but answers /health", async () => {
    upstream = () => challenge()
    expect((await call("/airport?code=WSSS", { PROXY_SECRET: "s" })).status).toBe(401)
    expect((await call("/airport?code=WSSS", { PROXY_SECRET: "s" }, { "x-proxy-secret": "x" })).status).toBe(401)
    expect((await call("/health", { PROXY_SECRET: "s" })).status).toBe(200)
  })

  it("answers an airport from airport.json when traffic-stats is challenged", async () => {
    upstream = (url) =>
      url.includes("airport.json")
        ? json({ result: { response: { airport: { pluginData: { details: CHANGI_DETAILS } } } } })
        : challenge()
    const { status, body } = await call("/airport?code=WSSS")
    expect(status).toBe(200)
    expect(body.source).toBe("airport.json")
    expect(body.data.timezone).toBe("Asia/Singapore")
  })

  it("falls through to the airport list when both detailed sources are challenged", async () => {
    upstream = (url) =>
      url.includes("airports.php")
        ? json({ rows: [{ name: "Seletar", iata: "XSP", icao: "WSSL", lat: 1.417, lon: 103.868, country: "Singapore", alt: 36 }] })
        : challenge()
    // (The list is then held per isolate — which is why the other tests here
    // ask for airports it does not contain.)
    const { status, body } = await call("/airport?code=XSP")
    expect(status).toBe(200)
    expect(body.source).toBe("airport-list")
    expect(body.data).toMatchObject({ icao: "WSSL", timezone: "" })
  })

  it("says 502 when every source failed and 404 only when one answered", async () => {
    upstream = () => challenge()
    const down = await call("/airport?code=ZZZZ")
    expect(down.status).toBe(502)
    expect(down.body.attempts.every((a: { challenged: boolean }) => a.challenged)).toBe(true)

    upstream = (url) => (url.includes("search") ? json({ results: [] }) : challenge())
    expect((await call("/airport?code=ZZZY")).status).toBe(404)
  })

  it("does not read another airport's details as the one asked for", async () => {
    upstream = (url) =>
      url.includes("traffic-stats")
        ? json({ details: CHANGI_DETAILS })
        : url.includes("search")
          ? json({ results: [] })
          : challenge()
    expect((await call("/airport?code=WMKK")).status).toBe(404)
  })

  it("caches a found answer and never a failure", async () => {
    upstream = () => challenge()
    await call("/airport?code=WSSS")
    expect(store.size).toBe(0)

    upstream = (url) =>
      url.includes("airport.json")
        ? json({ result: { response: { airport: { pluginData: { details: CHANGI_DETAILS } } } } })
        : challenge()
    expect((await call("/airport?code=WSSS")).cache).toBe("MISS")
    upstream = () => challenge()
    const again = await call("/airport?code=WSSS")
    expect(again.status).toBe(200)
    expect(again.cache).toBe("HIT")
  })

  it("finds an aircraft in its flight history when search misses it", async () => {
    upstream = (url) =>
      url.includes("search")
        ? json({ results: [] })
        : url.includes("flight/list.json")
          ? json({ result: { response: { aircraftInfo: { model: { code: "A320", text: "Airbus A320" }, registration: "9V-TNL" }, data: [] } } })
          : challenge()
    const { status, body } = await call("/aircraft?reg=9v-tnl")
    expect(status).toBe(200)
    expect(body.source).toBe("flight-list")
    expect(body.data[0]).toMatchObject({ registration: "9V-TNL", typecode: "A320" })
  })

  it("keeps the legacy passthroughs verbatim, for an app build that predates the routes", async () => {
    upstream = (url) => (url.includes("/v1/search/web/find?query=9V-TNL") ? json({ results: [{ id: "9V-TNL" }] }) : challenge())
    const search = await call("/v1/search/web/find?query=9V-TNL&limit=10")
    expect(search.status).toBe(200)
    expect(search.body).toEqual({ results: [{ id: "9V-TNL" }] })
    const traffic = await call("/airports/traffic-stats/?airport=WSSS")
    expect(traffic.status).toBe(502)
    expect(traffic.body.error).toBe("Upstream non-JSON or non-OK")
  })

  it("keeps /raw to FR24 hosts, and off entirely without a secret", async () => {
    upstream = () => json({ ok: 1 })
    expect((await call("/raw?url=https://api.flightradar24.com/common/v1/x")).status).toBe(403)
    const env = { PROXY_SECRET: "s" }
    const h = { "x-proxy-secret": "s" }
    expect((await call("/raw?url=https://example.com/x", env, h)).status).toBe(400)
    expect((await call("/raw?url=https://api.flightradar24.com/common/v1/x", env, h)).status).toBe(200)
  })
})
