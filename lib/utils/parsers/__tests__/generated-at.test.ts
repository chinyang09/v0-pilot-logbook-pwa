/**
 * Tests for the "Generated on..." footer parser.
 */

import { describe, it, expect } from "vitest";
import { parseGeneratedAt } from "../shared/generated-at";

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
