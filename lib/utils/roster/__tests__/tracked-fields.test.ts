/**
 * The split between what the company owns and what the pilot owns.
 *
 * Company OOOI times are the record of when the aircraft moved, so a report
 * that disagrees applies without asking. PF/PM and the day/night split are the
 * pilot's own account, so they are consulted AND kept on the record as a
 * comparison for licence purposes.
 */

import { describe, it, expect } from "vitest";
import { TRACKED_FIELDS, isSafeChange, classifyChanges } from "../classification";
import type { FlightLog } from "../../../../types/entities/flight.types";
import type { FieldDiff } from "../reconciler";

const flight = { date: "2026-04-02", manualOverrides: {} } as FlightLog;
const today = "2026-05-01";

describe("company-owned times", () => {
  const timeFields = [
    "outTime",
    "offTime",
    "onTime",
    "inTime",
    "scheduledOut",
    "scheduledIn",
    "blockTime",
    "flightTime",
  ];

  it.each(timeFields)("applies a %s change without asking", (field) => {
    expect(isSafeChange({ field, from: "04:00", to: "04:49" }, flight)).toBe(
      true
    );
  });

  it("is not tracked as a licence comparison", () => {
    for (const field of timeFields) {
      expect(TRACKED_FIELDS.has(field)).toBe(false);
    }
  });
});

describe("pilot-owned fields", () => {
  const pilotFields = [
    "pilotFlying",
    "pilotRole",
    "dayTakeoffs",
    "nightTakeoffs",
    "dayLandings",
    "nightLandings",
  ];

  it.each(pilotFields)("consults the user on a %s change", (field) => {
    expect(isSafeChange({ field, from: "1", to: "0" }, flight)).toBe(false);
  });

  it.each(pilotFields)("keeps %s on the record as a comparison", (field) => {
    expect(TRACKED_FIELDS.has(field)).toBe(true);
  });
});

describe("classifyChanges", () => {
  it("auto-applies a report that only corrects the times", () => {
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
      { field: "inTime", from: "07:00", to: "07:22" },
      { field: "blockTime", from: "03:00", to: "02:33" },
    ];
    expect(classifyChanges(flight, changes, [], today)).toBe("update_safe");
  });

  it("still consults when a pilot-owned field is in the same batch", () => {
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
      { field: "pilotFlying", from: "true", to: "false" },
    ];
    expect(classifyChanges(flight, changes, [], today)).toBe("update_consult");
  });

  it("protects the user's own edits regardless of which fields changed", () => {
    const changes: FieldDiff[] = [
      { field: "outTime", from: "04:00", to: "04:49" },
    ];
    expect(classifyChanges(flight, changes, ["has_signature"], today)).toBe(
      "edited_conflict"
    );
  });
});
