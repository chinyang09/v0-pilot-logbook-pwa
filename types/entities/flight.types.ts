/**
 * Flight-related type definitions
 */

/**
 * Signature data structures for capturing hand-drawn signatures
 * Stores vector data for resolution-independent rendering
 *
 * Vector-based signature system:
 * - Signatures are captured as normalized strokes (0-1 range)
 * - On save, strokes are normalized to their bounding box
 * - This preserves aspect ratio and allows re-centering
 * - Rendering uses uniform scaling (same factor for X and Y)
 */
export interface SignaturePoint {
  x: number           // X coordinate normalized to 0-1 (relative to signature bounds)
  y: number           // Y coordinate normalized to 0-1 (relative to signature bounds)
  pressure?: number   // Pressure if available (0-1), from touch devices
  timestamp?: number  // Milliseconds since stroke start (optional for backward compat)
}

export interface SignatureStroke {
  points: SignaturePoint[]
  startTime?: number   // Unix timestamp when stroke began (optional for backward compat)
}

/**
 * Bounding box of the signature in normalized coordinates
 * After normalization, all signatures occupy (0,0) → (1,1)
 */
export interface SignatureBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type SignerRole = "pic" | "sic" | "instructor" | "examiner" | "student"

export interface FlightSignature {
  strokes: SignatureStroke[]
  /**
   * Original bounding box before normalization
   * Used to preserve aspect ratio information:
   * aspectRatio = (maxX - minX) / (maxY - minY)
   */
  bounds?: SignatureBounds
  /**
   * Original aspect ratio of the signature (width / height)
   * This is the key value for aspect-preserving rendering
   */
  aspectRatio?: number
  canvasWidth?: number   // Original canvas width (deprecated, kept for backward compat)
  canvasHeight?: number  // Original canvas height (deprecated, kept for backward compat)
  capturedAt: number     // Unix timestamp when signature was saved
  signerId?: string      // ID of the signer (crew member)
  signerRole?: SignerRole
  signerName?: string
  signerLicenseNumber?: string  // License number of the signer
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

export type PilotRole = "PIC" | "SIC" | "PICUS" | "Dual" | "Instructor"

export type SyncStatus = "synced" | "pending" | "error"

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
  // Timezone offsets in hours (e.g., 8 for UTC+8)
  departureTimezone: number
  arrivalTimezone: number
  // Times in HH:MM UTC format
  scheduledOut: string
  scheduledIn: string
  outTime: string
  offTime: string
  onTime: string
  inTime: string
  // Calculated times in HH:MM format
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
  // Time logging - all in HH:MM format
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
  // Approaches
  approaches: Approach[]
  holds: number
  ipcIcc: boolean
  isLocked?: boolean
  // Signature (optional)
  // TODO: Add logic for when signature is required based on flight type/role (future enhancement)
  signature?: FlightSignature
  // Timestamps
  createdAt: number
  updatedAt?: number
  deleteddAt?: number
  // Sync metadata
  syncStatus: SyncStatus
  lastSyncedAt?: number
}

export type FlightLogCreate = Omit<FlightLog, "id" | "createdAt" | "updatedAt" | "syncStatus">
export type FlightLogUpdate = Partial<FlightLog>
