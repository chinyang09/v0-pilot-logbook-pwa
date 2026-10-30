/**
 * The CANDIDATES a typed registration or airport code could mean, read off the
 * gateway Worker's `/search` answer (FR24's search, grouped by kind).
 *
 * The add-aircraft and add-airport forms used to ask for ONE answer and take
 * it: the Worker's `/aircraft` chain keeps only `type: "aircraft"` hits, and a
 * pilot who remembers "9VB…" of a tail got whichever hit came first, filled in
 * as "Found". The search answers more than that — a partial registration also
 * matches the LIVE flights flying it — so every hit that could be the thing
 * typed is a candidate, ranked, and only an EXACT one is ever taken without
 * the pilot choosing it.
 *
 * Pure, so the ranking is tested without the Worker.
 */

import { normalizeRegistration } from "@/lib/utils/string"

export interface AircraftCandidate {
  registration: string
  icao24: string
  typecode: string
  operator: string
  source: "fr24"
  /** The registration IS what was typed (dash and case aside). */
  exact: boolean
}

export interface AirportCandidate {
  icao: string
  iata: string
  name: string
  latitude: number | null
  longitude: number | null
  exact: boolean
}

type Grouped = Record<string, unknown[]> | null | undefined

const str = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "")
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)

/** Every hit in the grouped answer, whatever group FR24 put it in. */
function hits(grouped: Grouped): Record<string, any>[] {
  if (!grouped || typeof grouped !== "object") return []
  return Object.values(grouped)
    .flatMap((group) => (Array.isArray(group) ? group : []))
    .filter((hit): hit is Record<string, any> => !!hit && typeof hit === "object")
}

/** 0 exact, 1 starts with what was typed, 2 contains it, null unrelated. */
function rank(key: string, wanted: string): number | null {
  if (!key || !wanted) return null
  if (key === wanted) return 0
  if (key.startsWith(wanted)) return 1
  if (key.includes(wanted)) return 2
  return null
}

/**
 * Aircraft the query could mean, exact first, then those it begins, then those
 * it is inside (a pilot may remember a tail by its last letters). An
 * `aircraft` hit carries the airframe (`id` is the registration, `detail.equip`
 * the type, `detail.hex` the transponder); a `live` hit is a flight in the air
 * and carries its registration and type in `detail.reg` / `detail.ac_type`.
 * One row per registration; the airframe's own fields win where both answer.
 */
export function aircraftCandidates(grouped: Grouped, query: string, limit = 20): AircraftCandidate[] {
  const wanted = normalizeRegistration(query)
  const byKey = new Map<string, AircraftCandidate & { rank: number }>()

  for (const hit of hits(grouped)) {
    const detail = (hit.detail && typeof hit.detail === "object" ? hit.detail : {}) as Record<string, unknown>
    const isAircraft = hit.type === "aircraft"
    const registration = (isAircraft ? str(hit.id) : hit.type === "live" ? str(detail.reg) : "").toUpperCase()
    const key = normalizeRegistration(registration)
    const r = rank(key, wanted)
    if (r === null) continue

    const row = {
      registration,
      icao24: str(detail.hex).toUpperCase(),
      typecode: str(isAircraft ? detail.equip : detail.ac_type).toUpperCase(),
      operator: str(isAircraft ? detail.owner : ""),
      source: "fr24" as const,
      exact: r === 0,
      rank: r,
    }
    const seen = byKey.get(key)
    if (!seen) {
      byKey.set(key, row)
      continue
    }
    // An airframe hit describes the aeroplane itself, so its fields win; a
    // live flight's only fill what the airframe left blank.
    const [first, second] = isAircraft ? [row, seen] : [seen, row]
    byKey.set(key, {
      ...seen,
      registration: first.registration || second.registration,
      icao24: first.icao24 || second.icao24,
      typecode: first.typecode || second.typecode,
      operator: first.operator || second.operator,
    })
  }

  return [...byKey.values()]
    .sort((a, b) => a.rank - b.rank || a.registration.localeCompare(b.registration))
    .slice(0, limit)
    .map(({ rank: _rank, ...candidate }) => candidate)
}

/**
 * Airports the query could mean. An airport hit carries its codes only in the
 * label — "Singapore Changi Airport (SIN / WSSS)" — the same reading the
 * Worker's own `airportFromSearchHit` makes. Matched against either code, and
 * the NAME too when the query is no code at all.
 */
export function airportCandidates(grouped: Grouped, query: string, limit = 20): AirportCandidate[] {
  const wanted = query.trim().toUpperCase()
  const byIcao = new Map<string, AirportCandidate & { rank: number }>()

  for (const hit of hits(grouped)) {
    if (hit.type !== "airport") continue
    const label = str(hit.label)
    const codes = label.match(/\(([A-Z0-9]{3})?\s*\/\s*([A-Z0-9]{4})?\)\s*$/i)
    const iata = (codes?.[1] || "").toUpperCase()
    const icao = (codes?.[2] || "").toUpperCase()
    if (!icao) continue
    const name = label.replace(/\s*\([^)]*\)\s*$/, "")
    const byCode = Math.min(rank(icao, wanted) ?? 9, rank(iata, wanted) ?? 9)
    const r = byCode < 9 ? byCode : name.toUpperCase().includes(wanted) ? 3 : null
    if (r === null || byIcao.has(icao)) continue
    const detail = (hit.detail && typeof hit.detail === "object" ? hit.detail : {}) as Record<string, unknown>
    byIcao.set(icao, {
      icao,
      iata,
      name,
      latitude: num(detail.lat),
      longitude: num(detail.lon),
      exact: r === 0,
      rank: r,
    })
  }

  return [...byIcao.values()]
    .sort((a, b) => a.rank - b.rank || a.icao.localeCompare(b.icao))
    .slice(0, limit)
    .map(({ rank: _rank, ...candidate }) => candidate)
}
