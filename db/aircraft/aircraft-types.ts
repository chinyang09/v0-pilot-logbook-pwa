/**
 * Aircraft domain types
 */

export interface Aircraft {
  id: string
  userId?: string
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

// CDN aircraft data (from external database)
export interface AircraftData {
  icao24: string
  reg: string | null
  icaotype: string | null
  short_type: string | null
}

export interface NormalizedAircraft {
  registration: string
  icao24: string
  typecode: string
  shortType: string
}
