/**
 * What `/api/lookup` answers, route by route — the gateway Worker's own
 * routes (`Fr24Routes`) plus the ones the door composes from them
 * (`lib/lookup/composite.ts`), and the shared pool's records
 * (`/api/lookup/pool/*`, MongoDB).
 *
 * Types only, so the browser, Edge and Node code can all import it.
 */

import type { Fr24Airport, Fr24Routes } from "@/lib/fr24/types"
import type { FlightGates, FlightSuggestion } from "./flight-suggest"
import type { AircraftMovement, AircraftWhereabouts } from "./aircraft-whereabouts"
import type { AircraftCandidate, AirportCandidate } from "./search-candidates"

export type { AircraftCandidate, AirportCandidate, AircraftMovement, AircraftWhereabouts, FlightGates, FlightSuggestion }

/** An airport as the app stores it — the Worker's, less the offset it carries. */
export type EnrichedAirport = Omit<Fr24Airport, "timezoneOffsetSeconds">

/** An enriched aircraft submission from the shared pool. */
export interface PooledAircraft {
  registration: string
  typecode: string
  icao24: string
  operator: string
  shortDescription: string
  wtc: string
  wtg: string
  manufacturerCode: string
}

export interface LookupRoutes extends Fr24Routes {
  /** Every aircraft the text could be, exact first (`exact=1`: the exact one or 404). */
  "aircraft/candidates": AircraftCandidate[]
  /** Every airport a partial code or a name could be, exact first. */
  "airport/candidates": AirportCandidate[]
  /** A flight number on a UTC date: that day's schedule, or its usual times (`basis`). */
  "flight/suggest": FlightSuggestion
  /** Its departure and arrival gates; "" until published. */
  "flight/gates": FlightGates
  /** Where an aeroplane is before a time: its inbound flight (and arrival gate) and the one after. */
  "aircraft/whereabouts": AircraftWhereabouts
}

export type LookupRoute = keyof LookupRoutes
