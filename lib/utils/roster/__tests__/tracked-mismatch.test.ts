/**
 * `acceptedAt` on a tracked mismatch — the flag that decides whether the
 * pilot's original value is still there in 90 days.
 *
 * Two ways to get this wrong, both quiet:
 *
 * - Not setting it when the company's value was taken leaves the row in
 *   Comparisons forever, so accepting at import time and accepting on the
 *   discrepancies page end up in different places despite being the same act.
 * - Setting it when the PILOT's value was kept starts a clock on a standing
 *   difference — and the retention sweep would eventually delete the licence
 *   record of a difference the pilot never conceded.
 *
 * So the invariant tested here is exactly: the clock runs if and only if the
 * flight now holds the company's figure.
 */

import { describe, it, expect, vi } from "vitest";

// The executor pulls real IndexedDB helpers in at module-eval time; nothing
// below actually reaches them.
vi.mock("@/lib/db", () => ({
  userDb: { flights: {}, discrepancies: {} },
  isLiveFlight: (f: { deletedAt?: number }) => f.deletedAt === undefined,
  addFlight: vi.fn(),
  updateFlight: vi.fn(),
  deleteFlight: vi.fn(),
  getAirportByIata: vi.fn(),
  getAirportTimeInfo: vi.fn(),
  getCurrentUserPersonnel: vi.fn(),
  getUserPreferences: vi.fn(),
  getAllAircraft: vi.fn(),
  addAircraft: vi.fn(),
  updateAircraft: vi.fn(),
  getAircraftType: vi.fn(),
  DEFAULT_IMPORT_DEFAULTS: {},
}));
vi.mock("@/lib/utils/parsers/shared/airport-enricher", () => ({
  enrichAirportBatch: vi.fn(async () => ({
    enriched: new Map(),
    failedCodes: [],
    stats: { requested: 0, found: 0, failed: 0 },
  })),
}));

import { trackedMismatches } from "../executor";
import type { FlightLog } from "@/types/entities/flight.types";
import type { FieldDiff } from "../reconciler";
import { isWithinRetention, RETENTION_MS } from "@/lib/utils/retention";

const flight = { id: "flt-1", date: "2026-07-12" } as FlightLog;

/** Company says PM, pilot logged PF. */
const pilotFlyingDiff: FieldDiff = {
  field: "pilotFlying",
  from: "true",
  to: "false",
};

describe("accepting the company's value", () => {
  it("starts the undo clock", () => {
    const [row] = trackedMismatches(flight, [pilotFlyingDiff], true);
    expect(row.holding).toBe("schedule");
    expect(row.acceptedAt).toBeTypeOf("number");
    expect(isWithinRetention(row.acceptedAt)).toBe(true);
  });

  it("keeps the pilot's value on the row so it can be put back", () => {
    const [row] = trackedMismatches(flight, [pilotFlyingDiff], true);
    expect(row.logbookValue).toBe("true");
    expect(row.scheduleValue).toBe("false");
  });
});

describe("keeping the pilot's value", () => {
  it("starts no clock — a standing difference does not expire", () => {
    const [row] = trackedMismatches(flight, [pilotFlyingDiff], false);
    expect(row.holding).toBe("logbook");
    expect(row.acceptedAt).toBeUndefined();
    // Which is what keeps the retention sweep off it.
    expect(isWithinRetention(row.acceptedAt)).toBe(false);
  });
});

describe("day/night splits", () => {
  const dayLandingDiff: FieldDiff = {
    field: "dayLandings",
    from: "1",
    to: "0",
    companyValue: "0",
  };

  it("are tracked the same way", () => {
    const accepted = trackedMismatches(flight, [dayLandingDiff], true)[0];
    const declined = trackedMismatches(flight, [dayLandingDiff], false)[0];
    expect(accepted.type).toBe("day_night_mismatch");
    expect(accepted.acceptedAt).toBeTypeOf("number");
    expect(declined.acceptedAt).toBeUndefined();
  });

  it("compare against what the company logged, not our sun calculation", () => {
    // `to` is our own recomputed value; `companyValue` is the report's. The row
    // has to show the company's, or the comparison is against ourselves.
    const [row] = trackedMismatches(
      flight,
      [{ field: "nightLandings", from: "0", to: "1", companyValue: "2" }],
      true
    );
    expect(row.scheduleValue).toBe("2");
  });
});

describe("rows the comparison should not produce", () => {
  it("skips a field the pilot and the company agree on", () => {
    expect(
      trackedMismatches(
        flight,
        [{ field: "pilotFlying", from: "true", to: "true" }],
        true
      )
    ).toHaveLength(0);
  });

  it("skips company-owned fields — the times are not a comparison", () => {
    expect(
      trackedMismatches(
        flight,
        [{ field: "outTime", from: "04:00", to: "04:49" }],
        true
      )
    ).toHaveLength(0);
  });
});

describe("ids", () => {
  it("are deterministic so a re-import refreshes rather than stacks", () => {
    const first = trackedMismatches(flight, [pilotFlyingDiff], true)[0];
    const second = trackedMismatches(flight, [pilotFlyingDiff], true)[0];
    expect(first.id).toBe("mismatch:flt-1:pilotFlying");
    expect(second.id).toBe(first.id);
  });
});

describe("the window itself", () => {
  it("is the app-wide 90 days, not a second definition", () => {
    const [row] = trackedMismatches(flight, [pilotFlyingDiff], true);
    const at = row.acceptedAt!;
    expect(isWithinRetention(at, at + RETENTION_MS - 1)).toBe(true);
    expect(isWithinRetention(at, at + RETENTION_MS)).toBe(false);
  });
});
