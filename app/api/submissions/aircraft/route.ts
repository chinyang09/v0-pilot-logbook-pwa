/**
 * Aircraft submission API
 *
 * POST /api/submissions/aircraft
 * Body: { submissionId, registration, typecode?, icao24?, operator? }
 *
 * - Validates session (authenticated users only)
 * - Deduplicates by normalized registration
 * - If new: inserts as pending, then immediately attempts FR24 enrichment
 * - Returns enriched data if available
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/auth/server/session"
import { enrichAircraftFromFR24 } from "@/lib/enrichment/aircraft-enrichment"

function normalizeRegistration(reg: string): string {
  return reg.replace(/[^A-Z0-9]/gi, "").toUpperCase()
}

export async function POST(request: Request) {
  const session = await validateSessionFromHeader(request)
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })
  }

  const { submissionId, registration, typecode, icao24, operator } = body
  if (!submissionId || !registration) {
    return NextResponse.json(
      { error: "submissionId and registration are required" },
      { status: 400 }
    )
  }

  const regNormalized = normalizeRegistration(registration)
  const client = await getMongoClient()
  const db = client.db("skylog")
  const collection = db.collection("aircraftSubmissions")

  // Dedup: check if this registration already exists
  const existing = await collection.findOne({ registrationNormalized: regNormalized })
  if (existing) {
    return NextResponse.json({
      success: true,
      data: {
        submissionId: existing.submissionId,
        status: existing.status,
        enrichedData: existing.status === "enriched"
          ? {
              registration: existing.registration,
              icao24: existing.icao24 || "",
              typecode: existing.typecode || "",
              operator: existing.operator || "",
            }
          : null,
      },
    })
  }

  // Insert new submission
  const now = Date.now()
  const doc = {
    submissionId,
    registration: registration.toUpperCase().trim(),
    registrationNormalized: regNormalized,
    typecode: typecode || "",
    icao24: icao24 || "",
    operator: operator || "",
    status: "pending" as const,
    submittedBy: session.userId,
    submittedAt: now,
  }

  await collection.insertOne(doc)

  // Attempt real-time FR24 enrichment
  const enriched = await enrichAircraftFromFR24(registration)
  if (enriched) {
    await collection.updateOne(
      { submissionId },
      {
        $set: {
          registration: enriched.registration,
          icao24: enriched.icao24,
          typecode: enriched.typecode || typecode || "",
          operator: enriched.operator,
          status: "enriched",
          enrichedAt: Date.now(),
          enrichmentSource: "fr24",
        },
      }
    )

    return NextResponse.json({
      success: true,
      data: {
        submissionId,
        status: "enriched",
        enrichedData: {
          registration: enriched.registration,
          icao24: enriched.icao24,
          typecode: enriched.typecode || typecode || "",
          operator: enriched.operator,
        },
      },
    })
  }

  // FR24 failed — stays pending for batch retry
  return NextResponse.json({
    success: true,
    data: {
      submissionId,
      status: "pending",
      enrichedData: null,
    },
  })
}
