/**
 * OurAirports (https://ourairports.com/data/, public domain) as the airport
 * lookup's last tier, server-only.
 *
 * FR24 now challenges every airport endpoint from the gateway Worker, so an
 * airport missing from the bundled `airports.min.json` had no source at all.
 * OurAirports publishes ~86k airports as one CSV, refreshed daily on GitHub's
 * CDN, with no bot wall in front of it. It carries ICAO / IATA / GPS codes,
 * position and elevation but NO timezone — the caller derives that from the
 * coordinates, as it does for every other source that omits one.
 *
 * The CSV (~13MB) is downloaded once per warm instance and indexed; callers
 * that get a result submit it to the MongoDB cache, so another user's lookup
 * of the same code is a cache hit and never reaches this module.
 */

import type { EnrichedAirport } from "@/app/api/search/airport/shared"

export const OPEN_DATA_AIRPORTS_URL = "https://davidmegginson.github.io/ourairports-data/airports.csv"

const INDEX_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_BACKOFF_MS = 5 * 60 * 1000
const DOWNLOAD_TIMEOUT_MS = 10_000

/** Which kind of place wins when two share a code. Closed airports are never indexed. */
const TYPE_RANK: Record<string, number> = {
  large_airport: 6,
  medium_airport: 5,
  small_airport: 4,
  seaplane_base: 3,
  heliport: 2,
  balloonport: 1,
}

type Row = {
  ident: string
  type: string
  name: string
  latitude: number
  longitude: number
  elevationFt: number
  country: string
  municipality: string
  scheduled: boolean
  icao: string
  iata: string
  gps: string
}

export type OpenDataIndex = {
  /** 4-character codes: `icao_code`, then `gps_code`, then the ident. */
  icao: Map<string, Row>
  iata: Map<string, Row>
}

/** RFC 4180 rows — quoted fields may hold commas, doubled quotes and newlines. */
export function* parseCsv(text: string): Generator<string[]> {
  let field = ""
  let row: string[] = []
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ",") {
      row.push(field)
      field = ""
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      yield row
      row = []
      field = ""
    } else field += c
  }
  if (field || row.length) {
    row.push(field)
    yield row
  }
}

const isIcaoLike = (code: string) => /^[A-Z0-9]{4}$/.test(code)
const isIataLike = (code: string) => /^[A-Z0-9]{3}$/.test(code)

/** Better of two rows for one code: a bigger airport, then one with scheduled service. */
function outranks(a: Row, b: Row): boolean {
  const rank = (TYPE_RANK[a.type] ?? 0) - (TYPE_RANK[b.type] ?? 0)
  if (rank !== 0) return rank > 0
  return a.scheduled && !b.scheduled
}

export function buildOpenDataIndex(csv: string): OpenDataIndex {
  const icao = new Map<string, Row>()
  const iata = new Map<string, Row>()
  // An airport's own icao_code outranks another place that merely uses the
  // same string as its GPS code or ident, whatever their sizes.
  const icaoTier = new Map<string, number>()

  const rows = parseCsv(csv)
  const header = rows.next().value
  if (!header) return { icao, iata }
  const col = (name: string) => header.indexOf(name)
  const at = {
    ident: col("ident"),
    type: col("type"),
    name: col("name"),
    lat: col("latitude_deg"),
    lon: col("longitude_deg"),
    elev: col("elevation_ft"),
    country: col("iso_country"),
    municipality: col("municipality"),
    scheduled: col("scheduled_service"),
    icao: col("icao_code"),
    iata: col("iata_code"),
    gps: col("gps_code"),
  }

  for (const cells of rows) {
    const type = cells[at.type] ?? ""
    if (!type || type === "closed") continue
    const latitude = Number(cells[at.lat])
    const longitude = Number(cells[at.lon])
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue

    const up = (i: number) => (cells[i] ?? "").trim().toUpperCase()
    const row: Row = {
      ident: up(at.ident),
      type,
      name: cells[at.name] ?? "",
      latitude,
      longitude,
      elevationFt: Number(cells[at.elev]) || 0,
      country: up(at.country),
      municipality: cells[at.municipality] ?? "",
      scheduled: cells[at.scheduled] === "yes",
      icao: up(at.icao),
      iata: up(at.iata),
      gps: up(at.gps),
    }

    const claims: [string, number][] = [
      [row.icao, 3],
      [row.gps, 2],
      [row.ident, 1],
    ]
    for (const [code, tier] of claims) {
      if (!isIcaoLike(code)) continue
      const held = icao.get(code)
      const heldTier = icaoTier.get(code) ?? 0
      if (!held || tier > heldTier || (tier === heldTier && outranks(row, held))) {
        icao.set(code, row)
        icaoTier.set(code, tier)
      }
    }
    if (isIataLike(row.iata)) {
      const held = iata.get(row.iata)
      if (!held || outranks(row, held)) iata.set(row.iata, row)
    }
  }
  return { icao, iata }
}

let regionNames: Intl.DisplayNames | null | undefined
function countryName(code: string): string {
  if (!code) return ""
  if (regionNames === undefined) {
    try {
      regionNames = new Intl.DisplayNames(["en"], { type: "region" })
    } catch {
      regionNames = null
    }
  }
  try {
    return regionNames?.of(code) || code
  } catch {
    return code
  }
}

/**
 * The airport for an ICAO (4 characters) or IATA (3) code, in the route's
 * shape. `timezone` is always "" — derive it from the coordinates.
 */
export function lookupOpenData(index: OpenDataIndex, code: string): EnrichedAirport | null {
  const key = code.trim().toUpperCase()
  const row = isIcaoLike(key) ? index.icao.get(key) : isIataLike(key) ? index.iata.get(key) : undefined
  if (!row) return null
  return {
    icao: row.icao || (isIcaoLike(row.gps) ? row.gps : "") || (isIcaoLike(row.ident) ? row.ident : "") || (isIcaoLike(key) ? key : ""),
    iata: row.iata,
    name: row.name,
    city: row.municipality,
    country: countryName(row.country),
    countryCode: row.country,
    latitude: row.latitude,
    longitude: row.longitude,
    elevation: row.elevationFt,
    timezone: "",
  }
}

let held: { index: OpenDataIndex; at: number } | null = null
let loading: Promise<OpenDataIndex | null> | null = null
let failedAt = 0

/** The index, downloaded once per warm instance. `null` while the source is unreachable. */
export async function loadOpenDataIndex(): Promise<OpenDataIndex | null> {
  if (held && Date.now() - held.at < INDEX_TTL_MS) return held.index
  if (Date.now() - failedAt < FAILURE_BACKOFF_MS) return held?.index ?? null
  loading ??= (async () => {
    try {
      const response = await fetch(OPEN_DATA_AIRPORTS_URL, {
        cache: "no-store",
        signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const index = buildOpenDataIndex(await response.text())
      if (index.icao.size === 0) throw new Error("empty dataset")
      held = { index, at: Date.now() }
      return index
    } catch (err) {
      failedAt = Date.now()
      console.warn("[Airport Search] open data unavailable:", (err as Error).message)
      // A stale index beats none.
      return held?.index ?? null
    } finally {
      loading = null
    }
  })()
  return loading
}

export async function findOpenDataAirport(code: string): Promise<EnrichedAirport | null> {
  const index = await loadOpenDataIndex()
  return index ? lookupOpenData(index, code) : null
}
