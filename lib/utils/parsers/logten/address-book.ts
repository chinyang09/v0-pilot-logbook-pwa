/**
 * LogTen Pro "Address Book" export → `Personnel`.
 *
 * Header (tab-separated, several columns padded with a leading space):
 *
 *   Name · ID · Full Name · Organization · Type · Comment · This is Me ·
 *   Crew Quick Pick · Pax Quick Pick · Email · Phone · Default Capacity
 *
 * Two rules here are worth stating outright:
 *
 * **"This is Me" never creates a second self.** The app identifies the logged-in
 * pilot by `Personnel.isMe`, and every import path (crew resolution, PF/PM
 * inference, the whole reconciler) assumes there is exactly one. A migrating
 * user already has one — they had to create it to use the app. So a LogTen row
 * claiming self is MERGED into the existing self record (backfilling crew id,
 * organisation, contact) instead of being inserted alongside it. Only when the
 * app has no self at all does the flag carry through.
 *
 * **A match is by name, and it backfills.** LogTen has no stable id we share,
 * so `resolveCrewByName` — the same resolver the eCrew logbook parser uses for
 * its truncated PIC names — decides whether a row is somebody already known.
 * When it is, only fields the app is MISSING are written: a migration must not
 * overwrite a phone number the user has since corrected.
 */

import type { Personnel, PersonnelRole } from "@/types/entities/crew.types";
import { bindRows, type LogtenRow } from "./header-map";
import { text, toBool, upper } from "./values";
import type { LogtenCrewPlan, LogtenCrewPlanRow, LogtenIssue } from "./types";
import type { NormalizedDocument } from "../types";
import { normalize } from "../shared/name-normalize";

/** Role words LogTen writes in "Type" / "Default Capacity". */
const ROLE_PATTERNS: Array<{ match: RegExp; role: PersonnelRole }> = [
  { match: /\b(PIC|CAPT|CAPTAIN|CMD|COMMANDER|P1)\b/, role: "PIC" },
  { match: /\b(SIC|FO|F\/O|FIRST OFFICER|COPILOT|CO-PILOT|P2)\b/, role: "SIC" },
  { match: /\b(INSTRUCTOR|TRI|TRE|CFI|SFI)\b/, role: "Instructor" },
  { match: /\b(EXAMINER|CHECK|APD|TRE)\b/, role: "Examiner" },
];

function parseRoles(...sources: string[]): PersonnelRole[] {
  const haystack = upper(sources.filter(Boolean).join(" "));
  if (!haystack) return [];
  const roles: PersonnelRole[] = [];
  for (const { match, role } of ROLE_PATTERNS) {
    if (match.test(haystack) && !roles.includes(role)) roles.push(role);
  }
  return roles;
}

/**
 * LogTen pads numeric crew ids to a fixed width (`00009766` for 9766). The
 * padding is a display artefact of LogTen's own ID column, and the app's crew
 * ids are compared as plain strings, so a padded copy would never match the
 * unpadded one the eCrew reports carry. Strip it — but only for an all-digit
 * id, since an alphanumeric staff number may legitimately start with a zero.
 */
export function normalizeCrewId(raw: string): string {
  const value = text(raw);
  if (!value) return "";
  if (!/^\d+$/.test(value)) return value;
  const stripped = value.replace(/^0+/, "");
  return stripped || "0";
}

function buildPersonnel(row: LogtenRow): {
  personnel: Personnel;
  claimsSelf: boolean;
} | null {
  // "Full Name" is the authoritative one; "Name" is LogTen's display form and
  // is what a partially-filled contact has instead.
  const name = row.get("Full Name", "fullName", "Name", "crew_fullName", "crew_name");
  if (!name) return null;

  const crewId = normalizeCrewId(row.get("ID", "crew_crewID", "Crew ID", "Employee ID"));
  const organization = row.get("Organization", "crew_organizationName", "Company");
  const typeText = row.get("Type", "crew_type");
  const defaultCapacity = row.get("Default Capacity", "crew_defaultCapacity");
  const comment = row.get("Comment", "crew_notes", "Notes");
  const email = row.get("Email", "crew_email");
  const phone = row.get("Phone", "crew_phone", "Mobile");
  const claimsSelf = toBool(row.get("This is Me", "crew_isMe"));
  const favorite = toBool(row.get("Crew Quick Pick", "crew_crewQuickPick"));

  const roles = parseRoles(typeText, defaultCapacity);

  const personnel: Personnel = {
    id: crypto.randomUUID(),
    name,
    createdAt: Date.now(),
    syncStatus: "pending",
    isMe: false,
    ...(crewId ? { crewId } : {}),
    ...(organization ? { organization } : {}),
    ...(roles.length ? { roles } : {}),
    ...(comment ? { comment } : {}),
    ...(favorite ? { favorite } : {}),
    ...(email || phone
      ? { contact: { ...(email ? { email } : {}), ...(phone ? { phone } : {}) } }
      : {}),
  };

  return { personnel, claimsSelf };
}

/**
 * Fields to write onto an EXISTING personnel record: only the ones the app is
 * currently missing. Nothing the user already has is touched.
 */
function backfillPatch(
  existing: Personnel,
  incoming: Personnel
): Partial<Personnel> {
  const patch: Partial<Personnel> = {};
  if (!existing.crewId && incoming.crewId) patch.crewId = incoming.crewId;
  if (!existing.organization && incoming.organization) {
    patch.organization = incoming.organization;
  }
  if (!existing.comment && incoming.comment) patch.comment = incoming.comment;
  if (!existing.roles?.length && incoming.roles?.length) patch.roles = incoming.roles;

  const email = existing.contact?.email || incoming.contact?.email;
  const phone = existing.contact?.phone || incoming.contact?.phone;
  if (
    (email && email !== existing.contact?.email) ||
    (phone && phone !== existing.contact?.phone)
  ) {
    patch.contact = {
      ...(email ? { email } : {}),
      ...(phone ? { phone } : {}),
    };
  }

  // A fuller name is an upgrade — LogTen's "Full Name" beats a nickname the
  // user typed into the app, but only when it genuinely extends it.
  if (
    incoming.name.length > existing.name.length &&
    normalize(incoming.name).startsWith(normalize(existing.name))
  ) {
    patch.name = incoming.name;
  }

  return patch;
}

export interface ParseAddressBookContext {
  /** Everything already in the app, so a row can be matched rather than added. */
  existingPersonnel: Personnel[];
  /** The app's current self record, when there is one. */
  currentUser: Personnel | null;
}

export function parseLogtenAddressBook(
  doc: NormalizedDocument,
  ctx: ParseAddressBookContext
): LogtenCrewPlan {
  const plan: LogtenCrewPlan = {
    toCreate: [],
    toUpdate: [],
    skipped: [],
    warnings: [],
    errors: [],
  };

  const bound = bindRows(doc.rows);
  if (!bound) {
    plan.errors.push({
      line: 0,
      message: "Address Book export has no readable header row.",
    });
    return plan;
  }

  // Matching pool grows as we go, so two rows for the same person in one file
  // collapse into one record rather than two.
  const pool = [...ctx.existingPersonnel];
  const byNormalizedName = new Map<string, Personnel>();
  for (const person of pool) {
    const key = normalize(person.name);
    if (key && !byNormalizedName.has(key)) byNormalizedName.set(key, person);
  }
  const seenInFile = new Set<string>();

  for (const row of bound.dataRows) {
    try {
      const built = buildPersonnel(row);
      if (!built) {
        plan.skipped.push({
          line: row.sourceLine,
          message: "No name in row — skipped.",
          raw: row.raw.join("\t").slice(0, 120),
        });
        continue;
      }

      const { personnel, claimsSelf } = built;
      const key = normalize(personnel.name);

      if (key && seenInFile.has(key)) {
        plan.skipped.push({
          line: row.sourceLine,
          message: `Duplicate of an earlier row for "${personnel.name}" — skipped.`,
        });
        continue;
      }
      if (key) seenInFile.add(key);

      // The self row is merged into the app's existing self, never added.
      if (claimsSelf && ctx.currentUser) {
        const patch = backfillPatch(ctx.currentUser, personnel);
        if (Object.keys(patch).length > 0) {
          plan.toUpdate.push({
            personnel,
            matchedPersonnelId: ctx.currentUser.id,
            patch,
            claimsSelf: true,
            sourceLine: row.sourceLine,
          });
        } else {
          plan.skipped.push({
            line: row.sourceLine,
            message: `"${personnel.name}" is already your own profile — nothing to add.`,
          });
        }
        continue;
      }

      const match = key ? byNormalizedName.get(key) : undefined;
      if (match) {
        const patch = backfillPatch(match, personnel);
        if (Object.keys(patch).length > 0) {
          plan.toUpdate.push({
            personnel,
            matchedPersonnelId: match.id,
            patch,
            claimsSelf,
            sourceLine: row.sourceLine,
          });
        } else {
          plan.skipped.push({
            line: row.sourceLine,
            message: `"${personnel.name}" already in crew — unchanged.`,
          });
        }
        continue;
      }

      // No self in the app at all: honour the flag, so a fresh install
      // migrating from LogTen still ends up with a usable profile.
      if (claimsSelf && !ctx.currentUser) {
        personnel.isMe = true;
        plan.warnings.push({
          line: row.sourceLine,
          message: `"${personnel.name}" will be created as your own profile (no profile existed).`,
        });
      }

      const planRow: LogtenCrewPlanRow = {
        personnel,
        matchedPersonnelId: null,
        patch: {},
        claimsSelf,
        sourceLine: row.sourceLine,
      };
      plan.toCreate.push(planRow);
      pool.push(personnel);
      if (key) byNormalizedName.set(key, personnel);
    } catch (error) {
      plan.errors.push({
        line: row.sourceLine,
        message: error instanceof Error ? error.message : "Failed to read row",
        raw: row.raw.join("\t").slice(0, 120),
      });
    }
  }

  return plan;
}
