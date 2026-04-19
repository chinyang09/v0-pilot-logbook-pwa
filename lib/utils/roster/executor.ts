/**
 * Roster Import Executor
 *
 * Applies a reviewed-and-approved PlannedImport to IndexedDB. Each approved
 * flight operation goes through the standard flights.store.ts helpers, which
 * means EVERY change enters the sync queue and propagates to MongoDB.
 *
 * Unlike the v1 flow, roster-imported flights are NEVER marked isDraft.
 * They are first-class flights from the moment they're created, which is
 * what enables cross-device visibility.
 */

import type {
  PlannedImport,
  AcceptableOperation,
} from "@/lib/utils/parsers/schedule-parser";
import type { FlightLog, FlightLogCreate } from "@/types/entities/flight.types";
import type { Personnel } from "@/types/entities/crew.types";
import type { Currency, Discrepancy } from "@/types/entities/roster.types";
import {
  addFlight,
  updateFlight,
  deleteFlight,
  getAirportByIata,
  getAirportTimeInfo,
  getCurrentUserPersonnel,
  userDb,
} from "@/lib/db";
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
  personnelCreated: number;
  personnelUpdated: number;
  currenciesSaved: number;
  discrepancies: Discrepancy[];
  errors: Array<{ operation: string; message: string }>;
}

// ============================================================
// Sector → FlightLog hydration
// ============================================================

async function hydrateFlightFromSector(
  sector: ParsedSector,
  currentUser: Personnel
): Promise<FlightLogCreate> {
  const [depAirport, arrAirport] = await Promise.all([
    getAirportByIata(sector.departureIata),
    getAirportByIata(sector.arrivalIata),
  ]);

  const depOffset = depAirport ? getAirportTimeInfo(depAirport.tz).offset : 0;
  const arrOffset = arrAirport ? getAirportTimeInfo(arrAirport.tz).offset : 0;

  const captain = sector.crew?.find(c => c.role === "CPT" || c.role === "PIC");
  const fo = sector.crew?.find(c => c.role === "FO");
  const isSelfCPT = captain && currentUser.crewId && captain.crewId === currentUser.crewId;
  const isSelfFO = fo && currentUser.crewId && fo.crewId === currentUser.crewId;

  let picId = captain?.personnelId || "";
  let picName = captain?.name || "";
  let sicId = fo?.personnelId || "";
  let sicName = fo?.name || "";

  if (isSelfCPT) {
    picId = currentUser.id;
    picName = "Self";
  }
  if (isSelfFO) {
    sicId = currentUser.id;
    sicName = "Self";
  }

  return {
    isDraft: false,
    date: sector.date,
    flightNumber: sector.flightNumber.startsWith("TR")
      ? sector.flightNumber
      : `TR${sector.flightNumber.replace(/\D/g, "")}`,
    aircraftReg: "",
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
    blockTime: "00:00",
    flightTime: "00:00",
    nightTime: "00:00",
    dayTime: "00:00",
    picId,
    picName,
    sicId,
    sicName,
    additionalCrew: [],
    pilotFlying: true,
    pilotRole: currentUser.roles?.includes("PIC") ? "PIC" : "SIC",
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
    remarks: `Imported from roster: ${sector.flightNumber}`,
    endorsements: "",
    manualOverrides: {},
    ifrTime: "00:00",
    actualInstrumentTime: "00:00",
    simulatedInstrumentTime: "00:00",
    crossCountryTime: "00:00",
    approaches: [],
    holds: 0,
    ipcIcc: false,
  };
}

function buildUpdatePatch(op: AcceptableOperation): Partial<FlightLog> {
  if (op.kind !== "update_conflict" && op.kind !== "edited_conflict") return {};
  const patch: Partial<FlightLog> = {};
  for (const change of op.changes) {
    (patch as Record<string, unknown>)[change.field] = change.to;
  }
  return patch;
}

// ============================================================
// Main executor
// ============================================================

export async function executeRosterImport(
  plan: PlannedImport
): Promise<ExecutionResult> {
  const result: ExecutionResult = {
    created: 0,
    updated: 0,
    deleted: 0,
    identical: 0,
    ignored: 0,
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

  // ----- 2. Flight operations (filtered by acceptance flag) -----
  for (const op of plan.operations) {
    if (!op.accepted) {
      if (op.kind === "update_conflict" || op.kind === "edited_conflict") {
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
          const payload = await hydrateFlightFromSector(op.sector, currentUser);
          await addFlight(payload);
          result.created++;
          break;
        }
        case "update_conflict":
        case "edited_conflict": {
          const patch = buildUpdatePatch(op);
          await updateFlight(op.flight.id, patch);
          result.updated++;
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

  // ----- 3. Currencies (always applied) -----
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

  return result;
}
