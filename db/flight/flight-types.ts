/**
 * Flight domain types
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

export interface FlightLog {
  id: string
  userId?: string
  isDraft: boolean
  date: string
  flightNumber: string
  aircraftReg: string
  aircraftType: string
  departureIcao: string
  departureIata: string
  arrivalIcao: string
  arrivalIata: string
  departureTimezone: number
  arrivalTimezone: number
  scheduledOut: string
  scheduledIn: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string
  blockTime: string
  flightTime: string
  nightTime: string
  dayTime: string
  picId: string
  picName: string
  sicId: string
  sicName: string
  additionalCrew: AdditionalCrew[]
  pilotFlying: boolean
  pilotRole: "PIC" | "SIC" | "PICUS" | "Dual" | "Instructor"
  picTime: string
  sicTime: string
  picusTime: string
  dualTime: string
  instructorTime: string
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  autolands: number
  remarks: string
  endorsements: string
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
  ifrTime: string
  actualInstrumentTime: string
  simulatedInstrumentTime: string
  crossCountryTime: string
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
