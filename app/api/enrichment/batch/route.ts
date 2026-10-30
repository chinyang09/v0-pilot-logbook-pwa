/**
 * Batch enrichment API
 *
 * GET  /api/enrichment/batch  — Vercel Cron (`vercel.json`; Cron only sends GET)
 * POST /api/enrichment/batch  — manual invocation (admin)
 *
 * Processes pending aircraft and airport submissions.
 *
 * There was no cron behind this for its whole life — no `vercel.json`, and the
 * route took POST only, which Vercel Cron never sends — so a registration FR24
 * missed at submission stayed `pending` and out of the shared pool for good.
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

// Bound the function's wall clock (each FR24 call can take up to 8s).
export const maxDuration = 60

const MAX_AIRCRAFT_PER_RUN = 20
const MAX_AIRPORTS_PER_RUN = 50
// A registration FR24 does not know yet is usually an aeroplane not yet
// delivered or not yet flying, so it is asked again at a widening interval —
// 1, 2, 4, 8, 16, 32 days — rather than given up on after three daily tries.
const MAX_RETRIES = 6
const DAY_MS = 24 * 60 * 60 * 1000
const retryDue = (doc: Record<string, unknown>, now: number) =>
  now - Number(doc.lastRetryAt ?? 0) >= 2 ** Number(doc.retryCount ?? 0) * DAY_MS
// Stop starting new FR24 lookups past this point so the run finishes cleanly
// within maxDuration; unprocessed pending docs are simply retried next run.
const AIRCRAFT_TIME_BUDGET_MS = 45_000

export async function GET(request: Request) {
  return runBatch(request)
}

export async function POST(request: Request) {
  return runBatch(request)
}

async function runBatch(request: Request) {
  // Auth: Vercel Cron sends `Authorization: Bearer $CRON_SECRET`.
  const authHeader = request.headers.get("authorization")
  const cronSecret = process.env.CRON_SECRET

  // Fail closed: if no secret is configured, the endpoint must not be open.
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const startedAt = Date.now()
  const client = await getMongoClient()
  const db = client.db("skylog")
  const results = { aircraft: { processed: 0, enriched: 0, failed: 0, unavailable: 0 }, airport: { processed: 0, enriched: 0 } }

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
    .sort({ lastRetryAt: 1, submittedAt: 1 })
    .limit(MAX_AIRCRAFT_PER_RUN * 5)
    .toArray()
    .then((docs) => docs.filter((d) => retryDue(d, startedAt)).slice(0, MAX_AIRCRAFT_PER_RUN))

  for (const doc of pendingAircraft) {
    // Leave the rest pending (retryCount untouched) for the next run rather than
    // risk the platform killing the function mid-write.
    if (Date.now() - startedAt > AIRCRAFT_TIME_BUDGET_MS) break
    results.aircraft.processed++
    // No user request here, so the lookup goes to the production domain.
    const lookup = await enrichAircraftFromFR24(doc.registration)
    const enriched = lookup.status === "found" ? lookup.data : null

    if (lookup.status === "unavailable") {
      // The lookup could not be made (a challenge, a timeout). That is not
      // evidence the aircraft is unknown, so its retries are left alone —
      // counting these is what marked submissions "failed" while every
      // lookup from Node was being challenged.
      results.aircraft.unavailable++
      continue
    }

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
