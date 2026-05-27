/**
 * Classify roster-vs-logbook field changes as safe (auto-apply) or critical
 * (consult the user). Used by the reconciler to split past-flight updates
 * into `update_safe` vs `update_consult` operations.
 */

import type { FlightLog } from "../../../types/entities/flight.types";
import type { FieldDiff, EditReason } from "./reconciler";
import { normalize } from "../parsers/shared/name-normalize";

export type UpdateClassification =
  | "update_safe"
  | "update_consult"
  | "edited_conflict";

const SAFE_FIELDS = new Set<keyof FlightLog>([
  "picName",
  "picId",
  "sicName",
  "sicId",
  "additionalCrew",
  "flightNumber",
  "departureIcao",
  "arrivalIcao",
  "departureTimezone",
  "arrivalTimezone",
]);

const CRITICAL_FIELDS = new Set<keyof FlightLog>([
  "outTime",
  "inTime",
  "offTime",
  "onTime",
  "scheduledOut",
  "scheduledIn",
  "departureIata",
  "arrivalIata",
  "aircraftReg",
  "aircraftType",
  "pilotRole",
  "pilotFlying",
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
  "blockTime",
  "flightTime",
  "nightTime",
  "dayTime",
  "picTime",
  "sicTime",
  "picusTime",
]);

const TODAY_UTC_FN = () => {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

/**
 * A single field-change is "safe" when:
 *   - it's in SAFE_FIELDS, OR
 *   - it's a critical field where the existing value is empty (enrichment), OR
 *   - it's a PIC name where the existing is the 20-char truncated form and the
 *     incoming full name's normalized prefix matches.
 */
export function isSafeChange(
  change: FieldDiff,
  flight: FlightLog
): boolean {
  const field = change.field as keyof FlightLog;

  if (SAFE_FIELDS.has(field)) return true;

  // Critical field but the existing slot is empty — this is enrichment, not
  // a conflict.
  if (CRITICAL_FIELDS.has(field) && (!change.from || change.from === "")) {
    return true;
  }

  // Logbook PIC truncation upgrade: existing = "Muhammad Farhan Bin "
  // (length 20), incoming = "Muhammad Farhan Bin Abdul Latiff".
  if (field === "picName") {
    const fromTrimmed = change.from?.trim() ?? "";
    const toTrimmed = change.to?.trim() ?? "";
    const fromNorm = normalize(fromTrimmed);
    const toNorm = normalize(toTrimmed);
    if (
      fromTrimmed.length <= 20 &&
      toNorm.length > fromNorm.length &&
      toNorm.startsWith(fromNorm)
    ) {
      return true;
    }
  }

  return false;
}

export function classifyChanges(
  flight: FlightLog,
  changes: FieldDiff[],
  editReasons: EditReason[],
  todayUtc: string = TODAY_UTC_FN()
): UpdateClassification {
  // Past flights with edit reasons (signature, remarks, manualOverrides) are
  // always "edited_conflict" regardless of which fields changed.
  if (editReasons.length > 0 && flight.date < todayUtc) {
    return "edited_conflict";
  }

  // Future flights: every change is safe — they haven't been flown yet.
  if (flight.date >= todayUtc) {
    return "update_safe";
  }

  // Past flights without edit reasons: split by field bucket.
  const hasCritical = changes.some((c) => !isSafeChange(c, flight));
  return hasCritical ? "update_consult" : "update_safe";
}
