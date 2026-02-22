/**
 * Batch aircraft lookup from MongoDB enriched submissions
 *
 * POST /api/search/aircraft/batch
 * Body: { registrations: ["9VSWA", "N12345", ...] }
 *
 * Checks aircraftSubmissions (status: "enriched") for matching registrations.
 * Returns all matches in a single response — no auth required (reference data).
 *
 * This allows the CSV import (and any other consumer) to check the shared
 * enriched database for aircraft that other users have already submitted
 * and had enriched via FR24.
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"

function normalizeRegistration(reg: string): string {
  return reg.replace(/[^A-Z0-9]/gi, "").toUpperCase()
}

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
      })
      .toArray()

    // Build result map keyed by normalized registration
    const results: Record<string, {
      registration: string
      typecode: string
      icao24: string
      operator: string
    }> = {}

    for (const doc of enrichedDocs) {
      results[doc.registrationNormalized] = {
        registration: doc.registration || "",
        typecode: doc.typecode || "",
        icao24: doc.icao24 || "",
        operator: doc.operator || "",
      }
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error("[Batch Aircraft Search] MongoDB error:", error)
    return NextResponse.json({ results: {} })
  }
}
