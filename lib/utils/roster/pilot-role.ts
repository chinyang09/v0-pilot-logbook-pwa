/**
 * Pilot role ↔ pilot-flying consistency.
 *
 * The two fields are not independent. PICUS ("Pilot In Command Under
 * Supervision") is only meaningful while you are the handling pilot, so a
 * flight cannot be Pilot Monitoring AND PICUS. When an import flips PF/PM the
 * role has to move with it, and which role a non-PIC pilot-flying leg lands on
 * is a personal logging convention — hence the `nonPicPfRole` user setting.
 *
 * A captain's role is left alone: a PIC is still PIC on a sector they monitor.
 */

import type { PilotRole } from "@/types/entities/flight.types";
import type { ImportDefaults } from "@/types/db/stores.types";

/** Roles that inherently mean "this pilot was flying the aircraft". */
const PF_ONLY_ROLES = new Set<PilotRole>(["PICUS"]);

/** Roles we never rewrite automatically — they describe the seat, not the leg. */
const ROLES_INDEPENDENT_OF_PF = new Set<PilotRole>([
  "PIC",
  "Dual",
  "Instructor",
]);

export interface RoleContext {
  /** Role currently recorded on the flight. */
  currentRole: PilotRole;
  /** Pilot-flying state AFTER the change being applied. */
  pilotFlying: boolean;
  /** User's convention for a non-PIC leg they flew. */
  nonPicPfRole: ImportDefaults["nonPicPfRole"];
}

/**
 * The role a flight should carry once `pilotFlying` takes its new value.
 * Returns `currentRole` unchanged when no correction is warranted.
 */
export function reconcilePilotRole({
  currentRole,
  pilotFlying,
  nonPicPfRole,
}: RoleContext): PilotRole {
  // A PIC stays PIC whether or not they were the handling pilot; likewise the
  // training roles describe the seat, not who held the controls.
  if (ROLES_INDEPENDENT_OF_PF.has(currentRole)) return currentRole;

  if (!pilotFlying) {
    // Monitoring: PICUS is no longer defensible, fall back to SIC.
    return PF_ONLY_ROLES.has(currentRole) ? "SIC" : currentRole;
  }

  // Now flying. Promote a plain SIC to whatever the user logs such legs as.
  return currentRole === "SIC" ? nonPicPfRole : currentRole;
}

/** Roles a user may pick for a leg, given whether they were flying it. */
export function allowedRolesFor(pilotFlying: boolean): PilotRole[] {
  const all: PilotRole[] = ["PIC", "SIC", "PICUS", "Dual", "Instructor"];
  return pilotFlying ? all : all.filter((r) => !PF_ONLY_ROLES.has(r));
}

/** True when the pairing is self-consistent (e.g. not "PM + PICUS"). */
export function isRoleConsistent(
  role: PilotRole,
  pilotFlying: boolean
): boolean {
  return pilotFlying || !PF_ONLY_ROLES.has(role);
}
