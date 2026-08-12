/**
 * The zone a LogTen export's clock times are in.
 *
 * This is the single highest-consequence guess in the whole migration: read
 * local times as UTC and every flight in the logbook is filed hours out, with
 * night time, day/night landings and FDP all computed off the wrong instants.
 * LogTen writes no marker, so it has to be inferred — and the file already
 * contains the evidence, because it records both the out/in times AND the
 * block time it derived from them.
 *
 * The sample export the format was built against is entirely inside UTC+8, so
 * the detector has nothing to go on there and says so rather than guessing —
 * that "assumed" verdict is what drives the warning and the manual override.
 */

import { describe, it, expect } from "vitest";
import {
  detectTimeReference,
  localToUtc,
  wrappedSpan,
  type TimeReferenceSample,
} from "../time-reference";

const SIN_HAK: TimeReferenceSample = {
  // Both ends UTC+8 — the two readings agree, so this proves nothing.
  outTime: "23:29",
  inTime: "02:56",
  blockTime: "03:27",
  depOffsetHours: 8,
  arrOffsetHours: 8,
};

/** SIN (+8) → BKK (+7), block 02:33. */
const SIN_BKK_UTC: TimeReferenceSample = {
  outTime: "04:49",
  inTime: "07:22",
  blockTime: "02:33",
  depOffsetHours: 8,
  arrOffsetHours: 7,
};

/** The same sector written in local station time: 12:49 SGT → 14:22 ICT. */
const SIN_BKK_LOCAL: TimeReferenceSample = {
  outTime: "12:49",
  inTime: "14:22",
  blockTime: "02:33",
  depOffsetHours: 8,
  arrOffsetHours: 7,
};

describe("wrappedSpan", () => {
  it("wraps a sector over midnight", () => {
    expect(wrappedSpan("23:29", "02:56")).toBe(207); // 03:27
    expect(wrappedSpan("04:02", "07:20")).toBe(198); // 03:18
  });

  it("returns -1 for an unreadable time rather than a wrong number", () => {
    expect(wrappedSpan("", "02:56")).toBe(-1);
    expect(wrappedSpan("23:29", "nope")).toBe(-1);
  });
});

describe("detectTimeReference", () => {
  it("says 'assumed' when every sector is inside one timezone", () => {
    // This is the sample export's situation. Reporting low confidence is the
    // whole point: an unqualified "UTC" here would be a guess dressed up as a
    // reading.
    const verdict = detectTimeReference([SIN_HAK, SIN_HAK]);
    expect(verdict.reference).toBe("utc");
    expect(verdict.confidence).toBe("assumed");
    expect(verdict.evidence).toMatch(/cross-timezone/i);
  });

  it("detects UTC from a cross-timezone sector", () => {
    const verdict = detectTimeReference([SIN_HAK, SIN_BKK_UTC]);
    expect(verdict.reference).toBe("utc");
    expect(verdict.confidence).toBe("detected");
  });

  it("detects local station time from the same sector written locally", () => {
    const verdict = detectTimeReference([SIN_HAK, SIN_BKK_LOCAL]);
    expect(verdict.reference).toBe("local");
    expect(verdict.confidence).toBe("detected");
    expect(verdict.evidence).toMatch(/local station time/i);
  });

  it("takes the majority when a file has a few hand-edited rows", () => {
    const verdict = detectTimeReference([
      SIN_BKK_LOCAL,
      SIN_BKK_LOCAL,
      SIN_BKK_LOCAL,
      SIN_BKK_UTC,
    ]);
    expect(verdict.reference).toBe("local");
    expect(verdict.evidence).toContain("3 of 4");
  });

  it("lets the caller override detection outright", () => {
    const verdict = detectTimeReference([SIN_BKK_UTC], "local");
    expect(verdict.reference).toBe("local");
    expect(verdict.confidence).toBe("forced");
  });
});

describe("localToUtc", () => {
  it("converts a local time and leaves the date alone when it doesn't move", () => {
    expect(localToUtc("2026-08-09", "23:29", 8)).toEqual({
      date: "2026-08-09",
      time: "15:29",
    });
  });

  it("moves the date back when the conversion crosses midnight", () => {
    // 03:40 local at UTC+8 is 19:40 the PREVIOUS day. The app keys a flight on
    // the UTC date of its OUT time, so dropping this shift files a whole
    // night's flying a day late.
    expect(localToUtc("2026-08-10", "03:40", 8)).toEqual({
      date: "2026-08-09",
      time: "19:40",
    });
  });

  it("moves the date forward for a western offset", () => {
    expect(localToUtc("2026-08-09", "20:15", -5)).toEqual({
      date: "2026-08-10",
      time: "01:15",
    });
  });

  it("handles a half-hour and a three-quarter-hour offset", () => {
    // India +5:30 and Nepal +5:45 — an offset rounded to whole hours puts
    // these 30 and 45 minutes out.
    expect(localToUtc("2026-08-09", "12:00", 5.5)).toEqual({
      date: "2026-08-09",
      time: "06:30",
    });
    expect(localToUtc("2026-08-09", "12:00", 5.75)).toEqual({
      date: "2026-08-09",
      time: "06:15",
    });
  });

  it("passes an unreadable time straight back", () => {
    expect(localToUtc("2026-08-09", "", 8)).toEqual({
      date: "2026-08-09",
      time: "",
    });
  });
});
