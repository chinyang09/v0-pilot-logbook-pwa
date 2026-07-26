/**
 * PF/PM ↔ pilot-role consistency. PICUS only makes sense while flying, so a
 * switch to Pilot Monitoring must move the role with it.
 */

import { describe, it, expect } from "vitest";
import {
  reconcilePilotRole,
  allowedRolesFor,
  isRoleConsistent,
} from "../pilot-role";

describe("reconcilePilotRole", () => {
  it("drops PICUS when the leg becomes Pilot Monitoring", () => {
    expect(
      reconcilePilotRole({
        currentRole: "PICUS",
        pilotFlying: false,
        nonPicPfRole: "PICUS",
      })
    ).toBe("SIC");
  });

  it("promotes SIC to the user's convention when the leg becomes Pilot Flying", () => {
    expect(
      reconcilePilotRole({
        currentRole: "SIC",
        pilotFlying: true,
        nonPicPfRole: "PICUS",
      })
    ).toBe("PICUS");
    // A user who logs such legs as SIC keeps SIC.
    expect(
      reconcilePilotRole({
        currentRole: "SIC",
        pilotFlying: true,
        nonPicPfRole: "SIC",
      })
    ).toBe("SIC");
  });

  it("leaves a captain as PIC whether flying or monitoring", () => {
    for (const pilotFlying of [true, false]) {
      expect(
        reconcilePilotRole({
          currentRole: "PIC",
          pilotFlying,
          nonPicPfRole: "PICUS",
        })
      ).toBe("PIC");
    }
  });

  it("leaves training roles alone — they describe the seat", () => {
    expect(
      reconcilePilotRole({
        currentRole: "Instructor",
        pilotFlying: false,
        nonPicPfRole: "PICUS",
      })
    ).toBe("Instructor");
    expect(
      reconcilePilotRole({
        currentRole: "Dual",
        pilotFlying: true,
        nonPicPfRole: "PICUS",
      })
    ).toBe("Dual");
  });

  it("keeps SIC as SIC when it stays Pilot Monitoring", () => {
    expect(
      reconcilePilotRole({
        currentRole: "SIC",
        pilotFlying: false,
        nonPicPfRole: "PICUS",
      })
    ).toBe("SIC");
  });
});

describe("allowedRolesFor", () => {
  it("withholds PICUS from a monitoring leg", () => {
    expect(allowedRolesFor(false)).not.toContain("PICUS");
    expect(allowedRolesFor(true)).toContain("PICUS");
  });

  it("always offers PIC and SIC", () => {
    for (const pf of [true, false]) {
      expect(allowedRolesFor(pf)).toEqual(expect.arrayContaining(["PIC", "SIC"]));
    }
  });
});

describe("isRoleConsistent", () => {
  it("rejects PM + PICUS", () => {
    expect(isRoleConsistent("PICUS", false)).toBe(false);
    expect(isRoleConsistent("PICUS", true)).toBe(true);
    expect(isRoleConsistent("SIC", false)).toBe(true);
  });
});
