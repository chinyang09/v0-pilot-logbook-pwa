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

  it("carries each end's gate, terminal and baggage belt where the source has them (a board row, the live flight)", () => {
    const flight = w.normalizeFlight({
      identification: { number: { default: "TR288" } },
      airport: {
        origin: { code: { iata: "SIN", icao: "WSSS" }, info: { terminal: "1", gate: "D41", baggage: null } },
        destination: { code: { iata: "KIX", icao: "RJBB" }, info: { terminal: null, gate: null, baggage: null } },
      },
    })
    expect(flight.origin).toMatchObject({ gate: "D41", terminal: "1", baggage: "" })
    expect(flight.destination).toMatchObject({ gate: "", terminal: "", baggage: "" })
    // A flight-list row has no `info` at all.
    expect(w.normalizeFlight({ airport: { origin: { code: { iata: "SIN" } } } }).origin).toMatchObject({ gate: "", terminal: "" })
  })

  it("reads an airline's fleet page by type — the type's count, each airframe's registration and model", () => {
    // The real markup's structure (Scoot, 30 Oct 2026), trimmed to two types.
    const lock = `<td><a target="premium" href="javascript: void(0);" class="hasTooltip premium-content disabled"><svg class="premium-lock"></svg></a></td>`
    const row = (reg: string, model: string) =>
      `<tr><td><a class="regLinks" target="_self" href="/data/aircraft/${reg.toLowerCase()}"> ${reg} </a></td><td> ${model} </td> ${lock}${lock} </tr>`
    const page = `<meta http-equiv="X-UA-Compatible" content="IE=Edge"><dl id="list-aircraft"><dt class="header"><div>TYPE</div><div>NUMBER OF AIRCRAFT</div></dt>
      <dt><div>A20N</div><div>2</div><i class="pull-right fa fa-angle-down"></i></dt><dd><table class="table"><thead><tr><th>Registration</th><th>Aircraft type</th></tr></thead><tbody>
      ${row("9V-TNC", "Airbus A320-271N")} ${row("9V-TNE", "Airbus A320-271N")}</tbody></table></dd>
      <dt><div>B789</div><div>1</div></dt><dd><table><tbody>${row("9V-OFH", "Boeing 787-9 Dreamliner")}</tbody></table></dd></dl>`
    expect(w.parseFleetPage(page)).toEqual([
      { typecode: "A20N", count: 2, aircraft: [{ registration: "9V-TNC", model: "Airbus A320-271N" }, { registration: "9V-TNE", model: "Airbus A320-271N" }] },
      { typecode: "B789", count: 1, aircraft: [{ registration: "9V-OFH", model: "Boeing 787-9 Dreamliner" }] },
    ])
    expect(w.parseFleetPage("<html>no list</html>")).toEqual([])
  })

  it("reads every airport pair off a routes page's arrRoutes, and nothing when it carries none", () => {
    const page = `<script>var dispatcher = {"a":1}; var arrRoutes=[{"airport1":{"country":"Singapore","iata":"SIN","icao":"WSSS","lat":1.35,"lon":103.99,"name":"Singapore Changi Airport"},"airport2":{"country":"Japan","iata":"KIX","icao":"RJBB","lat":34.43,"lon":135.24,"name":"Osaka Kansai"}}];</script>`
    expect(w.parseRoutesPage(page)).toEqual([
      {
        from: { iata: "SIN", icao: "WSSS", name: "Singapore Changi Airport", country: "Singapore", latitude: 1.35, longitude: 103.99 },
        to: { iata: "KIX", icao: "RJBB", name: "Osaka Kansai", country: "Japan", latitude: 34.43, longitude: 135.24 },
      },
    ])
    expect(w.parseRoutesPage("<html></html>")).toBeNull()
  })

  it("flattens a routes-map answer to one row per airport: flight numbers, their days, a departure's UTC time", () => {
    // The real answer's structure (SIN on Scoot, 30 Oct 2026), one airport.
    const melbourne = {
      name: "Melbourne Airport", city: "Melbourne", icao: "YMML", distance: 6031823, position: { lat: "-37.665794", lon: "144.837296" },
      flights: { TR38: { utc: { "2026-10-31": { aircraft: "789", time: "02:55", timestamp: 1793415300, offset: 28800 }, "2026-10-30": { aircraft: "B789", time: "02:55", timestamp: 1793328900, offset: 28800 } } } },
    }
    const answer = w.normalizeAirportRoutes({
      departures: { Australia: { number: { airports: 1, flights: 2 }, airports: { MEL: melbourne } } },
      arrivals: { Australia: { number: { airports: 1, flights: 2 }, airports: { MEL: melbourne } } },
    })
    expect(answer.departures).toEqual([
      {
        iata: "MEL", icao: "YMML", name: "Melbourne Airport", city: "Melbourne", latitude: -37.665794, longitude: 144.837296,
        flights: [{ number: "TR38", days: [
          { date: "2026-10-30", departure: "2026-10-30T02:55:00.000Z", equipment: "B789" },
          { date: "2026-10-31", departure: "2026-10-31T02:55:00.000Z", equipment: "789" },
        ] }],
      },
    ])
    // An arrival's time is not verified against anything, so it carries none.
    expect(answer.arrivals[0].flights[0].days[0]).toEqual({ date: "2026-10-30", equipment: "B789" })
    expect(w.normalizeAirportRoutes(null)).toEqual({ departures: [], arrivals: [] })
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

  it("reads where a page gets its data — endpoints, scripts, embedded JSON, data attributes — never the values", () => {
    const page = `
      <script src="https://www.flightradar24.com/static/js/routes.min.js?v=3"></script>
      <img src="https://cdn.flightradar24.com/assets/logo.png">
      <script>
        var arrRoutes = [{"airport1":{"iata":"SIN","name":"a ] b"},"airport2":{"iata":"PEN"}},{"airport1":{"iata":"SIN"},"airport2":{"iata":"BKK"}}];
        fetch('/data/airlines/tr-tgw/routes?get-airport-arr-dep=' + code)
        var broken = {not: json};
      </script>
      <script type="application/json" id="__NEXT_DATA__">{"props":{"flights":[]}}</script>
      <tr data-row-id="1" data-flight-number="TR288" data-row-id="2"><td>Gate B4</td><td>Terminal 1</td></tr>`
    const a = w.pageAnatomy(page)
    expect(a.scripts).toEqual(["https://www.flightradar24.com/static/js/routes.min.js?v=3"])
    expect(a.endpoints).toEqual(["/data/airlines/tr-tgw/routes?get-airport-arr-dep="])
    expect(a.embedded).toEqual([
      { name: "arrRoutes", chars: expect.any(Number), parses: true, rows: 2, shape: [{ airport1: { iata: "string", name: "string" }, airport2: { iata: "string" } }, "×2"] },
      { name: "broken", chars: 11, parses: false },
      { name: "__NEXT_DATA__", chars: 24, parses: true, rows: undefined, shape: { props: { flights: [] } } },
    ])
    expect(a.dataAttributes).toEqual(["row-id", "flight-number"])
    expect(a.mentions).toEqual({ gate: 1, terminal: 1, baggage: 0 })
    expect(w.balancedLiteral("x = [1, [2], \"]\"] tail", 4)).toBe('[1, [2], "]"]')
    expect(w.balancedLiteral("[1, 2", 0)).toBe("")
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
        "airport departures page",
        "flight number page",
        "airport.json departures (one row's airports)",
        "airline routes from an airport (sample)",
        "live-feed by airline",
        "in use: flight-list by reg (one flight)",
      ])
    )
    // What the flight-list normalizer leaves on the table shows up in its shape.
    expect(explored.body.explore["in use: flight-list by reg (one flight)"].shape.aircraft).toEqual({ images: { large: [] } })
    expect(explored.body.summary.some((line: string) => line.includes("explore: flight-playback"))).toBe(true)
  })

  it("reads an airline's fleet by its IATA code, its ICAO read off the airline list for the page's address", async () => {
    const asked: string[] = []
    upstream = (url) => {
      asked.push(url)
      if (url.includes("airlines.php")) return json({ rows: [{ Name: "Scoot", Code: "TR", ICAO: "TGW" }] })
      return new Response(`<dl id="list-aircraft"><dt><div>A20N</div><div>1</div></dt><dd><table><tr><td><a class="regLinks" href="#"> 9V-TNC </a></td><td> Airbus A320-271N </td></tr></table></dd></dl>`, { headers: { "content-type": "text/html" } })
    }
    const answer = await call("/airline/fleet?iata=tr")
    expect(answer.status).toBe(200)
    expect(answer.body.data).toEqual({
      airline: { name: "Scoot", iata: "TR", icao: "TGW" },
      total: 1,
      types: [{ typecode: "A20N", count: 1, aircraft: [{ registration: "9V-TNC", model: "Airbus A320-271N" }] }],
    })
    expect(asked).toContain("https://www.flightradar24.com/data/airlines/tr-tgw/fleet")
    expect((await call("/airline/fleet")).status).toBe(400)
  })

  it("asks one airport's destinations with the routes map's own query", async () => {
    const asked: string[] = []
    upstream = (url) => {
      asked.push(url)
      return json({ departures: {}, arrivals: {} })
    }
    const answer = await call("/airline/routes/from?iata=TR&icao=TGW&airport=sin")
    // The airline list is kept per isolate, so the name may come from an earlier call.
    expect(answer.body.data).toEqual({ airline: expect.objectContaining({ iata: "TR", icao: "TGW" }), airport: "SIN", departures: [], arrivals: [] })
    expect(asked.at(-1)).toBe("https://www.flightradar24.com/data/airlines/tr-tgw/routes?get-airport-arr-dep=SIN&format=json")
    expect((await call("/airline/routes/from?iata=TR")).status).toBe(400)
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
