/**
 * Batch aircraft lookup from MongoDB enriched submissions
 *
 * POST /api/search/aircraft/batch
 * Body: { registrations: ["9VSWA", "N12345", ...] }
 *
 * Checks aircraftSubmissions (status: "enriched") for matching registrations.
 * Returns all matches in a single response — no auth required (reference data).
 * Includes ICAO type hydration fields (shortDescription, WTC, WTG).
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { normalizeRegistration } from "@/lib/utils/string"

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

  // Cap at 100 to prevent abuse
  const regsToCheck = registrations.slice(0, 100)
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
    const results: Record<string, {
      registration: string
      typecode: string
      icao24: string
      operator: string
      shortDescription: string
      wtc: string
      wtg: string
      manufacturerCode: string
    }> = {}

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
    console.error("[Batch Aircraft Search] MongoDB error:", error)
    return NextResponse.json({ results: {} })
  }
}
