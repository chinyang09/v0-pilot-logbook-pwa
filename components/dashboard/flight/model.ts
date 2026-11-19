/**
 * Everything the flight dashboard's widgets draw, built once per minute by
 * `FlightDashboard` — so a tile, its sheet and its detail panel read the same
 * answer and nothing queries twice.
 */

import type { FlightLog } from "@/types/entities/flight.types"
import type { DutyPeriod, RestPeriodInfo } from "@/types/entities/roster.types"
import type { Airport } from "@/types/entities/airport.types"
import type { DisplayPreferences } from "@/types/db/stores.types"
import type { PilotStatus } from "@/lib/utils/dashboard/pilot-status"
import type { DutyLookups } from "@/hooks/use-duty-lookups"
import type { CrewMate, DestinationVisits } from "@/lib/utils/dashboard/flight-brief"
import type { LegTimes } from "@/lib/weather/brief"
import type { WeatherState } from "./weather"

export interface FlightBrief {
  status: PilotStatus
  now: number
  display?: DisplayPreferences
  /**
   * The duty the page is about: the one in progress, else the next — or a
   * later one the pilot stepped to (the owner, Nov 2026: a dashboard about the
   * duty chosen). Flights, gates, weather, crew and "last there" follow it;
   * the duty and rest card stays about NOW.
   */
  duty: {
    /** Report (or start), ms; null when nothing is rostered. */
    atMs: number | null
    /** On it now. */
    current: boolean
    /** The duties to choose from, the default first. */
    choices: DutyChoice[]
    /** Which of them this is. */
    index: number
    /** The duty period behind it, where the pipeline has one. */
    period: DutyPeriod | null
    /** Its FDP against its Reg 14 maximum — null on the duty in progress (the duty card has it). */
    fdp: { planned: number; max: number } | null
    /** The rest before a LATER duty (the next one's is the duty card's). */
    restBefore: RestPeriodInfo | null
    /** Its logbook flights, in the order flown. */
    legs: FlightLog[]
    /** Each leg's times at each end. */
    times: LegTimes[]
    /** Gates and the inbound aeroplane, once the duty is close enough to ask. */
    lookups: DutyLookups | null
    lookupsLoading: boolean
    refreshLookups: () => void
  }
  crew: CrewMate[]
  destinations: DestinationVisits[]
  /** The airports the duty touches, by ICAO, once read. */
  airports: Map<string, Airport>
  weather: WeatherState
  /** An airport's code as the pilot reads them (Settings › Display). */
  code: (icao: string, iata?: string) => string
  /** A point in time as the app writes one. */
  clock: (ms: number) => string
  /** "Thu 19 Nov" — a day, short. */
  day: (ms: number) => string
}

/** One duty the dashboard can be about. */
export interface DutyChoice {
  atMs: number
  period: DutyPeriod | null
}
