/**
 * Batch airport lookup from MongoDB enriched submissions
 *
 * POST /api/search/airport/batch
 * Body: { icaos: ["WSSS", "WMKK", ...] }
 *
 * Mirrors /api/search/aircraft/batch — checks airportSubmissions
 * (status: "enriched") for matching ICAO codes and returns a map keyed
 * by ICAO. No auth required (reference data).
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
  let body: { icaos?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { icaos } = body
  if (!icaos || !Array.isArray(icaos) || icaos.length === 0) {
    return NextResponse.json({ results: {} })
  }

  const icaosNormalized = icaos
    .slice(0, 100)
    .map((c) => c.toUpperCase().trim())
    .filter(Boolean)

  if (icaosNormalized.length === 0) {
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
        icao: { $in: icaosNormalized },
        enrichedAt: { $gte: minEnrichedAt },
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

    const results: Record<string, EnrichedAirport> = {}

    for (const doc of enrichedDocs) {
      results[doc.icao] = {
        icao: doc.icao,
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
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error("[Batch Airport Search] MongoDB error:", error)
    return NextResponse.json({ results: {} })
  }
}
