/**
 * Flight sync operations
 */
import { db } from "../core/database"
import type { FlightLog } from "./flight-types"

export async function upsertFlightFromServer(serverFlight: FlightLog): Promise<void> {
  const normalized: FlightLog = {
    id: serverFlight.id,
    userId: serverFlight.userId,
    isDraft: serverFlight.isDraft || false,
    date: serverFlight.date,
    flightNumber: serverFlight.flightNumber || "",
    aircraftReg: serverFlight.aircraftReg || "",
    aircraftType: serverFlight.aircraftType || "",
    departureIcao: serverFlight.departureIcao || "",
    departureIata: serverFlight.departureIata || "",
    arrivalIcao: serverFlight.arrivalIcao || "",
    arrivalIata: serverFlight.arrivalIata || "",
    departureTimezone: serverFlight.departureTimezone || 0,
    arrivalTimezone: serverFlight.arrivalTimezone || 0,
    scheduledOut: serverFlight.scheduledOut || "",
    scheduledIn: serverFlight.scheduledIn || "",
    outTime: serverFlight.outTime || "",
    offTime: serverFlight.offTime || "",
    onTime: serverFlight.onTime || "",
    inTime: serverFlight.inTime || "",
    blockTime: serverFlight.blockTime || "00:00",
    flightTime: serverFlight.flightTime || "00:00",
    nightTime: serverFlight.nightTime || "00:00",
    dayTime: serverFlight.dayTime || "00:00",
    picId: serverFlight.picId || "",
    picName: serverFlight.picName || "",
    sicId: serverFlight.sicId || "",
    sicName: serverFlight.sicName || "",
    additionalCrew: serverFlight.additionalCrew || [],
    pilotFlying: serverFlight.pilotFlying ?? true,
    pilotRole: serverFlight.pilotRole || "PIC",
    picTime: serverFlight.picTime || "00:00",
    sicTime: serverFlight.sicTime || "00:00",
    picusTime: serverFlight.picusTime || "00:00",
    dualTime: serverFlight.dualTime || "00:00",
    instructorTime: serverFlight.instructorTime || "00:00",
    dayTakeoffs: serverFlight.dayTakeoffs || 0,
    dayLandings: serverFlight.dayLandings || 0,
    nightTakeoffs: serverFlight.nightTakeoffs || 0,
    nightLandings: serverFlight.nightLandings || 0,
    autolands: serverFlight.autolands || 0,
    remarks: serverFlight.remarks || "",
    endorsements: serverFlight.endorsements || "",
    manualOverrides: serverFlight.manualOverrides || {},
    ifrTime: serverFlight.ifrTime || "00:00",
    actualInstrumentTime: serverFlight.actualInstrumentTime || "00:00",
    simulatedInstrumentTime: serverFlight.simulatedInstrumentTime || "00:00",
    crossCountryTime: serverFlight.crossCountryTime || "00:00",
    approaches: serverFlight.approaches || [],
    holds: serverFlight.holds || 0,
    ipcIcc: serverFlight.ipcIcc || false,
    createdAt: serverFlight.createdAt || Date.now(),
    updatedAt: serverFlight.updatedAt || Date.now(),
    syncStatus: "synced",
    mongoId: serverFlight.mongoId,
    isLocked: serverFlight.isLocked,
    lastSyncedAt: serverFlight.lastSyncedAt,
  }

  let existingFlight: FlightLog | undefined
  if (normalized.mongoId) {
    existingFlight = await db.flights.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existingFlight && normalized.id) {
    existingFlight = await db.flights.get(normalized.id)
  }

  if (existingFlight) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existingFlight.updatedAt || existingFlight.createdAt
    if (serverTime >= localTime) {
      await db.flights.put({ ...normalized, id: existingFlight.id })
    }
  } else {
    await db.flights.put(normalized)
  }
}
