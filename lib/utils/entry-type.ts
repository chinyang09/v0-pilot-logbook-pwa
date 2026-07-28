/**
 * Entry type — flight vs simulator, and the bridge to the legacy flag.
 *
 * `FlightLog.entryType` is the field going forward, but every row written
 * before it existed only carries `isSimulator`. Read through `getEntryType`
 * so those rows keep working, and write through `entryTypePatch` so both
 * stay in step (the dashboard, the FDP pipeline and the flight card all still
 * branch on `isSimulator`).
 */

import type { EntryType, FlightLog } from "@/types/entities/flight.types";

export const ENTRY_TYPES: ReadonlyArray<{ value: EntryType; label: string }> = [
  { value: "flight", label: "Flight" },
  { value: "simulator", label: "Simulator" },
];

/** The entry's type, falling back to the legacy `isSimulator` flag. */
export function getEntryType(
  flight: Pick<FlightLog, "entryType" | "isSimulator">
): EntryType {
  if (flight.entryType) return flight.entryType;
  return flight.isSimulator ? "simulator" : "flight";
}

export function isSimulatorEntry(
  flight: Pick<FlightLog, "entryType" | "isSimulator">
): boolean {
  return getEntryType(flight) === "simulator";
}

/**
 * The fields to write when the user changes the type. Both representations are
 * set together so nothing has to know which one is authoritative.
 */
export function entryTypePatch(type: EntryType): Partial<FlightLog> {
  return { entryType: type, isSimulator: type === "simulator" };
}

/** Duration a card should show: block time for a flight, session length for a sim. */
export function entryDuration(
  flight: Pick<
    FlightLog,
    "entryType" | "isSimulator" | "blockTime" | "simulatedInstrumentTime"
  >
): string {
  return isSimulatorEntry(flight)
    ? flight.simulatedInstrumentTime || flight.blockTime || ""
    : flight.blockTime || "";
}
