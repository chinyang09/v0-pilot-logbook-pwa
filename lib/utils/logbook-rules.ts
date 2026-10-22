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
 * Sources (researched Oct 2026, from search excerpts — the regulators' sites
 * were not reachable to quote; recheck before citing):
 * - CAAS: SASP Part 2 (ATPL), SASP Part D definitions ("PIC U/S", co-pilot /
 *   P2, dual instruction time), ANO para 22 (logbook content).
 * - EASA: Part-FCL FCL.010, AMC1 FCL.050 (logbook columns: PIC, co-pilot,
 *   dual, instructor, multi-pilot, IFR; PICUS is logged as PIC, countersigned).
 * - FAA: 14 CFR 61.51 (PIC, SIC, solo, dual received, actual / simulated
 *   instrument, cross-country; no PICUS or multi-pilot column — duties of PIC
 *   under supervision is 61.51(e)(1)(iv)).
 */

import type { FlightLog, PilotRole } from "@/types/entities/flight.types"
import type { AutoFillPreferences } from "@/types/db/stores.types"

export type LogbookAuthority = "CAAS" | "EASA" | "FAA"

export const LOGBOOK_AUTHORITIES: { value: LogbookAuthority; label: string; description: string }[] = [
  { value: "CAAS", label: "CAAS", description: "Singapore — SASP / Air Navigation Order" },
  { value: "EASA", label: "EASA", description: "Europe — Part-FCL" },
  { value: "FAA", label: "FAA", description: "United States — 14 CFR Part 61" },
]

/** The time fields a category can be — every one is an HH:MM string on the flight. */
export type TimeField =
  | "picTime"
  | "sicTime"
  | "picusTime"
  | "dualTime"
  | "instructorTime"
  | "multiPilotTime"
  | "nightTime"
  | "ifrTime"
  | "actualInstrumentTime"
  | "simulatedInstrumentTime"
  | "crossCountryTime"

interface Name {
  /** The column heading. */
  label: string
  /** The same thing spelled out — the helper when every authority agrees on the label. */
  full: string
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
      CAAS: { label: "PIC", full: "Pilot-in-command" },
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
      CAAS: { label: "Co-pilot", full: "Co-pilot (P2)" },
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
      CAAS: { label: "PIC U/S", full: "PIC under supervision" },
      EASA: { label: "PICUS", full: "PIC under supervision — logged as PIC, countersigned" },
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
      CAAS: { label: "Dual", full: "Dual instruction received" },
      EASA: { label: "Dual", full: "Dual instruction received" },
      FAA: { label: "Dual received", full: "Training received from an authorized instructor" },
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
      FAA: { label: "Dual given", full: "Flight instruction given" },
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
    names: {
      CAAS: { label: "IFR", full: "Flown under instrument flight rules" },
      EASA: { label: "IFR", full: "Flown under instrument flight rules" },
      FAA: { label: "IFR", full: "Flown under instrument flight rules" },
    },
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
    names: same("Simulated instrument", "Under the hood, or in a training device"),
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
 * names what the OTHER authorities call it where that differs ("EASA PICUS ·
 * FAA PIC (supervised)"); where every authority says the same thing it spells
 * the category out instead, so the helper always adds something.
 */
export function categoryLabel(
  category: TimeCategory,
  authority: LogbookAuthority
): { label: string; helper: string } {
  const own = category.names[authority]
  const others = LOGBOOK_AUTHORITIES.map((a) => a.value)
    .filter((a) => a !== authority && category.names[a].label !== own.label)
    .map((a) => `${a} ${category.names[a].label}`)
  return { label: own.label, helper: others.length > 0 ? others.join(" · ") : own.full }
}

/** What a role is called under `authority` — the role picker's options. */
export function roleLabel(role: PilotRole, authority: LogbookAuthority): string {
  return BY_ROLE.get(role)!.names[authority].label
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
