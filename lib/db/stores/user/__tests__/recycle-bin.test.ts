/**
 * The flight recycle bin.
 *
 * A logbook is a legal record, so deleting a flight has to be survivable for a
 * while. The bin is built as a SOFT delete — the row stays with `deletedAt`
 * set — because that is what makes it work across devices: binning and
 * restoring both ride the ordinary update path, and only the final purge
 * writes a tombstone.
 *
 * Three things here are load-bearing and quiet if they break:
 *
 * 1. A binned flight must be invisible to `getAllFlights`, or deleted hours
 *    keep counting.
 * 2. A restore must write `deletedAt: null`, not `undefined`. `/api/sync/bulk`
 *    applies an update as a `$set` of the payload's keys and JSON drops
 *    undefined ones, so an undefined clear would leave the server's stamp in
 *    place and the next pull would drop the flight straight back in the bin.
 * 3. Binning must push an UPDATE and purging a DELETE. Push a delete when the
 *    user only binned it and the server writes a tombstone — the flight is
 *    gone everywhere and the bin has nothing to restore.
 *
 * The Dexie table is faked in memory; `crud-helpers` is the real thing, so the
 * sync-queue traffic asserted below is what would actually be pushed.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { FlightLog } from "@/types/entities/flight.types";
import { RETENTION_MS } from "@/lib/utils/retention";

// ---- in-memory stand-in for the Dexie flights table ------------------------

let rows: FlightLog[] = [];

type Predicate = (f: FlightLog) => boolean;

const flightsTable = {
  get: async (id: string) => rows.find((f) => f.id === id),
  put: async (f: FlightLog) => {
    const i = rows.findIndex((r) => r.id === f.id);
    if (i >= 0) rows[i] = f;
    else rows.push(f);
  },
  delete: async (id: string) => {
    rows = rows.filter((f) => f.id !== id);
  },
  filter: (fn: Predicate) => ({ toArray: async () => rows.filter(fn) }),
  orderBy: (key: keyof FlightLog) => ({
    reverse: () => ({
      toArray: async () =>
        [...rows].sort((a, b) => String(b[key]).localeCompare(String(a[key]))),
    }),
  }),
};

vi.mock("../../../user-db", () => ({
  userDb: {
    get flights() {
      return flightsTable;
    },
  },
}));

const queued: Array<{ type: string; id: string }> = [];
vi.mock("../sync-queue.store", () => ({
  addToSyncQueue: vi.fn(async (type: string, _table: string, data: { id: string }) => {
    queued.push({ type, id: data.id });
  }),
  getDeviceId: vi.fn(async () => "test-device"),
}));

import {
  deleteFlight,
  restoreFlight,
  permanentlyDeleteFlight,
  purgeExpiredDeletedFlights,
  getAllFlights,
  getDeletedFlights,
  isLiveFlight,
} from "../flights.store";

function flight(id: string, date: string, extra: Partial<FlightLog> = {}): FlightLog {
  return {
    id,
    date,
    blockTime: "01:00",
    createdAt: 1,
    syncStatus: "synced",
    ...extra,
  } as FlightLog;
}

beforeEach(() => {
  rows = [
    flight("a", "2026-07-01"),
    flight("b", "2026-07-02"),
    flight("c", "2026-07-03"),
  ];
  queued.length = 0;
});

describe("deleting a flight", () => {
  it("bins it instead of destroying it", async () => {
    expect(await deleteFlight("b")).toBe(true);
    expect(rows.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
    expect(rows.find((f) => f.id === "b")!.deletedAt).toBeTypeOf("number");
  });

  it("pushes an update, not a delete — a tombstone would end the bin", async () => {
    await deleteFlight("b");
    expect(queued).toEqual([{ type: "update", id: "b" }]);
  });

  it("takes it out of the logbook", async () => {
    await deleteFlight("b");
    const live = await getAllFlights();
    expect(live.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("puts it in the bin, most recently deleted first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:00:00Z"));
    await deleteFlight("a");
    vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
    await deleteFlight("c");
    vi.useRealTimers();

    const binned = await getDeletedFlights();
    expect(binned.map((f) => f.id)).toEqual(["c", "a"]);
  });

  it("does not restart the clock when the same flight is deleted again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00Z"));
    await deleteFlight("b");
    const first = rows.find((f) => f.id === "b")!.deletedAt;

    vi.setSystemTime(new Date("2026-08-01T00:00:00Z"));
    await deleteFlight("b");
    vi.useRealTimers();

    expect(rows.find((f) => f.id === "b")!.deletedAt).toBe(first);
  });

  it("reports a flight that isn't there", async () => {
    expect(await deleteFlight("nope")).toBe(false);
  });
});

describe("restoring a flight", () => {
  it("puts it back in the logbook", async () => {
    await deleteFlight("b");
    await restoreFlight("b");
    const live = await getAllFlights();
    expect(live.map((f) => f.id)).toEqual(["c", "b", "a"]);
    expect(await getDeletedFlights()).toHaveLength(0);
  });

  it("clears the stamp with null, so the clear survives the push", async () => {
    await deleteFlight("b");
    await restoreFlight("b");
    const restored = rows.find((f) => f.id === "b")!;
    // Not `undefined`: JSON.stringify would drop the key and the server's
    // $set would leave its own deletedAt in place.
    expect(restored.deletedAt).toBeNull();
    expect(Object.keys(restored)).toContain("deletedAt");
    expect(JSON.parse(JSON.stringify(restored))).toHaveProperty("deletedAt", null);
    expect(isLiveFlight(restored)).toBe(true);
  });

  it("keeps everything else about the flight", async () => {
    rows = [flight("b", "2026-07-02", { remarks: "line check", blockTime: "03:21" })];
    await deleteFlight("b");
    await restoreFlight("b");
    const restored = rows.find((f) => f.id === "b")!;
    expect(restored.remarks).toBe("line check");
    expect(restored.blockTime).toBe("03:21");
  });
});

describe("the retention sweep", () => {
  const T0 = Date.parse("2026-07-01T00:00:00Z");

  beforeEach(() => {
    rows = [
      flight("fresh", "2026-06-01", { deletedAt: T0 }),
      flight("live", "2026-06-02"),
    ];
    queued.length = 0;
  });

  it("leaves a flight alone for the whole window", async () => {
    expect(await purgeExpiredDeletedFlights(T0 + RETENTION_MS - 1)).toBe(0);
    expect(rows.map((f) => f.id).sort()).toEqual(["fresh", "live"]);
  });

  it("destroys it the moment the window closes", async () => {
    expect(await purgeExpiredDeletedFlights(T0 + RETENTION_MS)).toBe(1);
    expect(rows.map((f) => f.id)).toEqual(["live"]);
  });

  it("pushes a real delete, so the removal propagates", async () => {
    await purgeExpiredDeletedFlights(T0 + RETENTION_MS);
    expect(queued).toEqual([{ type: "delete", id: "fresh" }]);
  });

  it("never touches a flight that isn't in the bin", async () => {
    await purgeExpiredDeletedFlights(T0 + 10 * RETENTION_MS);
    expect(rows.map((f) => f.id)).toEqual(["live"]);
  });

  it("leaves a restored flight alone however long ago it was deleted", async () => {
    rows = [flight("restored", "2026-06-01", { deletedAt: null })];
    expect(await purgeExpiredDeletedFlights(T0 + 10 * RETENTION_MS)).toBe(0);
    expect(rows).toHaveLength(1);
  });
});

describe("delete permanently", () => {
  it("skips the bin entirely", async () => {
    expect(await permanentlyDeleteFlight("b")).toBe(true);
    expect(rows.map((f) => f.id).sort()).toEqual(["a", "c"]);
    expect(queued).toEqual([{ type: "delete", id: "b" }]);
  });
});

describe("isLiveFlight", () => {
  it("reads a flight from before the bin existed as live", () => {
    expect(isLiveFlight({})).toBe(true);
  });

  it("covers both ways a stamp can be absent", () => {
    expect(isLiveFlight({ deletedAt: undefined })).toBe(true);
    expect(isLiveFlight({ deletedAt: null })).toBe(true);
    expect(isLiveFlight({ deletedAt: Date.now() })).toBe(false);
  });
});
