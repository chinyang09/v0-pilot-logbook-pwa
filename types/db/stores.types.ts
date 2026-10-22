/**
 * Store and preference types
 */

import { DEFAULT_PALETTE_ID, type PaletteSeed } from "@/lib/theme/palette"
import type { DraftGenerationConfig } from "@/types/entities/roster.types"
import type { LogbookAuthority } from "@/lib/utils/logbook-rules"

export interface FieldOrder {
  flight: string[]
  time: string[]
  crew: string[]
  landings: string[]
  approaches: string[]
  notes: string[]
}

export type ThemePreference = "light" | "dark" | "system"

export interface DisplayPreferences {
  timeFormat: "24h" | "24h-padded" | "12h"
  /**
   * How CLOCK times are punctuated — "02:30" vs "0230". Durations always keep
   * the colon: "4:00" has to read as four hours, not four hundred.
   */
  clockSeparator: "colon" | "none"
  useZuluTime: boolean
  airportIdentifier: "icao" | "iata" | "both"
  coordinateFormat: "decimal" | "dms"
  /** Light / dark / follow the OS. Orthogonal to the palette. */
  theme: ThemePreference
  /**
   * Which palette — a preset id from `lib/theme/palette.ts`, or "custom" for
   * `customPalette`. An id this build does not know falls back to the default.
   */
  palette: string
  /** The pilot's own palette, kept even while a preset is selected. */
  customPalette?: PaletteSeed
}

export interface AutoFillPreferences {
  night: boolean
  pic: boolean
  sic: boolean
  p1us: boolean
  dualRcvd: boolean
  dualGiven: boolean
  xc: boolean
  ifr: boolean
  actualInst: boolean
  simInst: boolean
  multiPilot: boolean
}

export interface DutyTimeDefaults {
  minutesBeforeOut: number
  minutesAfterIn: number
  /** Regulatory authority used for FTL limits (CAAS, FAA, EASA). Defaults to CAAS. */
  regulationType?: "CAAS" | "FAA" | "EASA"
}

/** Defaults applied when imports populate a flight on the user's behalf. */
export interface ImportDefaults {
  /**
   * Role to assign when the imported flight has the user marked as Pilot
   * Flying but NOT as the Pilot in Command. PICUS = "Pilot In Command
   * Under Supervision" (typically logged by an FO acting as PIC during
   * training/line-check). SIC keeps the flight in the standard FO column.
   */
  nonPicPfRole: "PICUS" | "SIC"
}

/**
 * How the pilot logs their own seat — a USER setting (synced), not a device
 * one. The seat values are nullable: null is "not set here", and the pilot's
 * "This is me" crew card answers instead, which is where these lived before
 * (`withLoggingPreferences` in lib/utils/roster/pilot-role.ts).
 *
 * This is also where a NEW flight's starting values live. Nothing about a
 * pilot's flight is a fixed default in code — the app starts a flight the way
 * the pilot said to, and follows when they change it.
 */
export interface LoggingPreferences {
  /** Captain logs PIC whoever flies; a first officer logs SIC (or PICUS when flying). */
  seat: "captain" | "first_officer" | null
  /** What a first officer logs a leg they FLEW as. Never PICUS by default. */
  pfRole: "PICUS" | "SIC" | null
  /**
   * The PICUS check-out date (YYYY-MM-DD) — a leg flown before it is SIC.
   * `""` says "no date" explicitly, so the card's date does not show through.
   */
  pfRoleFrom: string | null
  /**
   * Whether a flight the pilot CREATES (new, next leg, return trip) starts as
   * Pilot Flying or Pilot Monitoring. Only a starting value: a recorded flight
   * keeps what was recorded, and an import takes the report's PF/PM.
   */
  newFlightPilotFlying: boolean
  /**
   * Whose logbook wording the hour categories carry (`lib/utils/logbook-rules.ts`)
   * — the licensing authority, which is a separate question from the duty
   * limits the operator flies under (`DutyTimeDefaults.regulationType`).
   */
  authority: LogbookAuthority
}

export const DEFAULT_LOGGING_PREFERENCES: LoggingPreferences = {
  seat: null,
  pfRole: null,
  pfRoleFrom: null,
  newFlightPilotFlying: true,
  authority: "CAAS",
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  timeFormat: "24h",
  clockSeparator: "colon",
  useZuluTime: true,
  airportIdentifier: "icao",
  coordinateFormat: "decimal",
  theme: "dark",
  palette: DEFAULT_PALETTE_ID,
}

export const DEFAULT_AUTO_FILL_PREFERENCES: AutoFillPreferences = {
  night: true,
  pic: true,
  sic: true,
  p1us: true,
  dualRcvd: true,
  dualGiven: true,
  xc: true,
  ifr: false,
  actualInst: false,
  simInst: false,
  // Fills only where the flight itself shows a multi-pilot crew
  // (`isMultiPilotFlight`), so on is safe for everyone.
  multiPilot: true,
}

export const DEFAULT_DUTY_TIME_DEFAULTS: DutyTimeDefaults = {
  minutesBeforeOut: 60,
  minutesAfterIn: 30,
  regulationType: "CAAS",
}

export const DEFAULT_IMPORT_DEFAULTS: ImportDefaults = {
  nonPicPfRole: "SIC",
}

export type BottomNavTab =
  | "dashboard" | "logbook" | "roster" | "aircraft"
  | "crew" | "airports" | "currencies" | "settings" | "account"

export interface NavigationPreferences {
  bottomNavTabs: [BottomNavTab, BottomNavTab, BottomNavTab, BottomNavTab]
}

export const DEFAULT_NAVIGATION_PREFERENCES: NavigationPreferences = {
  bottomNavTabs: ["dashboard", "logbook", "roster", "aircraft"],
}

export interface UserPreferences {
  key: string
  fieldOrder: FieldOrder
  visibleFields: Record<string, boolean>
  recentlyUsedAirports?: string[]
  recentlyUsedAircraft?: string[]
  favoriteAircraft?: string[]
  draftGenerationConfig?: DraftGenerationConfig
  display?: DisplayPreferences
  autoFill?: AutoFillPreferences
  dutyTimeDefaults?: DutyTimeDefaults
  navigation?: NavigationPreferences
  importDefaults?: ImportDefaults
  logging?: LoggingPreferences
  createdAt: number
  updatedAt: number
}

export const DEFAULT_FIELD_ORDER: FieldOrder = {
  flight: [
    "date",
    "flightNumber",
    "aircraftReg",
    "departureIcao",
    "departureIata",
    "arrivalIcao",
    "arrivalIata",
    "scheduledOut",
    "scheduledIn",
    "outTime",
    "offTime",
    "onTime",
    "inTime",
  ],
  time: ["total", "night", "p1us", "sicTime", "xc", "ifr", "actualInst", "simInst"],
  crew: ["pf", "picCrew", "sicCrew", "observer"],
  landings: ["dayTO", "dayLdg", "nightTO", "nightLdg", "autolands"],
  approaches: ["app1", "app2", "holds"],
  notes: ["remarks", "ipcIcc"],
}
