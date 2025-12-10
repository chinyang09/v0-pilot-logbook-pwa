import { type NextRequest, NextResponse } from "next/server"
import { MongoClient } from "mongodb"

const uri = process.env.MONGODB_URI || ""
let client: MongoClient | null = null

async function getClient() {
  if (!uri) {
    throw new Error("MONGODB_URI environment variable is not set")
  }

  if (!client) {
    client = new MongoClient(uri)
    await client.connect()
  }
  return client
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ collection: string }> }) {
  try {
    const { collection } = await params
    const { searchParams } = new URL(request.url)
    const since = Number.parseInt(searchParams.get("since") || "0")

    const validCollections = ["flights", "aircraft", "airports", "personnel"]
    if (!validCollections.includes(collection)) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 })
    }

    const mongoClient = await getClient()
    const db = mongoClient.db("skylog")

    const query =
      since > 0
        ? { $or: [{ updatedAt: { $gt: since } }, { createdAt: { $gt: since } }, { syncedAt: { $gt: since } }] }
        : {}

    const records = await db
      .collection(collection)
      .find(query)
      .sort({ date: -1, updatedAt: -1, createdAt: -1 })
      .toArray()

    const transformedRecords = records.map((record) => {
      const { _id, syncedAt, ...rest } = record

      // Create base record with proper ID mapping
      const transformed: Record<string, unknown> = {
        ...rest,
        // Use localId if exists (was created from this app), otherwise generate from mongoId
        id: rest.localId || `mongo_${_id.toString()}`,
        mongoId: _id.toString(),
        syncStatus: "synced",
      }

      // Ensure all required fields exist for flights collection
      if (collection === "flights") {
        // Ensure HH:MM time fields default to "00:00" if missing
        const timeFields = [
          "blockTime",
          "flightTime",
          "p1Time",
          "p1usTime",
          "p2Time",
          "dualTime",
          "instructorTime",
          "nightTime",
          "ifrTime",
          "actualInstrumentTime",
          "simulatedInstrumentTime",
        ]
        for (const field of timeFields) {
          if (!transformed[field]) {
            transformed[field] = "00:00"
          }
        }

        // Ensure number fields default to 0
        if (typeof transformed.dayLandings !== "number") {
          transformed.dayLandings = Number(transformed.dayLandings) || 0
        }
        if (typeof transformed.nightLandings !== "number") {
          transformed.nightLandings = Number(transformed.nightLandings) || 0
        }

        // Ensure arrays exist
        if (!Array.isArray(transformed.crewIds)) {
          transformed.crewIds = []
        }

        // Ensure string fields exist
        if (!transformed.remarks) transformed.remarks = ""
        if (!transformed.flightNumber) transformed.flightNumber = ""
        if (!transformed.pilotRole) transformed.pilotRole = "FO"
      }

      return transformed
    })

    return NextResponse.json({
      records: transformedRecords,
      syncedAt: Date.now(),
      count: transformedRecords.length,
    })
  } catch (error) {
    console.error("Fetch collection error:", error)
    return NextResponse.json(
      { error: "Failed to fetch records", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    )
  }
}
