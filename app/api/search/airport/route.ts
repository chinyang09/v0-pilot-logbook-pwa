/**
 * Server-side proxy for FR24 airport lookup with MongoDB cache tier
 * Bypasses CORS restrictions on the unofficial FR24 API
 *
 * GET /api/search/airport?q=WARR
 * GET /api/search/airport?q=WARR&debug=1   ← surfaces the upstream payload
 *
 * Lookup order:
 *   1. MongoDB cache (airportSubmissions, status=enriched, enrichedAt fresh)
 *   2. FR24 live search (via Cloudflare Worker proxy when FR24_PROXY_URL set)
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
import { getMongoClient } from "@/lib/mongodb"
import { AIRPORT_CACHE_TTL_MS, type EnrichedAirport } from "./batch/route"

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
  const debug = searchParams.get("debug") === "1"

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

  // 2. Cache miss / stale → FR24
  const attempt = await fetchFr24Airport(normalized)

  console.log(
    "[Airport Search]",
    JSON.stringify({
      query,
      source: "fr24",
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
      source: attempt.result ? "fr24" : null,
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

  return NextResponse.json({
    result: attempt.result,
    source: attempt.result ? "fr24" : null,
  })
}
