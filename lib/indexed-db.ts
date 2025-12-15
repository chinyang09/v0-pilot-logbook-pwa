import Dexie, { type Table } from "dexie"
import { sumHHMM } from "./time-utils"
import type { UserPreferences } from "./user-preferences"

export interface FlightLog {
  id: string
  date: string
  flightNumber: string
  aircraftId: string
  aircraftReg: string
  aircraftType: string
  departureIcao: string
  arrivalIcao: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string
  blockTime: string
  flightTime: string
  p1Time: string
  p1usTime: string
  p2Time: string
  dualTime: string
  instructorTime: string
  nightTime: string
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  autolands: number
  personnelIds: string[] // Matches Personnel.id
  picId: string // Added explicit PIC reference
  sicId: string // Added explicit SIC reference
  pilotRole: "PIC" | "FO" | "STUDENT" | "INSTRUCTOR" | "P1US"
  approach1: string
  approach2: string
  holds: number
  remarks: string
  ipcIcc: boolean
  isLocked?: boolean
  createdAt: number
  updatedAt: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
}

export interface Aircraft {
  id: string
  registration: string // Matches FlightLog.aircraftReg
  type: string // Matches FlightLog.aircraftType
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
  icao: string // Primary key now
  iata: string
  name: string
  city: string
  state: string
  country: string
  latitude: number
  longitude: number
  elevation: number
  timezone: string
}

export interface Personnel {
  id: string // Matches FlightLog.personnelIds
  firstName: string
  lastName: string
  name: string // firstName + lastName combined
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

interface SyncQueueItem {
  id: string
  type: "create" | "update" | "delete"
  timestamp: number
  collection: "flights" | "aircraft" | "personnel"
  data: FlightLog | Aircraft | Personnel | { id: string; mongoId?: string }
}

interface SyncMeta {
  key: string
  lastSyncAt: number
}

class PilotLogbookDB extends Dexie {
  flights!: Table<FlightLog, string>
  aircraft!: Table<Aircraft, string>
  airports!: Table<Airport, string>
  personnel!: Table<Personnel, string>
  preferences!: Table<UserPreferences, string>
  syncQueue!: Table<SyncQueueItem, string>
  syncMeta!: Table<SyncMeta, string>

  constructor() {
    super("pilot-logbook")

    this.version(5).stores({
      flights: "id, date, syncStatus, aircraftId, mongoId",
      aircraft: "id, registration, type, mongoId",
      airports: "icao, iata, name", // No sync fields needed
      personnel: "id, name, mongoId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
    })
  }
}

export const db = new PilotLogbookDB()

export async function getDB(): Promise<PilotLogbookDB> {
  return db
}

export async function initializeDB(): Promise<boolean> {
  try {
    const openPromise = db.open()
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("IndexedDB open timeout")), 10000),
    )

    await Promise.race([openPromise, timeoutPromise])
    console.log("[v0] IndexedDB initialized successfully")
    return true
  } catch (error) {
    console.error("[v0] Failed to initialize IndexedDB:", error)
    return false
  }
}

// Flight operations
export async function addFlight(
  flight: Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus">,
): Promise<FlightLog> {
  const now = Date.now()
  const newFlight: FlightLog = {
    ...flight,
    id: crypto.randomUUID(),
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

export async function getAllFlights(): Promise<FlightLog[]> {
  const flights = await db.flights.orderBy("date").reverse().toArray()
  return flights
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

export async function upsertFlightFromServer(serverFlight: FlightLog): Promise<void> {
  const normalized: FlightLog = {
    id: serverFlight.id,
    date: serverFlight.date,
    flightNumber: serverFlight.flightNumber || "",
    aircraftId: serverFlight.aircraftId || "",
    aircraftReg: serverFlight.aircraftReg || "",
    aircraftType: serverFlight.aircraftType || "",
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
    crossCountryTime: serverFlight.crossCountryTime || "00:00",
    dayTakeoffs: serverFlight.dayTakeoffs || 0,
    dayLandings: serverFlight.dayLandings || 0,
    nightTakeoffs: serverFlight.nightTakeoffs || 0,
    nightLandings: serverFlight.nightLandings || 0,
    autolands: serverFlight.autolands || 0,
    personnelIds: serverFlight.personnelIds || (serverFlight as any).crewIds || [],
    picId: serverFlight.picId || "",
    sicId: serverFlight.sicId || "",
    pilotRole: serverFlight.pilotRole || "FO",
    approach1: serverFlight.approach1 || "",
    approach2: serverFlight.approach2 || "",
    holds: serverFlight.holds || 0,
    remarks: serverFlight.remarks || "",
    ipcIcc: serverFlight.ipcIcc || false,
    createdAt: serverFlight.createdAt || Date.now(),
    updatedAt: serverFlight.updatedAt || Date.now(),
    syncStatus: "synced",
    mongoId: serverFlight.mongoId,
    isLocked: serverFlight.isLocked,
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
      await db.flights.put({
        ...normalized,
        id: existingFlight.id,
      })
    }
  } else {
    await db.flights.put(normalized)
  }
}

// Aircraft operations
export async function addAircraft(aircraft: Omit<Aircraft, "id" | "createdAt" | "syncStatus">): Promise<Aircraft> {
  const newAircraft: Aircraft = {
    ...aircraft,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.aircraft.put(newAircraft)
  await addToSyncQueue("create", "aircraft", newAircraft)

  return newAircraft
}

export async function updateAircraft(id: string, updates: Partial<Aircraft>): Promise<Aircraft | null> {
  const aircraft = await db.aircraft.get(id)
  if (!aircraft) return null

  const updatedAircraft: Aircraft = {
    ...aircraft,
    ...updates,
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.aircraft.put(updatedAircraft)
  await addToSyncQueue("update", "aircraft", updatedAircraft)

  return updatedAircraft
}

export async function deleteAircraft(id: string): Promise<boolean> {
  const aircraft = await db.aircraft.get(id)
  if (!aircraft) return false

  await db.aircraft.delete(id)
  await addToSyncQueue("delete", "aircraft", { id, mongoId: aircraft.mongoId })
  return true
}

export async function getAllAircraft(): Promise<Aircraft[]> {
  return db.aircraft.toArray()
}

export async function getAircraftById(id: string): Promise<Aircraft | undefined> {
  return db.aircraft.get(id)
}

export async function upsertAircraftFromServer(serverAircraft: Aircraft): Promise<void> {
  const normalized: Aircraft = {
    id: serverAircraft.id,
    registration: serverAircraft.registration,
    type: serverAircraft.type,
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
    existing = await db.aircraft.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await db.aircraft.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.aircraft.put({ ...normalized, id: existing.id })
    }
  } else {
    await db.aircraft.put(normalized)
  }
}

// Airport operations
export async function getAllAirports(): Promise<Airport[]> {
  return db.airports.toArray()
}

export async function getAirportByIcao(icao: string): Promise<Airport | undefined> {
  return db.airports.get(icao.toUpperCase())
}

export async function getAirportByIata(iata: string): Promise<Airport | undefined> {
  return db.airports.where("iata").equals(iata.toUpperCase()).first()
}

export async function bulkLoadAirports(airports: Airport[]): Promise<void> {
  await db.airports.bulkPut(airports)
}

export async function addCustomAirport(airport: Omit<Airport, "icao"> & { icao: string }): Promise<void> {
  await db.airports.put(airport)
}

// Personnel operations
export async function addPersonnel(
  personnel: Omit<Personnel, "id" | "createdAt" | "syncStatus" | "name">,
): Promise<Personnel> {
  const newPersonnel: Personnel = {
    ...personnel,
    id: crypto.randomUUID(),
    name: `${personnel.firstName} ${personnel.lastName}`.trim(),
    createdAt: Date.now(),
    syncStatus: "pending",
  }

  await db.personnel.put(newPersonnel)
  await addToSyncQueue("create", "personnel", newPersonnel)

  return newPersonnel
}

export async function updatePersonnel(id: string, updates: Partial<Personnel>): Promise<Personnel | null> {
  const person = await db.personnel.get(id)
  if (!person) return null

  const updatedPersonnel: Personnel = {
    ...person,
    ...updates,
    name: `${updates.firstName || person.firstName} ${updates.lastName || person.lastName}`.trim(),
    updatedAt: Date.now(),
    syncStatus: "pending",
  }

  await db.personnel.put(updatedPersonnel)
  await addToSyncQueue("update", "personnel", updatedPersonnel)

  return updatedPersonnel
}

export async function deletePersonnel(id: string): Promise<boolean> {
  const person = await db.personnel.get(id)
  if (!person) return false

  await db.personnel.delete(id)
  await addToSyncQueue("delete", "personnel", { id, mongoId: person.mongoId })
  return true
}

export async function getAllPersonnel(): Promise<Personnel[]> {
  return db.personnel.toArray()
}

export async function getPersonnelById(id: string): Promise<Personnel | undefined> {
  return db.personnel.get(id)
}

export async function getPersonnelByRole(role: Personnel["role"]): Promise<Personnel[]> {
  return db.personnel.where("role").equals(role).toArray()
}

export async function upsertPersonnelFromServer(serverPersonnel: Personnel): Promise<void> {
  const normalized: Personnel = {
    id: serverPersonnel.id,
    firstName: serverPersonnel.firstName || "",
    lastName: serverPersonnel.lastName || "",
    name: `${serverPersonnel.firstName || ""} ${serverPersonnel.lastName || ""}`.trim(),
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
    existing = await db.personnel.where("mongoId").equals(normalized.mongoId).first()
  }
  if (!existing && normalized.id) {
    existing = await db.personnel.get(normalized.id)
  }

  if (existing) {
    const serverTime = normalized.updatedAt || normalized.createdAt
    const localTime = existing.updatedAt || existing.createdAt
    if (serverTime >= localTime) {
      await db.personnel.put({ ...normalized, id: existing.id })
    }
  } else {
    await db.personnel.put(normalized)
  }
}

// Sync queue operations
async function addToSyncQueue(
  type: "create" | "update" | "delete",
  collection: "flights" | "aircraft" | "personnel",
  data: FlightLog | Aircraft | Personnel | { id: string; mongoId?: string },
) {
  await db.syncQueue.put({
    id: crypto.randomUUID(),
    type,
    collection,
    data,
    timestamp: Date.now(),
  })
}

export async function getSyncQueue() {
  return db.syncQueue.toArray()
}

export async function clearSyncQueueItem(id: string) {
  await db.syncQueue.delete(id)
}

export async function markFlightSynced(id: string, mongoId: string) {
  const flight = await db.flights.get(id)
  if (flight) {
    await db.flights.put({ ...flight, syncStatus: "synced", mongoId })
  }
}

export async function markRecordSynced(collection: "flights" | "aircraft" | "personnel", id: string, mongoId: string) {
  const record = await db[collection].get(id)
  if (record) {
    await db[collection].put({ ...record, syncStatus: "synced", mongoId } as any)
  }
}

export async function getLastSyncTime(): Promise<number> {
  const meta = await db.syncMeta.get("lastSync")
  return meta?.lastSyncAt || 0
}

export async function setLastSyncTime(timestamp: number): Promise<void> {
  await db.syncMeta.put({ key: "lastSync", lastSyncAt: timestamp })
}

export async function getFlightStats() {
  const flights = await db.flights.toArray()

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
  const totalAutolands = flights.reduce((sum, f) => sum + f.autolands, 0)

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
    totalAutolands,
    uniqueAircraft,
    uniqueAirports,
  }
}

// Preference management functions
export async function getUserPreferences(): Promise<UserPreferences | null> {
  return db.preferences.get("user-prefs")
}

export async function saveUserPreferences(prefs: Partial<UserPreferences>): Promise<void> {
  const existing = await getUserPreferences()

  const preferences: UserPreferences = {
    key: "user-prefs",
    fieldOrder: existing?.fieldOrder || {
      flight: [
        "date",
        "flightNumber",
        "aircraftId",
        "departureIcao",
        "arrivalIcao",
        "outTime",
        "offTime",
        "onTime",
        "inTime",
      ],
      time: ["total", "night", "p1us", "sicTime", "xc", "ifr", "actualInst", "simInst"],
      crew: ["pf", "picCrew", "sicCrew", "observer"],
      landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
      approaches: ["app1", "app2", "holds"],
      notes: ["remarks", "ipcIcc"],
    },
    visibleFields: existing?.visibleFields || {},
    recentlyUsedAirports: existing?.recentlyUsedAirports || [],
    createdAt: existing?.createdAt || Date.now(),
    updatedAt: Date.now(),
    ...prefs,
  }

  await db.preferences.put(preferences)
}

export async function getDefaultFieldOrder() {
  return {
    flight: [
      "date",
      "flightNumber",
      "aircraftId",
      "departureIcao",
      "arrivalIcao",
      "outTime",
      "offTime",
      "onTime",
      "inTime",
    ],
    time: ["total", "night", "p1us", "sicTime", "xc", "ifr", "actualInst", "simInst"],
    crew: ["pf", "picCrew", "sicCrew", "observer"],
    landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
    approaches: ["app1", "app2", "holds"],
    notes: ["remarks", "ipcIcc"],
  }
}

// Functions to track recently used airports
export async function addRecentlyUsedAirport(icao: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAirports || []

  // Remove if already exists, then add to front
  const filtered = recentlyUsed.filter((code) => code !== icao)
  const updated = [icao, ...filtered].slice(0, 10) // Keep only last 10

  await saveUserPreferences({ recentlyUsedAirports: updated })
}

export async function getRecentlyUsedAirports(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAirports || []
}
