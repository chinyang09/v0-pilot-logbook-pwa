/**
 * The bounded pool both enrichment chains end in.
 *
 * The chains used to fire `Promise.allSettled(remaining.map(...))` — every
 * unresolved registration or airport code at once. Fine for one roster's worth;
 * for a career's logbook it is hundreds of simultaneous requests through a
 * single proxy route, each holding an 8-second timeout.
 */

import { describe, it, expect } from "vitest";
import { pooledForEach } from "../pooled-map";

describe("pooledForEach", () => {
  it("visits every item exactly once", async () => {
    const seen: number[] = [];
    await pooledForEach([1, 2, 3, 4, 5, 6, 7], async (n) => {
      seen.push(n);
    });
    expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("never exceeds the pool width", async () => {
    let inFlight = 0;
    let peak = 0;
    const items = Array.from({ length: 30 }, (_, i) => i);

    await pooledForEach(
      items,
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
      },
      4
    );

    expect(peak).toBeLessThanOrEqual(4);
    expect(inFlight).toBe(0);
  });

  it("keeps going when one job throws", async () => {
    // The enrichers record their own failures; a throw must not cost the pool
    // the rest of the batch.
    const done: number[] = [];
    await pooledForEach(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw new Error("network");
        done.push(n);
      },
      2
    );
    expect(done.sort()).toEqual([1, 3, 4]);
  });

  it("resolves immediately for an empty list", async () => {
    let called = false;
    await pooledForEach([], async () => {
      called = true;
    });
    expect(called).toBe(false);
  });

  it("does not spawn more workers than there are items", async () => {
    let starts = 0;
    await pooledForEach(
      [1, 2],
      async () => {
        starts++;
      },
      10
    );
    expect(starts).toBe(2);
  });

  it("treats a pool size below one as one", async () => {
    let peak = 0;
    let inFlight = 0;
    await pooledForEach(
      [1, 2, 3],
      async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await Promise.resolve();
        inFlight--;
      },
      0
    );
    expect(peak).toBe(1);
  });
});
