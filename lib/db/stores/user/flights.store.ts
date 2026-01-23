/**
 * Flight store operations
 */

import { userDb } from "../../user-db"
import type { FlightLog, FlightLogCreate } from "@/types/entities/flight.types"
import { addToSyncQueue } from "./sync-queue.store"

/**
 * Add a new flight
 */
export async function addFlight(flight: FlightLogCreate): Promise<FlightLog> {
  const now = Date.now()
  const newFlight: FlightLog = {
    ...flight,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await userDb.flights.put(newFlight)
  await addToSyncQueue("create", "flights", newFlight)

  return newFlight
}

/**
 * Update an existing flight
 */
export async function updateFlight(id: string, updates: Partial<FlightLog>): Promise<FlightLog | null> {
  const flight = await userDb.flights.get(id)
  if (!flight) return null

  const updatedFlight: FlightLog = {
    ...flight,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await userDb.flights.put(updatedFlight)
  await addToSyncQueue("update", "flights", updatedFlight)

  return updatedFlight
}

/**
 * Delete a flight
 */
export async function deleteFlight(id: string): Promise<boolean> {
  const flight = await userDb.flights.get(id)
  if (!flight) return false

  await userDb.flights.delete(id)
  await addToSyncQueue("delete", "flights", { id})

  return true
}

/**
 * Delete a flight without adding to sync queue (for server-initiated deletes)
 */
export async function silentDeleteFlight(id: string): Promise<boolean> {
  const flight = await userDb.flights.get(id)
  if (!flight) {
    const byMongoPattern = await userDb.flights.filter((f) => f.id === id ).first()
    if (byMongoPattern) {
      await userDb.flights.delete(byMongoPattern.id)
      return true
    }
    return false
  }
  await userDb.flights.delete(id)
  return true
}

/**
 * Get all flights sorted by date (newest first)
 */
export async function getAllFlights(): Promise<FlightLog[]> {
  return userDb.flights.orderBy("date").reverse().toArray()
}

/**
 * Get a flight by ID
 */
export async function getFlightById(id: string): Promise<FlightLog | undefined> {
  return userDb.flights.get(id)
}

/**
 * Get all pending flights
 */
export async function getPendingFlights(): Promise<FlightLog[]> {
  return userDb.flights.where("syncStatus").equals("pending").toArray()
}

/**
 * Upsert a flight from server (for sync)
 */
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
    signature: serverFlight.signature,
    createdAt: serverFlight.createdAt || Date.now(),
    updatedAt: serverFlight.updatedAt || Date.now(),
    syncStatus: "synced",
    isLocked: serverFlight.isLocked,
    lastSyncedAt: serverFlight.lastSyncedAt,
  }

  let existingFlight: FlightLog | undefined
  if (normalized.id) {
    existingFlight = await userDb.flights.where("id").equals(normalized.id).first()
  }
  if (!existingFlight && normalized.id) {
    existingFlight = await userDb.flights.get(normalized.id)
  }

  if (existingFlight) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existingFlight.updatedAt || existingFlight.createdAt

    if (serverTime >= localTime) {
      await userDb.flights.put({
        ...normalized,
        id: existingFlight.id,
      })
    }
  } else {
    await userDb.flights.put(normalized)
  }
}

/**
 * Mark a flight as synced
 */
export async function markFlightSynced(id: string): Promise<void> {
  const flight = await userDb.flights.get(id)
  if (flight) {
    await userDb.flights.put({ ...flight, syncStatus: "synced" })
  }
}
