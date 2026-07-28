/**
 * Tests for the "Generated on..." footer parser.
 */

import { describe, it, expect } from "vitest";
import {
  parseGeneratedAt,
  reportBoundaryDateIso,
  isPlannedDate,
} from "../shared/generated-at";

describe("isPlannedDate", () => {
  // Report generated Jul 25, 2026 02:10 UTC (like the real logbook export).
  const gen = Date.UTC(2026, 6, 25, 2, 10);

  it("treats rows strictly after the generation date as planned", () => {
    expect(isPlannedDate("2026-07-27", gen)).toBe(true); // future
    expect(isPlannedDate("2026-08-15", gen)).toBe(true);
  });

  it("treats rows on/before the generation date as flown", () => {
    expect(isPlannedDate("2026-07-25", gen)).toBe(false); // same day
    expect(isPlannedDate("2026-07-24", gen)).toBe(false); // past
    expect(isPlannedDate("2025-06-04", gen)).toBe(false);
  });

  it("boundary date is the UTC calendar date of the snapshot", () => {
    expect(reportBoundaryDateIso(gen)).toBe("2026-07-25");
  });
});

describe("parseGeneratedAt", () => {
  it("parses the canonical ecrew footer with double space", () => {
    const text = '"Generated on  May 09, 2026 02:48",,,,Page 1 of 1';
    const result = parseGeneratedAt(text);
    expect(result).toBe(Date.UTC(2026, 4, 9, 2, 48));
  });

  it("parses single-spaced variant", () => {
    expect(parseGeneratedAt("Generated on May 09, 2026 03:31")).toBe(
      Date.UTC(2026, 4, 9, 3, 31)
    );
  });

  it("parses single-digit day", () => {
    expect(parseGeneratedAt("Generated on May 9, 2026 02:48")).toBe(
      Date.UTC(2026, 4, 9, 2, 48)
    );
  });

  it("returns null when footer is missing", () => {
    expect(parseGeneratedAt("Some random CSV content")).toBeNull();
  });

  it("returns null on unknown month", () => {
    expect(parseGeneratedAt("Generated on Frobnary 09, 2026 02:48")).toBeNull();
  });

  it("returns null on empty input", () => {
    expect(parseGeneratedAt("")).toBeNull();
  });

  it("orders timestamps correctly: newer report > older report", () => {
    const older = parseGeneratedAt("Generated on May 09, 2026 02:48");
    const newer = parseGeneratedAt("Generated on May 09, 2026 03:31");
    expect(older).not.toBeNull();
    expect(newer).not.toBeNull();
    expect(newer!).toBeGreaterThan(older!);
  });
});
