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

    const transformedFlights = flights.map((flight) => ({
      id: flight.localId || flight._id.toString(),
      mongoId: flight._id.toString(),
      date: flight.date || "",

      // Aircraft reference
      aircraftId: flight.aircraftId || "",
      aircraftType: flight.aircraftType || "",
      aircraftReg: flight.aircraftReg || "",

      // Route with airport references
      departureAirportId: flight.departureAirportId || "",
      arrivalAirportId: flight.arrivalAirportId || "",
      departureIcao: flight.departureIcao || "",
      arrivalIcao: flight.arrivalIcao || "",

      // OOOI Times (UTC) - HH:MM format
      outTime: flight.outTime || "",
      offTime: flight.offTime || "",
      onTime: flight.onTime || "",
      inTime: flight.inTime || "",

      // Calculated Times - HH:MM format
      blockTime: flight.blockTime || "00:00",
      flightTime: flight.flightTime || "00:00",

      // CAAS Hours Categories - HH:MM format
      p1Time: flight.p1Time || "00:00",
      p1usTime: flight.p1usTime || "00:00",
      p2Time: flight.p2Time || "00:00",
      dualTime: flight.dualTime || "00:00",
      instructorTime: flight.instructorTime || "00:00",

      // Conditions - HH:MM format
      nightTime: flight.nightTime || "00:00",
      ifrTime: flight.ifrTime || "00:00",
      actualInstrumentTime: flight.actualInstrumentTime || "00:00",
      simulatedInstrumentTime: flight.simulatedInstrumentTime || "00:00",

      // Landings
      dayLandings: flight.dayLandings || 0,
      nightLandings: flight.nightLandings || 0,

      // Crew
      crewIds: flight.crewIds || [],
      pilotRole: flight.pilotRole || "FO",

      // Additional
      flightNumber: flight.flightNumber || "",
      remarks: flight.remarks || "",

      // Metadata
      createdAt: flight.createdAt || Date.now(),
      updatedAt: flight.updatedAt || Date.now(),
      syncStatus: "synced" as const,
    }))

    return NextResponse.json(transformedFlights)
  } catch (error) {
    console.error("Fetch flights error:", error)
    return NextResponse.json({ error: "Failed to fetch flights" }, { status: 500 })
  }
}
