/**
 * Store and preference types
 */

import type { DraftGenerationConfig } from "@/types/entities/roster.types"

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
  useZuluTime: boolean
  airportIdentifier: "icao" | "iata" | "both"
  coordinateFormat: "decimal" | "dms"
  theme: ThemePreference
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
  solo: boolean
  ground: boolean
  nvg: boolean
  sfe: boolean
  flightEngineer: boolean
}

export interface DutyTimeDefaults {
  minutesBeforeOut: number
  minutesAfterIn: number
}

export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences = {
  timeFormat: "24h",
  useZuluTime: true,
  airportIdentifier: "icao",
  coordinateFormat: "decimal",
  theme: "dark",
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
  multiPilot: false,
  solo: false,
  ground: false,
  nvg: false,
  sfe: false,
  flightEngineer: false,
}

export const DEFAULT_DUTY_TIME_DEFAULTS: DutyTimeDefaults = {
  minutesBeforeOut: 60,
  minutesAfterIn: 30,
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
