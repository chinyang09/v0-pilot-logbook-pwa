/**
 * Applies a reviewed LogTen migration plan to IndexedDB.
 *
 * Every write goes through the normal store helpers (`addFlight`,
 * `updateFlight`, `addPersonnel`, `addAircraft`), which is what puts each row
 * into the sync queue and on to MongoDB — a migration must land on every one
 * of the pilot's devices, not just the one they happened to import on.
 *
 * Order matters: crew and aircraft first, because the flight rows carry
 * personnel ids the crew step is about to create, and the fleet step gives the
 * dashboard's by-engine / by-category rings something to count.
 */

import {
  addAircraft,
  addFlight,
  addPersonnel,
  getAirportByIata,
  getAirportByIcao,
  getAllAircraft,
  updateAircraft,
  updateFlight,
  updatePersonnel,
  userDb,
} from "@/lib/db";
import type { Aircraft } from "@/types/entities/aircraft.types";
import type { Airport } from "@/types/entities/airport.types";
import { recalculateFlightFields } from "@/lib/utils/flight-calculations";
import { isSimulatorEntry } from "@/lib/utils/entry-type";
import { normalizeRegistration } from "@/lib/utils/string";
import { toEngineType, toDashboardCategory } from "../shared/aircraft-classify";
import { getAircraftType, isLiveFlight } from "@/lib/db";
import { addCustomAircraftToDatabase } from "@/lib/db/stores/reference/aircraft.store";
import type { LogtenImportPlan } from "./types";

export interface LogtenExecutionResult {
  flightsCreated: number;
  flightsUpdated: number;
  flightsSkipped: number;
  simulatorsCreated: number;
  crewCreated: number;
  crewUpdated: number;
  aircraftCreated: number;
  aircraftUpdated: number;
  /** Tails written into the reference DB because no lookup could resolve them. */
  aircraftSeeded: number;
  /** Flights that had a registration but no type until this fleet import. */
  flightsBackTagged: number;
  errors: Array<{ operation: string; message: string }>;
}

export interface ExecuteLogtenOptions {
  onProgress?: (percent: number, stage: string, detail?: string) => void;
  /**
   * Only apply these source lines from the flight plan. Omit to apply every
   * operation. The review surface uses it to let a pilot drop individual rows.
   */
  acceptedFlightLines?: Set<number>;
}

export async function executeLogtenImport(
  plan: LogtenImportPlan,
  options: ExecuteLogtenOptions = {}
): Promise<LogtenExecutionResult> {
  const { onProgress, acceptedFlightLines } = options;
  const result: LogtenExecutionResult = {
    flightsCreated: 0,
    flightsUpdated: 0,
    flightsSkipped: 0,
    simulatorsCreated: 0,
    crewCreated: 0,
    crewUpdated: 0,
    aircraftCreated: 0,
    aircraftUpdated: 0,
    aircraftSeeded: 0,
    flightsBackTagged: 0,
    errors: [],
  };

  // ---- 1. Crew ----
  onProgress?.(5, "Applying", "Crew");
  for (const row of plan.crew.toCreate) {
    try {
      // `put` rather than `addPersonnel` so the id the flight rows already
      // reference is the id that lands in the table.
      await userDb.personnel.put(row.personnel);
      result.crewCreated++;
    } catch (error) {
      result.errors.push({
        operation: `create crew ${row.personnel.name}`,
        message: message(error),
      });
    }
  }
  for (const row of plan.crew.toUpdate) {
    if (!row.matchedPersonnelId) continue;
    try {
      await updatePersonnel(row.matchedPersonnelId, row.patch);
      result.crewUpdated++;
    } catch (error) {
      result.errors.push({
        operation: `update crew ${row.personnel.name}`,
        message: message(error),
      });
    }
  }

  // Crew referenced only by a flight row (no address book, or a name the
  // address book didn't carry) still needs a record to point at.
  for (const person of plan.flights.personnelToCreate) {
    try {
      const already = await userDb.personnel.get(person.id);
      if (already) continue;
      await userDb.personnel.put(person);
      result.crewCreated++;
    } catch (error) {
      result.errors.push({
        operation: `create crew ${person.name}`,
        message: message(error),
      });
    }
  }
  void addPersonnel; // store helper kept in scope for future non-id-preserving paths

  // ---- 2. Aircraft ----
  onProgress?.(15, "Applying", "Aircraft");
  // Registration → type for everything this import establishes, used to
  // back-tag flights at the end.
  const typedFleet = new Map<string, string>();

  for (const row of plan.aircraft.toCreate) {
    try {
      await addAircraft(row.aircraft);
      result.aircraftCreated++;
      if (row.aircraft.typeDesignator) {
        typedFleet.set(
          normalizeRegistration(row.aircraft.registration),
          row.aircraft.typeDesignator
        );
      }
    } catch (error) {
      result.errors.push({
        operation: `create aircraft ${row.aircraft.registration}`,
        message: message(error),
      });
    }
  }
  for (const row of plan.aircraft.toUpdate) {
    if (!row.matchedAircraftId) continue;
    try {
      await updateAircraft(row.matchedAircraftId, row.patch);
      result.aircraftUpdated++;
      const type = row.patch.typeDesignator || row.aircraft.typeDesignator;
      if (type) {
        typedFleet.set(normalizeRegistration(row.aircraft.registration), type);
      }
    } catch (error) {
      result.errors.push({
        operation: `update aircraft ${row.aircraft.registration}`,
        message: message(error),
      });
    }
  }

  // A tail the lookup chain could not resolve is written into the REFERENCE
  // database as a custom record, from the file's own values. Without this the
  // next flight import asks the network about the same registration, fails
  // again, and leaves the flight untyped — the file already answered the
  // question, so the answer belongs where lookups read from.
  await seedReferenceDatabase(plan, result);

  // ---- 3. Flights ----
  const operations = plan.flights.operations.filter(
    (op) => !acceptedFlightLines || acceptedFlightLines.has(op.sourceLine)
  );
  const touched: string[] = [];
  const flownPairs = new Map<string, string>();

  let index = 0;
  for (const op of operations) {
    index++;
    if (index % 25 === 0) {
      onProgress?.(
        20 + Math.floor((index / operations.length) * 60),
        "Applying",
        `${index}/${operations.length} flights`
      );
    }

    try {
      if (op.kind === "skip_duplicate") {
        result.flightsSkipped++;
        continue;
      }
      if (op.kind === "create") {
        const created = await addFlight(op.flight);
        touched.push(created.id);
        if (isSimulatorEntry(created)) result.simulatorsCreated++;
        else result.flightsCreated++;
        if (created.aircraftReg) {
          flownPairs.set(created.aircraftReg.toUpperCase(), created.aircraftType || "");
        }
        continue;
      }
      const updated = await updateFlight(op.existing.id, op.patch);
      if (!updated) {
        result.errors.push({
          operation: `update ${op.label}`,
          message: "Flight no longer exists — the change was not applied.",
        });
        continue;
      }
      touched.push(op.existing.id);
      result.flightsUpdated++;
    } catch (error) {
      result.errors.push({ operation: op.label, message: message(error) });
    }
  }

  // ---- 4. Derived fields ----
  // `manualOverrides` carries whatever LogTen actually stated, so this fills in
  // the blanks (day time, and night time on any row LogTen left empty) without
  // restating the pilot's own figures. Simulators are skipped outright: they
  // have no airports to compute against, and a recomputed block time would put
  // the session into flight-hour totals.
  onProgress?.(85, "Applying", "Recalculating");
  for (const id of touched) {
    try {
      const flight = await userDb.flights.get(id);
      if (!flight || isSimulatorEntry(flight)) continue;
      const [dep, arr] = await Promise.all([
        resolveAirport(flight.departureIcao, flight.departureIata),
        resolveAirport(flight.arrivalIcao, flight.arrivalIata),
      ]);
      const updates = recalculateFlightFields(flight, dep, arr);
      if (Object.keys(updates).length > 0) await updateFlight(id, updates);
    } catch {
      // A failed recompute leaves the imported values in place, which is the
      // safe direction — never fail a migration over a derived field.
    }
  }

  // ---- 5. Fleet entries for anything flown but not in the Aircraft export ----
  onProgress?.(95, "Applying", "Fleet");
  try {
    await ensureFleet(flownPairs, result);
  } catch {
    // Non-fatal — the flights are already written.
  }

  // ---- 6. Back-tag flights this fleet import can now type ----
  // The other half of the loop. A pilot who imported their Flights tab first
  // has flights carrying a registration and no type — the lookup chain didn't
  // know the tail and the Aircraft export hadn't arrived. It has now, so the
  // flights it can answer for are filled in. Only BLANK types are written;
  // a type already on a flight is that flight's own record.
  if (typedFleet.size > 0) {
    onProgress?.(98, "Applying", "Linking flights");
    try {
      result.flightsBackTagged = await backTagFlights(typedFleet, result);
    } catch {
      // Non-fatal — the aircraft are written either way, and re-importing the
      // Aircraft export runs this again.
    }
  }

  return result;
}

/**
 * Give every flight that names one of these registrations, and has no type of
 * its own, the type this import established.
 */
async function backTagFlights(
  typedFleet: Map<string, string>,
  result: LogtenExecutionResult
): Promise<number> {
  const all = await userDb.flights.toArray();
  let tagged = 0;

  for (const flight of all) {
    if (!isLiveFlight(flight)) continue;
    if (!flight.aircraftReg || flight.aircraftType) continue;
    const type = typedFleet.get(normalizeRegistration(flight.aircraftReg));
    if (!type) continue;
    try {
      await updateFlight(flight.id, { aircraftType: type });
      tagged++;
    } catch (error) {
      result.errors.push({
        operation: `back-tag ${flight.aircraftReg}`,
        message: message(error),
      });
    }
  }

  return tagged;
}

/**
 * Write the file's own values into the reference database for the tails no
 * lookup could resolve, so they resolve locally from here on.
 */
async function seedReferenceDatabase(
  plan: LogtenImportPlan,
  result: LogtenExecutionResult
): Promise<void> {
  if (plan.aircraft.unresolvedRegistrations.length === 0) return;

  const unresolved = new Set(
    plan.aircraft.unresolvedRegistrations.map(normalizeRegistration)
  );
  const rows = [...plan.aircraft.toCreate, ...plan.aircraft.toUpdate];

  for (const row of rows) {
    const registration = row.aircraft.registration;
    if (!unresolved.has(normalizeRegistration(registration))) continue;
    try {
      await addCustomAircraftToDatabase({
        registration,
        icao24: "",
        typecode: row.aircraft.typeDesignator || "",
        operator: row.aircraft.operator || "",
        source: "custom",
      });
      result.aircraftSeeded++;
    } catch (error) {
      result.errors.push({
        operation: `reference ${registration}`,
        message: message(error),
      });
    }
  }
}

async function resolveAirport(
  icao: string,
  iata: string
): Promise<Airport | null> {
  if (icao) {
    const byIcao = await getAirportByIcao(icao).catch(() => null);
    if (byIcao) return byIcao;
  }
  if (iata) {
    const byIata = await getAirportByIata(iata).catch(() => null);
    if (byIata) return byIata;
  }
  return null;
}

/**
 * Give every registration that was actually flown a fleet record, deriving
 * engine group and category from its ICAO type. Existing records are only
 * BACKFILLED — the same rule the eCrew executor follows, and for the same
 * reason: a user-entered value outranks a derived one.
 */
async function ensureFleet(
  pairs: Map<string, string>,
  result: LogtenExecutionResult
): Promise<void> {
  if (pairs.size === 0) return;

  const existing = await getAllAircraft().catch(() => [] as Aircraft[]);
  const byReg = new Map(
    existing.map((a) => [normalizeRegistration(a.registration), a])
  );

  for (const [registration, type] of pairs) {
    try {
      const key = normalizeRegistration(registration);
      const doc = type ? await getAircraftType(type).catch(() => null) : null;
      const engineType = doc ? toEngineType(doc.engineType, doc.engineCount) : undefined;
      const category = doc ? toDashboardCategory(doc.category) : undefined;
      const model = doc ? `${doc.manufacturer} ${doc.designator}`.trim() : "";

      const found = byReg.get(key);
      if (!found) {
        await addAircraft({
          registration,
          type: type || "",
          typeDesignator: type || "",
          model,
          category: category || "Airplane",
          engineType: engineType || "JET",
          isComplex: false,
          isHighPerformance: false,
        });
        result.aircraftCreated++;
        continue;
      }

      const patch: Partial<Aircraft> = {};
      if (!found.typeDesignator && type) patch.typeDesignator = type;
      if (!found.type && type) patch.type = type;
      if (!found.category && category) patch.category = category;
      if (!found.model && model) patch.model = model;
      if (Object.keys(patch).length > 0) {
        await updateAircraft(found.id, patch);
        result.aircraftUpdated++;
      }
    } catch (error) {
      result.errors.push({
        operation: `fleet ${registration}`,
        message: message(error),
      });
    }
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}
