/**
 * Per-source report tracking: schedule and logbook reports are independent
 * streams, so one must never make the other look stale.
 */

import { describe, it, expect } from "vitest";
import { newestStamp, hasBeenTallied, stampsFor } from "../report-tracking";
import type { FlightLog } from "@/types/entities/flight.types";

const JUL24 = Date.UTC(2026, 6, 24, 12, 36);
const JUL25 = Date.UTC(2026, 6, 25, 2, 10);

describe("newestStamp", () => {
  it("takes the newest of either report kind", () => {
    const f = {
      scheduleReportAt: JUL24,
      logbookReportAt: JUL25,
    } as Partial<FlightLog> as FlightLog;
    expect(newestStamp(f)).toBe(JUL25);
  });

  it("falls back to the legacy single watermark", () => {
    const legacy = { reportGeneratedAt: JUL24 } as Partial<FlightLog> as FlightLog;
    expect(newestStamp(legacy)).toBe(JUL24);
  });

  it("returns undefined when the flight was never imported", () => {
    expect(newestStamp({} as FlightLog)).toBeUndefined();
  });
});

describe("hasBeenTallied", () => {
  it("is true only once a logbook report has been applied", () => {
    expect(hasBeenTallied({ logbookReportAt: JUL25 })).toBe(true);
    expect(hasBeenTallied({})).toBe(false);
    // A schedule import alone does not count as tallied.
    expect(
      hasBeenTallied({ scheduleReportAt: JUL25 } as Partial<FlightLog>)
    ).toBe(false);
  });
});

describe("stampsFor", () => {
  it("a schedule import stamps only the schedule stream", () => {
    expect(stampsFor("schedule", JUL24, JUL25)).toEqual({
      scheduleReportAt: JUL24,
    });
  });

  it("a logbook import stamps only the logbook stream", () => {
    expect(stampsFor("logbook", JUL24, JUL25)).toEqual({
      logbookReportAt: JUL25,
    });
  });

  it("a cross-hydrated import stamps both", () => {
    expect(stampsFor("cross_hydrated", JUL24, JUL25)).toEqual({
      scheduleReportAt: JUL24,
      logbookReportAt: JUL25,
    });
  });

  it("omits a stream with no timestamp", () => {
    expect(stampsFor("cross_hydrated", null, JUL25)).toEqual({
      logbookReportAt: JUL25,
    });
  });
});
