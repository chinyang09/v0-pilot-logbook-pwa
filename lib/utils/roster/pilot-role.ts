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
import type { ImportDefaults, LoggingPreferences } from "@/types/db/stores.types";
import type { Personnel } from "@/types/entities/crew.types";

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

// ── The pilot's own seat, from their "This is me" crew card ─────────────────
//
// What a pilot logs follows from ONE fact about them: are they a captain?
//
// | seat          | monitoring | flying                      |
// |---------------|------------|-----------------------------|
// | captain       | PIC        | PIC                         |
// | first officer | SIC        | SIC, or PICUS (their call)  |
//
// A captain is PIC whichever pilot has the controls. A first officer is never
// PIC; monitoring is co-pilot time (SIC). Flying, it is SIC unless they log
// PICUS — co-pilot duties performed as PIC under the PIC's supervision. PICUS
// is only creditable where the authority accepts the operator's method of
// supervision (and EASA states want each entry countersigned by the PIC), so
// it is a per-pilot convention, never the default. Instructor/Examiner/Dual
// are per-flight capacities, picked on the flight, not defaults.

export type Seat = "captain" | "first_officer";
export type NonPicPfRole = ImportDefaults["nonPicPfRole"];

type SelfCard = Pick<Personnel, "defaultPIC" | "defaultSIC" | "roles" | "pfRole" | "pfRoleFrom">;

/**
 * The pilot's card as the LOGGING settings say it is. Settings › Logging is
 * where the seat and the PF convention are set — a user preference, synced,
 * never a fixed rule — and each value it holds wins over the card's. A value
 * it leaves unset (null) falls back to the card, which is where they lived
 * before, so a pilot who set them there keeps their choice.
 *
 * `pfRoleFrom: ""` in the settings means "no check-out date" stated outright,
 * so it is not read through to a date left on the card.
 */
export function withLoggingPreferences<T extends SelfCard>(
  self: T | null | undefined,
  logging: Partial<LoggingPreferences> | null | undefined
): T | null {
  if (!logging || (logging.seat == null && logging.pfRole == null && logging.pfRoleFrom == null)) return self ?? null;
  const base = (self ?? { roles: [] }) as T;
  const seat = logging.seat ?? seatOf(self);
  return {
    ...base,
    defaultPIC: seat === "captain",
    defaultSIC: seat === "first_officer",
    pfRole: logging.pfRole ?? self?.pfRole ?? null,
    pfRoleFrom: logging.pfRoleFrom != null ? logging.pfRoleFrom || null : self?.pfRoleFrom ?? null,
  };
}

/**
 * The self card's seat. `defaultPIC`/`defaultSIC` are what the card's seat
 * control writes; `roles` is the fallback for a card made before it existed
 * (an import's profile, or the LogTen address book). Null when nothing says.
 */
export function seatOf(self: SelfCard | null | undefined): Seat | null {
  if (!self) return null;
  if (self.defaultPIC) return "captain";
  if (self.defaultSIC) return "first_officer";
  if (self.roles?.includes("PIC")) return "captain";
  if (self.roles?.includes("SIC")) return "first_officer";
  return null;
}

/**
 * What a first officer logs a leg they flew as. The self card is the home of
 * the setting; `fallback` is the old Settings › Import Defaults value, read
 * only so a pilot who set it there before it moved keeps their choice.
 */
export function nonPicPfRoleOf(
  self: SelfCard | null | undefined,
  fallback?: NonPicPfRole | null,
  date?: string | null
): NonPicPfRole {
  return pfRoleOn(self?.pfRole ?? fallback ?? "SIC", self?.pfRoleFrom, date);
}

/**
 * The convention as it stood on `date`. PICUS is creditable only from the
 * pilot's check-out (`pfRoleFrom`), so a leg flown before it is SIC however
 * the card reads today. With no date, or no check-out recorded, the
 * convention applies as written.
 */
export function pfRoleOn(
  role: NonPicPfRole,
  from: string | null | undefined,
  date: string | null | undefined
): NonPicPfRole {
  return role === "PICUS" && from && date && date < from ? "SIC" : role;
}

/**
 * The role a flight should carry when its pilot-flying value is NOT changing
 * but the pair it forms is wrong for the pilot's convention — what an import
 * offers to put right. `convention` is the card's value as written and
 * `onDate` is it resolved for this flight's date (`pfRoleOn`). Returns
 * `currentRole` when nothing is wrong.
 *
 * - PM + PICUS is impossible: SIC.
 * - PF + SIC, where the pilot logs flown legs as PICUS on that date: PICUS.
 * - PF + PICUS BEFORE the check-out: SIC. A pilot whose convention is SIC
 *   and who picked PICUS on one leg is left alone — that is their call.
 */
export function settledRole({
  currentRole,
  pilotFlying,
  convention,
  onDate,
}: {
  currentRole: PilotRole;
  pilotFlying: boolean;
  convention: NonPicPfRole;
  onDate: NonPicPfRole;
}): PilotRole {
  if (ROLES_INDEPENDENT_OF_PF.has(currentRole)) return currentRole;
  if (!pilotFlying) return PF_ONLY_ROLES.has(currentRole) ? "SIC" : currentRole;
  if (currentRole === "SIC" && onDate === "PICUS") return "PICUS";
  if (currentRole === "PICUS" && convention === "PICUS" && onDate === "SIC") return "SIC";
  return currentRole;
}

/**
 * The role an IMPORTED sector is created with.
 *
 * - The report names this pilot as commander, or the seat on the logging
 *   profile is captain with nothing in the report saying otherwise: PIC.
 * - Otherwise the role follows pilot-flying and the pilot's convention FOR THE
 *   LEG'S DATE: flown → `nonPicPfRole` on that date, monitoring → SIC.
 *
 * A schedule report carries no PF/PM, so its sectors are created as PF; they
 * used to take the role from the seat alone, which is SIC for a first officer
 * — "PF, P2" on every leg, whatever Settings › Logging said.
 */
export function importedSectorRole({
  reportSaysPic,
  reportSaysNotPic,
  pilotFlying,
  seat,
  nonPicPfRole,
}: {
  /** The report names this pilot as the commander. */
  reportSaysPic: boolean;
  /** The report says this pilot was NOT the commander. */
  reportSaysNotPic: boolean;
  pilotFlying: boolean;
  seat: Seat | null;
  /** The convention resolved for the leg's date (`nonPicPfRoleOf(…, date)`). */
  nonPicPfRole: NonPicPfRole;
}): PilotRole {
  if (reportSaysPic) return "PIC";
  if (!reportSaysNotPic && seat === "captain") return "PIC";
  return pilotFlying ? nonPicPfRole : "SIC";
}

/** The role a flight takes from the pilot's seat and who had the controls. */
export function roleForSeat(
  seat: Seat,
  pilotFlying: boolean,
  nonPicPfRole: NonPicPfRole
): PilotRole {
  if (seat === "captain") return "PIC";
  return pilotFlying ? nonPicPfRole : "SIC";
}
