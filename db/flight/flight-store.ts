/**
 * Flight Dexie operations
 */
import { db } from "../core/database"
import { addToSyncQueue } from "../core/sync-queue-store"
import type { FlightLog } from "./flight-types"
import { generateULID } from "../utils/ulid"

export async function addFlight(
  flight: Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus">,
): Promise<FlightLog> {
  const now = Date.now()
  const newFlight: FlightLog = {
    ...flight,
    id: generateULID(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await db.flights.put(newFlight)
  await addToSyncQueue("create", "flights", newFlight)

  return newFlight
}

export async function updateFlight(id: string, updates: Partial<FlightLog>): Promise<FlightLog | null> {
  const flight = await db.flights.get(id)
  if (!flight) return null

  const updatedFlight: FlightLog = {
    ...flight,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.flights.put(updatedFlight)
  await addToSyncQueue("update", "flights", updatedFlight)

  return updatedFlight
}

export async function deleteFlight(id: string): Promise<boolean> {
  const flight = await db.flights.get(id)
  if (!flight) return false

  await db.flights.delete(id)
  await addToSyncQueue("delete", "flights", { id, mongoId: flight.mongoId })

  return true
}

export async function silentDeleteFlight(id: string): Promise<boolean> {
  const flight = await db.flights.get(id)
  if (!flight) {
    const byMongoPattern = await db.flights.filter((f) => f.id === id || f.mongoId === id).first()
    if (byMongoPattern) {
      await db.flights.delete(byMongoPattern.id)
      return true
    }
    return false
  }
  await db.flights.delete(id)
  return true
}

export async function getAllFlights(): Promise<FlightLog[]> {
  return db.flights.orderBy("date").reverse().toArray()
}

export async function getFlightById(id: string): Promise<FlightLog | undefined> {
  return db.flights.get(id)
}

export async function getFlightByMongoId(mongoId: string): Promise<FlightLog | undefined> {
  return db.flights.where("mongoId").equals(mongoId).first()
}

export async function getPendingFlights(): Promise<FlightLog[]> {
  return db.flights.where("syncStatus").equals("pending").toArray()
}
