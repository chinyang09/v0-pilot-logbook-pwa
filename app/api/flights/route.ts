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

export async function GET(request: NextRequest) {
  try {
    const mongoClient = await getClient()
    const db = mongoClient.db("skylog")
    const flights = await db.collection("flights").find({}).sort({ date: -1 }).toArray()

    // Transform MongoDB documents to match local format
    const transformedFlights = flights.map((flight) => ({
      id: flight.localId || flight._id.toString(),
      mongoId: flight._id.toString(),
      date: flight.date,
      aircraftType: flight.aircraftType,
      aircraftReg: flight.aircraftReg,
      departureAirport: flight.departureAirport,
      arrivalAirport: flight.arrivalAirport,
      departureTime: flight.departureTime,
      arrivalTime: flight.arrivalTime,
      totalTime: flight.totalTime,
      picTime: flight.picTime,
      sicTime: flight.sicTime,
      dualTime: flight.dualTime,
      nightTime: flight.nightTime,
      ifrTime: flight.ifrTime,
      landings: flight.landings,
      nightLandings: flight.nightLandings,
      remarks: flight.remarks,
      createdAt: flight.createdAt,
      updatedAt: flight.updatedAt,
      syncStatus: "synced" as const,
    }))

    return NextResponse.json(transformedFlights)
  } catch (error) {
    console.error("Fetch flights error:", error)
    return NextResponse.json({ error: "Failed to fetch flights" }, { status: 500 })
  }
}
