/**
 * Aircraft submission API
 *
 * POST /api/submissions/aircraft
 * Body: { submissionId, registration, typecode?, icao24?, operator? }
 *
 * - Validates session (authenticated users only)
 * - Deduplicates by normalized registration
 * - If new: inserts as pending, then immediately attempts FR24 enrichment
 * - Hydrates with ICAO DOC 8643 type data (shortDescription, WTC, WTG)
 * - Returns enriched data if available
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/auth/server/session"
import { enrichAircraftFromFR24 } from "@/lib/enrichment/aircraft-enrichment"
import { getICAOTypeByDesignator } from "@/lib/icao-types/icao-types-server"

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

  const existingResponse = (existing: any) =>
    NextResponse.json({
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
              shortDescription: existing.shortDescription || "",
              wtc: existing.wtc || "",
              wtg: existing.wtg || "",
              manufacturerCode: existing.manufacturerCode || "",
            }
          : null,
      },
    })

  // Hydrate typecode with ICAO type data if available
  const typeInfo = typecode ? getICAOTypeByDesignator(typecode) : null

  // Insert new submission
  const now = Date.now()
  const doc = {
    submissionId,
    registration: registration.toUpperCase().trim(),
    registrationNormalized: regNormalized,
    typecode: typecode || "",
    icao24: icao24 || "",
    operator: operator || "",
    shortDescription: typeInfo?.description || "",
    wtc: typeInfo?.wtc || "",
    wtg: typeInfo?.wtg || "",
    manufacturerCode: typeInfo?.manufacturerCode || "",
    status: "pending" as const,
    submittedBy: session.userId,
    submittedAt: now,
  }

  // Atomic dedup: only inserts when no doc with this normalized registration
  // exists (relies on the unique index). Two concurrent submits can't both
  // create a record.
  const upsertResult = await collection.updateOne(
    { registrationNormalized: regNormalized },
    { $setOnInsert: doc },
    { upsert: true }
  ).catch((err: any) => {
    // Duplicate-key from a racing upsert — treat as "already exists".
    if (err?.code === 11000) return null
    throw err
  })

  if (!upsertResult || upsertResult.upsertedCount === 0) {
    // Already existed (or lost the insert race) — return the canonical doc.
    const existing = await collection.findOne({ registrationNormalized: regNormalized })
    if (existing) return existingResponse(existing)
  }

  // Attempt real-time FR24 enrichment (includes ICAO type hydration)
  const enriched = await enrichAircraftFromFR24(registration)
  if (enriched) {
    const finalTypecode = enriched.typecode || typecode || ""

    await collection.updateOne(
      { submissionId },
      {
        $set: {
          registration: enriched.registration,
          icao24: enriched.icao24,
          typecode: finalTypecode,
          operator: enriched.operator,
          shortDescription: enriched.shortDescription || typeInfo?.description || "",
          wtc: enriched.wtc || typeInfo?.wtc || "",
          wtg: enriched.wtg || typeInfo?.wtg || "",
          manufacturerCode: enriched.manufacturerCode || typeInfo?.manufacturerCode || "",
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
          typecode: finalTypecode,
          operator: enriched.operator,
          shortDescription: enriched.shortDescription || typeInfo?.description || "",
          wtc: enriched.wtc || typeInfo?.wtc || "",
          wtg: enriched.wtg || typeInfo?.wtg || "",
          manufacturerCode: enriched.manufacturerCode || typeInfo?.manufacturerCode || "",
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
