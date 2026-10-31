/**
 * The hour categories a logbook records, and what each licensing authority
 * calls them — ONE table, read by every screen that names a category (the
 * flight form, Settings › Auto-fill, the dashboard breakdown, the import
 * review). The pilot picks the authority whose wording they log in
 * (Settings › Logging › Logbook rules); that name is the label, and the other
 * authorities' names ride underneath as helper text.
 *
 * The categories are the STORED fields, so changing the rules never changes a
 * logged figure — only what it is called and which rows the form offers.
 *
 * Sources:
 * - CAAS: SASP Part 1 Appendix B, "Recording and crediting of flight time"
 *   (20 Jan 2025, Issue 9 Amendment 8) — read from the document itself. The
 *   designations (PIC or P1, PIC U/S, P2, P/UT, SNY) and the columns they are
 *   entered in (P1, Co-pilot (P2), Dual) are its Cases A–N. "Instructor" and
 *   "Multi-crew" are not in Appendix B and are unconfirmed.
 * - FAA: 14 CFR 61.51 (PIC, SIC, solo, dual received, actual / simulated
 *   instrument, cross-country; no PICUS or multi-pilot column — duties of PIC
 *   under supervision is 61.51(e)(1)(iv)). From search excerpts, not the text.
 * - EASA: TODO. Part-FCL FCL.050 / AMC1 FCL.050 has not been read from the
 *   source, so its names are held back (`available: false`) rather than shown
 *   as fact.
 */

import type { FlightLog, PilotRole } from "@/types/entities/flight.types"
import type { AutoFillPreferences } from "@/types/db/stores.types"

export type LogbookAuthority = "CAAS" | "EASA" | "FAA"

export const LOGBOOK_AUTHORITIES: {
  value: LogbookAuthority
  label: string
  description: string
  /** Offered in Settings and named in helper text. False until its wording is verified. */
  available: boolean
}[] = [
  { value: "CAAS", label: "CAAS", description: "Singapore — SASP Appendix B", available: true },
  { value: "FAA", label: "FAA", description: "United States — 14 CFR Part 61", available: true },
  // TODO(EASA): verify AMC1 FCL.050's columns against the source, then offer it.
  { value: "EASA", label: "EASA", description: "Europe — Part-FCL", available: false },
]

/** The authorities a pilot can choose today. */
export const OFFERED_AUTHORITIES = LOGBOOK_AUTHORITIES.filter((a) => a.available)

/** The time fields a category can be — every one is an HH:MM string on the flight. */
export type TimeField =
  | "picTime"
  | "sicTime"
  | "picusTime"
  | "dualTime"
  | "instructorTime"
  | "soloTime"
  | "multiPilotTime"
  | "nightTime"
  | "ifrTime"
  | "actualInstrumentTime"
  | "simulatedInstrumentTime"
  | "crossCountryTime"

interface Name {
  /** The column heading. */
  label: string
  /** What the pilot is designated as when this is their role, where that differs from the column (CAAS P/UT → the Dual column). */
  designation?: string
  /** The same thing spelled out — the helper when nothing else applies. */
  full: string
  /** A rule the pilot needs at the point of logging it ("entered in the P1 column"). Always shown. */
  note?: string
}

export interface TimeCategory {
  field: TimeField & keyof FlightLog
  /** WHAT the pilot did (one per flight, follows the role) or the CONDITIONS flown in. */
  kind: "function" | "condition"
  /** The role whose time this is, for a function category. */
  role?: PilotRole
  names: Record<LogbookAuthority, Name>
  /** The Settings › Auto-fill switch that fills it. */
  autoFill: keyof AutoFillPreferences
  /** Authorities whose logbook has this as a category. Anything else is shown only when it holds time. */
  recognisedBy: LogbookAuthority[]
}

const same = (label: string, full: string): Record<LogbookAuthority, Name> => ({
  CAAS: { label, full },
  EASA: { label, full },
  FAA: { label, full },
})

export const TIME_CATEGORIES: TimeCategory[] = [
  {
    field: "picTime",
    autoFill: "pic",
    kind: "function",
    role: "PIC",
    names: {
      // Case A: designation "PIC or P1", entered in the P1 column.
      CAAS: { label: "P1", designation: "PIC", full: "Pilot-in-command" },
      EASA: { label: "PIC", full: "Pilot-in-command" },
      FAA: { label: "PIC", full: "Pilot in command" },
    },
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "sicTime",
    autoFill: "sic",
    kind: "function",
    role: "SIC",
    names: {
      // Case C: designation P2, entered in the "Co-pilot (P2)" column.
      CAAS: { label: "P2", full: "Co-pilot" },
      EASA: { label: "Co-pilot", full: "Co-pilot" },
      FAA: { label: "SIC", full: "Second in command" },
    },
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "picusTime",
    autoFill: "p1us",
    kind: "function",
    role: "PICUS",
    names: {
      // Case B: co-pilot performing the duties of PIC under supervision —
      // entered in the P1 column, counted subject to the PIC's certification.
      CAAS: {
        label: "PIC U/S",
        full: "Co-pilot performing the duties of PIC under supervision",
        note: "Counts in P1 once the PIC certifies it",
      },
      EASA: { label: "PICUS", full: "PIC under supervision" },
      FAA: { label: "PIC (supervised)", full: "Duties of PIC under supervision, 61.51(e)(1)(iv)" },
    },
    recognisedBy: ["CAAS", "EASA"],
  },
  {
    field: "dualTime",
    autoFill: "dualRcvd",
    kind: "function",
    role: "Dual",
    names: {
      // Case G: designation P/UT, entered in the Dual column.
      CAAS: { label: "Dual", designation: "P/UT", full: "Pilot under instruction" },
      EASA: { label: "Dual", full: "Dual instruction received" },
      FAA: { label: "Dual Received", full: "Training received from an authorized instructor" },
    },
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "instructorTime",
    autoFill: "dualGiven",
    kind: "function",
    role: "Instructor",
    names: {
      CAAS: { label: "Instructor", full: "Flight instruction given" },
      EASA: { label: "Instructor", full: "Flight instruction given" },
      FAA: { label: "Dual Given", full: "Flight instruction given" },
    },
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "soloTime",
    autoFill: "solo",
    kind: "condition",
    names: {
      // Case L: a student pilot as sole occupant is logged PIC, in the P1 column.
      CAAS: { label: "Solo", full: "Sole occupant of the aircraft", note: "Also counts in P1" },
      EASA: { label: "Solo", full: "Sole occupant of the aircraft" },
      FAA: { label: "Solo", full: "Sole occupant of the aircraft" },
    },
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "multiPilotTime",
    autoFill: "multiPilot",
    kind: "condition",
    names: {
      CAAS: { label: "Multi-crew", full: "Multi-pilot operation" },
      EASA: { label: "Multi-pilot", full: "Multi-pilot operation" },
      FAA: { label: "Multi-crew", full: "Multi-pilot operation" },
    },
    recognisedBy: ["CAAS", "EASA"],
  },
  {
    field: "nightTime",
    autoFill: "night",
    kind: "condition",
    names: same("Night", "End of evening to start of morning civil twilight"),
    recognisedBy: ["CAAS", "EASA", "FAA"],
  },
  {
    field: "ifrTime",
    autoFill: "ifr",
    kind: "condition",
    names: same("IFR", "Flown under instrument flight rules"),
    recognisedBy: ["CAAS", "EASA"],
  },
  {
    field: "actualInstrumentTime",
    autoFill: "actualInst",
    kind: "condition",
    names: same("Actual instrument", "Solely by reference to instruments, in IMC"),
    recognisedBy: ["CAAS", "FAA"],
  },
  {
    field: "simulatedInstrumentTime",
    autoFill: "simInst",
    kind: "condition",
    // On a FLIGHT this is hood time. A simulator session keeps its length in
    // the same field and is told apart by its entry type, not a second field.
    names: same("Simulated instrument", "Under the hood, in an aircraft"),
    recognisedBy: ["CAAS", "FAA"],
  },
  {
    field: "crossCountryTime",
    autoFill: "xc",
    kind: "condition",
    names: {
      CAAS: { label: "Cross-country", full: "To a point other than departure" },
      EASA: { label: "Cross-country", full: "Along a pre-planned route" },
      FAA: { label: "Cross-country", full: "Landing over 50 NM from departure (61.1)" },
    },
    recognisedBy: ["CAAS", "FAA"],
  },
]

/** Every role a flight can hold, in the order the role picker offers them. */
export const PILOT_ROLES: PilotRole[] = TIME_CATEGORIES.flatMap((c) => (c.role ? [c.role] : []))

const BY_FIELD = new Map(TIME_CATEGORIES.map((c) => [c.field, c]))
const BY_ROLE = new Map(TIME_CATEGORIES.filter((c) => c.role).map((c) => [c.role!, c]))

export function timeCategory(field: TimeField): TimeCategory {
  return BY_FIELD.get(field)!
}

/** The role's time field (`PICUS` → `picusTime`). */
export function roleTimeField(role: PilotRole): TimeField {
  return BY_ROLE.get(role)!.field
}

/**
 * The heading and the helper for a category under `authority`. The helper
 * carries the authority's own logging rule where it has one, then what the
 * OTHER offered authorities call it where that differs ("FAA SIC"); with
 * neither, it spells the category out, so the helper always adds something.
 */
export function categoryLabel(
  category: TimeCategory,
  authority: LogbookAuthority
): { label: string; helper: string } {
  const own = category.names[authority]
  const others = OFFERED_AUTHORITIES.map((a) => a.value)
    .filter((a) => a !== authority && category.names[a].label !== own.label)
    .map((a) => `${a} ${category.names[a].label}`)
  const parts = [own.note, ...others].filter(Boolean)
  return { label: own.label, helper: parts.length > 0 ? parts.join(" · ") : own.full }
}

/** What a role is called under `authority` — the role picker's options. */
export function roleLabel(role: PilotRole, authority: LogbookAuthority): string {
  const name = BY_ROLE.get(role)!.names[authority]
  return name.designation ?? name.label
}

/**
 * Whether the form offers a category's row: every category the authority's
 * logbook has, plus any other that already holds time — a figure is never
 * hidden because the rules changed.
 */
export function showsCategory(category: TimeCategory, authority: LogbookAuthority, value: string | undefined): boolean {
  if (category.recognisedBy.includes(authority)) return true
  return !!value && value !== "00:00" && value !== "0:00"
}
