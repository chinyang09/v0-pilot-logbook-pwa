/**
 * Flight statistics calculations
 */

import { userDb } from "../../user-db"
import { sumHHMM } from "@/lib/utils/time"

export interface FlightStats {
  totalFlights: number
  blockTime: string
  flightTime: string
  picTime: string
  sicTime: string
  picusTime: string
  dualTime: string
  instructorTime: string
  nightTime: string
  ifrTime: string
  totalDayLandings: number
  totalNightLandings: number
  totalAutolands: number
  uniqueAircraft: number
  uniqueAirports: number
}

/**
 * Get flight statistics
 */
export async function getFlightStats(): Promise<FlightStats> {
  const flights = await userDb.flights.toArray()

  const totalFlights = flights.length
  const blockTime = sumHHMM(flights.map((f) => f.blockTime))
  const flightTime = sumHHMM(flights.map((f) => f.flightTime))
  const picTime = sumHHMM(flights.map((f) => f.picTime))
  const sicTime = sumHHMM(flights.map((f) => f.sicTime))
  const picusTime = sumHHMM(flights.map((f) => f.picusTime))
  const dualTime = sumHHMM(flights.map((f) => f.dualTime))
  const instructorTime = sumHHMM(flights.map((f) => f.instructorTime))
  const nightTime = sumHHMM(flights.map((f) => f.nightTime))
  const ifrTime = sumHHMM(flights.map((f) => f.ifrTime))
  const totalDayLandings = flights.reduce((sum, f) => sum + f.dayLandings, 0)
  const totalNightLandings = flights.reduce((sum, f) => sum + f.nightLandings, 0)
  const totalAutolands = flights.reduce((sum, f) => sum + f.autolands, 0)

  const uniqueAircraft = new Set(flights.map((f) => f.aircraftReg)).size
  const uniqueAirports = new Set([...flights.map((f) => f.departureIcao), ...flights.map((f) => f.arrivalIcao)]).size

  return {
    totalFlights,
    blockTime,
    flightTime,
    picTime,
    sicTime,
    picusTime,
    dualTime,
    instructorTime,
    nightTime,
    ifrTime,
    totalDayLandings,
    totalNightLandings,
    totalAutolands,
    uniqueAircraft,
    uniqueAirports,
  }
}
