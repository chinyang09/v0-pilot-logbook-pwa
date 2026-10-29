/**
 * The shapes the FR24 gateway Worker answers in (`cloudflare-worker/worker.js`).
 * Shared by the server client (`worker-client.ts`) and the browser one
 * (`client.ts`). The Worker is plain JS, so these are the contract —
 * `cloudflare-worker/__tests__/` pins the normalizers that produce them.
 */

/** `timezone` is "" when the source carries none — never read that as UTC. */
export interface Fr24Airport {
  icao: string
  iata: string
  name: string
  city: string
  country: string
  countryCode: string
  latitude: number
  longitude: number
  elevation: number
  timezone: string
  timezoneOffsetSeconds: number | null
}

export interface Fr24Aircraft {
  registration: string
  icao24: string
  typecode: string
  model: string
  serialNumber: string
  operator: string
  operatorIata: string
  operatorIcao: string
  owner: string
}

export interface Fr24FlightAirport {
  icao: string
  iata: string
  name: string
  timezone: string
}

/**
 * One flight from a flight list, an airport board or the live click handler.
 * Times are ISO-8601 UTC or null. FR24's "actual" times are its own
 * observation, not the company's OOOI record.
 */
export interface Fr24Flight {
  fr24Id: string | null
  flightNumber: string
  callsign: string
  status: string
  live: boolean
  registration: string
  typecode: string
  model: string
  airline: { name: string; iata: string; icao: string } | null
  origin: Fr24FlightAirport | null
  destination: Fr24FlightAirport | null
  scheduledDeparture: string | null
  scheduledArrival: string | null
  actualDeparture: string | null
  actualArrival: string | null
  estimatedDeparture: string | null
  estimatedArrival: string | null
  durationSeconds: number | null
}

export interface Fr24FlightPage {
  page: number
  totalPages: number | null
  total: number
  flights: Fr24Flight[]
}

export interface Fr24AircraftFlights extends Fr24FlightPage {
  aircraft: Fr24Aircraft | null
}

export interface Fr24Schedule extends Fr24FlightPage {
  mode: "arrivals" | "departures"
}

export interface Fr24AirportDetails {
  airport: Fr24Airport
  runways: unknown[]
  weather: unknown
}

export interface Fr24LiveFlight {
  id: string
  icao24: string
  latitude: number | null
  longitude: number | null
  heading: number | null
  altitude: number | null
  groundSpeed: number | null
  squawk: string
  typecode: string
  registration: string
  time: string | null
  originIata: string
  destinationIata: string
  flightNumber: string
  onGround: boolean
  verticalSpeed: number | null
  callsign: string
  airlineIcao: string
}

export interface Fr24LiveFlightDetails extends Fr24Flight {
  trail: {
    latitude: number | null
    longitude: number | null
    altitude: number | null
    groundSpeed: number | null
    heading: number | null
    time: string | null
  }[]
}

export interface Fr24Airline {
  name: string
  iata: string
  icao: string
}

/** What each normalized Worker route answers with in `data`. */
export interface Fr24Routes {
  aircraft: Fr24Aircraft[]
  "aircraft/flights": Fr24AircraftFlights
  airport: Fr24Airport
  "airport/details": Fr24AirportDetails
  "airport/schedule": Fr24Schedule
  airports: Fr24Airport[]
  airlines: Fr24Airline[]
  search: Record<string, unknown[]>
  flight: Fr24FlightPage
  "flight/details": Fr24LiveFlightDetails
  live: Fr24LiveFlight[]
}

export type Fr24Route = keyof Fr24Routes

/**
 * A Worker answer. `status` 404 is "nothing found" (manual entry); 502 is
 * "every source failed" (try later) — a caller must not treat the two alike.
 */
export type Fr24Result<T> =
  | { ok: true; status: number; data: T; source: string }
  | { ok: false; status: number; error: string }
