/**
 * Airport submission API
 *
 * POST /api/submissions/airport
 * Body: { submissionId, icao, name?, iata?, city?, country?, timezone?, latitude?, longitude?, elevation? }
 *
 * - Validates session (authenticated users only)
 * - Deduplicates by ICAO code
 * - If coordinates provided, derives timezone via geo-tz
 * - Returns submission data
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"
import { validateSessionFromHeader } from "@/lib/auth/server/session"
import { find } from "geo-tz"

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

  const { submissionId, icao, name, iata, city, country, timezone, latitude, longitude, elevation } = body
  if (!submissionId || !icao) {
    return NextResponse.json(
      { error: "submissionId and icao are required" },
      { status: 400 }
    )
  }

  const icaoNormalized = icao.toUpperCase().trim()
  const client = await getMongoClient()
  const db = client.db("skylog")
  const collection = db.collection("airportSubmissions")

  // Dedup: check if this ICAO already exists
  const existing = await collection.findOne({ icao: icaoNormalized })
  if (existing) {
    return NextResponse.json({
      success: true,
      data: {
        submissionId: existing.submissionId,
        status: existing.status,
        enrichedData: existing.status === "enriched"
          ? {
              icao: existing.icao,
              name: existing.name || "",
              iata: existing.iata || "",
              city: existing.city || "",
              country: existing.country || "",
              latitude: existing.latitude ?? 0,
              longitude: existing.longitude ?? 0,
              elevation: existing.elevation ?? 0,
              timezone: existing.enrichedTimezone || existing.timezone || "",
            }
          : null,
      },
    })
  }

  // Derive timezone from coordinates if available
  let derivedTimezone = timezone || ""
  const lat = typeof latitude === "number" ? latitude : parseFloat(latitude)
  const lng = typeof longitude === "number" ? longitude : parseFloat(longitude)

  if (!isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0) {
    try {
      const timezones = find(lat, lng)
      if (timezones[0]) {
        derivedTimezone = timezones[0]
      }
    } catch {
      // geo-tz lookup failed, keep user-provided timezone
    }
  }

  const now = Date.now()
  const hasCoordinates = !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0
  const status = hasCoordinates ? "enriched" : "pending"

  const doc = {
    submissionId,
    icao: icaoNormalized,
    name: name || "",
    iata: (iata || "").toUpperCase().trim(),
    city: city || "",
    country: (country || "").toUpperCase().trim(),
    timezone: timezone || "",
    latitude: !isNaN(lat) ? lat : 0,
    longitude: !isNaN(lng) ? lng : 0,
    elevation: typeof elevation === "number" ? elevation : parseFloat(elevation) || 0,
    enrichedTimezone: derivedTimezone,
    status,
    submittedBy: session.userId,
    submittedAt: now,
    ...(hasCoordinates
      ? { enrichedAt: now, enrichmentSource: "user-provided" }
      : {}),
  }

  await collection.insertOne(doc)

  return NextResponse.json({
    success: true,
    data: {
      submissionId,
      status,
      enrichedData: hasCoordinates
        ? {
            icao: icaoNormalized,
            name: name || "",
            iata: (iata || "").toUpperCase().trim(),
            city: city || "",
            country: (country || "").toUpperCase().trim(),
            latitude: lat,
            longitude: lng,
            elevation: doc.elevation,
            timezone: derivedTimezone,
          }
        : null,
    },
  })
}
