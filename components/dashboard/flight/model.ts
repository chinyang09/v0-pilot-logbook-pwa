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
import type { DutyInfo } from "@/lib/utils/dashboard/duty-line"
import type { CrewMate, DestinationVisits } from "@/lib/utils/dashboard/flight-brief"
import type { LegTimes } from "@/lib/weather/brief"
import type { CurrencySummary } from "@/lib/utils/dashboard/currency-summary"
import type { WeatherState } from "./weather"
import type { AirportInfo } from "@/lib/weather/airport-info"
import type { DelayMargin } from "@/lib/utils/dashboard/delay-margin"
import type { LogbookAuthority } from "@/lib/utils/logbook-rules"

export interface FlightBrief {
  status: PilotStatus
  now: number
  display?: DisplayPreferences
  /** The rules the pilot logs under — what a crew member's seat is called ("PIC", "P2"). */
  authority: LogbookAuthority
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
    info: DutyInfo | null
    lookupsLoading: boolean
    refreshLookups: () => void
  }
  /** How much later the chosen duty can run inside every limit — FDP and the rolling windows. */
  margin: DelayMargin | null
  /** The first day 90-day recency is NOT met, YYYY-MM-DD (null when it is not met now). */
  recencyLapseIso: string | null
  crew: CrewMate[]
  /** Each leg's own crew, in the order flown — the flights tile shows the leg on its page. */
  legCrew: CrewMate[][]
  /** The Currencies page in brief: its documents, grouped as it groups them, judged against the chosen duty. */
  currency: CurrencySummary
  destinations: DestinationVisits[]
  /** The airports the duty touches, by ICAO, once read. */
  airports: Map<string, Airport>
  /** Runways and frequencies for the destinations, by ICAO (undefined while asked, null when the source has none). */
  airportInfo: Record<string, AirportInfo | null>
  /** Whether the live traffic at the destinations is read — the page on screen and the duty within the lookups' reach. */
  traffic: boolean
  weather: WeatherState
  /** The airport the weather tile shows — where the duty goes next. */
  weatherStation: string | null
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
