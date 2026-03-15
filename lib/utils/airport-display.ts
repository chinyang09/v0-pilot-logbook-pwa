/**
 * Airport identifier display utility
 */

type AirportIdentifierPref = "icao" | "iata" | "both"

/**
 * Get the display code for an airport based on user preference
 */
export function getAirportDisplayCode(
  icao: string | undefined,
  iata: string | undefined,
  preference: AirportIdentifierPref = "icao"
): string {
  const icaoCode = icao || ""
  const iataCode = iata || ""

  switch (preference) {
    case "iata":
      return iataCode || icaoCode
    case "both":
      if (icaoCode && iataCode) return `${icaoCode}/${iataCode}`
      return icaoCode || iataCode
    case "icao":
    default:
      return icaoCode || iataCode
  }
}

/**
 * Get departure airport display code from a flight record
 */
export function getDepartureDisplay(
  flight: { departureIcao?: string; departureIata?: string },
  preference: AirportIdentifierPref = "icao"
): string {
  return getAirportDisplayCode(flight.departureIcao, flight.departureIata, preference)
}

/**
 * Get arrival airport display code from a flight record
 */
export function getArrivalDisplay(
  flight: { arrivalIcao?: string; arrivalIata?: string },
  preference: AirportIdentifierPref = "icao"
): string {
  return getAirportDisplayCode(flight.arrivalIcao, flight.arrivalIata, preference)
}
