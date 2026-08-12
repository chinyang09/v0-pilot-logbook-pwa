/**
 * LogTen Pro "Aircraft" export → `Aircraft`.
 *
 * Header (tab-separated): Aircraft ID · Secondary ID · Weight · Operator ·
 * Owner · Serial Number · Notes · ~19 boolean attribute columns · Wheel
 * Configuration · Custom 1-5 · Powerplant · Year · Custom Text 1-4 · Type ·
 * Make · Model · Engine Type · Category · Class · Notes
 *
 * Note the header carries "Notes" TWICE — the aircraft's own and the type's.
 * `buildHeaderIndex` keeps both (the second as `notes#2`), which is why this
 * file can read the aircraft note without accidentally getting the type note.
 *
 * Two shapes in the real export need care:
 *
 * **Placeholder rows.** LogTen keeps unfinished entries whose Aircraft ID is
 * literally "New" — the sample file has two, one of them carrying a stray
 * attribute flag. They are not aircraft and are skipped rather than imported
 * as a registration called "New".
 *
 * **The engine enum.** The app stores `EngineType` as SEP/MEP/SET/MET/JET,
 * which folds together LogTen's separate "Engine Type" ("Jet", "Piston",
 * "Turboprop") and "Class" ("Multi-Engine Land", "Single-Engine Sea"). The
 * class is where the engine COUNT lives, so both columns are needed to land on
 * the right enum value.
 */

import type { Aircraft, EngineType } from "@/types/entities/aircraft.types";
import { normalizeRegistration } from "@/lib/utils/string";
import { normalizeAircraftType } from "../shared/aircraft-type-map";
import { toEngineType, toDashboardCategory } from "../shared/aircraft-classify";
import { bindRows, type LogtenRow } from "./header-map";
import { text, toBool, upper } from "./values";
import type {
  LogtenAircraftPlan,
  LogtenAircraftPlanRow,
} from "./types";
import type { NormalizedDocument } from "../types";

/** Registrations LogTen uses for a not-yet-filled-in row. */
const PLACEHOLDER_IDS = new Set(["NEW", "UNKNOWN", "N/A", "NA", "-", "TBD"]);

/**
 * Engine count from LogTen's aircraft CLASS, which is where it is actually
 * stated ("Multi-Engine Land" / "Single-Engine Sea"). Returns undefined when
 * the class says nothing about it — a glider or a helicopter class — so the
 * caller can fall back rather than guessing "single".
 */
export function engineCountFromClass(aircraftClass: string): number | undefined {
  const c = upper(aircraftClass);
  if (!c) return undefined;
  if (c.includes("MULTI")) return 2;
  if (c.includes("SINGLE")) return 1;
  return undefined;
}

/**
 * LogTen "Engine Type" + "Class" → the app's `EngineType` enum.
 *
 * Delegates the actual mapping to the shared `toEngineType` the eCrew import
 * uses, so a jet imported from LogTen and a jet imported from a roster land on
 * the same enum value and the dashboard's by-engine ring counts them together.
 */
export function toAppEngineType(
  engineType: string,
  aircraftClass: string
): EngineType {
  return toEngineType(engineType, engineCountFromClass(aircraftClass) ?? 1);
}

function buildAircraft(
  row: LogtenRow
): { record: Omit<Aircraft, "id" | "createdAt" | "syncStatus">; registration: string } | null {
  const registration = upper(
    row.get("Aircraft ID", "aircraft_aircraftID", "Registration", "Tail Number")
  );
  if (!registration) return null;
  if (PLACEHOLDER_IDS.has(registration)) return null;

  const rawType = row.get("Type", "aircraftType_type", "Type Code");
  const make = row.get("Make", "aircraftType_make");
  const model = row.get("Model", "aircraftType_model");
  const engineTypeText = row.get("Engine Type", "aircraftType_selectedEngineType");
  const categoryText = row.get("Category", "aircraftType_selectedCategory");
  const classText = row.get("Class", "aircraftType_selectedAircraftClass");

  // "32Q" → "A21N": LogTen users who fed their logbook from a carrier roster
  // carry the carrier's codes, and the rest of the app is on ICAO DOC 8643.
  const typeDesignator = normalizeAircraftType(rawType);

  return {
    registration,
    record: {
      registration,
      type: typeDesignator,
      typeDesignator,
      // "AIRBUS INDUSTRIES (International) A-321neo" is what LogTen shows the
      // user; keeping the pair preserves that without losing the designator.
      model: text([make, model].filter(Boolean).join(" ")),
      category: toDashboardCategory(categoryText || classText),
      engineType: toAppEngineType(engineTypeText, classText),
      isComplex: toBool(row.get("Complex", "aircraft_complex")),
      isHighPerformance: toBool(
        row.get("High Performance", "aircraft_highPerformance")
      ),
    },
  };
}

/** Only fill blanks — a migration never overwrites what the user already has. */
function backfillPatch(
  existing: Aircraft,
  incoming: Omit<Aircraft, "id" | "createdAt" | "syncStatus">
): Partial<Aircraft> {
  const patch: Partial<Aircraft> = {};
  if (!existing.typeDesignator && incoming.typeDesignator) {
    patch.typeDesignator = incoming.typeDesignator;
  }
  if (!existing.type && incoming.type) patch.type = incoming.type;
  if (!existing.model && incoming.model) patch.model = incoming.model;
  if (!existing.category && incoming.category) patch.category = incoming.category;
  return patch;
}

export interface ParseAircraftContext {
  existingAircraft: Aircraft[];
}

export function parseLogtenAircraft(
  doc: NormalizedDocument,
  ctx: ParseAircraftContext
): LogtenAircraftPlan {
  const plan: LogtenAircraftPlan = {
    toCreate: [],
    toUpdate: [],
    skipped: [],
    warnings: [],
    errors: [],
    typeByRegistration: new Map(),
  };

  const bound = bindRows(doc.rows);
  if (!bound) {
    plan.errors.push({
      line: 0,
      message: "Aircraft export has no readable header row.",
    });
    return plan;
  }

  const byReg = new Map(
    ctx.existingAircraft.map((a) => [normalizeRegistration(a.registration), a])
  );
  const seenInFile = new Set<string>();

  for (const row of bound.dataRows) {
    try {
      const built = buildAircraft(row);
      if (!built) {
        plan.skipped.push({
          line: row.sourceLine,
          message:
            "No usable aircraft registration in row (blank or a LogTen placeholder) — skipped.",
          raw: row.raw.join("\t").slice(0, 120),
        });
        continue;
      }

      const { registration, record } = built;
      const key = normalizeRegistration(registration);

      if (record.typeDesignator) {
        plan.typeByRegistration.set(key, record.typeDesignator);
      } else {
        plan.warnings.push({
          line: row.sourceLine,
          message: `${registration} has no aircraft type — imported without one.`,
        });
      }

      if (seenInFile.has(key)) {
        plan.skipped.push({
          line: row.sourceLine,
          message: `Duplicate of an earlier row for ${registration} — skipped.`,
        });
        continue;
      }
      seenInFile.add(key);

      const existing = byReg.get(key);
      if (existing) {
        const patch = backfillPatch(existing, record);
        if (Object.keys(patch).length > 0) {
          plan.toUpdate.push({
            aircraft: record,
            matchedAircraftId: existing.id,
            patch,
            sourceLine: row.sourceLine,
          });
        } else {
          plan.skipped.push({
            line: row.sourceLine,
            message: `${registration} already in your fleet — unchanged.`,
          });
        }
        continue;
      }

      const planRow: LogtenAircraftPlanRow = {
        aircraft: record,
        matchedAircraftId: null,
        patch: {},
        sourceLine: row.sourceLine,
      };
      plan.toCreate.push(planRow);
    } catch (error) {
      plan.errors.push({
        line: row.sourceLine,
        message: error instanceof Error ? error.message : "Failed to read row",
        raw: row.raw.join("\t").slice(0, 120),
      });
    }
  }

  return plan;
}
