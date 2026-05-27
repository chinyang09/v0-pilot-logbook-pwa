/**
 * Tests for the concise day/night reclassification remark.
 */

import { describe, it, expect } from "vitest";
import {
  DAY_NIGHT_MARKER,
  buildDayNightRemark,
  appendDayNightRemark,
  hasDayNightRemark,
} from "../day-night-remark";

describe("buildDayNightRemark", () => {
  it("returns null when no suggestion is present", () => {
    expect(
      buildDayNightRemark({ dayLandings: 1, nightLandings: 0 })
    ).toBeNull();
  });

  it("describes a landing reclassified night→day", () => {
    expect(
      buildDayNightRemark({
        dayLandings: 0,
        nightLandings: 1,
        suggestedDayLandings: 1,
        suggestedNightLandings: 0,
      })
    ).toBe("[d/n] LDG night→day");
  });

  it("describes a takeoff reclassified day→night", () => {
    expect(
      buildDayNightRemark({
        dayTakeoffs: 1,
        nightTakeoffs: 0,
        suggestedDayTakeoffs: 0,
        suggestedNightTakeoffs: 1,
      })
    ).toBe("[d/n] T/O day→night");
  });

  it("combines takeoff + landing reclassifications", () => {
    expect(
      buildDayNightRemark({
        dayTakeoffs: 1,
        nightTakeoffs: 0,
        dayLandings: 0,
        nightLandings: 1,
        suggestedDayTakeoffs: 0,
        suggestedNightTakeoffs: 1,
        suggestedDayLandings: 1,
        suggestedNightLandings: 0,
      })
    ).toBe("[d/n] T/O day→night, LDG night→day");
  });

  it("returns null when a suggestion exists but the bucket does not flip", () => {
    expect(
      buildDayNightRemark({
        nightLandings: 1,
        suggestedDayLandings: 0,
        suggestedNightLandings: 1,
      })
    ).toBeNull();
  });
});

describe("appendDayNightRemark", () => {
  it("returns base unchanged for a null line", () => {
    expect(appendDayNightRemark("note", null)).toBe("note");
  });

  it("uses the line alone when base is empty", () => {
    expect(appendDayNightRemark("", `${DAY_NIGHT_MARKER} LDG night→day`)).toBe(
      `${DAY_NIGHT_MARKER} LDG night→day`
    );
  });

  it("appends on a new line when base has content", () => {
    expect(
      appendDayNightRemark("pilot note", `${DAY_NIGHT_MARKER} LDG night→day`)
    ).toBe(`pilot note\n${DAY_NIGHT_MARKER} LDG night→day`);
  });

  it("does not duplicate when a day/night marker is already present", () => {
    const base = `prior\n${DAY_NIGHT_MARKER} T/O day→night`;
    expect(appendDayNightRemark(base, `${DAY_NIGHT_MARKER} LDG night→day`)).toBe(
      base
    );
  });

  it("treats the legacy marker as already-decided", () => {
    const base = "note\n[TO/LDG decision recorded] 2026-04-15";
    expect(appendDayNightRemark(base, `${DAY_NIGHT_MARKER} LDG night→day`)).toBe(
      base
    );
  });
});

describe("hasDayNightRemark", () => {
  it("detects the new marker", () => {
    expect(hasDayNightRemark(`${DAY_NIGHT_MARKER} LDG night→day`)).toBe(true);
  });
  it("detects the legacy marker", () => {
    expect(hasDayNightRemark("x [TO/LDG decision recorded] y")).toBe(true);
  });
  it("is false for unrelated or empty remarks", () => {
    expect(hasDayNightRemark("just a note")).toBe(false);
    expect(hasDayNightRemark("")).toBe(false);
    expect(hasDayNightRemark(undefined)).toBe(false);
  });
});
