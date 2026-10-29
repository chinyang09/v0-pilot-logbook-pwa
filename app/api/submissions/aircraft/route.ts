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
import type { Document } from "mongodb"
import { getMongoClient } from "@/lib/mongodb"
import { validateRequestSession, assertSameOrigin } from "@/lib/auth/server/session"
import { enrichAircraftFromFR24 } from "@/lib/enrichment/aircraft-enrichment"
import { getICAOTypeByDesignator } from "@/lib/icao-types/icao-types-server"
import { normalizeRegistration } from "@/lib/utils/string"

/** How long a lookup that came back empty is left before a submit retries it. */
const RETRY_AFTER_MS = 60 * 60 * 1000

/**
 * An existing submission that never enriched is looked up again when it is
 * submitted again, at most hourly. It used to be answered `pending` from the
 * stored doc forever: the batch job that was meant to retry it had no cron
 * behind it, so a registration FR24 missed once (9V-TNL, four months) never
 * reached the shared pool — and so never reached any device's aircraft list.
 */
function dueForRetry(doc: Document, now: number): boolean {
  if (doc.status === "enriched") return false
  const last = Number(doc.lastRetryAt ?? doc.submittedAt ?? 0)
  return now - last >= RETRY_AFTER_MS
}

export async function POST(request: Request) {
  if (!assertSameOrigin(request)) {
    return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403 })
  }
  const session = await validateRequestSession(request)
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
  // Type-check before any string ops (normalizeRegistration/.toUpperCase) so a
  // non-string body field yields a clean 400 rather than a 500 TypeError.
  if (
    typeof submissionId !== "string" ||
    !submissionId.trim() ||
    typeof registration !== "string" ||
    !registration.trim()
  ) {
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

  // The submission this request answers for: the new one, or the one that
  // already holds this registration.
  let canonicalId = submissionId
  if (!upsertResult || upsertResult.upsertedCount === 0) {
    // Already existed (or lost the insert race).
    const existing = await collection.findOne({ registrationNormalized: regNormalized })
    if (existing && !dueForRetry(existing, now)) return existingResponse(existing)
    if (existing) canonicalId = existing.submissionId
  }

  // Attempt real-time enrichment (includes ICAO type hydration), handed to
  // the Edge lookup route on this deployment with the user's cookies.
  const lookup = await enrichAircraftFromFR24(registration, request)
  const enriched = lookup.status === "found" ? lookup.data : null
  if (lookup.status === "not_found" && canonicalId !== submissionId) {
    // A retry that found nothing still counts, so a registration FR24 does
    // not know is not looked up on every submit. A lookup that could not be
    // MADE (`unavailable`) is not a retry: it says nothing about the aircraft.
    await collection.updateOne(
      { registrationNormalized: regNormalized },
      { $set: { lastRetryAt: now }, $inc: { retryCount: 1 } }
    )
  }
  if (enriched) {
    const finalTypecode = enriched.typecode || typecode || ""

    await collection.updateOne(
      { registrationNormalized: regNormalized },
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
        submissionId: canonicalId,
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
      submissionId: canonicalId,
      status: "pending",
      enrichedData: null,
    },
  })
}
