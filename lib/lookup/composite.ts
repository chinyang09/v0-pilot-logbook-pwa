/**
 * The `/api/lookup` routes the door COMPOSES from the Worker's own, rather than
 * passing one through — EDGE (they call the Worker, which the upstream only
 * answers from Edge; see `cloudflare-worker/README.md`).
 *
 *   aircraft/candidates?q=9VB        every aircraft the text could be
 *   aircraft/candidates?q=9V-TNL&exact=1   that registration, or 404
 *   airport/candidates?q=VOV         every airport a partial code could be
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
import type { Fr24Result } from "@/lib/fr24/types"
import { normalizeRegistration } from "@/lib/utils/string"
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

type CompositeRoute = "aircraft/candidates" | "airport/candidates"

const COMPOSITE_ROUTES: { [R in CompositeRoute]: (query: Query) => Promise<Fr24Result<LookupRoutes[R]>> } = {
  "aircraft/candidates": aircraftCandidatesRoute,
  "airport/candidates": airportCandidatesRoute,
}

export const COMPOSITE_ROUTE_NAMES = Object.keys(COMPOSITE_ROUTES) as CompositeRoute[]

export function isCompositeRoute(route: string): route is CompositeRoute {
  return Object.prototype.hasOwnProperty.call(COMPOSITE_ROUTES, route)
}

export function runCompositeRoute<R extends CompositeRoute>(route: R, query: Query): Promise<Fr24Result<LookupRoutes[R]>> {
  return (COMPOSITE_ROUTES[route] as (query: Query) => Promise<Fr24Result<LookupRoutes[R]>>)(query)
}
