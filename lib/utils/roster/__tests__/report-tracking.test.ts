/**
 * Per-source report tracking: schedule and logbook reports are independent
 * streams, so one must never make the other look stale.
 */

import { describe, it, expect } from "vitest";
import { existingStampFor, stampsFor } from "../report-tracking";
import type { FlightLog } from "@/types/entities/flight.types";

const JUL24 = Date.UTC(2026, 6, 24, 12, 36);
const JUL25 = Date.UTC(2026, 6, 25, 2, 10);

describe("existingStampFor", () => {
  it("reads the per-source stamp", () => {
    const f = {
      scheduleReportAt: JUL24,
      logbookReportAt: JUL25,
    } as Partial<FlightLog> as FlightLog;
    expect(existingStampFor(f, "schedule")).toBe(JUL24);
    expect(existingStampFor(f, "logbook")).toBe(JUL25);
  });

  it("falls back to the legacy single watermark", () => {
    const legacy = { reportGeneratedAt: JUL24 } as Partial<FlightLog> as FlightLog;
    expect(existingStampFor(legacy, "schedule")).toBe(JUL24);
    expect(existingStampFor(legacy, "logbook")).toBe(JUL24);
  });

  it("returns undefined when the flight was never imported", () => {
    expect(existingStampFor({} as FlightLog, "logbook")).toBeUndefined();
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
