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
  { value: "positioning", label: "Positioning" },
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

/** Carried as a passenger to or from a duty — duty time, but no flight time at all. */
export function isPositioningEntry(
  flight: Pick<FlightLog, "entryType" | "isSimulator">
): boolean {
  return getEntryType(flight) === "positioning";
}

/** A sector the pilot OPERATED — the only kind of entry that carries flight time. */
export function isOperatedFlight(
  flight: Pick<FlightLog, "entryType" | "isSimulator">
): boolean {
  return getEntryType(flight) === "flight";
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
  "soloTime",
  "picTime",
  "sicTime",
  "picusTime",
  "dualTime",
  "instructorTime",
] as const satisfies ReadonlyArray<keyof FlightLog>;

/** The role times — the pilot may pin one deliberately, so an override holds. */
const PINNABLE = new Set<string>(["picTime", "sicTime", "picusTime", "dualTime", "instructorTime", "crossCountryTime", "multiPilotTime", "soloTime"]);

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

/**
 * Every time and count a POSITIONING sector carries none of. It is duty (its
 * OUT/IN stay, and the FDP pipeline reads them) but the pilot flew nothing:
 * a block time would reach every flight-hour total, a role time the licence
 * record, a landing the 90-day recency. Pins do not survive it either — there
 * is no figure a pilot can own on a flight they did not operate.
 */
const POSITIONING_ZERO_TIMES = [
  ...SIMULATOR_ZERO_FIELDS,
  "nightTime",
  "ifrTime",
  "actualInstrumentTime",
  "simulatedInstrumentTime",
] as const satisfies ReadonlyArray<keyof FlightLog>;
const POSITIONING_ZERO_COUNTS = [
  "dayTakeoffs",
  "dayLandings",
  "nightTakeoffs",
  "nightLandings",
  "autolands",
] as const satisfies ReadonlyArray<keyof FlightLog>;

/** What it takes to put a positioning sector right: empty when it already carries nothing. */
export function positioningPatch(flight: Partial<FlightLog>): Partial<FlightLog> {
  if (!isPositioningEntry({ entryType: flight.entryType, isSimulator: flight.isSimulator })) return {};
  const patch: Partial<FlightLog> = {};
  for (const field of POSITIONING_ZERO_TIMES) {
    if (hasDuration(flight[field])) patch[field] = "00:00";
  }
  for (const field of POSITIONING_ZERO_COUNTS) {
    if ((flight[field] ?? 0) !== 0) patch[field] = 0;
  }
  if (flight.pilotFlying) patch.pilotFlying = false;
  return patch;
}

/**
 * OUT→IN as H:MM, wrapping midnight; "" without both. A positioning sector's
 * length (which it stores nowhere), and a simulator session's when its start
 * and end were recorded.
 */
export function gateSpan(outTime?: string, inTime?: string): string {
  const parse = (t?: string) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t ?? "");
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const out = parse(outTime);
  const inn = parse(inTime);
  if (out === null || inn === null) return "";
  const span = (inn - out + 1440) % 1440;
  return `${Math.floor(span / 60)}:${String(span % 60).padStart(2, "0")}`;
}

/**
 * Duration a card should show: block time for a flight, session length for a
 * sim, and OUT→IN for a positioning sector (its time on board, which counts
 * as duty but is held in no hour field).
 */
export function entryDuration(
  flight: Pick<
    FlightLog,
    "entryType" | "isSimulator" | "blockTime" | "simulatedInstrumentTime"
  > & Partial<Pick<FlightLog, "outTime" | "inTime">>
): string {
  const type = getEntryType(flight);
  if (type === "simulator") return flight.simulatedInstrumentTime || flight.blockTime || "";
  if (type === "positioning") return gateSpan(flight.outTime, flight.inTime);
  return flight.blockTime || "";
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
