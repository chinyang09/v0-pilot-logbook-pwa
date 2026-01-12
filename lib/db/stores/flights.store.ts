/**
 * Flights Store - CRUD operations for flights
 * USER DATA - syncs with MongoDB
 */

import { userDb } from "../user-db"
import { addToSyncQueue } from "./sync-queue.store"
import { ulid } from "@/lib/utils/ulid"
import type { Flight, FlightInput, FlightUpdate } from "@/types/entities/flight.types"

/**
 * Create a new flight
 */
export async function createFlight(input: FlightInput): Promise<Flight> {
  const now = Date.now()
  const flight: Flight = {
    ...input,
    id: ulid(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await userDb.flights.put(flight)
  await addToSyncQueue("create", "flights", flight)

  return flight
}

/**
 * Update an existing flight
 */
export async function updateFlight(id: string, updates: FlightUpdate): Promise<Flight | null> {
  const flight = await userDb.flights.get(id)
  if (!flight) return null

  const updatedFlight: Flight = {
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
  await addToSyncQueue("delete", "flights", { id, mongoId: flight.mongoId })

  return true
}

/**
 * Delete a flight without adding to sync queue (for server-initiated deletes)
 */
export async function silentDeleteFlight(id: string): Promise<boolean> {
  const flight = await userDb.flights.get(id)
  if (!flight) {
    // Try to find by mongoId
    const byMongo = await userDb.flights.filter((f) => f.mongoId === id).first()
    if (byMongo) {
      await userDb.flights.delete(byMongo.id)
      return true
    }
    return false
  }
  await userDb.flights.delete(id)
  return true
}

/**
 * Get all flights ordered by date descending
 */
export async function getAllFlights(): Promise<Flight[]> {
  return userDb.flights.orderBy("date").reverse().toArray()
}

/**
 * Get flight by ID
 */
export async function getFlightById(id: string): Promise<Flight | undefined> {
  return userDb.flights.get(id)
}

/**
 * Get flight by MongoDB ID
 */
export async function getFlightByMongoId(mongoId: string): Promise<Flight | undefined> {
  return userDb.flights.where("mongoId").equals(mongoId).first()
}

/**
 * Get pending flights (not yet synced)
 */
export async function getPendingFlights(): Promise<Flight[]> {
  return userDb.flights.where("syncStatus").equals("pending").toArray()
}

/**
 * Upsert flight from server (during sync pull)
 */
export async function upsertFlightFromServer(serverFlight: Flight): Promise<void> {
  const normalized: Flight = {
    id: serverFlight.id,
    userId: serverFlight.userId || "",
    isDraft: serverFlight.isDraft || false,
    date: serverFlight.date || "",
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
    isLocked: serverFlight.isLocked,
    createdAt: serverFlight.createdAt || Date.now(),
    updatedAt: serverFlight.updatedAt || Date.now(),
    syncStatus: "synced",
    mongoId: serverFlight.mongoId,
    lastSyncedAt: Date.now(),
  }

  // Check for existing record
  let existing: Flight | undefined
  if (normalized.mongoId) {
    existing = await userDb.flights.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await userDb.flights.get(normalized.id)
  }

  if (existing) {
    // Last-write-wins conflict resolution
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await userDb.flights.put({ ...normalized, id: existing.id })
    }
  } else {
    await userDb.flights.put(normalized)
  }
}

/**
 * Mark flight as synced after successful push
 */
export async function markFlightSynced(id: string, mongoId: string): Promise<void> {
  await userDb.flights.update(id, {
    syncStatus: "synced",
    mongoId,
    lastSyncedAt: Date.now(),
  })
}
