/**
 * The window an import is allowed to MATCH existing flights in.
 *
 * The case this exists for is real and reproduces on every upload: eCrew's
 * "Personal Crew Schedule Report 01/01/2026 - 31/01/2026" carries a row dated
 * **01/02/2026** — TR135 XIY→SIN, the return leg of a duty that started on the
 * 31st, included so the pairing isn't cut in half.
 *
 * The caller filtered the candidate flights to the header's stated range, so
 * the existing 1 February flight was never in the pool. The reconciler saw a
 * sector with nothing to match and emitted `create`, which is auto-accepted —
 * so re-importing the same report added another copy of the same flight every
 * time.
 */

import { describe, it, expect } from "vitest";
import {
  flightMatchWindow,
  inWindow,
  sectorDates,
} from "../flight-window";

/** The header line of the report that produced the duplicates. */
const JANUARY = { start: "2026-01-01", end: "2026-01-31" };

describe("flightMatchWindow", () => {
  it("covers a sector that spills past the report's stated end", () => {
    // TR134 departs 31 Jan; TR135 comes back on 1 Feb.
    const window = flightMatchWindow(JANUARY, [
      "2026-01-31",
      "2026-02-01",
    ]);
    expect(window).toEqual({ start: "2026-01-01", end: "2026-02-01" });

    // …which is what puts the existing 1 Feb flight back in the pool.
    expect(inWindow("2026-02-01", window)).toBe(true);
  });

  it("covers a sector that starts before the stated range", () => {
    // The mirror case: a duty that began the evening before the range opens.
    const window = flightMatchWindow(JANUARY, ["2025-12-31", "2026-01-02"]);
    expect(window.start).toBe("2025-12-31");
    expect(window.end).toBe("2026-01-31");
  });

  it("leaves the range alone when every sector falls inside it", () => {
    expect(
      flightMatchWindow(JANUARY, ["2026-01-05", "2026-01-20"])
    ).toEqual(JANUARY);
  });

  it("falls back to the sectors when there is no header range", () => {
    // An empty start compares as "less than every date", so an absent range
    // silently means "everything". Deriving the span from the sectors makes
    // that a decision rather than a side effect of string comparison.
    const window = flightMatchWindow(
      { start: "", end: "" },
      ["2026-03-04", "2026-03-01", "2026-03-09"]
    );
    expect(window).toEqual({ start: "2026-03-01", end: "2026-03-09" });
  });

  it("matches everything when there is neither a range nor a sector", () => {
    const window = flightMatchWindow({ start: "", end: "" }, []);
    expect(inWindow("1999-01-01", window)).toBe(true);
    expect(inWindow("2099-12-31", window)).toBe(true);
  });

  it("ignores a sector with no date", () => {
    expect(flightMatchWindow(JANUARY, ["", "2026-01-10", ""])).toEqual(JANUARY);
  });
});

describe("inWindow", () => {
  it("is inclusive at both ends", () => {
    expect(inWindow("2026-01-01", JANUARY)).toBe(true);
    expect(inWindow("2026-01-31", JANUARY)).toBe(true);
  });

  it("excludes either side", () => {
    expect(inWindow("2025-12-31", JANUARY)).toBe(false);
    // The 1 Feb flight, against the STATED range — which is exactly why the
    // reconciler is still handed `csvDateRange` for its delete pass. A report
    // is authoritative for the window it names, and merely present outside it,
    // so a spilled sector must not turn unrelated February flights into
    // deletion proposals.
    expect(inWindow("2026-02-01", JANUARY)).toBe(false);
  });
});

describe("sectorDates", () => {
  it("collects the dates and drops the blanks", () => {
    expect(
      sectorDates([
        { date: "2026-01-31" },
        { date: "" },
        { date: "2026-02-01" },
      ])
    ).toEqual(["2026-01-31", "2026-02-01"]);
  });
});
