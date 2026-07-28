/**
 * An armed action has to outlive the row that armed it.
 *
 * The countdown used to live inside the swipe card, so two ordinary things
 * cancelled it silently: tapping anywhere else, and scrolling far enough for a
 * virtualised list to recycle the row. Both left the user believing the delete
 * had gone through. The timer lives in this registry instead.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  armPendingAction,
  cancelPendingAction,
  getPendingDeadline,
  subscribePendingActions,
} from "../pending-actions";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("armPendingAction", () => {
  it("fires after the delay", () => {
    const run = vi.fn();
    armPendingAction("row-1", 10_000, run);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(9_999);
    expect(run).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("keeps running independently of any component — nothing else can stop it", () => {
    const run = vi.fn();
    armPendingAction("row-1", 10_000, run);
    // Whatever the UI does in the meantime (unmount, re-render, other taps),
    // only an explicit cancel reaches the registry.
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("runs several at once, each on its own clock", () => {
    const a = vi.fn();
    const b = vi.fn();
    armPendingAction("row-a", 10_000, a);
    vi.advanceTimersByTime(4_000);
    armPendingAction("row-b", 10_000, b);

    vi.advanceTimersByTime(6_000); // a's deadline
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();

    vi.advanceTimersByTime(4_000); // b's deadline
    expect(b).toHaveBeenCalledTimes(1);
  });

  it("replaces an existing arm for the same key rather than double-firing", () => {
    const first = vi.fn();
    const second = vi.fn();
    armPendingAction("row-1", 10_000, first);
    armPendingAction("row-1", 10_000, second);
    vi.advanceTimersByTime(10_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("cancelPendingAction", () => {
  it("stops the action", () => {
    const run = vi.fn();
    armPendingAction("row-1", 10_000, run);
    expect(cancelPendingAction("row-1")).toBe(true);
    vi.advanceTimersByTime(20_000);
    expect(run).not.toHaveBeenCalled();
  });

  it("reports when there was nothing to cancel", () => {
    expect(cancelPendingAction("never-armed")).toBe(false);
  });

  it("cancels only the key given", () => {
    const a = vi.fn();
    const b = vi.fn();
    armPendingAction("row-a", 10_000, a);
    armPendingAction("row-b", 10_000, b);
    cancelPendingAction("row-a");
    vi.advanceTimersByTime(10_000);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });
});

describe("getPendingDeadline", () => {
  it("reports the deadline so a remounted row resumes mid-countdown", () => {
    vi.setSystemTime(new Date("2026-07-28T00:00:00Z"));
    armPendingAction("row-1", 10_000, vi.fn());
    expect(getPendingDeadline("row-1")).toBe(
      Date.parse("2026-07-28T00:00:10Z")
    );
  });

  it("is undefined once fired", () => {
    armPendingAction("row-1", 10_000, vi.fn());
    vi.advanceTimersByTime(10_000);
    expect(getPendingDeadline("row-1")).toBeUndefined();
  });

  it("is undefined once cancelled", () => {
    armPendingAction("row-1", 10_000, vi.fn());
    cancelPendingAction("row-1");
    expect(getPendingDeadline("row-1")).toBeUndefined();
  });
});

describe("subscribePendingActions", () => {
  it("notifies on arm, cancel and fire", () => {
    const listener = vi.fn();
    const unsubscribe = subscribePendingActions(listener);

    armPendingAction("row-1", 10_000, vi.fn());
    expect(listener).toHaveBeenCalledTimes(1);

    cancelPendingAction("row-1");
    expect(listener).toHaveBeenCalledTimes(2);

    armPendingAction("row-2", 10_000, vi.fn());
    vi.advanceTimersByTime(10_000);
    expect(listener).toHaveBeenCalledTimes(4); // arm + fire

    unsubscribe();
    armPendingAction("row-3", 10_000, vi.fn());
    expect(listener).toHaveBeenCalledTimes(4);
  });
});
