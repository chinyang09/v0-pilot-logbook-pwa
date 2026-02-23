/**
 * Aircraft type designator definitions
 * Source: ICAO DOC 8643 Aircraft Type Designators
 */

/** Lean aircraft type record — matches minified JSON keys */
export interface AircraftTypeRaw {
  d: string // designator — ICAO type code (e.g., "A359")
  m: string // manufacturer (e.g., "AIRBUS")
  t: string // description — 3-char ICAO code (e.g., "L2J")
  w: string // wtc — Wake Turbulence Category (e.g., "H")
  g: string // wtg — Wake Turbulence Group (e.g., "B")
}

/** Expanded form for display/logic (parsed from raw at runtime) */
export interface AircraftType {
  designator: string
  manufacturer: string
  description: string // Raw 3-char code
  wtc: string
  wtg: string // Wake Turbulence Group (e.g., "B", "C", "D")
  category: string // Parsed from description[0]: "Landplane", "Helicopter", etc.
  engineCount: number // Parsed from description[1]: 1, 2, 4, etc.
  engineType: string // Parsed from description[2]: "Jet", "Turboprop", "Piston", etc.
}
