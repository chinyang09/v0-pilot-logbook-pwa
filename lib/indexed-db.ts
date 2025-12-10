import { openDB, type DBSchema, type IDBPDatabase } from "idb"

export interface FlightLog {
  id: string
  date: string
  aircraftType: string
  aircraftReg: string
  departureAirport: string
  arrivalAirport: string
  departureTime: string
  arrivalTime: string
  totalTime: number
  picTime: number
  sicTime: number
  dualTime: number
  nightTime: number
  ifrTime: number
  landings: number
  nightLandings: number
  remarks: string
  createdAt: number
  updatedAt: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}

export interface Aircraft {
  id: string
  registration: string
  type: string
  model: string
  createdAt: number
  syncStatus: "synced" | "pending" | "error"
}

interface LogbookDB extends DBSchema {
  flights: {
    key: string
    value: FlightLog
    indexes: {
      "by-date": string
      "by-sync": string
    }
  }
  aircraft: {
    key: string
    value: Aircraft
    indexes: {
      "by-registration": string
    }
  }
  syncQueue: {
    key: string
    value: {
      id: string
      type: "create" | "update" | "delete"
      collection: "flights" | "aircraft"
      data: FlightLog | Aircraft | { id: string }
      timestamp: number
    }
  }
}

let dbInstance: IDBPDatabase<LogbookDB> | null = null

export async function getDB(): Promise<IDBPDatabase<LogbookDB>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<LogbookDB>("skylog-db", 1, {
    upgrade(db) {
      // Flights store
      const flightStore = db.createObjectStore("flights", { keyPath: "id" })
      flightStore.createIndex("by-date", "date")
      flightStore.createIndex("by-sync", "syncStatus")

      // Aircraft store
      const aircraftStore = db.createObjectStore("aircraft", { keyPath: "id" })
      aircraftStore.createIndex("by-registration", "registration")

      // Sync queue for offline operations
      db.createObjectStore("syncQueue", { keyPath: "id" })
    },
  })

  return dbInstance
}

// Flight operations
export async function addFlight(
  flight: Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus">,
): Promise<FlightLog> {
  const db = await getDB()
  const now = Date.now()
  const newFlight: FlightLog = {
    ...flight,
    id: crypto.randomUUID(),
    createdAt: now,
    updatedAt: now,
    syncStatus: "pending",
  }

  await db.put("flights", newFlight)
  await addToSyncQueue("create", "flights", newFlight)

  return newFlight
}

export async function updateFlight(id: string, updates: Partial<FlightLog>): Promise<FlightLog | null> {
  const db = await getDB()
  const flight = await db.get("flights", id)

  if (!flight) return null

  const updatedFlight: FlightLog = {
    ...flight,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("flights", updatedFlight)
  await addToSyncQueue("update", "flights", updatedFlight)

  return updatedFlight
}

export async function deleteFlight(id: string): Promise<boolean> {
  const db = await getDB()
  const flight = await db.get("flights", id)

  if (!flight) return false

  await db.delete("flights", id)
  await addToSyncQueue("delete", "flights", { id, mongoId: flight.mongoId } as any)

  return true
}

export async function getAllFlights(): Promise<FlightLog[]> {
  const db = await getDB()
  const flights = await db.getAllFromIndex("flights", "by-date")
  return flights.reverse() // Most recent first
}

export async function getFlightById(id: string): Promise<FlightLog | undefined> {
  const db = await getDB()
  return db.get("flights", id)
}

export async function getPendingFlights(): Promise<FlightLog[]> {
  const db = await getDB()
  return db.getAllFromIndex("flights", "by-sync", "pending")
}

// Aircraft operations
export async function addAircraft(aircraft: Omit<Aircraft, "id" | "createdAt" | "syncStatus">): Promise<Aircraft> {
  const db = await getDB()
  const newAircraft: Aircraft = {
    ...aircraft,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("aircraft", newAircraft)
  await addToSyncQueue("create", "aircraft", newAircraft)

  return newAircraft
}

export async function getAllAircraft(): Promise<Aircraft[]> {
  const db = await getDB()
  return db.getAll("aircraft")
}

// Sync queue operations
async function addToSyncQueue(
  type: "create" | "update" | "delete",
  collection: "flights" | "aircraft",
  data: FlightLog | Aircraft | { id: string },
) {
  const db = await getDB()
  await db.put("syncQueue", {
    id: crypto.randomUUID(),
    type,
    collection,
    data,
    timestamp: Date.now(),
  })
}

export async function getSyncQueue() {
  const db = await getDB()
  return db.getAll("syncQueue")
}

export async function clearSyncQueueItem(id: string) {
  const db = await getDB()
  await db.delete("syncQueue", id)
}

export async function markFlightSynced(id: string, mongoId: string) {
  const db = await getDB()
  const flight = await db.get("flights", id)
  if (flight) {
    await db.put("flights", { ...flight, syncStatus: "synced", mongoId })
  }
}

// Stats
export async function getFlightStats() {
  const flights = await getAllFlights()

  const totalFlights = flights.length
  const totalTime = flights.reduce((sum, f) => sum + f.totalTime, 0)
  const picTime = flights.reduce((sum, f) => sum + f.picTime, 0)
  const nightTime = flights.reduce((sum, f) => sum + f.nightTime, 0)
  const ifrTime = flights.reduce((sum, f) => sum + f.ifrTime, 0)
  const totalLandings = flights.reduce((sum, f) => sum + f.landings, 0)

  const uniqueAircraft = new Set(flights.map((f) => f.aircraftReg)).size
  const uniqueAirports = new Set([...flights.map((f) => f.departureAirport), ...flights.map((f) => f.arrivalAirport)])
    .size

  return {
    totalFlights,
    totalTime,
    picTime,
    nightTime,
    ifrTime,
    totalLandings,
    uniqueAircraft,
    uniqueAirports,
  }
}
