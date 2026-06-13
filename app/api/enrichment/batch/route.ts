/**
 * Batch enrichment API
 *
 * POST /api/enrichment/batch
 *
 * Processes pending aircraft and airport submissions.
 * Designed to be triggered by:
 *   - Vercel cron
 *   - Manual invocation (admin)
 *
 * Aircraft: FR24 enrichment with retry tracking
 * Airports: geo-tz timezone derivation from coordinates
 *
 * Protected by a shared secret (CRON_SECRET env var).
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { enrichAircraftFromFR24 } from "@/lib/enrichment/aircraft-enrichment"
import { find } from "geo-tz"

const MAX_AIRCRAFT_PER_RUN = 20
const MAX_AIRPORTS_PER_RUN = 50
const MAX_RETRIES = 3

export async function POST(request: Request) {
  // Auth: check cron secret or admin session
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Fail closed: if no secret is configured, the endpoint must not be open.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const client = await getMongoClient()
  const db = client.db("skylog")
  const results = { aircraft: { processed: 0, enriched: 0, failed: 0 }, airport: { processed: 0, enriched: 0 } }

  // --- Aircraft batch enrichment ---
  const aircraftCol = db.collection("aircraftSubmissions")
  const pendingAircraft = await aircraftCol
    .find({
      status: "pending",
      $or: [
        { retryCount: { $exists: false } },
        { retryCount: { $lt: MAX_RETRIES } },
      ],
    })
    .sort({ submittedAt: 1 })
    .limit(MAX_AIRCRAFT_PER_RUN)
    .toArray()

  for (const doc of pendingAircraft) {
    results.aircraft.processed++
    const enriched = await enrichAircraftFromFR24(doc.registration)

    if (enriched) {
      await aircraftCol.updateOne(
        { _id: doc._id },
        {
          $set: {
            registration: enriched.registration,
            icao24: enriched.icao24,
            typecode: enriched.typecode || doc.typecode || "",
            operator: enriched.operator,
            status: "enriched",
            enrichedAt: Date.now(),
            enrichmentSource: "fr24",
          },
        }
      )
      results.aircraft.enriched++
    } else {
      const retryCount = (doc.retryCount || 0) + 1
      const updateFields: Record<string, unknown> = {
        retryCount,
        lastRetryAt: Date.now(),
      }
      if (retryCount >= MAX_RETRIES) {
        updateFields.status = "failed"
        updateFields.enrichmentError = "Max retries exceeded (FR24 not found)"
      }
      await aircraftCol.updateOne(
        { _id: doc._id },
        { $set: updateFields }
      )
      if (retryCount >= MAX_RETRIES) results.aircraft.failed++
    }
  }

  // --- Airport batch enrichment ---
  // For airports that have coordinates but no derived timezone
  const airportCol = db.collection("airportSubmissions")
  const pendingAirports = await airportCol
    .find({
      status: "pending",
      latitude: { $ne: 0 },
      longitude: { $ne: 0 },
    })
    .sort({ submittedAt: 1 })
    .limit(MAX_AIRPORTS_PER_RUN)
    .toArray()

  for (const doc of pendingAirports) {
    results.airport.processed++

    try {
      const timezones = find(doc.latitude, doc.longitude)
      if (timezones[0]) {
        await airportCol.updateOne(
          { _id: doc._id },
          {
            $set: {
              enrichedTimezone: timezones[0],
              status: "enriched",
              enrichedAt: Date.now(),
              enrichmentSource: "geo-tz",
            },
          }
        )
        results.airport.enriched++
      }
    } catch {
      // geo-tz lookup failed — skip, will retry next run
    }
  }

  return NextResponse.json({
    success: true,
    results,
  })
}
