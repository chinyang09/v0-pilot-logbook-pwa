/**
 * Tests for the import decision memory + its retention window.
 */

import { describe, it, expect } from "vitest";
import {
  IMPORT_DECISION_RETENTION_MS,
  clearDecisions,
  liveDecisions,
  mergeDecisions,
} from "../import-decisions";

const NOW = 1_800_000_000_000;
const EXPIRED = NOW - (IMPORT_DECISION_RETENTION_MS + 1);

describe("liveDecisions", () => {
  it("drops entries past the retention window", () => {
    const live = liveDecisions(
      {
        importDecisions: {
          remarks: { declined: "theirs", at: EXPIRED },
          scheduledOut: { declined: "03:50", at: NOW - 1000 },
        },
      },
      NOW
    );
    expect(live).toEqual({ scheduledOut: { declined: "03:50", at: NOW - 1000 } });
  });

  it("returns undefined when everything has expired", () => {
    expect(
      liveDecisions({ importDecisions: { a: { declined: "x", at: EXPIRED } } }, NOW)
    ).toBeUndefined();
  });
});

describe("mergeDecisions", () => {
  it("records a decline and prunes expired entries in the same pass", () => {
    const next = mergeDecisions(
      { importDecisions: { old: { declined: "gone", at: EXPIRED } } },
      [{ field: "scheduledOut", declined: "03:50" }],
      NOW
    );
    expect(next).toEqual({ scheduledOut: { declined: "03:50", at: NOW } });
  });

  it("keeps both directions for one field", () => {
    const next = mergeDecisions(
      { importDecisions: { remarks: { declined: "theirs", at: NOW - 5 } } },
      [{ field: "remarks", replaced: "mine" }],
      NOW
    );
    expect(next).toEqual({
      remarks: { declined: "theirs", replaced: "mine", at: NOW },
    });
  });

  it("refreshes the timestamp when the same decision is made again", () => {
    const next = mergeDecisions(
      { importDecisions: { a: { declined: "x", at: NOW - 100_000 } } },
      [{ field: "a", declined: "x" }],
      NOW
    );
    expect(next).toEqual({ a: { declined: "x", at: NOW } });
  });

  it("returns null when there is nothing to write", () => {
    expect(mergeDecisions({ importDecisions: undefined }, [], NOW)).toBeNull();
  });
});

describe("clearDecisions", () => {
  it("removes the named fields and keeps the rest", () => {
    const next = clearDecisions(
      {
        importDecisions: {
          a: { declined: "x", at: NOW },
          b: { replaced: "y", at: NOW },
        },
      },
      ["a"],
      NOW
    );
    expect(next).toEqual({ b: { replaced: "y", at: NOW } });
  });

  it("returns null when the flight has no memory", () => {
    expect(clearDecisions({ importDecisions: undefined }, ["a"], NOW)).toBeNull();
  });
});
