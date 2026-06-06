/**
 * Tests for time-reference-normalizer
 *
 * Validates conversion of CSV schedule times (UTC / Local Base / Local Station)
 * to canonical UTC date + HH:MM pairs, respecting DST for historical dates.
 *
 * Test cases cross-reference the three real Scoot CSV exports (UTC,
 * Local Base, Local Station) for the same pilot in April 2026, so equivalent
 * conversions in all three formats MUST produce identical UTC output.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeTimeToUTC,
  getOffsetForDate,
  parseTimeToken,
} from "../time-reference-normalizer";

// ============================================================
// Fixtures — real airport TZs used in the sample data
// ============================================================

const TZ_SIN = "Asia/Singapore"; // UTC+8, no DST
const TZ_BKK = "Asia/Bangkok"; //   UTC+7, no DST
const TZ_NYC = "America/New_York"; // UTC-5/-4, DST

// ============================================================
// parseTimeToken — isolates the "A" prefix + "⁺¹" rollover
// ============================================================

describe("parseTimeToken", () => {
  it("parses a plain scheduled time", () => {
    const r = parseTimeToken("18:00");
    expect(r).toEqual({ time: "18:00", isActual: false, dayDelta: 0, nextDay: false });
  });

  it("recognises an actual-time 'A' prefix", () => {
    const r = parseTimeToken("A04:49");
    expect(r).toEqual({ time: "04:49", isActual: true, dayDelta: 0, nextDay: false });
  });

  it("recognises a '⁺¹' next-day marker", () => {
    const r = parseTimeToken("02:20⁺¹");
    expect(r).toEqual({ time: "02:20", isActual: false, dayDelta: 1, nextDay: true });
  });

  it("recognises a '⁻¹' previous-day marker", () => {
    const r = parseTimeToken("23:50⁻¹");
    expect(r).toEqual({ time: "23:50", isActual: false, dayDelta: -1, nextDay: false });
  });

  it("recognises actual + next-day together", () => {
    const r = parseTimeToken("A01:13⁺¹");
    expect(r).toEqual({ time: "01:13", isActual: true, dayDelta: 1, nextDay: true });
  });

  it("recognises actual + previous-day together", () => {
    const r = parseTimeToken("A23:50⁻¹");
    expect(r).toEqual({ time: "23:50", isActual: true, dayDelta: -1, nextDay: false });
  });

  it("accepts ASCII +1 / -1 fallbacks", () => {
    expect(parseTimeToken("02:20+1")).toEqual({
      time: "02:20",
      isActual: false,
      dayDelta: 1,
      nextDay: true,
    });
    expect(parseTimeToken("A23:50-1")).toEqual({
      time: "23:50",
      isActual: true,
      dayDelta: -1,
      nextDay: false,
    });
  });

  it("returns null for an invalid token", () => {
    expect(parseTimeToken("")).toBeNull();
    expect(parseTimeToken("garbage")).toBeNull();
    expect(parseTimeToken("25:99")).toBeNull();
  });

  it("tolerates surrounding whitespace", () => {
    const r = parseTimeToken(" A22:16 ");
    expect(r).toEqual({ time: "22:16", isActual: true, dayDelta: 0, nextDay: false });
  });
});

// ============================================================
// getOffsetForDate — DST-aware offset lookup
// ============================================================

describe("getOffsetForDate", () => {
  it("returns +8 for Singapore (no DST)", () => {
    expect(getOffsetForDate(TZ_SIN, "2026-04-02")).toBe(8);
    expect(getOffsetForDate(TZ_SIN, "2026-12-25")).toBe(8);
  });

  it("returns +7 for Bangkok (no DST)", () => {
    expect(getOffsetForDate(TZ_BKK, "2026-04-02")).toBe(7);
  });

  it("returns -4 for New York in summer (EDT)", () => {
    // Mid-July 2026 — squarely within US DST
    expect(getOffsetForDate(TZ_NYC, "2026-07-15")).toBe(-4);
  });

  it("returns -5 for New York in winter (EST)", () => {
    expect(getOffsetForDate(TZ_NYC, "2026-01-15")).toBe(-5);
  });

  it("returns 0 on unknown timezone string", () => {
    expect(getOffsetForDate("Not/A_Zone", "2026-04-02")).toBe(0);
  });
});

// ============================================================
// normalizeTimeToUTC — the core conversion
// ============================================================

describe("normalizeTimeToUTC — UTC source (pass-through)", () => {
  it("returns the same time when source is already UTC", () => {
    const r = normalizeTimeToUTC({
      rawTime: "04:49",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
    });
    expect(r).toEqual({ utcTime: "04:49", utcDate: "2026-04-02" });
  });

  it("handles '⁺¹' day rollover in UTC source", () => {
    // From UTC CSV: BKK-SIN return leg on 08/04, IN = "02:20⁺¹"
    const r = normalizeTimeToUTC({
      rawTime: "02:20⁺¹",
      rowDate: "2026-04-08",
      timeReference: "UTC",
      role: "in",
      depTz: TZ_BKK,
      arrTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "02:20", utcDate: "2026-04-09" });
  });

  it("strips 'A' prefix in UTC source without shifting time", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A04:49",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
    });
    expect(r?.utcTime).toBe("04:49");
  });
});

describe("normalizeTimeToUTC — Local Base source (uniform TZ)", () => {
  // Cross-reference: Local Base 02/04 BKK turn OUT "A12:49" == UTC "A04:49"
  it("subtracts base-airport offset (SIN +8)", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A12:49",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_BASE",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "04:49", utcDate: "2026-04-02" });
  });

  it("crosses date boundary backwards when local time minus offset < 0", () => {
    // Local Base 09/04 01:00 SIN = 08/04 17:00 UTC (report time for DVO flight)
    const r = normalizeTimeToUTC({
      rawTime: "01:00",
      rowDate: "2026-04-09",
      timeReference: "LOCAL_BASE",
      role: "out",
      depTz: TZ_SIN,
      arrTz: "Asia/Manila",
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "17:00", utcDate: "2026-04-08" });
  });

  it("applies '⁺¹' before subtracting offset", () => {
    // Local Base 03/04 CJB return IN = "A06:39⁺¹" → UTC 22:39 on same row day
    // SIN offset +8; (06:39 next day) - 8h = 22:39 same day
    const r = normalizeTimeToUTC({
      rawTime: "A06:39⁺¹",
      rowDate: "2026-04-03",
      timeReference: "LOCAL_BASE",
      role: "in",
      depTz: "Asia/Kolkata",
      arrTz: TZ_SIN,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "22:39", utcDate: "2026-04-03" });
  });
});

describe("normalizeTimeToUTC — Local Station source (dual TZ per leg)", () => {
  // Cross-reference: Local Station 02/04 BKK turn
  //   OUT A12:49 SIN (dep TZ +8) → 04:49 UTC
  //   IN  A14:22 BKK (arr TZ +7) → 07:22 UTC
  it("uses departure TZ for 'out' role", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A12:49",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "04:49", utcDate: "2026-04-02" });
  });

  it("uses arrival TZ for 'in' role", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A14:22",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "in",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "07:22", utcDate: "2026-04-02" });
  });

  it("uses departure TZ for 'off' role", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A12:59",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "off",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r?.utcTime).toBe("04:59");
  });

  it("uses arrival TZ for 'on' role", () => {
    const r = normalizeTimeToUTC({
      rawTime: "A14:12",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "on",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r?.utcTime).toBe("07:12");
  });

  it("handles '⁺¹' marker in station-local time", () => {
    // Local Station 03/04 CJB IN = "A06:39⁺¹" (CJB is UTC+5:30 IST - but treat as SIN arrival)
    // Actually CJB arrives back in SIN, so arrival TZ is SIN (+8). Same as Local Base case.
    // (06:39 next day) - 8h = 22:39 row day
    const r = normalizeTimeToUTC({
      rawTime: "A06:39⁺¹",
      rowDate: "2026-04-03",
      timeReference: "LOCAL_STATION",
      role: "in",
      depTz: "Asia/Kolkata",
      arrTz: TZ_SIN,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "22:39", utcDate: "2026-04-03" });
  });

  it("handles date-shift for outbound across midnight in station local", () => {
    // Contrived: a late-evening SIN departure encoded as Local Station "23:30"
    // SIN offset +8; 23:30 - 8h = 15:30 UTC same day
    const r = normalizeTimeToUTC({
      rawTime: "23:30",
      rowDate: "2026-04-10",
      timeReference: "LOCAL_STATION",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r).toEqual({ utcTime: "15:30", utcDate: "2026-04-10" });
  });
});

// ============================================================
// Three-format equivalence — the integration-style guarantee
// ============================================================

describe("normalizeTimeToUTC — three-format equivalence", () => {
  it("all three formats produce identical UTC for 02/04 BKK OUT", () => {
    const utcResult = normalizeTimeToUTC({
      rawTime: "A04:49",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
    });
    const baseResult = normalizeTimeToUTC({
      rawTime: "A12:49",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_BASE",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    const stationResult = normalizeTimeToUTC({
      rawTime: "A12:49",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(utcResult).toEqual(baseResult);
    expect(baseResult).toEqual(stationResult);
  });

  it("all three formats produce identical UTC for 02/04 BKK IN", () => {
    const utcResult = normalizeTimeToUTC({
      rawTime: "A07:22",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "in",
      depTz: TZ_BKK,
      arrTz: TZ_SIN,
    });
    const baseResult = normalizeTimeToUTC({
      rawTime: "A15:22",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_BASE",
      role: "in",
      depTz: TZ_BKK,
      arrTz: TZ_SIN,
      baseTz: TZ_SIN,
    });
    // Local Station: return leg IN uses arrival TZ = SIN (+8); 15:22 SIN = 07:22 UTC
    const stationResult = normalizeTimeToUTC({
      rawTime: "A15:22",
      rowDate: "2026-04-02",
      timeReference: "LOCAL_STATION",
      role: "in",
      depTz: TZ_BKK,
      arrTz: TZ_SIN,
      baseTz: TZ_SIN,
    });
    expect(utcResult).toEqual(baseResult);
    expect(baseResult).toEqual(stationResult);
  });
});

// ============================================================
// Error handling
// ============================================================

describe("normalizeTimeToUTC — error paths", () => {
  it("returns null-like result for empty input", () => {
    const r = normalizeTimeToUTC({
      rawTime: "",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
    });
    expect(r).toBeNull();
  });

  it("returns null for malformed time", () => {
    const r = normalizeTimeToUTC({
      rawTime: "99:99",
      rowDate: "2026-04-02",
      timeReference: "UTC",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
    });
    expect(r).toBeNull();
  });

  it("returns null for invalid rowDate", () => {
    const r = normalizeTimeToUTC({
      rawTime: "12:00",
      rowDate: "not-a-date",
      timeReference: "LOCAL_BASE",
      role: "out",
      depTz: TZ_SIN,
      arrTz: TZ_BKK,
      baseTz: TZ_SIN,
    });
    expect(r).toBeNull();
  });
});
