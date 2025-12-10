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

    // For subsequent syncs, only fetch records updated since last sync
    const query = since > 0 ? { $or: [{ updatedAt: { $gt: since } }, { createdAt: { $gt: since } }] } : {}

    const records = await db
      .collection(collection)
      .find(query)
      .sort({ date: -1, updatedAt: -1, createdAt: -1 })
      .toArray()

    // Transform MongoDB documents to match local format
    const transformedRecords = records.map((record) => {
      const { _id, localId, ...rest } = record
      return {
        ...rest,
        id: localId || _id.toString(),
        mongoId: _id.toString(),
      }
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
