/**
 * Tests for splitFltTimeCell — recovers a PIC name that the PDF renderer
 * merged into the Flt-time column (the "blockTime shows the crew name" bug).
 */

import { describe, it, expect } from "vitest";
import { splitFltTimeCell } from "../logbook-parser-v2";

describe("splitFltTimeCell", () => {
  it("splits a merged 'HH:MM <name>' cell", () => {
    expect(splitFltTimeCell("02:24 Mohamed Azmi Bin Moh")).toEqual({
      blockTime: "02:24",
      bleedName: "Mohamed Azmi Bin Moh",
    });
  });

  it("leaves a clean block-time cell untouched", () => {
    expect(splitFltTimeCell("02:36")).toEqual({
      blockTime: "02:36",
      bleedName: "",
    });
  });

  it("zero-pads a single-digit hour", () => {
    expect(splitFltTimeCell("2:05 Song Jing Hui")).toEqual({
      blockTime: "02:05",
      bleedName: "Song Jing Hui",
    });
  });

  it("handles an empty cell (e.g. simulator rows have no Flt time)", () => {
    expect(splitFltTimeCell("")).toEqual({ blockTime: "", bleedName: "" });
  });

  it("passes through a non-time cell unchanged", () => {
    expect(splitFltTimeCell("SIM")).toEqual({ blockTime: "SIM", bleedName: "" });
  });
});
