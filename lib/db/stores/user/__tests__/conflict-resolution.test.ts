/**
 * Tests for deterministic last-write-wins conflict resolution.
 *
 * The sync engine resolves conflicts by (updatedAt, deviceId) so two concurrent
 * edits with the same timestamp resolve identically on every device — never
 * "whoever the server saw last" or "server always wins".
 */

import { describe, it, expect } from "vitest";
import { compareAuthorship, type SyncableEntity } from "../crud-helpers";

function rec(p: Partial<SyncableEntity>): SyncableEntity {
  return { id: "x", createdAt: 0, ...p };
}

describe("compareAuthorship", () => {
  it("prefers the higher updatedAt", () => {
    const newer = rec({ updatedAt: 200, deviceId: "a" });
    const older = rec({ updatedAt: 100, deviceId: "z" });
    expect(compareAuthorship(newer, older)).toBeGreaterThan(0);
    expect(compareAuthorship(older, newer)).toBeLessThan(0);
  });

  it("breaks updatedAt ties deterministically by deviceId", () => {
    const a = rec({ updatedAt: 100, deviceId: "device-a" });
    const b = rec({ updatedAt: 100, deviceId: "device-b" });
    // device-b > device-a lexicographically → b wins, on BOTH devices.
    expect(compareAuthorship(b, a)).toBeGreaterThan(0);
    expect(compareAuthorship(a, b)).toBeLessThan(0);
    // Symmetric and stable regardless of argument order.
    expect(Math.sign(compareAuthorship(a, b))).toBe(-Math.sign(compareAuthorship(b, a)));
  });

  it("returns 0 for identical authorship (idempotent re-apply)", () => {
    const a = rec({ updatedAt: 100, deviceId: "same" });
    const b = rec({ updatedAt: 100, deviceId: "same" });
    expect(compareAuthorship(a, b)).toBe(0);
  });

  it("falls back to createdAt when updatedAt is absent", () => {
    const created = rec({ createdAt: 50 });
    const edited = rec({ createdAt: 10, updatedAt: 80 });
    expect(compareAuthorship(edited, created)).toBeGreaterThan(0);
    const olderCreate = rec({ createdAt: 10 });
    expect(compareAuthorship(created, olderCreate)).toBeGreaterThan(0);
  });

  it("does not let an older server record beat a newer local pending edit", () => {
    // server record (older) vs local unsynced edit (newer updatedAt)
    const serverRecord = rec({ updatedAt: 100, deviceId: "server-origin" });
    const localPendingEdit = rec({ updatedAt: 250, deviceId: "this-device" });
    // upsertFromServer applies the server record only when compare >= 0;
    // here it is < 0, so the local pending edit is preserved.
    expect(compareAuthorship(serverRecord, localPendingEdit)).toBeLessThan(0);
  });

  it("treats a missing deviceId as the lowest tiebreaker", () => {
    const withId = rec({ updatedAt: 100, deviceId: "a" });
    const withoutId = rec({ updatedAt: 100 });
    expect(compareAuthorship(withId, withoutId)).toBeGreaterThan(0);
  });
});
