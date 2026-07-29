/**
 * The 90-day undo window.
 *
 * The whole promise of the window is that the countdown the user is shown is
 * the countdown that actually runs — a card reading "1 day left" must still be
 * revertible, and one reading "Expired" must be the one the sweep takes. So the
 * boundary is pinned in both directions.
 */

import { describe, it, expect } from "vitest";
import {
  RETENTION_MS,
  isWithinRetention,
  retentionDaysLeft,
  retentionExpiresAt,
  retentionLabel,
} from "../retention";

const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.parse("2026-01-01T00:00:00Z");

describe("RETENTION_MS", () => {
  it("is 90 days", () => {
    expect(RETENTION_MS).toBe(90 * DAY);
  });
});

describe("isWithinRetention", () => {
  it("holds for the whole window and lets go the instant it closes", () => {
    expect(isWithinRetention(T0, T0)).toBe(true);
    expect(isWithinRetention(T0, T0 + RETENTION_MS - 1)).toBe(true);
    expect(isWithinRetention(T0, T0 + RETENTION_MS)).toBe(false);
    expect(isWithinRetention(T0, T0 + RETENTION_MS + DAY)).toBe(false);
  });

  it("treats a missing timestamp as nothing to retain", () => {
    // A comparison the user never accepted has no clock — it is a standing
    // difference, kept for as long as it stands.
    expect(isWithinRetention(undefined, T0)).toBe(false);
  });
});

describe("retentionDaysLeft", () => {
  it("counts down from 90", () => {
    expect(retentionDaysLeft(T0, T0)).toBe(90);
    expect(retentionDaysLeft(T0, T0 + 30 * DAY)).toBe(60);
  });

  it("rounds a part-day up, so the last day never reads as none left", () => {
    expect(retentionDaysLeft(T0, T0 + 89 * DAY)).toBe(1);
    expect(retentionDaysLeft(T0, T0 + 89.5 * DAY)).toBe(1);
    expect(retentionDaysLeft(T0, T0 + RETENTION_MS - 1)).toBe(1);
  });

  it("reaches zero exactly when the row stops being revertible", () => {
    expect(retentionDaysLeft(T0, T0 + RETENTION_MS)).toBe(0);
    expect(isWithinRetention(T0, T0 + RETENTION_MS)).toBe(false);
  });

  it("floors at zero rather than going negative", () => {
    expect(retentionDaysLeft(T0, T0 + 200 * DAY)).toBe(0);
  });
});

describe("retentionLabel", () => {
  it("reads naturally at each end", () => {
    expect(retentionLabel(T0, T0)).toBe("90 days left");
    expect(retentionLabel(T0, T0 + 89 * DAY)).toBe("1 day left");
    expect(retentionLabel(T0, T0 + RETENTION_MS)).toBe("Expired");
  });
});

describe("retentionExpiresAt", () => {
  it("is the moment the window closes", () => {
    const at = retentionExpiresAt(T0);
    expect(isWithinRetention(T0, at - 1)).toBe(true);
    expect(isWithinRetention(T0, at)).toBe(false);
  });
});
