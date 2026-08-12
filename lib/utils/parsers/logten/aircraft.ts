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
  ResolvedAircraft,
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
  row: LogtenRow,
  lookup?: Map<string, ResolvedAircraft>
): { record: Omit<Aircraft, "id" | "createdAt" | "syncStatus">; registration: string } | null {
  const fileRegistration = upper(
    row.get("Aircraft ID", "aircraft_aircraftID", "Registration", "Tail Number")
  );
  if (!fileRegistration) return null;
  if (PLACEHOLDER_IDS.has(fileRegistration)) return null;

  // The lookup's registration is the CANONICAL one. LogTen users write a tail
  // however they like — "9VSKU", "9vnca", "9V NCA" — and all of those mean the
  // record the chain resolved, so the app stores and shows its punctuation.
  const resolved = lookup?.get(normalizeRegistration(fileRegistration));
  const registration = resolved?.registration
    ? upper(resolved.registration)
    : fileRegistration;

  const rawType = row.get("Type", "aircraftType_type", "Type Code");
  const make = row.get("Make", "aircraftType_make");
  const model = row.get("Model", "aircraftType_model");
  const engineTypeText = row.get("Engine Type", "aircraftType_selectedEngineType");
  const categoryText = row.get("Category", "aircraftType_selectedCategory");
  const classText = row.get("Class", "aircraftType_selectedAircraftClass");

  // "32Q" → "A21N": LogTen users who fed their logbook from a carrier roster
  // carry the carrier's codes, and the rest of the app is on ICAO DOC 8643.
  //
  // When the chain RESOLVED the tail, its answer wins: it knows 9V-SKU is an
  // A388, and a LogTen table that pairs that tail with an A21N is out of date.
  // The file supplies whatever the chain could not answer for.
  //
  // The case this reads wrong is a registration RE-ISSUED to a different type
  // during the pilot's career — the lookup describes the airframe flying under
  // that mark now, not the one they logged in 2011. `preferFileType` exists for
  // a pilot who needs the other rule.
  const typeDesignator =
    resolved?.typecode || normalizeAircraftType(rawType) || "";

  // LogTen's own detail. Nothing here is derivable from a lookup — it is what
  // the pilot curated by hand — so it is carried across verbatim.
  const serialNumber = row.get("Serial Number", "aircraft_serialNumber");
  const operator = row.get("Operator", "aircraft_selectedOperatorName");
  const owner = row.get("Owner", "aircraft_selectedOwnerName");
  const year = row.get("Year", "aircraft_year");
  // The header carries "Notes" TWICE — the aircraft's and the type's. The
  // header index keeps both, so the first is reachable without the second.
  const notes = row.get("Notes", "aircraft_notes");

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
      ...(serialNumber ? { serialNumber } : {}),
      ...(operator ? { operator } : {}),
      ...(owner ? { owner } : {}),
      ...(year ? { year } : {}),
      ...(notes ? { notes } : {}),
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
  for (const field of [
    "serialNumber",
    "operator",
    "owner",
    "year",
    "notes",
  ] as const) {
    if (!existing[field] && incoming[field]) patch[field] = incoming[field];
  }
  return patch;
}

/** Registrations a fleet export references, for the enrichment chain. */
export function collectAircraftRegistrations(doc: NormalizedDocument): string[] {
  const bound = bindRows(doc.rows);
  if (!bound) return [];
  const regs = new Set<string>();
  for (const row of bound.dataRows) {
    const reg = upper(
      row.get("Aircraft ID", "aircraft_aircraftID", "Registration", "Tail Number")
    );
    if (reg && !PLACEHOLDER_IDS.has(reg)) regs.add(reg);
  }
  return Array.from(regs);
}

export interface ParseAircraftContext {
  existingAircraft: Aircraft[];
  /**
   * Normalized registration → the record the shared enrichment chain resolved
   * (local reference DB → server batch → FR24), the same chain the schedule
   * and crew-logbook imports use.
   *
   * Supplies the canonical registration spelling as well as the type — see
   * `buildAircraft`.
   */
  lookupByRegistration?: Map<string, ResolvedAircraft>;
  /** Registrations no source could resolve — reported so the user knows. */
  unresolvedRegistrations?: string[];
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
    unresolvedRegistrations: [],
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

  const unresolved = new Set(
    (ctx.unresolvedRegistrations ?? []).map(normalizeRegistration)
  );

  for (const row of bound.dataRows) {
    try {
      const built = buildAircraft(row, ctx.lookupByRegistration);
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

      // A registration no source could resolve is imported wholesale from the
      // file, and flagged so the executor also writes it into the reference
      // database — that is what makes a later flight import find it locally
      // instead of asking the network again and failing again.
      if (unresolved.has(key)) plan.unresolvedRegistrations.push(registration);

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
