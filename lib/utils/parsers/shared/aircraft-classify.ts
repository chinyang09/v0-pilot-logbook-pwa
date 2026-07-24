/**
 * Map an ICAO DOC 8643 type classification onto the user-facing Aircraft
 * record fields the dashboard aggregates on (engine group + category).
 *
 * The dashboard's `byEngine` / `byCategory` rings read the user `Aircraft`
 * store (engineType enum + category string), NOT the flight's raw type code.
 * Imported flights previously never created an Aircraft record, so those
 * rings stayed empty — this helper lets the import derive them from the ICAO
 * designator (e.g. A20N → L2J → 2-engine Jet → "JET" / "Airplane").
 */

import type { EngineType } from "@/types/entities/aircraft.types";

/**
 * DOC 8643 engine type ("Jet" / "Turboprop" / "Piston" / …) + engine count
 * → the app's `EngineType` enum (SEP/MEP/SET/MET/JET).
 */
export function toEngineType(
  engineType: string | undefined,
  engineCount: number | undefined
): EngineType {
  const t = (engineType || "").toLowerCase();
  const multi = (engineCount || 0) >= 2;
  if (t.includes("jet")) return "JET";
  if (t.includes("turbo")) return multi ? "MET" : "SET";
  if (t.includes("piston")) return multi ? "MEP" : "SEP";
  // Electric / rocket / unknown — fall back on the engine count.
  return multi ? "MEP" : "SEP";
}

/**
 * DOC 8643 category ("Landplane" / "Helicopter" / …) → a category string the
 * dashboard's `classifyCategory` recognizes (it matches on the substrings
 * "airplane", "rotor", "glider").
 */
export function toDashboardCategory(category: string | undefined): string {
  const c = (category || "").toLowerCase();
  if (
    c.includes("rotor") ||
    c.includes("helicopter") ||
    c.includes("gyro") ||
    c.includes("tilt")
  ) {
    return "Rotorcraft";
  }
  if (c.includes("glider") || c.includes("sailplane")) return "Glider";
  if (c.includes("land") || c.includes("sea") || c.includes("amphib")) {
    return "Airplane";
  }
  return category || "Airplane";
}
