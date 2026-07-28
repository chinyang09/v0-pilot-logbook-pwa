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
import type { Aircraft } from "@/types/entities/aircraft.types";
import type {
  Currency,
  Discrepancy,
} from "@/types/entities/roster.types";
import {
  addFlight,
  updateFlight,
  deleteFlight,
  getAirportByIata,
  getAirportTimeInfo,
  getCurrentUserPersonnel,
  getUserPreferences,
  getAllAircraft,
  addAircraft,
  updateAircraft,
  getAircraftType,
  userDb,
  DEFAULT_IMPORT_DEFAULTS,
} from "@/lib/db";
import {
  toEngineType,
  toDashboardCategory,
} from "@/lib/utils/parsers/shared/aircraft-classify";
import {
  recordReportImport,
  stampsFor,
  type ReportSource,
} from "@/lib/utils/roster/report-tracking";
import type { ImportDefaults } from "@/types/db/stores.types";
import { recalculateFlightFields } from "@/lib/utils/flight-calculations";
import { normalizeAircraftType } from "@/lib/utils/parsers/shared/aircraft-type-map";
import { hhmmToMinutes } from "@/lib/utils/time";
import {
  TOLDG_DECISION_MARKER,
  deriveSectorCrew,
  type ParsedSector,
  type FieldDiff,
} from "@/lib/utils/roster/reconciler";
import {
  clearDecisions,
  mergeDecisions,
  type ImportDecisions,
} from "@/lib/utils/roster/import-decisions";

const TOLDG_FIELDS = new Set([
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
]);

// The TO/LDG decision is now recorded in `FlightLog.toLdgDecidedAt` rather than
// appended to `remarks` — remarks belong to the user. TOLDG_DECISION_MARKER is
// still imported so the reconciler can honour it on legacy rows.
void TOLDG_DECISION_MARKER;

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
  aircraftCreated: number;
  aircraftUpdated: number;
  currenciesSaved: number;
  discrepancies: Discrepancy[];
  errors: Array<{ operation: string; message: string }>;
}

export interface ExecuteOptions {
  /** Sim sessions extracted from a logbook import. */
  simSessions?: ParsedSimSession[];
  /** Source of this import — written into every created/updated FlightLog. */
  importSource?: FlightLog["importSource"];
  /**
   * Per-stream "Generated on" stamps. Written onto every touched flight as
   * `scheduleReportAt` / `logbookReportAt` so we can tell which report version
   * a flight reflects — and, for the logbook stamp, whether it has ever been
   * tallied against the company logbook at all.
   */
  scheduleGeneratedAt?: number | null;
  logbookGeneratedAt?: number | null;
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
  // the resolved truncation. `deriveSectorCrew` is the shared resolver the
  // reconciler's update-diff also uses, so create and re-import agree.
  const { picId, picName, sicId, sicName, isSelfCPT } = deriveSectorCrew(
    sector,
    currentUser
  );
  const isUserPic = isSelfCPT || sector.isUserPic === true;

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

  // Remarks belong to the user. We only carry through what the source report
  // actually said (the logbook's remarks column); we no longer synthesise
  // "Imported from roster: TRxxx", which was redundant with importSource and —
  // because any non-empty remarks count as a user edit — made every re-import
  // of a previously-imported flight look like an edited conflict.
  const remarks = sector.remarks ?? "";

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

/**
 * Record what the user decided about a set of field changes.
 *
 * `declined` are values they turned down — the reconciler withholds a future
 * diff proposing that same value, so re-uploading the same report stops
 * re-asking. `applied` are changes they took: the value each one overwrote is
 * kept so it can be restored later if they change their mind.
 *
 * Only changes that overwrite something the user actually had are worth
 * remembering — filling a blank field leaves nothing to restore.
 */
function recordDecisions(
  flight: FlightLog,
  {
    declined = [],
    applied = [],
  }: { declined?: readonly FieldDiff[]; applied?: readonly FieldDiff[] }
): ImportDecisions | null {
  const updates = [
    ...declined.map((d) => ({ field: d.field, declined: d.to })),
    ...applied
      .filter((d) => d.from !== "" && d.from !== d.to)
      .map((d) => ({ field: d.field, replaced: d.from })),
  ];
  if (updates.length === 0) return null;
  return mergeDecisions(flight, updates);
}

const NUMERIC_FIELDS = new Set([
  "dayTakeoffs",
  "nightTakeoffs",
  "dayLandings",
  "nightLandings",
  "departureTimezone",
  "arrivalTimezone",
]);

/**
 * Write one field onto a patch, coercing back from the string form a
 * `FieldDiff` carries. Shared by the normal update path and the revert path.
 */
function assignFieldValue(
  patch: Partial<FlightLog>,
  field: string,
  value: string
): void {
  const target = patch as Record<string, unknown>;
  if (NUMERIC_FIELDS.has(field)) target[field] = Number(value) || 0;
  else if (field === "pilotFlying") target[field] = value === "true";
  else target[field] = value;
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
    assignFieldValue(patch, change.field, change.to);
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

/**
 * Ensure a user `Aircraft` record exists for every registration flown in
 * this import, deriving engine group + category from the ICAO type so the
 * dashboard's by-engine / by-category rings populate. New records are
 * created; existing records are only BACKFILLED where a field is blank —
 * user-entered values are never clobbered.
 */
async function ensureAircraftForFlights(
  pairs: Array<{ reg: string; type: string }>,
  result: ExecutionResult
): Promise<void> {
  const wanted = new Map<string, string>(); // REG → type designator
  for (const { reg, type } of pairs) {
    const R = (reg || "").toUpperCase().trim();
    if (!R) continue;
    if (!wanted.has(R) || (!wanted.get(R) && type)) wanted.set(R, type || "");
  }
  if (wanted.size === 0) return;

  let existing: Aircraft[] = [];
  try {
    existing = await getAllAircraft();
  } catch {
    return;
  }
  const byReg = new Map(existing.map((a) => [a.registration.toUpperCase(), a]));

  for (const [reg, type] of wanted) {
    try {
      const doc = type ? await getAircraftType(type).catch(() => null) : null;
      const engineType = doc
        ? toEngineType(doc.engineType, doc.engineCount)
        : undefined;
      const category = doc ? toDashboardCategory(doc.category) : undefined;
      const model = doc ? `${doc.manufacturer} ${doc.designator}`.trim() : "";

      const ex = byReg.get(reg);
      if (!ex) {
        await addAircraft({
          registration: reg,
          type: type || "",
          typeDesignator: type || "",
          model,
          // Airline schedule imports are jets by domain; DOC 8643 lookup
          // refines this when the designator resolves.
          category: category || "Airplane",
          engineType: engineType || "JET",
          isComplex: false,
          isHighPerformance: false,
        });
        result.aircraftCreated++;
      } else {
        const patch: Partial<Aircraft> = {};
        if (!ex.typeDesignator && type) patch.typeDesignator = type;
        if (!ex.type && type) patch.type = type;
        if (!ex.category && category) patch.category = category;
        if (!ex.model && model) patch.model = model;
        if (Object.keys(patch).length > 0) {
          await updateAircraft(ex.id, patch);
          result.aircraftUpdated++;
        }
      }
    } catch (error) {
      result.errors.push({
        operation: `ensure aircraft ${reg}`,
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
}

/**
 * Build a FlightLog for a simulator session. Sims are logged as flight
 * entries (no aircraftReg / airports) so they surface in the logbook and
 * count toward the dashboard's simulator-instrument totals. The session time
 * populates simulatedInstrumentTime; block/flight time stay zero so a sim
 * never inflates flight-hour totals.
 */
function buildSimFlight(
  sim: ParsedSimSession,
  currentUser: Personnel,
  reportGeneratedAt: number | null | undefined,
  importSource: FlightLog["importSource"]
): FlightLogCreate {
  const duration =
    sim.duration && sim.duration !== "00:00"
      ? sim.duration
      : sim.outUtc && sim.inUtc
        ? (() => {
            let d = hhmmToMinutes(sim.inUtc) - hhmmToMinutes(sim.outUtc);
            if (d < 0) d += 1440;
            return `${String(Math.floor(d / 60)).padStart(2, "0")}:${String(
              d % 60
            ).padStart(2, "0")}`;
          })()
        : "00:00";

  const deviceType = normalizeAircraftType(sim.deviceType || "SIM");
  const sessionCode = sim.sessionCode || sim.component || "SIM";

  const remarkParts: string[] = [];
  remarkParts.push(`Simulator: ${sim.sessionCode || sim.component || "session"}`);
  if (sim.courseName) remarkParts.push(sim.courseName);
  if (sim.component && sim.component !== sim.sessionCode)
    remarkParts.push(sim.component);
  if (sim.facility) remarkParts.push(`@ ${sim.facility}`);
  if (sim.instructorName) remarkParts.push(`Instructor: ${sim.instructorName}`);
  if (sim.remarks && sim.remarks !== sim.sessionCode)
    remarkParts.push(sim.remarks);
  const remarks = remarkParts.filter(Boolean).join(" — ");

  return {
    date: sim.date,
    flightNumber: "",
    aircraftReg: "",
    aircraftType: deviceType,
    departureIcao: "",
    departureIata: "",
    arrivalIcao: "",
    arrivalIata: "",
    departureTimezone: 0,
    arrivalTimezone: 0,
    scheduledOut: "",
    scheduledIn: "",
    outTime: sim.outUtc || "",
    offTime: "",
    onTime: "",
    inTime: sim.inUtc || "",
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId: "",
    picName: sim.instructorName || "",
    sicId: currentUser.id,
    sicName: "Self",
    additionalCrew: [],
    pilotFlying: false,
    pilotRole: "Dual",
    picTime: "00:00",
    sicTime: "00:00",
    picusTime: "00:00",
    dualTime: "00:00",
    instructorTime: "00:00",
    dayTakeoffs: 0,
    dayLandings: 0,
    nightTakeoffs: 0,
    nightLandings: 0,
    autolands: 0,
    remarks,
    endorsements: "",
    // Protect the sim-specific fields from recalculation (empty airports).
    manualOverrides: {
      simulatedInstrumentTime: true,
      nightTime: true,
    },
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: duration,
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
    reportGeneratedAt: reportGeneratedAt ?? undefined,
    importSource,
    isSimulator: true,
    simSessionCode: sessionCode,
  };
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
    aircraftCreated: 0,
    aircraftUpdated: 0,
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

  // Per-stream stamps written onto every touched flight. Defaulted from the
  // plan so a schedule-only / logbook-only import stamps the right stream even
  // when the caller doesn't pass them explicitly.
  const trackingSource: ReportSource =
    importSource === "logbook"
      ? "logbook"
      : importSource === "cross_hydrated"
        ? "cross_hydrated"
        : "schedule";
  const scheduleGeneratedAt =
    options.scheduleGeneratedAt ??
    (trackingSource === "schedule" ? reportGeneratedAt : null);
  const logbookGeneratedAt =
    options.logbookGeneratedAt ??
    (trackingSource === "logbook" ? reportGeneratedAt : null);
  const reportStamps = stampsFor(
    trackingSource,
    scheduleGeneratedAt,
    logbookGeneratedAt
  );

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
    // For any update op, work out whether the user was shown a TO/LDG diff
    // (regardless of accept/reject). If so we must persist the decision in
    // remarks so the next import doesn't ask the same question.
    const opChanges =
      op.kind === "update_conflict" ||
      op.kind === "edited_conflict" ||
      op.kind === "update_safe" ||
      op.kind === "update_consult"
        ? op.changes
        : [];
    const hasToLdgDiff = opChanges.some((c) => TOLDG_FIELDS.has(c.field));

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

      // Even when rejected, persist the decision so subsequent imports don't
      // keep raising the same question: the TO/LDG call as a timestamp, and
      // every turned-down field as `field -> rejected value`. Both are stored
      // as fields — remarks stay the user's.
      if ("flight" in op && (hasToLdgDiff || opChanges.length > 0)) {
        try {
          const fresh = await userDb.flights.get(op.flight.id);
          if (fresh) {
            const patch: Partial<FlightLog> = {};
            if (hasToLdgDiff && fresh.toLdgDecidedAt === undefined) {
              patch.toLdgDecidedAt = Date.now();
            }
            const decisions = recordDecisions(fresh, { declined: opChanges });
            if (decisions) patch.importDecisions = decisions;
            if (Object.keys(patch).length > 0) {
              await updateFlight(op.flight.id, patch);
              touchedFlightIds.push(op.flight.id);
            }
          }
        } catch (error) {
          result.errors.push({
            operation: `record declined changes on ${op.flight.flightNumber}`,
            message:
              error instanceof Error ? error.message : "Unknown error",
          });
        }
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
          const created = await addFlight({ ...payload, ...reportStamps });
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
          Object.assign(patch, reportStamps);
          // Record the user's TO/LDG decision so subsequent imports skip the
          // re-flag (see the reconciler's hasToLdgDecisionMarker gate).
          if (hasToLdgDiff && op.flight.toLdgDecidedAt === undefined) {
            patch.toLdgDecidedAt = Date.now();
          }
          // Both halves of the decision are remembered: the parts the user
          // turned down (e.g. keeping their recorded PF/PM) so they aren't
          // re-asked, and the values the accepted changes overwrote so they
          // can be restored later.
          const decisions = recordDecisions(op.flight, {
            declined: op.declinedChanges ?? [],
            applied: op.changes,
          });
          if (decisions) patch.importDecisions = decisions;
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
        case "skip_decided": {
          // The user deliberately reversed an earlier decision. Apply the
          // reverted values and drop the memory for those fields, so the
          // flight goes back to being driven by the report (or by their own
          // restored entry) with a clean slate.
          const patch: Partial<FlightLog> = {};
          for (const revert of op.reverts) {
            assignFieldValue(patch, revert.field, revert.to);
          }
          const cleared = clearDecisions(
            op.flight,
            op.reverts.map((r) => r.field)
          );
          if (cleared) patch.importDecisions = cleared;
          Object.assign(patch, reportStamps);
          const reverted = await updateFlight(op.flight.id, patch);
          if (!reverted) {
            result.errors.push({
              operation: `revert ${op.flight.flightNumber || op.flight.id}`,
              message:
                "Flight no longer exists in IndexedDB — revert was not applied.",
            });
            break;
          }
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

  // ----- 3. Sim sessions → logbook flight entries (deduped on re-import) ----
  const simSessions = options.simSessions ?? [];
  if (simSessions.length > 0) {
    // Existing sim flights keyed by date + session code so a re-import of the
    // same report doesn't create duplicate sim entries.
    let existingSimKeys = new Set<string>();
    try {
      const allFlights = await userDb.flights.toArray();
      existingSimKeys = new Set(
        allFlights
          .filter((f) => f.isSimulator)
          .map((f) => `${f.date}|${(f.simSessionCode || "").toUpperCase()}`)
      );
    } catch {
      // If we can't read existing flights, fall through and create (rare).
    }

    // Tolerate UTC-vs-local date drift: the same EBT can be logged 13 May in
    // the UTC logbook and scheduled 14 May in the Local Base schedule, so a
    // sim on date±1 with the same session code is treated as already logged.
    const shiftIso = (iso: string, days: number): string => {
      const d = new Date(`${iso}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + days);
      return d.toISOString().slice(0, 10);
    };
    const simAlreadyLogged = (date: string, code: string): boolean =>
      existingSimKeys.has(`${shiftIso(date, -1)}|${code}`) ||
      existingSimKeys.has(`${date}|${code}`) ||
      existingSimKeys.has(`${shiftIso(date, 1)}|${code}`);

    for (const sim of simSessions) {
      try {
        const sessionCode = (sim.sessionCode || sim.component || "SIM").toUpperCase();
        if (simAlreadyLogged(sim.date, sessionCode)) continue; // already logged
        const payload = buildSimFlight(
          sim,
          currentUser,
          reportGeneratedAt,
          importSource
        );
        await addFlight({ ...payload, ...reportStamps });
        existingSimKeys.add(`${sim.date}|${sessionCode}`);
        result.simSessionsCreated++;
      } catch (error) {
        result.errors.push({
          operation: `sim session ${sim.date}`,
          message: error instanceof Error ? error.message : "Unknown error",
        });
      }
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

  // ----- 6. Recompute derived fields on every touched flight, and gather
  //          (reg, type) pairs so we can populate the user Aircraft store. --
  const aircraftPairs: Array<{ reg: string; type: string }> = [];
  for (const id of touchedFlightIds) {
    try {
      const flight = await userDb.flights.get(id);
      if (flight?.isSimulator) continue; // sim fields are set explicitly
      if (flight?.aircraftReg) {
        aircraftPairs.push({
          reg: flight.aircraftReg,
          type: flight.aircraftType || "",
        });
      }
      await postWriteRecalculate(id);
    } catch {
      // Recompute failures aren't fatal — leave the flight as-is.
    }
  }

  // ----- 7. Correlate flights with aircraft records (engine/category) so
  //          the dashboard reflects 2-engine / jet totals correctly. --------
  try {
    await ensureAircraftForFlights(aircraftPairs, result);
  } catch {
    // Non-fatal — flights are already written.
  }

  // ----- 8. Advance the device-level report watermarks so a later upload of
  //          an OLDER file can be recognised as such. Never moves backwards. --
  try {
    await recordReportImport(trackingSource, reportGeneratedAt);
    if (trackingSource === "cross_hydrated") {
      await recordReportImport("schedule", scheduleGeneratedAt);
      await recordReportImport("logbook", logbookGeneratedAt);
    }
  } catch {
    // Watermarks are advisory — never fail an import over them.
  }

  return result;
}
