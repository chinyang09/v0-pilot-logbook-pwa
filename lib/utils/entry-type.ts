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

/**
 * The derived times a simulator never carries. Its duration lives in
 * `simulatedInstrumentTime` and nowhere else: a block time reaches every
 * flight-hour total, and a role time is what a licence authority reads.
 */
const SIMULATOR_ZERO_FIELDS = [
  "blockTime",
  "flightTime",
  "dayTime",
  "crossCountryTime",
  "multiPilotTime",
  "picTime",
  "sicTime",
  "picusTime",
  "dualTime",
  "instructorTime",
] as const satisfies ReadonlyArray<keyof FlightLog>;

/** The role times — the pilot may pin one deliberately, so an override holds. */
const PINNABLE = new Set<string>(["picTime", "sicTime", "picusTime", "dualTime", "instructorTime", "crossCountryTime", "multiPilotTime"]);

const hasDuration = (v: unknown) => typeof v === "string" && v !== "" && v !== "00:00" && v !== "0:00";

/**
 * What it takes to put a simulator row right: its derived times zeroed, and a
 * duration that only reached `blockTime` moved to where a session's belongs.
 * Empty for a flight, and for a simulator that is already right.
 *
 * Every recalculation used to compute a block time from OUT/IN whatever the
 * entry was — the flight form on every open, the roster import's post-write
 * pass — and its role time from that block, so a four-hour session landed in
 * the logbook as four hours of block and four of SIC.
 */
export function simulatorRepairPatch(
  flight: Partial<Pick<FlightLog, "entryType" | "isSimulator" | "manualOverrides" | "simulatedInstrumentTime" | (typeof SIMULATOR_ZERO_FIELDS)[number]>>
): Partial<FlightLog> {
  if (!isSimulatorEntry({ entryType: flight.entryType, isSimulator: flight.isSimulator })) return {};
  const overrides = (flight.manualOverrides ?? {}) as Record<string, boolean | undefined>;
  const patch: Partial<FlightLog> = {};
  if (!hasDuration(flight.simulatedInstrumentTime) && hasDuration(flight.blockTime)) {
    patch.simulatedInstrumentTime = flight.blockTime;
  }
  for (const field of SIMULATOR_ZERO_FIELDS) {
    if (PINNABLE.has(field) && overrides[field]) continue;
    if (hasDuration(flight[field])) patch[field] = "00:00";
  }
  return patch;
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

/**
 * A flight's overrides without the two a SIMULATOR sets on itself — its
 * session time and its night time. They mean "this is not a flight", so they
 * have to go when an entry becomes one, or night time stays pinned at the
 * simulator's 00:00 through every recalculation. A night pin holding a real
 * figure is the pilot's own and stays.
 */
export function withoutSimulatorPins(
  overrides: FlightLog["manualOverrides"],
  nightTime?: string
): FlightLog["manualOverrides"] {
  if (!overrides) return overrides
  const { simulatedInstrumentTime: _sim, nightTime: night, ...rest } = overrides
  return hasDuration(nightTime) && night ? { ...rest, nightTime: night } : rest
}
