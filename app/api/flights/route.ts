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
      flightNumber: flight.flightNumber || "",

      // Aircraft
      aircraftReg: flight.aircraftReg || "",
      aircraftType: flight.aircraftType || "",

      // Route
      departureIcao: flight.departureIcao || "",
      departureIata: flight.departureIata || "",
      arrivalIcao: flight.arrivalIcao || "",
      arrivalIata: flight.arrivalIata || "",

      // Scheduled times
      scheduledOut: flight.scheduledOut || "",
      scheduledIn: flight.scheduledIn || "",

      // OOOI Times (UTC) - HH:MM format
      outTime: flight.outTime || "",
      offTime: flight.offTime || "",
      onTime: flight.onTime || "",
      inTime: flight.inTime || "",

      // Calculated Times - HH:MM format
      blockTime: flight.blockTime || "00:00",
      flightTime: flight.flightTime || "00:00",
      nightTime: flight.nightTime || "00:00",

      // Crew
      picId: flight.picId || "",
      picName: flight.picName || "",
      sicId: flight.sicId || "",
      sicName: flight.sicName || "",
      otherCrew: flight.otherCrew || "",
      pilotRole: flight.pilotRole || "SIC",

      // Role times
      p1Time: flight.p1Time || "00:00",
      p2Time: flight.p2Time || "00:00",
      puTime: flight.puTime || "00:00",
      dualTime: flight.dualTime || "00:00",
      instructorTime: flight.instructorTime || "00:00",

      // Takeoffs/Landings
      dayTakeoffs: flight.dayTakeoffs || 0,
      dayLandings: flight.dayLandings || 0,
      nightTakeoffs: flight.nightTakeoffs || 0,
      nightLandings: flight.nightLandings || 0,
      autolands: flight.autolands || 0,

      // Remarks
      remarks: flight.remarks || "",
      endorsements: flight.endorsements || "",

      // Manual overrides
      manualOverrides: flight.manualOverrides || {},

      // Instrument
      ifrTime: flight.ifrTime || "00:00",
      actualInstrumentTime: flight.actualInstrumentTime || "00:00",
      simulatedInstrumentTime: flight.simulatedInstrumentTime || "00:00",
      crossCountryTime: flight.crossCountryTime || "00:00",
      approach1: flight.approach1 || "",
      approach2: flight.approach2 || "",
      holds: flight.holds || 0,
      ipcIcc: flight.ipcIcc || false,

      // Lock status
      isLocked: flight.isLocked || false,

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
