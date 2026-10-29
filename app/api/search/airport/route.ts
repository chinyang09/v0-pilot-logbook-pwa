/**
 * Server-side proxy for FR24 airport lookup with MongoDB cache tier
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/airport?q=WARR
 * GET /api/search/airport?q=WARR&debug=1   ← surfaces the upstream payload
 *
 * Lookup order:
 *   1. MongoDB cache (airportSubmissions, status=enriched, enrichedAt fresh)
 *   2. The FR24 gateway Worker's `/airport` (when FR24_PROXY_URL is set) — its
 *      own chain: airport.json + traffic-stats, then the airport list + search
 *   3. traffic-stats directly — no Worker configured, or a Worker deployment
 *      that predates `/airport` (it answers that route 400)
 *   4. OurAirports open data (`lib/airports/open-data.ts`) when FR24 gave
 *      nothing — as of 29 Oct 2026 FR24 challenges every airport endpoint
 *      from the Worker, so this is what answers a code the bundled dataset
 *      lacks. `source: "open-data"`; the caller caches it like any other.
 *
 * A source that gives coordinates but no timezone (the Worker's list and
 * search tiers, open data) has its zone derived here with geo-tz. The client stores a
 * blank zone as "UTC", which would put every local time at that airport out.
 *
 * Cache hits skip FR24 entirely. Stale records (enrichedAt older than
 * AIRPORT_CACHE_TTL_MS) are treated as misses so FR24 can refresh them.
 *
 * Switched from edge → nodejs runtime so we can use the MongoDB driver.
 * The Edge runtime previously helped slip past Cloudflare's bot challenge
 * via TLS fingerprint differences, but the Worker proxy now handles that
 * concern in production, so Node is fine here.
 */

import { NextResponse } from "next/server"
import { find as findTimezones } from "geo-tz"
import { getMongoClient } from "@/lib/mongodb"
import { callFr24Worker, fr24WorkerConfigured } from "@/lib/fr24/worker-client"
import { findOpenDataAirport } from "@/lib/airports/open-data"
import { AIRPORT_CACHE_TTL_MS, type EnrichedAirport } from "./shared"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const revalidate = 0
export const fetchCache = "force-no-store"

type AirportResult = EnrichedAirport

async function fetchFromCache(query: string): Promise<{
  result: AirportResult | null
  error?: string
}> {
  try {
    const client = await getMongoClient()
    const db = client.db("skylog")
    const collection = db.collection("airportSubmissions")

    const minEnrichedAt = Date.now() - AIRPORT_CACHE_TTL_MS
    const code = query.toUpperCase().trim()

    // Match either ICAO (typical 4-letter) or IATA (typical 3-letter).
    // FR24 accepts both forms in the same query param, so we mirror that.
    const doc = await collection.findOne({
      status: "enriched",
      enrichedAt: { $gte: minEnrichedAt },
      $or: [{ icao: code }, { iata: code }],
    })

    if (!doc) return { result: null }

    return {
      result: {
        icao: doc.icao || "",
        iata: doc.iata || "",
        name: doc.name || "",
        city: doc.city || "",
        country: doc.country || "",
        countryCode: doc.country || "",
        latitude: doc.latitude ?? 0,
        longitude: doc.longitude ?? 0,
        elevation: doc.elevation ?? 0,
        timezone: doc.enrichedTimezone || doc.timezone || "",
      },
    }
  } catch (err) {
    return {
      result: null,
      error: `cache lookup failed: ${(err as Error).message}`,
    }
  }
}

/**
 * The Worker's normalized `/airport`. `legacy: true` when the deployed Worker
 * predates that route, so the caller falls back to the passthrough.
 */
async function fetchViaWorker(query: string): Promise<{
  result: AirportResult | null
  legacy: boolean
  status: number
  source?: string
  error?: string
}> {
  const answer = await callFr24Worker("airport", { code: query })
  if (answer.ok) {
    const { timezoneOffsetSeconds: _offset, ...airport } = answer.data
    return { result: airport, legacy: false, status: answer.status, source: answer.source }
  }
  return {
    result: null,
    legacy: answer.status === 400 && /path not allowed/i.test(answer.error),
    status: answer.status,
    error: answer.error,
  }
}

/** Fill a blank timezone from the coordinates. Never throws. */
function withTimezone(airport: AirportResult): AirportResult {
  if (airport.timezone) return airport
  if (!Number.isFinite(airport.latitude) || !Number.isFinite(airport.longitude)) return airport
  if (airport.latitude === 0 && airport.longitude === 0) return airport
  try {
    const zone = findTimezones(airport.latitude, airport.longitude)[0]
    return zone ? { ...airport, timezone: zone } : airport
  } catch {
    return airport
  }
}

/** The open-data tier, with its zone derived. Never throws. */
async function fromOpenData(code: string): Promise<AirportResult | null> {
  try {
    const airport = await findOpenDataAirport(code)
    return airport ? withTimezone(airport) : null
  } catch {
    return null
  }
}

async function fetchFr24Airport(query: string): Promise<{
  ok: boolean
  status: number
  contentType: string
  bodyLength: number
  bodySnippet: string
  data: any
  result: AirportResult | null
  error?: string
  via: "direct" | "worker"
}> {
  const proxyUrl = process.env.FR24_PROXY_URL
  const proxySecret = process.env.FR24_PROXY_SECRET
  const via: "direct" | "worker" = proxyUrl ? "worker" : "direct"

  const upstreamUrl = proxyUrl
    ? `${proxyUrl.replace(/\/$/, "")}/airports/traffic-stats/?airport=${encodeURIComponent(query)}`
    : `https://www.flightradar24.com/airports/traffic-stats/?airport=${encodeURIComponent(query)}`

  const headers: Record<string, string> = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json, text/plain, */*",
  }
  if (proxyUrl && proxySecret) {
    headers["x-proxy-secret"] = proxySecret
  }

  try {
    const response = await fetch(upstreamUrl, {
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    })

    const contentType = response.headers.get("content-type") || ""
    const body = await response.text()

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        result: null,
        error: `HTTP ${response.status}`,
        via,
      }
    }

    let data: any = null
    try {
      data = body ? JSON.parse(body) : null
    } catch (err) {
      return {
        ok: true,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data: null,
        result: null,
        error: `JSON parse failed: ${(err as Error).message}`,
        via,
      }
    }

    const details = data?.details
    if (!details?.code?.icao) {
      return {
        ok: true,
        status: response.status,
        contentType,
        bodyLength: body.length,
        bodySnippet: body.slice(0, 500),
        data,
        result: null,
        via,
      }
    }

    const result: AirportResult = {
      icao: details.code.icao || "",
      iata: details.code.iata || "",
      name: details.name || "",
      city: details.position?.region?.city || "",
      country: details.position?.country?.name || "",
      countryCode: details.position?.country?.code || "",
      latitude: details.position?.latitude ?? 0,
      longitude: details.position?.longitude ?? 0,
      elevation: details.position?.altitude ?? 0,
      timezone: details.timezone?.name || "",
    }

    return {
      ok: true,
      status: response.status,
      contentType,
      bodyLength: body.length,
      bodySnippet: body.slice(0, 500),
      data,
      result,
      via,
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bodyLength: 0,
      bodySnippet: "",
      data: null,
      result: null,
      error: `fetch threw: ${(err as Error).name}: ${(err as Error).message}`,
      via,
    }
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const query = searchParams.get("q")
  // Debug surfaces raw upstream payloads — gate behind an operator env flag so
  // arbitrary callers can't read upstream response bodies in production.
  const debug = process.env.FR24_DEBUG === "1" && searchParams.get("debug") === "1"

  if (!query || query.length < 3) {
    return NextResponse.json({ result: null })
  }

  const normalized = query.toUpperCase()

  // 1. Try MongoDB cache first
  const cached = await fetchFromCache(normalized)
  if (cached.result) {
    console.log(
      "[Airport Search]",
      JSON.stringify({ query, source: "cache", icao: cached.result.icao })
    )
    if (debug) {
      return NextResponse.json({
        result: cached.result,
        source: "cache",
        debug: { query, source: "cache" },
      })
    }
    return NextResponse.json({ result: cached.result, source: "cache" })
  }

  // 2. Cache miss / stale → the Worker's chain
  if (fr24WorkerConfigured()) {
    const viaWorker = await fetchViaWorker(normalized)
    if (!viaWorker.legacy) {
      let result = viaWorker.result ? withTimezone(viaWorker.result) : null
      let source: "fr24" | "open-data" | null = result ? "fr24" : null
      if (!result) {
        result = await fromOpenData(normalized)
        if (result) source = "open-data"
      }
      console.log(
        "[Airport Search]",
        JSON.stringify({
          query,
          source: source ?? "worker",
          tier: viaWorker.source,
          status: viaWorker.status,
          hasResult: !!result,
          derivedTimezone: !!result && !viaWorker.result?.timezone,
          cacheError: cached.error,
          error: viaWorker.error,
        })
      )
      if (debug) {
        return NextResponse.json({
          result,
          source,
          debug: { query, via: "worker", tier: viaWorker.source, status: viaWorker.status, error: viaWorker.error },
        })
      }
      return NextResponse.json({ result, source })
    }
  }

  // 3. No Worker, or one without `/airport` → traffic-stats
  const attempt = await fetchFr24Airport(normalized)
  if (attempt.result) attempt.result = withTimezone(attempt.result)
  let source: "fr24" | "open-data" | null = attempt.result ? "fr24" : null
  if (!attempt.result) {
    attempt.result = await fromOpenData(normalized)
    if (attempt.result) source = "open-data"
  }

  console.log(
    "[Airport Search]",
    JSON.stringify({
      query,
      source: source ?? "fr24",
      via: attempt.via,
      ok: attempt.ok,
      status: attempt.status,
      contentType: attempt.contentType,
      bodyLength: attempt.bodyLength,
      hasResult: !!attempt.result,
      cacheError: cached.error,
      error: attempt.error,
    })
  )

  if (debug) {
    return NextResponse.json({
      result: attempt.result,
      source,
      debug: {
        query,
        via: attempt.via,
        ok: attempt.ok,
        status: attempt.status,
        contentType: attempt.contentType,
        bodyLength: attempt.bodyLength,
        bodySnippet: attempt.bodySnippet,
        cacheError: cached.error,
        error: attempt.error,
      },
    })
  }

  return NextResponse.json({ result: attempt.result, source })
}
