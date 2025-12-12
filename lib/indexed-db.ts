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

  // OOOI Times (UTC) - HH:MM format
  outTime: string // Out the gate (block off)
  offTime: string // Off ground (takeoff)
  onTime: string // On landing (touchdown)
  inTime: string // In the gate (block on)

  // Calculated Times - HH:MM format for accurate post-processing
  blockTime: string // In - Out (total block time)
  flightTime: string // On - Off (airborne time)

  // CAAS Hours Categories - HH:MM format
  p1Time: string // Pilot in Command
  p1usTime: string // PIC Under Supervision
  p2Time: string // Co-pilot / Second in Command
  dualTime: string // Dual instruction received
  instructorTime: string // Time as instructor

  // Conditions - HH:MM format
  nightTime: string // Auto-calculated from coordinates
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string

  // Landings
  dayLandings: number
  nightLandings: number

  // Crew
  crewIds: string[] // Personnel IDs
  pilotRole: "PIC" | "FO" | "STUDENT" | "INSTRUCTOR" | "P1US"

  // Additional
  flightNumber: string
  remarks: string

  isLocked?: boolean

  // Metadata
  createdAt: number
  updatedAt: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}

export interface Aircraft {
  id: string
  registration: string
  type: string
  typeDesignator: string
  model: string
  category: string
  engineType: "SEP" | "MEP" | "SET" | "MET" | "JET"
  isComplex: boolean
  isHighPerformance: boolean
  createdAt: number
  updatedAt?: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
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
  elevation: number
  timezone: string
  utcOffset: number
  dstObserved: boolean
  createdAt: number
  updatedAt?: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
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
  updatedAt?: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}

export interface UserPreferences {
  id: string
  fieldOrder: {
    flight: string[]
    time: string[]
    crew: string[]
    landings: string[]
    approaches: string[]
    notes: string[]
  }
  visibleFields: {
    [key: string]: boolean
  }
  createdAt: number
  updatedAt: number
}

interface LogbookDB extends DBSchema {
  flights: {
    key: string
    value: FlightLog
    indexes: {
      "by-date": string
      "by-sync": string
      "by-aircraft": string
      "by-mongoId": string
    }
  }
  aircraft: {
    key: string
    value: Aircraft
    indexes: {
      "by-registration": string
      "by-type": string
      "by-mongoId": string
    }
  }
  airports: {
    key: string
    value: Airport
    indexes: {
      "by-icao": string
      "by-iata": string
      "by-mongoId": string
    }
  }
  personnel: {
    key: string
    value: Personnel
    indexes: {
      "by-name": string
      "by-role": string
      "by-mongoId": string
    }
  }
  preferences: {
    key: string
    value: UserPreferences
  }
  syncQueue: {
    key: string
    value: {
      id: string
      type: "create" | "update" | "delete"
      collection: "flights" | "aircraft" | "airports" | "personnel"
      data: FlightLog | Aircraft | Airport | Personnel | { id: string; mongoId?: string }
      timestamp: number
    }
  }
  syncMeta: {
    key: string
    value: {
      key: string
      lastSyncAt: number
    }
  }
}

let dbInstance: IDBPDatabase<LogbookDB> | null = null
let isInitialized = false

export async function getDB(): Promise<IDBPDatabase<LogbookDB>> {
  if (dbInstance && isInitialized) return dbInstance

  dbInstance = await openDB<LogbookDB>("pilot-logbook", 3, {
    upgrade(db, oldVersion) {
      // Flights store
      if (!db.objectStoreNames.contains("flights")) {
        const flightStore = db.createObjectStore("flights", { keyPath: "id" })
        flightStore.createIndex("by-date", "date")
        flightStore.createIndex("by-sync", "syncStatus")
        flightStore.createIndex("by-aircraft", "aircraftId")
        flightStore.createIndex("by-mongoId", "mongoId")
      } else if (oldVersion < 3) {
        const tx = db.transaction as any
        if (tx && tx.objectStore) {
          const store = tx.objectStore("flights")
          if (!store.indexNames.contains("by-mongoId")) {
            store.createIndex("by-mongoId", "mongoId")
          }
        }
      }

      // Aircraft store
      if (!db.objectStoreNames.contains("aircraft")) {
        const aircraftStore = db.createObjectStore("aircraft", { keyPath: "id" })
        aircraftStore.createIndex("by-registration", "registration")
        aircraftStore.createIndex("by-type", "type")
        aircraftStore.createIndex("by-mongoId", "mongoId")
      }

      // Airports store
      if (!db.objectStoreNames.contains("airports")) {
        const airportStore = db.createObjectStore("airports", { keyPath: "id" })
        airportStore.createIndex("by-icao", "icao")
        airportStore.createIndex("by-iata", "iata")
        airportStore.createIndex("by-mongoId", "mongoId")
      }

      // Personnel store
      if (!db.objectStoreNames.contains("personnel")) {
        const personnelStore = db.createObjectStore("personnel", { keyPath: "id" })
        personnelStore.createIndex("by-name", "lastName")
        personnelStore.createIndex("by-role", "role")
        personnelStore.createIndex("by-mongoId", "mongoId")
      }

      // Sync queue
      if (!db.objectStoreNames.contains("syncQueue")) {
        db.createObjectStore("syncQueue", { keyPath: "id" })
      }

      // Sync metadata
      if (!db.objectStoreNames.contains("syncMeta")) {
        db.createObjectStore("syncMeta", { keyPath: "key" })
      }

      if (!db.objectStoreNames.contains("preferences")) {
        db.createObjectStore("preferences", { keyPath: "id" })
      }
    },
  })

  isInitialized = true
  return dbInstance
}

export async function initializeDB(): Promise<boolean> {
  try {
    await getDB()
    return true
  } catch (error) {
    console.error("Failed to initialize IndexedDB:", error)
    return false
  }
}

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
  await addToSyncQueue("delete", "flights", { id, mongoId: flight.mongoId })

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

export async function getFlightByMongoId(mongoId: string): Promise<FlightLog | undefined> {
  const db = await getDB()
  return db.getFromIndex("flights", "by-mongoId", mongoId)
}

export async function getPendingFlights(): Promise<FlightLog[]> {
  const db = await getDB()
  return db.getAllFromIndex("flights", "by-sync", "pending")
}

export async function upsertFlightFromServer(serverFlight: FlightLog): Promise<void> {
  const db = await getDB()

  // Ensure the record has all required fields with proper defaults
  const normalizedFlight: FlightLog = {
    id: serverFlight.id,
    date: serverFlight.date || new Date().toISOString().split("T")[0],
    aircraftId: serverFlight.aircraftId || "",
    aircraftType: serverFlight.aircraftType || "",
    aircraftReg: serverFlight.aircraftReg || "",
    departureAirportId: serverFlight.departureAirportId || "",
    arrivalAirportId: serverFlight.arrivalAirportId || "",
    departureIcao: serverFlight.departureIcao || "",
    arrivalIcao: serverFlight.arrivalIcao || "",
    outTime: serverFlight.outTime || "",
    offTime: serverFlight.offTime || "",
    onTime: serverFlight.onTime || "",
    inTime: serverFlight.inTime || "",
    blockTime: serverFlight.blockTime || "00:00",
    flightTime: serverFlight.flightTime || "00:00",
    p1Time: serverFlight.p1Time || "00:00",
    p1usTime: serverFlight.p1usTime || "00:00",
    p2Time: serverFlight.p2Time || "00:00",
    dualTime: serverFlight.dualTime || "00:00",
    instructorTime: serverFlight.instructorTime || "00:00",
    nightTime: serverFlight.nightTime || "00:00",
    ifrTime: serverFlight.ifrTime || "00:00",
    actualInstrumentTime: serverFlight.actualInstrumentTime || "00:00",
    simulatedInstrumentTime: serverFlight.simulatedInstrumentTime || "00:00",
    dayLandings: serverFlight.dayLandings || 0,
    nightLandings: serverFlight.nightLandings || 0,
    crewIds: serverFlight.crewIds || [],
    pilotRole: serverFlight.pilotRole || "FO",
    flightNumber: serverFlight.flightNumber || "",
    remarks: serverFlight.remarks || "",
    createdAt: serverFlight.createdAt || Date.now(),
    updatedAt: serverFlight.updatedAt || Date.now(),
    syncStatus: "synced",
    mongoId: serverFlight.mongoId,
    isLocked: serverFlight.isLocked,
  }

  // Check if we have this flight by mongoId first
  let existingFlight: FlightLog | undefined
  if (normalizedFlight.mongoId) {
    existingFlight = await db.getFromIndex("flights", "by-mongoId", normalizedFlight.mongoId)
  }

  // Also check by local id
  if (!existingFlight && normalizedFlight.id) {
    existingFlight = await db.get("flights", normalizedFlight.id)
  }

  if (existingFlight) {
    // Only update if server version is newer
    const serverTime = normalizedFlight.updatedAt || normalizedFlight.createdAt
    const localTime = existingFlight.updatedAt || existingFlight.createdAt

    if (serverTime >= localTime) {
      await db.put("flights", {
        ...normalizedFlight,
        id: existingFlight.id, // Keep local ID
      })
    }
  } else {
    // New flight from server
    await db.put("flights", normalizedFlight)
  }
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
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("aircraft", updatedAircraft)
  await addToSyncQueue("update", "aircraft", updatedAircraft)

  return updatedAircraft
}

export async function deleteAircraft(id: string): Promise<boolean> {
  const db = await getDB()
  const aircraft = await db.get("aircraft", id)
  if (!aircraft) return false

  await db.delete("aircraft", id)
  await addToSyncQueue("delete", "aircraft", { id, mongoId: aircraft.mongoId })
  return true
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

export async function upsertAircraftFromServer(serverAircraft: Aircraft): Promise<void> {
  const db = await getDB()

  const normalized: Aircraft = {
    id: serverAircraft.id,
    registration: serverAircraft.registration || "",
    type: serverAircraft.type || "",
    typeDesignator: serverAircraft.typeDesignator || "",
    model: serverAircraft.model || "",
    category: serverAircraft.category || "",
    engineType: serverAircraft.engineType || "SEP",
    isComplex: serverAircraft.isComplex || false,
    isHighPerformance: serverAircraft.isHighPerformance || false,
    createdAt: serverAircraft.createdAt || Date.now(),
    updatedAt: serverAircraft.updatedAt,
    syncStatus: "synced",
    mongoId: serverAircraft.mongoId,
  }

  let existing: Aircraft | undefined
  if (normalized.mongoId) {
    existing = await db.getFromIndex("aircraft", "by-mongoId", normalized.mongoId)
  }
  if (!existing && normalized.id) {
    existing = await db.get("aircraft", normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.put("aircraft", { ...normalized, id: existing.id })
    }
  } else {
    await db.put("aircraft", normalized)
  }
}

// Airport operations
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
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("airports", updatedAirport)
  await addToSyncQueue("update", "airports", updatedAirport)

  return updatedAirport
}

export async function deleteAirport(id: string): Promise<boolean> {
  const db = await getDB()
  const airport = await db.get("airports", id)
  if (!airport) return false

  await db.delete("airports", id)
  await addToSyncQueue("delete", "airports", { id, mongoId: airport.mongoId })
  return true
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

export async function upsertAirportFromServer(serverAirport: Airport): Promise<void> {
  const db = await getDB()

  const normalized: Airport = {
    id: serverAirport.id,
    icao: serverAirport.icao || "",
    iata: serverAirport.iata || "",
    name: serverAirport.name || "",
    city: serverAirport.city || "",
    country: serverAirport.country || "",
    latitude: serverAirport.latitude || 0,
    longitude: serverAirport.longitude || 0,
    elevation: serverAirport.elevation || 0,
    timezone: serverAirport.timezone || "UTC",
    utcOffset: serverAirport.utcOffset || 0,
    dstObserved: serverAirport.dstObserved || false,
    createdAt: serverAirport.createdAt || Date.now(),
    updatedAt: serverAirport.updatedAt,
    syncStatus: "synced",
    mongoId: serverAirport.mongoId,
  }

  let existing: Airport | undefined
  if (normalized.mongoId) {
    existing = await db.getFromIndex("airports", "by-mongoId", normalized.mongoId)
  }
  if (!existing && normalized.id) {
    existing = await db.get("airports", normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.put("airports", { ...normalized, id: existing.id })
    }
  } else {
    await db.put("airports", normalized)
  }
}

// Personnel operations
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
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.put("personnel", updatedPersonnel)
  await addToSyncQueue("update", "personnel", updatedPersonnel)

  return updatedPersonnel
}

export async function deletePersonnel(id: string): Promise<boolean> {
  const db = await getDB()
  const person = await db.get("personnel", id)
  if (!person) return false

  await db.delete("personnel", id)
  await addToSyncQueue("delete", "personnel", { id, mongoId: person.mongoId })
  return true
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

export async function upsertPersonnelFromServer(serverPersonnel: Personnel): Promise<void> {
  const db = await getDB()

  const normalized: Personnel = {
    id: serverPersonnel.id,
    firstName: serverPersonnel.firstName || "",
    lastName: serverPersonnel.lastName || "",
    employeeId: serverPersonnel.employeeId,
    licenseNumber: serverPersonnel.licenseNumber,
    role: serverPersonnel.role || "OTHER",
    company: serverPersonnel.company,
    email: serverPersonnel.email,
    notes: serverPersonnel.notes,
    createdAt: serverPersonnel.createdAt || Date.now(),
    updatedAt: serverPersonnel.updatedAt,
    syncStatus: "synced",
    mongoId: serverPersonnel.mongoId,
  }

  let existing: Personnel | undefined
  if (normalized.mongoId) {
    existing = await db.getFromIndex("personnel", "by-mongoId", normalized.mongoId)
  }
  if (!existing && normalized.id) {
    existing = await db.get("personnel", normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.put("personnel", { ...normalized, id: existing.id })
    }
  } else {
    await db.put("personnel", normalized)
  }
}

// Sync queue operations
async function addToSyncQueue(
  type: "create" | "update" | "delete",
  collection: "flights" | "aircraft" | "airports" | "personnel",
  data: FlightLog | Aircraft | Airport | Personnel | { id: string; mongoId?: string },
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

export async function markRecordSynced(
  collection: "flights" | "aircraft" | "airports" | "personnel",
  id: string,
  mongoId: string,
) {
  const db = await getDB()
  const record = await db.get(collection, id)
  if (record) {
    await db.put(collection, { ...record, syncStatus: "synced", mongoId } as any)
  }
}

export async function getLastSyncTime(): Promise<number> {
  const db = await getDB()
  const meta = await db.get("syncMeta", "lastSync")
  return meta?.lastSyncAt || 0
}

export async function setLastSyncTime(timestamp: number): Promise<void> {
  const db = await getDB()
  await db.put("syncMeta", { key: "lastSync", lastSyncAt: timestamp })
}

export async function getFlightStats() {
  const { sumHHMM } = await import("./time-utils")
  const flights = await getAllFlights()

  const totalFlights = flights.length
  const blockTime = sumHHMM(flights.map((f) => f.blockTime))
  const flightTime = sumHHMM(flights.map((f) => f.flightTime))
  const p1Time = sumHHMM(flights.map((f) => f.p1Time))
  const p2Time = sumHHMM(flights.map((f) => f.p2Time))
  const p1usTime = sumHHMM(flights.map((f) => f.p1usTime))
  const dualTime = sumHHMM(flights.map((f) => f.dualTime))
  const nightTime = sumHHMM(flights.map((f) => f.nightTime))
  const ifrTime = sumHHMM(flights.map((f) => f.ifrTime))
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

// Preference management functions
export async function getUserPreferences(): Promise<UserPreferences | null> {
  const db = await getDB()
  return db.get("preferences", "user-prefs")
}

export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const db = await getDB()
  const existing = await getUserPreferences()

  const preferences: UserPreferences = {
    id: "user-prefs",
    fieldOrder: existing?.fieldOrder || {
      flight: ["date", "flightNumber", "aircraft", "from", "to", "out", "off", "on", "in"],
      time: ["total", "night", "p1us", "sic", "xc", "ifr", "actualInst", "simInst"],
      crew: ["pf", "pic", "sic", "observer"],
      landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
      approaches: ["app1", "app2", "holds"],
      notes: ["remarks", "ipcIcc"],
    },
    visibleFields: existing?.visibleFields || {},
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    ...prefs,
  }

  await db.put("preferences", preferences)
}

export async function getDefaultFieldOrder() {
  return {
    flight: ["date", "flightNumber", "aircraft", "from", "to", "out", "off", "on", "in"],
    time: ["total", "night", "p1us", "sic", "xc", "ifr", "actualInst", "simInst"],
    crew: ["pf", "pic", "sic", "observer"],
    landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
    approaches: ["app1", "app2", "holds"],
    notes: ["remarks", "ipcIcc"],
  }
}
