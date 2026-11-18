/**
 * Everything the flight dashboard's widgets draw, built once per minute by
 * `FlightDashboard` — so a tile, its sheet and its detail panel read the same
 * answer and nothing queries twice.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyPeriod } from "@/types/entities/roster.types"
import type { Airport } from "@/types/entities/airport.types"
import type { DisplayPreferences } from "@/types/db/stores.types"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import type { DutyInfo } from "@/lib/utils/dashboard/duty-line"
import type { CrewMate, DestinationVisits } from "@/lib/utils/dashboard/flight-brief"
import type { LegTimes } from "@/lib/weather/brief"
import type { WeatherState } from "./weather"

export interface FlightBrief {
  status: PilotStatus
  now: number
  display?: DisplayPreferences
  /** The duty the page is about: the one in progress, else the next. */
  duty: {
    /** Report (or start), ms; null when nothing is rostered. */
    atMs: number | null
    /** On it now. */
    current: boolean
    /** Its logbook flights, in the order flown. */
    legs: FlightLog[]
    /** Each leg's times at each end. */
    times: LegTimes[]
    /** Gates and the inbound aeroplane, once the duty is close enough to ask. */
    lookups: DutyLookups | null
    info: DutyInfo | null
    lookupsLoading: boolean
    refreshLookups: () => void
  }
  crew: CrewMate[]
  destinations: DestinationVisits[]
  /** The airports the duty touches, by ICAO, once read. */
  airports: Map<string, Airport>
  weather: WeatherState
  /** Duties after this one, soonest first. */
  upcoming: DutyPeriod[]
  /** An airport's code as the pilot reads them (Settings › Display). */
  code: (icao: string, iata?: string) => string
  /** A point in time as the app writes one. */
  clock: (ms: number) => string
  /** "Thu 19 Nov" — a day, short. */
  day: (ms: number) => string
}
