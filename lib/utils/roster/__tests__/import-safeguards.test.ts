/**
 * Safeguards against anomalies an import used to swallow silently.
 *
 * The common shape of every bug behind these tests is the same: an assumption
 * about a well-formed report that, when broken, produced a WRONG WRITE rather
 * than a complaint — and produced it as a `create` or an `update_safe`, both of
 * which apply without the user ever seeing them.
 */

import { describe, it, expect } from "vitest";
import { dedupeSectors, type ParsedSector } from "../reconciler";
import { applyDefaultAcceptance } from "../plan-summary";

function sector(overrides: Partial<ParsedSector> = {}): ParsedSector {
  return {
    date: "2026-01-22",
    flightNumber: "TR474",
    aircraftType: "32N",
    departureIata: "SIN",
    arrivalIata: "SZB",
    scheduledOut: "03:50",
    scheduledIn: "05:10",
    actualOut: "04:12",
    actualIn: "05:22",
    sourceLine: 29,
    ...overrides,
  };
}

describe("dedupeSectors", () => {
  it("drops a row the extractor emitted twice", () => {
    // A PDF page break can repeat a table row. The first copy pairs with the
    // stored flight; the second finds it claimed, falls through to `create`,
    // and is auto-accepted — a duplicate of the flight matched a line earlier.
    const rows = [sector(), sector({ sourceLine: 31 })];
    expect(dedupeSectors(rows)).toHaveLength(1);
    expect(dedupeSectors(rows)[0].sourceLine).toBe(29);
  });

  it("keeps both legs of a repeated route on one day", () => {
    // The thing dedupe must NOT break: SIN→PEN→SIN→PEN is four real legs, told
    // apart by their times.
    const rows = [
      sector({ actualOut: "04:12" }),
      sector({ actualOut: "09:12" }),
    ];
    expect(dedupeSectors(rows)).toHaveLength(2);
  });

  it("keeps two sectors that differ only by date", () => {
    const rows = [sector(), sector({ date: "2026-01-23" })];
    expect(dedupeSectors(rows)).toHaveLength(2);
  });

  it("keeps two sectors that differ only by route", () => {
    const rows = [sector(), sector({ arrivalIata: "KUL" })];
    expect(dedupeSectors(rows)).toHaveLength(2);
  });

  it("treats TR474 and 474 as the same leg", () => {
    // The reports write the number both ways; `matchTier` normalises it, so
    // dedupe has to as well or the two forms read as different flights.
    const rows = [sector({ flightNumber: "TR474" }), sector({ flightNumber: "474" })];
    expect(dedupeSectors(rows)).toHaveLength(1);
  });

  it("leaves an empty list alone", () => {
    expect(dedupeSectors([])).toEqual([]);
  });
});

describe("applyDefaultAcceptance — uncertain times are never auto-applied", () => {
  it("auto-accepts an ordinary safe update", () => {
    const [op] = applyDefaultAcceptance([
      { kind: "update_safe", flight: {} as never, sector: sector(), changes: [] },
    ]);
    expect(op.accepted).toBe(true);
  });

  it("withholds acceptance when the sector's times could not be converted", () => {
    // A Local Station report naming an airport nothing could resolve falls
    // back to offset zero, so the times may be a whole timezone out. Applied
    // as `update_safe` that is a silent, hours-wide rewrite of a flight the
    // pilot already flew.
    const [op] = applyDefaultAcceptance([
      {
        kind: "update_safe",
        flight: {} as never,
        sector: sector({ timesUncertain: true }),
        changes: [],
      },
    ]);
    expect(op.accepted).toBe(false);
  });

  it("withholds acceptance on a create built from uncertain times too", () => {
    const [op] = applyDefaultAcceptance([
      { kind: "create", sector: sector({ timesUncertain: true }) },
    ]);
    expect(op.accepted).toBe(false);
  });

  it("still auto-accepts ops that carry no sector at all", () => {
    // `skip_non_airline` has a flight and no sector — the guard must not throw
    // or flip it.
    const [op] = applyDefaultAcceptance([
      { kind: "skip_non_airline", flight: {} as never },
    ]);
    expect(op.accepted).toBe(true);
  });
});
