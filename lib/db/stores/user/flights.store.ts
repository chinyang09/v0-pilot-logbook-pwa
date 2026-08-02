/**
 * Flight store operations
 *
 * Deleting a flight puts it in the RECYCLE BIN rather than destroying it: the
 * row stays with `deletedAt` set and is restorable for 90 days
 * (`lib/utils/retention.ts`), after which `purgeExpiredDeletedFlights` really
 * removes it. See `deletedAt` on `FlightLog` for why a soft delete is what
 * makes the bin work across devices.
 *
 * The consequence is that the table now holds rows nothing should show. Read
 * lists through `getAllFlights()`, or filter with `isLiveFlight` when reading
 * `userDb.flights` directly — a binned flight leaking into a total, an import
 * match or an aircraft reconciliation is exactly the bug this file is trying
 * to avoid.
 */

import { userDb } from "../../user-db"
import type { FlightLog, FlightLogCreate } from "@/types/entities/flight.types"
import { createEntity, updateEntity, deleteEntity, silentDeleteEntity, upsertFromServer } from "./crud-helpers"
import { isWithinRetention } from "@/lib/utils/retention"
import { sortFlights } from "@/lib/utils/flight-sort"

/**
 * Not in the recycle bin — i.e. a flight that still counts for anything.
 *
 * `== null` on purpose: a restored flight carries `deletedAt: null` (see the
 * field's note on why it can't be `undefined`), and a flight from before the
 * bin existed carries nothing at all.
 */
export function isLiveFlight(flight: Pick<FlightLog, "deletedAt">): boolean {
  return flight.deletedAt == null
}

/**
 * Add a new flight
 */
export async function addFlight(flight: FlightLogCreate): Promise<FlightLog> {
  return createEntity<FlightLog>(userDb.flights, "flights", flight)
}

/**
 * Update an existing flight
 */
export async function updateFlight(id: string, updates: Partial<FlightLog>): Promise<FlightLog | null> {
  return updateEntity<FlightLog>(userDb.flights, "flights", id, updates)
}

/**
 * Move a flight to the recycle bin.
 *
 * An update, not a delete, so the other devices bin it too instead of losing
 * it outright — and so a restore is just another update. A flight already in
 * the bin keeps its original `deletedAt`: the 90 days run from when it was
 * deleted, and re-deleting it should not extend that.
 */
export async function deleteFlight(id: string): Promise<boolean> {
  const existing = await userDb.flights.get(id)
  if (!existing) return false
  if (!isLiveFlight(existing)) return true
  const updated = await updateEntity<FlightLog>(userDb.flights, "flights", id, {
    deletedAt: Date.now(),
  })
  return updated !== null
}

/** Take a flight back out of the recycle bin. */
export async function restoreFlight(id: string): Promise<FlightLog | null> {
  return updateEntity<FlightLog>(userDb.flights, "flights", id, {
    // Explicitly null, not undefined — an undefined would not survive the push
    // and the server's stamp would put the flight back in the bin on the next
    // pull. See `deletedAt` on FlightLog.
    deletedAt: null,
  })
}

/**
 * Destroy a flight for good — no bin, no undo. Used by the retention sweep and
 * by an explicit "delete permanently" from the bin.
 */
export async function permanentlyDeleteFlight(id: string): Promise<boolean> {
  return deleteEntity<FlightLog>(userDb.flights, "flights", id)
}

/**
 * Empty out the flights whose 90 days are up.
 *
 * This is the only place a flight is destroyed without the user asking, so it
 * goes through the normal delete path: a tombstone is written and the removal
 * propagates instead of the flight reappearing on the next pull. Returns how
 * many went.
 */
export async function purgeExpiredDeletedFlights(now = Date.now()): Promise<number> {
  const expired = await userDb.flights
    .filter(
      (f: FlightLog) => !isLiveFlight(f) && !isWithinRetention(f.deletedAt!, now)
    )
    .toArray()

  for (const flight of expired) {
    await deleteEntity<FlightLog>(userDb.flights, "flights", flight.id)
  }
  return expired.length
}

/**
 * Delete a flight without adding to sync queue (for server-initiated deletes)
 */
export async function silentDeleteFlight(id: string): Promise<boolean> {
  return silentDeleteEntity<FlightLog>(userDb.flights, id)
}

/**
 * Every live flight, in list order (`lib/utils/flight-sort.ts`). Excludes the
 * recycle bin. Sorting here rather than at each call site is what keeps the
 * order the same on every surface — Dexie's `orderBy("date")` alone leaves
 * same-day flights in whatever order the index happens to return.
 */
export async function getAllFlights(): Promise<FlightLog[]> {
  const flights = await userDb.flights.toArray()
  return sortFlights(flights.filter(isLiveFlight))
}

/**
 * The recycle bin, most recently deleted first — which is the order someone
 * looking for something they just deleted expects.
 */
export async function getDeletedFlights(): Promise<FlightLog[]> {
  const flights = await userDb.flights.filter((f: FlightLog) => !isLiveFlight(f)).toArray()
  return flights.sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
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
 * Normalize a server flight record, filling defaults for any missing fields.
 *
 * The server record is spread FIRST and the defaults applied over it, so a
 * field this list doesn't know about survives the round trip. Building the
 * object from an explicit list instead quietly dropped every field added since
 * it was written — `entryType`/`isSimulator` (a simulator came back from a
 * second device as an ordinary flight), the import decisions, the per-report
 * watermarks — and would have dropped `deletedAt` too, which would have meant
 * a flight in the recycle bin climbing back out on the next sync.
 */
function normalizeFlightFromServer(serverFlight: FlightLog): FlightLog {
  return {
    ...serverFlight,
    id: serverFlight.id,
    userId: serverFlight.userId,
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
    serverSeq: serverFlight.serverSeq,
    deviceId: serverFlight.deviceId,
  }
}

/**
 * Upsert a flight from server (for sync)
 */
export async function upsertFlightFromServer(serverFlight: FlightLog): Promise<void> {
  return upsertFromServer<FlightLog>(userDb.flights, serverFlight, normalizeFlightFromServer)
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
