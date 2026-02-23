/**
 * Aircraft reference sync API
 *
 * GET /api/sync/aircraft-reference?since=<timestamp>
 *
 * Returns enriched aircraft submissions updated after the given timestamp.
 * No auth required — this is shared reference data.
 * Used by the sync engine to keep local IndexedDB up to date.
 */

import { NextResponse } from "next/server"
import { getMongoClient } from "@/lib/mongodb"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const since = parseInt(searchParams.get("since") || "0", 10) || 0

  try {
    const client = await getMongoClient()
    const db = client.db("skylog")
    const collection = db.collection("aircraftSubmissions")

    const query: Record<string, any> = { status: "enriched" }
    if (since > 0) {
      query.enrichedAt = { $gt: since }
    }

    const docs = await collection
      .find(query)
      .project({
        registration: 1,
        icao24: 1,
        typecode: 1,
        operator: 1,
        shortDescription: 1,
        wtc: 1,
        wtg: 1,
        manufacturerCode: 1,
        enrichedAt: 1,
      })
      .sort({ enrichedAt: 1 })
      .limit(500)
      .toArray()

    const records = docs.map((doc) => ({
      registration: doc.registration || "",
      icao24: doc.icao24 || "",
      typecode: doc.typecode || "",
      operator: doc.operator || "",
      shortDescription: doc.shortDescription || "",
      wtc: doc.wtc || "",
      wtg: doc.wtg || "",
      manufacturerCode: doc.manufacturerCode || "",
    }))

    // Track the latest enrichedAt for the client to use as next `since`
    const lastUpdated = docs.length > 0
      ? Math.max(...docs.map((d) => d.enrichedAt || 0))
      : since

    return NextResponse.json({ records, lastUpdated })
  } catch (error) {
    console.error("[Aircraft Reference Sync] MongoDB error:", error)
    return NextResponse.json({ records: [], lastUpdated: since })
  }
}
