/**
 * Store and preference types
 */

export interface FieldOrder {
  flight: string[]
  time: string[]
  crew: string[]
  landings: string[]
  approaches: string[]
  notes: string[]
}

export interface UserPreferences {
  key: string
  fieldOrder: FieldOrder
  visibleFields: Record<string, boolean>
  recentlyUsedAirports?: string[]
  recentlyUsedAircraft?: string[]
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
