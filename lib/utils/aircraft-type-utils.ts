/**
 * Aircraft type utility functions
 * Parses ICAO DOC 8643 3-char description codes at runtime
 */

import type { AircraftTypeRaw, AircraftType } from "@/types/entities/aircraft-type.types"

const ENGINE_TYPE_MAP: Record<string, string> = {
  P: "Piston",
  T: "Turboprop",
  J: "Jet",
  E: "Electric",
  R: "Rocket",
}

const CATEGORY_MAP: Record<string, string> = {
  L: "Landplane",
  S: "Seaplane",
  A: "Amphibian",
  H: "Helicopter",
  G: "Gyrocopter",
  T: "Tiltrotor",
}

/**
 * Parse a 3-char ICAO description code (e.g., "L2J") into structured fields
 */
function parseDescription(desc: string): {
  category: string
  engineCount: number
  engineType: string
} {
  if (!desc || desc.length !== 3) {
    return { category: "", engineCount: 0, engineType: "" }
  }
  return {
    category: CATEGORY_MAP[desc[0]] || desc[0],
    engineCount: parseInt(desc[1]) || 0,
    engineType: ENGINE_TYPE_MAP[desc[2]] || desc[2],
  }
}

/**
 * Expand a raw (minified-key) aircraft type record into a full AircraftType
 */
export function expandAircraftType(raw: AircraftTypeRaw): AircraftType {
  const parsed = parseDescription(raw.t)
  return {
    designator: raw.d,
    manufacturer: raw.m,
    description: raw.t,
    wtc: raw.w,
    wtg: raw.g || "",
    category: parsed.category,
    engineCount: parsed.engineCount,
    engineType: parsed.engineType,
  }
}

/**
 * Format aircraft type for display (e.g., "AIRBUS")
 */
export function formatAircraftType(type: AircraftType | AircraftTypeRaw): string {
  return "m" in type ? type.m : type.manufacturer
}
