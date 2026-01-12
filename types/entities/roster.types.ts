/**
 * Roster/Schedule-related type definitions
 */

import type { SyncStatus } from "./flight.types"

// ============================================
// Enums & Constants
// ============================================

export type DutyType =
  | "flight"      // Regular flight duty
  | "standby"     // BKUP, SBYG, etc.
  | "training"    // EBT1, EBT2, simulator
  | "leave"       // ALL, CCL, CSL
  | "off"         // LOFF, OOFF
  | "ground"      // Office duty, meetings
  | "positioning" // Deadhead/positioning flights
  | "other"

export type TimeReference = "UTC" | "LOCAL_BASE"

export type CurrencyCode =
  | "MEDIC"      // Medical
  | "SEP-E"      // SEP Exam
  | "SEP-L"      // SEP LET
  | "SEP-W"      // SEP WET
  | "OPC320"     // OPC A320
  | "ARIR32"     // AR/IR A320
  | "RT320"      // Recurrent Training A320
  | "OLC320"     // OLC A320
  | "CRM"        // CRM Training
  | "PASSP"      // Passport
  | "LICENCE"    // Pilot Licence
  | "LC"         // Line Check
  | "PPC"        // Proficiency Check
  | "CUSTOM"     // User-defined

export type DiscrepancyType =
  | "duplicate"           // Same flight exists twice
  | "time_mismatch"       // Times differ significantly
  | "crew_mismatch"       // Crew assignment differs
  | "route_mismatch"      // Airports differ
  | "missing_in_logbook"  // In schedule but not logged
  | "missing_in_schedule" // In logbook but not in schedule

// Only track flight crew (pilots) - cabin crew not tracked
export type CrewRole = "CPT" | "PIC" | "FO"

// ============================================
// Schedule Entry (parsed from CSV)
// ============================================

/**
 * Individual flight sector within a duty
 */
export interface ScheduledSector {
  flightNumber: string              // "236", "TR606"
  aircraftType: string              // "320", "32Q", "32N"
  departureIata: string             // "SIN"
  arrivalIata: string               // "YIA"
  scheduledOut: string              // HH:MM (in timeReference)
  scheduledIn: string               // HH:MM (in timeReference)
  actualOut?: string                // From "A" prefix times
  actualIn?: string
  delay?: number                    // Minutes, from /00:47 notation
  nextDay?: boolean                 // ⁺¹ indicator
  linkedFlightId?: string           // FlightLog ID if matched/created
}

/**
 * Crew member on a duty (pilots only - cabin crew not tracked)
 * CPT/PIC maps to PIC role, FO maps to SIC role
 */
export interface ScheduledCrewMember {
  role: CrewRole                    // "CPT", "PIC", or "FO"
  crewId: string                    // "2727"
  name: string                      // "Yu Shuqing"
  personnelId?: string              // Linked to Personnel table
}

/**
 * Training session details
 */
export interface TrainingDetails {
  courseName: string                // "*A320 EBT Cycle5 (Nov 10)"
  courseComponent: string           // "SMCK EBT5 D1"
  facility: string                  // "AATC SIM B"
  facilityLocation: string          // "SIN"
  facilityAddress?: string
  instructorId?: string
  instructorName?: string
  startTime: string                 // HH:MM
  endTime: string                   // HH:MM
}

/**
 * A single duty entry (one row/day from schedule)
 */
export interface ScheduleEntry {
  id: string
  userId?: string

  // Date & timing
  date: string                      // YYYY-MM-DD
  timeReference: TimeReference
  reportTime?: string               // HH:MM
  debriefTime?: string              // HH:MM

  // Duty classification
  dutyType: DutyType
  dutyCode?: string                 // Original code: "LOFF", "236 [320]", "EBT1"
  dutyDescription?: string          // "Local Day Off for Tech Crew"

  // Flight sectors (if dutyType === "flight")
  sectors: ScheduledSector[]

  // Crew (if dutyType === "flight")
  crew: ScheduledCrewMember[]

  // Indicators & notes
  indicators?: string[]             // ["M"] for memos
  memo?: string                     // Day memo text

  // Training details (if dutyType === "training")
  training?: TrainingDetails

  // Standby details
  standbyWindow?: {
    start: string                   // HH:MM
    end: string                     // HH:MM
    type: string                    // "SBYG", "SBYA", etc.
  }

  // Linking
  linkedFlightIds?: string[]        // FlightLog IDs generated from this entry

  // Source tracking
  sourceFile?: string               // Original filename
  importedAt: number

  // Sync
  createdAt: number
  updatedAt?: number
  deleteddAt?: number
  syncStatus: SyncStatus
}

// ============================================
// Currency/Expiry Tracking
// ============================================

export interface Currency {
  id: string
  userId?: string

  code: CurrencyCode | string       // Allow custom codes
  description: string               // "MEDICAL", "OPC 320"
  expiryDate: string                // YYYY-MM-DD

  // Warning thresholds (days before expiry)
  warningDays: number               // Default: 30
  criticalDays: number              // Default: 7

  // Metadata
  issuedDate?: string
  issuingAuthority?: string
  documentNumber?: string
  notes?: string

  // Auto-update from schedule
  autoUpdate: boolean               // If true, update from schedule CSV
  lastUpdatedFrom?: "schedule_csv" | "manual"

  // Sync
  createdAt: number
  updatedAt?: number
  deleteddAt?: number
  syncStatus: SyncStatus
}

export type CurrencyStatus = "valid" | "warning" | "critical" | "expired"

export interface CurrencyWithStatus extends Currency {
  status: CurrencyStatus
  daysRemaining: number
}

// ============================================
// Duty Time & FDP Calculations
// ============================================

export interface DutyPeriod {
  id: string
  date: string                      // YYYY-MM-DD

  // Times (all in HH:MM format)
  reportTime: string
  debriefTime: string

  // Calculated durations (in minutes)
  dutyMinutes: number
  flightMinutes: number             // Total block time
  restBeforeMinutes?: number        // Rest since last duty

  // Sectors flown
  sectorCount: number

  // FDP limits (based on regulations)
  maxFdpMinutes: number             // Based on report time & sectors
  fdpExtensionUsed: boolean

  // Linked entries
  scheduleEntryIds: string[]
  flightIds: string[]
}

export interface RollingPeriodStats {
  dutyHours: number
  flightHours: number
  maxDutyHours: number
  maxFlightHours: number
  utilizationPercent: number
}

export interface CumulativeDutyLimits {
  // Rolling periods
  last7Days: RollingPeriodStats
  last14Days: RollingPeriodStats
  last28Days: RollingPeriodStats
  last90Days: Omit<RollingPeriodStats, "maxDutyHours">
  last365Days: Omit<RollingPeriodStats, "maxDutyHours">

  // Calculation metadata
  calculatedAt: number
  calculatedForDate: string         // YYYY-MM-DD
}

// ============================================
// Discrepancy Detection
// ============================================

export interface Discrepancy {
  id: string
  type: DiscrepancyType
  severity: "info" | "warning" | "error"

  // References
  scheduleEntryId?: string
  flightLogId?: string

  // Details
  field?: string                    // Which field differs
  scheduleValue?: string
  logbookValue?: string
  message?: string                  // Human-readable description

  // Resolution
  resolved: boolean
  resolvedAt?: number
  resolvedBy?: "keep_logbook" | "keep_schedule" | "merged" | "ignored"
  resolutionNotes?: string

  createdAt: number
}

// ============================================
// Import/Export
// ============================================

export interface ScheduleImportResult {
  success: boolean

  // Counts
  entriesCreated: number
  entriesUpdated: number
  entriesSkipped: number
  draftsCreated: number
  currenciesUpdated: number
  personnelCreated: number

  // Discrepancies found
  discrepancies: Discrepancy[]

  // Errors & warnings
  errors: Array<{
    line: number
    message: string
    raw?: string
  }>
  warnings: Array<{
    line: number
    message: string
  }>

  // Metadata extracted from CSV
  timeReference: TimeReference
  dateRange: {
    start: string
    end: string
  }
  crewMember: {
    crewId: string
    name: string
    base: string
    role: string
    aircraftType: string
  }

  // Summary statistics from CSV
  summaryStats?: {
    blockHours: string
    dutyHours: string
    timeAwayFromBase: string
    offDays: number
    flightDays: number
    trainingDays: number
    landings: number
  }
}

export interface DraftGenerationConfig {
  // When to create drafts relative to flight date
  triggerMode: "day_before" | "day_of" | "report_time" | "manual"

  // Hours before report time (if triggerMode === "report_time")
  hoursBeforeReport: number

  // Auto-populate options
  autoPopulate: {
    crew: boolean
    scheduledTimes: boolean
    actualTimes: boolean
    flightNumber: boolean
    aircraftType: boolean
  }
}

// ============================================
// Regulatory Limits Configuration
// ============================================

export type RegulationType = "CAAS" | "EASA" | "FAA" | "CUSTOM"

export interface FTLLimits {
  regulationType: RegulationType

  // Duty limits (in hours)
  maxDuty7Days: number
  maxDuty14Days: number
  maxDuty28Days: number

  // Flight time limits (in hours)
  maxFlight7Days: number
  maxFlight14Days: number
  maxFlight28Days: number
  maxFlight90Days: number
  maxFlight365Days: number

  // Single duty limits
  maxSingleDutyHours: number
  maxExtendedDutyHours: number

  // Rest requirements
  minRestBetweenDuties: number
  minWeeklyRest: number
}

export const DEFAULT_FTL_LIMITS: FTLLimits = {
  regulationType: "CAAS",
  maxDuty7Days: 60,
  maxDuty14Days: 110,
  maxDuty28Days: 190,
  maxFlight7Days: 30,
  maxFlight14Days: 60,
  maxFlight28Days: 100,
  maxFlight90Days: 280,
  maxFlight365Days: 900,
  maxSingleDutyHours: 13,
  maxExtendedDutyHours: 15,
  minRestBetweenDuties: 10,
  minWeeklyRest: 36,
}

// ============================================
// Create/Update utility types
// ============================================

export type ScheduleEntryCreate = Omit<ScheduleEntry, "id" | "createdAt" | "syncStatus">
export type ScheduleEntryUpdate = Partial<ScheduleEntry>

export type CurrencyCreate = Omit<Currency, "id" | "createdAt" | "syncStatus">
export type CurrencyUpdate = Partial<Currency>

export type DiscrepancyCreate = Omit<Discrepancy, "id" | "createdAt">
