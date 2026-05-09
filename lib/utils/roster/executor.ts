/**
 * Roster Import Executor
 *
 * Applies a reviewed-and-approved PlannedImport to IndexedDB. Each approved
 * flight operation goes through the standard flights.store.ts helpers, which
 * means EVERY change enters the sync queue and propagates to MongoDB.
 *
 * v2 additions:
 *   - update_safe / update_consult / skip_stale_report op kinds
 *   - reportGeneratedAt + importSource stamping on every create / update
 *   - Sim sessions written into scheduleEntries as `dutyType: "training"`
 *   - Final pass: recalculateFlightFields() for each touched flight,
 *     honoring manualOverrides natively
 */

import type {
  PlannedImport,
  AcceptableOperation,
} from "@/lib/utils/parsers/schedule-parser";
import type { ParsedSimSession } from "@/lib/utils/parsers/logbook-parser-v2";
import type { FlightLog, FlightLogCreate } from "@/types/entities/flight.types";
import type { Personnel } from "@/types/entities/crew.types";
import type {
  Currency,
  Discrepancy,
  ScheduleEntryCreate,
} from "@/types/entities/roster.types";
import {
  addFlight,
  updateFlight,
  deleteFlight,
  getAirportByIata,
  getAirportTimeInfo,
  getCurrentUserPersonnel,
  getUserPreferences,
  userDb,
  DEFAULT_IMPORT_DEFAULTS,
} from "@/lib/db";
import type { ImportDefaults } from "@/types/db/stores.types";
import { addScheduleEntry } from "@/lib/db/stores/user/schedule.store";
import { recalculateFlightFields } from "@/lib/utils/flight-calculations";
import type { ParsedSector } from "@/lib/utils/roster/reconciler";

// ============================================================
// Result type
// ============================================================

export interface ExecutionResult {
  created: number;
  updated: number;
  deleted: number;
  identical: number;
  ignored: number;
  staleSkipped: number;
  simSessionsCreated: number;
  personnelCreated: number;
  personnelUpdated: number;
  currenciesSaved: number;
  discrepancies: Discrepancy[];
  errors: Array<{ operation: string; message: string }>;
}

export interface ExecuteOptions {
  /** Sim sessions extracted from a logbook import. */
  simSessions?: ParsedSimSession[];
  /** Source of this import — written into every created/updated FlightLog. */
  importSource?: FlightLog["importSource"];
}

// ============================================================
// Sector → FlightLog hydration
// ============================================================

async function hydrateFlightFromSector(
  sector: ParsedSector,
  currentUser: Personnel,
  reportGeneratedAt: number | null | undefined,
  importSource: FlightLog["importSource"],
  importDefaults: ImportDefaults
): Promise<FlightLogCreate> {
  const [depAirport, arrAirport] = await Promise.all([
    getAirportByIata(sector.departureIata),
    getAirportByIata(sector.arrivalIata),
  ]);

  const depOffset = depAirport ? getAirportTimeInfo(depAirport.tz).offset : 0;
  const arrOffset = arrAirport ? getAirportTimeInfo(arrAirport.tz).offset : 0;

  // Crew: schedule provides full crew with crewIds; logbook-only path uses
  // the resolved truncation.
  const captain = sector.crew?.find((c) => c.role === "CPT" || c.role === "PIC");
  const fo = sector.crew?.find((c) => c.role === "FO");
  const isSelfCPT =
    captain && currentUser.crewId && captain.crewId === currentUser.crewId;
  const isSelfFO = fo && currentUser.crewId && fo.crewId === currentUser.crewId;

  let picId = captain?.personnelId || sector.picPersonnelId || "";
  let picName = captain?.name || sector.picResolvedName || "";
  let sicId = fo?.personnelId || "";
  let sicName = fo?.name || "";
  const isUserPic = isSelfCPT || sector.isUserPic === true;

  if (isSelfCPT) {
    picId = currentUser.id;
    picName = "Self";
  } else if (sector.isUserPic && !captain) {
    // Logbook-only sector where we know the user is PIC.
    picId = currentUser.id;
    picName = "Self";
  }
  if (isSelfFO) {
    sicId = currentUser.id;
    sicName = "Self";
  } else if (sector.isUserPic === false && !fo) {
    // Logbook says someone else was PIC — current user is SIC.
    sicId = currentUser.id;
    sicName = "Self";
  }

  // PF inference: prefer the explicit logbook signal (TO/LDG-derived);
  // schedule-only imports default to true (no actuals to infer from).
  const pilotFlying = sector.isPilotFlying ?? true;

  // Role assignment:
  //   user is PIC                       → PIC
  //   user not PIC, is PF               → PICUS or SIC (per preference)
  //   user not PIC, is PM (not flying)  → SIC
  //   user role unknown (no sector hint)→ user's primary role from profile
  let pilotRole: FlightLog["pilotRole"];
  if (isUserPic) {
    pilotRole = "PIC";
  } else if (sector.isUserPic === false || sector.isPilotFlying !== undefined) {
    // Logbook-derived path: we know the user's flying status.
    pilotRole = pilotFlying ? importDefaults.nonPicPfRole : "SIC";
  } else {
    pilotRole = currentUser.roles?.includes("PIC") ? "PIC" : "SIC";
  }

  const remarks = sector.remarks
    ? sector.remarks
    : sector.flightNumber
      ? `Imported from roster: ${sector.flightNumber}`
      : "Imported from logbook";

  const create: FlightLogCreate = {
    date: sector.date,
    flightNumber: sector.flightNumber
      ? sector.flightNumber.startsWith("TR")
        ? sector.flightNumber
        : `TR${sector.flightNumber.replace(/\D/g, "")}`
      : "",
    aircraftReg: (sector.aircraftReg || "").toUpperCase(),
    aircraftType: sector.aircraftType,
    departureIcao: depAirport?.icao || "",
    departureIata: sector.departureIata,
    arrivalIcao: arrAirport?.icao || "",
    arrivalIata: sector.arrivalIata,
    departureTimezone: depOffset,
    arrivalTimezone: arrOffset,
    scheduledOut: sector.scheduledOut || "",
    scheduledIn: sector.scheduledIn || "",
    outTime: sector.actualOut || "",
    offTime: "",
    onTime: "",
    inTime: sector.actualIn || "",
    blockTime: sector.blockTime || "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId,
    picName,
    sicId,
    sicName,
    additionalCrew: [],
    pilotFlying,
    pilotRole,
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
    dayTakeoffs: sector.dayTakeoffs ?? 0,
    dayLandings: sector.dayLandings ?? 0,
    nightTakeoffs: sector.nightTakeoffs ?? 0,
    nightLandings: sector.nightLandings ?? 0,
    autolands: 0,
    remarks,
    endorsements: "",
    manualOverrides: {},
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: "00:00",
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
    reportGeneratedAt: reportGeneratedAt ?? undefined,
    importSource,
  };

  return create;
}

function buildUpdatePatch(op: AcceptableOperation): Partial<FlightLog> {
  if (
    op.kind !== "update_conflict" &&
    op.kind !== "edited_conflict" &&
    op.kind !== "update_safe" &&
    op.kind !== "update_consult"
  ) {
    return {};
  }
  const patch: Partial<FlightLog> = {};
  for (const change of op.changes) {
    const value: unknown = change.to;
    // Numeric fields stored as numbers — coerce strings back.
    if (
      change.field === "dayTakeoffs" ||
      change.field === "nightTakeoffs" ||
      change.field === "dayLandings" ||
      change.field === "nightLandings" ||
      change.field === "departureTimezone" ||
      change.field === "arrivalTimezone"
    ) {
      (patch as Record<string, unknown>)[change.field] =
        Number(value) || 0;
    } else if (change.field === "pilotFlying") {
      // FieldDiff carries strings; coerce back to boolean for storage.
      (patch as Record<string, unknown>)[change.field] = value === "true";
    } else {
      (patch as Record<string, unknown>)[change.field] = value;
    }
  }
  return patch;
}

async function postWriteRecalculate(
  flightId: string
): Promise<void> {
  const flight = await userDb.flights.get(flightId);
  if (!flight) return;
  const [depAp, arrAp] = await Promise.all([
    getAirportByIata(flight.departureIata),
    getAirportByIata(flight.arrivalIata),
  ]);
  const updates = recalculateFlightFields(
    flight,
    depAp ?? null,
    arrAp ?? null
  );
  if (Object.keys(updates).length > 0) {
    await updateFlight(flightId, updates);
  }
}

// ============================================================
// Main executor
// ============================================================

export async function executeRosterImport(
  plan: PlannedImport,
  options: ExecuteOptions = {}
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    identical: 0,
    ignored: 0,
    staleSkipped: 0,
    simSessionsCreated: 0,
    personnelCreated: 0,
    personnelUpdated: 0,
    currenciesSaved: 0,
    discrepancies: [],
    errors: [],
  };

  const currentUser = await getCurrentUserPersonnel();
  if (!currentUser) {
    result.errors.push({
      operation: "prelude",
      message: "No current user profile — cannot import.",
    });
    return result;
  }

  const reportGeneratedAt = plan.generatedAt ?? null;
  const importSource: FlightLog["importSource"] =
    options.importSource ?? "schedule";

  // Fetch user import preferences once — reused across every create op.
  const storedPrefs = await getUserPreferences().catch(() => null);
  const importDefaults: ImportDefaults = {
    ...DEFAULT_IMPORT_DEFAULTS,
    ...(storedPrefs?.importDefaults ?? {}),
  };

  // ----- 1. Personnel (always applied; not part of user-reviewed diff) -----
  for (const person of plan.personnelToCreate) {
    try {
      await userDb.personnel.put(person);
      result.personnelCreated++;
    } catch (error) {
      result.errors.push({
        operation: `create personnel ${person.name}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  for (const { id, data } of plan.personnelToUpdate) {
    try {
      const existing = await userDb.personnel.get(id);
      if (existing) {
        await userDb.personnel.put({ ...existing, ...data });
        result.personnelUpdated++;
      }
    } catch (error) {
      result.errors.push({
        operation: `update personnel ${id}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ----- 2. Flight operations -----
  const touchedFlightIds: string[] = [];

  for (const op of plan.operations) {
    if (!op.accepted) {
      // Record discrepancies for declined updates so the audit trail captures
      // what the user said no to.
      if (
        op.kind === "update_conflict" ||
        op.kind === "edited_conflict" ||
        op.kind === "update_consult"
      ) {
        result.discrepancies.push({
          id: crypto.randomUUID(),
          type: "time_mismatch",
          severity: op.kind === "edited_conflict" ? "warning" : "info",
          flightLogId: op.flight.id,
          field: "times",
          scheduleValue: op.changes.map((c) => `${c.field}=${c.to}`).join(", "),
          logbookValue: op.changes.map((c) => `${c.field}=${c.from}`).join(", "),
          message: `User declined roster update for flight ${op.flight.flightNumber}`,
          resolved: false,
          createdAt: Date.now(),
        });
      }
      continue;
    }

    try {
      switch (op.kind) {
        case "create": {
          const payload = await hydrateFlightFromSector(
            op.sector,
            currentUser,
            reportGeneratedAt,
            importSource,
            importDefaults
          );
          const created = await addFlight(payload);
          touchedFlightIds.push(created.id);
          result.created++;
          break;
        }
        case "update_conflict":
        case "edited_conflict":
        case "update_safe":
        case "update_consult": {
          const patch = buildUpdatePatch(op);
          if (reportGeneratedAt) patch.reportGeneratedAt = reportGeneratedAt;
          patch.importSource = importSource;
          const updated = await updateFlight(op.flight.id, patch);
          if (!updated) {
            // Row vanished between plan build and execute — surface so the
            // user knows their accepted edit didn't actually take effect.
            result.errors.push({
              operation: `${op.kind} ${op.flight.flightNumber || op.flight.id}`,
              message:
                "Flight no longer exists in IndexedDB — accepted edit was not applied.",
            });
            break;
          }
          console.log(
            `[Import] ${op.kind} applied to ${op.flight.flightNumber || op.flight.id}:`,
            Object.keys(patch).filter(
              (k) => k !== "reportGeneratedAt" && k !== "importSource"
            )
          );
          touchedFlightIds.push(op.flight.id);
          result.updated++;
          break;
        }
        case "skip_stale_report": {
          // Record an info-level discrepancy so the user can see that an
          // older report tried to overwrite the flight.
          result.discrepancies.push({
            id: crypto.randomUUID(),
            type: "stale_report",
            severity: "info",
            flightLogId: op.flight.id,
            message: `Skipped: existing flight imported from a newer report (${new Date(
              op.existingGeneratedAt
            ).toISOString()}) than this one (${new Date(
              op.reportGeneratedAt
            ).toISOString()}).`,
            resolved: false,
            createdAt: Date.now(),
          });
          result.staleSkipped++;
          break;
        }
        case "delete_missing": {
          await deleteFlight(op.flight.id);
          result.deleted++;
          break;
        }
        case "skip_identical":
          result.identical++;
          break;
        case "skip_non_airline":
          result.ignored++;
          break;
      }
    } catch (error) {
      result.errors.push({
        operation: `${op.kind} ${JSON.stringify(op).slice(0, 120)}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ----- 3. Sim sessions (logbook only) -----
  for (const sim of options.simSessions ?? []) {
    try {
      const entry: ScheduleEntryCreate = {
        date: sim.date,
        timeReference: "UTC",
        dutyType: "training",
        dutyCode: sim.sessionCode || `SIM-${sim.deviceType}`,
        dutyDescription: `Simulator session (${sim.deviceType})`,
        sectors: [],
        crew: [],
        importedAt: Date.now(),
        sourceFile: "logbook",
      };
      await addScheduleEntry(entry);
      result.simSessionsCreated++;
    } catch (error) {
      result.errors.push({
        operation: `sim session ${sim.date}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ----- 4. Currencies (always applied) -----
  for (const currency of plan.currencies) {
    try {
      const existing = await userDb.currencies
        .where("code")
        .equals(currency.code)
        .first();
      if (existing) {
        await userDb.currencies.put({
          ...existing,
          ...currency,
        } as Currency);
      } else {
        await userDb.currencies.put({
          ...currency,
          id: crypto.randomUUID(),
          createdAt: Date.now(),
          syncStatus: "pending",
        } as Currency);
      }
      result.currenciesSaved++;
    } catch (error) {
      result.errors.push({
        operation: `currency ${currency.code}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ----- 5. Persist discrepancies as DB rows so /discrepancies surfaces them -----
  for (const d of result.discrepancies) {
    try {
      await userDb.discrepancies.put(d);
    } catch (error) {
      result.errors.push({
        operation: `discrepancy ${d.id}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  // ----- 6. Recompute derived fields on every touched flight -----
  for (const id of touchedFlightIds) {
    try {
      await postWriteRecalculate(id);
    } catch {
      // Recompute failures aren't fatal — leave the flight as-is.
    }
  }

  return result;
}
