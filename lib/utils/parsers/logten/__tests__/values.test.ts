/**
 * Value coercion — the layer every field in a LogTen export passes through.
 *
 * The cases that matter are the ones a real export actually produces: the
 * leading spaces LogTen pads several columns with, the thousands separator in
 * `flight_distance`, and the split between a DURATION (which may exceed 24h)
 * and a CLOCK time (which may not). Getting the last one wrong is how a
 * four-figure totals row ends up as somebody's departure time.
 */

import { describe, it, expect } from "vitest";
import {
  durationMinutes,
  hasTime,
  toBool,
  toClock,
  toDuration,
  toInt,
  toIsoDate,
  toNumber,
  text,
  upper,
} from "../values";

describe("text", () => {
  it("strips the leading space LogTen pads its columns with", () => {
    expect(text(" Lim Chin Yang")).toBe("Lim Chin Yang");
    expect(text(" PIC")).toBe("PIC");
    expect(text(" Full Name")).toBe("Full Name");
  });

  it("collapses internal whitespace and drops wrapping quotes", () => {
    expect(text('  "Tan  Wei   Ming"  ')).toBe("Tan Wei Ming");
  });

  it("survives a short row handing it undefined", () => {
    expect(text(undefined)).toBe("");
    expect(text(null)).toBe("");
    expect(upper(undefined)).toBe("");
  });

  it("strips a UTF-8 BOM off the first header cell", () => {
    expect(text("﻿light_flightDate")).toBe("light_flightDate");
    expect(text("﻿Aircraft ID")).toBe("Aircraft ID");
  });
});

describe("toNumber / toInt", () => {
  it("reads the thousands separator in flight_distance", () => {
    expect(toNumber("1,178.1")).toBeCloseTo(1178.1);
  });

  it("returns null for absent rather than NaN, so blank ≠ zero", () => {
    expect(toNumber("")).toBeNull();
    expect(toNumber(undefined)).toBeNull();
    expect(toNumber("not a number")).toBeNull();
    expect(toInt("")).toBe(0);
  });
});

describe("toBool", () => {
  it("reads LogTen's 1-or-blank convention", () => {
    expect(toBool("1")).toBe(true);
    expect(toBool("")).toBe(false);
    expect(toBool(undefined)).toBe(false);
  });

  it("accepts the forms a spreadsheet round-trip introduces", () => {
    expect(toBool("TRUE")).toBe(true);
    expect(toBool("yes")).toBe(true);
    expect(toBool("x")).toBe(true);
    expect(toBool("0")).toBe(false);
  });
});

describe("toIsoDate", () => {
  it("passes LogTen's own ISO dates straight through", () => {
    expect(toIsoDate("2026-08-09")).toBe("2026-08-09");
    expect(toIsoDate("2026-5-3")).toBe("2026-05-03");
  });

  it("resolves an ambiguous slash date from the day field when it can", () => {
    expect(toIsoDate("13/05/2026")).toBe("2026-05-13");
    expect(toIsoDate("05/13/2026")).toBe("2026-05-13");
  });

  it("honours an explicit order when both fields could be a month", () => {
    expect(toIsoDate("05/08/2026", "dmy")).toBe("2026-08-05");
    expect(toIsoDate("05/08/2026", "mdy")).toBe("2026-05-08");
  });

  it("reads month names and two-digit years", () => {
    expect(toIsoDate("13-May-2026")).toBe("2026-05-13");
    expect(toIsoDate("13 August 26")).toBe("2026-08-13");
    expect(toIsoDate("Aug 9, 2026")).toBe("2026-08-09");
  });

  it("returns empty rather than throwing on junk", () => {
    expect(toIsoDate("")).toBe("");
    expect(toIsoDate("Totals")).toBe("");
    expect(toIsoDate("2026-99-99")).toBe("");
  });
});

describe("toDuration", () => {
  it("pads LogTen's single-digit hours", () => {
    expect(toDuration("4:00")).toBe("04:00");
    expect(toDuration("3:27")).toBe("03:27");
  });

  it("allows a duration past 24 hours, which a totals row carries", () => {
    expect(toDuration("1234:30")).toBe("1234:30");
  });

  it("reads decimal hours as hours, not as minutes", () => {
    expect(toDuration("1.5")).toBe("01:30");
    expect(toDuration("2.25")).toBe("02:15");
  });

  it("distinguishes absent from zero", () => {
    expect(toDuration("")).toBe("");
    expect(toDuration(undefined)).toBe("");
    expect(toDuration("0:00")).toBe("00:00");
  });
});

describe("toClock", () => {
  it("reads the OOOI columns of the real export", () => {
    expect(toClock("23:29")).toBe("23:29");
    expect(toClock("02:56")).toBe("02:56");
    expect(toClock("4:02")).toBe("04:02");
  });

  it("rejects a value that cannot be a time of day", () => {
    // A duration landing in a clock column must not wrap into a plausible
    // hour — 26:30 becoming 02:30 is a silent eight-hour error.
    expect(toClock("26:30")).toBe("");
    expect(toClock("1234:30")).toBe("");
    expect(toClock("")).toBe("");
  });

  it("handles the Z suffix and a 12-hour round-trip", () => {
    expect(toClock("23:29Z")).toBe("23:29");
    expect(toClock("10:30 PM")).toBe("22:30");
    expect(toClock("12:05 AM")).toBe("00:05");
    expect(toClock("0402")).toBe("04:02");
  });
});

describe("durationMinutes / hasTime", () => {
  it("treats a blank and an explicit zero as no time logged", () => {
    expect(hasTime("")).toBe(false);
    expect(hasTime("00:00")).toBe(false);
    expect(hasTime("00:01")).toBe(true);
    expect(durationMinutes("03:27")).toBe(207);
  });
});
