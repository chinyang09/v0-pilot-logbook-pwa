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

    const validCollections = ["flights", "aircraft", "personnel"]
    if (!validCollections.includes(collection)) {
      return NextResponse.json({ error: "Invalid collection" }, { status: 400 })
    }

    const mongoClient = await getClient()
    const db = mongoClient.db("skylog")

    const query =
      since > 0
        ? { $or: [{ updatedAt: { $gt: since } }, { createdAt: { $gt: since } }, { syncedAt: { $gt: since } }] }
        : {}

    const sortCriteria =
      collection === "flights" ? { date: -1, updatedAt: -1, createdAt: -1 } : { updatedAt: -1, createdAt: -1 }

    const records = await db.collection(collection).find(query).sort(sortCriteria).toArray()

    const transformedRecords = records.map((record) => {
      const { _id, syncedAt, ...rest } = record

      // Create base record with proper ID mapping
      const transformed: Record<string, unknown> = {
        ...rest,
        id: rest.localId || `mongo_${_id.toString()}`,
        mongoId: _id.toString(),
        syncStatus: "synced",
      }

      if (collection === "flights") {
        // Ensure HH:MM time fields default to "00:00" if missing
        const timeFields = [
          "blockTime",
          "flightTime",
          "nightTime",
          "p1Time",
          "p2Time",
          "puTime",
          "dualTime",
          "instructorTime",
          "ifrTime",
          "actualInstrumentTime",
          "simulatedInstrumentTime",
          "crossCountryTime",
        ]
        for (const field of timeFields) {
          if (!transformed[field]) {
            transformed[field] = "00:00"
          }
        }

        // Ensure number fields default to 0
        const numberFields = ["dayTakeoffs", "dayLandings", "nightTakeoffs", "nightLandings", "autolands", "holds"]
        for (const field of numberFields) {
          if (typeof transformed[field] !== "number") {
            transformed[field] = Number(transformed[field]) || 0
          }
        }

        // Ensure string fields exist
        const stringFields = [
          "flightNumber",
          "aircraftReg",
          "aircraftType",
          "departureIcao",
          "departureIata",
          "arrivalIcao",
          "arrivalIata",
          "scheduledOut",
          "scheduledIn",
          "outTime",
          "offTime",
          "onTime",
          "inTime",
          "picId",
          "picName",
          "sicId",
          "sicName",
          "otherCrew",
          "remarks",
          "endorsements",
          "approach1",
          "approach2",
        ]
        for (const field of stringFields) {
          if (!transformed[field]) {
            transformed[field] = ""
          }
        }

        // Ensure pilotRole has valid default
        if (!transformed.pilotRole) {
          transformed.pilotRole = "SIC"
        }

        // Ensure manualOverrides object exists
        if (!transformed.manualOverrides) {
          transformed.manualOverrides = {}
        }

        // Ensure boolean fields
        if (typeof transformed.ipcIcc !== "boolean") {
          transformed.ipcIcc = false
        }
        if (typeof transformed.isLocked !== "boolean") {
          transformed.isLocked = false
        }
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
