/**
 * The list order.
 *
 * Two reported symptoms, both the same root cause — the order wasn't a TOTAL
 * order, so rows moved on their own:
 *
 * - a newly created flight sat at the top of the logbook whatever its date,
 *   then jumped into place the next time the list refetched;
 * - on a day with both, completed flights floated above scheduled ones
 *   regardless of departure time, because the old comparator read `outTime`
 *   only and treated an unflown sector as 00:00.
 *
 * So the tests care less about any single pairing than about the order being
 * fully determined by the data: the same flights must always produce the same
 * list, whatever order they arrive in.
 */

import { describe, it, expect } from "vitest";
import {
  compareFlights,
  effectiveOutTime,
  insertFlightSorted,
  sortFlights,
} from "../flight-sort";
import type { FlightLog } from "@/types/entities/flight.types";

function flight(p: Partial<FlightLog> & { id: string; date: string }): FlightLog {
  return {
    outTime: "",
    scheduledOut: "",
    departureIcao: "",
    departureIata: "",
    ...p,
  } as FlightLog;
}

const ids = (list: Array<{ id: string }>) => list.map((f) => f.id);

describe("date", () => {
  it("puts the newest day first", () => {
    const list = sortFlights([
      flight({ id: "jul30", date: "2026-07-30" }),
      flight({ id: "aug01", date: "2026-08-01" }),
      flight({ id: "jul31", date: "2026-07-31" }),
    ]);
    expect(ids(list)).toEqual(["aug01", "jul31", "jul30"]);
  });
});

describe("departure time within a day", () => {
  it("puts the latest departure first", () => {
    const list = sortFlights([
      flight({ id: "early", date: "2026-07-30", outTime: "06:55" }),
      flight({ id: "late", date: "2026-07-30", outTime: "11:58" }),
    ]);
    expect(ids(list)).toEqual(["late", "early"]);
  });

  it("uses the SCHEDULED time when the flight hasn't been flown yet", () => {
    // The reported bug: with `outTime` empty this sector used to count as
    // 00:00 and sink below every completed flight on the day, however late it
    // was actually due to depart.
    const list = sortFlights([
      flight({ id: "flown-early", date: "2026-08-01", outTime: "00:40" }),
      flight({ id: "scheduled-late", date: "2026-08-01", scheduledOut: "03:05" }),
    ]);
    expect(ids(list)).toEqual(["scheduled-late", "flown-early"]);
  });

  it("prefers the actual time over the scheduled one", () => {
    expect(
      effectiveOutTime({ outTime: "02:15", scheduledOut: "01:00" })
    ).toBe("02:15");
    expect(effectiveOutTime({ outTime: "", scheduledOut: "01:00" })).toBe("01:00");
    expect(effectiveOutTime({ outTime: "", scheduledOut: "" })).toBe("");
  });

  it("sends a flight with no time at all to the end of its day", () => {
    const list = sortFlights([
      flight({ id: "untimed", date: "2026-07-31" }),
      flight({ id: "timed", date: "2026-07-31", scheduledOut: "00:05" }),
    ]);
    expect(ids(list)).toEqual(["timed", "untimed"]);
  });
});

describe("tiebreaks", () => {
  it("orders two same-minute departures by departure airport", () => {
    const list = sortFlights([
      flight({ id: "wsss", date: "2026-07-30", outTime: "09:00", departureIcao: "WSSS" }),
      flight({ id: "rpll", date: "2026-07-30", outTime: "09:00", departureIcao: "RPLL" }),
    ]);
    expect(ids(list)).toEqual(["rpll", "wsss"]);
  });

  it("falls back to IATA when there is no ICAO", () => {
    const list = sortFlights([
      flight({ id: "sin", date: "2026-07-30", outTime: "09:00", departureIata: "SIN" }),
      flight({ id: "mnl", date: "2026-07-30", outTime: "09:00", departureIata: "MNL" }),
    ]);
    expect(ids(list)).toEqual(["mnl", "sin"]);
  });

  it("is a TOTAL order — identical flights still order the same way every time", () => {
    const a = flight({ id: "aaa", date: "2026-07-30", outTime: "09:00", departureIcao: "WSSS" });
    const b = flight({ id: "bbb", date: "2026-07-30", outTime: "09:00", departureIcao: "WSSS" });
    expect(ids(sortFlights([a, b]))).toEqual(["aaa", "bbb"]);
    expect(ids(sortFlights([b, a]))).toEqual(["aaa", "bbb"]);
    expect(compareFlights(a, b)).not.toBe(0);
  });

  it("gives the same list whatever order the flights arrive in", () => {
    const all = [
      flight({ id: "a", date: "2026-08-01", scheduledOut: "03:05", departureIcao: "WMKP" }),
      flight({ id: "b", date: "2026-08-01", scheduledOut: "00:40", departureIcao: "WSSS" }),
      flight({ id: "c", date: "2026-07-31" }),
      flight({ id: "d", date: "2026-07-30", outTime: "11:58", departureIcao: "RPLL" }),
      flight({ id: "e", date: "2026-07-30", outTime: "06:55", departureIcao: "WSSS" }),
    ];
    const expected = ids(sortFlights(all));
    expect(expected).toEqual(["a", "b", "c", "d", "e"]);
    // Every rotation and the reverse must land on the same list.
    for (let i = 0; i < all.length; i++) {
      const rotated = [...all.slice(i), ...all.slice(0, i)];
      expect(ids(sortFlights(rotated))).toEqual(expected);
      expect(ids(sortFlights([...rotated].reverse()))).toEqual(expected);
    }
  });
});

describe("insertFlightSorted", () => {
  const existing = [
    flight({ id: "aug01", date: "2026-08-01", scheduledOut: "00:40" }),
    flight({ id: "jul30-late", date: "2026-07-30", outTime: "11:58" }),
    flight({ id: "jul30-early", date: "2026-07-30", outTime: "06:55" }),
  ];

  it("puts a new flight at its date, not at the top", () => {
    // This is the row that was seen jumping: created today, prepended, then
    // snapped down to 31 Jul when the list refetched.
    const list = insertFlightSorted(existing, flight({ id: "new", date: "2026-07-31" }));
    expect(ids(list)).toEqual(["aug01", "new", "jul30-late", "jul30-early"]);
  });

  it("places it within its day too", () => {
    const list = insertFlightSorted(
      existing,
      flight({ id: "new", date: "2026-07-30", outTime: "09:00" })
    );
    expect(ids(list)).toEqual(["aug01", "jul30-late", "new", "jul30-early"]);
  });

  it("appends when it is the oldest", () => {
    const list = insertFlightSorted(existing, flight({ id: "old", date: "2020-01-01" }));
    expect(ids(list).at(-1)).toBe("old");
  });

  it("lands where a full re-sort would put it", () => {
    const incoming = flight({ id: "new", date: "2026-07-31", scheduledOut: "12:00" });
    expect(ids(insertFlightSorted(existing, incoming))).toEqual(
      ids(sortFlights([...existing, incoming]))
    );
  });

  it("replaces rather than duplicates a flight already in the list", () => {
    const updated = flight({ id: "jul30-early", date: "2026-07-30", outTime: "23:00" });
    const list = insertFlightSorted(existing, updated);
    expect(ids(list)).toEqual(["aug01", "jul30-early", "jul30-late"]);
    expect(list.filter((f) => f.id === "jul30-early")).toHaveLength(1);
  });

  it("does not mutate the list it was given", () => {
    const before = ids(existing);
    insertFlightSorted(existing, flight({ id: "new", date: "2026-07-31" }));
    expect(ids(existing)).toEqual(before);
  });
});
