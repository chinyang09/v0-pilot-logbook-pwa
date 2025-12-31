import Dexie, { type Table } from "dexie"
import { sumHHMM } from "./time-utils"
import type { UserPreferences } from "./user-preferences"

export interface UserSession {
  id: string // Always "current"
  userId: string // The user's CUID from MongoDB
  callsign: string
  sessionToken: string
  expiresAt: number
  createdAt: number
}

export interface Approach {
  type: "ILS" | "VOR" | "NDB" | "RNAV" | "LOC" | "LDA" | "SDF" | "GPS" | "VISUAL" | "OTHER"
  category: "precision" | "non-precision"
  runway?: string
  airport?: string
}

export interface AdditionalCrew {
  id?: string
  name: string
  role: "Observer" | "Check Airman" | "Instructor" | "Examiner" | "Other"
}

export interface FlightLog {
  id: string
  userId?: string // Add userId for user-specific filtering
  isDraft: boolean // New: true if user hasn't saved yet
  date: string
  flightNumber: string
  aircraftReg: string
  aircraftType: string
  departureIcao: string
  departureIata: string
  arrivalIcao: string
  arrivalIata: string
  // Departure airport timezone offset in hours (e.g., 8 for UTC+8)
  departureTimezone: number
  // Arrival airport timezone offset in hours
  arrivalTimezone: number
  scheduledOut: string // HH:MM UTC
  scheduledIn: string // HH:MM UTC
  outTime: string // HH:MM UTC
  offTime: string // HH:MM UTC
  onTime: string // HH:MM UTC
  inTime: string // HH:MM UTC
  blockTime: string // HH:MM calculated from out/in
  flightTime: string // HH:MM calculated from off/on
  nightTime: string // HH:MM calculated from civil twilight
  dayTime: string // HH:MM calculated (flightTime - nightTime)
  // Crew
  picId: string
  picName: string
  sicId: string
  sicName: string
  additionalCrew: AdditionalCrew[] // New: replaces otherCrew
  // Flying duties
  pilotFlying: boolean // New: determines if T/O and landings count
  pilotRole: "PIC" | "SIC" | "PICUS" | "Dual" | "Instructor"
  // Time logging - all in HH:MM format (stored as minutes internally)
  picTime: string
  sicTime: string
  picusTime: string // P1 U/S time
  dualTime: string
  instructorTime: string
  // Takeoffs and Landings
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  autolands: number
  // Remarks
  remarks: string
  endorsements: string
  // Manual overrides - values user has manually changed (not from "USE" button)
  manualOverrides: {
    nightTime?: boolean
    ifrTime?: boolean
    actualInstrumentTime?: boolean
    crossCountryTime?: boolean
    picTime?: boolean
    sicTime?: boolean
    picusTime?: boolean
    dayTakeoffs?: boolean
    dayLandings?: boolean
    nightTakeoffs?: boolean
    nightLandings?: boolean
  }
  // Instrument
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
  // Approaches - now an array
  approaches: Approach[]
  holds: number
  ipcIcc: boolean
  isLocked?: boolean
  createdAt: number
  updatedAt: number
  syncStatus: "synced" | "pending" | "error"
  mongoId?: string
  lastSyncedAt?: number
}

export interface Aircraft {
  id: string
  userId?: string // Add userId for user-specific filtering
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
  id: string
  userId?: string // Add userId for user-specific filtering
  name: string
  crewId?: string
  organization?: string
  roles?: ("PIC" | "SIC" | "Instructor" | "Examiner")[]
  licenceNumber?: string
  contact?: {
    email?: string
    phone?: string
  }
  comment?: string
  isMe?: boolean
  favorite?: boolean
  defaultPIC?: boolean
  defaultSIC?: boolean
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
  aircraftDatabase!: Table<{ registration: string; data: string }, string> // CDN aircraft cache
  userSession!: Table<UserSession, string> // Add userSession table

  constructor() {
    super("pilot-logbook")

    this.version(9).stores({
      flights: "id, date, syncStatus, aircraftReg, mongoId, userId",
      aircraft: "id, registration, type, mongoId, userId",
      airports: "icao, iata, name", // No sync fields needed
      personnel: "id, name, mongoId, userId",
      preferences: "key",
      syncQueue: "id, collection, timestamp",
      syncMeta: "key",
      aircraftDatabase: "registration", // CDN aircraft cache
      userSession: "id", // Single row table for current session
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
    userId: serverAircraft.userId,
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
export async function addPersonnel(personnel: Omit<Personnel, "id" | "createdAt" | "syncStatus">): Promise<Personnel> {
  const newPersonnel: Personnel = {
    ...personnel,
    id: crypto.randomUUID(),
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

export async function getPersonnelByRole(role: Personnel["roles"][number]): Promise<Personnel[]> {
  return db.personnel.where("roles").equals(role).toArray()
}

export async function upsertPersonnelFromServer(serverPersonnel: Personnel): Promise<void> {
  const normalized: Personnel = {
    id: serverPersonnel.id,
    userId: serverPersonnel.userId,
    name: serverPersonnel.name || "",
    crewId: serverPersonnel.crewId,
    organization: serverPersonnel.organization,
    roles: serverPersonnel.roles || [],
    licenceNumber: serverPersonnel.licenceNumber,
    contact: serverPersonnel.contact || {},
    comment: serverPersonnel.comment,
    isMe: serverPersonnel.isMe,
    favorite: serverPersonnel.favorite,
    defaultPIC: serverPersonnel.defaultPIC,
    defaultSIC: serverPersonnel.defaultSIC,
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
  const picTime = sumHHMM(flights.map((f) => f.picTime))
  const sicTime = sumHHMM(flights.map((f) => f.sicTime))
  const picusTime = sumHHMM(flights.map((f) => f.picusTime))
  const dualTime = sumHHMM(flights.map((f) => f.dualTime))
  const instructorTime = sumHHMM(flights.map((f) => f.instructorTime))
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
    picTime,
    sicTime,
    picusTime,
    dualTime,
    instructorTime,
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
        "aircraftReg",
        "departureIcao",
        "departureIata",
        "arrivalIcao",
        "arrivalIata",
        "scheduledOut",
        "scheduledIn",
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
    recentlyUsedAircraft: existing?.recentlyUsedAircraft || [],
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
      "aircraftReg",
      "departureIcao",
      "departureIata",
      "arrivalIcao",
      "arrivalIata",
      "scheduledOut",
      "scheduledIn",
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

// Functions to track recently used aircraft
export async function addRecentlyUsedAircraft(registration: string): Promise<void> {
  const prefs = await getUserPreferences()
  const recentlyUsed = prefs?.recentlyUsedAircraft || []

  // Remove if already exists, then add to front
  const filtered = recentlyUsed.filter((reg) => reg !== registration)
  const updated = [registration, ...filtered].slice(0, 10) // Keep only last 10

  await saveUserPreferences({ recentlyUsedAircraft: updated })
}

export async function getRecentlyUsedAircraft(): Promise<string[]> {
  const prefs = await getUserPreferences()
  return prefs?.recentlyUsedAircraft || []
}

// CDN aircraft caching functions
export async function addAircraftToDatabase(registration: string, data: string): Promise<void> {
  await db.aircraftDatabase.put({ registration, data })
}

export async function getAircraftFromDatabase(
  registration: string,
): Promise<{ registration: string; data: string } | undefined> {
  return db.aircraftDatabase.get(registration.toUpperCase())
}

export async function deleteAircraftFromDatabase(registration: string): Promise<boolean> {
  const aircraft = await db.aircraftDatabase.get(registration)
  if (!aircraft) return false

  await db.aircraftDatabase.delete(registration)
  return true
}

export async function getAllAircraftFromDatabase(): Promise<{ registration: string; data: string }[]> {
  return db.aircraftDatabase.toArray()
}

// User session management functions
export async function saveUserSession(session: Omit<UserSession, "id" | "createdAt">): Promise<void> {
  await db.userSession.put({
    id: "current",
    ...session,
    createdAt: Date.now(),
  })
}

export async function getUserSession(): Promise<UserSession | undefined> {
  const session = await db.userSession.get("current")
  if (session && session.expiresAt > Date.now()) {
    return session
  }
  // Session expired, clear it
  if (session) {
    await clearUserSession()
  }
  return undefined
}

export async function clearUserSession(): Promise<void> {
  await db.userSession.delete("current")
}

// Function to clear all user data (for logout or user switch)
export async function clearAllUserData(): Promise<void> {
  await db.flights.clear()
  await db.aircraft.clear()
  await db.personnel.clear()
  await db.syncQueue.clear()
  await db.syncMeta.clear()
  await db.preferences.clear()
  await clearUserSession()
}

// Function to get current user ID from session
export async function getCurrentUserId(): Promise<string | null> {
  const session = await getUserSession()
  return session?.userId || null
}
