// @ts-check
/**
 * OOOI FR24 gateway — Cloudflare Worker (plain JS, dashboard-friendly).
 *
 * Every FlightRadar24 endpoint the app uses, behind one Worker, answered in
 * the APP's shapes rather than FR24's. Worker fetch runs on Cloudflare's
 * network with a different TLS fingerprint from Node / Vercel Edge, which is
 * what gets it past the bot challenge that 403s a direct server fetch.
 *
 * Endpoint map (FR24 hosts, from JeanExtreme002/FlightRadarAPI plus the
 * common/v1 flight lists):
 *
 *   www.flightradar24.com
 *     /v1/search/web/find          search (aircraft, airports, airlines, live)
 *     /airports/traffic-stats/     one airport's details
 *     /_json/airports.php          every airport, one payload
 *     /_json/airlines.php          every airline, one payload
 *     /webapi/v1/airport-disruptions, /flights/most-tracked, /js/zones.js.php
 *   api.flightradar24.com/common/v1
 *     /airport.json                details, schedule, runways, weather (plugins)
 *     /flight/list.json            flight history by registration or number
 *   data-cloud.flightradar24.com
 *     /zones/fcgi/feed.js          live positions (filter by reg/airline/type/bounds)
 *   data-live.flightradar24.com
 *     /clickhandler/?flight=<id>   one live flight's full details + trail
 *
 * FR24 changes what it challenges without notice, so every lookup the app
 * depends on is a CHAIN of independent sources, and `GET /probe` reports which
 * of them answer from Cloudflare right now — run it after deploying, and
 * whenever a lookup stops working.
 *
 * Routes (all GET; JSON unless noted). Normalized routes answer
 *   { ok: true,  data, source }            200
 *   { ok: false, error }                   404 nothing found / 400 bad input
 *   { ok: false, error, attempts }         502 every source failed
 * and add `attempts` to any answer when called with `debug=1`.
 *
 *   /                      route index
 *   /health                liveness, touches nothing upstream
 *   /probe                 every upstream, once, from this Worker
 *   /probe?explore=1       … plus CANDIDATE sources no route uses yet, with the
 *                          shape of what each answers (what the app could add)
 *   /aircraft?reg=         aircraft by registration  (search → flight list → live feed)
 *   /aircraft/flights?reg=&page=&limit=   flight history for a registration
 *   /airport?code=         airport by ICAO or IATA   (airport.json + traffic-stats → airport list + search)
 *   /airport/details?code= airport details + runways + weather
 *   /airport/schedule?code=&mode=arrivals|departures&page=&limit=&timestamp=
 *   /airports              every airport  (cached a day)
 *   /airlines              every airline  (cached a day)
 *   /search?q=&limit=      FR24 search, grouped by kind
 *   /flight?number=&page=&limit=   flight history for a flight number
 *   /flight/details?id=    one live flight (FR24 flight id, from /live)
 *   /live?reg=|airline=|type=|bounds=   live positions
 *   /raw?url=              verbatim passthrough to an FR24 host (needs PROXY_SECRET)
 *
 *   /v1/search/web/find, /airports/traffic-stats/   LEGACY verbatim passthroughs,
 *   kept so an app deployment that predates the routes above keeps working.
 *
 * Env:
 *   PROXY_SECRET — if set, every request but /health must carry
 *   `x-proxy-secret: <value>`. Set the same value in Vercel as FR24_PROXY_SECRET.
 *
 * The normalizers are named exports so the app's Vitest suite can pin them
 * (cloudflare-worker/__tests__/). A Worker module may export more than its
 * default handler.
 */

const WWW = "https://www.flightradar24.com"
const API = "https://api.flightradar24.com/common/v1"
const DATA_CLOUD = "https://data-cloud.flightradar24.com"
const DATA_LIVE = "https://data-live.flightradar24.com"

/** Hosts `/raw` may reach. Nothing else — this is not an open proxy. */
const RAW_HOSTS = new Set([
  "www.flightradar24.com",
  "api.flightradar24.com",
  "data-cloud.flightradar24.com",
  "data-live.flightradar24.com",
  "cdn.flightradar24.com",
])

const UPSTREAM_TIMEOUT_MS = 4500

/** A current Chrome's request headers (from FlightRadarAPI's `Core.headers`). */
const BROWSER_HEADERS = {
  "accept": "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "max-age=0",
  "origin": WWW,
  "referer": `${WWW}/`,
  "sec-ch-ua": '"Google Chrome";v="136", "Chromium";v="136", "Not-A.Brand";v="24"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-site",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
}

/** The live feed's own defaults (FlightRadarAPI's FlightTrackerConfig). */
const FEED_DEFAULTS = {
  faa: "1", satellite: "1", mlat: "1", flarm: "1", adsb: "1", gnd: "1", air: "1",
  vehicles: "0", estimated: "1", maxage: "14400", gliders: "0", stats: "0", limit: "1500",
}

/** Seconds a normalized answer is kept in the Worker's cache, per route. */
const CACHE_TTL = {
  "/airport": 7 * 86400,
  "/airport/details": 600,
  "/airport/schedule": 120,
  "/airports": 86400,
  "/airlines": 86400,
  "/aircraft": 86400,
  "/aircraft/flights": 600,
  "/flight": 600,
  "/search": 3600,
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  /**
   * @param {Request} request
   * @param {{ PROXY_SECRET?: string }} env
   * @param {{ waitUntil(p: Promise<unknown>): void }} ctx
   */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight()
    if (request.method !== "GET") return json({ ok: false, error: "Method not allowed" }, 405)

    const url = new URL(request.url)
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "/"

    if (path === "/health") return json({ ok: true, time: new Date().toISOString() }, 200)

    if (env.PROXY_SECRET && !safeEqual(request.headers.get("x-proxy-secret") || "", env.PROXY_SECRET)) {
      return json({ ok: false, error: "Unauthorized" }, 401)
    }

    // Legacy verbatim passthroughs. `/` with a query was the original
    // search-only form of this Worker.
    if (url.pathname === "/v1/search/web/find" || (path === "/" && url.searchParams.has("query"))) {
      return legacyPassthrough(`${WWW}/v1/search/web/find${url.search}`)
    }
    if (url.pathname === "/airports/traffic-stats/" || path === "/airports/traffic-stats") {
      return legacyPassthrough(`${WWW}/airports/traffic-stats/${url.search}`)
    }

    if (path === "/raw") {
      // Gated on a secret existing at all: without one this would be an open
      // FR24 proxy on the account's quota.
      if (!env.PROXY_SECRET) return json({ ok: false, error: "/raw requires PROXY_SECRET to be set" }, 403)
      return rawPassthrough(url.searchParams.get("url") || "")
    }

    const handler = ROUTES[path]
    if (!handler) return json({ ok: false, error: "Unknown route", path, routes: Object.keys(ROUTES) }, 404)

    const debug = url.searchParams.get("debug") === "1"
    const ttl = CACHE_TTL[/** @type {keyof typeof CACHE_TTL} */ (path)]
    if (!ttl || debug) return respond(await runHandler(handler, url), debug)

    // The cache key is the route and its query — never the secret header.
    const key = new Request(`https://oooi-fr24.cache${path}?${sortedQuery(url.searchParams)}`)
    const cache = /** @type {any} */ (caches).default
    try {
      const hit = await cache.match(key)
      if (hit) {
        const res = new Response(hit.body, hit)
        res.headers.set("x-cache", "HIT")
        return res
      }
    } catch { /* the cache is best-effort */ }

    const answer = await runHandler(handler, url)
    const res = respond(answer, false)
    if (answer.status === 200) {
      const stored = res.clone()
      const headers = new Headers(stored.headers)
      headers.set("cache-control", `public, max-age=${ttl}`)
      ctx.waitUntil(cache.put(key, new Response(stored.body, { status: 200, headers })).catch(() => {}))
    }
    res.headers.set("x-cache", "MISS")
    return res
  },
}

/**
 * @typedef {{ status: number, body: Record<string, unknown>, attempts?: Attempt[] }} Answer
 * @typedef {(url: URL, log: Attempt[]) => Promise<Answer>} Handler
 */

/** @type {Record<string, Handler>} */
const ROUTES = {
  "/": async () => ({ status: 200, body: { ok: true, routes: ROUTE_DOCS } }),
  "/probe": handleProbe,
  "/aircraft": handleAircraft,
  "/aircraft/flights": handleAircraftFlights,
  "/airport": handleAirport,
  "/airport/details": handleAirportDetails,
  "/airport/schedule": handleAirportSchedule,
  "/airports": handleAirports,
  "/airlines": handleAirlines,
  "/search": handleSearch,
  "/flight": handleFlightHistory,
  "/flight/details": handleFlightDetails,
  "/live": handleLive,
}

const ROUTE_DOCS = {
  "/health": "liveness",
  "/probe": "which upstreams answer from this Worker (code=, reg=, flight= override the samples; explore=1 adds candidate sources and the shape of their data)",
  "/aircraft?reg=9V-TNL": "aircraft by registration",
  "/aircraft/flights?reg=9V-TNL&page=1&limit=25": "flight history for a registration",
  "/airport?code=WSSS": "airport by ICAO or IATA",
  "/airport/details?code=WSSS": "airport details, runways, weather",
  "/airport/schedule?code=WSSS&mode=departures&page=1&limit=50": "arrivals or departures",
  "/airports": "every airport",
  "/airlines": "every airline",
  "/search?q=TR600&limit=20": "search, grouped by kind",
  "/flight?number=TR600&page=1&limit=25": "flight history for a flight number",
  "/flight/details?id=<fr24 id>": "one live flight",
  "/live?reg=9V-TNL": "live positions (reg | airline | type | bounds=N,S,W,E)",
  "/raw?url=https://api.flightradar24.com/...": "verbatim passthrough (needs PROXY_SECRET)",
}

/** @param {Handler} handler @param {URL} url @returns {Promise<Answer>} */
async function runHandler(handler, url) {
  /** @type {Attempt[]} */
  const log = []
  try {
    const answer = await handler(url, log)
    return { ...answer, attempts: log }
  } catch (err) {
    return { status: 500, body: { ok: false, error: `Worker error: ${errorText(err)}` }, attempts: log }
  }
}

/** @param {Answer} answer @param {boolean} debug */
function respond(answer, debug) {
  const body = { ...answer.body }
  if (debug || answer.status === 502) body.attempts = answer.attempts
  return json(body, answer.status)
}

// ---------------------------------------------------------------------------
// Upstream fetch
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   name: string, url: string, ok: boolean, status: number, ms: number,
 *   contentType: string, bytes: number, challenged: boolean, error?: string
 * }} Attempt
 */

/**
 * GET an FR24 URL. Never throws: a timeout, a challenge page or a body that is
 * not JSON comes back as `ok: false` with the reason, and the call is logged
 * into `log` so `debug=1` and `/probe` can show it.
 *
 * @param {string} name
 * @param {string} url
 * @param {Attempt[]} log
 * @param {{ text?: boolean }} [opts]
 * @returns {Promise<{ ok: boolean, data: any, text: string, attempt: Attempt }>}
 */
async function upstream(name, url, log, opts = {}) {
  const started = Date.now()
  /** @type {Attempt} */
  const attempt = { name, url, ok: false, status: 0, ms: 0, contentType: "", bytes: 0, challenged: false }
  let data = null
  let text = ""
  try {
    const res = await fetch(url, {
      headers: BROWSER_HEADERS,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    })
    text = await res.text()
    attempt.status = res.status
    attempt.contentType = res.headers.get("content-type") || ""
    attempt.bytes = text.length
    attempt.challenged =
      res.headers.get("cf-mitigated") === "challenge" ||
      (/text\/html/i.test(attempt.contentType) && /Just a moment|challenge-platform|cf-chl/i.test(text))

    if (attempt.challenged) {
      attempt.error = "Cloudflare challenge"
    } else if (!res.ok) {
      attempt.error = `HTTP ${res.status}`
    } else if (opts.text) {
      attempt.ok = true
    } else {
      try {
        data = text ? JSON.parse(text) : null
        attempt.ok = data !== null
        if (!attempt.ok) attempt.error = "empty body"
      } catch {
        attempt.error = "not JSON"
      }
    }
  } catch (err) {
    attempt.error = errorText(err)
  }
  attempt.ms = Date.now() - started
  log.push(attempt)
  return { ok: attempt.ok, data, text, attempt }
}

/** @param {string} url */
async function legacyPassthrough(url) {
  /** @type {Attempt[]} */
  const log = []
  const { ok, text, attempt } = await upstream("legacy", url, log, { text: true })
  if (!ok || !attempt.contentType.includes("application/json")) {
    return json(
      {
        error: "Upstream non-JSON or non-OK",
        status: attempt.status,
        contentType: attempt.contentType,
        bodyLength: text.length,
        bodySnippet: text.slice(0, 500),
      },
      502
    )
  }
  return new Response(text, { status: 200, headers: baseHeaders("application/json; charset=utf-8") })
}

/** @param {string} target */
async function rawPassthrough(target) {
  let parsed
  try {
    parsed = new URL(target)
  } catch {
    return json({ ok: false, error: "url= must be an absolute FR24 URL" }, 400)
  }
  if (parsed.protocol !== "https:" || !RAW_HOSTS.has(parsed.hostname)) {
    return json({ ok: false, error: "Host not allowed", allowed: [...RAW_HOSTS] }, 400)
  }
  /** @type {Attempt[]} */
  const log = []
  const { ok, text, attempt } = await upstream("raw", parsed.toString(), log, { text: true })
  if (!ok) return json({ ok: false, error: attempt.error, attempts: log, bodySnippet: text.slice(0, 500) }, 502)
  return new Response(text, { status: 200, headers: baseHeaders(attempt.contentType || "text/plain") })
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

/** @type {Handler} */
async function handleAircraft(url, log) {
  const reg = cleanCode(url.searchParams.get("reg") || url.searchParams.get("q"), 2, 12)
  if (!reg) return bad("reg= is required (a registration, 2–12 characters)")
  const wanted = regKey(reg)

  // 1. Search — the source that has always answered for this app.
  const search = await upstream("search", searchUrl(reg, 10), log)
  if (search.ok) {
    const hits = (Array.isArray(search.data?.results) ? search.data.results : [])
      .filter((/** @type {any} */ r) => r?.type === "aircraft")
      .map(normalizeAircraftHit)
      .filter(Boolean)
    const exact = hits.filter((/** @type {any} */ h) => regKey(h.registration) === wanted)
    if (exact.length || hits.length) return found(exact.length ? exact : hits, "search")
  }

  // 2. The registration's flight history carries the airframe itself.
  const list = await upstream("flight-list", flightListUrl("reg", reg, 1, 1), log)
  const info = normalizeAircraftInfo(list.data?.result?.response?.aircraftInfo, reg)
  if (info) return found([info], "flight-list")

  // 3. The live feed, which only knows an aircraft that is flying now.
  const feed = await upstream("live-feed", feedUrl({ reg }), log)
  const live = parseFeed(feed.data).find((f) => regKey(f.registration) === wanted)
  if (live) {
    return found(
      [{
        registration: live.registration, icao24: live.icao24, typecode: live.typecode,
        model: "", serialNumber: "", operator: "", operatorIata: "", operatorIcao: live.airlineIcao, owner: "",
      }],
      "live-feed"
    )
  }

  return nothingOrFailed(log, `No aircraft found for ${reg}`)
}

/** @type {Handler} */
async function handleAircraftFlights(url, log) {
  const reg = cleanCode(url.searchParams.get("reg"), 2, 12)
  if (!reg) return bad("reg= is required")
  return flightHistory("reg", reg, url, log)
}

/** @type {Handler} */
async function handleFlightHistory(url, log) {
  const number = cleanCode(url.searchParams.get("number") || url.searchParams.get("flight"), 2, 10)
  if (!number) return bad("number= is required (e.g. TR600)")
  return flightHistory("flight", number, url, log)
}

/**
 * @param {"reg" | "flight"} by
 * @param {string} query
 * @param {URL} url
 * @param {Attempt[]} log
 * @returns {Promise<Answer>}
 */
async function flightHistory(by, query, url, log) {
  const page = intParam(url, "page", 1, 1, 100)
  const limit = intParam(url, "limit", 25, 1, 100)
  const res = await upstream("flight-list", flightListUrl(by, query, page, limit), log)
  if (!res.ok) return failed(log)
  const response = res.data?.result?.response
  const items = Array.isArray(response?.data) ? response.data.map(normalizeFlight) : []
  return {
    status: 200,
    body: {
      ok: true,
      source: "flight-list",
      data: {
        aircraft: by === "reg" ? normalizeAircraftInfo(response?.aircraftInfo, query) : null,
        page: response?.page?.current ?? page,
        totalPages: response?.page?.total ?? null,
        total: response?.item?.total ?? items.length,
        flights: items,
      },
    },
  }
}

/** @type {Handler} */
async function handleAirport(url, log) {
  const code = cleanCode(url.searchParams.get("code") || url.searchParams.get("q"), 3, 4)
  if (!code) return bad("code= is required (an ICAO or IATA code)")

  // Tier 1 — the two sources that carry the TIMEZONE, asked together.
  const [detailed, traffic] = await Promise.all([
    upstream("airport.json", airportJsonUrl(code, ["details"], 1, 1), log),
    upstream("traffic-stats", `${WWW}/airports/traffic-stats/?airport=${encodeURIComponent(code)}`, log),
  ])
  const fromApi = matchingAirport(normalizeAirportDetails(detailed.data?.result?.response?.airport?.pluginData?.details), code)
  if (fromApi) return found(fromApi, "airport.json")
  const fromTraffic = matchingAirport(normalizeAirportDetails(traffic.data?.details), code)
  if (fromTraffic) return found(fromTraffic, "traffic-stats")

  // Tier 2 — position without a timezone. The caller derives the zone from
  // the coordinates (the app has geo-tz); a missing zone must never be read
  // as UTC.
  const [rows, search] = await Promise.all([
    airportRows(log),
    upstream("search", searchUrl(code, 10), log),
  ])
  const listed = rows ? findAirportRow(rows, code) : null
  if (listed) return found(listed, "airport-list")

  const hits = Array.isArray(search.data?.results) ? search.data.results : []
  for (const hit of hits) {
    if (hit?.type !== "airport") continue
    const airport = matchingAirport(airportFromSearchHit(hit), code)
    if (airport) return found(airport, "search")
  }

  return nothingOrFailed(log, `No airport found for ${code}`)
}

/** @type {Handler} */
async function handleAirportDetails(url, log) {
  const code = cleanCode(url.searchParams.get("code"), 3, 4)
  if (!code) return bad("code= is required")
  const res = await upstream("airport.json", airportJsonUrl(code, ["details", "runways", "weather"], 1, 1), log)
  if (!res.ok) return failed(log)
  const plugin = res.data?.result?.response?.airport?.pluginData
  const airport = normalizeAirportDetails(plugin?.details)
  if (!airport) return notFound(`No airport found for ${code}`)
  return found({ airport, runways: plugin?.runways ?? [], weather: plugin?.weather ?? null }, "airport.json")
}

/** @type {Handler} */
async function handleAirportSchedule(url, log) {
  const code = cleanCode(url.searchParams.get("code"), 3, 4)
  if (!code) return bad("code= is required")
  const mode = url.searchParams.get("mode") === "arrivals" ? "arrivals" : "departures"
  const page = intParam(url, "page", 1, -10, 100)
  const limit = intParam(url, "limit", 50, 1, 100)
  const timestamp = intParam(url, "timestamp", Math.floor(Date.now() / 1000), 0, 4102444800)

  const target = new URL(`${API}/airport.json`)
  target.searchParams.set("code", code)
  target.searchParams.set("format", "json")
  target.searchParams.append("plugin[]", "schedule")
  target.searchParams.set("plugin-setting[schedule][mode]", mode)
  target.searchParams.set("plugin-setting[schedule][timestamp]", String(timestamp))
  target.searchParams.set("page", String(page))
  target.searchParams.set("limit", String(limit))

  const res = await upstream("airport.json schedule", target.toString(), log)
  if (!res.ok) return failed(log)
  const board = res.data?.result?.response?.airport?.pluginData?.schedule?.[mode]
  const items = Array.isArray(board?.data) ? board.data.map((/** @type {any} */ e) => normalizeFlight(e?.flight ?? e)) : []
  return found(
    {
      mode,
      page: board?.page?.current ?? page,
      totalPages: board?.page?.total ?? null,
      total: board?.item?.total ?? items.length,
      flights: items,
    },
    "airport.json"
  )
}

/** @type {Handler} */
async function handleAirports(_url, log) {
  const rows = await airportRows(log)
  if (!rows) return failed(log)
  return found(rows, "airport-list")
}

/** @type {Handler} */
async function handleAirlines(_url, log) {
  const res = await upstream("airlines.php", `${WWW}/_json/airlines.php`, log)
  if (!res.ok) return failed(log)
  const rows = (Array.isArray(res.data?.rows) ? res.data.rows : []).map(normalizeAirline).filter(Boolean)
  if (!rows.length) return failed(log)
  return found(rows, "airline-list")
}

/** @type {Handler} */
async function handleSearch(url, log) {
  const q = (url.searchParams.get("q") || url.searchParams.get("query") || "").trim().slice(0, 40)
  if (q.length < 2) return bad("q= is required (2+ characters)")
  const res = await upstream("search", searchUrl(q, intParam(url, "limit", 20, 1, 100)), log)
  if (!res.ok) return failed(log)
  return found(groupSearch(res.data), "search")
}

/** @type {Handler} */
async function handleFlightDetails(url, log) {
  const id = (url.searchParams.get("id") || "").trim()
  if (!/^[0-9a-f]{6,10}$/i.test(id)) return bad("id= is required (the FR24 flight id from /live)")
  const res = await upstream("clickhandler", `${DATA_LIVE}/clickhandler/?flight=${id}`, log)
  if (!res.ok) return failed(log)
  const flight = normalizeFlight(res.data)
  const trail = Array.isArray(res.data?.trail)
    ? res.data.trail.map((/** @type {any} */ p) => ({
        latitude: p?.lat ?? null, longitude: p?.lng ?? null, altitude: p?.alt ?? null,
        groundSpeed: p?.spd ?? null, heading: p?.hd ?? null, time: isoFromEpoch(p?.ts),
      }))
    : []
  return found({ ...flight, trail }, "clickhandler")
}

/** @type {Handler} */
async function handleLive(url, log) {
  /** @type {Record<string, string>} */
  const filters = {}
  const reg = cleanCode(url.searchParams.get("reg"), 2, 12)
  const airline = cleanCode(url.searchParams.get("airline"), 2, 3)
  const type = cleanCode(url.searchParams.get("type"), 2, 4)
  const bounds = url.searchParams.get("bounds") || ""
  if (reg) filters.reg = reg
  if (airline) filters.airline = airline
  if (type) filters.type = type
  if (/^-?\d+(\.\d+)?(,-?\d+(\.\d+)?){3}$/.test(bounds)) filters.bounds = bounds
  if (!Object.keys(filters).length) return bad("give at least one of reg=, airline=, type=, bounds=N,S,W,E")
  filters.limit = String(intParam(url, "limit", 500, 1, 1500))

  const res = await upstream("live-feed", feedUrl(filters), log)
  if (!res.ok) return failed(log)
  return found(parseFeed(res.data), "live-feed")
}

/** @type {Handler} */
async function handleProbe(url, log) {
  const code = cleanCode(url.searchParams.get("code"), 3, 4) || "WSSS"
  const reg = cleanCode(url.searchParams.get("reg"), 2, 12) || "9V-TNL"
  const flight = cleanCode(url.searchParams.get("flight"), 2, 10) || "TR600"

  const checks = [
    ["search", searchUrl(reg, 10)],
    ["traffic-stats", `${WWW}/airports/traffic-stats/?airport=${code}`],
    ["airport.json details", airportJsonUrl(code, ["details"], 1, 1)],
    ["airport.json schedule", airportJsonUrl(code, ["schedule"], 1, 5)],
    ["airports.php", `${WWW}/_json/airports.php`],
    ["airlines.php", `${WWW}/_json/airlines.php`],
    ["flight-list by reg", flightListUrl("reg", reg, 1, 5)],
    ["flight-list by flight", flightListUrl("flight", flight, 1, 5)],
    ["live-feed", feedUrl({ bounds: "1.6,1.1,103.5,104.2", limit: "5" })],
    ["airport-disruptions", `${WWW}/webapi/v1/airport-disruptions`],
    ["most-tracked", `${WWW}/flights/most-tracked`],
    ["zones", `${WWW}/js/zones.js.php`],
  ]
  const results = await Promise.all(checks.map(([name, target]) => upstream(name, target, log)))

  // The click handler needs a live flight id; take one from the feed.
  const liveId = parseFeed(results[8].data)[0]?.id
  const click = liveId ? await upstream("clickhandler", `${DATA_LIVE}/clickhandler/?flight=${liveId}`, log) : null

  const explore =
    url.searchParams.get("explore") === "1"
      ? await exploreUpstreams(
          {
            code,
            reg,
            flight,
            airline: cleanCode(url.searchParams.get("airline"), 3, 3) || "TGW",
            airlineIata: cleanCode(url.searchParams.get("airlineIata"), 2, 2) || "TR",
            airportId: (url.searchParams.get("airportId") || "").replace(/[^0-9]/g, "").slice(0, 8),
            airportIata: cleanCode(url.searchParams.get("airportIata"), 3, 3) || "SIN",
            flightList: results[6].data,
            click: click?.data,
            inUse: results,
          },
          log
        )
      : undefined

  return {
    status: 200,
    body: {
      ok: true,
      samples: { code, reg, flight, airline: url.searchParams.get("airline") || "TGW" },
      summary: log.map((a) => `${a.ok ? "OK  " : "FAIL"} ${a.name} — ${a.ok ? `${a.status}, ${a.ms}ms` : a.error}`),
      explore,
      attempts: log,
    },
  }
}

/**
 * What the app COULD read, for a decision about what to build next — not used
 * by any route. Each candidate is asked once and answered with the SHAPE of
 * its data (`shapeOf`: keys and value types, a few levels down, arrays by their
 * first element), never the data itself; the in-use sources are shaped too, at
 * the level their normalizers read, so a field they drop shows up as well.
 *
 * A guessed URL is marked as one: it is asked to find out whether it exists.
 * An HTML page (an airline's fleet or routes page, an airport's board, a
 * flight number's history) is not returned — it is READ (`pageAnatomy`): the
 * data endpoints its scripts reference, the JSON it embeds (by name and
 * shape), its `data-*` attributes, and how often it mentions a gate. That is
 * what a browser's network tab would show about where the page gets its data,
 * measured from where the app runs.
 *
 * @param {{ code: string, reg: string, flight: string, airline: string, airlineIata: string, airportId: string, airportIata: string, flightList: any, click: any, inUse: { data: any }[] }} s
 * @param {Attempt[]} log
 */
async function exploreUpstreams(s, log) {
  const first = s.flightList?.result?.response?.data?.[0]
  const fr24Id = first?.identification?.id
  const departed = first?.time?.real?.departure || first?.time?.scheduled?.departure
  const slug = `${s.airlineIata}-${s.airline}`.toLowerCase()
  /** @type {[name: string, url: string, pick: ((data: any) => any) | "html" | "bytes"][]} */
  const candidates = [
    // The newer web API (`/api/v1/…`, sniffed from the site). The airport id
    // is FR24's own number; without one the code is tried.
    ["www api/v1 airport (sniffed)", `${WWW}/api/v1/airports/${s.airportId || s.code}`, (d) => d],
    ["www api/v1 airline (guess)", `${WWW}/api/v1/airlines/${s.airline}`, (d) => d],
    ["www api/v1 airline fleet (guess)", `${WWW}/api/v1/airlines/${s.airline}/fleet`, (d) => d],
    // An airline's fleet and routes, as the site shows them (HTML).
    ["airline fleet page", `${WWW}/data/airlines/${slug}/fleet`, "html"],
    ["airline routes page", `${WWW}/data/airlines/${slug}/routes`, "html"],
    // What a routes-map pin asks for: an airport's destinations on this
    // airline (a guess at the page's own query, from its old markup).
    ["airline routes from an airport (guess)", `${WWW}/data/airlines/${slug}/routes?get-airport-arr-dep=${s.airportIata}&format=json`, (d) => d],
    // An airport's departures board and a flight number's history, as pages.
    ["airport departures page", `${WWW}/airport/${s.airportIata.toLowerCase()}/departures`, "html"],
    ["flight number page", `${WWW}/data/flights/${s.flight.toLowerCase()}`, "html"],
    // The board's own data (the in-use schedule route), one row deep — where a gate would be.
    [
      "airport.json departures (one row)",
      `${airportJsonUrl(s.code, ["schedule"], 1, 3)}&plugin-setting[schedule][mode]=departures&plugin-setting[schedule][timestamp]=${Math.floor(Date.now() / 1000)}`,
      (d) => d?.result?.response?.airport?.pluginData?.schedule?.departures?.data?.[0],
    ],
    // What the airline has in the air (and on the ground, last 4h) right now.
    ["live-feed by airline", feedUrl({ airline: s.airline }), (d) => parseFeed(d)],
    ["airline logo", `https://cdn.flightradar24.com/assets/airlines/logotypes/${s.airlineIata}_${s.airline}.png`, "bytes"],
    ["volcanic eruptions", `${WWW}/webapi/v1/volcanic-eruption-data`, (d) => d],
    // A second search host: a tier for the search chain if www is challenged.
    ["api search.json", `${API}/search.json?query=${encodeURIComponent(s.reg)}&limit=10`, (d) => d?.result],
    [
      "airport.json every plugin",
      airportJsonUrl(s.code, ["details", "runways", "weather", "aircraftOnGround", "aircraftCount", "scheduledRoutesStatistics", "satelliteImage", "flightdiary"], 1, 1),
      (d) => d?.result?.response?.airport?.pluginData,
    ],
    ["airport.json routes page", airportJsonUrl(s.code, ["scheduledRoutesStatistics"], 1, 100), (d) => d?.result?.response?.airport?.pluginData?.scheduledRoutesStatistics],
    ["flight-list by airport", `${API}/flight/list.json?query=${s.code.toLowerCase()}&fetchBy=airport&page=1&limit=5`, (d) => d?.result?.response],
    ["airport-disruptions", `${WWW}/webapi/v1/airport-disruptions`, (d) => d],
    ["most-tracked", `${WWW}/flights/most-tracked`, (d) => d],
    ["live-feed by callsign", feedUrl({ callsign: s.flight, limit: "5" }), (d) => parseFeed(d)],
  ]
  if (fr24Id && departed) {
    candidates.push([
      "flight-playback",
      `${API}/flight-playback.json?flightId=${encodeURIComponent(fr24Id)}&timestamp=${departed}`,
      (d) => d?.result?.response?.data?.flight,
    ])
  }

  const answers = await Promise.all(
    candidates.map(([name, target, pick]) => upstream(`explore: ${name}`, target, log, { text: typeof pick !== "function" }))
  )
  /** @type {Record<string, unknown>} */
  const out = {}
  candidates.forEach(([name, target, pick], i) => {
    const a = answers[i]
    if (!a.ok) {
      out[name] = { url: target, error: a.attempt.error }
    } else if (pick === "html") {
      const regs = registrationTokens(a.text)
      out[name] = {
        status: a.attempt.status,
        bytes: a.attempt.bytes,
        registrations: regs.length,
        sample: regs.slice(0, 5),
        ...pageAnatomy(a.text),
      }
    } else if (pick === "bytes") {
      out[name] = { status: a.attempt.status, bytes: a.attempt.bytes, contentType: a.attempt.contentType }
    } else {
      const data = pick(a.data)
      const rows = Array.isArray(data) ? data.length : undefined
      out[name] = { status: a.attempt.status, bytes: a.attempt.bytes, rows, shape: shapeOf(data) }
    }
  })

  // The sources routes already read, at the level their normalizers read —
  // what they leave on the table.
  out["in use: flight-list by reg (one flight)"] = { shape: shapeOf(first) }
  out["in use: flight-list by reg (aircraft)"] = { shape: shapeOf(s.flightList?.result?.response?.aircraftInfo) }
  out["in use: clickhandler"] = s.click ? { shape: shapeOf(s.click) } : { error: "no live flight in the sample bounds" }
  out["in use: search hit kinds"] = { shape: shapeOf(s.inUse[0].data?.results) }
  return out
}

/**
 * Where a page gets its data, read off the page itself: the data endpoints its
 * markup references (and the scripts it loads, where the rest are written), the JSON it embeds (`var arrRoutes = [...]`,
 * `<script type="application/json">`) by name, size and shape, its distinct
 * `data-*` attributes (a table row's fields), and how often it says gate,
 * terminal or baggage. Shapes and names only, never the values.
 *
 * @param {string} html
 */
export function pageAnatomy(html) {
  const text = html || ""
  const endpoints = new Set()
  const scripts = new Set()
  const ENDPOINT =
    /(?:https?:)?\/\/[a-z0-9.-]*flightradar24\.com\/[^\s"'<>()\\]+|["'`](\/(?:api|webapi|common|_json|v1|zones|clickhandler|data\/airlines|data\/flights|airports?)\/[^"'`\s<>]*)["'`]/gi
  for (const m of text.matchAll(ENDPOINT)) {
    const found = (m[1] || m[0]).replace(/^["'`]|["'`]$/g, "")
    // Assets are not data.
    if (/\.(?:png|jpe?g|svg|gif|webp|css|woff2?|ico)(?:\?|$)/i.test(found)) continue
    // A script is where a page's own requests are written — the next place to read.
    if (/\.m?js(?:\?|$)/i.test(found)) {
      if (scripts.size < 15) scripts.add(found.slice(0, 160))
    } else if (endpoints.size < 30) endpoints.add(found.slice(0, 160))
  }

  /** @type {{ name: string, chars: number, parses: boolean, rows?: number, shape?: unknown }[]} */
  const embedded = []
  for (const m of text.matchAll(/(?:\b(?:var|let|const)\s+|window\.)([A-Za-z_$][\w$]*)\s*=\s*([[{])/g)) {
    if (embedded.length >= 10) break
    const literal = balancedLiteral(text, (m.index ?? 0) + m[0].length - 1)
    if (literal.length < 2) continue
    embedded.push(describeLiteral(m[1], literal))
  }
  for (const m of text.matchAll(/<script[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    if (embedded.length >= 14) break
    const id = /id=["']([^"']+)["']/.exec(m[0])?.[1] || "script json"
    embedded.push(describeLiteral(id, m[1].trim()))
  }

  const dataAttributes = [...new Set([...text.matchAll(/\sdata-([a-z][a-z0-9-]*)=/g)].map((m) => m[1]))].slice(0, 40)
  const count = (/** @type {RegExp} */ re) => (text.match(re) || []).length
  return {
    endpoints: [...endpoints],
    scripts: [...scripts],
    embedded,
    dataAttributes,
    mentions: { gate: count(/\bgate\b/gi), terminal: count(/\bterminal\b/gi), baggage: count(/\bbaggage\b|\bbelt\b/gi) },
  }
}

/** @param {string} name @param {string} literal */
function describeLiteral(name, literal) {
  try {
    const value = JSON.parse(literal)
    return { name, chars: literal.length, parses: true, rows: Array.isArray(value) ? value.length : undefined, shape: shapeOf(value, 3) }
  } catch {
    return { name, chars: literal.length, parses: false }
  }
}

/**
 * The array or object literal opening at `start`, by bracket depth — strings
 * skipped, so a bracket inside one does not count. Empty when it never closes.
 *
 * @param {string} text
 * @param {number} start
 */
export function balancedLiteral(text, start) {
  let depth = 0
  /** @type {string | null} */
  let quote = null
  for (let i = start; i < text.length && i - start < 2_000_000; i++) {
    const c = text[i]
    if (quote) {
      if (c === "\\") i++
      else if (c === quote) quote = null
    } else if (c === '"' || c === "'") quote = c
    else if (c === "[" || c === "{") depth++
    else if (c === "]" || c === "}") {
      if (--depth === 0) return text.slice(start, i + 1)
    }
  }
  return ""
}

/**
 * Distinct registration-like tokens in a page — `9V-OFH`, `B-LRA`, `4X-EKA`: a
 * country prefix with a letter in it, a dash, a mark. A date's `10-30` is not
 * one; a dashless US `N12345` is missed, which a count can afford.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function registrationTokens(text) {
  const seen = new Set()
  for (const m of (text || "").matchAll(/\b((?:[A-Z][A-Z0-9]?|[0-9][A-Z])-[A-Z0-9]{2,5})\b/g)) seen.add(m[1])
  return [...seen]
}

/**
 * The shape of a JSON value: objects by key (at most 40), arrays by their first
 * element and length, scalars by type — depth-limited so the probe stays small.
 *
 * @param {any} value
 * @param {number} [depth]
 * @returns {unknown}
 */
export function shapeOf(value, depth = 4) {
  if (value === null || value === undefined) return null
  if (Array.isArray(value)) {
    if (!value.length) return []
    return depth > 0 ? [shapeOf(value[0], depth - 1), `×${value.length}`] : `array×${value.length}`
  }
  if (typeof value === "object") {
    if (depth <= 0) return "object"
    const keys = Object.keys(value)
    /** @type {Record<string, unknown>} */
    const shape = {}
    for (const k of keys.slice(0, 40)) shape[k] = shapeOf(value[k], depth - 1)
    if (keys.length > 40) shape["…"] = `${keys.length - 40} more keys`
    return shape
  }
  return typeof value
}

// ---------------------------------------------------------------------------
// The airport list — big, stable, and the airport chain's tier-2 source, so
// it is kept per isolate as well as in the cache.
// ---------------------------------------------------------------------------

/** @type {{ at: number, rows: AppAirport[] } | null} */
let airportList = null
const AIRPORT_LIST_MS = 6 * 3600 * 1000

/** @param {Attempt[]} log @returns {Promise<AppAirport[] | null>} */
async function airportRows(log) {
  if (airportList && Date.now() - airportList.at < AIRPORT_LIST_MS) return airportList.rows
  const res = await upstream("airports.php", `${WWW}/_json/airports.php`, log)
  if (!res.ok) return airportList?.rows ?? null
  const rows = (Array.isArray(res.data?.rows) ? res.data.rows : []).map(normalizeAirportRow).filter(isPresent)
  if (!rows.length) return airportList?.rows ?? null
  airportList = { at: Date.now(), rows }
  return rows
}

// ---------------------------------------------------------------------------
// URL builders
// ---------------------------------------------------------------------------

/** @param {string} query @param {number} limit */
function searchUrl(query, limit) {
  return `${WWW}/v1/search/web/find?query=${encodeURIComponent(query)}&limit=${limit}`
}

/** @param {"reg" | "flight"} by @param {string} query @param {number} page @param {number} limit */
function flightListUrl(by, query, page, limit) {
  return `${API}/flight/list.json?query=${encodeURIComponent(query.toLowerCase())}&fetchBy=${by}&page=${page}&limit=${limit}`
}

/** @param {string} code @param {string[]} plugins @param {number} page @param {number} limit */
function airportJsonUrl(code, plugins, page, limit) {
  const target = new URL(`${API}/airport.json`)
  target.searchParams.set("code", code)
  target.searchParams.set("format", "json")
  for (const p of plugins) target.searchParams.append("plugin[]", p)
  target.searchParams.set("page", String(page))
  target.searchParams.set("limit", String(limit))
  return target.toString()
}

/** @param {Record<string, string>} filters */
function feedUrl(filters) {
  const target = new URL(`${DATA_CLOUD}/zones/fcgi/feed.js`)
  for (const [k, v] of Object.entries({ ...FEED_DEFAULTS, ...filters })) target.searchParams.set(k, v)
  return target.toString()
}

// ---------------------------------------------------------------------------
// Normalizers — FR24 shapes in, the app's shapes out. None of them throws.
// ---------------------------------------------------------------------------

/**
 * The app's airport — `Fr24Airport` in lib/fr24/types.ts; the app stores it
 * without the offset, as `EnrichedAirport` in lib/lookup/types.ts. The offset
 * is set when the source states one; `timezone` is "" when the source carries
 * none.
 *
 * @typedef {{
 *   icao: string, iata: string, name: string, city: string, country: string,
 *   countryCode: string, latitude: number, longitude: number, elevation: number,
 *   timezone: string, timezoneOffsetSeconds: number | null
 * }} AppAirport
 */

/**
 * `details` from airport.json's plugin data OR from traffic-stats — the same
 * object, except that the first states elevation as `elevation` and the second
 * as `altitude`.
 *
 * @param {any} details
 * @returns {AppAirport | null}
 */
export function normalizeAirportDetails(details) {
  if (!details || typeof details !== "object") return null
  const position = details.position || {}
  const latitude = num(position.latitude)
  const longitude = num(position.longitude)
  const icao = str(details.code?.icao).toUpperCase()
  const iata = str(details.code?.iata).toUpperCase()
  if ((!icao && !iata) || latitude === null || longitude === null) return null
  const offset = num(details.timezone?.offset)
  return {
    icao,
    iata,
    name: str(details.name),
    city: str(position.region?.city),
    country: str(position.country?.name),
    countryCode: str(position.country?.code).toUpperCase(),
    latitude,
    longitude,
    elevation: num(position.elevation ?? position.altitude) ?? 0,
    timezone: str(details.timezone?.name),
    timezoneOffsetSeconds: offset,
  }
}

/**
 * A row of `_json/airports.php`: `{ name, iata, icao, lat, lon, country, alt }`.
 *
 * @param {any} row
 * @returns {AppAirport | null}
 */
export function normalizeAirportRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null
  const latitude = num(row.lat)
  const longitude = num(row.lon)
  const icao = str(row.icao).toUpperCase()
  const iata = str(row.iata).toUpperCase()
  if ((!icao && !iata) || latitude === null || longitude === null) return null
  return {
    icao, iata, name: str(row.name), city: "", country: str(row.country), countryCode: "",
    latitude, longitude, elevation: num(row.alt) ?? 0, timezone: "", timezoneOffsetSeconds: null,
  }
}

/**
 * An airport search hit: `{ id, label: "Singapore Changi Airport (SIN / WSSS)",
 * detail: { lat, lon }, type: "airport" }`. The codes live only in the label.
 *
 * @param {any} hit
 * @returns {AppAirport | null}
 */
export function airportFromSearchHit(hit) {
  if (!hit || hit.type !== "airport") return null
  const label = str(hit.label)
  const codes = label.match(/\(([A-Z0-9]{3})?\s*\/\s*([A-Z0-9]{4})?\)\s*$/i)
  const iata = str(codes?.[1] || (str(hit.id).length === 3 ? hit.id : "")).toUpperCase()
  const icao = str(codes?.[2]).toUpperCase()
  const latitude = num(hit.detail?.lat)
  const longitude = num(hit.detail?.lon)
  if ((!icao && !iata) || latitude === null || longitude === null) return null
  return {
    icao, iata, name: label.replace(/\s*\([^)]*\)\s*$/, ""), city: "", country: "", countryCode: "",
    latitude, longitude, elevation: 0, timezone: "", timezoneOffsetSeconds: null,
  }
}

/**
 * The airport a code names in a list. A 4-character code is an ICAO first, a
 * 3-character one an IATA first; either falls back to the other field.
 *
 * @param {AppAirport[]} rows
 * @param {string} code
 */
export function findAirportRow(rows, code) {
  const c = code.toUpperCase()
  const primary = c.length === 4 ? "icao" : "iata"
  const secondary = primary === "icao" ? "iata" : "icao"
  return rows.find((r) => r[primary] === c) || rows.find((r) => r[secondary] === c) || null
}

/** @param {AppAirport | null} airport @param {string} code */
function matchingAirport(airport, code) {
  if (!airport) return null
  const c = code.toUpperCase()
  return airport.icao === c || airport.iata === c ? airport : null
}

/**
 * @typedef {{
 *   registration: string, icao24: string, typecode: string, model: string,
 *   serialNumber: string, operator: string, operatorIata: string,
 *   operatorIcao: string, owner: string
 * }} AppAircraft
 */

/**
 * An aircraft search hit: `{ id: "9V-TNL", detail: { owner, equip, hex,
 * operator_id }, type: "aircraft" }`.
 *
 * @param {any} hit
 * @returns {AppAircraft | null}
 */
export function normalizeAircraftHit(hit) {
  if (!hit || hit.type !== "aircraft" || !str(hit.id)) return null
  return {
    registration: str(hit.id).toUpperCase(),
    icao24: str(hit.detail?.hex).toUpperCase(),
    typecode: str(hit.detail?.equip).toUpperCase(),
    model: "",
    serialNumber: "",
    operator: str(hit.detail?.owner),
    operatorIata: "",
    operatorIcao: "",
    owner: str(hit.detail?.owner),
  }
}

/**
 * `aircraftInfo` from a flight list fetched by registration.
 *
 * @param {any} info
 * @param {string} [fallbackReg]
 * @returns {AppAircraft | null}
 */
export function normalizeAircraftInfo(info, fallbackReg = "") {
  if (!info || typeof info !== "object") return null
  const typecode = str(info.model?.code).toUpperCase()
  const registration = str(info.registration || fallbackReg).toUpperCase()
  if (!registration || (!typecode && !str(info.model?.text))) return null
  return {
    registration,
    icao24: str(info.hex).toUpperCase(),
    typecode,
    model: str(info.model?.text),
    serialNumber: str(info.serialNo),
    operator: str(info.airline?.name),
    operatorIata: str(info.airline?.code?.iata).toUpperCase(),
    operatorIcao: str(info.airline?.code?.icao).toUpperCase(),
    owner: str(info.owner?.name),
  }
}

/**
 * One flight — a flight-list row, an airport-schedule row, or a click-handler
 * answer; FR24 uses one shape for all three. Times are ISO-8601 UTC, or null.
 * FR24's "real" times are its own observation, not the company's OOOI record.
 *
 * @param {any} f
 */
export function normalizeFlight(f) {
  const id = f?.identification || {}
  const aircraft = f?.aircraft || {}
  const time = f?.time || {}
  /** @param {any} a */
  const airport = (a) =>
    a && typeof a === "object"
      ? {
          icao: str(a.code?.icao).toUpperCase(),
          iata: str(a.code?.iata).toUpperCase(),
          name: str(a.name),
          timezone: str(a.timezone?.name),
        }
      : null
  return {
    fr24Id: str(id.id) || null,
    flightNumber: str(id.number?.default),
    callsign: str(id.callsign),
    status: str(f?.status?.text),
    live: f?.status?.live === true,
    registration: str(aircraft.registration).toUpperCase(),
    typecode: str(aircraft.model?.code).toUpperCase(),
    model: str(aircraft.model?.text),
    airline: f?.airline
      ? {
          name: str(f.airline.name),
          iata: str(f.airline.code?.iata).toUpperCase(),
          icao: str(f.airline.code?.icao).toUpperCase(),
        }
      : null,
    origin: airport(f?.airport?.origin),
    destination: airport(f?.airport?.destination),
    scheduledDeparture: isoFromEpoch(time.scheduled?.departure),
    scheduledArrival: isoFromEpoch(time.scheduled?.arrival),
    actualDeparture: isoFromEpoch(time.real?.departure),
    actualArrival: isoFromEpoch(time.real?.arrival),
    estimatedDeparture: isoFromEpoch(time.estimated?.departure),
    estimatedArrival: isoFromEpoch(time.estimated?.arrival),
    durationSeconds: num(time.other?.duration),
  }
}

/** Positions in a feed row (FlightRadarAPI's `entities/flight.js`). */
const FEED = {
  ICAO24: 0, LAT: 1, LON: 2, HEADING: 3, ALTITUDE: 4, SPEED: 5, SQUAWK: 6,
  TYPE: 8, REG: 9, TIME: 10, ORIGIN: 11, DEST: 12, NUMBER: 13, ON_GROUND: 14,
  VSPEED: 15, CALLSIGN: 16, AIRLINE_ICAO: 18,
}

/**
 * The live feed: an object of `<flightId>: [ ...positional fields ]`, beside
 * bookkeeping keys (`full_count`, `version`, `stats`). Only keys starting with
 * a digit are flights.
 *
 * @param {any} content
 */
export function parseFeed(content) {
  if (!content || typeof content !== "object") return []
  return Object.entries(content)
    .filter(([key, row]) => /^\d/.test(key) && Array.isArray(row))
    .map(([key, row]) => ({
      id: key,
      icao24: str(row[FEED.ICAO24]).toUpperCase(),
      latitude: num(row[FEED.LAT]),
      longitude: num(row[FEED.LON]),
      heading: num(row[FEED.HEADING]),
      altitude: num(row[FEED.ALTITUDE]),
      groundSpeed: num(row[FEED.SPEED]),
      squawk: str(row[FEED.SQUAWK]),
      typecode: str(row[FEED.TYPE]).toUpperCase(),
      registration: str(row[FEED.REG]).toUpperCase(),
      time: isoFromEpoch(row[FEED.TIME]),
      originIata: str(row[FEED.ORIGIN]).toUpperCase(),
      destinationIata: str(row[FEED.DEST]).toUpperCase(),
      flightNumber: str(row[FEED.NUMBER]).toUpperCase(),
      onGround: row[FEED.ON_GROUND] === 1 || row[FEED.ON_GROUND] === true,
      verticalSpeed: num(row[FEED.VSPEED]),
      callsign: str(row[FEED.CALLSIGN]).toUpperCase(),
      airlineIcao: str(row[FEED.AIRLINE_ICAO]).toUpperCase(),
    }))
}

/**
 * The search answer split by kind. FR24 returns one flat `results` list and
 * `stats.count` says how many of each kind it holds, in order.
 *
 * @param {any} content
 * @returns {Record<string, any[]>}
 */
export function groupSearch(content) {
  const results = Array.isArray(content?.results) ? content.results : []
  const counts = content?.stats?.count
  /** @type {Record<string, any[]>} */
  const grouped = {}
  if (counts && typeof counts === "object") {
    let index = 0
    for (const [kind, count] of Object.entries(counts)) {
      const n = Number(count) || 0
      grouped[kind] = results.slice(index, index + n)
      index += n
    }
    return grouped
  }
  // No counts — group on each hit's own type instead.
  for (const r of results) (grouped[str(r?.type) || "other"] ||= []).push(r)
  return grouped
}

/**
 * A row of `_json/airlines.php` — `{ Name, Code, ICAO }`, lowercase accepted too.
 *
 * @param {any} row
 */
export function normalizeAirline(row) {
  if (!row || typeof row !== "object") return null
  const name = str(row.Name ?? row.name)
  const iata = str(row.Code ?? row.iata ?? row.code).toUpperCase()
  const icao = str(row.ICAO ?? row.icao).toUpperCase()
  if (!name || (!iata && !icao)) return null
  return { name, iata, icao }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {unknown} v */
function str(v) {
  return typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : ""
}

/** @param {unknown} v */
function num(v) {
  if (v === null || v === undefined || v === "") return null
  const n = typeof v === "number" ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

/** @template T @param {T | null | undefined} v @returns {v is T} */
function isPresent(v) {
  return v !== null && v !== undefined
}

/** Epoch seconds → ISO UTC. FR24 uses 0 / null for "not known". @param {unknown} v */
function isoFromEpoch(v) {
  const n = num(v)
  return n && n > 0 ? new Date(n * 1000).toISOString() : null
}

/** Uppercase, strip everything but letters, digits and dashes, bound the length. */
function cleanCode(/** @type {string | null} */ v, /** @type {number} */ min, /** @type {number} */ max) {
  const c = (v || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "")
  return c.length >= min && c.length <= max ? c : ""
}

/** The registration key the app uses everywhere (`normalizeRegistration`). @param {string} reg */
function regKey(reg) {
  return reg.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

/** @param {URL} url @param {string} name @param {number} def @param {number} min @param {number} max */
function intParam(url, name, def, min, max) {
  const n = Number.parseInt(url.searchParams.get(name) || "", 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def
}

/** @param {URLSearchParams} params */
function sortedQuery(params) {
  return [...params.entries()]
    .filter(([k]) => k !== "debug")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&")
}

/** @param {unknown} data @param {string} source @returns {Answer} */
function found(data, source) {
  return { status: 200, body: { ok: true, source, data } }
}

/** @param {string} error @returns {Answer} */
function bad(error) {
  return { status: 400, body: { ok: false, error } }
}

/** @param {string} error @returns {Answer} */
function notFound(error) {
  return { status: 404, body: { ok: false, error } }
}

/** @param {Attempt[]} log @returns {Answer} */
function failed(log) {
  const last = log[log.length - 1]
  return { status: 502, body: { ok: false, error: `Upstream failed: ${last?.error ?? "no attempt made"}` } }
}

/**
 * Nothing found is only "not found" when at least one source actually
 * ANSWERED. When every source failed, the caller must hear 502 — "try later",
 * not "this does not exist, type it in".
 *
 * @param {Attempt[]} log @param {string} message @returns {Answer}
 */
function nothingOrFailed(log, message) {
  return log.some((a) => a.ok) ? notFound(message) : failed(log)
}

/** @param {unknown} err */
function errorText(err) {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
}

/** Constant-time string comparison. @param {string} a @param {string} b */
function safeEqual(a, b) {
  const enc = new TextEncoder()
  const x = enc.encode(a)
  const y = enc.encode(b)
  let diff = x.length ^ y.length
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0)
  return diff === 0
}

/** @param {string} contentType */
function baseHeaders(contentType) {
  return {
    "content-type": contentType,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  }
}

/** @param {unknown} payload @param {number} status */
function json(payload, status) {
  return new Response(JSON.stringify(payload), { status, headers: baseHeaders("application/json; charset=utf-8") })
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "x-proxy-secret",
      "access-control-max-age": "86400",
    },
  })
}
