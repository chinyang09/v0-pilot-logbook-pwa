/**
 * Flight entity type definitions
 * USER DATA - syncs with MongoDB
 */

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

export interface ManualOverrides {
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

export type PilotRole = "PIC" | "SIC" | "PICUS" | "Dual" | "Instructor"

export type SyncStatus = "synced" | "pending" | "error"

export interface Flight {
  id: string // ULID - domain identity
  userId: string // Owner's user ID
  isDraft: boolean

  // Flight identification
  date: string // YYYY-MM-DD
  flightNumber: string

  // Aircraft
  aircraftReg: string
  aircraftType: string

  // Airports
  departureIcao: string
  departureIata: string
  arrivalIcao: string
  arrivalIata: string
  departureTimezone: number // Offset in hours
  arrivalTimezone: number

  // Times (HH:MM UTC)
  scheduledOut: string
  scheduledIn: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string

  // Calculated times (HH:MM)
  blockTime: string
  flightTime: string
  nightTime: string
  dayTime: string

  // Crew
  picId: string
  picName: string
  sicId: string
  sicName: string
  additionalCrew: AdditionalCrew[]

  // Flying duties
  pilotFlying: boolean
  pilotRole: PilotRole

  // Time logging (HH:MM)
  picTime: string
  sicTime: string
  picusTime: string
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

  // Manual overrides
  manualOverrides: ManualOverrides

  // Instrument
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
  approaches: Approach[]
  holds: number
  ipcIcc: boolean

  // Metadata
  isLocked?: boolean
  createdAt: number
  updatedAt: number
  syncStatus: SyncStatus
  mongoId?: string // Server-assigned ID (never exposed to client logic)
  lastSyncedAt?: number
}

// Input type for creating a new flight
export type FlightInput = Omit<Flight, "id" | "createdAt" | "updatedAt" | "syncStatus">

// Input type for updating a flight
export type FlightUpdate = Partial<Omit<Flight, "id" | "userId" | "createdAt">>
