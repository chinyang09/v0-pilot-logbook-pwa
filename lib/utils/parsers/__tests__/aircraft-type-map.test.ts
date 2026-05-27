import { describe, it, expect } from "vitest";
import {
  normalizeAircraftType,
  familyOfNormalizedType,
} from "../shared/aircraft-type-map";

describe("normalizeAircraftType", () => {
  it("maps Scoot ecrew codes to ICAO designators", () => {
    expect(normalizeAircraftType("32Q")).toBe("A21N");
    expect(normalizeAircraftType("32N")).toBe("A20N");
    expect(normalizeAircraftType("320")).toBe("A320");
    expect(normalizeAircraftType("318")).toBe("A318");
  });

  it("is case-insensitive", () => {
    expect(normalizeAircraftType("32q")).toBe("A21N");
    expect(normalizeAircraftType("32n")).toBe("A20N");
  });

  it("trims whitespace", () => {
    expect(normalizeAircraftType("  320  ")).toBe("A320");
  });

  it("passes through ICAO designators unchanged", () => {
    expect(normalizeAircraftType("A20N")).toBe("A20N");
    expect(normalizeAircraftType("A21N")).toBe("A21N");
    expect(normalizeAircraftType("A320")).toBe("A320");
    expect(normalizeAircraftType("B738")).toBe("B738");
  });

  it("passes through unknown codes uppercased", () => {
    expect(normalizeAircraftType("foo")).toBe("FOO");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeAircraftType("")).toBe("");
  });
});

describe("familyOfNormalizedType", () => {
  it("collapses A320-family designators", () => {
    expect(familyOfNormalizedType("A320")).toBe("A320FAMILY");
    expect(familyOfNormalizedType("A321")).toBe("A320FAMILY");
    expect(familyOfNormalizedType("A20N")).toBe("A320FAMILY");
    expect(familyOfNormalizedType("A21N")).toBe("A320FAMILY");
  });

  it("returns the type unchanged when no family rule applies", () => {
    expect(familyOfNormalizedType("B738")).toBe("B738");
  });

  it("is empty for empty input", () => {
    expect(familyOfNormalizedType("")).toBe("");
  });
});
