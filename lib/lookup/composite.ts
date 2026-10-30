/**
 * The `/api/lookup` routes the door COMPOSES from the Worker's own, rather than
 * passing one through — EDGE (they call the Worker, which the upstream only
 * answers from Edge; see `cloudflare-worker/README.md`).
 *
 *   aircraft/candidates?q=9VB        every aircraft the text could be
 *   aircraft/candidates?q=9V-TNL&exact=1   that registration, or 404
 *   airport/candidates?q=VOV         every airport a partial code could be
 *   flight/suggest?number=TR288&date=2026-10-30[&out=02:25]   that flight that day
 *   flight/gates?number=TR288&date=2026-10-30[&out=02:25]     its gates, when published
 *   aircraft/whereabouts?reg=9V-NCA[&at=ISO]   where the aeroplane is before `at`
 *
 * They were `/api/search/aircraft` and `/api/search/airport/candidates`. Under
 * the door they share its sign-in rule and its envelope: 200 `{ ok, data,
 * source }`, 404 nothing found, 502 the lookup could not be made — which a
 * caller must not read as "not found".
 *
 * Search does not index every airframe, so when nothing it returned IS the
 * query and the query could be a whole registration, the registration's
 * flight history (`aircraft/flights`) is asked as well, which knows an
 * aeroplane by its full mark.
 */

import { callFr24Worker } from "@/lib/fr24/worker-client"
import type { Fr24Flight, Fr24Result } from "@/lib/fr24/types"
import { normalizeRegistration } from "@/lib/utils/string"
import { findOnBoard, normalizeFlightNumber, pickFlightOnDate, suggestFlight, type FlightGates } from "./flight-suggest"
import { movementOf, pickWhereabouts } from "./aircraft-whereabouts"
import { aircraftCandidates, airportCandidates } from "./search-candidates"
import type { LookupRoutes } from "./types"

type Query = Record<string, string>

const SEARCH_LIMIT = 30
const STEP_TIMEOUT_MS = 7000
/** A whole registration is rarely under five characters once the dash goes. */
const WHOLE_REGISTRATION = 5

/** A step answered — found something or said it has nothing — rather than failing. */
const answered = (r: Fr24Result<unknown>) => r.ok || r.status === 404

async function aircraftCandidatesRoute(query: Query): Promise<Fr24Result<LookupRoutes["aircraft/candidates"]>> {
  const q = (query.q || query.reg || "").trim()
  const exactOnly = query.exact === "1"
  if (q.length < 2) return exactOnly ? { ok: false, status: 404, error: "Query too short" } : { ok: true, status: 200, data: [], source: "" }

  const search = await callFr24Worker("search", { q, limit: SEARCH_LIMIT }, STEP_TIMEOUT_MS)
  let results = search.ok ? aircraftCandidates(search.data, q) : []
  const sources = search.ok ? [search.source] : []
  // The first step that could not be made — the error a 502 carries.
  let failure = !search.ok && !answered(search) ? search.error : null

  const wanted = normalizeRegistration(q)
  if (!results.some((r) => r.exact) && (exactOnly || wanted.length >= WHOLE_REGISTRATION || results.length === 0)) {
    const history = await callFr24Worker("aircraft/flights", { reg: q, limit: 1 }, STEP_TIMEOUT_MS)
    if (!history.ok && !answered(history)) failure ??= history.error
    const aircraft = history.ok ? history.data.aircraft : null
    if (history.ok) sources.push(history.source)
    if (aircraft && normalizeRegistration(aircraft.registration) === wanted) {
      results = [
        { registration: aircraft.registration, icao24: aircraft.icao24, typecode: aircraft.typecode, operator: aircraft.operator, source: "fr24", exact: true },
        ...results,
      ]
    }
  }

  if (exactOnly) {
    const exact = results.find((r) => r.exact)
    if (exact) return { ok: true, status: 200, data: [exact], source: sources.join("+") }
    // "Not found" only when every source asked has answered.
    if (failure !== null) return { ok: false, status: 502, error: failure }
    return { ok: false, status: 404, error: `No aircraft found for ${q}` }
  }
  if (results.length === 0 && failure !== null) return { ok: false, status: 502, error: failure }
  return { ok: true, status: 200, data: results, source: sources.join("+") }
}

async function airportCandidatesRoute(query: Query): Promise<Fr24Result<LookupRoutes["airport/candidates"]>> {
  const q = (query.q || "").trim()
  if (q.length < 2) return { ok: true, status: 200, data: [], source: "" }
  const search = await callFr24Worker("search", { q, limit: SEARCH_LIMIT }, STEP_TIMEOUT_MS)
  if (search.ok) return { ok: true, status: 200, data: airportCandidates(search.data, q), source: search.source }
  return search.status === 404 ? { ok: true, status: 200, data: [], source: "" } : search
}

/** A flight number's list (a week back, a week ahead), or the reason it could not be had. */
async function flightList(query: Query): Promise<{ number: string; date: string; out?: string; flights: Fr24Flight[]; source: string } | Fr24Result<never>> {
  const number = (query.number || query.flight || "").trim()
  const date = (query.date || "").trim()
  if (normalizeFlightNumber(number).length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, status: 400, error: "number= and date=YYYY-MM-DD are required" }
  }
  const list = await callFr24Worker("flight", { number, limit: 100 }, STEP_TIMEOUT_MS)
  if (!list.ok) return list.status === 404 ? { ok: false, status: 404, error: `No flight ${number} found` } : list
  const out = /^\d{2}:\d{2}$/.test(query.out || "") ? query.out : undefined
  return { number, date, out, flights: list.data.flights, source: list.source }
}

const isFailure = (v: object): v is Fr24Result<never> => "ok" in v

async function flightSuggestRoute(query: Query): Promise<Fr24Result<LookupRoutes["flight/suggest"]>> {
  const list = await flightList(query)
  if (isFailure(list)) return list
  const suggestion = suggestFlight(list.flights, list.number, list.date, list.out)
  if (!suggestion) return { ok: false, status: 404, error: `No flight ${list.number} found` }
  return { ok: true, status: 200, data: suggestion, source: list.source }
}

/**
 * The gates of the flight that day: the tracked flight's own when it is in
 * the air or about to be, else the departures board at its origin and the
 * arrivals board at its destination, each read from an hour before the
 * scheduled time. A gate not yet published is "" — answered, not failed.
 */
async function flightGatesRoute(query: Query): Promise<Fr24Result<LookupRoutes["flight/gates"]>> {
  const list = await flightList(query)
  if (isFailure(list)) return list
  const row = pickFlightOnDate(list.flights, list.number, list.date, list.out)
  const flight = row && suggestFlight([row], list.number, list.date)
  if (!row || !flight) return { ok: false, status: 404, error: `No flight ${list.number} on ${list.date}` }

  const code = (a: Fr24Flight["origin"]) => a?.iata || a?.icao || ""
  const answer = (dep: Fr24Flight | null, arr: Fr24Flight | null, source: FlightGates["source"], from: string) => ({
    ok: true as const,
    status: 200,
    source: from,
    data: {
      flight,
      departure: { airport: code(row.origin), gate: dep?.origin?.gate ?? "", terminal: dep?.origin?.terminal ?? "" },
      arrival: {
        airport: code(row.destination),
        gate: arr?.destination?.gate ?? "",
        terminal: arr?.destination?.terminal ?? "",
        baggage: arr?.destination?.baggage ?? "",
      },
      source,
    },
  })

  if (row.live && row.fr24Id) {
    const live = await callFr24Worker("flight/details", { id: row.fr24Id }, STEP_TIMEOUT_MS)
    if (live.ok && (live.data.origin?.gate || live.data.destination?.gate)) return answer(live.data, live.data, "live", live.source)
  }

  const board = (a: Fr24Flight["origin"], mode: "departures" | "arrivals", at: string | null) =>
    a && at
      ? callFr24Worker("airport/schedule", { code: code(a), mode, limit: 100, timestamp: Math.floor(Date.parse(at) / 1000) - 3600 }, STEP_TIMEOUT_MS)
      : null
  const [departures, arrivals] = await Promise.all([
    board(row.origin, "departures", row.scheduledDeparture),
    board(row.destination, "arrivals", row.scheduledArrival),
  ])
  const dep = departures?.ok ? findOnBoard(departures.data.flights, list.number, row.scheduledDeparture) : null
  const arr = arrivals?.ok ? findOnBoard(arrivals.data.flights, list.number, row.scheduledDeparture) : null
  if (dep?.origin?.gate || dep?.origin?.terminal || arr?.destination?.gate || arr?.destination?.terminal) {
    return answer(dep, arr, "board", "airport.json")
  }
  // Neither board could be READ: that is a failure, not "no gate yet".
  const failure = [departures, arrivals].find((b) => b && !b.ok && b.status !== 404)
  if (failure && !failure.ok && !departures?.ok && !arrivals?.ok) return { ok: false, status: 502, error: failure.error }
  return answer(null, null, "none", list.source)
}

/** Boards reach about a day either side of now; an arrival outside that is not asked about. */
const BOARD_REACH_MS = { back: 12 * 3600_000, ahead: 24 * 3600_000 }

/**
 * Where an aeroplane is before `at` (default now): its registration's list,
 * the last flight it departs on before then — landed, airborne or not yet
 * left — and the one after it. The inbound's ARRIVAL gate is where the crew
 * usually joins it: the tracked flight's own while it is live, else the
 * arrivals board at its destination, read from an hour before it lands.
 */
async function aircraftWhereaboutsRoute(query: Query): Promise<Fr24Result<LookupRoutes["aircraft/whereabouts"]>> {
  const reg = (query.reg || "").trim()
  if (normalizeRegistration(reg).length < 3) return { ok: false, status: 400, error: "reg= is required" }
  const atMs = query.at ? Date.parse(query.at) : Date.now()
  if (Number.isNaN(atMs)) return { ok: false, status: 400, error: "at= must be an ISO time" }

  const list = await callFr24Worker("aircraft/flights", { reg, limit: 30 }, STEP_TIMEOUT_MS)
  if (!list.ok) return list.status === 404 ? { ok: false, status: 404, error: `No flights found for ${reg}` } : list
  const { inbound, next } = pickWhereabouts(list.data.flights, atMs)

  let gate = { gate: "", terminal: "" }
  if (inbound?.live && inbound.fr24Id) {
    const live = await callFr24Worker("flight/details", { id: inbound.fr24Id }, STEP_TIMEOUT_MS)
    if (live.ok && live.data.destination) gate = { gate: live.data.destination.gate, terminal: live.data.destination.terminal }
  }
  const arrival = inbound && movementOf(inbound).arrival
  const arrivalMs = arrival ? Date.parse(arrival) : null
  const destination = inbound?.destination?.iata || inbound?.destination?.icao
  if (inbound && !gate.gate && destination && arrivalMs !== null && arrivalMs > Date.now() - BOARD_REACH_MS.back && arrivalMs < Date.now() + BOARD_REACH_MS.ahead) {
    const board = await callFr24Worker(
      "airport/schedule",
      { code: destination, mode: "arrivals", limit: 100, timestamp: Math.floor(arrivalMs / 1000) - 3600 },
      STEP_TIMEOUT_MS
    )
    const row = board.ok ? findOnBoard(board.data.flights, inbound.flightNumber, inbound.scheduledDeparture) : null
    if (row?.destination) gate = { gate: row.destination.gate, terminal: row.destination.terminal }
  }

  return {
    ok: true,
    status: 200,
    source: list.source,
    data: {
      registration: list.data.aircraft?.registration || inbound?.registration || reg.toUpperCase(),
      typecode: list.data.aircraft?.typecode || inbound?.typecode || "",
      at: new Date(atMs).toISOString(),
      inbound: inbound ? { ...movementOf(inbound), arrivalGate: gate.gate, arrivalTerminal: gate.terminal } : null,
      next: next ? movementOf(next) : null,
    },
  }
}

type CompositeRoute = "aircraft/candidates" | "airport/candidates" | "flight/suggest" | "flight/gates" | "aircraft/whereabouts"

const COMPOSITE_ROUTES: { [R in CompositeRoute]: (query: Query) => Promise<Fr24Result<LookupRoutes[R]>> } = {
  "aircraft/candidates": aircraftCandidatesRoute,
  "airport/candidates": airportCandidatesRoute,
  "flight/suggest": flightSuggestRoute,
  "flight/gates": flightGatesRoute,
  "aircraft/whereabouts": aircraftWhereaboutsRoute,
}

export const COMPOSITE_ROUTE_NAMES = Object.keys(COMPOSITE_ROUTES) as CompositeRoute[]

export function isCompositeRoute(route: string): route is CompositeRoute {
  return Object.prototype.hasOwnProperty.call(COMPOSITE_ROUTES, route)
}

export function runCompositeRoute<R extends CompositeRoute>(route: R, query: Query): Promise<Fr24Result<LookupRoutes[R]>> {
  return (COMPOSITE_ROUTES[route] as (query: Query) => Promise<Fr24Result<LookupRoutes[R]>>)(query)
}
