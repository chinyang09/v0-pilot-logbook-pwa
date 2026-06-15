/**
 * Aircraft reference sync API
 *
 * GET /api/sync/aircraft-reference?since=<enrichedAt>&sinceId=<_id>
 *
 * Returns enriched aircraft submissions after the given keyset cursor.
 * No auth required — this is shared reference data.
 */

import { NextResponse } from "next/server"
import { ObjectId } from "mongodb"
import { getMongoClient } from "@/lib/mongodb"

const PAGE_SIZE = 500

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const sinceRaw = parseInt(searchParams.get("since") || "0", 10)
  const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? sinceRaw : 0
  const sinceIdRaw = searchParams.get("sinceId") || ""
  const sinceId = sinceIdRaw && ObjectId.isValid(sinceIdRaw) ? new ObjectId(sinceIdRaw) : null

  try {
    const client = await getMongoClient()
    const db = client.db("skylog")
    const collection = db.collection("aircraftSubmissions")

    // Keyset cursor on (enrichedAt, _id) so rows sharing a boundary enrichedAt
    // past the page limit are not skipped (the old Math.max cursor dropped them).
    const query: Record<string, unknown> = { status: "enriched" }
    if (since > 0) {
      query.$or = sinceId
        ? [{ enrichedAt: { $gt: since } }, { enrichedAt: since, _id: { $gt: sinceId } }]
        : [{ enrichedAt: { $gt: since } }]
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
      .sort({ enrichedAt: 1, _id: 1 })
      .limit(PAGE_SIZE)
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

    const hasMore = docs.length === PAGE_SIZE
    const last = docs[docs.length - 1]
    const nextCursor = last
      ? { enrichedAt: (last.enrichedAt as number) || since, id: (last._id as ObjectId).toString() }
      : { enrichedAt: since, id: sinceIdRaw }

    return NextResponse.json({
      records,
      nextCursor,
      hasMore,
      // Back-compat field for older clients.
      lastUpdated: nextCursor.enrichedAt,
    })
  } catch (error) {
    console.error("[Aircraft Reference Sync] MongoDB error:", error)
    return NextResponse.json({
      records: [],
      nextCursor: { enrichedAt: since, id: sinceIdRaw },
      hasMore: false,
      lastUpdated: since,
    })
  }
}

