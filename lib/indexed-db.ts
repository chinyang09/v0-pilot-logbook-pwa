import { openDB, type DBSchema, type IDBPDatabase } from "idb"

export interface FlightLog {
  id: string
  date: string

  // Aircraft reference
  aircraftId: string
  aircraftType: string
  aircraftReg: string

  // Route with airport references
  departureAirportId: string
  arrivalAirportId: string
  departureIcao: string
  arrivalIcao: string

  // OOOI Times (UTC)
  outTime: string // Out the gate (block off)
  offTime: string // Off ground (takeoff)
  onTime: string // On landing (touchdown)
  inTime: string // In the gate (block on)

  // Calculated Times (in decimal hours) - CAAS aligned
  blockTime: number // In - Out (total block time)
  flightTime: number // On - Off (airborne time)

  // CAAS Hours Categories
  p1Time: number // Pilot in Command
  p1usTime: number // PIC Under Supervision
  p2Time: number // Co-pilot / Second in Command
  dualTime: number // Dual instruction received
  instructorTime: number // Time as instructor

  // Conditions
  nightTime: number // Auto-calculated from coordinates
  ifrTime: number
  actualInstrumentTime: number
  simulatedInstrumentTime: number

  // Landings
  dayLandings: number
  nightLandings: number

  // Crew
  crewIds: string[] // Personnel IDs
  pilotRole: "PIC" | "FO" | "STUDENT" | "INSTRUCTOR"

  // Additional
  flightNumber: string
  remarks: string

  // Metadata
  createdAt: number
  updatedAt: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}

export interface Aircraft {
  id: string
  registration: string
  type: string // e.g., "A320", "B737"
  typeDesignator: string // ICAO type designator
  model: string // e.g., "A320-232"
  category: string // e.g., "MEL" (Multi-Engine Land)
  engineType: "SEP" | "MEP" | "SET" | "MET" | "JET"
  isComplex: boolean
  isHighPerformance: boolean
  createdAt: number
  syncStatus: "synced" | "pending" | "error"
}

export interface Airport {
  id: string
  icao: string
  iata: string
  name: string
  city: string
  country: string
  latitude: number
  longitude: number
  elevation: number // feet
  timezone: string // e.g., "Asia/Singapore"
  utcOffset: number // hours
  dstObserved: boolean
  createdAt: number
  syncStatus: "synced" | "pending" | "error"
}

export interface Personnel {
  id: string
  firstName: string
  lastName: string
  employeeId?: string
  licenseNumber?: string
  role: "CAPT" | "FO" | "INSTRUCTOR" | "STUDENT" | "OTHER"
  company?: string
  email?: string
  notes?: string
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
      "by-aircraft": string
    }
  }
  aircraft: {
    key: string
    value: Aircraft
    indexes: {
      "by-registration": string
      "by-type": string
    }
  }
  airports: {
    key: string
    value: Airport
    indexes: {
      "by-icao": string
      "by-iata": string
    }
  }
  personnel: {
    key: string
    value: Personnel
    indexes: {
      "by-name": string
      "by-role": string
    }
  }
  syncQueue: {
    key: string
    value: {
      id: string
      type: "create" | "update" | "delete"
      collection: "flights" | "aircraft" | "airports" | "personnel"
      data: FlightLog | Aircraft | Airport | Personnel | { id: string }
      timestamp: number
    }
  }
}

let dbInstance: IDBPDatabase<LogbookDB> | null = null

export async function getDB(): Promise<IDBPDatabase<LogbookDB>> {
  if (dbInstance) return dbInstance

  dbInstance = await openDB<LogbookDB>("skylog-db", 2, {
    upgrade(db, oldVersion) {
      // Flights store
      if (!db.objectStoreNames.contains("flights")) {
        const flightStore = db.createObjectStore("flights", { keyPath: "id" })
        flightStore.createIndex("by-date", "date")
        flightStore.createIndex("by-sync", "syncStatus")
        flightStore.createIndex("by-aircraft", "aircraftId")
      }

      // Aircraft store
      if (!db.objectStoreNames.contains("aircraft")) {
        const aircraftStore = db.createObjectStore("aircraft", { keyPath: "id" })
        aircraftStore.createIndex("by-registration", "registration")
        aircraftStore.createIndex("by-type", "type")
      }

      // Airports store (new in v2)
      if (!db.objectStoreNames.contains("airports")) {
        const airportStore = db.createObjectStore("airports", { keyPath: "id" })
        airportStore.createIndex("by-icao", "icao")
        airportStore.createIndex("by-iata", "iata")
      }

      // Personnel store (new in v2)
      if (!db.objectStoreNames.contains("personnel")) {
        const personnelStore = db.createObjectStore("personnel", { keyPath: "id" })
        personnelStore.createIndex("by-name", "lastName")
        personnelStore.createIndex("by-role", "role")
      }

      // Sync queue
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "id" })
      }
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
  return flights.reverse()
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

export async function updateAircraft(id: string, updates: Partial<Aircraft>): Promise<Aircraft | null> {
  const db = await getDB()
  const aircraft = await db.get("aircraft", id)
  if (!aircraft) return null

  const updatedAircraft: Aircraft = {
    ...aircraft,
    ...updates,
    syncStatus: "pending",
  }

  await db.put("aircraft", updatedAircraft)
  await addToSyncQueue("update", "aircraft", updatedAircraft)

  return updatedAircraft
}

export async function getAllAircraft(): Promise<Aircraft[]> {
  const db = await getDB()
  return db.getAll("aircraft")
}

export async function getAircraftById(id: string): Promise<Aircraft | undefined> {
  const db = await getDB()
  return db.get("aircraft", id)
}

export async function getAircraftByRegistration(registration: string): Promise<Aircraft | undefined> {
  const db = await getDB()
  return db.getFromIndex("aircraft", "by-registration", registration.toUpperCase())
}

export async function addAirport(airport: Omit<Airport, "id" | "createdAt" | "syncStatus">): Promise<Airport> {
  const db = await getDB()
  const newAirport: Airport = {
    ...airport,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("airports", newAirport)
  await addToSyncQueue("create", "airports", newAirport)

  return newAirport
}

export async function updateAirport(id: string, updates: Partial<Airport>): Promise<Airport | null> {
  const db = await getDB()
  const airport = await db.get("airports", id)
  if (!airport) return null

  const updatedAirport: Airport = {
    ...airport,
    ...updates,
    syncStatus: "pending",
  }

  await db.put("airports", updatedAirport)
  await addToSyncQueue("update", "airports", updatedAirport)

  return updatedAirport
}

export async function getAllAirports(): Promise<Airport[]> {
  const db = await getDB()
  return db.getAll("airports")
}

export async function getAirportById(id: string): Promise<Airport | undefined> {
  const db = await getDB()
  return db.get("airports", id)
}

export async function getAirportByIcao(icao: string): Promise<Airport | undefined> {
  const db = await getDB()
  return db.getFromIndex("airports", "by-icao", icao.toUpperCase())
}

export async function getAirportByIata(iata: string): Promise<Airport | undefined> {
  const db = await getDB()
  return db.getFromIndex("airports", "by-iata", iata.toUpperCase())
}

export async function addPersonnel(personnel: Omit<Personnel, "id" | "createdAt" | "syncStatus">): Promise<Personnel> {
  const db = await getDB()
  const newPersonnel: Personnel = {
    ...personnel,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("personnel", newPersonnel)
  await addToSyncQueue("create", "personnel", newPersonnel)

  return newPersonnel
}

export async function updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Personnel | null> {
  const db = await getDB()
  const person = await db.get("personnel", id)
  if (!person) return null

  const updatedPersonnel: Personnel = {
    ...person,
    ...updates,
    syncStatus: "pending",
  }

  await db.put("personnel", updatedPersonnel)
  await addToSyncQueue("update", "personnel", updatedPersonnel)

  return updatedPersonnel
}

export async function getAllPersonnel(): Promise<Personnel[]> {
  const db = await getDB()
  return db.getAll("personnel")
}

export async function getPersonnelById(id: string): Promise<Personnel | undefined> {
  const db = await getDB()
  return db.get("personnel", id)
}

export async function getPersonnelByRole(role: Personnel["role"]): Promise<Personnel[]> {
  const db = await getDB()
  return db.getAllFromIndex("personnel", "by-role", role)
}

// Sync queue operations
async function addToSyncQueue(
  type: "create" | "update" | "delete",
  collection: "flights" | "aircraft" | "airports" | "personnel",
  data: FlightLog | Aircraft | Airport | Personnel | { id: string },
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

export async function getFlightStats() {
  const flights = await getAllFlights()

  const totalFlights = flights.length
  const blockTime = flights.reduce((sum, f) => sum + f.blockTime, 0)
  const flightTime = flights.reduce((sum, f) => sum + f.flightTime, 0)
  const p1Time = flights.reduce((sum, f) => sum + f.p1Time, 0)
  const p2Time = flights.reduce((sum, f) => sum + f.p2Time, 0)
  const p1usTime = flights.reduce((sum, f) => sum + f.p1usTime, 0)
  const dualTime = flights.reduce((sum, f) => sum + f.dualTime, 0)
  const nightTime = flights.reduce((sum, f) => sum + f.nightTime, 0)
  const ifrTime = flights.reduce((sum, f) => sum + f.ifrTime, 0)
  const totalDayLandings = flights.reduce((sum, f) => sum + f.dayLandings, 0)
  const totalNightLandings = flights.reduce((sum, f) => sum + f.nightLandings, 0)

  const uniqueAircraft = new Set(flights.map((f) => f.aircraftReg)).size
  const uniqueAirports = new Set([...flights.map((f) => f.departureIcao), ...flights.map((f) => f.arrivalIcao)]).size

  return {
    totalFlights,
    blockTime,
    flightTime,
    p1Time,
    p2Time,
    p1usTime,
    dualTime,
    nightTime,
    ifrTime,
    totalDayLandings,
    totalNightLandings,
    uniqueAircraft,
    uniqueAirports,
  }
}
