/**
 * The shared aircraft pool — NODE (MongoDB).
 *
 * POST /api/lookup/pool/aircraft
 * Body: { registrations: ["9VSWA", "N12345", ...] }
 *
 * Checks aircraftSubmissions (status: "enriched") for matching registrations,
 * keyed by `normalizeRegistration`. Returns all matches in a single response.
 * Includes ICAO type hydration fields (shortDescription, WTC, WTG). Browser
 * callers go through `lookup.poolAircraft` (`lib/lookup/client.ts`).
 *
 * Under `/api/lookup` but not behind its sign-in rule: that rule protects the
 * gateway Worker's quota, and this spends none — it reads reference data other
 * pilots already added. It was `/api/search/aircraft/batch`, unauthenticated.
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { normalizeRegistration } from "@/lib/utils/string"
import type { PooledAircraft } from "@/lib/lookup/types"

export async function POST(request: Request) {
  let body: { registrations?: string[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { registrations } = body
  if (!registrations || !Array.isArray(registrations) || registrations.length === 0) {
    return NextResponse.json({ results: {} })
  }

  // Cap at 100 to prevent abuse; drop non-string elements so normalizeRegistration
  // can't throw a TypeError → 500 on a malformed array.
  const regsToCheck = registrations.filter((r): r is string => typeof r === "string").slice(0, 100)
  const normalizedRegs = regsToCheck.map(normalizeRegistration)

  try {
    const client = await getMongoClient()
    const db = client.db("skylog")
    const collection = db.collection("aircraftSubmissions")

    const enrichedDocs = await collection
      .find({
        status: "enriched",
        registrationNormalized: { $in: normalizedRegs },
      })
      .project({
        registrationNormalized: 1,
        registration: 1,
        typecode: 1,
        icao24: 1,
        operator: 1,
        shortDescription: 1,
        wtc: 1,
        wtg: 1,
        manufacturerCode: 1,
      })
      .toArray()

    // Build result map keyed by normalized registration
    const results: Record<string, PooledAircraft> = {}

    for (const doc of enrichedDocs) {
      results[doc.registrationNormalized] = {
        registration: doc.registration || "",
        typecode: doc.typecode || "",
        icao24: doc.icao24 || "",
        operator: doc.operator || "",
        shortDescription: doc.shortDescription || "",
        wtc: doc.wtc || "",
        wtg: doc.wtg || "",
        manufacturerCode: doc.manufacturerCode || "",
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    // Not "nobody has it": the pool could not be read. The client answers
    // null for this (`lookup.pool*`), and the caller goes on to the gateway.
    console.error("[Aircraft Pool] MongoDB error:", error)
    return NextResponse.json({ error: "Pool unavailable" }, { status: 503 })
  }
}
