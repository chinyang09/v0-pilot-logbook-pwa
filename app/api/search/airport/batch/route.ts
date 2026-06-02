/**
 * Batch airport lookup from MongoDB enriched submissions
 *
 * POST /api/search/airport/batch
 * Body: { codes: ["WSSS", "SIN", "WMKK", "KUL", ...] }
 *
 * Each code is matched against EITHER icao or iata so callers can mix
 * the two without converting. Results are keyed by the caller's original
 * code (uppercased), so a request with both "WSSS" and "SIN" returns two
 * entries that happen to point at the same airport.
 *
 * Mirrors /api/search/aircraft/batch — checks airportSubmissions
 * (status: "enriched") and returns enriched data. No auth required
 * (reference data).
 *
 * Staleness: records older than AIRPORT_CACHE_TTL_MS are excluded so the
 * caller falls through to FR24 and refreshes the cache. Airport reference
 * data (lat/lng, name, country, timezone) is unusually stable, so 180 days
 * is the default — comfortably catches policy-level timezone changes
 * within a half-year without hammering FR24.
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"

export const AIRPORT_CACHE_TTL_MS = 180 * 24 * 60 * 60 * 1000 // 180 days

export type EnrichedAirport = {
  icao: string
  iata: string
  name: string
  city: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  elevation: number
  timezone: string
}

export async function POST(request: Request) {
  let body: { codes?: string[]; icaos?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  // Accept either `codes` (mixed ICAO/IATA — preferred) or the older
  // `icaos` shape for backward compatibility.
  const rawCodes = body.codes || body.icaos
  if (!rawCodes || !Array.isArray(rawCodes) || rawCodes.length === 0) {
    return NextResponse.json({ results: {} })
  }

  const codes = rawCodes
    .slice(0, 200)
    .map((c) => c.toUpperCase().trim())
    .filter(Boolean)

  if (codes.length === 0) {
    return NextResponse.json({ results: {} })
  }

  try {
    const client = await getMongoClient()
    const db = client.db("skylog")
    const collection = db.collection("airportSubmissions")

    const minEnrichedAt = Date.now() - AIRPORT_CACHE_TTL_MS

    const enrichedDocs = await collection
      .find({
        status: "enriched",
        enrichedAt: { $gte: minEnrichedAt },
        $or: [
          { icao: { $in: codes } },
          { iata: { $in: codes } },
        ],
      })
      .project({
        icao: 1,
        name: 1,
        iata: 1,
        city: 1,
        country: 1,
        latitude: 1,
        longitude: 1,
        elevation: 1,
        timezone: 1,
        enrichedTimezone: 1,
      })
      .toArray()

    // Index docs by both their icao and iata so callers get the same
    // airport back regardless of which code they sent.
    const results: Record<string, EnrichedAirport> = {}
    const codeSet = new Set(codes)

    for (const doc of enrichedDocs) {
      const airport: EnrichedAirport = {
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
      }
      if (doc.icao && codeSet.has(doc.icao)) {
        results[doc.icao] = airport
      }
      if (doc.iata && codeSet.has(doc.iata)) {
        results[doc.iata] = airport
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error("[Batch Airport Search] MongoDB error:", error)
    return NextResponse.json({ results: {} })
  }
}
