"use client"

import { useMemo } from "react"
import type { FlightLog, Airport } from "@/lib/db"
import {
  calculateBlockTime,
  calculateFlightTime,
  calculateDayTime,
  calculateTakeoffsLandings,
  calculateRoleTimes,
} from "@/lib/utils/flight-calculations"
import { calculateNightTimeComplete } from "@/lib/utils/night-time"
import { isValidHHMM } from "@/lib/utils/time"

/**
 * Calculated flight field values
 */
export interface CalculatedFlightFields {
  blockTime: string
  flightTime: string
  nightTime: string
  dayTime: string
  dayTakeoffs: number
  dayLandings: number
  nightTakeoffs: number
  nightLandings: number
  picTime: string
  sicTime: string
  picusTime: string
  dualTime: string
  instructorTime: string
}

/**
 * Input parameters for flight calculations
 */
export interface FlightCalculationInput {
  date?: string
  outTime?: string
  offTime?: string
  onTime?: string
  inTime?: string
  pilotFlying?: boolean
  pilotRole?: string
  depAirport: Airport | null
  arrAirport: Airport | null
}

/**
 * Hook that calculates derived flight fields based on input times and airports
 *
 * @example
 * ```tsx
 * const calculatedFields = useFlightCalculations({
 *   date: formData.date,
 *   outTime: formData.outTime,
 *   offTime: formData.offTime,
 *   onTime: formData.onTime,
 *   inTime: formData.inTime,
 *   pilotFlying: formData.pilotFlying,
 *   pilotRole: formData.pilotRole,
 *   depAirport,
 *   arrAirport,
 * })
 * ```
 */
export function useFlightCalculations(
  input: FlightCalculationInput
): CalculatedFlightFields {
  const {
    date,
    outTime,
    offTime,
    onTime,
    inTime,
    pilotFlying = true,
    pilotRole = "PIC",
    depAirport,
    arrAirport,
  } = input

  return useMemo(() => {
    // Calculate block time
    const blockTime =
      outTime && inTime && isValidHHMM(outTime) && isValidHHMM(inTime)
        ? calculateBlockTime(outTime, inTime)
        : "00:00"

    // Calculate flight time
    const flightTime =
      offTime && onTime && isValidHHMM(offTime) && isValidHHMM(onTime)
        ? calculateFlightTime(offTime, onTime)
        : "00:00"

    let nightTime = "00:00"
    let dayTime = "00:00"

    // FALLBACK LOGIC: Create effective times for calculation
    // If OFF/ON are missing or invalid, fallback to OUT/IN
    const calcOffTime =
      offTime && isValidHHMM(offTime) && offTime !== "00:00" ? offTime : outTime

    const calcOnTime =
      onTime && isValidHHMM(onTime) && onTime !== "00:00" ? onTime : inTime

    // Calculate night/day time
    if (
      date &&
      outTime &&
      inTime &&
      depAirport &&
      arrAirport &&
      isValidHHMM(outTime) &&
      isValidHHMM(inTime)
    ) {
      const depLat = depAirport.latitude ?? (depAirport as any).lat
      const depLon = depAirport.longitude ?? (depAirport as any).lon
      const arrLat = arrAirport.latitude ?? (arrAirport as any).lat
      const arrLon = arrAirport.longitude ?? (arrAirport as any).lon

      if (
        typeof depLat === "number" &&
        !isNaN(depLat) &&
        typeof depLon === "number" &&
        !isNaN(depLon) &&
        typeof arrLat === "number" &&
        !isNaN(arrLat) &&
        typeof arrLon === "number" &&
        !isNaN(arrLon)
      ) {
        const nightResult = calculateNightTimeComplete(
          date,
          outTime,
          offTime,
          onTime,
          inTime,
          { lat: depLat, lon: depLon },
          { lat: arrLat, lon: arrLon }
        )
        nightTime = nightResult.nightTimeHHMM
        dayTime = nightResult.dayTimeHHMM
      }
    } else {
      // Fallback: calculate day as block - night
      dayTime = calculateDayTime(blockTime, nightTime)
    }

    // Calculate takeoffs and landings
    const toLdg =
      date && calcOffTime && calcOnTime && depAirport && arrAirport
        ? calculateTakeoffsLandings(
            date,
            calcOffTime,
            calcOnTime,
            depAirport,
            arrAirport,
            pilotFlying
          )
        : {
            dayTakeoffs: 0,
            dayLandings: 0,
            nightTakeoffs: 0,
            nightLandings: 0,
          }

    // Calculate role-based times
    const roleTimes = calculateRoleTimes(blockTime, pilotRole)

    return {
      blockTime,
      flightTime,
      nightTime,
      dayTime,
      ...toLdg,
      ...roleTimes,
    }
  }, [
    date,
    outTime,
    offTime,
    onTime,
    inTime,
    pilotFlying,
    pilotRole,
    depAirport,
    arrAirport,
  ])
}

/**
 * Get numeric timezone offset from IANA timezone string
 */
export function getNumericOffset(tzString?: string): number {
  if (!tzString) return 0
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: tzString,
      timeZoneName: "longOffset",
    }).formatToParts(new Date())
    const offsetPart =
      parts.find((p) => p.type === "timeZoneName")?.value || ""
    const match = offsetPart.match(/([+-]\d+)/)
    return match ? parseInt(match[1]) : 0
  } catch {
    return 0
  }
}
