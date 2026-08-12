/**
 * Matching an input registration to the reference table's primary key.
 *
 * The batch lookup is a `bulkGet` on the primary key, which matches exactly.
 * It tries the input as written and a dashless form of it, which covers
 * "input has a dash, stored has none" — and NOT the reverse. The reverse is
 * the common case for a migrated logbook: LogTen Pro holds "9VNCA" while the
 * reference table is keyed "9V-NCA", so every bulk import silently missed and
 * went on to ask the network about an aircraft it already had.
 *
 * "The same tail" is `normalizeRegistration`'s key — uppercase, alphanumerics
 * only — the canonical form shared with the server's dedup key.
 */

import { describe, it, expect } from "vitest";
import { matchRegistrationKeys } from "../aircraft.store";

const STORED = ["9V-NCA", "9V-SKU", "G-EZAB", "N123AB"];

describe("matchRegistrationKeys", () => {
  it("resolves a dashless input to a dashed stored key", () => {
    expect(matchRegistrationKeys(STORED, ["9VNCA"])).toEqual([
      { orig: "9VNCA", key: "9V-NCA" },
    ]);
  });

  it("resolves every punctuation and case permutation to the same key", () => {
    // A LogTen user types a tail however they like; all of these are one tail.
    const inputs = ["9vnca", "9V nca", "9v-NCA", "9V.NCA", "9VNCA"];
    for (const input of inputs) {
      expect(matchRegistrationKeys(STORED, [input])).toEqual([
        { orig: input, key: "9V-NCA" },
      ]);
    }
  });

  it("leaves a registration nothing stores unmatched", () => {
    // Unmatched is the RIGHT answer — it is what sends the tail on to the
    // server and FR24 legs of the chain.
    expect(matchRegistrationKeys(STORED, ["9V-XXX"])).toEqual([]);
  });

  it("matches several inputs in one pass", () => {
    expect(matchRegistrationKeys(STORED, ["9VSKU", "gezab", "9V-XXX"])).toEqual([
      { orig: "9VSKU", key: "9V-SKU" },
      { orig: "gezab", key: "G-EZAB" },
    ]);
  });

  it("is stable when the table holds both spellings of one tail", () => {
    // Shouldn't happen, but a table that grew through several sources can.
    // First key wins, so repeated lookups agree with each other.
    const both = ["9V-NCA", "9VNCA"];
    expect(matchRegistrationKeys(both, ["9vnca"])[0].key).toBe("9V-NCA");
    expect(matchRegistrationKeys([...both].reverse(), ["9vnca"])[0].key).toBe(
      "9VNCA"
    );
  });

  it("ignores a key that normalises to nothing", () => {
    expect(matchRegistrationKeys(["---", ""], ["9VNCA"])).toEqual([]);
  });

  it("handles an empty table and empty input", () => {
    expect(matchRegistrationKeys([], ["9VNCA"])).toEqual([]);
    expect(matchRegistrationKeys(STORED, [])).toEqual([]);
  });
});
